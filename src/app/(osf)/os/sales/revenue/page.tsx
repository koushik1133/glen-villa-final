import Link from "next/link";
import { Card, Empty, PageHeader, SetupNotice, Stat, formatCr, formatInr, formatPercent } from "@/components/osf/ui";
import { BarsChart, TrendChart } from "@/components/osf/charts";
import { parseRange, rangeLabel, rangeStartIso } from "@/components/osf/shell/nav-config";
import { gatedLoad } from "@/lib/osf/queries";
import {
  AGING_BUCKETS,
  formatMonth,
  formatDay,
  monthFloor,
  receivablesAging,
  revenueAttribution,
  revenueMonthly,
  summariseRevenue,
  type RevenueSplit,
} from "@/lib/osf/sales";

export const dynamic = "force-dynamic";

const CRORE = 10_000_000;

/** Charts read in crore; rupees on a bigint axis are unreadable. */
function cr(inr: number): number {
  return Number((inr / CRORE).toFixed(2));
}

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  // Every figure on this page is aggregated per calendar month, so the window
  // is widened to whole months. Anything narrower would show a month's full
  // total under a label that excluded part of it.
  const since = monthFloor(rangeStartIso(range));

  const page = await gatedLoad({ table: "villa_bookings", migration: "001_schema.sql" }, () =>
    Promise.all([revenueMonthly(), revenueAttribution(since), receivablesAging()] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Revenue" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [allMonths, attribution, aging] = page.data;
  const months = since ? allMonths.filter((m) => m.month >= since) : allMonths;
  const summary = summariseRevenue(months);
  const windowLabel = since ? `Whole months from ${formatMonth(since)}` : "All time";

  const trend = months.map((m) => ({
    label: formatMonth(m.month),
    booked: cr(m.booked_value_inr),
    collected: cr(m.collected_inr),
  }));

  return (
    <>
      <PageHeader
        title="Revenue"
        sub="Booked value against money actually in the bank. Cancelled bookings are excluded throughout — they are not revenue that slipped, they are revenue that never existed."
        actions={
          <Link href="/os/sales/bookings" className="btn-ghost">
            Bookings
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Booked value"
          value={summary.bookedValueInr > 0 ? formatCr(summary.bookedValueInr) : "—"}
          sub={windowLabel}
          gold
        />
        <Stat
          label="Collected"
          value={summary.collectedInr > 0 ? formatCr(summary.collectedInr) : "—"}
          sub={
            summary.collectionRate !== null
              ? `${formatPercent(summary.collectionRate, 0)} of booked`
              : undefined
          }
        />
        <Stat
          label="Receivables"
          value={summary.receivablesInr > 0 ? formatCr(summary.receivablesInr) : "—"}
          sub="Booked but not yet collected"
        />
        <Stat
          label="Average booking"
          value={summary.averageBookingValueInr !== null ? formatCr(summary.averageBookingValueInr) : "—"}
        />
        <Stat label="Bookings" value={summary.bookingCount} sub={rangeLabel(range)} />
      </div>

      <Card
        title="Booked vs collected"
        hint="Monthly, in crore. The gap between the two lines is the collection lag — the same number the receivables KPI carries."
        className="mb-5"
      >
        {trend.length === 0 ? (
          <Empty>
            {allMonths.length > 0
              ? "No booking falls in this window. Widen the date range to see earlier months."
              : "No bookings on record yet, so there is no revenue to plot. Nothing here is modelled or projected."}
          </Empty>
        ) : (
          <TrendChart
            data={trend}
            keys={[
              { key: "booked", name: "Booked (₹ Cr)" },
              { key: "collected", name: "Collected (₹ Cr)" },
            ]}
            height={280}
          />
        )}
      </Card>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <SplitCard
          title="Revenue by source"
          hint="Attribution is copied onto the booking when it is raised, so a later edit to the lead cannot rewrite history."
          splits={attribution.bySource}
          emptyLine="No booking carries a source yet."
        />
        <SplitCard
          title="Revenue by campaign"
          hint="Bookings outside paid media are left out rather than pooled into a fictional campaign."
          splits={attribution.byCampaign}
          emptyLine="No booking is attributed to a campaign."
        />
      </div>

      <Card
        title="Receivables aging"
        hint="Unpaid milestones whose due date has passed, as of today in IST. Independent of the date range — money is either late or it is not."
      >
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AGING_BUCKETS.map((bucket) => {
            const b = aging.buckets[bucket];
            return (
              <div key={bucket} className="rounded-xl border border-[--color-line] bg-[--color-void]/40 px-4 py-3.5">
                <p className="label">{bucket} days</p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-[--color-ink]">
                  {b.amountInr > 0 ? formatInr(b.amountInr) : "—"}
                </p>
                <p className="mt-1 text-xs text-[--color-muted]">
                  {b.count === 0 ? "Nothing overdue" : `${b.count} milestone${b.count === 1 ? "" : "s"}`}
                </p>
              </div>
            );
          })}
        </div>

        {aging.rows.length === 0 ? (
          <Empty>Nothing is past due. Every scheduled milestone is either paid or not yet owed.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-[--color-line]">
                  <th className="th">Booking</th>
                  <th className="th">Customer</th>
                  <th className="th">Milestone</th>
                  <th className="th">Due</th>
                  <th className="th text-right">Days late</th>
                  <th className="th text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-line]">
                {aging.rows.map((row) => (
                  <tr key={row.id} className="row-hover">
                    <td className="td">
                      <Link
                        href={`/os/sales/bookings/${row.bookingId}`}
                        className="font-mono text-[13px] text-[--color-gold-300] hover:text-[--color-gold-100]"
                      >
                        {row.bookingNumber}
                      </Link>
                    </td>
                    <td className="td">{row.customerName}</td>
                    <td className="td text-[--color-muted]">{row.milestone}</td>
                    <td className="td tabular-nums">{formatDay(row.dueDate)}</td>
                    <td
                      className={`td text-right tabular-nums ${
                        row.daysOverdue > 90 ? "text-[--color-danger]" : "text-[--color-warm]"
                      }`}
                    >
                      {row.daysOverdue}
                    </td>
                    <td className="td text-right tabular-nums">{formatInr(row.amountInr)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[--color-line-strong]">
                  <td className="td text-xs uppercase tracking-[0.12em] text-[--color-faint]" colSpan={5}>
                    Total overdue
                  </td>
                  <td className="td text-right font-semibold tabular-nums text-[--color-danger]">
                    {formatInr(aging.totalInr)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function SplitCard({
  title,
  hint,
  splits,
  emptyLine,
}: {
  title: string;
  hint: string;
  splits: RevenueSplit[];
  emptyLine: string;
}) {
  const top = splits.slice(0, 8);
  const data = top.map((s) => ({
    label: s.label,
    booked: cr(s.bookedInr),
    collected: cr(s.collectedInr),
  }));

  return (
    <Card title={title} hint={hint}>
      {top.length === 0 ? (
        <Empty>{emptyLine}</Empty>
      ) : (
        <>
          <BarsChart
            data={data}
            keys={[
              { key: "booked", name: "Booked (₹ Cr)" },
              { key: "collected", name: "Collected (₹ Cr)" },
            ]}
            horizontal
            height={Math.max(180, top.length * 46 + 60)}
          />
          <ul className="mt-4 space-y-2 border-t border-[--color-line] pt-4">
            {top.map((s) => (
              <li key={s.label} className="flex items-baseline justify-between gap-4 text-xs">
                <span className="min-w-0 truncate text-[--color-ink]">{s.label}</span>
                <span className="shrink-0 tabular-nums text-[--color-muted]">
                  {s.bookings} booking{s.bookings === 1 ? "" : "s"} ·{" "}
                  <span className="text-[--color-gold-300]">{formatCr(s.bookedInr)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
