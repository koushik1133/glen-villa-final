"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_PRIORITIES = exports.ACTION_LABELS = exports.ACTION_TYPES = exports.OPERATOR_LABELS = exports.CONDITION_FIELDS = exports.TRIGGER_LABELS = exports.LIVE_TRIGGERS = exports.TRIGGER_EVENTS = void 0;
exports.isConditionOperator = isConditionOperator;
exports.isActionType = isActionType;
exports.isTriggerEvent = isTriggerEvent;
exports.evaluateCondition = evaluateCondition;
exports.evaluateConditions = evaluateConditions;
exports.listAutomations = listAutomations;
exports.listAutomationRuns = listAutomationRuns;
exports.runsByDay = runsByDay;
exports.notificationKindFor = notificationKindFor;
exports.notifyingRules = notifyingRules;
exports.routingRules = routingRules;
exports.createAutomation = createAutomation;
exports.toggleAutomation = toggleAutomation;
exports.deleteAutomation = deleteAutomation;
exports.runAutomations = runAutomations;
exports.describeCondition = describeCondition;
exports.describeAction = describeAction;
const supabase_1 = require("./supabase");
const kanban_1 = require("./kanban");
const notifications_1 = require("./notifications");
const routing_1 = require("./routing");
// -----------------------------------------------------------------------------
// Vocabulary the UI offers
// -----------------------------------------------------------------------------
exports.TRIGGER_EVENTS = [
    "lead_created",
    "lead_status_changed",
    "site_visit_scheduled",
    "handoff_requested",
    "booking_created",
];
/**
 * Triggers something in this codebase actually fires today (see
 * src/lib/conversation.ts). The others are accepted so rules can be written
 * ahead of the dispatcher that will fire them, but the UI labels them as
 * dormant rather than letting an operator believe a rule is live when the
 * event is never raised.
 */
exports.LIVE_TRIGGERS = new Set(["lead_created", "lead_status_changed"]);
exports.TRIGGER_LABELS = {
    lead_created: "Lead created",
    lead_status_changed: "Lead replied / rescored",
    site_visit_scheduled: "Site visit scheduled",
    handoff_requested: "Handoff requested",
    booking_created: "Booking created",
};
/**
 * Only top-level villa_leads columns. Conditions deliberately do not support
 * dotted paths — a rule that reaches into a joined row would silently stop
 * matching the moment the join isn't loaded.
 */
