import { db } from "./supabase";
import { serviceWindow } from "./communication";
import { sendTemplate, sendText, sendMedia } from "./whatsapp/client";
import { resolveAudience, type AudienceFilter } from "./broadcasts";
import type { AssetKind, Lead } from "./types";

/**
 * Drip sequences.
 *
 * A sequence is a series of steps ("day 0: welcome, day 2: floor plans,
 * day 5: site-visit nudge") that each lead moves through on their own clock —
 * delays are relative to *their* enrollment, not a calendar date.
 *
 * The engine is a poller, not a scheduler: `runDueSequenceSteps` fires
 * whatever is due right now and is meant to be hit by cron every few minutes.
 * That makes it stateless, idempotent and safe to run from more than one
 * place, because claiming a step is an atomic compare-and-set on next_run_at.
 *
 * The 24-hour rule shapes the send path: a step inside the customer's service
 * window may send its free-text body, one outside it may only send its
 * template — and a step with no template outside the window is *skipped
 * forward*, never sent illegally, never left to jam the queue.
 */

const BATCH = 50;

export interface SequenceStep {
  id: string;
  sequence_id: string;
  position: number;
  delay_hours: number;
  template_id: string | null;
  body: string | null;
  asset_id: string | null;
}

export async function enrollLead(
  sequenceId: string,
  leadId: string,
): Promise<{ enrolled: boolean; reason?: string }> {
  const supabase = db();

  const { data: lead } = await supabase
    .from("villa_leads")
    .select("id, opted_out, phone")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { enrolled: false, reason: "lead not found" };
  if (lead.opted_out) return { enrolled: false, reason: "opted out" };
  if (!lead.phone) return { enrolled: false, reason: "no phone number (Instagram-only lead)" };

  // The unique (sequence_id, lead_id) makes re-enrollment a no-op rather than
  // a second parallel drip to the same person.
  const { error } = await supabase.from("villa_sequence_enrollments").upsert(
    {
      sequence_id: sequenceId,
      lead_id: leadId,
      status: "active",
      current_step: 0,
      next_run_at: new Date().toISOString(),
    },
    { onConflict: "sequence_id,lead_id", ignoreDuplicates: true },
  );
  if (error) return { enrolled: false, reason: error.message };
  return { enrolled: true };
}

/** Auto-enrolls every lead matching an active sequence's entry filter. */
export async function autoEnroll(): Promise<number> {
  const supabase = db();
  const { data: sequences } = await supabase
    .from("villa_sequences")
    .select("*")
    .eq("active", true);

  let enrolled = 0;
  for (const seq of sequences ?? []) {
    const entry = (seq.entry ?? {}) as AudienceFilter;
    if (Object.keys(entry).length === 0) continue; // manual-only sequence

    const leads = await resolveAudience(entry);
    for (const lead of leads) {
      const result = await enrollLead(seq.id, lead.id);
      if (result.enrolled) enrolled += 1;
    }
  }
  return enrolled;
}

interface DueEnrollment {
  id: string;
  sequence_id: string;
  lead_id: string;
  current_step: number;
  next_run_at: string;
}

/**
 * Fires every due step. Returns counts for the cron log.
 *
 * Claiming: the update on next_run_at is conditional on the value we read, so
 * of two concurrent runners exactly one wins each enrollment and the other
 * moves on. No lock table needed for this one — the row itself is the lock.
 */
export async function runDueSequenceSteps(): Promise<{
  sent: number;
  skipped: number;
  completed: number;
  failed: number;
}> {
  const supabase = db();
  const counts = { sent: 0, skipped: 0, completed: 0, failed: 0 };

  const { data: due } = await supabase
    .from("villa_sequence_enrollments")
    .select("*")
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at")
    .limit(BATCH);

  for (const enrollment of (due ?? []) as DueEnrollment[]) {
    // Atomic claim: push next_run_at into the future only if nobody else has.
    const { data: claimed } = await supabase
      .from("villa_sequence_enrollments")
      .update({ next_run_at: new Date(Date.now() + 10 * 60_000).toISOString() })
      .eq("id", enrollment.id)
      .eq("next_run_at", enrollment.next_run_at)
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // another runner got it

    try {
      const outcome = await fireStep(enrollment);
      counts[outcome] += 1;
    } catch (e) {
      counts.failed += 1;
      console.error(`[sequences] step failed for enrollment ${enrollment.id}`, e);
    }
  }

  return counts;
}

