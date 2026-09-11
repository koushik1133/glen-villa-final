import Link from "next/link";
import { Info } from "lucide-react";
import { DonutChart, TrendChart } from "@/components/osf/charts";
import { parseRange, rangeLabel, rangeStartIso, rangeToDays } from "@/components/osf/shell/nav-config";
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
} from "@/components/osf/ui";
import { humanise } from "@/lib/osf/crm";
import { marketingOverview } from "@/lib/osf/marketing/studio";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Spend and CPL live in the thousands-to-lakhs range, where formatCr rounds to ₹0.00 Cr. */
function rupees(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${INR.format(Math.round(value))}`;
}

function multiple(ratio: number | null): string {
  return ratio === null ? "—" : `${ratio.toFixed(2)}×`;
}

function pct(ratio: number | null): string {
  return ratio === null ? "—" : formatPercent(ratio * 100, 2);
}

export default async function MarketingOverviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);

  const page = await gatedLoad({ table: "villa_campaigns", migration: "001_schema.sql" }, () =>
    marketingOverview(rangeStartIso(range), rangeToDays(range)),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Marketing overview" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const { rows, metrics, platforms, leadFlow } = page.data;

  const topCampaigns = [...rows].sort((a, b) => b.spent_inr - a.spent_inr).slice(0, 8);
  const maxSpend = topCampaigns[0]?.spent_inr ?? 0;
  const spendSplit = platforms
    .filter((p) => p.spendInr > 0)
    .map((p) => ({ label: humanise(p.platform), value: p.spendInr }));
  const budgetUsed =
    metrics.totalBudgetInr > 0 ? metrics.totalSpendInr / metrics.totalBudgetInr : null;

  return (
    <>
      <PageHeader
        title="Marketing overview"
        sub={`Blended economics across ${metrics.campaigns} campaigns. Spend, impressions and clicks are typed in by hand — no ad platform reports them to this app.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          gold
          label="Blended ROAS"
          value={multiple(metrics.blendedRoas)}
          sub={
            metrics.blendedRoas === null
              ? "Nothing recorded as spent yet"
              : "Booked revenue ÷ recorded spend"
          }
        />
        <Stat
          label="Recorded spend"
          value={rupees(metrics.totalSpendInr)}
          sub={
            budgetUsed === null
              ? "No budgets set"
              : `${formatPercent(budgetUsed * 100, 0)} of ${rupees(metrics.totalBudgetInr)} budgeted`
          }
        />
        <Stat
          label="Blended CPL"
          value={rupees(metrics.blendedCplInr)}
          sub={
            metrics.qualifiedCplInr === null
              ? "No campaign leads yet"
              : `${rupees(metrics.qualifiedCplInr)} per qualified lead`
          }
        />
        <Stat
          label="Campaign leads"
          value={formatNumber(metrics.totalLeads)}
          sub={`${formatNumber(metrics.totalQualified)} qualified · ${pct(metrics.qualifyRate)}`}
        />
        <Stat
          label="Attributed revenue"
          value={formatCr(metrics.totalRevenueInr)}
          sub={`${formatNumber(metrics.totalBookings)} bookings · ${pct(metrics.bookingRate)} of leads`}
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <Card
          title="Campaign-attributed leads"
          hint={`${rangeLabel(range)}, ${leadFlow.granularity}. Only leads carrying a campaign name — counting walk-ins here would credit the ads with traffic they didn't buy.`}
          className="xl:col-span-2"
        >
          {leadFlow.points.every((p) => (p.leads as number) === 0) ? (
            <Empty>No campaign-attributed leads in this period.</Empty>
          ) : (
            <TrendChart
              data={leadFlow.points}
              keys={[
                { key: "leads", name: "Leads" },
                { key: "qualified", name: "Qualified" },
              ]}
              height={280}
            />
          )}
          <p className="mt-3 flex items-start gap-1.5 border-t border-[--color-line] pt-3 text-[11px] leading-relaxed text-[--color-faint]">
            <Info size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
            Spend has no line on this chart because it has no daily history: each campaign stores one
            running total, overwritten whenever somebody updates it. A spend-over-time series needs the
            Meta and Google APIs, which are not connected.
          </p>
        </Card>

        <Card title="Spend by platform" hint="Share of everything recorded as spent, all time.">
          {spendSplit.length === 0 ? (
            <Empty>No spend recorded yet.</Empty>
          ) : (
            <DonutChart data={spendSplit} height={280} />
          )}
        </Card>
      </div>

      <Card
        title="Platform economics"
        hint="Where the money goes against where the leads come from. A platform taking a larger share of spend than of leads is the one to question first."
        className="mt-5"
      >
        {platforms.length === 0 ? (
          <Empty>No campaigns yet.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-[--color-line]">
                <tr>
                  <th className="th">Platform</th>
                  <th className="th text-right">Spend</th>
                  <th className="th">Spend share</th>
                  <th className="th text-right">Leads</th>
                  <th className="th">Lead share</th>
                  <th className="th text-right">Qualified</th>
                  <th className="th text-right">CPL</th>
                  <th className="th text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-line]">
                {platforms.map((p) => (
                  <tr key={p.platform} className="row-hover">
                    <td className="td font-medium">{humanise(p.platform)}</td>
                    <td className="td whitespace-nowrap text-right tabular-nums">{rupees(p.spendInr)}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <span className="w-11 shrink-0 text-right text-xs tabular-nums text-[--color-muted]">
                          {p.spendSharePct === null ? "—" : `${p.spendSharePct}%`}
                        </span>
                        <span className="w-24"><Meter value={p.spendSharePct ?? 0} max={100} /></span>
                      </div>
                    </td>
                    <td className="td text-right tabular-nums">{formatNumber(p.leads)}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <span className="w-11 shrink-0 text-right text-xs tabular-nums text-[--color-muted]">
                          {p.leadSharePct === null ? "—" : `${p.leadSharePct}%`}
                        </span>
                        <span className="w-24">
                          <Meter value={p.leadSharePct ?? 0} max={100} tone="info" />
                        </span>
                      </div>
                    </td>
                    <td className="td text-right tabular-nums">{formatNumber(p.qualified)}</td>
                    <td className="td whitespace-nowrap text-right tabular-nums">{rupees(p.cplInr)}</td>
                    <td className="td text-right tabular-nums">{multiple(p.roas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Top campaigns by spend"
        hint="Straight from villa_campaign_performance. Leads attach to a campaign by exact name match on the lead's campaign field."
        className="mt-5"
        actions={
          <Link href="/os/marketing/campaigns" className="text-xs text-[--color-muted] transition hover:text-[--color-gold-300]">
            All campaigns →
          </Link>
        }
      >
        {topCampaigns.length === 0 ? (
          <Empty
            action={
              <Link href="/os/marketing/campaigns" className="btn-ghost">
                Add a campaign
              </Link>
            }
          >
            No campaigns recorded yet.
          </Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="border-b border-[--color-line]">
                <tr>
                  <th className="th">Campaign</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Spend</th>
                  <th className="th text-right">CTR</th>
                  <th className="th text-right">Leads</th>
                  <th className="th text-right">CPL</th>
                  <th className="th text-right">Bookings</th>
                  <th className="th text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-line]">
                {topCampaigns.map((c) => (
                  <tr key={c.id} className="row-hover">
                    <td className="td">
                      <span className="font-medium">{c.name}</span>
                      <span className="block text-xs text-[--color-muted]">{humanise(c.platform)}</span>
                      <span className="mt-1.5 block w-28">
                        <Meter value={c.spent_inr} max={maxSpend} />
                      </span>
                    </td>
                    <td className="td">
                      <Badge tone={c.status === "active" ? "success" : c.status === "paused" ? "warning" : "neutral"}>
                        {c.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="td whitespace-nowrap text-right tabular-nums">{rupees(c.spent_inr)}</td>
                    <td className="td text-right tabular-nums">{pct(c.ctr)}</td>
                    <td className="td text-right tabular-nums">
                      {formatNumber(c.leads)}
                      <span className="ml-1.5 text-xs text-[--color-faint]">{c.qualified_leads} qual.</span>
                    </td>
                    <td className="td whitespace-nowrap text-right tabular-nums">{rupees(c.cpl_inr)}</td>
                    <td className="td text-right tabular-nums">{formatNumber(c.bookings)}</td>
                    <td className="td text-right tabular-nums">{multiple(c.roas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card gold title="What these numbers are, exactly" className="mt-5">
        <ul className="space-y-2.5 text-sm leading-relaxed text-[--color-muted]">
          <li>
            <span className="text-[--color-ink]">Spend, impressions and clicks</span> are whatever a
            person last typed on the campaigns page. They are not synced from Meta or Google — no ad API
            client exists in this codebase.
          </li>
          <li>
            <span className="text-[--color-ink]">Leads</span> are counted by matching a lead&apos;s
            campaign field against the campaign name, so a typo in either place breaks attribution
            silently. Revenue is booked value on those leads&apos; bookings, excluding cancellations.
          </li>
          <li>
            <span className="text-[--color-ink]">The date range</span> filters the leads chart only.
            Spend has no timestamp to filter on, so every spend, CPL and ROAS figure on this page is
            all-time.
          </li>
          <li>
            There is no reach, frequency, impression-share or view-through figure anywhere here, because
            nothing in this system measures one.
          </li>
        </ul>
      </Card>
    </>
  );
}
