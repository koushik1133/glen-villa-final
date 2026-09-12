"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGING_BUCKETS = exports.DEPARTMENTS = exports.ROLE_LABELS = exports.USER_ROLES = exports.PAYMENT_STATUS_TONES = exports.PAYMENT_STATUS_LABELS = exports.PAYMENT_STATUSES = exports.BOOKING_STATUS_TONES = exports.BOOKING_STATUS_LABELS = exports.BOOKING_PROGRESSION = exports.BOOKING_STATUSES = exports.VISIT_TYPE_LABELS = exports.VISIT_TYPES = exports.VISIT_TRANSITIONS = exports.OPEN_VISIT_STATUSES = exports.VISIT_STATUS_TONES = exports.VISIT_STATUS_LABELS = exports.VISIT_STATUSES = void 0;
exports.istToday = istToday;
exports.istTimestamp = istTimestamp;
exports.formatDateTimeIst = formatDateTimeIst;
exports.formatDay = formatDay;
exports.istDateParts = istDateParts;
exports.istDateOf = istDateOf;
exports.monthFloor = monthFloor;
exports.formatMonth = formatMonth;
exports.isVisitStatus = isVisitStatus;
exports.isBookingStatus = isBookingStatus;
exports.isPaymentStatus = isPaymentStatus;
exports.isUserRole = isUserRole;
exports.leadOptions = leadOptions;
exports.activeMembers = activeMembers;
exports.projectOptions = projectOptions;
exports.bookableUnits = bookableUnits;
exports.villaTypeOptions = villaTypeOptions;
exports.listSiteVisits = listSiteVisits;
exports.splitVisits = splitVisits;
exports.siteVisitStats = siteVisitStats;
exports.scheduleSiteVisit = scheduleSiteVisit;
exports.updateSiteVisitStatus = updateSiteVisitStatus;
exports.recordVisitOutcome = recordVisitOutcome;
exports.listBookings = listBookings;
exports.countBookings = countBookings;
exports.bookingById = bookingById;
exports.listPayments = listPayments;
exports.isOverdue = isOverdue;
exports.milestoneTotals = milestoneTotals;
exports.milestoneTotalsFor = milestoneTotalsFor;
exports.collectedFor = collectedFor;
exports.derivePaymentStatus = derivePaymentStatus;
exports.createBooking = createBooking;
exports.updateBookingStatus = updateBookingStatus;
exports.addPayment = addPayment;
exports.setPaymentStatus = setPaymentStatus;
exports.revenueMonthly = revenueMonthly;
exports.summariseRevenue = summariseRevenue;
exports.revenueAttribution = revenueAttribution;
exports.receivablesAging = receivablesAging;
exports.teamLeaderboard = teamLeaderboard;
exports.listTeamMembers = listTeamMembers;
exports.createTeamMember = createTeamMember;
exports.toggleMemberActive = toggleMemberActive;
const activities_1 = require("./activities");
const supabase_1 = require("./supabase");
/**
 * The Sales section's data layer: site visits, bookings, milestone payments,
 * revenue rollups and the rep leaderboard.
 *
 * Two conventions run through the whole file.
 *
 * Money is bigint rupees. PostgREST hands bigint back as a JSON number, but the
 * sum()/round() aggregates inside the reporting views are `numeric`, which it
 * serialises as a *string* to avoid precision loss. Everything therefore goes
 * through toInt()/toNum() on the way in and is only ever added afterwards.
 *
 * Time is Asia/Kolkata. Every deadline on these records — a site-visit slot, a
 * payment due date, a booking date — is a wall-clock time the sales team agreed
 * with a customer in India. The server may well be in UTC, so dates are
 * formatted and compared in IST explicitly rather than via the process locale.
 */
const IST = "Asia/Kolkata";
function toInt(value) {
    const n = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function toNum(value) {
    if (value === null || value === undefined)
        return null;
    const n = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(n) ? n : null;
}
/** Today in IST as YYYY-MM-DD, for comparison against `date` columns. */
function istToday() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
}
/**
 * `<input type="datetime-local">` yields a wall-clock string with no zone. Sent
 * as-is to a timestamptz column Postgres would read it in the *session's* zone
 * (UTC on Supabase), silently shifting every appointment by 5h30m. The rep
 * typed an IST time, so say so.
 */
