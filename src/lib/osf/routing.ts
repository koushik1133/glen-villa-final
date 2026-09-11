import { db } from "./supabase";
import { logActivity } from "./activities";

/**
 * Lead routing — who is eligible for a lead, how loaded they are, and the one
 * round-robin picker in the codebase.
 *
 * Both the manual rebalance on /automation/routing and the engine's
 * `assign_lead` action come through `pickAssignee`, so "who gets the next
 * lead" has exactly one answer no matter which surface asked.
 *
 * Eligibility is `is_active AND accepts_leads`, deliberately not a role
 * whitelist: `accepts_leads` is the column the schema provides for precisely
 * this decision, while `villa_user_role` describes seniority. Filtering on
 * role as well would silently exclude `property_consultant` — the schema
 * default, and the role most reps will actually hold.
 */

/** A lead in one of these stages no longer occupies a rep's attention. */
const CLOSED_STAGES = new Set(["booked", "lost"]);

/** PostgREST caps an unbounded select, so load is read in explicit pages. */
const PAGE_SIZE = 1000;

/** Ceiling on one load pass. Beyond this the numbers are marked as sampled. */
const MAX_LOAD_ROWS = 20000;

/** One rebalance pass is bounded so a large backlog can't time out a request. */
const REBALANCE_BATCH = 500;

export interface RoutingRep {
  id: string;
  name: string;
  role: string;
  department: string;
  languages: string[];
  quota_inr: number | null;
  accepts_leads: boolean;
  /** Leads owned by this rep that are neither booked nor lost. */
  open_leads: number;
  hot_open_leads: number;
  /** Every lead ever assigned, closed ones included. */
  total_leads: number;
}

export interface RoutingState {
  /** Active and accepting leads, ordered by name so ties resolve predictably. */
  eligible: RoutingRep[];
  /** Active but opted out of the rota — shown so an empty rota is explicable. */
  standby: RoutingRep[];
  /** Open leads with no owner. These are what a rebalance deals out. */
  unassignedOpen: number;
  /** Open leads that do have an owner. */
  assignedOpen: number;
  /** True when the load pass hit MAX_LOAD_ROWS and the counts are a floor. */
  sampled: boolean;
}

interface MemberRow {
  id: string;
  name: string;
  role: string;
  department: string;
  languages: string[] | null;
  quota_inr: number | string | null;
  is_active: boolean;
  accepts_leads: boolean;
}

interface LoadRow {
  assigned_to: string | null;
  pipeline_stage: string;
  lead_temperature: string;
}

/**
 * Every assigned lead's stage and temperature, read in pages.
 *
 * A plain `.select()` is capped by PostgREST (1000 rows by default), and a
 * silently truncated read here would understate a busy rep's load and then
 * hand them even more leads. Paging keeps the count exact up to the ceiling.
 */
async function loadRows(): Promise<{ rows: LoadRow[]; sampled: boolean }> {
  const rows: LoadRow[] = [];

  for (let from = 0; from < MAX_LOAD_ROWS; from += PAGE_SIZE) {
    const { data, error } = await db()
      .from("villa_leads")
      .select("assigned_to, pipeline_stage, lead_temperature")
      .not("assigned_to", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const batch = (data ?? []) as LoadRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, sampled: false };
  }

  return { rows, sampled: true };
}

function toQuota(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function routingState(): Promise<RoutingState> {
  const [membersResult, load, unassigned] = await Promise.all([
    db()
      .from("villa_team_members")
      .select("id, name, role, department, languages, quota_inr, is_active, accepts_leads")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    loadRows(),
    db()
      .from("villa_leads")
      .select("id", { count: "exact", head: true })
      .is("assigned_to", null)
      .not("pipeline_stage", "in", "(booked,lost)"),
  ]);

  const members = (membersResult.data ?? []) as MemberRow[];

  const open = new Map<string, number>();
  const hot = new Map<string, number>();
  const total = new Map<string, number>();
  let assignedOpen = 0;

  for (const row of load.rows) {
    const owner = row.assigned_to;
    if (!owner) continue;
    total.set(owner, (total.get(owner) ?? 0) + 1);
    if (CLOSED_STAGES.has(row.pipeline_stage)) continue;
    assignedOpen += 1;
    open.set(owner, (open.get(owner) ?? 0) + 1);
    if (row.lead_temperature === "hot") hot.set(owner, (hot.get(owner) ?? 0) + 1);
  }

  const reps: RoutingRep[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    department: m.department,
    languages: m.languages ?? [],
    quota_inr: toQuota(m.quota_inr),
    accepts_leads: m.accepts_leads,
    open_leads: open.get(m.id) ?? 0,
    hot_open_leads: hot.get(m.id) ?? 0,
    total_leads: total.get(m.id) ?? 0,
  }));

  return {
    eligible: reps.filter((r) => r.accepts_leads),
    standby: reps.filter((r) => !r.accepts_leads),
    unassignedOpen: unassigned.count ?? 0,
    assignedOpen,
    sampled: load.sampled,
  };
}

// -----------------------------------------------------------------------------
// The picker
// -----------------------------------------------------------------------------

export interface AssigneeFilters {
  /** Rep must list this language. Case-insensitive; blank means no filter. */
  language?: string | null;
  /** Rep must sit in this department. */
  department?: string | null;
  /** Pin to one rep. Still checked for eligibility rather than trusted. */
  memberId?: string | null;
}

export type PickResult =
  | { ok: true; member: RoutingRep }
  | { ok: false; reason: string };

function speaks(rep: RoutingRep, language: string): boolean {
  const wanted = language.trim().toLowerCase();
  return rep.languages.some((l) => l.trim().toLowerCase() === wanted);
}

