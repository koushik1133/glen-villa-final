import Link from "next/link";
import {
  ArrowUpRight,
  Ban,
  Languages,
  Pause,
  Play,
  Scale,
  AlertTriangle,
  UserPlus,
} from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatCr,
  formatNumber,
  formatPercent,
  timeAgo,
} from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import {
  CONDITION_FIELDS,
  OPERATOR_LABELS,
  describeAction,
  describeCondition,
  listAutomations,
  routingRules,
  type Automation,
} from "@/lib/osf/automations";
import { rosterLanguages, routingState, type RoutingRep, type RoutingState } from "@/lib/osf/routing";

export const dynamic = "force-dynamic";

/**
 * Who gets the next lead, and why.
 *
 * There is exactly one picker in this codebase — `pickAssignee` in
 * src/lib/routing.ts — and both surfaces on this page go through it: the manual
 * rebalance calls it in bulk, and a language/expertise rule is stored as an
 * ordinary villa_automations row (trigger `lead_created`, action `assign_lead`)
 * so the automations engine evaluates it per lead at arrival. That is
 * deliberate. A second routing engine living here would eventually disagree
 * with the first about who is loaded, and neither would be checkable against
 * the run log on /automation/workflows.
 */

function RepRow({ rep, busiest }: { rep: RoutingRep; busiest: number }) {
  return (
    <tr className="row-hover border-t border-[var(--color-line)]">
      <td className="td">
        <div className="font-medium text-[var(--color-ink)]">{rep.name}</div>
        <div className="mt-0.5 text-[11px] capitalize text-[var(--color-faint)]">
          {rep.role.replace(/_/g, " ")} · {rep.department}
        </div>
      </td>
      <td className="td">
        {rep.languages.length === 0 ? (
          <span className="text-xs text-[var(--color-faint)]">Not recorded</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {rep.languages.map((l) => (
              <span key={l} className="pill bg-[var(--color-raised)] text-[var(--color-muted)]">
                {l}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="td w-48">
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="tabular-nums text-[var(--color-ink)]">{formatNumber(rep.open_leads)}</span>
          <span className="tabular-nums text-[var(--color-faint)]">
            {rep.hot_open_leads > 0 ? `${rep.hot_open_leads} hot` : "—"}
          </span>
        </div>
        <Meter value={rep.open_leads} max={busiest} />
      </td>
      <td className="td text-right tabular-nums text-[var(--color-muted)]">
        {formatNumber(rep.total_leads)}
      </td>
      <td className="td text-right tabular-nums text-[var(--color-muted)]">
        {rep.quota_inr === null ? (
          <span className="text-[var(--color-faint)]">Off quota</span>
        ) : (
          formatCr(rep.quota_inr)
        )}
      </td>
    </tr>
  );
}

function RoutingRuleCard({ automation }: { automation: Automation }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[var(--color-ink)]">{automation.name}</h3>
          {automation.description && (
            <p className="mt-1 text-xs text-[var(--color-muted)]">{automation.description}</p>
          )}
        </div>
        <Badge tone={automation.is_active ? "success" : "neutral"}>
          {automation.is_active ? "ACTIVE" : "PAUSED"}
        </Badge>
      </div>

      <ul className="mt-3 space-y-1 text-xs text-[var(--color-ink)]">
        {automation.conditions.map((c, i) => (
          <li key={`${c.field}-${i}`}>
            <span className="text-[var(--color-faint)]">{i === 0 ? "If " : "and "}</span>
            {describeCondition(c)}
          </li>
        ))}
        {automation.conditions.length === 0 && (
          <li className="text-[var(--color-muted)]">Every new lead.</li>
        )}
        {automation.actions.map((a, i) => (
          <li key={`${a.type}-${i}`}>
            <span className="text-[var(--color-faint)]">Then </span>
            {describeAction(a)}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-2.5">
        <span className="text-[11px] tabular-nums text-[var(--color-faint)]">
          {formatNumber(automation.execution_count)} run
          {automation.execution_count === 1 ? "" : "s"} ·{" "}
          {automation.last_executed_at
            ? `last fired ${timeAgo(automation.last_executed_at)}`
            : "never fired"}
        </span>
        <form action="/api/osf/automation" method="POST">
          <input type="hidden" name="intent" value="toggle-rule" />
          <input type="hidden" name="id" value={automation.id} />
          <input type="hidden" name="next" value="/inbox/whatsapp/automation/routing" />
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
      </div>
    </div>
  );
}

/**
 * The rule form.
 *
 * A plain server-rendered form: nothing here needs client state, and posting
 * natively means the rule that gets stored is the one the route handler parsed
 * rather than one this page assembled.
 */
function RoutingRuleForm({ state, languages }: { state: RoutingState; languages: string[] }) {
  return (
    <form action="/api/osf/automation" method="POST" className="space-y-4">
      <input type="hidden" name="intent" value="create-routing-rule" />
      <input type="hidden" name="next" value="/inbox/whatsapp/automation/routing" />

      <label className="block">
        <span className="label">Name</span>
        <input
          name="name"
          placeholder="Left blank, one is written from the rule itself"
          className="field mt-1.5"
        />
      </label>

      <fieldset className="rounded-xl border border-[var(--color-line)] p-4">
        <legend className="label px-1.5">Match these leads</legend>
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
          Optional. Leave the value blank and the rule applies to every new lead.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <select name="condition0Field" defaultValue="preferred_language" className="field">
            {CONDITION_FIELDS.map((f) => (
              <option key={f.field} value={f.field}>
                {f.label}
              </option>
            ))}
          </select>
          <select name="condition0Operator" defaultValue="equals" className="field">
            {(Object.keys(OPERATOR_LABELS) as Array<keyof typeof OPERATOR_LABELS>).map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </option>
            ))}
          </select>
          <input name="condition0Value" placeholder="Value (blank = any)" className="field" />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-[var(--color-line)] p-4">
        <legend className="label px-1.5">Route them to</legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">A rep who speaks</span>
            <select name="actionLanguage" defaultValue="" className="field mt-1.5">
              <option value="">Any language</option>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Or pin to one rep</span>
            <select name="actionMemberId" defaultValue="" className="field mt-1.5">
              <option value="">No — balance across the rota</option>
              {state.eligible.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 space-y-2.5">
          <label className="flex items-start gap-2.5 text-sm text-[var(--color-ink)]">
            <input
              type="checkbox"
              name="actionMatchLeadLanguage"
              className="mt-0.5 size-4 accent-[var(--color-gold-500)]"
            />
            <span>
              Match the lead&apos;s own preferred language
              <span className="mt-0.5 block text-[11px] text-[var(--color-faint)]">
                Per lead, and it overrides the language chosen above.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-[var(--color-ink)]">
            <input
              type="checkbox"
              name="actionReassign"
              className="mt-0.5 size-4 accent-[var(--color-gold-500)]"
            />
            <span>
              Reassign leads that already have an owner
              <span className="mt-0.5 block text-[11px] text-[var(--color-faint)]">
                Off by default — a rep mid-conversation should not lose the lead under them.
              </span>
            </span>
          </label>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
          Among the reps that match, the one holding the fewest open leads wins. If nobody matches,
          the action is skipped and the reason is written to the run log — the lead is never handed
          to a rep who does not meet the rule.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2.5 text-sm text-[var(--color-ink)]">
          <input type="checkbox" name="isActive" className="size-4 accent-[var(--color-gold-500)]" />
          Activate immediately
        </label>
        <button type="submit" className="btn-gold" disabled={state.eligible.length === 0}>
          <UserPlus className="h-4 w-4" aria-hidden />
          Create routing rule
        </button>
      </div>
    </form>
  );
}

export default async function RoutingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const page = await gatedLoad({ table: "villa_team_members", migration: "001_schema.sql" }, () =>
    Promise.all([searchParams, routingState(), listAutomations()] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Routing" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [{ error }, state, automations] = page.data;
  const rules = routingRules(automations);
  const languages = rosterLanguages(state);

  const totalOpen = state.assignedOpen + state.unassignedOpen;
  const coverage = totalOpen > 0 ? (state.assignedOpen / totalOpen) * 100 : null;
  const busiest = state.eligible.reduce((m, r) => Math.max(m, r.open_leads), 0);
  const lightest = state.eligible.length > 0 ? Math.min(...state.eligible.map((r) => r.open_leads)) : 0;
  const spread = state.eligible.length > 0 ? busiest - lightest : 0;

  return (
    <>
      <PageHeader
        title="Routing"
        sub="One picker decides who gets a lead: the least-loaded rep who is active, accepting leads, and matches the rule. Load is counted in open leads rather than lifetime volume, so a rep who closes deals gets capacity back instead of being starved for being good."
        actions={
          <Badge tone={state.eligible.length > 0 ? "gold" : "danger"}>
            {state.eligible.length} on the rota
          </Badge>
        }
      />

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-[color-mix(in_oklab,var(--c-bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] p-4 text-sm text-[var(--color-ink)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {state.sampled && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] p-4 text-sm text-[var(--color-ink)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-gold-300)]" aria-hidden />
          <span>
            The load pass hit its row ceiling, so the per-rep counts below are a floor rather than
            an exact total. Balance decisions made from them still favour the lighter book, but the
            absolute numbers understate.
          </span>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Unassigned open leads"
          value={formatNumber(state.unassignedOpen)}
          sub={coverage === null ? "No open leads" : `${formatPercent(coverage)} of open leads owned`}
          gold={state.unassignedOpen > 0}
        />
        <Stat
          label="Assigned open leads"
          value={formatNumber(state.assignedOpen)}
          sub="Neither booked nor lost"
        />
        <Stat
          label="Reps accepting leads"
          value={formatNumber(state.eligible.length)}
          sub={state.standby.length > 0 ? `${state.standby.length} active but opted out` : "Whole roster on the rota"}
        />
        <Stat
          label="Heaviest minus lightest"
          value={state.eligible.length === 0 ? "—" : formatNumber(spread)}
          sub={
            state.eligible.length === 0
              ? "Nobody on the rota"
              : spread === 0
                ? "The rota is level"
                : `${busiest} at the top, ${lightest} at the bottom`
          }
        />
      </div>

      <div className="mb-6 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card
          title="The rota"
          hint="Eligibility is is_active AND accepts_leads — the columns the schema provides for this decision. Role is not a filter, or every property consultant would be excluded by default."
        >
          {state.eligible.length === 0 ? (
            <Empty>
              {state.standby.length > 0 ? (
                <>
                  <span className="font-medium text-[var(--color-ink)]">Nobody is accepting leads.</span>
                  <span className="mx-auto mt-2 block max-w-md">
                    {state.standby.length} active team member
                    {state.standby.length === 1 ? " has" : "s have"} “accepts leads” switched off, so
                    every assign action is skipped rather than guessing an owner. Switch it back on
                    from Team &amp; Roles.
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium text-[var(--color-ink)]">The roster is empty.</span>
                  <span className="mx-auto mt-2 block max-w-md">
                    Add active rows to villa_team_members and routing has someone to route to.
                    Until then leads stay unassigned rather than being handed to a placeholder.
                  </span>
                </>
              )}
            </Empty>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <th className="th">Rep</th>
                    <th className="th">
                      <span className="inline-flex items-center gap-1.5">
                        <Languages className="h-3 w-3" aria-hidden />
                        Languages
                      </span>
                    </th>
                    <th className="th">Open load</th>
                    <th className="th text-right">Lifetime</th>
                    <th className="th text-right">Quota</th>
                  </tr>
                </thead>
                <tbody>
                  {[...state.eligible]
                    .sort((a, b) => a.open_leads - b.open_leads || a.name.localeCompare(b.name))
                    .map((rep) => (
                      <RepRow key={rep.id} rep={rep} busiest={Math.max(busiest, 1)} />
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {state.standby.length > 0 && (
            <div className="mt-5 border-t border-[var(--color-line)] pt-4">
              <p className="label flex items-center gap-1.5">
                <Ban className="h-3 w-3" aria-hidden />
                Active, not accepting leads
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {state.standby.map((rep) => (
                  <span
                    key={rep.id}
                    className="pill bg-[var(--color-raised)] text-[var(--color-muted)]"
                    title={`${rep.open_leads} open leads still on their book`}
                  >
                    {rep.name} · {formatNumber(rep.open_leads)} open
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
                Shown so an empty or short rota is explicable. They keep the leads they already
                hold; they are simply out of the rotation for new ones.
              </p>
            </div>
          )}
        </Card>

        <Card
          title="Rebalance"
          hint="Deals every unassigned open lead across the rota, starting from each rep's current load rather than from zero — so it levels the board instead of stacking the same number of new leads onto very different books."
        >
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-4">
            <p className="label">Waiting for an owner</p>
            <p className="stat mt-1.5">{formatNumber(state.unassignedOpen)}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
              {state.unassignedOpen === 0
                ? "Every open lead has an owner."
                : state.eligible.length === 0
                  ? "Nobody on the rota can take them — switch “accepts leads” on for at least one rep first."
                  : `They would land on ${state.eligible.length} rep${state.eligible.length === 1 ? "" : "s"}, lightest book first.`}
            </p>
          </div>

          <form action="/api/osf/automation" method="POST" className="mt-4">
            <input type="hidden" name="intent" value="rebalance" />
            <input type="hidden" name="next" value="/inbox/whatsapp/automation/routing" />
            <button
              type="submit"
              className="btn-gold w-full"
              disabled={state.unassignedOpen === 0 || state.eligible.length === 0}
            >
              <Scale className="h-4 w-4" aria-hidden />
              Rebalance unassigned
            </button>
          </form>

          <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
            Load-only: no language or expertise matching happens here, because a bulk pass cannot
            reason about an individual lead as well as a rule that fires the moment it arrives.
            Write that as a rule below. One summary row goes to the activity feed, not one per
            lead.
          </p>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Language & expertise rules"
          hint="Each is an ordinary automation — trigger “lead created”, action “assign to a rep” — so it runs through the same engine and lands in the same run log as everything on Workflows. There is deliberately no second routing engine here."
          actions={
            <Link
              href="/inbox/whatsapp/automation/workflows"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-gold-300)] hover:text-[var(--color-gold-100)]"
            >
              Run log
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        >
          {rules.length === 0 ? (
            <Empty>
              <span className="font-medium text-[var(--color-ink)]">No routing rules yet.</span>
              <span className="mx-auto mt-2 block max-w-md">
                Without one, new leads arrive unassigned and wait for a rebalance. A rule assigns
                them the moment they land.
              </span>
            </Empty>
          ) : (
            <div className="space-y-3">
              {rules.map((r) => (
                <RoutingRuleCard key={r.id} automation={r} />
              ))}
            </div>
          )}
        </Card>

        <Card
          title="New routing rule"
          hint={
            languages.length === 0
              ? "No language is recorded against any team member, so language matching has nothing to match on yet."
              : `Languages offered are the ones actually listed on the roster: ${languages.join(", ")}.`
          }
        >
          <RoutingRuleForm state={state} languages={languages} />
        </Card>
      </div>
    </>
  );
}