function istTimestamp(local) {
    if (!local)
        return null;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(local.trim());
    return m ? `${m[1]}T${m[2]}:00+05:30` : null;
}
function formatDateTimeIst(iso) {
    if (!iso)
        return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return "—";
    return d.toLocaleString("en-IN", {
        timeZone: IST,
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
}
/**
 * A date on a Sales record, rendered without going through the server's own
 * timezone.
 *
 * Two different things arrive here. `booking_date`, `agreement_date`,
 * `due_date` and friends are Postgres `date` columns — calendar dates with no
 * instant attached, which must round-trip exactly, so they are pinned to UTC.
 * Everything else is a timestamptz representing an IST wall-clock moment.
 * Falling back to the process locale would render a booking dated 14 July as
 * the 13th on any host west of Greenwich, which is how money ends up in the
 * wrong month.
 */
function formatDay(value) {
    if (!value)
        return "—";
    const trimmed = value.trim();
    const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    const d = new Date(calendarDate ? `${trimmed}T00:00:00Z` : trimmed);
    if (Number.isNaN(d.getTime()))
        return "—";
    return d.toLocaleDateString("en-IN", {
        timeZone: calendarDate ? "UTC" : IST,
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}
/** Split parts for the date chip on a visit row. */
function istDateParts(iso) {
    if (!iso)
        return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    return {
        day: d.toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit" }),
        month: d.toLocaleDateString("en-IN", { timeZone: IST, month: "short" }).toUpperCase(),
    };
}
/**
 * The IST calendar date containing an instant, as YYYY-MM-DD.
 *
 * Date windows are compared against `date` columns, which hold the day the
 * sales team agreed with a customer in India. Slicing the date out of a UTC
 * ISO string instead would move the boundary by up to a day for the five and a
 * half hours either side of IST midnight.
 */
function istDateOf(iso) {
    if (!iso)
        return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
}
/**
 * First day of the IST month containing `iso`, as YYYY-MM-DD.
 *
 * Revenue is only ever aggregated per calendar month, so a "last 30 days"
 * window has to be widened to whole months before it can be applied — a raw
 * cutoff would silently drop the part of the current month that falls outside
 * it while still showing the month's full total.
 */
function monthFloor(iso) {
    const day = istDateOf(iso);
    return day ? `${day.slice(0, 7)}-01` : null;
}
/** "2026-08-01" → "Aug 2026". Parsed as UTC because it is a plain calendar date. */
function formatMonth(monthIsoDate) {
    const d = new Date(`${monthIsoDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime()))
        return monthIsoDate;
    return d.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "numeric" });
}
/** Whole days between two YYYY-MM-DD dates. Both are plain calendar dates, so UTC parsing is exact. */
function daysBetween(fromIsoDate, toIsoDate) {
    const a = Date.parse(`${fromIsoDate}T00:00:00Z`);
    const b = Date.parse(`${toIsoDate}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b))
        return 0;
    return Math.round((b - a) / 86_400_000);
}
// -----------------------------------------------------------------------------
// Enums — mirrored from supabase/migrations/001_schema.sql
// -----------------------------------------------------------------------------
exports.VISIT_STATUSES = [
    "requested",
    "scheduled",
    "confirmed",
    "completed",
    "no_show",
    "cancelled",
];
exports.VISIT_STATUS_LABELS = {
    requested: "Requested",
    scheduled: "Scheduled",
    confirmed: "Confirmed",
    completed: "Completed",
    no_show: "No-show",
    cancelled: "Cancelled",
};
exports.VISIT_STATUS_TONES = {
    requested: "warning",
    scheduled: "info",
    confirmed: "gold",
    completed: "success",
    no_show: "danger",
    cancelled: "neutral",
};
/** Statuses that still need someone to do something. */
exports.OPEN_VISIT_STATUSES = ["requested", "scheduled", "confirmed"];
/**
 * Moves offered from each state. Terminal states offer nothing: re-opening a
 * completed visit would orphan its outcome, so that is a new visit instead.
 */
exports.VISIT_TRANSITIONS = {
    requested: ["scheduled", "cancelled"],
    scheduled: ["confirmed", "completed", "no_show", "cancelled"],
    confirmed: ["completed", "no_show", "cancelled"],
    completed: [],
    no_show: [],
    cancelled: [],
};
exports.VISIT_TYPES = ["site", "virtual"];
exports.VISIT_TYPE_LABELS = {
    site: "Site visit",
    virtual: "Virtual tour",
};
exports.BOOKING_STATUSES = [
    "initiated",
    "agreement_sent",
    "signed",
    "token_paid",
    "registered",
    "cancelled",
];
/** The happy path, in order. `cancelled` is deliberately absent — it is an exit, not a step. */
exports.BOOKING_PROGRESSION = [
    "initiated",
    "agreement_sent",
    "signed",
    "token_paid",
    "registered",
];
exports.BOOKING_STATUS_LABELS = {
    initiated: "Initiated",
    agreement_sent: "Agreement sent",
    signed: "Signed",
    token_paid: "Token paid",
    registered: "Registered",
    cancelled: "Cancelled",
};
exports.BOOKING_STATUS_TONES = {
    initiated: "neutral",
    agreement_sent: "info",
    signed: "gold",
    token_paid: "warning",
    registered: "success",
    cancelled: "danger",
};
exports.PAYMENT_STATUSES = ["pending", "partial", "paid", "overdue", "refunded"];
exports.PAYMENT_STATUS_LABELS = {
    pending: "Pending",
    partial: "Partial",
    paid: "Paid",
    overdue: "Overdue",
    refunded: "Refunded",
};
exports.PAYMENT_STATUS_TONES = {
    pending: "neutral",
    partial: "warning",
    paid: "success",
    overdue: "danger",
    refunded: "info",
};
exports.USER_ROLES = [
    "super_admin",
    "sales_director",
    "sales_manager",
    "property_consultant",
    "marketing_manager",
    "marketing_agent",
    "viewer",
];
exports.ROLE_LABELS = {
    super_admin: "Super admin",
    sales_director: "Sales director",
    sales_manager: "Sales manager",
    property_consultant: "Property consultant",
    marketing_manager: "Marketing manager",
    marketing_agent: "Marketing agent",
    viewer: "Viewer",
};
exports.DEPARTMENTS = ["sales", "marketing", "operations", "management"];
function isVisitStatus(v) {
    return exports.VISIT_STATUSES.includes(v);
}
function isBookingStatus(v) {
    return exports.BOOKING_STATUSES.includes(v);
}
function isPaymentStatus(v) {
    return exports.PAYMENT_STATUSES.includes(v);
}
function isUserRole(v) {
    return exports.USER_ROLES.includes(v);
}
async function leadOptions(limit = 300) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("id, name, phone, pipeline_stage, lead_temperature, project_interest")
        .order("last_contact_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
async function activeMembers() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("id, name, role, department")
        .eq("is_active", true)
        .order("name");
    return (data ?? []);
}
async function projectOptions() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_projects")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
    return (data ?? []);
}
/** Only unsold stock is offerable on a new booking. */
async function bookableUnits() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_units")
        .select("id, unit_number, project_id, villa_type_id, price_inr, status")
        .in("status", ["available", "under_booking", "reserved"])
        .order("unit_number")
        .limit(500);
    return (data ?? []).map((r) => {
        const row = r;
        return { ...r, price_inr: toNum(row.price_inr) };
    });
}
async function villaTypeOptions() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_types")
        .select("id, project_id, name, price_inr")
        .eq("is_active", true)
        .order("name");
    return (data ?? []).map((r) => {
        const row = r;
        return { ...r, price_inr: toNum(row.price_inr) };
    });
}
const VISIT_SELECT = "*, villa_leads(id, name, phone, lead_temperature), villa_projects(name), villa_team_members(name)";
async function listSiteVisits(limit = 300) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_site_visits")
        .select(VISIT_SELECT)
        .order("created_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
/** Sort key: an unscheduled request has no slot but still needs attention first. */
function slotOf(v) {
    const iso = v.scheduled_at ?? (v.preferred_date ? `${v.preferred_date}T00:00:00+05:30` : null);
    if (!iso)
        return Number.POSITIVE_INFINITY;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}
function splitVisits(rows) {
    const open = new Set(exports.OPEN_VISIT_STATUSES);
    const upcoming = rows
        .filter((v) => open.has(v.status))
        // Unscheduled requests sort to the bottom of the queue by time but are the
        // ones a coordinator must action, so they lead instead.
        .sort((a, b) => {
        const as = slotOf(a);
        const bs = slotOf(b);
        if (as === bs)
            return 0;
        if (!Number.isFinite(as))
            return -1;
        if (!Number.isFinite(bs))
            return 1;
        return as - bs;
    });
    const closed = rows.filter((v) => !open.has(v.status)).sort((a, b) => slotOf(b) - slotOf(a));
    return { upcoming, closed };
}
function siteVisitStats(rows) {
    const count = (fn) => rows.filter(fn).length;
    const completed = count((v) => v.status === "completed");
    const noShow = count((v) => v.status === "no_show");
    const decided = completed + noShow;
    return {
        total: rows.length,
        requested: count((v) => v.status === "requested"),
        scheduled: count((v) => v.status === "scheduled" || v.status === "confirmed"),
        completed,
        noShow,
        cancelled: count((v) => v.status === "cancelled"),
        completionRate: decided > 0 ? (completed / decided) * 100 : null,
    };
}
async function scheduleSiteVisit(input) {
    if (!input.leadId)
        return { ok: false, error: "Pick the lead this visit is for." };
    const visitType = input.visitType === "virtual" ? "virtual" : "site";
    const scheduledAt = istTimestamp(input.scheduledAtLocal);
    if (input.scheduledAtLocal && !scheduledAt) {
        return { ok: false, error: "Could not read that date and time." };
    }
    if (input.visitorCount !== null && input.visitorCount !== undefined) {
        if (!Number.isFinite(input.visitorCount) || input.visitorCount < 1) {
            return { ok: false, error: "Visitor count must be at least 1." };
        }
    }
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_site_visits")
        .insert({
        lead_id: input.leadId,
        project_id: input.projectId || null,
        assigned_to: input.assignedTo || null,
        scheduled_at: scheduledAt,
        visitor_count: input.visitorCount ?? null,
        visit_type: visitType,
        // A slot that is already agreed is 'scheduled'; without one this is still
        // only a request, and the board should keep nagging until it has a time.
        status: scheduledAt ? "scheduled" : "requested",
        transport_arranged: input.transportArranged ?? false,
        special_requirements: input.specialRequirements || null,
        notes: input.notes || null,
    })
        .select("id")
        .single();
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId: input.leadId,
        type: "site_visit",
        actorName: "Console",
        description: scheduledAt
            ? `${exports.VISIT_TYPE_LABELS[visitType]} scheduled for ${formatDateTimeIst(scheduledAt)}`
            : `${exports.VISIT_TYPE_LABELS[visitType]} logged as requested`,
        metadata: { visit_id: data.id, project_id: input.projectId ?? null },
    });
    return { ok: true, data: { id: data.id } };
}
async function updateSiteVisitStatus(id, status) {
    if (!id)
        return { ok: false, error: "Missing visit." };
    if (!isVisitStatus(status))
        return { ok: false, error: `Unknown visit status: ${status}` };
    const { data: current } = await (0, supabase_1.db)()
        .from("villa_site_visits")
        .select("lead_id, completed_at")
        .eq("id", id)
        .maybeSingle();
    if (!current)
        return { ok: false, error: "That site visit no longer exists." };
    const patch = { status, updated_at: new Date().toISOString() };
    // "Completed" is the claim that the customer actually walked the site, so it
    // carries the timestamp rather than asking anyone to retype it.
    if (status === "completed" && !current.completed_at)
        patch.completed_at = new Date().toISOString();
    const { error } = await (0, supabase_1.db)().from("villa_site_visits").update(patch).eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId: current.lead_id,
        type: "site_visit",
        actorName: "Console",
        description: `Site visit marked ${exports.VISIT_STATUS_LABELS[status].toLowerCase()}`,
        metadata: { visit_id: id, status },
    });
    return { ok: true, data: { id } };
}
async function recordVisitOutcome(id, outcome, feedback) {
    if (!id)
        return { ok: false, error: "Missing visit." };
    if (!outcome && !feedback)
        return { ok: false, error: "Write an outcome or some feedback first." };
    const { error } = await (0, supabase_1.db)()
        .from("villa_site_visits")
        .update({
        outcome: outcome ?? null,
        feedback: feedback ?? null,
        updated_at: new Date().toISOString(),
    })
        .eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, data: { id } };
}
const BOOKING_SELECT = "*, villa_projects(name), villa_types(name), villa_units(unit_number), villa_team_members(name)";
function normalizeBooking(row) {
    return {
        ...row,
        value_inr: toInt(row.value_inr),
        token_amount_inr: toInt(row.token_amount_inr),
        amount_paid_inr: toInt(row.amount_paid_inr),
    };
}
/** `since` is an inclusive YYYY-MM-DD floor on booking_date; null means all time. */
async function listBookings(limit = 200, since) {
    const query = (0, supabase_1.db)()
        .from("villa_bookings")
        .select(BOOKING_SELECT)
        .order("booking_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
    const { data } = await (since ? query.gte("booking_date", since) : query);
    return (data ?? []).map((r) => normalizeBooking(r));
}
/** How many non-cancelled bookings exist in total, so a filtered list can say what it hides. */
async function countBookings() {
    const { count } = await (0, supabase_1.db)().from("villa_bookings").select("id", { count: "exact", head: true });
    return count ?? 0;
}
async function bookingById(id) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select(BOOKING_SELECT)
        .eq("id", id)
        .maybeSingle();
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
/**
 * A payment is overdue when its date has passed and the money is still out —
 * derived on read rather than written into the row, so nothing goes stale
 * between the due date and the next time someone opens the page.
 */
function isOverdue(p, today = istToday()) {
    if (!p.due_date)
        return false;
    if (p.status === "paid" || p.status === "refunded")
        return false;
    return p.due_date < today;
}
function milestoneTotals(payments, today = istToday()) {
    let paidInr = 0;
    let overdueInr = 0;
    for (const p of payments) {
        if (p.status === "paid")
            paidInr += p.amount_inr;
        else if (isOverdue(p, today))
            overdueInr += p.amount_inr;
    }
    return { paidInr, overdueInr, count: payments.length };
}
/** Milestone totals for a set of bookings, in one round-trip. */
async function milestoneTotalsFor(bookingIds) {
    const totals = new Map();
    if (bookingIds.length === 0)
        return totals;
    const { data } = await (0, supabase_1.db)()
        .from("villa_payments")
        .select("booking_id, amount_inr, status, due_date")
        .in("booking_id", bookingIds);
    const today = istToday();
    for (const r of data ?? []) {
        const row = r;
        const id = String(row.booking_id);
        const entry = totals.get(id) ?? { paidInr: 0, overdueInr: 0, count: 0 };
        const amount = toInt(row.amount_inr);
        const status = String(row.status);
        entry.count += 1;
        if (status === "paid")
            entry.paidInr += amount;
        else if (isOverdue({ due_date: row.due_date ?? null, status }, today)) {
            entry.overdueInr += amount;
        }
        totals.set(id, entry);
    }
    return totals;
}
/**
 * What has actually been collected against a booking.
 *
 * Milestones are the record of truth the moment any exist. A booking migrated
 * in without a payment schedule still carries its collected total on the row,
 * and dropping that to zero would understate real revenue — so the row is the
 * fallback, never an override.
 */
function collectedFor(booking, totals) {
    return totals && totals.count > 0 ? totals.paidInr : booking.amount_paid_inr;
}
/**
 * Payment state is a function of the milestone schedule, so it is computed on
 * every render rather than read from villa_bookings.payment_status — a stored
 * value that drifted would otherwise quietly lie about money.
 */
function derivePaymentStatus(valueInr, paidInr, overdueInr = 0) {
    if (valueInr > 0 && paidInr >= valueInr)
        return "paid";
    if (overdueInr > 0)
        return "overdue";
    if (paidInr > 0)
        return "partial";
    return "pending";
}
async function nextSequenceFor(year) {
    const { count } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select("id", { count: "exact", head: true })
        .like("booking_number", `GS-${year}-%`);
    return (count ?? 0) + 1;
}
/**
 * Creates a booking and closes the loop on the lead.
 *
 * Two things happen beyond the insert: the lead moves to 'booked', and the
 * lead's source/campaign are copied onto the booking so revenue attribution
 * survives any later edit to the lead record.
 */
async function createBooking(input) {
    if (!input.leadId)
        return { ok: false, error: "Pick a lead to book." };
    if (!Number.isFinite(input.valueInr) || input.valueInr < 0) {
        return { ok: false, error: "Booking value must be a whole number of rupees." };
    }
    const token = input.tokenAmountInr ?? 0;
    if (!Number.isFinite(token) || token < 0) {
        return { ok: false, error: "Token amount must be a whole number of rupees." };
    }
    if (token > input.valueInr) {
        return { ok: false, error: "Token amount cannot exceed the booking value." };
    }
    const { data: lead, error: leadError } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("id, name, phone, email, contact_id, source, campaign")
        .eq("id", input.leadId)
        .maybeSingle();
    if (leadError)
        return { ok: false, error: leadError.message };
    if (!lead)
        return { ok: false, error: "That lead no longer exists." };
    const name = input.customerName?.trim() || lead.name;
    const bookingDate = istToday();
    const payload = {
        lead_id: lead.id,
        contact_id: lead.contact_id ?? null,
        project_id: input.projectId || null,
        villa_type_id: input.villaTypeId || null,
        unit_id: input.unitId || null,
        // customer_name is NOT NULL and the phone is the only identity an unnamed
        // lead has actually given us — inventing a placeholder would be worse.
        customer_name: name || `+${lead.phone}`,
        customer_phone: lead.phone,
        customer_email: lead.email ?? null,
        value_inr: Math.trunc(input.valueInr),
        token_amount_inr: Math.trunc(token),
        booking_date: bookingDate,
        assigned_to: input.assignedTo || null,
        source: lead.source ?? null,
        campaign: lead.campaign ?? null,
        notes: input.notes || null,
    };
    const year = Number(bookingDate.slice(0, 4));
    let sequence = await nextSequenceFor(year);
    let created = null;
    let lastError = "Could not allocate a booking number.";
    // booking_number is unique and a count-derived sequence can collide — two reps
    // booking at once, or an old booking having been deleted. Retry on the unique
    // violation rather than handing the user an opaque 23505.
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const bookingNumber = `GS-${year}-${String(sequence).padStart(4, "0")}`;
        const { data, error } = await (0, supabase_1.db)()
            .from("villa_bookings")
            .insert({ ...payload, booking_number: bookingNumber })
            .select(BOOKING_SELECT)
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
    await (0, activities_1.logActivity)({
        leadId: lead.id,
        type: "booking",
        actorName: "Console",
        description: `Booking ${created.booking_number} created`,
        metadata: { booking_id: created.id, value_inr: created.value_inr },
    });
    return { ok: true, data: created };
}
async function updateBookingStatus(id, status) {
    if (!id)
        return { ok: false, error: "Missing booking." };
    if (!isBookingStatus(status))
        return { ok: false, error: `Unknown booking status: ${status}` };
    const { data: current } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select("lead_id, booking_number, agreement_date, registration_date")
        .eq("id", id)
        .maybeSingle();
    if (!current)
        return { ok: false, error: "Booking not found." };
    const patch = { status };
    // The milestone dates are what the transition *means*, so stamp them here
    // instead of asking the rep to retype today's date alongside the status.
    if (status === "signed" && !current.agreement_date)
        patch.agreement_date = istToday();
    if (status === "registered" && !current.registration_date)
        patch.registration_date = istToday();
    const { error } = await (0, supabase_1.db)().from("villa_bookings").update(patch).eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId: current.lead_id ?? null,
        type: "booking",
        actorName: "Console",
        description: `Booking ${current.booking_number} → ${exports.BOOKING_STATUS_LABELS[status]}`,
        metadata: { booking_id: id, status },
    });
    return { ok: true, data: { id } };
}
/**
 * Rewrites amount_paid_inr from the paid milestones.
 *
 * The pages derive collection from villa_payments directly, but
 * villa_revenue_monthly sums this column — so it is kept in step after every
 * milestone write rather than left to drift.
 */
