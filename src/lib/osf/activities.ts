import { db } from "./supabase";

/**
 * The activity feed — one row per notable event across every lead.
 *
 * Messages already live in villa_messages; this table records the things that
 * happen *around* a conversation (stage moves, follow-up dispatches, inventory
 * edits) so a rep opening a lead sees the whole story, not just chat.
 */

export interface Activity {
  id: string;
  lead_id: string | null;
  actor: string | null;
  activity_type: string;
  description: string;
  channel: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ActivityWithLead = Activity & {
  villa_leads: { id: string; name: string | null; phone: string } | null;
};

export interface LogActivityInput {
  leadId?: string | null;
  actorName?: string | null;
  type: string;
  description: string;
  channel?: string | null;
  metadata?: Record<string, unknown>;
}

/** Badge label + colour per known activity type. Unknown types fall back. */
const ACTIVITY_STYLES: Record<string, { label: string; className: string }> = {
  lead_created: { label: "New lead", className: "bg-[--color-gold-soft] text-[--color-gold-300]" },
  message_received: { label: "Inbound", className: "bg-slate-100 text-slate-700" },
  message_sent: { label: "Outbound", className: "bg-[--color-raised] text-[--color-gold-600]" },
  stage_changed: { label: "Stage", className: "bg-indigo-100 text-indigo-700" },
  handoff: { label: "Handoff", className: "bg-[--color-gold-soft] text-[--color-gold-300]" },
  site_visit: { label: "Site visit", className: "bg-emerald-100 text-emerald-700" },
  follow_up_scheduled: { label: "Follow-up set", className: "bg-amber-100 text-amber-700" },
  follow_up_sent: { label: "Follow-up sent", className: "bg-[--color-gold-soft] text-[--color-gold-300]" },
  follow_up_manual: { label: "Needs a human", className: "bg-[--color-gold-soft] text-[--color-gold-300]" },
  follow_up_failed: { label: "Send failed", className: "bg-red-100 text-red-700" },
  follow_up_skipped: { label: "Skipped", className: "bg-slate-100 text-slate-600" },
  inventory_updated: { label: "Inventory", className: "bg-sky-100 text-sky-700" },
  booking: { label: "Booking", className: "bg-emerald-100 text-emerald-700" },
  note: { label: "Note", className: "bg-slate-100 text-slate-700" },
};

export function activityBadge(type: string): { label: string; className: string } {
  return (
    ACTIVITY_STYLES[type] ?? {
      label: type.replace(/_/g, " "),
      className: "bg-slate-100 text-slate-700",
    }
  );
}

/**
 * Records one event. Never throws.
 *
 * Callers are things like the WhatsApp reply path and the cron dispatcher — an
 * audit-trail write must not be able to fail the customer-facing work that
 * triggered it, and Supabase being unconfigured must not crash a caller either.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await db()
      .from("villa_activities")
      .insert({
        lead_id: input.leadId ?? null,
        actor: input.actorName ?? null,
        activity_type: input.type,
        description: input.description,
        channel: input.channel ?? null,
        metadata: input.metadata ?? {},
      });
  } catch {
    // Intentionally silent — see the doc comment above.
  }
}

export async function listActivities(limit = 100): Promise<ActivityWithLead[]> {
  const { data } = await db()
    .from("villa_activities")
    .select("*, villa_leads(id, name, phone)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ActivityWithLead[];
}

export async function activitiesForLead(leadId: string, limit = 50): Promise<Activity[]> {
  const { data } = await db()
    .from("villa_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Activity[];
}
