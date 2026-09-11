import { db } from "./supabase";
import { isPipelineStage, moveLeadStage, STAGE_LABELS } from "./kanban";
import { createNotification, isSeverity, type InsightSeverity } from "./notifications";
import { pickAssignee } from "./routing";
import type { Lead } from "./types";

/**
 * The automations engine — villa_automations / villa_automation_runs (0009).
 *
 * A rule is trigger + conditions + actions, all stored as JSON so the set of
 * rules is data rather than code. Evaluation happens server-side on the same
 * request that produced the trigger, which keeps it honest: a rule can only
 * ever act on the lead row as it actually is.
 */

// -----------------------------------------------------------------------------
// Shapes
// -----------------------------------------------------------------------------

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "contains";

export interface AutomationCondition {
  field: string;
  operator: ConditionOperator;
  value: string | number | boolean | null;
}

export type ActionType =
  | "notify"
  | "create_task"
  | "send_message"
  | "assign_lead"
  | "change_status"
  | "generate_ai_followup";

export interface AutomationAction {
  type: ActionType;
  config: Record<string, unknown>;
}

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_event: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  lead_id: string | null;
  ok: boolean;
  detail: string | null;
  created_at: string;
}

/** villa_leads gained `assigned_to` in 0009; the shared Lead type predates it. */
type LeadRow = Lead & { assigned_to?: string | null };

// -----------------------------------------------------------------------------
// Vocabulary the UI offers
// -----------------------------------------------------------------------------

export const TRIGGER_EVENTS = [
  "lead_created",
  "lead_status_changed",
  "site_visit_scheduled",
  "handoff_requested",
  "booking_created",
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/**
 * Triggers something in this codebase actually fires today (see
 * src/lib/conversation.ts). The others are accepted so rules can be written
 * ahead of the dispatcher that will fire them, but the UI labels them as
 * dormant rather than letting an operator believe a rule is live when the
 * event is never raised.
 */
export const LIVE_TRIGGERS = new Set<string>(["lead_created", "lead_status_changed"]);

export const TRIGGER_LABELS: Record<string, string> = {
  lead_created: "Lead created",
  lead_status_changed: "Lead replied / rescored",
  site_visit_scheduled: "Site visit scheduled",
  handoff_requested: "Handoff requested",
  booking_created: "Booking created",
};

export type FieldKind = "number" | "text" | "boolean";

/**
 * Only top-level villa_leads columns. Conditions deliberately do not support
 * dotted paths — a rule that reaches into a joined row would silently stop
 * matching the moment the join isn't loaded.
 */
export const CONDITION_FIELDS: Array<{ field: string; label: string; kind: FieldKind }> = [
  { field: "lead_score", label: "Lead score", kind: "number" },
  { field: "lead_temperature", label: "Temperature", kind: "text" },
  { field: "pipeline_stage", label: "Pipeline stage", kind: "text" },
  { field: "purchase_timeline", label: "Purchase timeline", kind: "text" },
  { field: "buyer_purpose", label: "Buyer purpose", kind: "text" },
  { field: "budget_min_inr", label: "Budget min (₹)", kind: "number" },
  { field: "budget_max_inr", label: "Budget max (₹)", kind: "number" },
  { field: "bedrooms", label: "Bedrooms", kind: "number" },
  { field: "financing_preference", label: "Financing", kind: "text" },
  { field: "source", label: "Source", kind: "text" },
  { field: "campaign", label: "Campaign", kind: "text" },
  { field: "city", label: "City", kind: "text" },
  { field: "country", label: "Country", kind: "text" },
  { field: "preferred_language", label: "Preferred language", kind: "text" },
  { field: "is_nri", label: "Is NRI", kind: "boolean" },
  { field: "handoff_status", label: "Handoff status", kind: "text" },
  { field: "requirements_notes", label: "Requirements notes", kind: "text" },
  { field: "project_interest", label: "Project interest", kind: "text" },
  { field: "villa_type_interest", label: "Villa type interest", kind: "text" },
];

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "is",
  not_equals: "is not",
  greater_than: "is greater than",
  less_than: "is less than",
  contains: "contains",
};

export const ACTION_TYPES: ActionType[] = [
  "notify",
  "create_task",
  "assign_lead",
  "change_status",
  "send_message",
  "generate_ai_followup",
];

