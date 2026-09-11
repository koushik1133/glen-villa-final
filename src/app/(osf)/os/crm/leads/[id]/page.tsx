import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  BotOff,
  CalendarClock,
  CheckCircle,
  Clock,
  MapPin,
  MessageSquare,
  Plus,
  Route,
  AlertTriangle,
} from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  TemperaturePill,
  formatCr,
  formatDate,
  timeAgo,
} from "@/components/osf/ui";
import { MessageThread } from "@/app/(osf)/os/communication/thread";
import {
  COMM_CHANNELS,
  FOLLOWUP_STATUS_TONES,
  PIPELINE_STAGES,
  PRIORITY_TONES,
  STAGE_LABELS,
  STAGE_TONES,
  TASK_PRIORITIES,
  TASK_STATUS_LABELS,
  budgetRange,
  daysSince,
  dueLabel,
  formatDateTime,
  humanise,
  isFollowUpOverdue,
  isTaskOverdue,
  leadDetail,
  scoreSignals,
  type CrmFollowUp,
  type CrmLead,
  type CrmSiteVisit,
  type CrmTask,
  type CrmTouchpoint,
  type FollowUpStatus,
  type ScoreSignal,
  type TaskPriority,
  type TeamRef,
} from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time, not an ISO instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const VISIT_TONES: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  requested: "neutral",
  scheduled: "info",
  confirmed: "warning",
  completed: "success",
  no_show: "danger",
  cancelled: "danger",
};

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);

  const page = await gatedLoad(null, () => leadDetail(id));
  if (!page.ok) {
    return (
      <>
        <PageHeader title="Lead" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }
  if (!page.data) notFound();

  const { lead, messages, activities, tasks, followUps, siteVisits, touchpoints, team } = page.data;
  const next = `/os/crm/leads/${lead.id}`;
  const openTasks = tasks.filter((t) => t.status !== "completed");

  return (
    <>
      <Link
        href="/os/crm/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
      >
        <ArrowLeft size={14} strokeWidth={2} aria-hidden />
        All leads
      </Link>

      <PageHeader
        title={lead.name?.trim() || `+${lead.phone}`}
        sub={[
          `+${lead.phone}`,
          lead.email,
          [lead.city, lead.country].filter(Boolean).join(", ") || null,
          lead.is_nri ? "NRI" : null,
        ]
          .filter(Boolean)
          .join("  ·  ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TemperaturePill value={lead.lead_temperature} />
            <Badge tone={STAGE_TONES[lead.pipeline_stage]}>{STAGE_LABELS[lead.pipeline_stage]}</Badge>
            {lead.ai_paused && <Badge tone="warning">AI paused</Badge>}
            {lead.opted_out && <Badge tone="danger">Opted out</Badge>}
            {lead.is_future_prospect && <Badge tone="neutral">Future prospect</Badge>}
          </div>
        }
      />

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-[rgba(244,105,95,0.3)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[var(--color-danger)]">
          <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-5">
          <Card
            title="Conversation"
            hint={`${messages.length} message${messages.length === 1 ? "" : "s"} on record. Newest at the bottom.`}
            actions={
              messages.length > 0 ? (
                <Link href="/os/communication/whatsapp" className="btn-ghost !py-2 text-xs">
                  <MessageSquare size={13} strokeWidth={1.75} aria-hidden />
                  Reply
                </Link>
              ) : undefined
            }
          >
            {lead.ai_summary && (
              <p className="mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)] p-3.5 text-xs leading-relaxed text-[var(--color-muted)]">
                <span className="label mr-2">AI summary</span>
                {lead.ai_summary}
              </p>
            )}
            <div className="max-h-[36rem] overflow-y-auto pr-1">
              <MessageThread messages={messages} />
            </div>
          </Card>

          <TasksCard
            leadId={lead.id}
            next={next}
            tasks={tasks}
            followUps={followUps}
            team={team}
          />

          <Card title="Site visits" hint="Requested, scheduled and completed visits for this lead.">
            <SiteVisits visits={siteVisits} />
          </Card>

          <Card
            title="Touchpoint journey"
            hint="Every recorded contact, oldest first — how this lead actually arrived and what has touched them since."
          >
            <Journey touchpoints={touchpoints} firstContactAt={lead.first_contact_at} />
          </Card>

          <Card title="Activity timeline" hint="Everything that happened around the conversation.">
            {activities.length === 0 ? (
              <Empty>Nothing logged for this lead yet.</Empty>
            ) : (
              <ol className="space-y-0">
                {activities.map((activity, index) => (
                  <li key={activity.id} className="relative flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-gold-500)]" />
                      {index < activities.length - 1 && (
                        <span className="w-px flex-1 bg-[var(--color-line)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <p className="text-sm text-[var(--color-ink)]">{activity.description}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
                        {humanise(activity.activity_type)}
                        {activity.actor && ` · ${activity.actor}`}
                        {activity.channel && ` · ${humanise(activity.channel)}`}
                        {" · "}
                        {formatDateTime(activity.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <ActionsCard lead={lead} team={team} next={next} />

          <Card title="Lead score" hint="Internal only — never quoted to the customer.">
            <div className="mb-3 flex items-baseline gap-2">
              <span className="stat">{lead.lead_score}</span>
              <span className="text-sm text-[var(--color-faint)]">/ 100</span>
              <span className="ml-auto">
                <TemperaturePill value={lead.lead_temperature} />
              </span>
            </div>
            <Meter value={lead.lead_score} max={100} />
            {lead.sentiment && (
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                <span className="label mr-1.5">Sentiment</span>
                {humanise(lead.sentiment)}
              </p>
            )}
            <ScorePanel signals={scoreSignals(lead)} />
          </Card>

          <Card title="Requirements" hint="Stated by the buyer. Blank means they have not said.">
            <Facts
              rows={[
                ["Budget", budgetRange(lead.budget_min_inr, lead.budget_max_inr, formatCr)],
                ["Bedrooms", lead.bedrooms ? `${lead.bedrooms} BHK` : "—"],
                ["Project of interest", lead.project?.name ?? "—"],
                ["Villa type", lead.villa_type?.name ?? "—"],
                ["Purpose", humanise(lead.buyer_purpose)],
                ["Timeline", humanise(lead.purchase_timeline)],
                ["Financing", humanise(lead.financing_preference)],
                ["Preferred location", lead.preferred_location ?? "—"],
                ["Facing", lead.facing_preference ?? "—"],
              ]}
            />
            {lead.amenities_of_interest && lead.amenities_of_interest.length > 0 && (
              <div className="mt-4 border-t border-[var(--color-line)] pt-3">
                <p className="label mb-2">Amenities asked about</p>
                <div className="flex flex-wrap gap-1.5">
                  {lead.amenities_of_interest.map((amenity) => (
                    <Badge key={amenity} tone="gold">
                      {amenity}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {lead.requirements_notes && (
              <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-xs leading-relaxed text-[var(--color-muted)]">
                {lead.requirements_notes}
              </p>
            )}
          </Card>

          <Card title="Profile">
            <Facts
              rows={[
                ["Assigned rep", lead.assignee?.name ?? "Unassigned"],
                ["Source", lead.campaign ? `${lead.source} / ${lead.campaign}` : lead.source],
                ["Language", lead.preferred_language.toUpperCase()],
                ["Consent", humanise(lead.consent_status)],
                ["Handoff", humanise(lead.handoff_status)],
                ["First contact", formatDate(lead.first_contact_at)],
                ["Last contact", timeAgo(lead.last_contact_at)],
                ["Open tasks", String(openTasks.length)],
              ]}
            />
            <Collateral lead={lead} />
            {lead.notes && (
              <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-xs leading-relaxed text-[var(--color-muted)]">
                {lead.notes}
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Sidebar pieces
// -----------------------------------------------------------------------------

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="space-y-2.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="label shrink-0">{label}</dt>
          <dd className="truncate text-right text-sm text-[var(--color-ink)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What the buyer has actually told us, grouped.
 *
 * Deliberately not a points breakdown: the score is computed during the
 * conversation from signals that are not stored on the lead row, so any
 * arithmetic here would be a guess presented as a reason.
 */
function ScorePanel({ signals }: { signals: ScoreSignal[] }) {
  const groups: ScoreSignal["group"][] = ["Intent", "Requirements", "Contactability"];
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--color-line)] pt-4">
      <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
        Qualification facts on record. A blank one is a question nobody has asked yet, not a
        negative.
      </p>
      {groups.map((group) => {
        const rows = signals.filter((s) => s.group === group);
        const known = rows.filter((s) => s.value).length;
        return (
          <div key={group}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <p className="label">{group}</p>
              <p className="text-[11px] tabular-nums text-[var(--color-faint)]">
                {known}/{rows.length} known
              </p>
            </div>
            <ul className="space-y-1">
              {rows.map((signal) => (
                <li key={signal.label} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className={signal.value ? "text-[var(--color-muted)]" : "text-[var(--color-faint)]"}>
                    {signal.label}
                  </span>
                  <span
                    className={`truncate text-right capitalize ${
                      signal.value ? "text-[var(--color-ink)]" : "text-[var(--color-faint)]"
                    }`}
                  >
                    {signal.value ?? "Not asked"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Collateral({ lead }: { lead: CrmLead }) {
  const items: Array<[string, boolean]> = [
    ["Brochure", lead.brochure_sent],
    ["Floor plan", lead.floor_plan_sent],
    ["Price sheet", lead.price_sheet_sent],
    ["Video", lead.video_sent],
  ];
  return (
    <div className="mt-4 border-t border-[var(--color-line)] pt-3">
      <p className="label mb-2">Collateral sent</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map(([label, sent]) => (
          <span
            key={label}
            className={`pill ${
              sent
                ? "bg-[rgba(94,201,141,0.14)] text-[var(--color-success)]"
                : "border border-dashed border-[var(--color-line)] text-[var(--color-faint)]"
            }`}
          >
            {sent && <CheckCircle size={11} strokeWidth={2} aria-hidden />}
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActionsCard({ lead, team, next }: { lead: CrmLead; team: TeamRef[]; next: string }) {
  return (
    <Card title="Actions" hint="Each of these is a plain form POST — no client JavaScript involved.">
      <div className="space-y-4">
        <form action="/api/osf/crm" method="POST" className="space-y-2">
          <input type="hidden" name="action" value="assign_rep" />
          <input type="hidden" name="leadId" value={lead.id} />
          <input type="hidden" name="next" value={next} />
          <label className="label block">Assigned rep</label>
          <div className="flex gap-2">
            <select name="assignedTo" defaultValue={lead.assigned_to ?? ""} className="field">
              <option value="">Unassigned</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {humanise(member.role)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-ghost shrink-0">
              Save
            </button>
          </div>
        </form>

        <form action="/api/osf/crm" method="POST" className="space-y-2 border-t border-[var(--color-line)] pt-4">
          <input type="hidden" name="action" value="set_stage" />
          <input type="hidden" name="leadId" value={lead.id} />
          <input type="hidden" name="next" value={next} />
          <label className="label block">Pipeline stage</label>
          <div className="flex gap-2">
            <select name="stage" defaultValue={lead.pipeline_stage} className="field">
              {PIPELINE_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-ghost shrink-0">
              Move
            </button>
          </div>
        </form>

        <form action="/api/osf/crm" method="POST" className="border-t border-[var(--color-line)] pt-4">
          <input type="hidden" name="action" value="set_ai_paused" />
          <input type="hidden" name="leadId" value={lead.id} />
          <input type="hidden" name="next" value={next} />
          {/* Absent checkbox field means false, which is exactly "resume". */}
          {!lead.ai_paused && <input type="hidden" name="paused" value="on" />}
          <p className="label mb-2">AI agent</p>
          <p className="mb-2.5 text-xs leading-relaxed text-[var(--color-muted)]">
            {lead.ai_paused
              ? "Paused. The agent will not answer this customer at all until it is resumed."
              : "Answering. Replying by hand from the WhatsApp console pauses it automatically."}
          </p>
          <button type="submit" className="btn-ghost w-full justify-center">
            {lead.ai_paused ? <Bot size={14} strokeWidth={1.75} aria-hidden /> : <BotOff size={14} strokeWidth={1.75} aria-hidden />}
            {lead.ai_paused ? "Resume AI on this lead" : "Pause AI on this lead"}
          </button>
        </form>

        <form action="/api/osf/crm" method="POST" className="space-y-2 border-t border-[var(--color-line)] pt-4">
          <input type="hidden" name="action" value="set_future_prospect" />
          <input type="hidden" name="leadId" value={lead.id} />
          <input type="hidden" name="next" value={next} />
          <p className="label">Future prospect</p>
          <p className="text-xs leading-relaxed text-[var(--color-muted)]">
            Parks a casual enquiry out of the active pipeline with a date to reconnect. The nudge is
            only scheduled if a date is set.
          </p>
          {lead.is_future_prospect ? (
            <>
              <p className="text-xs text-[var(--color-ink)]">
                Parked, reconnect{" "}
                <span className="text-[var(--color-gold-300)]">{formatDateTime(lead.reconnect_at)}</span>
              </p>
              <button type="submit" className="btn-ghost w-full justify-center">
                Return to active pipeline
              </button>
            </>
          ) : (
            <>
              <input type="hidden" name="isFutureProspect" value="on" />
              <input
                type="datetime-local"
                name="reconnectAt"
                defaultValue={toLocalInput(lead.reconnect_at)}
                className="field"
                required
              />
              <button type="submit" className="btn-ghost w-full justify-center">
                <CalendarClock size={14} strokeWidth={1.75} aria-hidden />
                Park as future prospect
              </button>
            </>
          )}
        </form>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Tasks, follow-ups, visits, journey
// -----------------------------------------------------------------------------

function TasksCard({
  leadId,
  next,
  tasks,
  followUps,
  team,
}: {
  leadId: string;
  next: string;
  tasks: CrmTask[];
  followUps: CrmFollowUp[];
  team: TeamRef[];
}) {
  const now = Date.now();
  return (
    <Card
      title="Tasks & follow-ups"
      hint="Overdue is derived from the due date every time this page renders — never from a stored flag that could be stale."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="label mb-2.5">Tasks</p>
          {tasks.length === 0 ? (
            <Empty>No task on this lead.</Empty>
          ) : (
            <ul className="space-y-2">
              {tasks.map((task) => {
                const overdue = isTaskOverdue(task, now);
                return (
                  <li
                    key={task.id}
                    className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 px-3.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className={`text-sm ${
                          task.status === "completed"
                            ? "text-[var(--color-faint)] line-through"
                            : "text-[var(--color-ink)]"
                        }`}
                      >
                        {task.title}
                      </p>
                      <Badge tone={PRIORITY_TONES[task.priority as TaskPriority] ?? "neutral"}>
                        {task.priority}
                      </Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--color-faint)]">
                      <span>{TASK_STATUS_LABELS[task.status] ?? task.status}</span>
                      <span className={overdue ? "text-[var(--color-danger)]" : ""}>
                        {dueLabel(task.due_at, now)}
                      </span>
                      {task.assignee && <span>{task.assignee.name}</span>}
                    </p>
                    {task.status !== "completed" && (
                      <form action="/api/osf/crm" method="POST" className="mt-2 flex gap-2">
                        <input type="hidden" name="id" value={task.id} />
                        <input type="hidden" name="leadId" value={leadId} />
                        <input type="hidden" name="next" value={next} />
                        {task.status === "pending" && (
                          <button
                            type="submit"
                            name="action"
                            value="start_task"
                            className="btn-ghost !px-3 !py-1.5 text-xs"
                          >
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
                  </li>
                );
              })}
            </ul>
          )}

          <details className="mt-3 rounded-xl border border-dashed border-[var(--color-line)] px-3.5 py-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--color-muted)]">
              <Plus size={12} strokeWidth={2} className="mr-1 inline" aria-hidden />
              New task
            </summary>
            <form action="/api/osf/crm" method="POST" className="mt-3 space-y-2">
              <input type="hidden" name="action" value="create_task" />
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="next" value={next} />
              <input name="title" placeholder="Call back about the corner plot" className="field" required />
              <div className="grid gap-2 sm:grid-cols-2">
                <select name="priority" defaultValue="medium" className="field">
                  {TASK_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
                <select name="assignedTo" defaultValue="" className="field">
                  <option value="">Unassigned</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
              <input type="datetime-local" name="dueAt" className="field" />
              <button type="submit" className="btn-gold w-full justify-center">
                Add task
              </button>
            </form>
          </details>
        </div>

        <div>
          <p className="label mb-2.5">Follow-ups</p>
          {followUps.length === 0 ? (
            <Empty>No follow-up scheduled.</Empty>
          ) : (
            <ul className="space-y-2">
              {followUps.map((followUp) => (
                <FollowUpRow key={followUp.id} followUp={followUp} leadId={leadId} next={next} now={now} />
              ))}
            </ul>
          )}

          <details className="mt-3 rounded-xl border border-dashed border-[var(--color-line)] px-3.5 py-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--color-muted)]">
              <Plus size={12} strokeWidth={2} className="mr-1 inline" aria-hidden />
              New follow-up
            </summary>
            <form action="/api/osf/crm" method="POST" className="mt-3 space-y-2">
              <input type="hidden" name="action" value="create_follow_up" />
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="next" value={next} />
              <input type="datetime-local" name="scheduledAt" className="field" required />
              <div className="grid gap-2 sm:grid-cols-2">
                <select name="channel" defaultValue="whatsapp" className="field">
                  {COMM_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {humanise(channel)}
                    </option>
                  ))}
                </select>
                <select name="assignedTo" defaultValue="" className="field">
                  <option value="">Unassigned</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
              <input name="templateName" placeholder="Template name (needed outside 24h)" className="field" />
              <textarea name="message" rows={2} placeholder="What to say" className="field resize-y" />
              <button type="submit" className="btn-gold w-full justify-center">
                Schedule follow-up
              </button>
            </form>
          </details>
        </div>
      </div>
    </Card>
  );
}

function FollowUpRow({
  followUp,
  leadId,
  next,
  now,
}: {
  followUp: CrmFollowUp;
  leadId: string;
  next: string;
  now: number;
}) {
  const overdue = isFollowUpOverdue(followUp, now);
  return (
    <li className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-[var(--color-ink)]">{formatDateTime(followUp.scheduled_at)}</p>
        <Badge tone={FOLLOWUP_STATUS_TONES[followUp.status as FollowUpStatus] ?? "neutral"}>
          {followUp.status}
        </Badge>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--color-faint)]">
        <span className="capitalize">{humanise(followUp.channel)}</span>
        <span className={overdue ? "text-[var(--color-danger)]" : ""}>
          {dueLabel(followUp.scheduled_at, now)}
        </span>
        <span>{followUp.dispatched_at ? `Dispatched ${timeAgo(followUp.dispatched_at)}` : "Not dispatched"}</span>
        {followUp.ai_generated && <span className="text-[var(--color-gold-300)]">AI drafted</span>}
      </p>
      {followUp.template_name && (
        <p className="mt-1.5 font-mono text-[11px] text-[var(--color-gold-300)]">{followUp.template_name}</p>
      )}
      {followUp.message && (
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">{followUp.message}</p>
      )}
      {followUp.status !== "completed" && (
        <form action="/api/osf/crm" method="POST" className="mt-2">
          <input type="hidden" name="action" value="complete_follow_up" />
          <input type="hidden" name="id" value={followUp.id} />
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="btn-ghost !px-3 !py-1.5 text-xs">
            <CheckCircle size={12} strokeWidth={2} aria-hidden />
            Mark done
          </button>
        </form>
      )}
    </li>
  );
}

function SiteVisits({ visits }: { visits: CrmSiteVisit[] }) {
  if (visits.length === 0) {
    return <Empty>No site visit requested yet.</Empty>;
  }
  return (
    <ul className="space-y-2.5">
      {visits.map((visit) => (
        <li
          key={visit.id}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 px-4 py-3.5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm text-[var(--color-ink)]">
                <MapPin size={13} strokeWidth={1.75} className="text-[var(--color-gold-300)]" aria-hidden />
                {visit.project?.name ?? "Project not recorded"}
                <span className="text-[var(--color-faint)]">· {humanise(visit.visit_type)}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2.5 text-[11px] text-[var(--color-faint)]">
                <span>
                  {visit.scheduled_at
                    ? formatDateTime(visit.scheduled_at)
                    : visit.preferred_date
                      ? `Prefers ${formatDate(visit.preferred_date)}${visit.preferred_time ? `, ${visit.preferred_time}` : ""}`
                      : "No date agreed"}
                </span>
                {visit.visitor_count && <span>{visit.visitor_count} visiting</span>}
                {visit.assignee && <span>Host: {visit.assignee.name}</span>}
                {visit.completed_at && <span>Completed {timeAgo(visit.completed_at)}</span>}
              </p>
            </div>
            <Badge tone={VISIT_TONES[visit.status] ?? "neutral"}>{humanise(visit.status)}</Badge>
          </div>
          {(visit.outcome || visit.feedback || visit.notes) && (
            <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-xs leading-relaxed text-[var(--color-muted)]">
              {[visit.outcome, visit.feedback, visit.notes].filter(Boolean).join(" — ")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Journey({
  touchpoints,
  firstContactAt,
}: {
  touchpoints: CrmTouchpoint[];
  firstContactAt: string;
}) {
  if (touchpoints.length === 0) {
    return (
      <Empty>
        No touchpoint recorded. First contact was {formatDateTime(firstContactAt)} — touchpoints are
        written when a campaign, ad or referrer is attributed to a message.
      </Empty>
    );
  }

  return (
    <div className="-mx-1 overflow-x-auto pb-1">
      <ol className="flex min-w-max items-stretch gap-0 px-1">
        {touchpoints.map((touchpoint, index) => (
          <li key={touchpoint.id} className="flex items-stretch">
            <div className="w-48 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-xs font-medium capitalize text-[var(--color-ink)]">
                <Route size={12} strokeWidth={1.75} className="text-[var(--color-gold-300)]" aria-hidden />
                {humanise(touchpoint.channel)}
              </p>
              {touchpoint.campaign && (
                <p className="mt-1 truncate text-[11px] text-[var(--color-gold-300)]">{touchpoint.campaign}</p>
              )}
              {touchpoint.detail && (
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
                  {touchpoint.detail}
                </p>
              )}
              <p className="mt-2 flex items-center gap-1 text-[10px] text-[var(--color-faint)]">
                <Clock size={10} strokeWidth={2} aria-hidden />
                {formatDateTime(touchpoint.occurred_at)}
                {index > 0 &&
                  (() => {
                    const gap = daysSince(touchpoints[index - 1].occurred_at, new Date(touchpoint.occurred_at).getTime());
                    return gap !== null && gap > 0 ? ` · +${gap}d` : null;
                  })()}
              </p>
            </div>
            {index < touchpoints.length - 1 && (
              <span className="mx-1 self-center text-[var(--color-line-strong)]">→</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
