import { NextResponse } from "next/server";
import { handleInbound } from "@/lib/osf/conversation";
import type { AgentReply } from "@/lib/osf/types";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Local test harness for the dashboard simulator.
 *
 * Runs the exact same agent path as the WhatsApp webhook — same prompt, same
 * tools, same CRM writes — but collects the outbound messages and returns them
 * to the browser instead of calling Meta. That means you can tune the agent
 * before your WhatsApp number is approved, and everything you do here shows up
 * as a real lead in the dashboard.
 */
export async function POST(request: Request) {
  const denied = await guard("workflows.manage");
  if (denied) return denied;
  let payload: { phone?: string; text?: string; name?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = payload.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // Default to a reserved test number so simulator traffic is easy to spot and
  // delete, and can never collide with a real customer's WhatsApp number.
  const phone = (payload.phone ?? "000000000001").replace(/\D/g, "") || "000000000001";

  const replies: AgentReply[] = [];

  try {
    const outcome = await handleInbound({
      phone,
      text,
      profileName: payload.name ?? "Simulator",
      // "whatsapp", not a dedicated "simulator" channel: channel is a Postgres
      // enum, and the simulator's whole job is to exercise the exact path a
      // real WhatsApp message takes. The reserved test phone number is what
      // keeps simulator traffic distinguishable, not the channel.
      channel: "whatsapp",
      deliver: async (reply) => {
        replies.push(reply);
      },
    });

    if (outcome.status === "skipped") {
      return NextResponse.json({
        replies: [],
        skipped: outcome.reason,
        note:
          outcome.reason === "opted_out"
            ? "This test lead is marked opted out. Clear `opted_out` on the lead to resume."
            : outcome.reason === "ai_paused"
              ? "AI is paused on this lead — a human has taken over."
              : "Duplicate message, ignored.",
      });
    }

    return NextResponse.json({
      replies,
      leadScore: outcome.result.leadScore,
      temperature: outcome.result.temperature,
      toolsUsed: outcome.result.toolsUsed,
      usage: outcome.result.usage,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The simulator is a developer tool, so surfacing the real error here is
    // the point — this is where a missing key or unapplied migration shows up.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
