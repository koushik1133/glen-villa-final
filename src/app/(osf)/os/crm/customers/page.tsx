import Link from "next/link";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatCr,
  formatDate,
  formatInr,
  formatNumber,
  formatPercent,
} from "@/components/osf/ui";
import { BOOKING_STATUS_LABELS, customers, humanise, type CustomerRow } from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "neutral" | "info" | "warning" | "success" | "gold"> = {
  initiated: "neutral",
  agreement_sent: "info",
  signed: "warning",
  token_paid: "gold",
  registered: "success",
};

const PAYMENT_TONES: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  pending: "neutral",
  partial: "warning",
  paid: "success",
  overdue: "danger",
  refunded: "info",
};

export default async function CustomersPage() {
  const page = await gatedLoad({ table: "villa_bookings", migration: "001_schema.sql" }, customers);

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Customers" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const rows = page.data;
  const totalValue = rows.reduce((sum, row) => sum + row.totalValueInr, 0);
  const totalPaid = rows.reduce((sum, row) => sum + row.paidInr, 0);
  const outstanding = totalValue - totalPaid;
  const kycPending = rows.filter((row) => row.kycPending > 0).length;
  const collected = totalValue > 0 ? (totalPaid / totalValue) * 100 : null;

  return (
    <>
      <PageHeader
        title="Customers"
        sub="Anyone holding a booking that was not cancelled. One row per person — a repeat buyer with two units is one customer whose balance is the sum of both."
      />

      {rows.length === 0 ? (
        <Card>
          <Empty
            action={
              <Link href="/os/crm/pipeline" className="btn-ghost">
                Open the pipeline
              </Link>
            }
          >
            Nobody has booked yet. A lead becomes a customer when a row is written to{" "}
            <code className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-xs">villa_bookings</code>{" "}
            with a status other than cancelled.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Customers" value={formatNumber(rows.length)} />
            <Stat label="Booked value" value={formatCr(totalValue)} gold />
            <Stat
              label="Collected"
              value={formatCr(totalPaid)}
              sub={collected === null ? undefined : `${formatPercent(collected, 0)} of booked value`}
            />
            <Stat
              label="Outstanding"
              value={formatCr(outstanding)}
              sub={kycPending > 0 ? `${kycPending} customer${kycPending === 1 ? "" : "s"} with KYC pending` : "KYC complete on every booking"}
            />
          </div>

          <Card>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[1080px]">
                <thead className="border-b border-[var(--color-line)]">
                  <tr>
                    <th className="th">Customer</th>
                    <th className="th">KYC</th>
                    <th className="th">Unit</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Value</th>
                    <th className="th w-40">Paid</th>
                    <th className="th text-right">Outstanding</th>
                    <th className="th text-right">Booked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {rows.map((row) => (
                    <CustomerRowView key={row.phone} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function CustomerRowView({ row }: { row: CustomerRow }) {
  const kycDone = row.kycPending === 0;

  return (
    <tr className="row-hover">
      <td className="td">
        {row.leadId ? (
          <Link href={`/os/crm/leads/${row.leadId}`} className="font-medium hover:text-[var(--color-gold-300)]">
            {row.name}
          </Link>
        ) : (
          <span className="font-medium">{row.name}</span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-muted)]">
          <span>+{row.phone}</span>
          {row.email && <span className="truncate">{row.email}</span>}
        </span>
        <span className="mt-0.5 block text-[11px] text-[var(--color-faint)]">
          {row.bookingNumbers.join(", ")}
          {row.reps.length > 0 && ` · ${row.reps.join(", ")}`}
        </span>
      </td>

      <td className="td">
        {kycDone ? (
          <Badge tone="success">Complete</Badge>
        ) : (
          <Badge tone="danger">
            {row.kycPending} of {row.bookingCount} pending
          </Badge>
        )}
      </td>

      <td className="td text-xs">
        {row.units.length > 0 ? (
          <span className="font-medium text-[var(--color-ink)]">{row.units.join(", ")}</span>
        ) : (
          <span className="text-[var(--color-faint)]">Not allotted</span>
        )}
        <span className="mt-0.5 block text-[11px] text-[var(--color-muted)]">
          {[row.projects.join(", "), row.villaTypes.join(", ")].filter(Boolean).join(" · ") || "—"}
        </span>
      </td>

      <td className="td">
        <div className="flex flex-col items-start gap-1">
          <Badge tone={STATUS_TONES[row.latestStatus] ?? "neutral"}>
            {BOOKING_STATUS_LABELS[row.latestStatus] ?? humanise(row.latestStatus)}
          </Badge>
          <Badge tone={PAYMENT_TONES[row.paymentStatus] ?? "neutral"}>
            {humanise(row.paymentStatus)}
          </Badge>
        </div>
      </td>

      <td className="td whitespace-nowrap text-right tabular-nums">{formatCr(row.totalValueInr)}</td>

      <td className="td">
        <span className="mb-1.5 block text-xs tabular-nums text-[var(--color-muted)]">
          {formatInr(row.paidInr)}
        </span>
        <Meter value={row.paidInr} max={row.totalValueInr} />
      </td>

      <td
        className={`td whitespace-nowrap text-right tabular-nums ${
          row.outstandingInr > 0 ? "text-[var(--color-warm)]" : "text-[var(--color-success)]"
        }`}
      >
        {row.outstandingInr > 0 ? formatCr(row.outstandingInr) : "Settled"}
      </td>

      <td className="td whitespace-nowrap text-right text-xs text-[var(--color-muted)]">
        {formatDate(row.latestBookingDate)}
        {row.bookingCount > 1 && (
          <span className="block text-[11px] text-[var(--color-faint)]">{row.bookingCount} bookings</span>
        )}
      </td>
    </tr>
  );
}