async function resyncCollected(bookingId) {
    const payments = await listPayments(bookingId);
    const totals = milestoneTotals(payments);
    const { data: booking } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select("value_inr")
        .eq("id", bookingId)
        .maybeSingle();
    await (0, supabase_1.db)()
        .from("villa_bookings")
        .update({
        amount_paid_inr: totals.paidInr,
        payment_status: derivePaymentStatus(toInt(booking?.value_inr), totals.paidInr, totals.overdueInr),
    })
        .eq("id", bookingId);
}
async function addPayment(input) {
    if (!input.bookingId)
        return { ok: false, error: "Missing booking." };
    if (!input.milestone?.trim())
        return { ok: false, error: "Give the milestone a name." };
    if (!Number.isFinite(input.amountInr) || input.amountInr <= 0) {
        return { ok: false, error: "Milestone amount must be a whole number of rupees above zero." };
    }
    const status = input.status && isPaymentStatus(input.status) ? input.status : "pending";
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_payments")
        .insert({
        booking_id: input.bookingId,
        milestone: input.milestone.trim(),
        amount_inr: Math.trunc(input.amountInr),
        due_date: input.dueDate || null,
        paid_date: status === "paid" ? istToday() : null,
        status,
    })
        .select("id")
        .single();
    if (error)
        return { ok: false, error: error.message };
    await resyncCollected(input.bookingId);
    return { ok: true, data: { id: data.id } };
}
async function setPaymentStatus(paymentId, status) {
    if (!paymentId)
        return { ok: false, error: "Missing milestone." };
    if (!isPaymentStatus(status))
        return { ok: false, error: `Unknown payment status: ${status}` };
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_payments")
        .update({ status, paid_date: status === "paid" ? istToday() : null })
        .eq("id", paymentId)
        .select("booking_id")
        .single();
    if (error)
        return { ok: false, error: error.message };
    await resyncCollected(data.booking_id);
    return { ok: true, data: { id: paymentId } };
}
async function revenueMonthly() {
    const { data } = await (0, supabase_1.db)().from("villa_revenue_monthly").select("*");
    return (data ?? [])
        .map((r) => {
        const row = r;
        return {
            month: String(row.month),
            bookings: toInt(row.bookings),
            booked_value_inr: toInt(row.booked_value_inr),
            collected_inr: toInt(row.collected_inr),
        };
    })
        // The view returns newest first; a trend line reads left-to-right in time.
        .sort((a, b) => a.month.localeCompare(b.month));
}
/**
 * Totalled from villa_revenue_monthly rather than villa_bookings directly, so
 * the KPI row and the trend chart can never contradict each other. The view
 * already excludes cancelled bookings.
 */
