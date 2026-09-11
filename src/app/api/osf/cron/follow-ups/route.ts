import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { configStatus } from "@/lib/osf/env";
import { db } from "@/lib/osf/supabase";
import { logActivity } from "@/lib/osf/activities";
import { sendReengagement } from "@/lib/osf/whatsapp/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled follow-up dispatcher. Point a cron at:
 *   GET /api/cron/follow-ups   with   Authorization: Bearer $CRON_SECRET
 *
 * WHY IT ONLY EVER SENDS TEMPLATES
 * A follow-up fires hours or days after the customer last wrote, which is
 * almost always outside WhatsApp's 24-hour customer service window. Outside
 * that window Meta only delivers pre-approved template messages — free text is
 * rejected, and repeatedly attempting it is how a business number gets rate
 * limited and eventually banned. villa_follow_ups.message may well hold a
 * nice AI-drafted sentence; this route deliberately never sends it. No
 * template_name, no send: the row is flagged for a human instead.
 */

const BATCH_SIZE = 50;

type Outcome = "sent" | "manual" | "skipped" | "failed" | "already_claimed";

interface FollowUpRow {
  id: string;
  lead_id: string;
  scheduled_at: string;
  channel: string;
  template_name: string | null;
  notes: string | null;
  villa_leads: {
    id: string;
    name: string | null;
    phone: string;
    opted_out: boolean;
  } | null;
}

