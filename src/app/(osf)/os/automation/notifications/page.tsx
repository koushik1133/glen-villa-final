import Link from "next/link";
import {
  ArrowUpRight,
  BellOff,
  CheckCheck,
  Pause,
  Play,
  AlertTriangle,
} from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  PageHeader,
  SetupNotice,
  Stat,
  type BadgeTone,
  formatNumber,
  timeAgo,
} from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import {
  READ_FILTERS,
  listNotifications,
  notificationSummary,
  parseReadFilter,
  type InsightSeverity,
  type Notification,
  type ReadFilter,
} from "@/lib/osf/notifications";
import { listAutomations, notifyingRules, type NotifyingRule } from "@/lib/osf/automations";

export const dynamic = "force-dynamic";

/**
 * The notification centre.
 *
 * Every row was written by something that actually happened — a rule that
 * matched, a handoff, a follow-up coming due. The preferences panel is derived
 * the same way: it lists the rules whose actions genuinely write here, rather
 * than a set of toggles. A toggle with no rule behind it would change nothing
 * when switched, which is worse than not offering it.
 */

const SEVERITY_TONE: Record<InsightSeverity, BadgeTone> = {
  critical: "danger",
  warning: "warning",
  success: "success",
  info: "info",
};

const SEVERITY_RAIL: Record<InsightSeverity, string> = {
  critical: "bg-[--color-danger]",
  warning: "bg-[--color-warm]",
  success: "bg-[--color-success]",
  info: "bg-[--color-info]",
};

/** Rows read per page. Beyond this the filters are the way through the list. */
const LIST_LIMIT = 100;

function href(read: ReadFilter, kind: string | null): string {
  const params = new URLSearchParams();
  if (read !== "all") params.set("read", read);
  if (kind) params.set("kind", kind);
  const query = params.toString();
  return query ? `/os/automation/notifications?${query}` : "/os/automation/notifications";
}

/**
 * A stored `href` is rendered as a link only when it is an in-app path.
 *
 * The column is free text and the engine writes `/os/crm/leads/:id` into it, but a row
 * could come from anywhere; turning an arbitrary string into a link would make
 * this page a redirector for whatever wrote it.
 */
function inAppHref(value: string | null): string | null {
  if (!value || !value.startsWith("/os") || value.startsWith("//")) return null;
  return value;
}

