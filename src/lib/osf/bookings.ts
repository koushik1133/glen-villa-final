import { db } from "./supabase";

/**
 * Bookings, milestone payments and revenue rollups (villa_bookings,
 * villa_payments, villa_revenue_monthly — see 0009_business_os.sql).
 *
 * Money is bigint rupees in Postgres. PostgREST serialises bigint as a JSON
 * number, but the sum() aggregates inside villa_revenue_monthly are numeric and
 * can come back as strings, so every amount goes through toInt() on the way in
 * and is only ever added or subtracted afterwards.
 */

export const BOOKING_STATUSES = [
  "initiated",
  "agreement_sent",
  "signed",
  "advance_paid",
  "registered",
  "cancelled",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  initiated: "Initiated",
  agreement_sent: "Agreement sent",
  signed: "Signed",
  advance_paid: "Advance paid",
  registered: "Registered",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUSES = ["pending", "partial", "paid", "overdue", "refunded"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  partial: "Partial",
  paid: "Paid",
  overdue: "Overdue",
  refunded: "Refunded",
};

export interface Booking {
  id: string;
  booking_number: string;
  lead_id: string | null;
  project_id: string | null;
  villa_type_id: string | null;
  unit_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  value_inr: number;
  amount_paid_inr: number;
  booking_date: string;
  agreement_date: string | null;
  registration_date: string | null;
  status: BookingStatus;
  payment_status: PaymentStatus;
  assigned_to: string | null;
  source: string | null;
  campaign: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A booking with its related names resolved, which is all the tables need. */
export interface BookingRow extends Booking {
  villa_projects: { name: string } | null;
  villa_types: { name: string } | null;
  villa_team_members: { name: string } | null;
}

export interface Payment {
  id: string;
  booking_id: string;
  milestone: string;
  amount_inr: number;
  due_date: string | null;
  paid_date: string | null;
  status: PaymentStatus;
  created_at: string;
}

export interface BookableLead {
  id: string;
  name: string | null;
  phone: string;
  source: string;
  campaign: string | null;
  pipeline_stage: string;
}

export interface TeamMemberOption {
  id: string;
  name: string;
  role: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const BOOKING_SELECT = "*, villa_projects(name), villa_types(name), villa_team_members(name)";

function toInt(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** The developer and every deadline on these records are in IST; the server may not be. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Payment state is a function of two columns, so it is computed rather than
 * trusted — a stored payment_status that drifted would otherwise lie.
 */
export function derivePaymentStatus(valueInr: number, paidInr: number): PaymentStatus {
  if (valueInr > 0 && paidInr >= valueInr) return "paid";
  if (paidInr > 0) return "partial";
  return "pending";
}

function normalizeBooking(row: Record<string, unknown>): BookingRow {
  return {
    ...(row as unknown as BookingRow),
    value_inr: toInt(row.value_inr),
    amount_paid_inr: toInt(row.amount_paid_inr),
  };
}

export async function listBookings(limit = 100): Promise<BookingRow[]> {
  const { data } = await db()
    .from("villa_bookings")
    .select(BOOKING_SELECT)
    .order("booking_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => normalizeBooking(r as Record<string, unknown>));
}

export async function bookingById(id: string): Promise<BookingRow | null> {
  const { data } = await db().from("villa_bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
  return data ? normalizeBooking(data as Record<string, unknown>) : null;
}

export async function listPayments(bookingId: string): Promise<Payment[]> {
  const { data } = await db()
    .from("villa_payments")
    .select("*")
    .eq("booking_id", bookingId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  return (data ?? []).map((p) => ({
    ...(p as unknown as Payment),
    amount_inr: toInt((p as Record<string, unknown>).amount_inr),
  }));
}

/** Leads that can be turned into a booking — the dropdown on /bookings. */
export async function bookableLeads(limit = 200): Promise<BookableLead[]> {
  const { data } = await db()
    .from("villa_leads")
    .select("id, name, phone, source, campaign, pipeline_stage")
    .order("last_contact_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as BookableLead[];
}

export async function activeTeamMembers(): Promise<TeamMemberOption[]> {
  const { data } = await db()
    .from("villa_team_members")
    .select("id, name, role")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as TeamMemberOption[];
}

async function nextSequenceFor(year: number): Promise<number> {
  const { count } = await db()
    .from("villa_bookings")
    .select("id", { count: "exact", head: true })
    .like("booking_number", `GS-${year}-%`);
  return (count ?? 0) + 1;
}

export interface NewBookingInput {
  leadId: string;
  projectId?: string | null;
  villaTypeId?: string | null;
  valueInr: number;
  customerName?: string | null;
  assignedTo?: string | null;
}

/**
 * Creates a booking and closes the loop on the lead: the lead moves to
 * 'booked', and its source/campaign are copied onto the booking so revenue
 * attribution survives any later edit to the lead record.
 */
export async function createBooking(input: NewBookingInput): Promise<Result<Booking>> {
  if (!input.leadId) return { ok: false, error: "Pick a lead to book." };
  if (!Number.isFinite(input.valueInr) || input.valueInr < 0) {
    return { ok: false, error: "Booking value must be a whole number of rupees." };
  }

  const { data: lead, error: leadError } = await db()
    .from("villa_leads")
    .select("id, name, phone, email, source, campaign")
    .eq("id", input.leadId)
    .maybeSingle();

  if (leadError) return { ok: false, error: leadError.message };
  if (!lead) return { ok: false, error: "That lead no longer exists." };

  const name = input.customerName?.trim() || (lead.name as string | null);
  const payload = {
    lead_id: lead.id as string,
    project_id: input.projectId || null,
    villa_type_id: input.villaTypeId || null,
    // customer_name is NOT NULL and the phone is the only identity an unnamed
    // lead has actually given us — inventing a placeholder name would be worse.
    customer_name: name || `+${lead.phone as string}`,
    customer_phone: lead.phone as string,
    customer_email: (lead.email as string | null) ?? null,
    value_inr: Math.trunc(input.valueInr),
    booking_date: today(),
    assigned_to: input.assignedTo || null,
    source: (lead.source as string | null) ?? null,
    campaign: (lead.campaign as string | null) ?? null,
  };

  const year = new Date(payload.booking_date).getUTCFullYear();
  let sequence = await nextSequenceFor(year);
  let created: Booking | null = null;
  let lastError = "Could not allocate a booking number.";

  // booking_number is unique, and a count-derived sequence can collide if two
  // reps book at once or an old booking was deleted. Retry on the unique
  // violation rather than handing the user an opaque 23505.
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const bookingNumber = `GS-${year}-${String(sequence).padStart(4, "0")}`;
    const { data, error } = await db()
      .from("villa_bookings")
      .insert({ ...payload, booking_number: bookingNumber })
      .select("*")
      .single();

    if (!error && data) {
      created = normalizeBooking(data as Record<string, unknown>);
      break;
    }
    lastError = error?.message ?? lastError;
    if (error?.code !== "23505") return { ok: false, error: lastError };
    sequence += 1;
  }

  if (!created) return { ok: false, error: lastError };

  await db().from("villa_leads").update({ pipeline_stage: "booked" }).eq("id", lead.id as string);

  return { ok: true, data: created };
}

export async function updateBookingStatus(id: string, status: string): Promise<Result<Booking>> {
  if (!isBookingStatus(status)) return { ok: false, error: `Unknown booking status: ${status}` };

  const { data: current } = await db()
    .from("villa_bookings")
    .select("agreement_date, registration_date")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { ok: false, error: "Booking not found." };

  const patch: Record<string, unknown> = { status };
  // The milestone dates are what the status transition means, so stamp them
  // once here instead of asking the rep to type today's date twice.
  if (status === "signed" && !current.agreement_date) patch.agreement_date = today();
  if (status === "registered" && !current.registration_date) patch.registration_date = today();

  const { data, error } = await db()
    .from("villa_bookings")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: normalizeBooking(data as Record<string, unknown>) };
}

/** Recomputes amount_paid_inr from the paid milestones so the two can never disagree. */
async function resyncCollected(bookingId: string): Promise<void> {
  const { data: paidRows } = await db()
    .from("villa_payments")
    .select("amount_inr")
    .eq("booking_id", bookingId)
    .eq("status", "paid");

  const collected = (paidRows ?? []).reduce(
    (sum, row) => sum + toInt((row as Record<string, unknown>).amount_inr),
    0,
  );

  const { data: booking } = await db()
    .from("villa_bookings")
    .select("value_inr")
    .eq("id", bookingId)
    .maybeSingle();

  await db()
    .from("villa_bookings")
    .update({
      amount_paid_inr: collected,
      payment_status: derivePaymentStatus(toInt(booking?.value_inr), collected),
    })
    .eq("id", bookingId);
}

export interface NewPaymentInput {
  bookingId: string;
  milestone: string;
  amountInr: number;
  dueDate?: string | null;
  status?: string;
}

export async function addPayment(input: NewPaymentInput): Promise<Result<Payment>> {
  if (!input.bookingId) return { ok: false, error: "Missing booking." };
  if (!input.milestone.trim()) return { ok: false, error: "Give the milestone a name." };
  if (!Number.isFinite(input.amountInr) || input.amountInr <= 0) {
    return { ok: false, error: "Payment amount must be a whole number of rupees above zero." };
  }

  const status = input.status && isPaymentStatus(input.status) ? input.status : "pending";

  const { data, error } = await db()
    .from("villa_payments")
    .insert({
      booking_id: input.bookingId,
      milestone: input.milestone.trim(),
      amount_inr: Math.trunc(input.amountInr),
      due_date: input.dueDate || null,
      paid_date: status === "paid" ? today() : null,
      status,
    })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };

  await resyncCollected(input.bookingId);
  return { ok: true, data: { ...(data as unknown as Payment), amount_inr: toInt(data.amount_inr) } };
}

export async function setPaymentStatus(paymentId: string, status: string): Promise<Result<Payment>> {
  if (!isPaymentStatus(status)) return { ok: false, error: `Unknown payment status: ${status}` };

  const { data, error } = await db()
    .from("villa_payments")
    .update({ status, paid_date: status === "paid" ? today() : null })
    .eq("id", paymentId)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };

  await resyncCollected(data.booking_id as string);
  return { ok: true, data: { ...(data as unknown as Payment), amount_inr: toInt(data.amount_inr) } };
}

export interface RevenueMonth {
  month: string;
  bookings: number;
  booked_value_inr: number;
  collected_inr: number;
}

export async function revenueMonthly(): Promise<RevenueMonth[]> {
  const { data } = await db().from("villa_revenue_monthly").select("*");
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      month: row.month as string,
      bookings: toInt(row.bookings),
      booked_value_inr: toInt(row.booked_value_inr),
      collected_inr: toInt(row.collected_inr),
    };
  });
}

export interface RevenueSummary {
  bookedValueInr: number;
  collectedInr: number;
  receivablesInr: number;
  bookingCount: number;
  averageBookingValueInr: number;
}

/**
 * Summed from villa_revenue_monthly rather than from villa_bookings directly,
 * so the KPI row and the month table can never show contradicting totals. The
 * view already excludes cancelled bookings.
 */
export async function revenueSummary(): Promise<RevenueSummary> {
  const months = await revenueMonthly();

  let bookedValueInr = 0;
  let collectedInr = 0;
  let bookingCount = 0;
  for (const m of months) {
    bookedValueInr += m.booked_value_inr;
    collectedInr += m.collected_inr;
    bookingCount += m.bookings;
  }

  return {
    bookedValueInr,
    collectedInr,
    receivablesInr: bookedValueInr - collectedInr,
    bookingCount,
    averageBookingValueInr: bookingCount > 0 ? Math.round(bookedValueInr / bookingCount) : 0,
  };
}

export interface RevenueBySource {
  source: string | null;
  campaign: string | null;
  bookings: number;
  booked_value_inr: number;
  collected_inr: number;
}

/** Splits revenue by the attribution copied onto the booking, not the lead's current values. */
export async function revenueBySource(): Promise<RevenueBySource[]> {
  const { data } = await db()
    .from("villa_bookings")
    .select("source, campaign, value_inr, amount_paid_inr")
    .neq("status", "cancelled");

  const grouped = new Map<string, RevenueBySource>();
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    const source = (row.source as string | null) ?? null;
    const campaign = (row.campaign as string | null) ?? null;
    const key = `${source ?? ""}::${campaign ?? ""}`;
    const entry = grouped.get(key) ?? {
      source,
      campaign,
      bookings: 0,
      booked_value_inr: 0,
      collected_inr: 0,
    };
    entry.bookings += 1;
    entry.booked_value_inr += toInt(row.value_inr);
    entry.collected_inr += toInt(row.amount_paid_inr);
    grouped.set(key, entry);
  }

  return [...grouped.values()].sort((a, b) => b.booked_value_inr - a.booked_value_inr);
}
