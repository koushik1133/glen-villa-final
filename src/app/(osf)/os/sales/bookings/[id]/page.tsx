import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatCr,
  formatInr,
} from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import {
  BOOKING_PROGRESSION,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  bookingById,
  collectedFor,
  derivePaymentStatus,
  formatDay,
  isOverdue,
  istToday,
  listPayments,
  milestoneTotals,
  type BookingRow,
  type Payment,
} from "@/lib/osf/sales";

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;

  const page = await gatedLoad({ table: "villa_bookings", migration: "001_schema.sql" }, () =>
    Promise.all([searchParams, bookingById(id), listPayments(id)] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Booking" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [query, booking, payments] = page.data;
  if (!booking) notFound();

  const error = typeof query.error === "string" ? query.error : undefined;
  const today = istToday();
  const totals = milestoneTotals(payments, today);
  const collected = collectedFor(booking, totals);
  const cancelled = booking.status === "cancelled";
  const overdueInr = cancelled ? 0 : totals.overdueInr;
  const payment = derivePaymentStatus(booking.value_inr, collected, overdueInr);
  const outstanding = Math.max(0, booking.value_inr - collected);
  const scheduledInr = payments.reduce((sum, p) => sum + p.amount_inr, 0);
  const unscheduled = booking.value_inr - scheduledInr;

  return (
    <>
      <PageHeader
        title={booking.booking_number}
        sub={`${booking.customer_name} · ${[booking.villa_projects?.name, booking.villa_types?.name, booking.villa_units?.unit_number].filter(Boolean).join(" · ") || "No unit assigned"}`}
        actions={
          <Link href="/os/sales/bookings" className="btn-ghost">
            <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
            All bookings
          </Link>
        }
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-[rgba(244,105,95,0.3)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Booking value"
          value={booking.value_inr > 0 ? formatCr(booking.value_inr) : "—"}
          sub={booking.value_inr > 0 ? undefined : "No price recorded on this booking"}
          gold
        />
        <Stat
          label="Token amount"
          value={booking.token_amount_inr > 0 ? formatInr(booking.token_amount_inr) : "—"}
          sub="Booked against the value, not on top of it"
        />
        <Stat
          label="Collected"
          value={collected > 0 ? formatCr(collected) : "—"}
          sub={totals.count > 0 ? `From ${totals.count} milestone${totals.count === 1 ? "" : "s"}` : "No schedule yet"}
        />
        <Stat
          label="Outstanding"
          value={outstanding > 0 ? formatCr(outstanding) : "—"}
          sub={overdueInr > 0 ? `${formatInr(overdueInr)} past due` : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card
            title="Progress"
            hint="Signing stamps the agreement date and registering stamps the registration date — neither is retyped."
            actions={
              <Badge tone={BOOKING_STATUS_TONES[booking.status]}>
                {BOOKING_STATUS_LABELS[booking.status]}
              </Badge>
            }
          >
            <StatusRail booking={booking} />

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--color-line)] pt-4 sm:grid-cols-3">
              <Fact label="Booked" value={formatDay(booking.booking_date)} />
              <Fact label="Agreement signed" value={formatDay(booking.agreement_date)} />
              <Fact label="Registered" value={formatDay(booking.registration_date)} />
            </div>

            {!cancelled && (
              <form action="/api/osf/sales" method="POST" className="mt-4 border-t border-[var(--color-line)] pt-4">
                <input type="hidden" name="action" value="booking-status" />
                <input type="hidden" name="bookingId" value={booking.id} />
                <button
                  type="submit"
                  name="status"
                  value="cancelled"
                  className="btn-ghost px-3 py-1.5 text-xs text-[var(--color-danger)]"
                >
                  Cancel this booking
                </button>
                <span className="ml-3 text-xs text-[var(--color-faint)]">
                  Drops it out of revenue and receivables. The record and its schedule stay.
                </span>
              </form>
            )}
          </Card>

          <Card
            title="Payment schedule"
            hint="Payment state on every list is derived from these rows, so the schedule is the record of truth."
            actions={<Badge tone={PAYMENT_STATUS_TONES[payment]}>{PAYMENT_STATUS_LABELS[payment]}</Badge>}
          >
            <div className="mb-4">
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="text-[var(--color-muted)]">
                  {formatInr(collected)} collected of {formatInr(booking.value_inr)}
                </span>
                {unscheduled > 0 && payments.length > 0 && (
                  <span className="tabular-nums text-[var(--color-warm)]">
                    {formatInr(unscheduled)} not yet scheduled
                  </span>
                )}
              </div>
              <Meter value={collected} max={booking.value_inr} />
            </div>

            {payments.length === 0 ? (
              <Empty>
                No milestones yet. Until one exists, collection falls back to the amount recorded on
                the booking itself.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-line)]">
                      <th className="th">Milestone</th>
                      <th className="th">Due</th>
                      <th className="th text-right">Amount</th>
                      <th className="th">Status</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {payments.map((p) => (
                      <PaymentLine key={p.id} payment={p} bookingId={booking.id} today={today} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form
              action="/api/osf/sales"
              method="POST"
              className="mt-4 grid gap-3 border-t border-[var(--color-line)] pt-4 sm:grid-cols-[2fr_1fr_1fr_auto]"
            >
              <input type="hidden" name="action" value="add-payment" />
              <input type="hidden" name="bookingId" value={booking.id} />
              <label className="block">
                <span className="label mb-1.5 block">Milestone</span>
                <input
                  type="text"
                  name="milestone"
                  required
                  placeholder="On foundation"
                  className="field"
                />
              </label>
              <label className="block">
                <span className="label mb-1.5 block">Amount (₹)</span>
                <input
                  type="number"
                  name="amountInr"
                  required
                  min={1}
                  step={1}
                  placeholder="2500000"
                  className="field tabular-nums"
                />
              </label>
              <label className="block">
                <span className="label mb-1.5 block">Due date</span>
                <input type="date" name="dueDate" className="field" />
              </label>
              <div className="flex items-end">
                <button type="submit" className="btn-gold w-full sm:w-auto">
                  Add
                </button>
              </div>
            </form>
          </Card>
        </div>

        <Card title="Booking record">
          <dl className="space-y-3.5">
            <Row label="Customer" value={booking.customer_name} />
            <Row label="Phone" value={`+${booking.customer_phone}`} mono />
            <Row label="Email" value={booking.customer_email} />
            <Row
              label="KYC"
              value={booking.kyc_complete ? "Complete" : "Not complete"}
              tone={booking.kyc_complete ? "success" : "warning"}
            />
            <Row label="Project" value={booking.villa_projects?.name} />
            <Row label="Villa type" value={booking.villa_types?.name} />
            <Row label="Unit" value={booking.villa_units?.unit_number} />
            <Row label="Sales rep" value={booking.villa_team_members?.name} />
            <Row label="Source" value={booking.source} />
            <Row label="Campaign" value={booking.campaign} />
          </dl>

          {booking.lead_id && (
            <Link href={`/os/crm/leads/${booking.lead_id}`} className="btn-ghost mt-5 w-full justify-center">
              Open the lead
            </Link>
          )}

          {booking.notes && (
            <p className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 px-3.5 py-3 text-sm text-[var(--color-muted)]">
              {booking.notes}
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------

/**
 * The happy path as a clickable rail. Clicking a stage asserts the booking has
 * reached it — including a step back, because paperwork does get reversed and
 * the alternative is an unfixable record.
 */
function StatusRail({ booking }: { booking: BookingRow }) {
  const current = BOOKING_PROGRESSION.indexOf(booking.status);
  const cancelled = booking.status === "cancelled";

  return (
    <form action="/api/osf/sales" method="POST">
      <input type="hidden" name="action" value="booking-status" />
      <input type="hidden" name="bookingId" value={booking.id} />
      <ol className="grid gap-2 sm:grid-cols-5">
        {BOOKING_PROGRESSION.map((step, i) => {
          const reached = !cancelled && current >= i;
          const isCurrent = !cancelled && current === i;
          return (
            <li key={step}>
              <button
                type="submit"
                name="status"
                value={step}
                disabled={isCurrent || cancelled}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-default ${
                  isCurrent
                    ? "border-[var(--color-gold-line)] bg-[var(--color-gold-soft)]"
                    : reached
                      ? "border-[var(--color-line)] bg-[var(--color-surface)]"
                      : "border-dashed border-[var(--color-line)] bg-transparent hover:border-[var(--color-line-strong)] hover:bg-[var(--color-raised)]"
                } ${cancelled ? "opacity-40" : ""}`}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={`label ${isCurrent ? "text-[var(--color-gold-300)]" : reached ? "text-[var(--color-muted)]" : ""}`}
                  >
                    Step {i + 1}
                  </span>
                  {reached && !isCurrent && (
                    <Check size={11} strokeWidth={2.5} aria-hidden className="text-[var(--color-success)]" />
                  )}
                </span>
                <span
                  className={`mt-1 block text-[13px] ${
                    isCurrent
                      ? "font-semibold text-[var(--color-gold-100)]"
                      : reached
                        ? "text-[var(--color-ink)]"
                        : "text-[var(--color-faint)]"
                  }`}
                >
                  {BOOKING_STATUS_LABELS[step]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {cancelled && (
        <p className="mt-3 text-xs text-[var(--color-danger)]">
          This booking is cancelled. Its value is excluded from revenue and its milestones from
          receivables.
        </p>
      )}
    </form>
  );
}

function PaymentLine({
  payment,
  bookingId,
  today,
}: {
  payment: Payment;
  bookingId: string;
  today: string;
}) {
  const late = isOverdue(payment, today);
  // The stored status goes stale the moment a due date passes, so the row
  // shows what is actually true today.
  const shown = late ? "overdue" : payment.status;

  return (
    <tr className="row-hover">
      <td className="td">{payment.milestone}</td>
      <td className="td tabular-nums">
        <span className={late ? "text-[var(--color-danger)]" : undefined}>
          {formatDay(payment.due_date)}
        </span>
        {payment.paid_date && (
          <span className="mt-0.5 block text-xs text-[var(--color-faint)]">
            paid {formatDay(payment.paid_date)}
          </span>
        )}
      </td>
      <td className="td text-right tabular-nums">{formatInr(payment.amount_inr)}</td>
      <td className="td">
        <Badge tone={PAYMENT_STATUS_TONES[shown]}>{PAYMENT_STATUS_LABELS[shown]}</Badge>
      </td>
      <td className="td text-right">
        {payment.status !== "paid" && (
          <form action="/api/osf/sales" method="POST" className="inline">
            <input type="hidden" name="action" value="payment-status" />
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="paymentId" value={payment.id} />
            <button type="submit" name="status" value="paid" className="btn-ghost px-3 py-1.5 text-xs">
              Mark paid
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-1 text-sm tabular-nums text-[var(--color-ink)]">{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  tone?: "success" | "warning";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="label shrink-0">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-sm ${mono ? "font-mono text-[13px] " : ""}${
          tone === "success"
            ? "text-[var(--color-success)]"
            : tone === "warning"
              ? "text-[var(--color-warm)]"
              : value
                ? "text-[var(--color-ink)]"
                : "text-[var(--color-faint)]"
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
