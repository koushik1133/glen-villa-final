import Link from "next/link";
import { CheckCircle, Clock, Plus, AlertTriangle, User } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  PageHeader,
  SetupNotice,
  Stat,
  formatNumber,
  timeAgo,
} from "@/components/osf/ui";
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  UNASSIGNED,
  dueLabel,
  formatDateTime,
  humanise,
  isTaskOverdue,
  leadOptions,
  listTasks,
  teamMembers,
  type CrmTask,
  type LeadRef,
  type TaskStatus,
  type TeamRef,
} from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

const BASE = "/inbox/whatsapp/crm/tasks";

/**
 * Overdue is derived here, every render, from `due_at` — it is never read off
 * `status`. A task whose deadline passed an hour ago still carries
 * status='pending' in the database, and a board that trusted the stored value
 * would show it as merely pending until somebody edited the row. The whole
 * point of this page is to surface the ones nobody has touched.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string; error?: string }>;
}) {
  const { rep, error } = await searchParams;

  // Every task is loaded and the assignee filter applied in memory: filtering
  // in the query would leave the picker counting only the rep already selected,
  // so every other name would read "(0)" while they had a full queue.
  const page = await gatedLoad({ table: "villa_tasks", migration: "001_schema.sql" }, () =>
    Promise.all([listTasks(), teamMembers(), leadOptions(150)] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Tasks" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [everyTask, team, leads] = page.data;
  const now = Date.now();
  const next = rep ? `${BASE}?rep=${encodeURIComponent(rep)}` : BASE;

  const tasks = rep ? everyTask.filter((task) => ownerKey(task) === rep) : everyTask;
  const open = tasks.filter((task) => task.status !== "completed");
  const overdue = open.filter((task) => isTaskOverdue(task, now));
  const dueToday = open.filter((task) => isDueToday(task.due_at, now) && !isTaskOverdue(task, now));
  const unscheduled = open.filter((task) => !task.due_at);

  const columns: Array<{ status: TaskStatus; tasks: CrmTask[] }> = TASK_STATUSES.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status).sort((a, b) => rank(a) - rank(b)),
  }));

  return (
    <>
      <PageHeader
        title="Tasks"
        sub="Work assigned to the sales team. Overdue is computed from the due date at read time, so a deadline that passed while nobody was looking still shows up as late."
        actions={<RepFilter team={team} active={rep} counts={countByRep(everyTask)} />}
      />

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] p-4 text-sm text-[var(--color-danger)]">
          <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open" value={formatNumber(open.length)} sub={`${formatNumber(tasks.length)} total on record`} />
        <Stat
          label="Overdue"
          value={formatNumber(overdue.length)}
          sub={overdue.length ? "Past the due date and still open" : "Nothing has slipped"}
          gold={overdue.length > 0}
        />
        <Stat label="Due today" value={formatNumber(dueToday.length)} />
        <Stat
          label="No due date"
          value={formatNumber(unscheduled.length)}
          sub={unscheduled.length ? "Cannot go overdue — nobody set a deadline" : undefined}
        />
      </div>

      <NewTaskForm team={team} leads={leads} next={next} />

      {tasks.length === 0 ? (
        <Card className="mt-5">
          <Empty
            action={
              rep ? (
                <Link href={BASE} className="btn-ghost">
                  Show everyone
                </Link>
              ) : undefined
            }
          >
            {rep ? (
              <>
                Nothing is assigned to that person.{" "}
                {formatNumber(everyTask.length)} task{everyTask.length === 1 ? "" : "s"} exist across
                the team.
              </>
            ) : (
              <>
                <code className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-xs">villa_tasks</code>{" "}
                is empty. Tasks are created here, from a lead&rsquo;s page, or by an automation when a
                conversation goes quiet.
              </>
            )}
          </Empty>
        </Card>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {columns.map((column) => (
            <StatusColumn
              key={column.status}
              status={column.status}
              tasks={column.tasks}
              next={next}
              now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Same local calendar day. Cheaper and clearer than a timezone-aware diff. */
function isDueToday(iso: string | null, now: number): boolean {
  if (!iso) return false;
  const due = new Date(iso);
  const today = new Date(now);
  return (
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  );
}

/**
 * Sort key: earliest deadline first, undated last. Overdue tasks sort to the
 * top for free — a deadline in the past is a smaller number than one ahead.
 */
function rank(task: CrmTask): number {
  if (!task.due_at) return Number.MAX_SAFE_INTEGER;
  const due = new Date(task.due_at).getTime();
  return Number.isNaN(due) ? Number.MAX_SAFE_INTEGER : due;
}

/** Assignee id, or the sentinel the filter uses for "nobody owns this". */
function ownerKey(task: CrmTask): string {
  return task.assigned_to ?? UNASSIGNED;
}

/** Open tasks per assignee, so the picker shows a real workload. */
function countByRep(tasks: CrmTask[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "completed") continue;
    counts.set(ownerKey(task), (counts.get(ownerKey(task)) ?? 0) + 1);
  }
  return counts;
}

function RepFilter({
  team,
  active,
  counts,
}: {
  team: TeamRef[];
  active?: string;
  counts: Map<string, number>;
}) {
  return (
    <form action={BASE} method="GET" className="flex items-center gap-2">
      <label className="label" htmlFor="rep">
        Assignee
      </label>
      <select id="rep" name="rep" defaultValue={active ?? ""} className="field !w-auto !py-2 text-xs">
        <option value="">Everyone</option>
        <option value={UNASSIGNED}>Unassigned ({counts.get(UNASSIGNED) ?? 0})</option>
        {team.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name} ({counts.get(member.id) ?? 0})
          </option>
        ))}
      </select>
      <button type="submit" className="btn-ghost !py-2 text-xs">
        Apply
      </button>
    </form>
  );
}

