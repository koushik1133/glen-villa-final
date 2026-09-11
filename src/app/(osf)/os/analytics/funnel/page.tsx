import { CircleQuestionMark, TrendingDown } from "lucide-react";
import { BarsChart, FunnelChart } from "@/components/osf/charts";
import { parseRange, rangeLabel, rangeToDays } from "@/components/osf/shell/nav-config";
import {
  Card,
  Empty,
  PageHeader,
  SetupNotice,
  Stat,
  formatNumber,
  formatPercent,
  timeAgo,
} from "@/components/osf/ui";
import {
  analyticsWindow,
  objectionBreakdown,
  openQuestions,
  pipelineBreakdown,
  rate,
} from "@/lib/osf/analytics";
import { humanise } from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function pct(ratio: number | null): string {
  return ratio === null ? "—" : formatPercent(ratio * 100);
}

export default async function FunnelPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const w = analyticsWindow(rangeToDays(range));

  const page = await gatedLoad({ table: "villa_objections", migration: "001_schema.sql" }, () =>
    Promise.all([pipelineBreakdown(w), objectionBreakdown(w), openQuestions(w, 40)] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Filter" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [pipeline, objections, questions] = page.data;

  const active = pipeline.rows[0]?.reached ?? 0;
  const byStage = new Map(pipeline.rows.map((r) => [r.stage, r]));
  const qualified = byStage.get("qualified")?.reached ?? 0;
  const booked = byStage.get("booked")?.reached ?? 0;

  const objectionData = objections.map((o) => ({ label: humanise(o.category), total: o.total }));

  return (
    <>
      <PageHeader
        title="Filter"
        sub={`${rangeLabel(range)} — how far leads get, where they stall, and what they say when they stop.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="In the pipeline"
          value={formatNumber(active)}
          sub={`${formatNumber(pipeline.total)} leads created, ${formatNumber(pipeline.lost)} marked lost`}
        />
        <Stat
          label="Reached qualified"
          value={formatNumber(qualified)}
          sub={`${pct(rate(qualified, active))} of the pipeline`}
        />
        <Stat
          gold
          label="Booked"
          value={formatNumber(booked)}
          sub={`${pct(rate(booked, active))} end-to-end conversion`}
        />
        <Stat
          label="Lost"
          value={formatNumber(pipeline.lost)}
          sub={
            pipeline.total === 0
              ? "Nothing created in this period"
              : `${pct(rate(pipeline.lost, pipeline.total))} of every lead created`
          }
        />
      </div>

      {pipeline.biggestDrop && (
        <Card gold className="mt-5">
          <div className="flex items-start gap-3">
            <TrendingDown size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-[--color-gold-500]" />
            <div>
              <p className="text-sm font-semibold text-[--color-ink]">
                The steepest drop is into {pipeline.biggestDrop.label.toLowerCase()}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[--color-muted]">
                Only {pct(pipeline.biggestDrop.stepRate)} of the leads that reached the previous stage got this far —{" "}
                {formatNumber(pipeline.biggestDrop.reached)} of them. Every stage after it is capped by this number, so
                it is the one worth fixing first.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card
          title="Stage drop-off"
          hint="Leads that reached each stage or went past it. A booked lead is counted at every stage below it."
        >
          {active === 0 ? (
            <Empty>No leads in the pipeline for this period.</Empty>
          ) : (
            <FunnelChart stages={pipeline.rows.map((r) => ({ label: r.label, value: r.reached }))} />
          )}
        </Card>

        <Card
          title="Stage by stage"
          hint="“Here now” is where leads are sitting today; “reached” rolls those counts up the ordered stages."
        >
          {active === 0 && pipeline.lost === 0 ? (
            <Empty>Nothing to break down yet.</Empty>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead className="border-b border-[--color-line]">
                  <tr>
                    <th className="th">Stage</th>
                    <th className="th text-right">Here now</th>
                    <th className="th text-right">Reached</th>
                    <th className="th text-right">From previous</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[--color-line]">
                  {pipeline.rows.map((r) => (
                    <tr key={r.stage} className="row-hover">
                      <td className="td font-medium">{r.label}</td>
                      <td className="td text-right tabular-nums text-[--color-muted]">
                        {formatNumber(r.current)}
                      </td>
                      <td className="td text-right tabular-nums">{formatNumber(r.reached)}</td>
                      <td
                        className={`td text-right tabular-nums ${
                          r.stepRate !== null && r.stepRate < 0.4
                            ? "text-[--color-danger]"
                            : "text-[--color-ink]"
                        }`}
                      >
                        {pct(r.stepRate)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-[--color-line-strong]">
                    <td className="td font-medium text-[--color-muted]">Lost</td>
                    <td className="td text-right tabular-nums text-[--color-danger]">
                      {formatNumber(pipeline.lost)}
                    </td>
                    <td className="td text-right text-[--color-faint]">—</td>
                    <td className="td text-right text-[--color-faint]">—</td>
                  </tr>
                </tbody>
              </table>
              {/* The schema records where a lead is, never where it has been, so a
                  lost lead cannot be placed on the stage it dropped out of. */}
              <p className="mt-3 px-5 text-xs leading-relaxed text-[--color-faint]">
                Lost leads sit outside the rollup: <code>pipeline_stage</code> records where a lead is now, not how far
                it got before it dropped out, so folding them into a stage would be a guess.
              </p>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card
          title="Objections raised"
          hint="What buyers pushed back on, grouped by category from the conversation log."
        >
          {objections.length === 0 ? (
            <Empty>No objections logged in this period.</Empty>
          ) : (
            <>
              <BarsChart
                data={objectionData}
                keys={[{ key: "total", name: "Objections" }]}
                height={Math.max(180, objections.length * 44)}
                horizontal
              />
              <ul className="mt-4 space-y-2 border-t border-[--color-line] pt-4">
                {objections.map((o) => (
                  <li key={o.category} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-[--color-ink]">{humanise(o.category)}</span>
                    <span className="shrink-0 tabular-nums text-[--color-muted]">
                      {formatNumber(o.total)}
                      <span className="ml-2 text-[--color-faint]">
                        {o.pct === null ? "—" : formatPercent(o.pct)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card
          title="Unanswered questions"
          hint="Questions the agent could not answer from the knowledge base. Each one is a gap a human had to fill."
          actions={
            questions.length > 0 ? (
              <span className="pill bg-[rgba(239,180,92,0.14)] text-[--color-warm]">
                <CircleQuestionMark size={11} strokeWidth={2} aria-hidden />
                {questions.length}
              </span>
            ) : undefined
          }
        >
          {questions.length === 0 ? (
            <Empty>
              Nothing unanswered. Every question in this period was covered by the approved knowledge base.
            </Empty>
          ) : (
            <ul className="-my-1 divide-y divide-[--color-line]">
              {questions.map((q) => (
                <li key={q.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="label text-[--color-gold-700]">{humanise(q.topic)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[--color-faint]">
                      {timeAgo(q.created_at)}
                    </span>
                  </div>
                  {q.verbatim && (
                    <p className="mt-1 text-sm leading-relaxed text-[--color-ink]">“{q.verbatim}”</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {objections.length > 0 && (
        <p className="mt-5 text-xs leading-relaxed text-[--color-faint]">
          Objection percentages are shares of the objections logged in this period, not of leads — one lead can raise
          several.
        </p>
      )}
    </>
  );
}
