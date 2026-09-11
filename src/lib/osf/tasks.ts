import { db } from "./supabase";

/**
 * Tasks and scheduled follow-ups.
 *
 * Overdue is never stored. villa_task_status has an 'overdue' value, but a
 * status column only becomes stale — nothing sweeps the table when a due date
 * passes. Every read here derives it from due_at, so it is always true.
 * Schema: supabase/migrations/0009_business_os.sql.
 */

export type TaskStatus = "pending" | "in_progress" | "completed" | "overdue";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type FollowUpStatus = "pending" | "completed" | "missed" | "rescheduled";

export const TASK_STATUSES: TaskStatus[] = ["pending", "in_progress", "overdue", "completed"];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  overdue: "Overdue",
  completed: "Completed",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const STATUS_SET = new Set<string>(TASK_STATUSES);
const PRIORITY_SET = new Set<string>(TASK_PRIORITIES);

export function isTaskStatus(value: string): value is TaskStatus {
  return STATUS_SET.has(value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return PRIORITY_SET.has(value);
}

export type WriteResult = { ok: true } | { ok: false; error: string };

interface LeadRef {
  id: string;
  name: string | null;
  phone: string;
}

interface MemberRef {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  lead_id: string | null;
  assigned_to: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  task_type: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  lead: LeadRef | null;
  assignee: MemberRef | null;
}

export interface FollowUp {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  scheduled_at: string;
  completed_at: string | null;
  status: FollowUpStatus;
  channel: string;
  message: string | null;
  template_name: string | null;
  notes: string | null;
  ai_generated: boolean;
  dispatched_at: string | null;
  created_at: string;
  lead: LeadRef | null;
  assignee: MemberRef | null;
}

const TASK_SELECT = "*, lead:villa_leads(id, name, phone), assignee:villa_team_members(id, name)";
const FOLLOW_UP_SELECT = TASK_SELECT;

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  assignedTo?: string;
  leadId?: string;
  limit?: number;
}

export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  let query = db().from("villa_tasks").select(TASK_SELECT);

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    query = statuses.length === 1 ? query.eq("status", statuses[0]) : query.in("status", statuses);
  }
  if (filter.assignedTo) query = query.eq("assigned_to", filter.assignedTo);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);

  const { data } = await query
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 200);

  return (data ?? []) as unknown as Task[];
}

export interface NewTask {
  title: string;
  description?: string | null;
  leadId?: string | null;
  assignedTo?: string | null;
  priority?: string;
  taskType?: string;
  dueAt?: string | Date | null;
}

export async function createTask(
  input: NewTask,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "Title is required" };

  const priority = input.priority?.trim() || "medium";
  if (!isTaskPriority(priority)) return { ok: false, error: `Unknown priority: ${priority}` };

  const dueAt = toIso(input.dueAt);
  if (dueAt === "invalid") return { ok: false, error: "Due date is not a valid date/time" };

  const { data, error } = await db()
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

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function completeTask(id: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "Task id is required" };
  const { error } = await db()
    .from("villa_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface FollowUpFilter {
  status?: FollowUpStatus | FollowUpStatus[];
  assignedTo?: string;
  leadId?: string;
  limit?: number;
}

export async function listFollowUps(filter: FollowUpFilter = {}): Promise<FollowUp[]> {
  let query = db().from("villa_follow_ups").select(FOLLOW_UP_SELECT);

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    query = statuses.length === 1 ? query.eq("status", statuses[0]) : query.in("status", statuses);
  }
  if (filter.assignedTo) query = query.eq("assigned_to", filter.assignedTo);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);

  const { data } = await query
    .order("scheduled_at", { ascending: true })
    .limit(filter.limit ?? 200);

  return (data ?? []) as unknown as FollowUp[];
}

export interface NewFollowUp {
  leadId: string;
  scheduledAt: string | Date;
  assignedTo?: string | null;
  channel?: string;
  message?: string | null;
  templateName?: string | null;
  notes?: string | null;
  aiGenerated?: boolean;
}

export async function createFollowUp(
  input: NewFollowUp,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.leadId) return { ok: false, error: "A lead is required for a follow-up" };

  const scheduledAt = toIso(input.scheduledAt);
  if (scheduledAt === "invalid") return { ok: false, error: "Scheduled time is not a valid date/time" };
  if (!scheduledAt) return { ok: false, error: "Scheduled time is required" };

  const { data, error } = await db()
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

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function completeFollowUp(id: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "Follow-up id is required" };
  const { error } = await db()
    .from("villa_follow_ups")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Follow-ups a dispatcher should act on now.
 *
 * dispatched_at is the idempotency guard from the migration — a cron run that
 * overlaps the previous one must not send the same message twice.
 */
export async function dueFollowUps(now: Date = new Date(), limit = 100): Promise<FollowUp[]> {
  const { data } = await db()
    .from("villa_follow_ups")
    .select(FOLLOW_UP_SELECT)
    .eq("status", "pending")
    .is("dispatched_at", null)
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  return (data ?? []) as unknown as FollowUp[];
}

export function isTaskOverdue(task: Pick<Task, "due_at" | "status">, now = Date.now()): boolean {
  if (!task.due_at || task.status === "completed") return false;
  return new Date(task.due_at).getTime() < now;
}

export function isFollowUpOverdue(
  followUp: Pick<FollowUp, "scheduled_at" | "status">,
  now = Date.now(),
): boolean {
  if (followUp.status === "completed") return false;
  return new Date(followUp.scheduled_at).getTime() < now;
}

/** Relative for anything inside a week, absolute beyond it — "in 47d" means nothing. */
export function dueLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "No due date";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "—";

  const diff = target - now;
  const abs = Math.abs(diff);
  if (abs > 7 * 86_400_000) return formatDateTime(iso);

  const mins = Math.round(abs / 60_000);
  const unit =
    mins < 60 ? `${mins}m` : abs < 86_400_000 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;

  if (mins < 1) return "now";
  return diff < 0 ? `${unit} overdue` : `in ${unit}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Returns null for empty, the literal "invalid" for unparseable input. */
function toIso(value: string | Date | null | undefined): string | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid";
  return date.toISOString();
}
