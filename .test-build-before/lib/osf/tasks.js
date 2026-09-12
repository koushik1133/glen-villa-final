"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIORITY_LABELS = exports.STATUS_LABELS = exports.TASK_PRIORITIES = exports.TASK_STATUSES = void 0;
exports.isTaskStatus = isTaskStatus;
exports.isTaskPriority = isTaskPriority;
exports.listTasks = listTasks;
exports.createTask = createTask;
exports.completeTask = completeTask;
exports.listFollowUps = listFollowUps;
exports.createFollowUp = createFollowUp;
exports.completeFollowUp = completeFollowUp;
exports.dueFollowUps = dueFollowUps;
exports.isTaskOverdue = isTaskOverdue;
exports.isFollowUpOverdue = isFollowUpOverdue;
exports.dueLabel = dueLabel;
exports.formatDateTime = formatDateTime;
const supabase_1 = require("./supabase");
exports.TASK_STATUSES = ["pending", "in_progress", "overdue", "completed"];
exports.TASK_PRIORITIES = ["low", "medium", "high", "urgent"];
exports.STATUS_LABELS = {
    pending: "Pending",
    in_progress: "In progress",
    overdue: "Overdue",
    completed: "Completed",
};
exports.PRIORITY_LABELS = {
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
};
const STATUS_SET = new Set(exports.TASK_STATUSES);
const PRIORITY_SET = new Set(exports.TASK_PRIORITIES);
function isTaskStatus(value) {
    return STATUS_SET.has(value);
}
function isTaskPriority(value) {
    return PRIORITY_SET.has(value);
}
const TASK_SELECT = "*, lead:villa_leads(id, name, phone), assignee:villa_team_members(id, name)";
const FOLLOW_UP_SELECT = TASK_SELECT;
async function listTasks(filter = {}) {
    let query = (0, supabase_1.db)().from("villa_tasks").select(TASK_SELECT);
    if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        query = statuses.length === 1 ? query.eq("status", statuses[0]) : query.in("status", statuses);
    }
    if (filter.assignedTo)
        query = query.eq("assigned_to", filter.assignedTo);
    if (filter.leadId)
        query = query.eq("lead_id", filter.leadId);
    const { data } = await query
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(filter.limit ?? 200);
    return (data ?? []);
}
async function createTask(input) {
    const title = input.title?.trim();
    if (!title)
        return { ok: false, error: "Title is required" };
    const priority = input.priority?.trim() || "medium";
    if (!isTaskPriority(priority))
        return { ok: false, error: `Unknown priority: ${priority}` };
    const dueAt = toIso(input.dueAt);
    if (dueAt === "invalid")
        return { ok: false, error: "Due date is not a valid date/time" };
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_tasks")
        .insert({
        title,
        description: input.description?.trim() || null,
        lead_id: input.leadId || null,
        assigned_to: input.assignedTo || null,
        priority,
        task_type: input.taskType?.trim() || "follow_up",
        due_at: dueAt,
    })
        .select("id")
        .single();
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id: String(data.id) };
}
async function completeTask(id) {
    if (!id)
        return { ok: false, error: "Task id is required" };
    const { error } = await (0, supabase_1.db)()
        .from("villa_tasks")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
async function listFollowUps(filter = {}) {
    let query = (0, supabase_1.db)().from("villa_follow_ups").select(FOLLOW_UP_SELECT);
    if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        query = statuses.length === 1 ? query.eq("status", statuses[0]) : query.in("status", statuses);
    }
    if (filter.assignedTo)
        query = query.eq("assigned_to", filter.assignedTo);
    if (filter.leadId)
        query = query.eq("lead_id", filter.leadId);
    const { data } = await query
        .order("scheduled_at", { ascending: true })
        .limit(filter.limit ?? 200);
    return (data ?? []);
}
async function createFollowUp(input) {
    if (!input.leadId)
        return { ok: false, error: "A lead is required for a follow-up" };
    const scheduledAt = toIso(input.scheduledAt);
    if (scheduledAt === "invalid")
        return { ok: false, error: "Scheduled time is not a valid date/time" };
    if (!scheduledAt)
        return { ok: false, error: "Scheduled time is required" };
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_follow_ups")
        .insert({
        lead_id: input.leadId,
        assigned_to: input.assignedTo || null,
        scheduled_at: scheduledAt,
        channel: input.channel?.trim() || "whatsapp",
        message: input.message?.trim() || null,
        template_name: input.templateName?.trim() || null,
        notes: input.notes?.trim() || null,
        ai_generated: input.aiGenerated ?? false,
    })
        .select("id")
        .single();
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id: String(data.id) };
}
async function completeFollowUp(id) {
    if (!id)
        return { ok: false, error: "Follow-up id is required" };
    const { error } = await (0, supabase_1.db)()
        .from("villa_follow_ups")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
/**
 * Follow-ups a dispatcher should act on now.
 *
 * dispatched_at is the idempotency guard from the migration — a cron run that
 * overlaps the previous one must not send the same message twice.
 */
async function dueFollowUps(now = new Date(), limit = 100) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_follow_ups")
        .select(FOLLOW_UP_SELECT)
        .eq("status", "pending")
        .is("dispatched_at", null)
        .lte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(limit);
    return (data ?? []);
}
function isTaskOverdue(task, now = Date.now()) {
    if (!task.due_at || task.status === "completed")
        return false;
    return new Date(task.due_at).getTime() < now;
}
function isFollowUpOverdue(followUp, now = Date.now()) {
    if (followUp.status === "completed")
        return false;
    return new Date(followUp.scheduled_at).getTime() < now;
}
/** Relative for anything inside a week, absolute beyond it — "in 47d" means nothing. */
function dueLabel(iso, now = Date.now()) {
    if (!iso)
        return "No due date";
    const target = new Date(iso).getTime();
    if (Number.isNaN(target))
        return "—";
    const diff = target - now;
    const abs = Math.abs(diff);
    if (abs > 7 * 86_400_000)
        return formatDateTime(iso);
    const mins = Math.round(abs / 60_000);
    const unit = mins < 60 ? `${mins}m` : abs < 86_400_000 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
    if (mins < 1)
        return "now";
    return diff < 0 ? `${unit} overdue` : `in ${unit}`;
}
function formatDateTime(iso) {
    if (!iso)
        return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "—";
    return date.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    });
}
/** Returns null for empty, the literal "invalid" for unparseable input. */
function toIso(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        return "invalid";
    return date.toISOString();
}