/**
 * The least-loaded eligible rep matching the filters.
 *
 * Balanced on *open* leads rather than lifetime volume: a rep who closed fifty
 * deals has capacity again, so counting everything they ever touched would
 * starve the best closer. Ties resolve to the first rep alphabetically because
 * the roster is ordered by name — a stable answer beats a random one when the
 * same rule fires twice in a second.
 */
export async function pickAssignee(filters: AssigneeFilters = {}): Promise<PickResult> {
  const state = await routingState();

  if (state.eligible.length === 0) {
    return {
      ok: false,
      reason:
        state.standby.length > 0
          ? "no active team member has “accepts leads” switched on"
          : "no active rows in villa_team_members",
    };
  }

  let pool = state.eligible;

  if (filters.memberId) {
    const pinned = pool.find((r) => r.id === filters.memberId);
    if (!pinned) return { ok: false, reason: "the pinned rep is inactive or not accepting leads" };
    return { ok: true, member: pinned };
  }

  const department = filters.department?.trim();
  if (department) {
    pool = pool.filter((r) => r.department.toLowerCase() === department.toLowerCase());
    if (pool.length === 0) {
      return { ok: false, reason: `no rep accepting leads sits in ${department}` };
    }
  }

  const language = filters.language?.trim();
  if (language) {
    const matched = pool.filter((r) => speaks(r, language));
    // Falling back to the whole pool would quietly break the promise the rule
    // makes, so an unmatched language is a skip with a reason on the run log.
    if (matched.length === 0) {
      return { ok: false, reason: `no rep accepting leads lists ${language}` };
    }
    pool = matched;
  }

  const member = pool.reduce((best, r) => (r.open_leads < best.open_leads ? r : best));
  return { ok: true, member };
}

// -----------------------------------------------------------------------------
// Manual rebalance
// -----------------------------------------------------------------------------

export interface RebalanceAllocation {
  id: string;
  name: string;
  added: number;
  /** Projected open-lead count once this pass lands. */
  openLeads: number;
}

export interface RebalanceResult {
  assigned: number;
  /** Unassigned open leads still waiting after this pass. */
  remaining: number;
  perRep: RebalanceAllocation[];
  /** Reps whose bulk update failed. Empty on a clean run. */
  failures: string[];
}

/**
 * Deals every unassigned open lead across the eligible reps.
 *
 * Dealing starts from each rep's *current* load rather than from zero, so a
 * rebalance levels the board instead of adding the same number of new leads on
 * top of wildly different existing books.
 *
 * Deliberately load-only: no language or expertise matching happens here.
 * That belongs in a `lead_created` rule on /automation/workflows, which runs
 * per lead at the moment it arrives and can see the lead's own attributes.
 */
export async function rebalanceUnassigned(): Promise<
  { ok: true; result: RebalanceResult } | { ok: false; error: string }
> {
  const state = await routingState();

  if (state.eligible.length === 0) {
    return {
      ok: false,
      error:
        "No active team member is accepting leads. Switch on “accepts leads” for at least one rep first.",
    };
  }

  const { data, error } = await db()
    .from("villa_leads")
    .select("id")
    .is("assigned_to", null)
    .not("pipeline_stage", "in", "(booked,lost)")
    .order("created_at", { ascending: true })
    .limit(REBALANCE_BATCH);

  if (error) return { ok: false, error: error.message };

  const queue = (data ?? []) as Array<{ id: string }>;
  if (queue.length === 0) {
    return { ok: true, result: { assigned: 0, remaining: 0, perRep: [], failures: [] } };
  }

  const load = new Map(state.eligible.map((r) => [r.id, r.open_leads]));
  const buckets = new Map(state.eligible.map((r) => [r.id, [] as string[]]));

  for (const lead of queue) {
    const target = state.eligible.reduce((best, r) =>
      (load.get(r.id) ?? 0) < (load.get(best.id) ?? 0) ? r : best,
    );
    load.set(target.id, (load.get(target.id) ?? 0) + 1);
    buckets.get(target.id)?.push(lead.id);
  }

  let assigned = 0;
  const perRep: RebalanceAllocation[] = [];
  const failures: string[] = [];

  // One update per rep rather than per lead: the whole point of a rebalance is
  // that it is a single deliberate action, not 500 round-trips.
  for (const rep of state.eligible) {
    const ids = buckets.get(rep.id) ?? [];
    if (ids.length === 0) continue;

    const { error: updateError } = await db()
      .from("villa_leads")
      .update({ assigned_to: rep.id })
      .in("id", ids);

    if (updateError) {
      failures.push(`${rep.name}: ${updateError.message}`);
      continue;
    }

    assigned += ids.length;
    perRep.push({ id: rep.id, name: rep.name, added: ids.length, openLeads: load.get(rep.id) ?? 0 });
  }

  if (assigned === 0 && failures.length > 0) return { ok: false, error: failures.join("; ") };

  // One summary row, not one per lead — a rebalance is a single decision and
  // 500 near-identical feed entries would bury everything else on /activity.
  await logActivity({
    type: "lead_assigned",
    actorName: "Routing",
    description: `Rebalanced ${assigned} unassigned lead${assigned === 1 ? "" : "s"} across ${perRep.length} rep${perRep.length === 1 ? "" : "s"}.`,
    metadata: {
      assigned,
      perRep: perRep.map((r) => ({ name: r.name, added: r.added })),
    },
  });

  return {
    ok: true,
    result: {
      assigned,
      remaining: Math.max(0, state.unassignedOpen - assigned),
      perRep,
      failures,
    },
  };
}

/** Distinct languages across the active roster, for the routing rule form. */
export function rosterLanguages(state: RoutingState): string[] {
  const seen = new Set<string>();
  for (const rep of [...state.eligible, ...state.standby]) {
    for (const language of rep.languages) {
      const trimmed = language.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