function Chip({
  active,
  to,
  children,
}: {
  active: boolean;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={to}
      className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
        active
          ? "border-[--color-gold-line] bg-[--color-gold-soft] text-[--color-gold-100]"
          : "border-[--color-line] bg-[--color-void]/50 text-[--color-muted] hover:border-[--color-line-strong] hover:text-[--color-ink]"
      }`}
    >
      {children}
    </Link>
  );
}

function NotificationRow({ n, back }: { n: Notification; back: string }) {
  const target = inAppHref(n.href);

  return (
    <li className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
      <span
        className={`mt-1 w-[3px] shrink-0 self-stretch rounded-full ${SEVERITY_RAIL[n.severity]} ${
          n.is_read ? "opacity-20" : ""
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              n.is_read
                ? "text-sm text-[--color-muted]"
                : "text-sm font-semibold text-[--color-ink]"
            }
          >
            {n.title}
          </span>
          <Badge tone={SEVERITY_TONE[n.severity]}>{n.severity.toUpperCase()}</Badge>
        </div>
        {n.description && (
          <p className="mt-1 text-xs leading-relaxed text-[--color-muted]">{n.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[--color-faint]">
          <Link href={href("all", n.kind)} className="font-mono hover:text-[--color-gold-100]">
            {n.kind}
          </Link>
          <span>·</span>
          <span>{timeAgo(n.created_at)}</span>
          {target && (
            <>
              <span>·</span>
              <Link
                href={target}
                className="inline-flex items-center gap-1 font-medium text-[--color-gold-300] hover:text-[--color-gold-100]"
              >
                Open
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            </>
          )}
        </div>
      </div>

      {!n.is_read && (
        <form action="/api/osf/automation" method="POST" className="shrink-0">
          <input type="hidden" name="intent" value="mark-read" />
          <input type="hidden" name="id" value={n.id} />
          <input type="hidden" name="next" value={back} />
          <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
            Mark read
          </button>
        </form>
      )}
    </li>
  );
}

function SourceRule({ rule, back }: { rule: NotifyingRule; back: string }) {
  return (
    <div className="rounded-xl border border-[--color-line] bg-[--color-void]/40 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[--color-ink]">{rule.automation.name}</p>
          <Link
            href={href("all", rule.kind)}
            className="mt-0.5 inline-block font-mono text-[11px] text-[--color-faint] hover:text-[--color-gold-100]"
          >
            {rule.kind}
          </Link>
        </div>
        <Badge tone={rule.automation.is_active ? "success" : "neutral"}>
          {rule.automation.is_active ? "WRITING" : "PAUSED"}
        </Badge>
      </div>

      <ul className="mt-2.5 space-y-1">
        {rule.notices.map((n, i) => (
          <li key={`${n.title}-${i}`} className="flex items-center gap-2 text-xs">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_RAIL[n.severity]}`} />
            <span className="min-w-0 truncate text-[--color-ink]">{n.title}</span>
            <span className="shrink-0 text-[11px] text-[--color-faint]">{n.severity}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[--color-line] pt-2.5">
        <span className="text-[11px] tabular-nums text-[--color-faint]">
          {formatNumber(rule.automation.execution_count)} run
          {rule.automation.execution_count === 1 ? "" : "s"}
        </span>
        <form action="/api/osf/automation" method="POST">
          <input type="hidden" name="intent" value="toggle-rule" />
          <input type="hidden" name="id" value={rule.automation.id} />
          <input type="hidden" name="next" value={back} />
          <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
            {rule.automation.is_active ? (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden />
                Stop these
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden />
                Resume
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ read?: string; kind?: string; error?: string }>;
}) {
  const params = await searchParams;
  const read = parseReadFilter(params.read);
  // `kind` is used only as an equality filter on a text column, so an unknown
  // value simply matches nothing — no narrowing list is needed or honest here,
  // since kinds are minted by whatever wrote the row.
  const kind = typeof params.kind === "string" && params.kind.trim() !== "" ? params.kind : null;

  const page = await gatedLoad({ table: "villa_notifications", migration: "001_schema.sql" }, () =>
    Promise.all([
      listNotifications({ read, kind, limit: LIST_LIMIT }),
      notificationSummary(),
      listAutomations(),
    ] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Notifications" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [notifications, summary, automations] = page.data;
  const sources = notifyingRules(automations);
  const back = href(read, kind);
  const activeSources = sources.filter((s) => s.automation.is_active).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        sub="Written only by things that happened — a rule that matched, a handoff, a follow-up falling due. Nothing on this page is generated to fill it, so an empty list means a quiet system rather than a broken one."
        actions={
          summary.unread > 0 ? (
            <form action="/api/osf/automation" method="POST">
              <input type="hidden" name="intent" value="mark-all-read" />
              <input type="hidden" name="next" value={back} />
              <button type="submit" className="btn-gold">
                <CheckCheck className="h-4 w-4" aria-hidden />
                Mark all read
              </button>
            </form>
          ) : (
            <Badge tone="success">All caught up</Badge>
          )
        }
      />

      {params.error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-[rgba(244,105,95,0.35)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[--color-ink]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[--color-danger]" aria-hidden />
          <span>{params.error}</span>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Unread"
          value={formatNumber(summary.unread)}
          sub={`${formatNumber(summary.total)} in total`}
          gold={summary.unread > 0}
        />
        {summary.bySeverity
          .filter((s) => s.severity !== "info")
          .map((s) => (
            <Stat
              key={s.severity}
              label={`${s.severity[0].toUpperCase()}${s.severity.slice(1)}`}
              value={formatNumber(s.total)}
              sub={summary.capped ? "At least — the breakdown is capped" : undefined}
            />
          ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {READ_FILTERS.map((f) => (
                <Chip key={f.key} active={read === f.key} to={href(f.key, kind)}>
                  {f.label}
                  {f.key === "unread" && summary.unread > 0 && (
                    <span className="ml-1.5 tabular-nums text-[--color-gold-300]">
                      {summary.unread}
                    </span>
                  )}
                </Chip>
              ))}
              {kind && (
                <Chip active to={href(read, null)}>
                  <span className="font-mono">{kind}</span> ✕
                </Chip>
              )}
            </div>

            {notifications.length === 0 ? (
              <Empty
                action={
                  read !== "all" || kind ? (
                    <Link href="/os/automation/notifications" className="btn-ghost">
                      Clear filters
                    </Link>
                  ) : (
                    <Link href="/os/automation/workflows" className="btn-ghost">
                      Open Workflows
                      <ArrowUpRight className="h-4 w-4" aria-hidden />
                    </Link>
                  )
                }
              >
                {read !== "all" || kind ? (
                  <>
                    <span className="font-medium text-[--color-ink]">Nothing matches.</span>
                    <span className="mx-auto mt-2 block max-w-md">
                      {summary.total > 0
                        ? `There ${summary.total === 1 ? "is" : "are"} ${formatNumber(summary.total)} notification${summary.total === 1 ? "" : "s"} outside this filter.`
                        : "There are no notifications at all yet."}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-[--color-ink]">Nothing has happened yet.</span>
                    <span className="mx-auto mt-2 block max-w-md">
                      Rules with a “create a notification” action write here when they match. Until
                      one exists and fires, this stays empty.
                    </span>
                  </>
                )}
              </Empty>
            ) : (
              <>
                <ul className="divide-y divide-[--color-line]">
                  {notifications.map((n) => (
                    <NotificationRow key={n.id} n={n} back={back} />
                  ))}
                </ul>
                {notifications.length >= LIST_LIMIT && (
                  <p className="mt-4 border-t border-[--color-line] pt-3 text-[11px] text-[--color-faint]">
                    Showing the newest {LIST_LIMIT}. Narrow by kind or read state to reach older
                    rows.
                  </p>
                )}
              </>
            )}
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card
            title="By kind"
            hint={
              summary.capped
                ? `Derived from the newest rows only, so these are floors. The headline totals above are exact.`
                : "Every kind currently on the table."
            }
          >
            {summary.byKind.length === 0 ? (
              <Empty>Nothing recorded yet.</Empty>
            ) : (
              <ul className="space-y-1">
                {summary.byKind.map((k) => (
                  <li key={k.kind}>
                    <Link
                      href={href(read, k.kind)}
                      className={`flex items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-xs transition hover:bg-[--color-raised] ${
                        kind === k.kind ? "bg-[--color-gold-soft]" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate font-mono text-[--color-ink]">{k.kind}</span>
                      <span className="shrink-0 tabular-nums text-[--color-muted]">
                        {k.unread > 0 && (
                          <span className="text-[--color-gold-300]">{k.unread} new · </span>
                        )}
                        {formatNumber(k.total)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="What can notify you"
            hint="Derived from the rules that actually contain a “create a notification” action — not a toggle list. Pausing a rule here is the same write as pausing it on Workflows, because it is the same rule."
            actions={
              <Badge tone={activeSources > 0 ? "gold" : "neutral"}>
                {activeSources} writing
              </Badge>
            }
          >
            {sources.length === 0 ? (
              <Empty
                action={
                  <Link href="/os/automation/workflows" className="btn-ghost">
                    Create a rule
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                }
              >
                <BellOff className="mx-auto mb-3 h-5 w-5 text-[--color-faint]" aria-hidden />
                <span className="font-medium text-[--color-ink]">
                  No rule writes notifications.
                </span>
                <span className="mx-auto mt-2 block max-w-md">
                  Rows can still arrive from handoffs and due follow-ups, but nothing you configured
                  is producing them. Add a rule with a notify action to change that.
                </span>
              </Empty>
            ) : (
              <div className="space-y-3">
                {sources.map((s) => (
                  <SourceRule key={s.automation.id} rule={s} back={back} />
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
