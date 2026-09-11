import { cache } from "react";
import { db } from "./supabase";
import { configStatus } from "./env";
import type { Conversation, Lead, Message, Project, VillaType } from "./types";

/**
 * Read-side queries for the dashboard.
 *
 * Each returns a `ready` flag rather than throwing, so an unconfigured or
 * un-migrated database renders a setup checklist instead of an error page.
 */

export interface DashboardGate {
  ready: boolean;
  missing: string[];
  error?: string;
}

/** Env vars the console cannot run without. Pure — deliberately no network. */
function missingConfig(): string[] {
  const status = configStatus();
  const missing: string[] = [];
  if (!status.supabase) {
    missing.push("OSF_SUPABASE_URL", "OSF_SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!status.aiConfigured) {
    missing.push(status.llmProvider === "groq" ? "GROQ_API_KEY" : "ANTHROPIC_API_KEY");
  }
  return missing;
}

/**
 * Base-schema probe, memoised per request.
 *
 * `cache()` matters because the probe is now fired from both `gate()` and
 * `gatedLoad()`; without it a page using both would pay the round-trip twice.
 */
const probeSchema = cache(async function probeSchema(): Promise<DashboardGate> {
  const { error } = await db().from("villa_leads").select("id").limit(1);
  if (error) {
    return {
      ready: false,
      missing: [],
      error: `Database reachable but the schema is missing (${error.message}). Run supabase/migrations/0001_schema.sql and 0002_seed_glentree_serenity.sql in the Supabase SQL editor.`,
    };
  }
  return { ready: true, missing: [] };
});

export const gate = cache(async function gate(): Promise<DashboardGate> {
  const missing = missingConfig();
  if (missing.length) return { ready: false, missing };
  return probeSchema();
});

/**
 * Checks a table added by a later migration actually exists.
 *
 * Without this a page whose table is missing renders an ordinary empty state,
 * which reads as "working, no data yet" when the real cause is an unapplied
 * migration. Pages call this to tell the two apart.
 */
export const requireTable = cache(async function requireTable(
  table: string,
  migration: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // A HEAD request (head: true) would be cheaper, but PostgREST answers it with
  // a bodiless 404 for an unknown relation — supabase-js then has nothing to
  // parse and reports success, so a missing table would look like an empty one.
  // A normal GET returns the PGRST205 payload we need.
  const { error } = await db().from(table).select("*").limit(1);
  if (!error) return { ok: true };

  // PostgREST reports an unknown relation as PGRST205, or 42P01 from Postgres.
  const code = (error as { code?: string }).code;
  if (code === "PGRST205" || code === "42P01" || /schema cache|does not exist/i.test(error.message)) {
    return {
      ok: false,
      error: `This page needs the "${table}" table, which doesn't exist yet. Run supabase/migrations/${migration} in the Supabase SQL editor.`,
    };
  }
  return { ok: false, error: error.message };
});

export type GatedResult<T> =
  | { ok: true; data: T }
  | { ok: false; missing: string[]; error?: string };

/**
 * Runs a page's guards and its data load in one round-trip instead of three.
 *
 * The two guards (base schema reachable, this page's table exists) are
 * independent of each other and of the page's own queries, but every page
 * awaited them in sequence — three serial Supabase round-trips before anything
 * rendered. On a remote Supabase that was ~85ms each and dominated page time.
 *
 * Firing them together costs at most two wasted queries on the failure paths,
 * which only happen while the project is still being set up. `allSettled`
 * keeps the old semantics exactly: a guard failure still wins over a load
 * failure, and a genuine load rejection still propagates once the guards pass.
 */
export async function gatedLoad<T>(
  probe: { table: string; migration: string } | null,
  load: () => Promise<T>,
): Promise<GatedResult<T>> {
  const missing = missingConfig();
  // Without credentials `db()` throws, so nothing may be dispatched here.
  if (missing.length) return { ok: false, missing };

  const [schema, table, loaded] = await Promise.allSettled([
    probeSchema(),
    probe ? requireTable(probe.table, probe.migration) : Promise.resolve(null),
    load(),
  ]);

  if (schema.status === "rejected") throw schema.reason;
  if (!schema.value.ready) {
    return { ok: false, missing: schema.value.missing, error: schema.value.error };
  }

  if (table.status === "rejected") throw table.reason;
  if (table.value && !table.value.ok) return { ok: false, missing: [], error: table.value.error };

  if (loaded.status === "rejected") throw loaded.reason;
  return { ok: true, data: loaded.value };
}

export async function funnel() {
  const { data } = await db().from("villa_funnel").select("*").single();
  return (
    data ?? {
      conversations: 0,
      leads: 0,
      qualified_leads: 0,
      hot_leads: 0,
      warm_leads: 0,
      cold_leads: 0,
      site_visits_requested: 0,
      site_visits_completed: 0,
      handoffs: 0,
    }
  );
}

/**
 * The subset of `villa_leads` the list views actually render.
 *
 * `villa_leads` has ~47 columns including free-text notes and JSON blobs; the
 * lead tables show eleven of them. Selecting the rest was ~4x the payload for
 * no rendered pixel. The detail page still reads the whole row via `leadById`.
 */
export type LeadRow = Pick<
  Lead,
  | "id"
  | "name"
  | "phone"
  | "lead_temperature"
  | "lead_score"
  | "budget_min_inr"
  | "budget_max_inr"
  | "purchase_timeline"
  | "source"
  | "campaign"
  | "last_contact_at"
>;

const LEAD_ROW_COLUMNS =
  "id, name, phone, lead_temperature, lead_score, budget_min_inr, budget_max_inr, purchase_timeline, source, campaign, last_contact_at";

export async function recentLeads(limit = 50): Promise<LeadRow[]> {
  const { data } = await db()
    .from("villa_leads")
    .select(LEAD_ROW_COLUMNS)
    .order("last_contact_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as LeadRow[];
}

export async function leadById(id: string): Promise<Lead | null> {
  const { data } = await db().from("villa_leads").select("*").eq("id", id).maybeSingle();
  return (data as Lead) ?? null;
}

export async function messagesForLead(leadId: string): Promise<Message[]> {
  const { data } = await db()
    .from("villa_messages")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(200);
  return (data ?? []) as Message[];
}

export async function recentConversations(limit = 50) {
  const { data } = await db()
    .from("villa_conversations")
    .select("*, villa_leads(id, name, phone, lead_temperature, lead_score)")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<
    Conversation & {
      villa_leads: Pick<Lead, "id" | "name" | "phone" | "lead_temperature" | "lead_score"> | null;
    }
  >;
}

export async function objectionSummary() {
  const { data } = await db().from("villa_objection_summary").select("*");
  return (data ?? []) as Array<{ category: string; total: number; pct: number }>;
}

export async function unansweredQuestions(limit = 50) {
  const { data } = await db()
    .from("villa_questions")
    .select("*")
    .eq("unanswered", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<{
    id: string;
    topic: string;
    verbatim: string | null;
    created_at: string;
  }>;
}

export async function sourceSummary() {
  const { data } = await db().from("villa_source_summary").select("*");
  return (data ?? []) as Array<{
    source: string;
    campaign: string | null;
    leads: number;
    hot: number;
    qualified: number;
    avg_score: number | null;
  }>;
}

export async function pendingHandoffs(limit = 20) {
  const { data } = await db()
    .from("villa_handoffs")
    .select("*, villa_leads(name, phone)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<{
    id: string;
    reason: string;
    payload: string;
    notified: boolean;
    created_at: string;
    villa_leads: { name: string | null; phone: string } | null;
  }>;
}

export async function upcomingSiteVisits(limit = 20) {
  const { data } = await db()
    .from("villa_site_visits")
    .select("*, villa_leads(name, phone)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<{
    id: string;
    preferred_date: string | null;
    preferred_time: string | null;
    visit_type: string;
    status: string;
    visitor_count: number | null;
    villa_leads: { name: string | null; phone: string } | null;
  }>;
}

export interface ContentDraft {
  id: string;
  project_id: string | null;
  villa_type_id: string | null;
  format: string;
  tone: string;
  language: string;
  headline: string;
  primary_text: string;
  secondary_text: string | null;
  hashtags: string[];
  call_to_action: string | null;
  cta_button_text: string | null;
  visual_prompt: string | null;
  target_platforms: string[];
  generated_by_ai: boolean;
  status: string;
  created_at: string;
}

export async function projectsWithTypes(): Promise<{ projects: Project[]; villaTypes: VillaType[] }> {
  const [projects, villaTypes] = await Promise.all([
    db().from("villa_projects").select("*").eq("is_active", true).order("name"),
    db().from("villa_types").select("*").eq("is_active", true).order("name"),
  ]);
  return {
    projects: (projects.data ?? []) as Project[],
    villaTypes: (villaTypes.data ?? []) as VillaType[],
  };
}

export async function contentDrafts(limit = 30): Promise<ContentDraft[]> {
  const { data } = await db()
    .from("villa_content_drafts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ContentDraft[];
}
