import Link from "next/link";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { BarsChart } from "@/components/osf/charts";
import { parseRange, rangeLabel, rangeToDays } from "@/components/osf/shell/nav-config";
import {
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatNumber,
  formatPercent,
  timeAgo,
} from "@/components/osf/ui";
import { analyticsWindow, multiTouch, rate, sourceBreakdown } from "@/lib/osf/analytics";
import { humanise } from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

/** Journeys are a long tail — this is as deep as the table stays readable. */
const JOURNEY_LIMIT = 40;

type Search = Record<string, string | string[] | undefined>;

function pct(ratio: number | null): string {
  return ratio === null ? "—" : formatPercent(ratio * 100);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export default async function AttributionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const w = analyticsWindow(rangeToDays(range));

  const page = await gatedLoad({ table: "villa_touchpoints", migration: "001_schema.sql" }, () =>
    Promise.all([sourceBreakdown(w), multiTouch(w)] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Attribution" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [sources, multi] = page.data;

  const totalLeads = sources.reduce((sum, s) => sum + s.leads, 0);
  const topSourceLeads = sources[0]?.leads ?? 0;
  const journeyLeads = multi.journeys.length;

  // The two models disagree by construction: first-touch credits whoever found
  // the buyer, last-touch whoever closed them. Naming the extremes is the whole
  // reason both columns are on the page.
  const swings = [...multi.channels].sort((a, b) => b.swing - a.swing);
  const closer = swings[0] && swings[0].swing > 0 ? swings[0] : null;
  const opener = swings.at(-1) && swings.at(-1)!.swing < 0 ? swings.at(-1)! : null;

  const touchData = multi.channels.map((c) => ({
    label: humanise(c.channel),
    first: c.firstTouches,
    last: c.lastTouches,
  }));

  return (
    <>
      <PageHeader
        title="Attribution"
        sub={`${rangeLabel(range)} — which channels find buyers, and which ones actually close them.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Attributed leads"
          value={formatNumber(totalLeads)}
          sub={`${sources.length} source / campaign pairs`}
        />
        <Stat
          label="Recorded touches"
          value={formatNumber(multi.totalTouches)}
          sub={`${multi.channels.length} channels`}
        />
        <Stat
          label="Leads with a journey"
          value={formatNumber(journeyLeads)}
          sub={`${pct(rate(journeyLeads, totalLeads))} of attributed leads`}
        />
        <Stat
          gold
          label="Cross-channel"
          value={formatNumber(multi.crossChannelLeads)}
          sub={
            journeyLeads === 0
              ? "No journeys recorded yet"
              : `${pct(rate(multi.crossChannelLeads, journeyLeads))} opened and closed on different channels`
          }
        />
      </div>

      {multi.truncated && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[--color-line-strong] bg-[--color-raised] p-4">
          <AlertTriangle
            size={15}
            strokeWidth={1.75}
            aria-hidden
            className="mt-0.5 shrink-0 text-[--color-warm]"
          />
          <p className="text-xs leading-relaxed text-[--color-muted]">
            <span className="font-medium text-[--color-ink]">This is a partial read.</span> The touch log hit the
            query cap of {formatNumber(multi.totalTouches)} rows for this period. Touches are read oldest-first, so
            the most recent ones are the ones missing — journeys that continued past the cut-off show the wrong last
            channel, and the last-touch column below understates whatever is closing deals. Narrow the date range
            for a complete picture.
          </p>
        </div>
      )}

      {(closer || opener) && (
        <Card
          gold
          title="First touch and last touch disagree"
          hint="Reporting only the source stored on the lead credits whoever sits at the top of the funnel and nobody else."
          className="mt-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {closer && (
              <div className="rounded-xl border border-[--color-line] bg-[--color-void]/40 p-4">
                <p className="label">Closes more than it opens</p>
                <p className="mt-1.5 text-lg font-semibold text-[--color-ink]">{humanise(closer.channel)}</p>
                <p className="mt-1 text-xs text-[--color-muted]">
                  Last touch on {formatNumber(closer.lastTouches)} journeys, first touch on only{" "}
                  {formatNumber(closer.firstTouches)} — a swing of {signed(closer.swing)}. First-touch reporting
                  undercounts it.
                </p>
              </div>
            )}
            {opener && (
              <div className="rounded-xl border border-[--color-line] bg-[--color-void]/40 p-4">
                <p className="label">Opens more than it closes</p>
                <p className="mt-1.5 text-lg font-semibold text-[--color-ink]">{humanise(opener.channel)}</p>
                <p className="mt-1 text-xs text-[--color-muted]">
                  First touch on {formatNumber(opener.firstTouches)} journeys but last touch on only{" "}
                  {formatNumber(opener.lastTouches)} — a swing of {signed(opener.swing)}. It discovers buyers other
                  channels finish.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card
        title="First touch vs last touch, by channel"
        hint="Same journeys, two credit models, side by side. The gap between the pair is what a single-source report hides."
        className="mt-5"
      >
        {touchData.length === 0 ? (
          <Empty>
            No touchpoints recorded yet. Rows land in <code>villa_touchpoints</code> as the agent works a lead
            across channels.
          </Empty>
        ) : (
          <BarsChart
            data={touchData}
            keys={[
              { key: "first", name: "First touch" },
              { key: "last", name: "Last touch" },
            ]}
            height={Math.max(220, touchData.length * 52)}
            horizontal
          />
        )}
      </Card>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card
          title="First touch"
          hint="The source and campaign stored on the lead itself — the ad or link that started the conversation."
        >
          {sources.length === 0 ? (
            <Empty>No attributed leads in this period.</Empty>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="border-b border-[--color-line]">
                  <tr>
                    <th className="th">Source</th>
                    <th className="th">Campaign</th>
                    <th className="th text-right">Leads</th>
                    <th className="th text-right">Qualified</th>
                    <th className="th text-right">Hot</th>
                    <th className="th text-right">Avg score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[--color-line]">
                  {sources.map((s) => (
                    <tr key={`${s.source}|${s.campaign ?? ""}`} className="row-hover">
                      <td className="td font-medium">{humanise(s.source)}</td>
                      <td className="td text-[--color-muted]">{s.campaign ?? "—"}</td>
                      <td className="td text-right">
                        <span className="tabular-nums">{formatNumber(s.leads)}</span>
                        <div className="mt-1.5 ml-auto w-20">
                          <Meter value={s.leads} max={topSourceLeads} />
                        </div>
                      </td>
                      <td className="td text-right tabular-nums">
                        {formatNumber(s.qualified)}
                        <span className="ml-1.5 text-xs text-[--color-faint]">
                          {pct(rate(s.qualified, s.leads))}
                        </span>
                      </td>
                      <td className="td text-right tabular-nums text-[--color-hot]">{formatNumber(s.hot)}</td>
                      <td className="td text-right tabular-nums">
                        {s.avgScore === null ? "—" : s.avgScore.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Channel credit"
          hint="Every recorded touch, plus how often each channel was the one that opened or closed a journey."
        >
          {multi.channels.length === 0 ? (
            <Empty>No touchpoints recorded in this period.</Empty>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="border-b border-[--color-line]">
                  <tr>
                    <th className="th">Channel</th>
                    <th className="th text-right">Touches</th>
                    <th className="th text-right">Share</th>
                    <th className="th text-right">Leads</th>
                    <th className="th text-right">First</th>
                    <th className="th text-right">Last</th>
                    <th className="th text-right">Swing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[--color-line]">
                  {multi.channels.map((c) => (
                    <tr key={c.channel} className="row-hover">
                      <td className="td font-medium">{humanise(c.channel)}</td>
                      <td className="td text-right tabular-nums">{formatNumber(c.touches)}</td>
                      <td className="td text-right tabular-nums text-[--color-muted]">{pct(c.share)}</td>
                      <td className="td text-right tabular-nums">{formatNumber(c.leads)}</td>
                      <td className="td text-right tabular-nums">{formatNumber(c.firstTouches)}</td>
                      <td className="td text-right tabular-nums">{formatNumber(c.lastTouches)}</td>
                      <td
                        className={`td text-right tabular-nums ${
                          c.swing > 0
                            ? "text-[--color-success]"
                            : c.swing < 0
                              ? "text-[--color-danger]"
                              : "text-[--color-faint]"
                        }`}
                      >
                        {signed(c.swing)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Lead journeys"
        hint={`The channels each lead actually passed through, in order. Newest ${JOURNEY_LIMIT} shown.`}
        className="mt-5"
      >
        {multi.journeys.length === 0 ? (
          <Empty>No multi-touch journeys recorded in this period.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-[--color-line]">
                <tr>
                  <th className="th">Lead</th>
                  <th className="th">Path</th>
                  <th className="th text-right">Touches</th>
                  <th className="th text-right">Last touch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-line]">
                {multi.journeys.slice(0, JOURNEY_LIMIT).map((j) => (
                  <tr key={j.leadId} className="row-hover">
                    <td className="td">
                      <Link
                        href={`/os/crm/leads/${j.leadId}`}
                        className="font-medium transition hover:text-[--color-gold-300]"
                      >
                        {j.name ?? j.phone ?? "Unnamed lead"}
                      </Link>
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap items-center gap-1">
                        {j.path.map((channel, i) => (
                          <span key={`${channel}-${i}`} className="flex items-center gap-1">
                            {i > 0 && (
                              <ChevronRight size={11} strokeWidth={2} aria-hidden className="text-[--color-faint]" />
                            )}
                            <span
                              className={`pill ${
                                i === 0
                                  ? "bg-[rgba(109,168,232,0.14)] text-[--color-info]"
                                  : i === j.path.length - 1
                                    ? "bg-[--color-gold-soft] text-[--color-gold-300]"
                                    : "bg-[--color-raised] text-[--color-muted]"
                              }`}
                            >
                              {humanise(channel)}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="td text-right tabular-nums">{j.touches}</td>
                    <td className="td text-right text-[--color-muted]">{timeAgo(j.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {multi.journeys.length > JOURNEY_LIMIT && (
              <p className="mt-3 px-5 text-xs text-[--color-faint]">
                {formatNumber(multi.journeys.length - JOURNEY_LIMIT)} more journeys in this period.
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