function summariseRevenue(months) {
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
        averageBookingValueInr: bookingCount > 0 ? Math.round(bookedValueInr / bookingCount) : null,
        collectionRate: bookedValueInr > 0 ? (collectedInr / bookedValueInr) * 100 : null,
    };
}
/**
 * Revenue split by the attribution copied onto the booking at creation time —
 * not by the lead's current source, which a later edit could rewrite.
 */
async function revenueAttribution(since) {
    const query = (0, supabase_1.db)()
        .from("villa_bookings")
        .select("source, campaign, value_inr, amount_paid_inr")
        .neq("status", "cancelled");
    const { data } = await (since ? query.gte("booking_date", since) : query);
    const sources = new Map();
    const campaigns = new Map();
    const add = (map, label, booked, collected) => {
        const entry = map.get(label) ?? { label, bookings: 0, bookedInr: 0, collectedInr: 0 };
        entry.bookings += 1;
        entry.bookedInr += booked;
        entry.collectedInr += collected;
        map.set(label, entry);
    };
    for (const r of data ?? []) {
        const row = r;
        const booked = toInt(row.value_inr);
        const collected = toInt(row.amount_paid_inr);
        add(sources, row.source || "Unattributed", booked, collected);
        // A booking with no campaign is not a campaign called "none" — it is
        // simply outside paid media, and lumping it in would flatter every campaign.
        if (row.campaign)
            add(campaigns, String(row.campaign), booked, collected);
    }
    const byValue = (a, b) => b.bookedInr - a.bookedInr;
    return {
        bySource: [...sources.values()].sort(byValue),
        byCampaign: [...campaigns.values()].sort(byValue),
    };
}
exports.AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"];
function bucketFor(days) {
    if (days <= 30)
        return "0-30";
    if (days <= 60)
        return "31-60";
    if (days <= 90)
        return "61-90";
    return "90+";
}
/** Unpaid milestones whose due date has passed, aged into 30-day bands. */
async function receivablesAging() {
    const today = istToday();
    const { data } = await (0, supabase_1.db)()
        .from("villa_payments")
        .select("id, booking_id, milestone, amount_inr, due_date, status, villa_bookings(booking_number, customer_name, status)")
        .lt("due_date", today)
        .not("status", "in", "(paid,refunded)")
        .order("due_date", { ascending: true })
        .limit(500);
    const buckets = Object.fromEntries(exports.AGING_BUCKETS.map((b) => [b, { count: 0, amountInr: 0 }]));
    const rows = [];
    let totalInr = 0;
    for (const r of data ?? []) {
        const row = r;
        const booking = row.villa_bookings;
        // A cancelled booking's schedule is not money anyone is still owed.
        if (!booking || booking.status === "cancelled")
            continue;
        const dueDate = String(row.due_date);
        const daysOverdue = daysBetween(dueDate, today);
        const amountInr = toInt(row.amount_inr);
        const bucket = bucketFor(daysOverdue);
        rows.push({
            id: String(row.id),
            bookingId: String(row.booking_id),
            bookingNumber: booking.booking_number,
            customerName: booking.customer_name,
            milestone: String(row.milestone),
            amountInr,
            dueDate,
            daysOverdue,
            bucket,
        });
        buckets[bucket].count += 1;
        buckets[bucket].amountInr += amountInr;
        totalInr += amountInr;
    }
    return { rows, buckets, totalInr };
}
/** Reads villa_team_performance — every number there is an aggregate of real rows. */
async function teamLeaderboard() {
    const { data } = await (0, supabase_1.db)().from("villa_team_performance").select("*");
    return (data ?? [])
        .map((r) => {
        const row = r;
        return {
            id: String(row.id),
            name: String(row.name ?? ""),
            role: row.role,
            department: String(row.department ?? ""),
            quota_inr: toNum(row.quota_inr),
            assigned_leads: toInt(row.assigned_leads),
            hot_leads: toInt(row.hot_leads),
            site_visits: toInt(row.site_visits),
            bookings: toInt(row.bookings),
            revenue_inr: toInt(row.revenue_inr),
            conversion_rate: toNum(row.conversion_rate),
            quota_attainment: toNum(row.quota_attainment),
        };
    })
        .sort((a, b) => b.revenue_inr - a.revenue_inr || a.name.localeCompare(b.name));
}
async function listTeamMembers() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("id, name, email, phone, role, department, is_active, accepts_leads, quota_inr, languages, joined_at")
        .order("is_active", { ascending: false })
        .order("name");
    return (data ?? []).map((r) => {
        const row = r;
        return { ...r, quota_inr: toNum(row.quota_inr) };
    });
}
async function createTeamMember(input) {
    const name = input.name?.trim();
    if (!name)
        return { ok: false, error: "Name is required." };
    const role = input.role?.trim() || "property_consultant";
    if (!isUserRole(role))
        return { ok: false, error: `Unknown role: ${role}` };
    if (input.quotaInr !== null && input.quotaInr !== undefined) {
        if (!Number.isFinite(input.quotaInr) || input.quotaInr < 0) {
            return { ok: false, error: "Quota must be a whole number of rupees." };
        }
    }
    const department = input.department?.trim() || (role.startsWith("marketing") ? "marketing" : "sales");
    const languages = (input.languages ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .insert({
        name,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        role,
        department,
        quota_inr: input.quotaInr ?? null,
        languages: languages.length > 0 ? languages : null,
        accepts_leads: input.acceptsLeads ?? true,
    })
        .select("id")
        .single();
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, data: { id: String(data.id) } };
}
/** Flips is_active. An inactive member drops out of lead routing automatically. */
async function toggleMemberActive(id) {
    if (!id)
        return { ok: false, error: "Missing team member." };
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("is_active")
        .eq("id", id)
        .maybeSingle();
    if (error)
        return { ok: false, error: error.message };
    if (!data)
        return { ok: false, error: "Team member not found." };
    const { error: updateError } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .update({ is_active: !data.is_active })
        .eq("id", id);
    if (updateError)
        return { ok: false, error: updateError.message };
    return { ok: true, data: { id } };
}
