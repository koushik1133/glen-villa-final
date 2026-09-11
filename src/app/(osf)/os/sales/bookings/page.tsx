import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  PageHeader,
  SetupNotice,
  Stat,
  formatCr,
  formatInr,
} from "@/components/osf/ui";
import { parseRange, rangeLabel, rangeStartIso } from "@/components/osf/shell/nav-config";
import { gatedLoad } from "@/lib/osf/queries";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  activeMembers,
  bookableUnits,
  collectedFor,
  countBookings,
  derivePaymentStatus,
  formatDay,
  istDateOf,
  istToday,
  leadOptions,
  listBookings,
  milestoneTotalsFor,
  projectOptions,
  villaTypeOptions,
  type BookingRow,
  type MilestoneTotals,
} from "@/lib/osf/sales";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function BookingsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const range = parseRange(params.range);
  // booking_date is a `date`, so the window becomes the IST calendar day the
  // lookback lands on rather than an instant.
  const since = istDateOf(rangeStartIso(range));

  const page = await gatedLoad({ table: "villa_bookings", migration: "001_schema.sql" }, async () => {
    const bookings = await listBookings(200, since);
    const [totals, total, leads, projects, types, units, members] = await Promise.all([
      milestoneTotalsFor(bookings.map((b) => b.id)),
      countBookings(),
      leadOptions(),
      projectOptions(),
      villaTypeOptions(),
      bookableUnits(),
      activeMembers(),
    ]);
    return { bookings, totals, total, leads, projects, types, units, members };
  });

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Bookings" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const { bookings, totals, total, leads, projects, types, units, members } = page.data;
  const error = typeof params.error === "string" ? params.error : undefined;

  const live = bookings.filter((b) => b.status !== "cancelled");
  const bookedInr = live.reduce((sum, b) => sum + b.value_inr, 0);
  const collectedInr = live.reduce((sum, b) => sum + collectedFor(b, totals.get(b.id)), 0);
  const registered = live.filter((b) => b.status === "registered").length;
  const hidden = total - bookings.length;

  return (
    <>
      <PageHeader
        title="Bookings"
        sub="Every closed sale. Creating one moves the lead to Booked and copies its source and campaign across, so revenue stays attributable even if the lead is edited later."
        actions={
          <Link href="/os/sales/revenue" className="btn-ghost">
            Revenue
            <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden />
          </Link>
        }
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-[rgba(244,105,95,0.3)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bookings" value={live.length} sub={rangeLabel(range)} />
        <Stat label="Booked value" value={bookedInr > 0 ? formatCr(bookedInr) : "—"} gold />
        <Stat
          label="Collected"
          value={collectedInr > 0 ? formatCr(collectedInr) : "—"}
          sub={bookedInr > 0 ? `${((collectedInr / bookedInr) * 100).toFixed(0)}% of booked value` : undefined}
        />
        <Stat label="Registered" value={registered} sub="Sale complete" />
      </div>

      <NewBookingForm
        leads={leads}
        projects={projects}
        types={types}
        units={units}
        members={members}
      />

      <Card
        className="mt-5"
        title="Booking register"
        hint={`${rangeLabel(range)}${hidden > 0 ? ` · ${hidden} not shown` : ""}. Payment state is recomputed from the milestone schedule on every render, never read from a stored column.`}
      >
        {bookings.length === 0 ? (
          <Empty>
            {total > 0
              ? `No booking falls in this window. ${total} exist in total.`
              : "No bookings yet. The first one is created from a lead using the form above."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-line)]">
                  <th className="th">Booking</th>
                  <th className="th">Customer</th>
                  <th className="th">Unit</th>
                  <th className="th text-right">Value</th>
                  <th className="th text-right">Collected</th>
                  <th className="th">Status</th>
                  <th className="th">Payment</th>
                  <th className="th">Rep</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {bookings.map((b) => (
                  <BookingLine key={b.id} booking={b} totals={totals.get(b.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function BookingLine({ booking, totals }: { booking: BookingRow; totals?: MilestoneTotals }) {
  const collected = collectedFor(booking, totals);
  // Cancelled bookings are not owed on, so an overdue milestone under one is
  // not a receivable and must not colour the row red.
  const overdue = booking.status === "cancelled" ? 0 : (totals?.overdueInr ?? 0);
  const payment = derivePaymentStatus(booking.value_inr, collected, overdue);
  const unit = booking.villa_units?.unit_number;

  return (
    <tr className="row-hover">
      <td className="td whitespace-nowrap">
        <Link
          href={`/os/sales/bookings/${booking.id}`}
          className="font-mono text-[13px] text-[var(--color-gold-300)] hover:text-[var(--color-gold-100)]"
        >
          {booking.booking_number}
        </Link>
        <span className="mt-0.5 block text-xs text-[var(--color-faint)]">
          {formatDay(booking.booking_date)}
        </span>
      </td>
      <td className="td">
        <span className="block truncate">{booking.customer_name}</span>
        <span className="mt-0.5 block font-mono text-xs text-[var(--color-faint)]">
          +{booking.customer_phone}
        </span>
      </td>
      <td className="td">
        <span className="block text-[13px]">{unit ?? "—"}</span>
        <span className="mt-0.5 block text-xs text-[var(--color-faint)]">
          {[booking.villa_projects?.name, booking.villa_types?.name].filter(Boolean).join(" · ") || "Not set"}
        </span>
      </td>
      {/* A zero value means nobody has recorded the price, not a free villa. */}
      <td className="td whitespace-nowrap text-right tabular-nums">
        {booking.value_inr > 0 ? formatCr(booking.value_inr) : <span className="text-[var(--color-faint)]">—</span>}
      </td>
      <td className="td whitespace-nowrap text-right tabular-nums">
        {collected > 0 ? formatCr(collected) : <span className="text-[var(--color-faint)]">—</span>}
        {booking.token_amount_inr > 0 && (
          <span className="mt-0.5 block text-xs text-[var(--color-faint)]">
            token {formatInr(booking.token_amount_inr)}
          </span>
        )}
      </td>
      <td className="td whitespace-nowrap">
        <Badge tone={BOOKING_STATUS_TONES[booking.status]}>
          {BOOKING_STATUS_LABELS[booking.status]}
        </Badge>
      </td>
      <td className="td whitespace-nowrap">
        <Badge tone={PAYMENT_STATUS_TONES[payment]}>{PAYMENT_STATUS_LABELS[payment]}</Badge>
      </td>
      <td className="td whitespace-nowrap text-[13px] text-[var(--color-muted)]">
        {booking.villa_team_members?.name ?? <span className="text-[var(--color-faint)]">Unassigned</span>}
      </td>
    </tr>
  );
}

function NewBookingForm({
  leads,
  projects,
  types,
  units,
  members,
}: {
  leads: Awaited<ReturnType<typeof leadOptions>>;
  projects: Awaited<ReturnType<typeof projectOptions>>;
  types: Awaited<ReturnType<typeof villaTypeOptions>>;
  units: Awaited<ReturnType<typeof bookableUnits>>;
  members: Awaited<ReturnType<typeof activeMembers>>;
}) {
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const year = istToday().slice(0, 4);

  return (
    // <details> rather than a right-hand rail: the register is a ledger and
    // wants the full width, and raising a booking is an occasional act, not the
    // thing you came to this page to read.
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">New booking</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">
            Numbered GS-{year}-NNNN in creation order. The payment schedule is built on the
            booking&rsquo;s own page afterwards.
          </p>
        </div>
        <span className="btn-ghost shrink-0 px-3 py-1.5 text-xs">
          <Plus size={13} strokeWidth={2} aria-hidden />
          <span className="group-open:hidden">Raise a booking</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>

      <div className="mt-5 border-t border-[var(--color-line)] pt-5">
        {leads.length === 0 ? (
          <Empty>
            A booking is always raised against a real lead so revenue stays attributable.{" "}
            <Link href="/os/crm/leads" className="text-[var(--color-gold-300)] underline">
              Start from the leads list
            </Link>
            .
          </Empty>
        ) : (
          <form action="/api/osf/sales" method="POST" className="space-y-4">
            <input type="hidden" name="action" value="create-booking" />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="label mb-1.5 block">Lead</span>
                <select name="leadId" required defaultValue="" className="field">
                  <option value="" disabled>
                    Select a lead
                  </option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name ?? "Unnamed"} · +{l.phone}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label mb-1.5 block">Customer name</span>
                <input
                  type="text"
                  name="customerName"
                  placeholder="Defaults to the lead's name"
                  className="field"
                />
              </label>

              <label className="block">
                <span className="label mb-1.5 block">Project</span>
                <select name="projectId" defaultValue="" className="field">
                  <option value="">Not set</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label mb-1.5 block">Villa type</span>
                <select name="villaTypeId" defaultValue="" className="field">
                  <option value="">Not set</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {projectName.get(t.project_id) ?? "—"} · {t.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label mb-1.5 block">Unit</span>
                <select name="unitId" defaultValue="" className="field">
                  <option value="">Not set</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unit_number} · {projectName.get(u.project_id) ?? "—"}
                      {u.price_inr ? ` · ${formatCr(u.price_inr)}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label mb-1.5 block">Value (₹)</span>
                <input
                  type="number"
                  name="valueInr"
                  required
                  min={0}
                  step={1}
                  placeholder="32500000"
                  className="field tabular-nums"
                />
              </label>

              <label className="block">
                <span className="label mb-1.5 block">Token (₹)</span>
                <input
                  type="number"
                  name="tokenAmountInr"
                  min={0}
                  step={1}
                  placeholder="500000"
                  className="field tabular-nums"
                />
              </label>

              <label className="block">
                <span className="label mb-1.5 block">Sales rep</span>
                <select name="assignedTo" defaultValue="" className="field">
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block">
                <span className="label mb-1.5 block">Notes</span>
                <input
                  type="text"
                  name="notes"
                  placeholder="Anything the paperwork should carry"
                  className="field"
                />
              </label>
              <button type="submit" className="btn-gold">
                Create booking
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