export const ACTION_LABELS: Record<ActionType, string> = {
  notify: "Create a notification",
  create_task: "Create a task",
  assign_lead: "Assign to a rep (round-robin)",
  change_status: "Change pipeline stage",
  send_message: "Queue a follow-up message",
  generate_ai_followup: "Queue an AI-written follow-up",
};

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export function isConditionOperator(v: unknown): v is ConditionOperator {
  return (
    v === "equals" ||
    v === "not_equals" ||
    v === "greater_than" ||
    v === "less_than" ||
    v === "contains"
  );
}

export function isActionType(v: unknown): v is ActionType {
  return (
    v === "notify" ||
    v === "create_task" ||
    v === "send_message" ||
    v === "assign_lead" ||
    v === "change_status" ||
    v === "generate_ai_followup"
  );
}

export function isTriggerEvent(v: unknown): v is TriggerEvent {
  return typeof v === "string" && (TRIGGER_EVENTS as readonly string[]).includes(v);
}

function fieldKind(field: string): FieldKind {
  return CONDITION_FIELDS.find((f) => f.field === field)?.kind ?? "text";
}

// -----------------------------------------------------------------------------
// Condition evaluation
// -----------------------------------------------------------------------------

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(" ");
  return String(value).trim().toLowerCase();
}

export function evaluateCondition(lead: LeadRow, condition: AutomationCondition): boolean {
  const actual = (lead as unknown as Record<string, unknown>)[condition.field];
  const expected = condition.value;

  switch (condition.operator) {
    case "equals":
    case "not_equals": {
      const a = toNumber(actual);
      const b = toNumber(expected);
      // Numeric comparison when both sides are numeric, so "50" == 50 rather
      // than failing on a string/number mismatch coming out of a form post.
      const same = a !== null && b !== null ? a === b : toText(actual) === toText(expected);
      return condition.operator === "equals" ? same : !same;
    }
    case "greater_than":
    case "less_than": {
      const a = toNumber(actual);
      const b = toNumber(expected);
      // A non-numeric side means the comparison has no defined answer. Return
      // false rather than coercing, so a typo'd rule stays inert instead of
      // matching every lead.
      if (a === null || b === null) return false;
      return condition.operator === "greater_than" ? a > b : a < b;
    }
    case "contains": {
      const needle = toText(expected);
      if (needle === "") return false;
      if (Array.isArray(actual)) return actual.some((v) => toText(v) === needle);
      return toText(actual).includes(needle);
    }
    default:
      return false;
  }
}

/** All conditions must hold. An empty list matches every lead on the trigger. */
export function evaluateConditions(lead: LeadRow, conditions: AutomationCondition[]): boolean {
  return conditions.every((c) => evaluateCondition(lead, c));
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

function normalise(row: Record<string, unknown>): Automation {
  const conditions = Array.isArray(row.conditions) ? (row.conditions as AutomationCondition[]) : [];
  const actions = Array.isArray(row.actions) ? (row.actions as AutomationAction[]) : [];
  return { ...(row as unknown as Automation), conditions, actions };
}

export async function listAutomations(): Promise<Automation[]> {
  const { data } = await db()
    .from("villa_automations")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => normalise(r as Record<string, unknown>));
}

export async function listAutomationRuns(limit = 25): Promise<
  Array<AutomationRun & { villa_automations: { name: string } | null }>
