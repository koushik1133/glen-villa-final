import { NextResponse, after } from "next/server";
import { verifyChallenge, verifySignature } from "@/lib/osf/whatsapp/verify";
import { deliverToInstagram } from "@/lib/osf/instagram/client";
import { handleInbound } from "@/lib/osf/conversation";
import { env } from "@/lib/osf/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Instagram Direct webhook.
 *
 * Deliberately a thin transport: it unwraps Meta's Messenger envelope and
 * hands the text to the same handleInbound() the WhatsApp webhook uses, so
 * both channels get identical qualification, scoring, CRM writes and handoff
 * behaviour. Anything the agent learns on Instagram lands on the same lead.
 */

/**
 * Reads the Instagram secrets without throwing.
 *
 * The env getters throw on missing configuration, which is right for code
 * paths an operator drives — but Meta drives this one. An unconfigured
 * channel must answer 403/401 (fail closed), not 500, because a string of
 * 5xxs makes Meta mark the whole webhook subscription as broken.
 */
function instagramConfig(): { verifyToken: string; appSecret: string } | null {
  try {
    return { verifyToken: env.instagramVerifyToken, appSecret: env.instagramAppSecret };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const config = instagramConfig();
  if (!config) return new NextResponse("Verification failed", { status: 403 });

  const params = new URL(request.url).searchParams;
  const challenge = verifyChallenge(params, config.verifyToken);
  if (challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return new NextResponse("Verification failed", { status: 403 });
}

interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
}

export async function POST(request: Request) {
  const config = instagramConfig();
  if (!config) return new NextResponse("Invalid signature", { status: 401 });

  const raw = await request.text();

  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: { object?: string; entry?: Array<{ messaging?: MessagingEvent[] }> };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad payload", { status: 400 });
  }

  // Same reason as the WhatsApp route: Meta retries anything slower than ~20s,
  // which would mean answering the same person twice. after() keeps the
  // serverless instance alive past the response — a naked promise would be
  // frozen mid-reply.
  after(async () => {
    try {
      await process(body);
    } catch (e) {
      console.error("[instagram] processing failed", e);
    }
  });

  return NextResponse.json({ received: true });
}

async function process(body: { entry?: Array<{ messaging?: MessagingEvent[] }> }) {
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id;
      const message = event.message;
      if (!senderId || !message) continue;

      // Our own outbound messages come back as echoes. Answering one would
      // put the agent in a conversation with itself.
      if (message.is_echo) continue;

      // A quick-reply tap carries the payload we set, which is the option id
      // the agent chose — more precise than the visible label.
      const text =
        message.quick_reply?.payload ??
        message.text ??
        (message.attachments?.length
          ? "[the customer sent an attachment on Instagram — acknowledge it and ask what they'd like to know]"
          : null);

      if (!text) continue;

      try {
        const outcome = await handleInbound({
          instagramId: senderId,
          text,
          channel: "instagram",
          waMessageId: message.mid ?? null,
          deliver: (reply) => deliverToInstagram(senderId, reply),
        });

        if (outcome.status === "skipped") {
          console.log(`[instagram] skipped (${outcome.reason}) for ${senderId}`);
        }
      } catch (e) {
        console.error(`[instagram] failed handling message from ${senderId}`, e);
      }
    }
  }
}