async function fireStep(
  enrollment: DueEnrollment,
): Promise<"sent" | "skipped" | "completed"> {
  const supabase = db();

  const [{ data: sequence }, { data: steps }, { data: lead }] = await Promise.all([
    supabase.from("villa_sequences").select("*").eq("id", enrollment.sequence_id).single(),
    supabase
      .from("villa_sequence_steps")
      .select("*")
      .eq("sequence_id", enrollment.sequence_id)
      .order("position"),
    supabase.from("villa_leads").select("*").eq("id", enrollment.lead_id).single(),
  ]);

  const exit = async (status: "completed" | "exited", reason?: string) => {
    await supabase
      .from("villa_sequence_enrollments")
      .update({
        status,
        completed_at: new Date().toISOString(),
        ...(reason ? { exit_reason: reason } : {}),
      })
      .eq("id", enrollment.id);
  };

  if (!sequence || !lead) {
    await exit("exited", "sequence or lead vanished");
    return "skipped";
  }

  // The whole point of exit_on: stop the drip the moment the lead does what
  // it was pushing for — or leaves. Messaging a booked customer about urgency
  // is how goodwill dies.
  const exitStages: string[] = sequence.exit_on ?? [];
  if (lead.opted_out || exitStages.includes(lead.pipeline_stage)) {
    await exit("exited", lead.opted_out ? "opted out" : `reached ${lead.pipeline_stage}`);
    return "skipped";
  }

  const ordered = (steps ?? []) as SequenceStep[];
  const step = ordered[enrollment.current_step];
  if (!step) {
    await exit("completed");
    return "completed";
  }

  const advance = async () => {
    const next = ordered[enrollment.current_step + 1];
    if (!next) {
      await exit("completed");
      return;
    }
    await supabase
      .from("villa_sequence_enrollments")
      .update({
        current_step: enrollment.current_step + 1,
        next_run_at: new Date(Date.now() + next.delay_hours * 3_600_000).toISOString(),
      })
      .eq("id", enrollment.id);
  };

  // Which send is legal right now?
  const { data: lastInbound } = await supabase
    .from("villa_messages")
    .select("created_at")
    .eq("lead_id", lead.id)
    .eq("role", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const windowOpen = serviceWindow(lastInbound?.created_at ?? null).open;

  if (windowOpen && step.body) {
    await sendText(lead.phone as string, step.body);
    if (step.asset_id) {
      const { data: asset } = await supabase
        .from("villa_assets")
        .select("url, kind, shareable_by_ai")
        .eq("id", step.asset_id)
        .maybeSingle();
      if (asset?.shareable_by_ai) {
        await sendMedia(lead.phone as string, asset.url, asset.kind as AssetKind);
      }
    }
  } else if (step.template_id) {
    const { data: template } = await supabase
      .from("villa_templates")
      .select("name, language, status")
      .eq("id", step.template_id)
      .single();
    if (!template || template.status !== "approved") {
      // An unapproved template cannot be sent. Skip forward rather than
      // wedging every enrollment on this step forever.
      await advance();
      return "skipped";
    }
    await sendTemplate(lead.phone as string, template.name, template.language, [
      (lead as Lead).name ?? "there",
    ]);
  } else {
    // Outside the window with no template: sending the body would be rejected
    // by Meta. Skipping forward is the only honest move.
    await advance();
    return "skipped";
  }

  // villa_messages requires a conversation, so the drip lands in the lead's
  // open thread (creating one if needed) — which is also where a rep looking
  // at the inbox would expect to see what the machine sent.
  const { getOrCreateConversation } = await import("./conversation");
  const conversation = await getOrCreateConversation(lead.id, "whatsapp");
  await supabase.from("villa_messages").insert({
    conversation_id: conversation.id,
    lead_id: lead.id,
    role: "system",
    body: `[sequence: ${sequence.name}, step ${step.position}]${step.body ? ` ${step.body}` : ""}`,
  });

  await advance();
  return "sent";
}
