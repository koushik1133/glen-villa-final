import { NextResponse } from "next/server";
import { transcribeAudio, transcriptionConfigured } from "@/lib/osf/whatsapp/media";
import { handleInbound } from "@/lib/osf/conversation";
import type { AgentReply } from "@/lib/osf/types";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reserved test number, so voice tests never collide with a real customer. */
const TEST_PHONE = "000000000009";

/**
 * Voice pipeline test harness.
 *
 * Skips only the Meta media download — everything after it (Whisper, the agent,
 * the CRM writes) is the same code a real voice note runs through, so a pass
 * here means the pipeline works end to end once the webhook is connected.
 *
 * Behind the dashboard auth via middleware, like every other non-webhook route.
 */
export async function POST(request: Request) {
  const denied = await guard("workflows.manage");
  if (denied) return denied;
  if (!transcriptionConfigured()) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not set — voice transcription needs it." },
      { status: 503 },
    );
  }

  let bytes: Buffer;
  let mimeType: string;
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: "No audio supplied" }, { status: 400 });
    }
    bytes = Buffer.from(await audio.arrayBuffer());
    mimeType = audio.type || "audio/webm";
  } catch {
    return NextResponse.json({ error: "Could not read the upload" }, { status: 400 });
  }

  try {
    const transcript = await transcribeAudio(bytes, mimeType);
    if (!transcript.text) {
      return NextResponse.json(
        { error: "Nothing was transcribed — the recording may be silent or too short." },
        { status: 422 },
      );
    }

    const replies: AgentReply[] = [];
    const outcome = await handleInbound({
      phone: TEST_PHONE,
      text: transcript.text,
      profileName: "Voice test",
      channel: "whatsapp",
      deliver: async (r) => {
        replies.push(r);
      },
    });

    return NextResponse.json({
      transcript: transcript.text,
      language: transcript.language,
      replies: replies.map((r) => r.text).filter(Boolean),
      skipped: outcome.status === "skipped" ? outcome.reason : undefined,
    });
  } catch (e) {
    // A developer tool — the real error is the useful thing to return here.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Transcription failed" },
      { status: 500 },
    );
  }
}