/** Constant-time so the secret can't be recovered a byte at a time. */
function authorized(request: Request, secret: string): boolean {
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  // Fail closed, and uniformly: an unset secret means anyone who guesses the
  // URL could make the business message its customers, so refuse — but with
  // the same 401 an invalid secret gets. The remediation (openssl rand -hex
  // 32 into CRON_SECRET in .env.local) goes to the server log, where the
  // operator is, not to whoever poked the endpoint.
  if (!secret || !authorized(request, secret)) {
    if (!secret) {
      console.error(
        "[cron:follow-ups] refused: CRON_SECRET is not set. Generate one (openssl rand -hex 32), put it in .env.local, and send it as `Authorization: Bearer <secret>`.",
      );
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const whatsappReady = configStatus().whatsapp;

  let due: FollowUpRow[];
  try {
    const { data, error } = await db()
      .from("villa_follow_ups")
      .select("id, lead_id, scheduled_at, channel, template_name, notes, villa_leads(id, name, phone, opted_out)")
      .eq("status", "pending")
      .lte("scheduled_at", startedAt)
      .is("dispatched_at", null)
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      // PGRST205 = table not in the schema cache, i.e. 0009 hasn't been run.
      // 503 not 500, so a monitor reads it as "not deployed yet" rather than
      // "the dispatcher is broken".
      const notMigrated = error.code === "PGRST205";
      return NextResponse.json(
        {
          error: notMigrated
            ? `villa_follow_ups does not exist — run supabase/migrations/0009_business_os.sql in the Supabase SQL editor. (${error.message})`
            : error.message,
        },
        { status: notMigrated ? 503 : 500 },
      );
    }
    due = (data ?? []) as unknown as FollowUpRow[];
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "database unavailable" },
      { status: 503 },
    );
  }

  const results: Array<{ id: string; leadId: string; outcome: Outcome; detail: string }> = [];

  for (const followUp of due) {
    const lead = followUp.villa_leads;

    // Claim first, act second. The conditional update is the double-send guard:
    // if an overlapping run already took this row the update matches nothing.
    const claim = await db()
      .from("villa_follow_ups")
      .update({ dispatched_at: new Date().toISOString() })
      .eq("id", followUp.id)
      .is("dispatched_at", null)
      .select("id");

    if (!claim.data || claim.data.length === 0) {
      results.push({
        id: followUp.id,
        leadId: followUp.lead_id,
        outcome: "already_claimed",
        detail: "another dispatcher run picked this up first",
      });
      continue;
    }

    if (lead?.opted_out) {
      await resolve(followUp, "missed", "Not sent — this lead has opted out. Do not contact.");
      await logActivity({
        leadId: followUp.lead_id,
        type: "follow_up_skipped",
        description: "Scheduled follow-up cancelled because the lead has opted out",
        actorName: "Follow-up dispatcher",
        channel: followUp.channel,
      });
      results.push({
        id: followUp.id,
        leadId: followUp.lead_id,
        outcome: "skipped",
        detail: "lead opted out",
      });
      continue;
    }

    const blocker = manualReason(followUp, lead, whatsappReady);
    if (blocker) {
      // Status stays 'pending' on purpose — the customer is still owed this
      // message. dispatched_at only records that the dispatcher has seen it and
      // will not try again on its own.
      await annotate(followUp, `Needs manual action — ${blocker}`);
      await logActivity({
        leadId: followUp.lead_id,
        type: "follow_up_manual",
        description: `Follow-up due ${followUp.scheduled_at} needs a human: ${blocker}`,
        actorName: "Follow-up dispatcher",
        channel: followUp.channel,
      });
      results.push({ id: followUp.id, leadId: followUp.lead_id, outcome: "manual", detail: blocker });
      continue;
    }

    try {
      // Language is fixed to the English variant: villa_follow_ups records the
      // template name but not which language variants Meta approved, and
      // requesting an unapproved one fails the send outright.
      const { messageId } = await sendReengagement(
        lead!.phone,
        { name: followUp.template_name! },
        followUp.notes ?? undefined,
      );

      await resolve(
        followUp,
        "completed",
        `Template "${followUp.template_name}" sent by the scheduled dispatcher.`,
        true,
      );
      await logActivity({
        leadId: followUp.lead_id,
        type: "follow_up_sent",
        description: `Sent approved template "${followUp.template_name}"`,
        actorName: "Follow-up dispatcher",
        channel: "whatsapp",
        metadata: { template_name: followUp.template_name, wa_message_id: messageId },
      });
      results.push({
        id: followUp.id,
        leadId: followUp.lead_id,
        outcome: "sent",
        detail: followUp.template_name!,
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);

      // No automatic retry, and dispatched_at stays set: a failure after the
      // request left here could still have been delivered, so retrying risks
      // messaging the customer twice. A human decides.
      await resolve(followUp, "missed", `Send failed — ${detail}`);
      await logActivity({
        leadId: followUp.lead_id,
        type: "follow_up_failed",
        description: `Follow-up template "${followUp.template_name}" failed to send`,
        actorName: "Follow-up dispatcher",
        channel: "whatsapp",
        metadata: { error: detail },
      });
      results.push({ id: followUp.id, leadId: followUp.lead_id, outcome: "failed", detail });
    }
  }

  const count = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length;

  return NextResponse.json({
    ok: true,
    ranAt: startedAt,
    whatsappConfigured: whatsappReady,
    due: due.length,
    sent: count("sent"),
    manual: count("manual"),
    skipped: count("skipped"),
    failed: count("failed"),
    alreadyClaimed: count("already_claimed"),
    results,
  });
}

/** Why this follow-up cannot be auto-sent, or null when it can. */
function manualReason(
  followUp: FollowUpRow,
  lead: FollowUpRow["villa_leads"],
  whatsappReady: boolean,
): string | null {
  if (!lead?.phone) return "the lead has no phone number on record";
  if (followUp.channel !== "whatsapp") return `channel is "${followUp.channel}", which nothing here can send`;
  if (!whatsappReady) return "WhatsApp Cloud API credentials are not configured";
  if (!followUp.template_name) {
    return "no approved template is set, and free text cannot be sent outside the 24h window";
  }
  return null;
}

async function resolve(
  followUp: FollowUpRow,
  status: "completed" | "missed",
  note: string,
  completed = false,
) {
  await db()
    .from("villa_follow_ups")
    .update({
      status,
      notes: appendNote(followUp.notes, note),
      ...(completed ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", followUp.id);
}

async function annotate(followUp: FollowUpRow, note: string) {
  await db()
    .from("villa_follow_ups")
    .update({ notes: appendNote(followUp.notes, note) })
    .eq("id", followUp.id);
}

function appendNote(existing: string | null, note: string): string {
  const stamped = `[${new Date().toISOString()}] ${note}`;
  return existing ? `${existing}\n${stamped}` : stamped;
}