> {
  const { data } = await db()
    .from("villa_automation_runs")
    .select("*, villa_automations(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<AutomationRun & { villa_automations: { name: string } | null }>;
}

export interface RunDay {
  label: string;
  ok: number;
  failed: number;
}

/**
 * Runs bucketed by day for the activity chart.
 *
 * Days with no runs are emitted as zeroes rather than dropped, so a gap in the
 * chart reads as "nothing fired" instead of compressing the x-axis and making
 * a quiet week look busy.
 */
export async function runsByDay(days = 14): Promise<{ series: RunDay[]; ok: number; failed: number }> {
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  since.setHours(0, 0, 0, 0);

  const { data } = await db()
    .from("villa_automation_runs")
    .select("ok, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true });

  const buckets = new Map<string, RunDay>();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(since.getTime() + i * 86_400_000);
    buckets.set(day.toDateString(), {
      label: day.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      ok: 0,
      failed: 0,
    });
  }

  let ok = 0;
  let failed = 0;
  for (const row of (data ?? []) as Array<{ ok: boolean; created_at: string }>) {
    const bucket = buckets.get(new Date(row.created_at).toDateString());
    if (row.ok) ok += 1;
    else failed += 1;
    if (!bucket) continue;
    if (row.ok) bucket.ok += 1;
    else bucket.failed += 1;
  }

  return { series: [...buckets.values()], ok, failed };
}

/**
 * The `kind` an automation's notifications carry.
 *
 * Mirrors what `executeAction` writes, so the notification centre can map a
 * row back to the rule that produced it without a second column on the table.
 */
export function notificationKindFor(automation: Pick<Automation, "trigger_event">): string {
  return `automation:${automation.trigger_event}`;
}

export interface NotifyingRule {
  automation: Automation;
  /** One entry per notify action — a rule may raise more than one. */
  notices: Array<{ title: string; severity: InsightSeverity }>;
  kind: string;
}

/**
 * Rules that currently write to villa_notifications, derived from their
 * actions rather than from a separate preferences table.
 *
 * The notification centre shows this instead of a toggle list: a toggle that
 * doesn't correspond to a rule would be a decoration, and switching it would
 * change nothing about what actually gets written.
 */
export function notifyingRules(automations: Automation[]): NotifyingRule[] {
  return automations.flatMap((automation) => {
    const notices = automation.actions
      .filter((a) => a.type === "notify")
      .map((a) => ({
        title: str(a.config ?? {}, "title") ?? automation.name,
        severity: isSeverity(a.config?.severity) ? a.config.severity : ("info" as InsightSeverity),
      }));
    if (notices.length === 0) return [];
    return [{ automation, notices, kind: notificationKindFor(automation) }];
  });
}

/** Rules that route leads — trigger `lead_created` with an assign_lead action. */
export function routingRules(automations: Automation[]): Automation[] {
  return automations.filter(
    (a) => a.trigger_event === "lead_created" && a.actions.some((x) => x.type === "assign_lead"),
  );
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

export async function createAutomation(input: {
  name: string;
  description?: string | null;
  triggerEvent: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  isActive?: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.name.trim()) return { ok: false, error: "name is required" };
  if (!isTriggerEvent(input.triggerEvent)) {
    return { ok: false, error: `unknown trigger event: ${input.triggerEvent}` };
  }
  if (input.actions.length === 0) {
    return { ok: false, error: "an automation needs at least one action" };
  }

  const { data, error } = await db()
    .from("villa_automations")
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      trigger_event: input.triggerEvent,
      conditions: input.conditions,
      actions: input.actions,
      is_active: input.isActive ?? false,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

export async function toggleAutomation(
  id: string,
  isActive?: boolean,
): Promise<{ ok: true; isActive: boolean } | { ok: false; error: string }> {
  let next = isActive;

  if (next === undefined) {
    const { data, error } = await db()
      .from("villa_automations")
      .select("is_active")
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "automation not found" };
    next = !(data as { is_active: boolean }).is_active;
  }

  const { error } = await db()
    .from("villa_automations")
    .update({ is_active: next })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, isActive: next };
}

/**
 * Deletes a rule. Its runs go with it (on delete cascade), which is why the UI
 * offers pause as the first-class action and delete as the deliberate one — a
 * paused rule keeps its audit trail.
 */
export async function deleteAutomation(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "id is required" };
  const { error } = await db().from("villa_automations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// -----------------------------------------------------------------------------
// The engine
// -----------------------------------------------------------------------------

/** One action's outcome. `done: false` means the action did not take effect. */
interface ActionOutcome {
  done: boolean;
  line: string;
}

export interface AutomationRunSummary {
  /** Active rules registered against this trigger. */
  considered: number;
  matched: number;
  results: Array<{ automationId: string; name: string; ok: boolean; detail: string }>;
}

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const n = toNumber(config[key]);
  return n === null ? fallback : n;
}

function str(config: Record<string, unknown>, key: string): string | null {
  const v = config[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function flag(config: Record<string, unknown>, key: string): boolean {
  const v = config[key];
  return v === true || v === "true" || v === "on" || v === "1";
}

async function executeAction(
  action: AutomationAction,
  automation: Automation,
  lead: LeadRow,
  triggerEvent: string,
): Promise<ActionOutcome> {
  const config = action.config ?? {};
  const who = lead.name ?? `+${lead.phone}`;

  switch (action.type) {
    case "notify": {
      const severity: InsightSeverity = isSeverity(config.severity) ? config.severity : "info";
      await createNotification({
        kind: `automation:${automation.trigger_event}`,
        title: str(config, "title") ?? automation.name,
        description:
          str(config, "description") ??
          `${automation.name} matched ${who} on ${triggerEvent}.`,
        severity,
        href: str(config, "href") ?? `/inbox/whatsapp/crm/leads/${lead.id}`,
        leadId: lead.id,
      });
      return { done: true, line: `notify: notification created (${severity})` };
    }

    case "create_task": {
      const dueInHours = num(config, "dueInHours", 24);
      const priority = TASK_PRIORITIES.includes(config.priority as (typeof TASK_PRIORITIES)[number])
        ? (config.priority as string)
        : "medium";
      const { error } = await db().from("villa_tasks").insert({
        title: str(config, "title") ?? `${automation.name} — ${who}`,
        description: str(config, "description"),
        lead_id: lead.id,
        assigned_to: lead.assigned_to ?? null,
        priority,
        task_type: str(config, "taskType") ?? "follow_up",
        due_at: new Date(Date.now() + dueInHours * 3_600_000).toISOString(),
      });
      if (error) throw new Error(error.message);
      return { done: true, line: `create_task: task due in ${dueInHours}h (${priority})` };
    }

    case "change_status": {
      const stage = str(config, "stage");
      if (!stage || !isPipelineStage(stage)) {
        return { done: false, line: `change_status: skipped — invalid stage ${stage ?? "(unset)"}` };
      }
      if (lead.pipeline_stage === stage) {
        return { done: true, line: `change_status: already ${STAGE_LABELS[stage]}` };
      }
      const moved = await moveLeadStage(lead.id, stage);
      if (!moved.ok) throw new Error(moved.error);
      return { done: true, line: `change_status: ${lead.pipeline_stage} → ${stage}` };
    }

    case "assign_lead": {
      // A lead already mid-conversation with a rep must not be moved out from
      // under them, so an owned lead is left alone unless the rule opts in.
      if (lead.assigned_to && !flag(config, "reassign")) {
        return { done: true, line: "assign_lead: left with its existing owner" };
      }

      // Expertise / language matching is expressed here rather than in a
      // second routing engine: /automation/routing writes exactly these rules.
      const language = flag(config, "matchLeadLanguage")
        ? lead.preferred_language
        : str(config, "language");

      const picked = await pickAssignee({
        language,
        department: str(config, "department"),
        memberId: str(config, "memberId"),
      });
      if (!picked.ok) return { done: false, line: `assign_lead: skipped — ${picked.reason}` };

      const member = picked.member;
      if (lead.assigned_to === member.id) {
        return { done: true, line: `assign_lead: already with ${member.name}` };
      }

      const { error } = await db()
        .from("villa_leads")
        .update({ assigned_to: member.id })
        .eq("id", lead.id);
      if (error) throw new Error(error.message);
      return {
        done: true,
        line: `assign_lead: assigned to ${member.name} (${member.open_leads} open lead${member.open_leads === 1 ? "" : "s"} before this)`,
      };
    }

    case "send_message":
    case "generate_ai_followup": {
      // Deliberately queues rather than sends. Once the 24h customer-service
      // window has closed, WhatsApp only accepts a pre-approved template — an
      // automation firing hours after the last inbound message cannot know
      // which side of that line it lands on. The follow-up dispatcher decides
      // template vs. free text at send time, when the window is knowable.
      const ai = action.type === "generate_ai_followup";
      const delayHours = num(config, "delayHours", 24);
      const scheduledAt = new Date(Date.now() + delayHours * 3_600_000).toISOString();
      const { error } = await db().from("villa_follow_ups").insert({
        lead_id: lead.id,
        assigned_to: lead.assigned_to ?? null,
        scheduled_at: scheduledAt,
        channel: str(config, "channel") ?? "whatsapp",
        // AI copy is written by the dispatcher against the conversation as it
        // stands then, so nothing is drafted (or invented) here.
        message: ai ? null : str(config, "message"),
        template_name: str(config, "templateName"),
        notes: `Queued by automation "${automation.name}" on ${triggerEvent}.`,
        ai_generated: ai,
      });
      if (error) throw new Error(error.message);
      return {
        done: true,
        line: `${action.type}: follow-up queued for +${delayHours}h`,
      };
    }

    default:
      return { done: false, line: `unknown action type: ${String(action.type)}` };
  }
}

/**
 * Evaluates every active rule for `triggerEvent` against `lead` and executes
 * the ones that match.
 *
 * One failing action never stops the others — each is caught individually and
 * its error recorded on the run row, because a rule that half-worked is far
 * easier to debug than one that silently stopped at step two.
 */
export async function runAutomations(
  triggerEvent: string,
  lead: LeadRow,
): Promise<AutomationRunSummary> {
  const { data, error } = await db()
    .from("villa_automations")
    .select("*")
    .eq("is_active", true)
    .eq("trigger_event", triggerEvent);

  if (error) throw new Error(`Could not load automations: ${error.message}`);

  const automations = (data ?? []).map((r) => normalise(r as Record<string, unknown>));
  const summary: AutomationRunSummary = {
    considered: automations.length,
    matched: 0,
    results: [],
  };

  for (const automation of automations) {
    if (!evaluateConditions(lead, automation.conditions)) continue;
    summary.matched += 1;

    const lines: string[] = [];
    let ok = true;

    for (const action of automation.actions) {
      try {
        const outcome = await executeAction(action, automation, lead, triggerEvent);
        lines.push(outcome.line);
        if (!outcome.done) ok = false;
      } catch (e) {
        ok = false;
        lines.push(`${action.type}: failed — ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (automation.actions.length === 0) {
      ok = false;
      lines.push("matched but has no actions configured");
    }

    const detail = lines.join("\n");

    await db().from("villa_automation_runs").insert({
      automation_id: automation.id,
      lead_id: lead.id,
      ok,
      detail,
    });

    await db()
      .from("villa_automations")
      .update({
        execution_count: automation.execution_count + 1,
        last_executed_at: new Date().toISOString(),
      })
      .eq("id", automation.id);

    summary.results.push({ automationId: automation.id, name: automation.name, ok, detail });
  }

  return summary;
}

// -----------------------------------------------------------------------------
// Human-readable summaries, shared by the list page
// -----------------------------------------------------------------------------

export function describeCondition(c: AutomationCondition): string {
  const label = CONDITION_FIELDS.find((f) => f.field === c.field)?.label ?? c.field;
  const value = c.value === null || c.value === undefined ? "—" : String(c.value);
  const shown = fieldKind(c.field) === "number" ? value : `"${value}"`;
  return `${label} ${OPERATOR_LABELS[c.operator] ?? c.operator} ${shown}`;
}

export function describeAction(a: AutomationAction): string {
  const label = ACTION_LABELS[a.type] ?? a.type;
  const config = a.config ?? {};

  switch (a.type) {
    case "change_status": {
      const stage = str(config, "stage");
      return stage && isPipelineStage(stage) ? `${label}: ${STAGE_LABELS[stage]}` : label;
    }
    case "create_task":
      return `${label}: "${str(config, "title") ?? "untitled"}", due in ${num(config, "dueInHours", 24)}h`;
    case "notify":
      return `${label}: "${str(config, "title") ?? "untitled"}"`;
    case "send_message":
    case "generate_ai_followup":
      return `${label}: +${num(config, "delayHours", 24)}h`;
    case "assign_lead": {
      const parts: string[] = [];
      if (flag(config, "matchLeadLanguage")) parts.push("matching the lead's language");
      else if (str(config, "language")) parts.push(`speaking ${str(config, "language")}`);
      if (str(config, "department")) parts.push(`in ${str(config, "department")}`);
      if (flag(config, "reassign")) parts.push("reassigning owned leads");
      return parts.length === 0 ? label : `${label}, ${parts.join(", ")}`;
    }
    default:
      return label;
  }
}
