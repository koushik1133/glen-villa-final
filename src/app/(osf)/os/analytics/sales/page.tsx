import { Timer } from "lucide-react";
import { BarsChart } from "@/components/osf/charts";
import { parseRange, rangeLabel, rangeToDays } from "@/components/osf/shell/nav-config";
import {
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatCr,
  formatInr,
  formatNumber,
} from "@/components/osf/ui";
import { analyticsWindow, salesVelocity, type VelocityGroup } from "@/lib/osf/analytics";
import { humanise } from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function days(n: number | null): string {
  return n === null ? "—" : n.toFixed(n < 10 ? 1 : 0);
}

/** Shared markup for the two velocity splits — same columns, different key. */
function SplitTable({ groups, heading }: { groups: VelocityGroup[]; heading: string }) {
  const topBookings = groups[0]?.bookings ?? 0;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[480px]">
        <thead className="border-b border-[var(--color-line)]">
          <tr>
            <th className="th">{heading}</th>
            <th className="th text-right">Bookings</th>
            <th className="th text-right">Avg days</th>
            <th className="th text-right">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {groups.map((g) => (
            <tr key={g.key} className="row-hover">
              <td className="td font-medium">{humanise(g.key)}</td>
              <td className="td text-right">
                <span className="tabular-nums">{formatNumber(g.bookings)}</span>
                <div className="mt-1.5 ml-auto w-16">
                  <Meter value={g.bookings} max={topBookings} />
                </div>
              </td>
              <td className="td text-right tabular-nums">{days(g.avgDays)}</td>
              <td className="td text-right tabular-nums">{formatCr(g.revenueInr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function SalesAnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const w = analyticsWindow(rangeToDays(range));

  const page = await gatedLoad({ table: "villa_sales_velocity", migration: "001_schema.sql" }, () =>
    salesVelocity(w),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Sales analytics" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const v = page.data;
  const counted = v.rows.length;
  const avgValueInr = counted > 0 ? Math.round(v.totalRevenueInr / counted) : null;

  const bucketData = v.buckets.map((b) => ({ label: b.label, bookings: b.count }));
  const modalBucket = [...v.buckets].sort((a, b) => b.count - a.count)[0] ?? null;

  return (
    <>
      <PageHeader
        title="Sales analytics"
        sub={`${rangeLabel(range)} — how long a lead takes to become a booking, and which channels close fastest.`}
      />

      {counted === 0 ? (
        <Card>
          <Empty>
            No closed bookings with a measurable lead-to-booking time in this period. Velocity is derived from{" "}
            <code>villa_sales_velocity</code>, which pairs each non-cancelled booking with its lead&rsquo;s first
            contact.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              gold
              label="Average days to close"
              value={days(v.averageDays)}
              sub={`median ${days(v.medianDays)} · ${formatNumber(counted)} bookings measured`}
            />
            <Stat
              label="Fastest close"
              value={days(v.fastestDays)}
              sub={`slowest ${days(v.slowestDays)} days`}
            />
            <Stat
              label="Booked value"
              value={formatCr(v.totalRevenueInr)}
              sub={avgValueInr === null ? "—" : `${formatInr(avgValueInr)} average booking`}
            />
            <Stat
              label="Most common window"
              value={modalBucket && modalBucket.count > 0 ? modalBucket.label : "—"}
              sub={
                modalBucket && modalBucket.count > 0
                  ? `${formatNumber(modalBucket.count)} of ${formatNumber(counted)} bookings`
                  : "No bookings measured"
              }
            />
          </div>

          <Card
            title="Days from first contact to booking"
            hint="Every measured booking, bucketed. A long right tail means deals are being worked, not lost."
            className="mt-5"
            actions={
              <span className="pill bg-[var(--color-raised)] text-[var(--color-muted)]">
                <Timer size={11} strokeWidth={2} aria-hidden />
                {formatNumber(counted)} measured
              </span>
            }
          >
            <BarsChart data={bucketData} keys={[{ key: "bookings", name: "Bookings" }]} height={260} />
          </Card>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <Card
              title="Velocity by source"
              hint="First-touch source of the lead behind each booking, joined through villa_sales_velocity."
            >
              {v.bySource.length === 0 ? (
                <Empty>No booking carries a source in this period.</Empty>
              ) : (
                <SplitTable groups={v.bySource} heading="Source" />
              )}
            </Card>

            <Card title="Velocity by campaign" hint="Only bookings whose lead carried a campaign are counted.">
              {v.byCampaign.length === 0 ? (
                <Empty>No booking carries a campaign in this period.</Empty>
              ) : (
                <SplitTable groups={v.byCampaign} heading="Campaign" />
              )}
            </Card>
          </div>
        </>
      )}

      {v.excluded > 0 && (
        <p className="mt-5 text-xs leading-relaxed text-[var(--color-faint)]">
          {formatNumber(v.excluded)} booking{v.excluded === 1 ? " was" : "s were"} left out of every figure above:
          the booking was created before the lead&rsquo;s first contact, so the elapsed time is negative and cannot
          be a close time. They are counted here rather than silently dropped.
        </p>
      )}
    </>
  );
}