function StatusColumn({
  status,
  tasks,
  next,
  now,
}: {
  status: TaskStatus;
  tasks: CrmTask[];
  next: string;
  now: number;
}) {
  const late = tasks.filter((task) => isTaskOverdue(task, now)).length;

  return (
    <section className="card flex flex-col gap-3 p-0">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{TASK_STATUS_LABELS[status]}</h2>
        <span className="flex items-center gap-2 text-[11px] tabular-nums text-[var(--color-faint)]">
          {late > 0 && <span className="text-[var(--color-danger)]">{late} late</span>}
          {formatNumber(tasks.length)}
        </span>
      </header>

      <div className="flex flex-col gap-2.5 px-4 pb-4">
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-6 text-center text-xs text-[var(--color-faint)]">
            Nothing {TASK_STATUS_LABELS[status].toLowerCase()}.
          </p>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} next={next} now={now} />)
        )}
      </div>
    </section>
  );
}

function TaskCard({ task, next, now }: { task: CrmTask; next: string; now: number }) {
  const overdue = isTaskOverdue(task, now);

  return (
    <article
      className={`rounded-xl border px-3.5 py-3 ${
        overdue
          ? "border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_6%,transparent)]"
          : "border-[var(--color-line)] bg-[var(--color-void)]/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <p className="text-sm leading-snug text-[var(--color-ink)]">{task.title}</p>
        <Badge tone={PRIORITY_TONES[task.priority] ?? "neutral"}>{PRIORITY_LABELS[task.priority]}</Badge>
      </div>

      {task.description && (
        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-[var(--color-muted)]">
          {task.description}
        </p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--color-faint)]">
        <span className="inline-flex items-center gap-1">
          <Clock size={11} strokeWidth={2} aria-hidden />
          <span className={overdue ? "font-medium text-[var(--color-danger)]" : ""}>
            {task.due_at ? dueLabel(task.due_at, now) : "No due date"}
          </span>
        </span>
        {task.due_at && <span>{formatDateTime(task.due_at)}</span>}
        <span className="capitalize">{humanise(task.task_type)}</span>
      </p>

      <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1 text-[var(--color-muted)]">
          <User size={11} strokeWidth={2} aria-hidden />
          {task.assignee?.name ?? <span className="text-[var(--color-faint)]">Unassigned</span>}
        </span>
        {task.lead && (
          <Link
            href={`/inbox/whatsapp/crm/leads/${task.lead.id}`}
            className="text-[var(--color-gold-300)] underline underline-offset-2"
          >
            {task.lead.name?.trim() || `+${task.lead.phone}`}
          </Link>
        )}
      </p>

      {task.status === "completed" ? (
        <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-success)]">
          Completed {timeAgo(task.completed_at)}
        </p>
      ) : (
        <form action="/api/osf/crm" method="POST" className="mt-2.5 flex flex-wrap gap-2">
          <input type="hidden" name="id" value={task.id} />
          {task.lead_id && <input type="hidden" name="leadId" value={task.lead_id} />}
          <input type="hidden" name="next" value={next} />
          {task.status === "pending" && (
            <button type="submit" name="action" value="start_task" className="btn-ghost !px-3 !py-1.5 text-xs">
              Start
            </button>
          )}
          <button
            type="submit"
            name="action"
            value="complete_task"
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            <CheckCircle size={12} strokeWidth={2} aria-hidden />
            Complete
          </button>
        </form>
      )}
    </article>
  );
}

function NewTaskForm({
  team,
  leads,
  next,
}: {
  team: TeamRef[];
  leads: LeadRef[];
  next: string;
}) {
  return (
    <details className="card">
      <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--color-ink)]">
        <span className="inline-flex items-center gap-2">
          <Plus size={14} strokeWidth={2} className="text-[var(--color-gold-300)]" aria-hidden />
          New task
        </span>
        <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">
          Assign work to a rep, optionally against a lead.
        </span>
      </summary>

      <form action="/api/osf/crm" method="POST" className="mt-4 grid gap-3 lg:grid-cols-12">
        <input type="hidden" name="action" value="create_task" />
        <input type="hidden" name="next" value={next} />

        <div className="lg:col-span-4">
          <label className="label" htmlFor="task-title">
            Title
          </label>
          <input
            id="task-title"
            name="title"
            required
            placeholder="Call back about the corner plot"
            className="field mt-1.5"
          />
        </div>

        <div className="lg:col-span-3">
          <label className="label" htmlFor="task-lead">
            Lead
          </label>
          <select id="task-lead" name="leadId" defaultValue="" className="field mt-1.5">
            <option value="">Not lead-specific</option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.name?.trim() || `+${lead.phone}`}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-2">
          <label className="label" htmlFor="task-rep">
            Assign to
          </label>
          <select id="task-rep" name="assignedTo" defaultValue="" className="field mt-1.5">
            <option value="">Unassigned</option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-1">
          <label className="label" htmlFor="task-priority">
            Priority
          </label>
          <select id="task-priority" name="priority" defaultValue="medium" className="field mt-1.5">
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-2">
          <label className="label" htmlFor="task-due">
            Due
          </label>
          <input id="task-due" type="datetime-local" name="dueAt" className="field mt-1.5" />
        </div>

        <div className="lg:col-span-10">
          <label className="label" htmlFor="task-notes">
            Detail
          </label>
          <input
            id="task-notes"
            name="description"
            placeholder="Context the rep needs before picking up the phone"
            className="field mt-1.5"
          />
        </div>

        <div className="flex items-end lg:col-span-2">
          <button type="submit" className="btn-gold w-full justify-center">
            Create task
          </button>
        </div>
      </form>
    </details>
  );
}