exports.CONDITION_FIELDS = [
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
exports.OPERATOR_LABELS = {
    equals: "is",
    not_equals: "is not",
    greater_than: "is greater than",
    less_than: "is less than",
    contains: "contains",
};
exports.ACTION_TYPES = [
    "notify",
    "create_task",
    "assign_lead",
    "change_status",
    "send_message",
    "generate_ai_followup",
];
exports.ACTION_LABELS = {
    notify: "Create a notification",
    create_task: "Create a task",
    assign_lead: "Assign to a rep (round-robin)",
    change_status: "Change pipeline stage",
    send_message: "Queue a follow-up message",
    generate_ai_followup: "Queue an AI-written follow-up",
};
exports.TASK_PRIORITIES = ["low", "medium", "high", "urgent"];
function isConditionOperator(v) {
    return (v === "equals" ||
        v === "not_equals" ||
        v === "greater_than" ||
        v === "less_than" ||
        v === "contains");
}
function isActionType(v) {
    return (v === "notify" ||
        v === "create_task" ||
        v === "send_message" ||
        v === "assign_lead" ||
        v === "change_status" ||
        v === "generate_ai_followup");
}
function isTriggerEvent(v) {
    return typeof v === "string" && exports.TRIGGER_EVENTS.includes(v);
}
function fieldKind(field) {
    return exports.CONDITION_FIELDS.find((f) => f.field === field)?.kind ?? "text";
}
// -----------------------------------------------------------------------------
// Condition evaluation
// -----------------------------------------------------------------------------
function toNumber(value) {
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n))
            return n;
    }
    return null;
}
function toText(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (Array.isArray(value))
        return value.join(" ");
    return String(value).trim().toLowerCase();
}
function evaluateCondition(lead, condition) {
    const actual = lead[condition.field];
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
            if (a === null || b === null)
                return false;
            return condition.operator === "greater_than" ? a > b : a < b;
        }
        case "contains": {
            const needle = toText(expected);
            if (needle === "")
                return false;
            if (Array.isArray(actual))
                return actual.some((v) => toText(v) === needle);
            return toText(actual).includes(needle);
        }
        default:
            return false;
    }
}
/** All conditions must hold. An empty list matches every lead on the trigger. */
function evaluateConditions(lead, conditions) {
    return conditions.every((c) => evaluateCondition(lead, c));
}
// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
function normalise(row) {
    const conditions = Array.isArray(row.conditions) ? row.conditions : [];
    const actions = Array.isArray(row.actions) ? row.actions : [];
    return { ...row, conditions, actions };
}
async function listAutomations() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_automations")
        .select("*")
        .order("created_at", { ascending: false });
    return (data ?? []).map((r) => normalise(r));
}
async function listAutomationRuns(limit = 25) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_automation_runs")
        .select("*, villa_automations(name)")
        .order("created_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
/**
 * Runs bucketed by day for the activity chart.
 *
 * Days with no runs are emitted as zeroes rather than dropped, so a gap in the
 * chart reads as "nothing fired" instead of compressing the x-axis and making
 * a quiet week look busy.
 */
async function runsByDay(days = 14) {
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setHours(0, 0, 0, 0);
    const { data } = await (0, supabase_1.db)()
        .from("villa_automation_runs")
        .select("ok, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true });
    const buckets = new Map();
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
    for (const row of (data ?? [])) {
        const bucket = buckets.get(new Date(row.created_at).toDateString());
        if (row.ok)
            ok += 1;
        else
            failed += 1;
        if (!bucket)
            continue;
        if (row.ok)
            bucket.ok += 1;
        else
            bucket.failed += 1;
    }
    return { series: [...buckets.values()], ok, failed };
}
/**
 * The `kind` an automation's notifications carry.
 *
 * Mirrors what `executeAction` writes, so the notification centre can map a
 * row back to the rule that produced it without a second column on the table.
 */
function notificationKindFor(automation) {
    return `automation:${automation.trigger_event}`;
}
/**
 * Rules that currently write to villa_notifications, derived from their
 * actions rather than from a separate preferences table.
 *
 * The notification centre shows this instead of a toggle list: a toggle that
 * doesn't correspond to a rule would be a decoration, and switching it would
 * change nothing about what actually gets written.
 */
function notifyingRules(automations) {
    return automations.flatMap((automation) => {
        const notices = automation.actions
            .filter((a) => a.type === "notify")
            .map((a) => ({
            title: str(a.config ?? {}, "title") ?? automation.name,
            severity: (0, notifications_1.isSeverity)(a.config?.severity) ? a.config.severity : "info",
        }));
        if (notices.length === 0)
            return [];
        return [{ automation, notices, kind: notificationKindFor(automation) }];
    });
}
/** Rules that route leads — trigger `lead_created` with an assign_lead action. */
function routingRules(automations) {
    return automations.filter((a) => a.trigger_event === "lead_created" && a.actions.some((x) => x.type === "assign_lead"));
}
// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------
async function createAutomation(input) {
    if (!input.name.trim())
        return { ok: false, error: "name is required" };
    if (!isTriggerEvent(input.triggerEvent)) {
        return { ok: false, error: `unknown trigger event: ${input.triggerEvent}` };
    }
    if (input.actions.length === 0) {
        return { ok: false, error: "an automation needs at least one action" };
    }
    const { data, error } = await (0, supabase_1.db)()
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
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id: data.id };
}
async function toggleAutomation(id, isActive) {
    let next = isActive;
    if (next === undefined) {
        const { data, error } = await (0, supabase_1.db)()
            .from("villa_automations")
            .select("is_active")
            .eq("id", id)
            .maybeSingle();
        if (error)
            return { ok: false, error: error.message };
        if (!data)
            return { ok: false, error: "automation not found" };
        next = !data.is_active;
    }
    const { error } = await (0, supabase_1.db)()
        .from("villa_automations")
        .update({ is_active: next })
        .eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, isActive: next };
}
/**
 * Deletes a rule. Its runs go with it (on delete cascade), which is why the UI
 * offers pause as the first-class action and delete as the deliberate one — a
 * paused rule keeps its audit trail.
 */
