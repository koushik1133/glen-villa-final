import Link from "next/link";
import {
  ChevronDown,
  CheckCircle,
  XCircle,
  Pause,
  Play,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { BarsChart } from "@/components/osf/charts";
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
  LIVE_TRIGGERS,
  TRIGGER_LABELS,
  describeAction,
  describeCondition,
  listAutomationRuns,
  listAutomations,
  runsByDay,
  type Automation,
} from "@/lib/osf/automations";
import { rosterLanguages, routingState } from "@/lib/osf/routing";
import { RuleBuilder } from "./RuleBuilder";

export const dynamic = "force-dynamic";

/**
 * The rules engine, and its receipts.
 *
 * A rule is data — trigger, conditions, actions — evaluated server-side on the
 * same request that raised the trigger. This page shows every rule as it is
 * actually stored, and every run it produced, because the only trustworthy
 * answer to "did that rule work?" is the run log rather than the rule text.
 */

/** How many runs of the log to show. Enough to see a pattern, not a scroll. */
const RUN_LIMIT = 25;

function triggerTone(automation: Automation): BadgeTone {
  return LIVE_TRIGGERS.has(automation.trigger_event) ? "info" : "neutral";
}

function RuleCard({ automation }: { automation: Automation }) {
  const dormant = !LIVE_TRIGGERS.has(automation.trigger_event);

  return (
    <Card className={automation.is_active ? "" : "opacity-70"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[--color-ink]">{automation.name}</h3>
          {automation.description && (
            <p className="mt-1 text-xs leading-relaxed text-[--color-muted]">
              {automation.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={triggerTone(automation)}>
            {TRIGGER_LABELS[automation.trigger_event] ?? automation.trigger_event}
          </Badge>
          <Badge tone={automation.is_active ? "success" : "neutral"}>
            {automation.is_active ? "ACTIVE" : "PAUSED"}
          </Badge>
        </div>
      </div>

      {automation.is_active && dormant && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-[--color-gold-line] bg-[--color-gold-soft] px-3 py-2 text-[11px] leading-relaxed text-[--color-gold-100]">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          Active, but nothing in this codebase raises{" "}
          <code className="font-mono">{automation.trigger_event}</code> yet, so it will not fire.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label">If</p>
          {automation.conditions.length === 0 ? (
            <p className="mt-1.5 text-xs text-[--color-muted]">
              No conditions — every lead on this trigger.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {automation.conditions.map((c, i) => (
                <li key={`${c.field}-${i}`} className="text-xs text-[--color-ink]">
                  <span className="text-[--color-faint]">{i === 0 ? "" : "and "}</span>
                  {describeCondition(c)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="label">Then</p>
          {automation.actions.length === 0 ? (
            <p className="mt-1.5 text-xs text-[--color-danger]">
              No actions configured — this rule matches and then does nothing.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {automation.actions.map((a, i) => (
                <li key={`${a.type}-${i}`} className="text-xs text-[--color-ink]">
                  {describeAction(a)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[--color-line] pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[--color-faint]">
          <span className="tabular-nums">
            {formatNumber(automation.execution_count)} run
            {automation.execution_count === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>
            {automation.last_executed_at
              ? `last fired ${timeAgo(automation.last_executed_at)}`
              : "never fired"}
          </span>
          <span>·</span>
          <span>created {timeAgo(automation.created_at)}</span>
        </div>

        <div className="flex items-center gap-2">
          <form action="/api/osf/automation" method="POST">
            <input type="hidden" name="intent" value="toggle-rule" />
            <input type="hidden" name="id" value={automation.id} />
            <input type="hidden" name="next" value="/os/automation/workflows" />
            <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
              {automation.is_active ? (
                <>
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  Activate
                </>
              )}
            </button>
          </form>
          <form action="/api/osf/automation" method="POST">
            <input type="hidden" name="intent" value="delete-rule" />
            <input type="hidden" name="id" value={automation.id} />
            <input type="hidden" name="next" value="/os/automation/workflows" />
            <button
              type="submit"
              className="btn-ghost px-3 py-1.5 text-xs text-[--color-muted] hover:text-[--color-danger]"
              title="Deleting a rule deletes its run history too. Pause keeps the audit trail."
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </button>
          </form>
        </div>
      </div>
    </Card>
  );
}

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const page = await gatedLoad({ table: "villa_automations", migration: "001_schema.sql" }, () =>
    Promise.all([
      searchParams,
      listAutomations(),
      listAutomationRuns(RUN_LIMIT),
      runsByDay(14),
      // The builder's language list comes from the roster rather than a free
      // text field, so an assign_lead rule can only name a language some rep
      // actually lists — an unmatchable rule is a rule that silently no-ops.
      routingState().then(rosterLanguages, () => [] as string[]),
    ] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Workflows" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [{ error }, automations, runs, activity, languages] = page.data;

  const active = automations.filter((a) => a.is_active);
  const paused = automations.filter((a) => !a.is_active);
  const dormantActive = active.filter((a) => !LIVE_TRIGGERS.has(a.trigger_event)).length;
  const chart = activity.series.map((d) => ({ label: d.label, ok: d.ok, failed: d.failed }));
  const hasActivity = activity.ok + activity.failed > 0;

  return (
    <>
      <PageHeader
        title="Workflows"
        sub="Trigger, conditions, actions — stored as data and evaluated server-side against the lead row as it actually is. Each action is attempted independently, so a rule that half-worked says which half, and every attempt lands in the run log below."
        actions={
          <Badge tone={active.length > 0 ? "gold" : "neutral"}>
            {active.length} active · {paused.length} paused
          </Badge>
        }
      />

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-[rgba(244,105,95,0.35)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[--color-ink]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[--color-danger]" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Active rules"
          value={formatNumber(active.length)}
          sub={
            dormantActive > 0
              ? `${dormantActive} on a trigger nothing raises yet`
              : `${paused.length} paused`
          }
          gold={active.length > 0}
        />
        <Stat
          label="Lifetime executions"
          value={formatNumber(automations.reduce((s, a) => s + a.execution_count, 0))}
          sub="Across every rule, including deleted-since leads"
        />
        <Stat label="Clean runs · 14 days" value={formatNumber(activity.ok)} />
        <Stat
          label="Failed runs · 14 days"
          value={formatNumber(activity.failed)}
          sub={activity.failed > 0 ? "See the run log for the reason" : "Nothing errored"}
        />
      </div>

      <div className="mb-6 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card
          title="Run activity"
          hint="Last 14 days. A day with no runs is drawn as zero rather than dropped, so a quiet week reads as quiet."
        >
          {hasActivity ? (
            <BarsChart
              data={chart}
              keys={[
                { key: "ok", name: "Succeeded" },
                { key: "failed", name: "Failed" },
              ]}
              height={220}
            />
          ) : (
            <Empty>
              No rule has fired in the last 14 days. Runs appear here the moment a lead trips an
              active rule.
            </Empty>
          )}
        </Card>

        <Card
          title="Run log"
          hint={`The last ${RUN_LIMIT} attempts, newest first, with the per-action outcome as the engine recorded it.`}
        >
          {runs.length === 0 ? (
            <Empty>Nothing has run yet.</Empty>
          ) : (
            <ul className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="rounded-xl border border-[--color-line] bg-[--color-void]/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-xs font-medium text-[--color-ink]">
                      {run.villa_automations?.name ?? "(rule deleted)"}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[--color-faint]">
                      {run.ok ? (
                        <CheckCircle className="h-3.5 w-3.5 text-[--color-success]" aria-hidden />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-[--color-danger]" aria-hidden />
                      )}
                      {timeAgo(run.created_at)}
                    </span>
                  </div>
                  {run.detail && (
                    <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[--color-muted]">
                      {run.detail}
                    </pre>
                  )}
                  {run.lead_id && (
                    <Link
                      href={`/os/crm/leads/${run.lead_id}`}
                      className="mt-1.5 inline-block text-[11px] text-[--color-gold-300] hover:text-[--color-gold-100]"
                    >
                      Open the lead
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[--color-ink]">
                <Plus className="h-4 w-4 text-[--color-gold-500]" aria-hidden />
                New rule
              </h2>
              <p className="mt-1 text-xs text-[--color-muted]">
                Build a trigger, its conditions and the one action it takes.
              </p>
            </div>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-[--color-muted] transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="mt-5 border-t border-[--color-line] pt-5">
            <RuleBuilder languages={languages} />
          </div>
        </details>
      </Card>

      {automations.length === 0 ? (
        <Empty>
          <span className="font-medium text-[--color-ink]">No rules yet.</span>
          <span className="mx-auto mt-2 block max-w-xl">
            Open “New rule” above. Nothing is automated until you write one — this console does not
            ship with hidden defaults acting on your leads.
          </span>
        </Empty>
      ) : (
        <div className="space-y-8">
          {active.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[--color-ink]">
                Active
                <span className="pill bg-[--color-raised] text-[--color-muted]">{active.length}</span>
              </h2>
              <div className="space-y-4">
                {active.map((a) => (
                  <RuleCard key={a.id} automation={a} />
                ))}
              </div>
            </section>
          )}

          {paused.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[--color-ink]">
                Paused
                <span className="pill bg-[--color-raised] text-[--color-muted]">{paused.length}</span>
              </h2>
              <div className="space-y-4">
                {paused.map((a) => (
                  <RuleCard key={a.id} automation={a} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <p className="mt-8 text-xs leading-relaxed text-[--color-faint]">
        Deleting a rule cascades to its runs, which is why pause is the first-class action here — a
        paused rule keeps its audit trail. Message actions queue a follow-up rather than sending
        one, because whether WhatsApp will accept free text depends on the 24-hour window as it
        stands at send time, not as it stood when the rule matched.
      </p>
    </>
  );
}
