import Link from "next/link";
import { CheckCircle, Plus, Send, AlertTriangle } from "lucide-react";
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
  COMM_CHANNELS,
  FOLLOWUP_STATUS_TONES,
  UNASSIGNED,
  dueLabel,
  formatDateTime,
  humanise,
  isFollowUpOverdue,
  leadOptions,
  listFollowUps,
  teamMembers,
  type CrmFollowUp,
  type FollowUpStatus,
  type LeadRef,
  type TeamRef,
} from "@/lib/osf/crm";
import { SERVICE_WINDOW_HOURS } from "@/lib/osf/communication";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

const BASE = "/os/crm/follow-ups";

/**
 * Follow-ups, bucketed by when they are actually due rather than by the status
 * column. `status` only moves when somebody edits the row; a follow-up that was
 * scheduled for Tuesday and forgotten still says 'pending' on Friday. Every
 * bucket below is derived from `scheduled_at` against the current clock.
 */
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string; error?: string }>;
}) {
  const { rep, error } = await searchParams;

  // Loaded unfiltered so the owner picker keeps counting everybody's queue
  // while one of them is selected; the filter is applied in memory below.
  const page = await gatedLoad({ table: "villa_follow_ups", migration: "001_schema.sql" }, () =>
    Promise.all([listFollowUps(), teamMembers(), leadOptions(150)] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Follow-ups" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [everyFollowUp, team, leads] = page.data;
  const now = Date.now();
  const next = rep ? `${BASE}?rep=${encodeURIComponent(rep)}` : BASE;

  const followUps = rep ? everyFollowUp.filter((row) => ownerKey(row) === rep) : everyFollowUp;
  const openOnes = followUps.filter((row) => row.status !== "completed");
  const overdue = openOnes.filter((row) => isFollowUpOverdue(row, now));
  const today = openOnes.filter((row) => !isFollowUpOverdue(row, now) && isToday(row.scheduled_at, now));
  const upcoming = openOnes.filter(
    (row) => !isFollowUpOverdue(row, now) && !isToday(row.scheduled_at, now),
  );
  const closed = followUps.filter((row) => row.status === "completed");

  const dispatched = followUps.filter((row) => row.dispatched_at).length;
  // Outside Meta's 24h window a WhatsApp follow-up can only go out as an
  // approved template. One scheduled without a template name is a send that may
  // simply be refused, so it is worth counting before the hour arrives.
  const templateless = openOnes.filter(
    (row) => row.channel === "whatsapp" && !row.template_name,
  ).length;

  const sections: Array<{ key: string; title: string; hint: string; rows: CrmFollowUp[] }> = [
    {
      key: "overdue",
      title: "Overdue",
      hint: "The scheduled moment has passed and nobody has closed these out.",
      rows: overdue,
    },
    { key: "today", title: "Due today", hint: "Still inside today.", rows: today },
    { key: "upcoming", title: "Upcoming", hint: "Scheduled ahead.", rows: upcoming },
    {
      key: "closed",
      title: "Completed",
      hint: "Marked done by a rep or by the dispatcher.",
      rows: closed,
    },
  ];

  return (
    <>
      <PageHeader
        title="Follow-ups"
        sub="Scheduled nudges, by channel. Nothing here is sent automatically unless an automation owns it — dispatch state is shown per row so a plan is never mistaken for a delivery."
        actions={<RepFilter team={team} active={rep} counts={countByRep(everyFollowUp)} />}
      />

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-[rgba(244,105,95,0.3)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[--color-danger]">
          <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open" value={formatNumber(openOnes.length)} sub={`${formatNumber(followUps.length)} on record`} />
        <Stat
          label="Overdue"
          value={formatNumber(overdue.length)}
          sub={overdue.length ? "Past the scheduled time" : "Nothing has slipped"}
          gold={overdue.length > 0}
        />
        <Stat label="Dispatched" value={formatNumber(dispatched)} sub="Actually left the building" />
        <Stat
          label="WhatsApp, no template"
          value={formatNumber(templateless)}
          sub={`Rejected by Meta if the ${SERVICE_WINDOW_HOURS}h window has closed`}
        />
      </div>

      <NewFollowUpForm team={team} leads={leads} next={next} />

      {followUps.length === 0 ? (
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
                Nothing is owned by that person. {formatNumber(everyFollowUp.length)} follow-up
                {everyFollowUp.length === 1 ? "" : "s"} exist across the team.
              </>
            ) : (
              <>
                <code className="rounded bg-[--color-canvas] px-1.5 py-0.5 text-xs">
                  villa_follow_ups
                </code>{" "}
                is empty. Schedule one above, from a lead&rsquo;s page, or let an automation write one
                when a conversation goes quiet.
              </>
            )}
          </Empty>
        </Card>
      ) : (
        <div className="mt-5 space-y-5">
          {sections
            .filter((section) => section.rows.length > 0)
            .map((section) => (
              <Card
                key={section.key}
                title={section.title}
                hint={section.hint}
                actions={
                  <span className="text-[11px] tabular-nums text-[--color-faint]">
                    {formatNumber(section.rows.length)}
                  </span>
                }
              >
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead className="border-b border-[--color-line]">
                      <tr>
                        <th className="th">Lead</th>
                        <th className="th">Due</th>
                        <th className="th">Channel</th>
                        <th className="th">Message</th>
                        <th className="th">Owner</th>
                        <th className="th">Dispatch</th>
                        <th className="th text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[--color-line]">
                      {section.rows.map((row) => (
                        <FollowUpRow key={row.id} row={row} next={next} now={now} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
        </div>
      )}
    </>
  );
}

function isToday(iso: string, now: number): boolean {
  const at = new Date(iso);
  const today = new Date(now);
  return (
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate()
  );
}

/** Owner id, or the sentinel the filter uses for "nobody owns this". */
function ownerKey(row: CrmFollowUp): string {
  return row.assigned_to ?? UNASSIGNED;
}

function countByRep(rows: CrmFollowUp[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "completed") continue;
    counts.set(ownerKey(row), (counts.get(ownerKey(row)) ?? 0) + 1);
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
        Owner
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

function FollowUpRow({ row, next, now }: { row: CrmFollowUp; next: string; now: number }) {
  const overdue = isFollowUpOverdue(row, now);

  return (
    <tr className="row-hover">
      <td className="td">
        {row.lead ? (
          <Link
            href={`/os/crm/leads/${row.lead.id}`}
            className="font-medium text-[--color-ink] hover:text-[--color-gold-300]"
          >
            {row.lead.name?.trim() || `+${row.lead.phone}`}
          </Link>
        ) : (
          <span className="text-[--color-faint]">Lead removed</span>
        )}
        {row.lead?.name && (
          <span className="mt-0.5 block text-[11px] text-[--color-muted]">+{row.lead.phone}</span>
        )}
      </td>

      <td className="td whitespace-nowrap">
        <span className="text-sm tabular-nums">{formatDateTime(row.scheduled_at)}</span>
        <span
          className={`mt-0.5 block text-[11px] ${overdue ? "font-medium text-[--color-danger]" : "text-[--color-muted]"}`}
        >
          {dueLabel(row.scheduled_at, now)}
        </span>
      </td>

      <td className="td text-xs capitalize">{humanise(row.channel)}</td>

      <td className="td max-w-sm">
        {row.template_name ? (
          <span className="font-mono text-[11px] text-[--color-gold-300]">{row.template_name}</span>
        ) : (
          <span className="text-[11px] text-[--color-faint]">
            {row.channel === "whatsapp" ? "Free text — no template recorded" : "Free text"}
          </span>
        )}
        {row.message && (
          <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-[--color-muted]">
            {row.message}
          </span>
        )}
        {row.ai_generated && (
          <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-[--color-gold-300]">
            AI drafted
          </span>
        )}
      </td>

      <td className="td text-xs">
        {row.assignee?.name ?? <span className="text-[--color-faint]">Unassigned</span>}
      </td>

      <td className="td whitespace-nowrap text-xs">
        {row.dispatched_at ? (
          <span className="inline-flex items-center gap-1 text-[--color-success]">
            <Send size={11} strokeWidth={2} aria-hidden />
            {timeAgo(row.dispatched_at)}
          </span>
        ) : (
          <span className="text-[--color-faint]">Not sent</span>
        )}
      </td>

      <td className="td text-right">
        <div className="flex items-center justify-end gap-2">
          <Badge tone={FOLLOWUP_STATUS_TONES[row.status as FollowUpStatus] ?? "neutral"}>
            {humanise(row.status)}
          </Badge>
          {row.status !== "completed" && (
            <form action="/api/osf/crm" method="POST">
              <input type="hidden" name="action" value="complete_follow_up" />
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="leadId" value={row.lead_id} />
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="btn-ghost !px-3 !py-1.5 text-xs">
                <CheckCircle size={12} strokeWidth={2} aria-hidden />
                Done
              </button>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}

function NewFollowUpForm({
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
      <summary className="cursor-pointer list-none text-sm font-semibold text-[--color-ink]">
        <span className="inline-flex items-center gap-2">
          <Plus size={14} strokeWidth={2} className="text-[--color-gold-300]" aria-hidden />
          Schedule a follow-up
        </span>
        <span className="ml-2 text-xs font-normal text-[--color-muted]">
          Records the intent. Delivery is a separate step.
        </span>
      </summary>

      <form action="/api/osf/crm" method="POST" className="mt-4 grid gap-3 lg:grid-cols-12">
        <input type="hidden" name="action" value="create_follow_up" />
        <input type="hidden" name="next" value={next} />

        <div className="lg:col-span-3">
          <label className="label" htmlFor="fu-lead">
            Lead
          </label>
          <select id="fu-lead" name="leadId" required defaultValue="" className="field mt-1.5">
            <option value="" disabled>
              Choose a lead
            </option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.name?.trim() || `+${lead.phone}`}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-3">
          <label className="label" htmlFor="fu-when">
            When
          </label>
          <input
            id="fu-when"
            type="datetime-local"
            name="scheduledAt"
            required
            className="field mt-1.5"
          />
        </div>

        <div className="lg:col-span-2">
          <label className="label" htmlFor="fu-channel">
            Channel
          </label>
          <select id="fu-channel" name="channel" defaultValue="whatsapp" className="field mt-1.5">
            {COMM_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {humanise(channel)}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-2">
          <label className="label" htmlFor="fu-owner">
            Owner
          </label>
          <select id="fu-owner" name="assignedTo" defaultValue="" className="field mt-1.5">
            <option value="">Unassigned</option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-2">
          <label className="label" htmlFor="fu-template">
            Template
          </label>
          <input
            id="fu-template"
            name="templateName"
            placeholder="site_visit_reminder"
            className="field mt-1.5 font-mono text-xs"
          />
        </div>

        <div className="lg:col-span-10">
          <label className="label" htmlFor="fu-message">
            Message
          </label>
          <input
            id="fu-message"
            name="message"
            placeholder="What the rep should say"
            className="field mt-1.5"
          />
        </div>

        <div className="flex items-end lg:col-span-2">
          <button type="submit" className="btn-gold w-full justify-center">
            Schedule
          </button>
        </div>

        <p className="text-xs leading-relaxed text-[--color-muted] lg:col-span-12">
          On WhatsApp, free text is only legal within {SERVICE_WINDOW_HOURS} hours of the
          customer&rsquo;s last message. If this is scheduled beyond that, name an approved template
          or Meta will refuse the send.
        </p>
      </form>
    </details>
  );
}