async function deleteAutomation(id) {
    if (!id)
        return { ok: false, error: "id is required" };
    const { error } = await (0, supabase_1.db)().from("villa_automations").delete().eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
function num(config, key, fallback) {
    const n = toNumber(config[key]);
    return n === null ? fallback : n;
}
function str(config, key) {
    const v = config[key];
    if (typeof v !== "string")
        return null;
    const t = v.trim();
    return t === "" ? null : t;
}
function flag(config, key) {
    const v = config[key];
    return v === true || v === "true" || v === "on" || v === "1";
}
async function executeAction(action, automation, lead, triggerEvent) {
    const config = action.config ?? {};
    const who = lead.name ?? `+${lead.phone}`;
    switch (action.type) {
        case "notify": {
            const severity = (0, notifications_1.isSeverity)(config.severity) ? config.severity : "info";
            await (0, notifications_1.createNotification)({
                kind: `automation:${automation.trigger_event}`,
                title: str(config, "title") ?? automation.name,
                description: str(config, "description") ??
                    `${automation.name} matched ${who} on ${triggerEvent}.`,
                severity,
                href: str(config, "href") ?? `/inbox/whatsapp/crm/leads/${lead.id}`,
                leadId: lead.id,
            });
            return { done: true, line: `notify: notification created (${severity})` };
        }
        case "create_task": {
            const dueInHours = num(config, "dueInHours", 24);
            const priority = exports.TASK_PRIORITIES.includes(config.priority)
                ? config.priority
                : "medium";
            const { error } = await (0, supabase_1.db)().from("villa_tasks").insert({
                title: str(config, "title") ?? `${automation.name} — ${who}`,
                description: str(config, "description"),
                lead_id: lead.id,
                assigned_to: lead.assigned_to ?? null,
                priority,
                task_type: str(config, "taskType") ?? "follow_up",
                due_at: new Date(Date.now() + dueInHours * 3_600_000).toISOString(),
            });
            if (error)
                throw new Error(error.message);
            return { done: true, line: `create_task: task due in ${dueInHours}h (${priority})` };
        }
        case "change_status": {
            const stage = str(config, "stage");
            if (!stage || !(0, kanban_1.isPipelineStage)(stage)) {
                return { done: false, line: `change_status: skipped — invalid stage ${stage ?? "(unset)"}` };
            }
            if (lead.pipeline_stage === stage) {
                return { done: true, line: `change_status: already ${kanban_1.STAGE_LABELS[stage]}` };
            }
            const moved = await (0, kanban_1.moveLeadStage)(lead.id, stage);
            if (!moved.ok)
                throw new Error(moved.error);
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
            const picked = await (0, routing_1.pickAssignee)({
                language,
                department: str(config, "department"),
                memberId: str(config, "memberId"),
            });
            if (!picked.ok)
                return { done: false, line: `assign_lead: skipped — ${picked.reason}` };
            const member = picked.member;
            if (lead.assigned_to === member.id) {
                return { done: true, line: `assign_lead: already with ${member.name}` };
            }
            const { error } = await (0, supabase_1.db)()
                .from("villa_leads")
                .update({ assigned_to: member.id })
                .eq("id", lead.id);
            if (error)
                throw new Error(error.message);
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
            const { error } = await (0, supabase_1.db)().from("villa_follow_ups").insert({
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
            if (error)
                throw new Error(error.message);
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
async function runAutomations(triggerEvent, lead) {
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_automations")
        .select("*")
        .eq("is_active", true)
        .eq("trigger_event", triggerEvent);
    if (error)
        throw new Error(`Could not load automations: ${error.message}`);
    const automations = (data ?? []).map((r) => normalise(r));
    const summary = {
        considered: automations.length,
        matched: 0,
        results: [],
    };
    for (const automation of automations) {
        if (!evaluateConditions(lead, automation.conditions))
            continue;
        summary.matched += 1;
        const lines = [];
        let ok = true;
        for (const action of automation.actions) {
            try {
                const outcome = await executeAction(action, automation, lead, triggerEvent);
                lines.push(outcome.line);
                if (!outcome.done)
                    ok = false;
            }
            catch (e) {
                ok = false;
                lines.push(`${action.type}: failed — ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        if (automation.actions.length === 0) {
            ok = false;
            lines.push("matched but has no actions configured");
        }
        const detail = lines.join("\n");
        await (0, supabase_1.db)().from("villa_automation_runs").insert({
            automation_id: automation.id,
            lead_id: lead.id,
            ok,
            detail,
        });
        await (0, supabase_1.db)()
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
function describeCondition(c) {
    const label = exports.CONDITION_FIELDS.find((f) => f.field === c.field)?.label ?? c.field;
    const value = c.value === null || c.value === undefined ? "—" : String(c.value);
    const shown = fieldKind(c.field) === "number" ? value : `"${value}"`;
    return `${label} ${exports.OPERATOR_LABELS[c.operator] ?? c.operator} ${shown}`;
}
function describeAction(a) {
    const label = exports.ACTION_LABELS[a.type] ?? a.type;
    const config = a.config ?? {};
    switch (a.type) {
        case "change_status": {
            const stage = str(config, "stage");
            return stage && (0, kanban_1.isPipelineStage)(stage) ? `${label}: ${kanban_1.STAGE_LABELS[stage]}` : label;
        }
        case "create_task":
            return `${label}: "${str(config, "title") ?? "untitled"}", due in ${num(config, "dueInHours", 24)}h`;
        case "notify":
            return `${label}: "${str(config, "title") ?? "untitled"}"`;
        case "send_message":
        case "generate_ai_followup":
            return `${label}: +${num(config, "delayHours", 24)}h`;
        case "assign_lead": {
            const parts = [];
            if (flag(config, "matchLeadLanguage"))
                parts.push("matching the lead's language");
            else if (str(config, "language"))
                parts.push(`speaking ${str(config, "language")}`);
            if (str(config, "department"))
                parts.push(`in ${str(config, "department")}`);
            if (flag(config, "reassign"))
                parts.push("reassigning owned leads");
            return parts.length === 0 ? label : `${label}, ${parts.join(", ")}`;
        }
        default:
            return label;
    }
}
