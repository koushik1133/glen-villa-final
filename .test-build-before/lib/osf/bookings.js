"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_STATUS_LABELS = exports.PAYMENT_STATUSES = exports.BOOKING_STATUS_LABELS = exports.BOOKING_STATUSES = void 0;
exports.isBookingStatus = isBookingStatus;
exports.isPaymentStatus = isPaymentStatus;
exports.derivePaymentStatus = derivePaymentStatus;
exports.listBookings = listBookings;
exports.bookingById = bookingById;
exports.listPayments = listPayments;
exports.bookableLeads = bookableLeads;
exports.activeTeamMembers = activeTeamMembers;
exports.createBooking = createBooking;
exports.updateBookingStatus = updateBookingStatus;
exports.addPayment = addPayment;
exports.setPaymentStatus = setPaymentStatus;
exports.revenueMonthly = revenueMonthly;
exports.revenueSummary = revenueSummary;
exports.revenueBySource = revenueBySource;
const supabase_1 = require("./supabase");
/**
 * Bookings, milestone payments and revenue rollups (villa_bookings,
 * villa_payments, villa_revenue_monthly — see 0009_business_os.sql).
 *
 * Money is bigint rupees in Postgres. PostgREST serialises bigint as a JSON
 * number, but the sum() aggregates inside villa_revenue_monthly are numeric and
 * can come back as strings, so every amount goes through toInt() on the way in
 * and is only ever added or subtracted afterwards.
 */
exports.BOOKING_STATUSES = [
    "initiated",
    "agreement_sent",
    "signed",
    "advance_paid",
    "registered",
    "cancelled",
];
exports.BOOKING_STATUS_LABELS = {
    initiated: "Initiated",
    agreement_sent: "Agreement sent",
    signed: "Signed",
    advance_paid: "Advance paid",
    registered: "Registered",
    cancelled: "Cancelled",
};
exports.PAYMENT_STATUSES = ["pending", "partial", "paid", "overdue", "refunded"];
exports.PAYMENT_STATUS_LABELS = {
    pending: "Pending",
    partial: "Partial",
    paid: "Paid",
    overdue: "Overdue",
    refunded: "Refunded",
};
const BOOKING_SELECT = "*, villa_projects(name), villa_types(name), villa_team_members(name)";
function toInt(value) {
    const n = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(n) ? Math.trunc(n) : 0;
}
/** The developer and every deadline on these records are in IST; the server may not be. */
function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
function isBookingStatus(value) {
    return exports.BOOKING_STATUSES.includes(value);
}
function isPaymentStatus(value) {
    return exports.PAYMENT_STATUSES.includes(value);
}
/**
 * Payment state is a function of two columns, so it is computed rather than
 * trusted — a stored payment_status that drifted would otherwise lie.
 */
