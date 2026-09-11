import { NextResponse, after } from "next/server";
import { verifyChallenge, verifySignature } from "@/lib/osf/whatsapp/verify";
import { markRead, sendText } from "@/lib/osf/whatsapp/client";
import { deliverToWhatsApp } from "@/lib/osf/whatsapp/deliver";
import { recordStatuses } from "@/lib/osf/whatsapp/receipts";
import { transcribeVoiceNote } from "@/lib/osf/whatsapp/media";
import { handleInbound, type InboundAttribution } from "@/lib/osf/conversation";
import { textFrom, type WhatsAppWebhookBody } from "@/lib/osf/whatsapp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A voice note is download + Whisper + an agent turn; give the function room.
export const maxDuration = 60;

/**
 * Meta's verification handshake. Configure the webhook in the Meta dashboard
 * with this URL and the WHATSAPP_VERIFY_TOKEN from your .env.local.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const challenge = verifyChallenge(params);

  if (!challenge) {
    return new NextResponse("Verification failed", { status: 403 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: Request) {
  // The signature is computed over the exact bytes Meta sent, so read the body
  // as text and parse it ourselves — request.json() would discard the original.
  const raw = await request.text();

  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(raw) as WhatsAppWebhookBody;
  } catch {
    return new NextResponse("Bad payload", { status: 400 });
  }

  // Acknowledge fast. Meta retries anything slower than ~20s, which would mean
  // answering the same customer twice while the first reply is still thinking.
  //
  // after(), not a floating promise: serverless platforms freeze the function
  // the instant the response goes out, so a naked promise dies mid-agent-turn
  // and the customer never gets a reply. after() tells the platform to keep
  // the instance alive until the work finishes. Locally it behaves the same.
  after(async () => {
    try {
      await processWebhook(body);
    } catch (e) {
      console.error("[whatsapp] processing failed", e);
    }
  });

  return NextResponse.json({ received: true });
}

async function processWebhook(body: WhatsAppWebhookBody) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Delivery receipts. Meta sends these in the same webhook shape as
      // messages, and without them every read rate on the dashboard is zero.
      if (value.statuses?.length) {
        await recordStatuses(value.statuses).catch((e) =>
          console.error("[whatsapp] receipt recording failed", e),
        );
      }

      if (!value.messages?.length) continue;

      const profileName = value.contacts?.[0]?.profile?.name ?? null;

      for (const message of value.messages) {
        void markRead(message.id);

        // A voice note carries no text, so transcribe it before anything else —
        // otherwise textFrom() yields a placeholder and the agent can only ask
        // the customer to type it out. Indian buyers send these constantly.
        let text: string | null;
        if (message.type === "audio" && message.audio?.id) {
          const transcript = await transcribeVoiceNote(message.audio.id);
          text = transcript
            ? transcript.text
            : "[the customer sent a voice note that could not be transcribed — ask them to type it, politely]";
          if (transcript) {
            console.log(
              `[whatsapp] transcribed voice note from +${message.from} (${transcript.language ?? "unknown"})`,
            );
          }
        } else {
          text = textFrom(message);
        }

        if (!text) continue;

        // Click-to-WhatsApp ads carry the originating ad on the first message.
        // This is the only chance to capture it, so it goes in at lead creation.
        const attribution: InboundAttribution | undefined = message.referral
          ? {
              source: sourceFromReferral(message.referral.source_type),
              adId: message.referral.source_id,
              campaign: message.referral.headline,
              creative: message.referral.media_type,
              landingPage: message.referral.source_url,
            }
          : undefined;

        try {
          const outcome = await handleInbound({
            phone: message.from,
            text,
            profileName,
            channel: "whatsapp",
            waMessageId: message.id,
            attribution,
            deliver: (reply) => deliverToWhatsApp(message.from, reply),
          });

          if (outcome.status === "skipped") {
            console.log(`[whatsapp] skipped (${outcome.reason}) for +${message.from}`);
          }
        } catch (e) {
          console.error(`[whatsapp] failed handling message from +${message.from}`, e);
          // Never leave a customer hanging on an internal fault.
          await sendText(
            message.from,
            "Sorry — I'm having trouble on my side just now. Our sales team will get back to you shortly.",
          ).catch(() => {});
        }
      }
    }
  }
}

function sourceFromReferral(sourceType?: string): string {
  switch (sourceType) {
    case "ad":
      return "Meta Ads";
    case "post":
      return "Facebook";
    default:
      return "whatsapp";
  }
}
