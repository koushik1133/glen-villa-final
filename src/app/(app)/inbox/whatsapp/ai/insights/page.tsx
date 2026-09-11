import Link from "next/link";
import { ArrowUpRight, RefreshCw, AlertTriangle } from "lucide-react";
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
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  THRESHOLDS,
  listInsights,
  type AiInsight,
  type InsightSeverity,
} from "@/lib/osf/insights";

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<InsightSeverity, BadgeTone> = {
  critical: "danger",
  warning: "warning",
  info: "info",
  success: "success",
};

const SEVERITY_RAIL: Record<InsightSeverity, string> = {
  critical: "border-l-[var(--color-danger)]",
  warning: "border-l-[var(--color-warm)]",
  info: "border-l-[var(--color-info)]",
  success: "border-l-[var(--color-success)]",
};

function InsightCard({ insight }: { insight: AiInsight }) {
  const details = insight.evidence.filter((e) => e.detail);

  return (
    <Card className={`border-l-4 ${SEVERITY_RAIL[insight.severity]}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">{insight.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">
            {insight.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={SEVERITY_TONE[insight.severity]}>{insight.severity.toUpperCase()}</Badge>
          <span className="label">{insight.generated_by_ai ? "AI summary" : "Rule"}</span>
        </div>
      </div>

      {insight.evidence.length > 0 && (
        <dl className="mt-4 grid gap-x-6 gap-y-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-3.5 sm:grid-cols-2">
          {insight.evidence.map((e, i) => (
            <div key={`${e.label}-${i}`} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-[var(--color-muted)]">{e.label}</dt>
              <dd className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {details.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {details.map((e, i) => (
            <li key={`detail-${i}`} className="text-[11px] text-[var(--color-faint)]">
              {e.detail}
            </li>
          ))}
        </ul>
      )}

      {(insight.recommendation || insight.expected_impact) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {insight.recommendation && (
            <div>
              <p className="label">What to do</p>
              <p className="mt-1 text-sm text-[var(--color-ink)]">{insight.recommendation}</p>
            </div>
          )}
          {insight.expected_impact && (
            <div>
              <p className="label">Expected impact</p>
              <p className="mt-1 text-sm text-[var(--color-ink)]">{insight.expected_impact}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-3">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-faint)]">
          {insight.action_href && (
            <Link
              href={insight.action_href}
              className="inline-flex items-center gap-1 font-medium text-[var(--color-gold-300)] hover:text-[var(--color-gold-100)]"
            >
              {insight.action_label ?? "Open"}
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
          <span>{timeAgo(insight.created_at)}</span>
          {insight.category && <span className="capitalize">{insight.category}</span>}
        </div>

        <form action="/api/osf/ai/insights" method="POST">
          <input type="hidden" name="intent" value="dismiss" />
          <input type="hidden" name="id" value={insight.id} />
          <input type="hidden" name="next" value="/inbox/whatsapp/ai/insights" />
          <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
            Dismiss
          </button>
        </form>
      </div>
    </Card>
  );
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const page = await gatedLoad(
    { table: "villa_ai_insights", migration: "001_schema.sql" },
    () => Promise.all([searchParams, listInsights()] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Insights" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [{ error }, insights] = page.data;
  const newest = insights.reduce<string | null>(
    (latest, i) => (!latest || i.created_at > latest ? i.created_at : latest),
    null,
  );
  const critical = insights.filter((i) => i.severity === "critical").length;
  const warning = insights.filter((i) => i.severity === "warning").length;
  const aiEnriched = insights.filter((i) => i.generated_by_ai).length;

  return (
    <>
      <PageHeader
        title="Insights"
        sub="Each insight is a rule that fired on live aggregates, and it carries the numbers that made it fire. The optional AI pass only re-words and prioritises figures it was handed — anything it returns containing a number nobody measured is discarded before it reaches this page."
        actions={
          <form action="/api/osf/ai/insights" method="POST">
            <input type="hidden" name="intent" value="generate" />
            <input type="hidden" name="next" value="/inbox/whatsapp/ai/insights" />
            <button type="submit" className="btn-gold">
              <RefreshCw className="h-4 w-4" aria-hidden />
              Recompute
            </button>
          </form>
        }
      />

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-[color-mix(in_oklab,var(--c-bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] p-4 text-sm text-[var(--color-ink)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Open insights"
          value={formatNumber(insights.length)}
          sub={newest ? `Last computed ${timeAgo(newest)}` : "Never computed"}
        />
        <Stat label="Needs attention now" value={formatNumber(critical)} gold={critical > 0} />
        <Stat label="Worth fixing this week" value={formatNumber(warning)} />
        <Stat
          label="AI-summarised"
          value={formatNumber(aiEnriched)}
          sub={`${insights.length - aiEnriched} straight from rules`}
        />
      </div>

      {insights.length === 0 ? (
        <Empty
          action={
            <form action="/api/osf/ai/insights" method="POST">
              <input type="hidden" name="intent" value="generate" />
              <input type="hidden" name="next" value="/inbox/whatsapp/ai/insights" />
              <button type="submit" className="btn-gold">
                <RefreshCw className="h-4 w-4" aria-hidden />
                Recompute now
              </button>
            </form>
          }
        >
          <span className="font-medium text-[var(--color-ink)]">Nothing crosses a threshold.</span>
          <span className="mx-auto mt-2 block max-w-xl">
            Either no run has happened yet, or the current numbers sit below every line worth
            flagging — an objection has to reach {THRESHOLDS.objectionSharePct}% of at least{" "}
            {THRESHOLDS.objectionsMin} recorded, lead volume has to move{" "}
            {THRESHOLDS.volumeChangePct}% against a week of at least {THRESHOLDS.prevWeekLeadsMin},
            and so on. Below those minimums a ratio is arithmetic, not a finding.
          </span>
        </Empty>
      ) : (
        <div className="space-y-8">
          {SEVERITY_ORDER.map((severity) => {
            const group = insights.filter((i) => i.severity === severity);
            if (group.length === 0) return null;
            return (
              <section key={severity}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {SEVERITY_LABELS[severity]}
                  <span className="pill bg-[var(--color-raised)] text-[var(--color-muted)]">
                    {group.length}
                  </span>
                </h2>
                <div className="space-y-4">
                  {group.map((insight) => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-8 text-xs leading-relaxed text-[var(--color-faint)]">
        A dismissed insight is suppressed for {THRESHOLDS.dismissalCooldownDays} days even if its
        rule keeps firing, and an insight whose condition stops holding is deleted rather than left
        standing — a stale finding is worse than none.
      </p>
    </>
  );
}