function derivePaymentStatus(valueInr, paidInr) {
    if (valueInr > 0 && paidInr >= valueInr)
        return "paid";
    if (paidInr > 0)
        return "partial";
    return "pending";
}
function normalizeBooking(row) {
    return {
        ...row,
        value_inr: toInt(row.value_inr),
        amount_paid_inr: toInt(row.amount_paid_inr),
    };
}
async function listBookings(limit = 100) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select(BOOKING_SELECT)
        .order("booking_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
    return (data ?? []).map((r) => normalizeBooking(r));
}
async function bookingById(id) {
    const { data } = await (0, supabase_1.db)().from("villa_bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
    return data ? normalizeBooking(data) : null;
}
async function listPayments(bookingId) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_payments")
        .select("*")
        .eq("booking_id", bookingId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
    return (data ?? []).map((p) => ({
        ...p,
        amount_inr: toInt(p.amount_inr),
    }));
}
/** Leads that can be turned into a booking — the dropdown on /bookings. */
async function bookableLeads(limit = 200) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("id, name, phone, source, campaign, pipeline_stage")
        .order("last_contact_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
async function activeTeamMembers() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("id, name, role")
        .eq("is_active", true)
        .order("name");
    return (data ?? []);
}
async function nextSequenceFor(year) {
    const { count } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select("id", { count: "exact", head: true })
        .like("booking_number", `GS-${year}-%`);
    return (count ?? 0) + 1;
}
/**
 * Creates a booking and closes the loop on the lead: the lead moves to
 * 'booked', and its source/campaign are copied onto the booking so revenue
 * attribution survives any later edit to the lead record.
 */
async function createBooking(input) {
    if (!input.leadId)
        return { ok: false, error: "Pick a lead to book." };
    if (!Number.isFinite(input.valueInr) || input.valueInr < 0) {
        return { ok: false, error: "Booking value must be a whole number of rupees." };
    }
    const { data: lead, error: leadError } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("id, name, phone, email, source, campaign")
        .eq("id", input.leadId)
        .maybeSingle();
    if (leadError)
        return { ok: false, error: leadError.message };
    if (!lead)
        return { ok: false, error: "That lead no longer exists." };
    const name = input.customerName?.trim() || lead.name;
    const payload = {
        lead_id: lead.id,
        project_id: input.projectId || null,
        villa_type_id: input.villaTypeId || null,
        // customer_name is NOT NULL and the phone is the only identity an unnamed
        // lead has actually given us — inventing a placeholder name would be worse.
        customer_name: name || `+${lead.phone}`,
        customer_phone: lead.phone,
        customer_email: lead.email ?? null,
        value_inr: Math.trunc(input.valueInr),
        booking_date: today(),
        assigned_to: input.assignedTo || null,
        source: lead.source ?? null,
        campaign: lead.campaign ?? null,
    };
    const year = new Date(payload.booking_date).getUTCFullYear();
    let sequence = await nextSequenceFor(year);
    let created = null;
    let lastError = "Could not allocate a booking number.";
    // booking_number is unique, and a count-derived sequence can collide if two
    // reps book at once or an old booking was deleted. Retry on the unique
    // violation rather than handing the user an opaque 23505.
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const bookingNumber = `GS-${year}-${String(sequence).padStart(4, "0")}`;
        const { data, error } = await (0, supabase_1.db)()
            .from("villa_bookings")
            .insert({ ...payload, booking_number: bookingNumber })
            .select("*")
            .single();
        if (!error && data) {
            created = normalizeBooking(data);
            break;
        }
        lastError = error?.message ?? lastError;
        if (error?.code !== "23505")
            return { ok: false, error: lastError };
        sequence += 1;
    }
    if (!created)
        return { ok: false, error: lastError };
    await (0, supabase_1.db)().from("villa_leads").update({ pipeline_stage: "booked" }).eq("id", lead.id);
    return { ok: true, data: created };
}
async function updateBookingStatus(id, status) {
    if (!isBookingStatus(status))
        return { ok: false, error: `Unknown booking status: ${status}` };
    const { data: current } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select("agreement_date, registration_date")
        .eq("id", id)
        .maybeSingle();
    if (!current)
        return { ok: false, error: "Booking not found." };
    const patch = { status };
    // The milestone dates are what the status transition means, so stamp them
    // once here instead of asking the rep to type today's date twice.
    if (status === "signed" && !current.agreement_date)
        patch.agreement_date = today();
    if (status === "registered" && !current.registration_date)
        patch.registration_date = today();
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, data: normalizeBooking(data) };
}
/** Recomputes amount_paid_inr from the paid milestones so the two can never disagree. */
async function resyncCollected(bookingId) {
    const { data: paidRows } = await (0, supabase_1.db)()
        .from("villa_payments")
        .select("amount_inr")
        .eq("booking_id", bookingId)
        .eq("status", "paid");
    const collected = (paidRows ?? []).reduce((sum, row) => sum + toInt(row.amount_inr), 0);
    const { data: booking } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select("value_inr")
        .eq("id", bookingId)
        .maybeSingle();
    await (0, supabase_1.db)()
        .from("villa_bookings")
        .update({
        amount_paid_inr: collected,
        payment_status: derivePaymentStatus(toInt(booking?.value_inr), collected),
    })
        .eq("id", bookingId);
}
async function addPayment(input) {
    if (!input.bookingId)
        return { ok: false, error: "Missing booking." };
    if (!input.milestone.trim())
        return { ok: false, error: "Give the milestone a name." };
    if (!Number.isFinite(input.amountInr) || input.amountInr <= 0) {
        return { ok: false, error: "Payment amount must be a whole number of rupees above zero." };
    }
    const status = input.status && isPaymentStatus(input.status) ? input.status : "pending";
    const { data, error } = await (0, supabase_1.db)()
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
    if (error)
        return { ok: false, error: error.message };
    await resyncCollected(input.bookingId);
    return { ok: true, data: { ...data, amount_inr: toInt(data.amount_inr) } };
}
async function setPaymentStatus(paymentId, status) {
    if (!isPaymentStatus(status))
        return { ok: false, error: `Unknown payment status: ${status}` };
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_payments")
        .update({ status, paid_date: status === "paid" ? today() : null })
        .eq("id", paymentId)
        .select("*")
        .single();
    if (error)
        return { ok: false, error: error.message };
    await resyncCollected(data.booking_id);
    return { ok: true, data: { ...data, amount_inr: toInt(data.amount_inr) } };
}
async function revenueMonthly() {
    const { data } = await (0, supabase_1.db)().from("villa_revenue_monthly").select("*");
    return (data ?? []).map((r) => {
        const row = r;
        return {
            month: row.month,
            bookings: toInt(row.bookings),
            booked_value_inr: toInt(row.booked_value_inr),
            collected_inr: toInt(row.collected_inr),
        };
    });
}
/**
 * Summed from villa_revenue_monthly rather than from villa_bookings directly,
 * so the KPI row and the month table can never show contradicting totals. The
 * view already excludes cancelled bookings.
 */
async function revenueSummary() {
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
/** Splits revenue by the attribution copied onto the booking, not the lead's current values. */
async function revenueBySource() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select("source, campaign, value_inr, amount_paid_inr")
        .neq("status", "cancelled");
    const grouped = new Map();
    for (const r of data ?? []) {
        const row = r;
        const source = row.source ?? null;
        const campaign = row.campaign ?? null;
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
