import { db } from "./supabase";
import { logActivity } from "./activities";
import type { Lead, PipelineStage } from "./types";

/**
 * Reads and writes for the /production Kanban board.
 *
 * Column order here is the funnel order, not alphabetical or DB-enum order —
 * it's what the board renders left to right, so it lives here rather than
 * being re-declared in the page.
 */
export const PIPELINE_STAGES: PipelineStage[] = [
  "new",
  "qualifying",
  "qualified",
  "site_visit_scheduled",
  "negotiation",
  "booked",
  "lost",
];

const STAGE_SET = new Set<string>(PIPELINE_STAGES);

export function isPipelineStage(value: string): value is PipelineStage {
  return STAGE_SET.has(value);
}

export const STAGE_LABELS: Record<PipelineStage, string> = {
  new: "New",
  qualifying: "Qualifying",
  qualified: "Qualified",
  site_visit_scheduled: "Site Visit Scheduled",
  negotiation: "Negotiation",
  booked: "Booked",
  lost: "Lost",
};

export type LeadsByStage = Record<PipelineStage, Lead[]>;

/**
 * The board depends on a column rather than a table, so requireTable cannot
 * tell an unapplied 0003 from an empty board — villa_leads exists either way.
 * Selecting the column directly is what distinguishes them.
 */
export async function requirePipelineStage(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const { error } = await db().from("villa_leads").select("pipeline_stage").limit(1);
  if (!error) return { ok: true };
  if (/pipeline_stage/i.test(error.message)) {
    return {
      ok: false,
      error:
        'This page needs the "pipeline_stage" column on villa_leads, which doesn\'t exist yet. Run supabase/migrations/0003_production_kanban.sql in the Supabase SQL editor.',
    };
  }
  return { ok: false, error: error.message };
}

export async function leadsByStage(): Promise<LeadsByStage> {
  const grouped = PIPELINE_STAGES.reduce((acc, s) => {
    acc[s] = [];
    return acc;
  }, {} as LeadsByStage);

  const { data } = await db()
    .from("villa_leads")
    .select("*")
    .order("last_contact_at", { ascending: false });

  for (const lead of (data ?? []) as Lead[]) {
    // Defensive: a row could carry a stage value that predates a future enum
    // change. Drop it rather than let one bad row blank the whole board.
    if (isPipelineStage(lead.pipeline_stage)) grouped[lead.pipeline_stage].push(lead);
  }

  return grouped;
}

export async function moveLeadStage(
  leadId: string,
  stage: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPipelineStage(stage)) {
    return { ok: false, error: `invalid pipeline stage: ${stage}` };
  }

  const { error } = await db().from("villa_leads").update({ pipeline_stage: stage }).eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  await logActivity({
    leadId,
    type: "stage_changed",
    description: `Pipeline stage moved to ${STAGE_LABELS[stage]}`,
    actorName: "Console",
  });

  return { ok: true };
}
