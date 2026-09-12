"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNASSIGNED = exports.BOOKING_STATUS_LABELS = exports.COMM_CHANNELS = exports.FOLLOWUP_STATUS_TONES = exports.FOLLOWUP_STATUSES = exports.PRIORITY_TONES = exports.PRIORITY_LABELS = exports.TASK_PRIORITIES = exports.TASK_STATUS_LABELS = exports.TASK_STATUSES = exports.TEMPERATURES = exports.STAGE_TONES = exports.STAGE_LABELS = exports.PIPELINE_STAGES = void 0;
exports.isPipelineStage = isPipelineStage;
exports.isTemperature = isTemperature;
exports.isTaskPriority = isTaskPriority;
exports.isCommChannel = isCommChannel;
exports.isTaskOverdue = isTaskOverdue;
exports.isFollowUpOverdue = isFollowUpOverdue;
exports.dueLabel = dueLabel;
exports.formatDateTime = formatDateTime;
exports.daysSince = daysSince;
exports.budgetRange = budgetRange;
exports.statedBudget = statedBudget;
exports.humanise = humanise;
exports.listLeads = listLeads;
exports.leadSources = leadSources;
exports.teamMembers = teamMembers;
exports.leadDetail = leadDetail;
exports.scoreSignals = scoreSignals;
exports.pipelineBoard = pipelineBoard;
exports.contactDirectory = contactDirectory;
exports.customers = customers;
exports.listTasks = listTasks;
exports.listFollowUps = listFollowUps;
exports.leadOptions = leadOptions;
exports.assignRep = assignRep;
exports.setStage = setStage;
exports.setAiPaused = setAiPaused;
exports.setFutureProspect = setFutureProspect;
exports.createTask = createTask;
exports.completeTask = completeTask;
exports.startTask = startTask;
exports.createFollowUp = createFollowUp;
exports.completeFollowUp = completeFollowUp;
const activities_1 = require("./activities");
const supabase_1 = require("./supabase");
/**
 * Reads and writes for the CRM section (leads, pipeline, contacts, customers,
 * tasks, follow-ups).
 *
 * The enum mirrors below are transcribed from supabase/migrations/001_schema.sql
 * rather than imported from src/lib/types.ts: that file predates the schema
 * rewrite and its PipelineStage union is missing three values the database
 * accepts (`contacted`, `site_visit_completed`, `token_paid`). A board built on
 * the narrow union would silently drop every lead sitting in one of them.
 */
// -----------------------------------------------------------------------------
// Enum mirrors
// -----------------------------------------------------------------------------
/** Filter order, which is also the left-to-right order of the Kanban board. */
exports.PIPELINE_STAGES = [
    "new",
    "contacted",
    "qualifying",
    "qualified",
    "site_visit_scheduled",
    "site_visit_completed",
    "negotiation",
    "token_paid",
    "booked",
    "lost",
];
exports.STAGE_LABELS = {
    new: "New",
    contacted: "Contacted",
    qualifying: "Qualifying",
    qualified: "Qualified",
    site_visit_scheduled: "Visit scheduled",
    site_visit_completed: "Visit completed",
    negotiation: "Negotiation",
    token_paid: "Token paid",
    booked: "Booked",
    lost: "Lost",
};
exports.STAGE_TONES = {
    new: "neutral",
    contacted: "neutral",
    qualifying: "info",
    qualified: "info",
    site_visit_scheduled: "warning",
    site_visit_completed: "warning",
    negotiation: "gold",
    token_paid: "gold",
    booked: "success",
    lost: "danger",
};
exports.TEMPERATURES = ["hot", "warm", "cold"];
exports.TASK_STATUSES = ["pending", "in_progress", "completed"];
exports.TASK_STATUS_LABELS = {
    pending: "Pending",
    in_progress: "In progress",
    completed: "Completed",
};
exports.TASK_PRIORITIES = ["low", "medium", "high", "urgent"];
exports.PRIORITY_LABELS = {
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
};
exports.PRIORITY_TONES = {
    low: "neutral",
    medium: "info",
    high: "warning",
    urgent: "danger",
};
exports.FOLLOWUP_STATUSES = ["pending", "completed", "missed", "rescheduled"];
exports.FOLLOWUP_STATUS_TONES = {
    pending: "info",
    completed: "success",
    missed: "danger",
    rescheduled: "warning",
};
exports.COMM_CHANNELS = [
    "whatsapp",
    "instagram",
    "facebook",
    "email",
    "sms",
    "web_form",
    "call",
];
exports.BOOKING_STATUS_LABELS = {
    initiated: "Initiated",
    agreement_sent: "Agreement sent",
    signed: "Signed",
    token_paid: "Token paid",
    registered: "Registered",
    cancelled: "Cancelled",
};
const STAGE_SET = new Set(exports.PIPELINE_STAGES);
const TEMP_SET = new Set(exports.TEMPERATURES);
const PRIORITY_SET = new Set(exports.TASK_PRIORITIES);
const CHANNEL_SET = new Set(exports.COMM_CHANNELS);
function isPipelineStage(value) {
    return value !== undefined && STAGE_SET.has(value);
}
function isTemperature(value) {
    return value !== undefined && TEMP_SET.has(value);
}
function isTaskPriority(value) {
    return value !== undefined && PRIORITY_SET.has(value);
}
function isCommChannel(value) {
    return value !== undefined && CHANNEL_SET.has(value);
}
/** Sentinel the rep filter uses for "nobody owns this lead". */
exports.UNASSIGNED = "unassigned";
const LEAD_ROW_SELECT = `
  id, name, phone, email, city, is_nri, lead_temperature, lead_score, pipeline_stage,
  budget_min_inr, budget_max_inr, purchase_timeline, source, campaign, assigned_to,
  ai_paused, opted_out, is_future_prospect, reconnect_at, last_contact_at, created_at,
  assignee:villa_team_members(id, name, role)
`;
const TASK_SELECT = "id, title, description, lead_id, assigned_to, status, priority, task_type, due_at, completed_at, created_at, lead:villa_leads(id, name, phone), assignee:villa_team_members(id, name, role)";
const FOLLOW_UP_SELECT = "id, lead_id, assigned_to, scheduled_at, completed_at, status, channel, message, template_name, notes, ai_generated, dispatched_at, created_at, lead:villa_leads(id, name, phone), assignee:villa_team_members(id, name, role)";
/**
 * PostgREST returns an embedded one-to-one as an object, but supabase-js types
 * every embed as an array. Casting through `unknown` once here keeps that lie
 * out of every call site.
 */
function rows(data) {
    return (data ?? []);
}
// -----------------------------------------------------------------------------
// Derived helpers — nothing below is stored, all of it is computed at read time
// -----------------------------------------------------------------------------
/** A task is overdue when its due date has passed and it is still open. */
function isTaskOverdue(task, now = Date.now()) {
    if (!task.due_at || task.status === "completed")
        return false;
    return new Date(task.due_at).getTime() < now;
}
function isFollowUpOverdue(followUp, now = Date.now()) {
    if (followUp.status === "completed")
        return false;
    return new Date(followUp.scheduled_at).getTime() < now;
}
/** Relative inside a week, absolute beyond it — "in 47d" tells nobody anything. */
function dueLabel(iso, now = Date.now()) {
    if (!iso)
        return "No due date";
    const target = new Date(iso).getTime();
    if (Number.isNaN(target))
        return "—";
    const diff = target - now;
    const abs = Math.abs(diff);
    if (abs > 7 * 86_400_000)
        return formatDateTime(iso);
    const mins = Math.round(abs / 60_000);
    if (mins < 1)
        return "now";
    const unit = mins < 60
        ? `${mins}m`
        : abs < 86_400_000
            ? `${Math.round(mins / 60)}h`
            : `${Math.round(mins / 1440)}d`;
    return diff < 0 ? `${unit} overdue` : `in ${unit}`;
}
function formatDateTime(iso) {
    if (!iso)
        return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "—";
    return date.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    });
}
function daysSince(iso, now = Date.now()) {
    if (!iso)
        return null;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then))
        return null;
    return Math.max(0, Math.floor((now - then) / 86_400_000));
}
/** Budget range as a single string; "—" when the buyer has stated neither bound. */
function budgetRange(min, max, format) {
    if (min === null || min === undefined)
        return max === null || max === undefined ? "—" : format(max);
    if (max === null || max === undefined)
        return format(min);
    if (min === max)
        return format(min);
    return `${format(min)} – ${format(max)}`;
}
/**
 * The ceiling a lead has actually stated, used to total a pipeline column.
 *
 * Null — not zero — when no budget is on record, so an unknown never dilutes
 * the sum into looking like a cheap deal.
 */
function statedBudget(lead) {
    return lead.budget_max_inr ?? lead.budget_min_inr ?? null;
}
function humanise(value) {
    if (!value)
        return "—";
    return value.replace(/_/g, " ");
}
/**
 * PostgREST's `or=` filter is a comma/parenthesis-delimited mini-language, so a
 * raw search term containing either would change the shape of the filter rather
 * than be matched literally. Strip the delimiters instead of escaping them —
 * none of them are meaningful inside a name or a phone number.
 */
function sanitiseSearch(value) {
    return value.replace(/[,()*\\%]/g, " ").trim().slice(0, 60);
}
async function listLeads(filters = {}, limit = 200) {
    let query = (0, supabase_1.db)().from("villa_leads").select(LEAD_ROW_SELECT);
    if (isTemperature(filters.temperature))
        query = query.eq("lead_temperature", filters.temperature);
    if (isPipelineStage(filters.stage))
        query = query.eq("pipeline_stage", filters.stage);
    if (filters.source)
        query = query.eq("source", filters.source);
    if (filters.rep === exports.UNASSIGNED)
        query = query.is("assigned_to", null);
    else if (filters.rep)
        query = query.eq("assigned_to", filters.rep);
    if (filters.minScore !== undefined && filters.minScore > 0) {
        query = query.gte("lead_score", filters.minScore);
    }
    const q = filters.q ? sanitiseSearch(filters.q) : "";
    if (q)
        query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
    const { data } = await query.order("last_contact_at", { ascending: false }).limit(limit);
    return rows(data);
}
/** Distinct sources, read off the grouped view so this stays one small row set. */
async function leadSources() {
    const { data } = await (0, supabase_1.db)().from("villa_source_summary").select("source");
    const seen = new Set();
    for (const row of rows(data)) {
        if (row.source)
            seen.add(row.source);
    }
    return [...seen].sort();
}
async function teamMembers() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("id, name, role")
        .eq("is_active", true)
        .order("name");
    return rows(data);
}
async function leadDetail(id) {
    // Every query here is keyed by the same lead id, the lead's own row included,
    // so none depends on another and all of them go at once.
    //
    // The lead used to be fetched first and awaited on its own purely so the
    // "no such lead" case could return early. That made the most-opened screen in
    // the workspace pay two serial round-trips to a database ~200ms away — the
    // whole page waited on one row before it would ask for anything else. The
    // early return now happens after the batch; a missing lead wastes seven
    // parallel reads on a 404 path nobody is waiting on, which is a much better
    // trade than doubling the latency of every successful open.
    const [leadRes, messages, activities, tasks, followUps, siteVisits, touchpoints, team] = await Promise.all([
        (0, supabase_1.db)()
            .from("villa_leads")
            .select(`*, assignee:villa_team_members(id, name, role),
         project:villa_projects(id, name),
         villa_type:villa_types(id, name, price_inr)`)
            .eq("id", id)
            .maybeSingle(),
        (0, supabase_1.db)()
            .from("villa_messages")
            .select("id, role, channel, body, media_url, media_kind, created_at")
            .eq("lead_id", id)
            .order("created_at", { ascending: true })
            .limit(300),
        (0, supabase_1.db)()
            .from("villa_activities")
            .select("id, actor, activity_type, description, channel, created_at")
            .eq("lead_id", id)
            .order("created_at", { ascending: false })
            .limit(80),
        (0, supabase_1.db)().from("villa_tasks").select(TASK_SELECT).eq("lead_id", id).order("due_at", {
            ascending: true,
            nullsFirst: false,
        }),
        (0, supabase_1.db)()
            .from("villa_follow_ups")
            .select(FOLLOW_UP_SELECT)
            .eq("lead_id", id)
            .order("scheduled_at", { ascending: true }),
        (0, supabase_1.db)()
            .from("villa_site_visits")
            .select("id, scheduled_at, preferred_date, preferred_time, completed_at, visitor_count, visit_type, status, outcome, feedback, notes, created_at, project:villa_projects(name), assignee:villa_team_members(id, name, role)")
            .eq("lead_id", id)
            .order("created_at", { ascending: false }),
        (0, supabase_1.db)()
            .from("villa_touchpoints")
            .select("id, channel, campaign, detail, occurred_at")
            .eq("lead_id", id)
            .order("occurred_at", { ascending: true })
            .limit(50),
        teamMembers(),
    ]);
    if (!leadRes.data)
        return null;
    const lead = leadRes.data;
    return {
        lead,
        messages: rows(messages.data),
        activities: rows(activities.data),
        tasks: rows(tasks.data),
        followUps: rows(followUps.data),
        siteVisits: rows(siteVisits.data),
        touchpoints: rows(touchpoints.data),
        team,
    };
}
function scoreSignals(lead) {
    return [
        {
            group: "Intent",
            label: "Purchase timeline",
            value: lead.purchase_timeline === "unknown" ? null : humanise(lead.purchase_timeline),
        },
        { group: "Intent", label: "Buyer purpose", value: lead.buyer_purpose ? humanise(lead.buyer_purpose) : null },
        {
            group: "Intent",
            label: "Financing",
            value: lead.financing_preference && lead.financing_preference !== "undecided"
                ? humanise(lead.financing_preference)
                : null,
        },
        { group: "Requirements", label: "Villa type", value: lead.villa_type?.name ?? null },
        { group: "Requirements", label: "Bedrooms", value: lead.bedrooms ? `${lead.bedrooms} BHK` : null },
        {
            group: "Requirements",
            label: "Budget stated",
            value: statedBudget(lead) === null ? null : "Yes",
        },
        { group: "Requirements", label: "Facing", value: lead.facing_preference },
        { group: "Contactability", label: "Name", value: lead.name },
        { group: "Contactability", label: "Email", value: lead.email },
        {
            group: "Contactability",
            label: "Consent",
            value: lead.opted_out ? null : humanise(lead.consent_status),
        },
    ];
}
async function pipelineBoard() {
    // villa_leads has no stage_entered_at column. The activity log is the only
    // record of when a lead moved, and a lead with no stage_changed event has
    // never moved — so it has been where it is since it was created.
    const [leadRes, eventRes] = await Promise.all([
        (0, supabase_1.db)().from("villa_leads").select(LEAD_ROW_SELECT).order("lead_score", { ascending: false }).limit(500),
        (0, supabase_1.db)()
            .from("villa_activities")
            .select("lead_id, created_at")
            .eq("activity_type", "stage_changed")
            .order("created_at", { ascending: false })
            .limit(2000),
    ]);
    const lastMove = new Map();
    for (const event of rows(eventRes.data)) {
        if (event.lead_id && !lastMove.has(event.lead_id))
            lastMove.set(event.lead_id, event.created_at);
    }
    const columns = exports.PIPELINE_STAGES.map((stage) => ({
        stage,
        cards: [],
        valueInr: 0,
        unknownBudget: 0,
    }));
    const byStage = new Map(columns.map((c) => [c.stage, c]));
    for (const lead of rows(leadRes.data)) {
        const column = byStage.get(lead.pipeline_stage);
        // A row carrying a stage this build doesn't know about would otherwise
        // blank the board; drop it rather than crash.
        if (!column)
            continue;
        column.cards.push({ ...lead, stage_since: lastMove.get(lead.id) ?? lead.created_at });
        const budget = statedBudget(lead);
        if (budget === null)
            column.unknownBudget += 1;
        else
            column.valueInr += budget;
    }
    return columns;
}
async function contactDirectory(type) {
    // Linked-lead counts are tallied here rather than with an embedded aggregate
    // because only leads carrying contact_id are genuinely linked — a lead
    // created straight off a webhook may share a phone number without the FK.
    const [contactRes, linkRes] = await Promise.all([
        (0, supabase_1.db)().from("villa_contacts").select("*").order("last_seen_at", { ascending: false }).limit(500),
        (0, supabase_1.db)().from("villa_leads").select("id, contact_id").not("contact_id", "is", null).limit(2000),
    ]);
    const links = new Map();
    for (const link of rows(linkRes.data)) {
        const list = links.get(link.contact_id);
        if (list)
            list.push(link.id);
        else
            links.set(link.contact_id, [link.id]);
    }
    const all = rows(contactRes.data).map((contact) => {
        const leadIds = links.get(contact.id) ?? [];
        return { ...contact, leadCount: leadIds.length, leadId: leadIds.length === 1 ? leadIds[0] : null };
    });
    const counts = new Map();
    for (const contact of all) {
        counts.set(contact.contact_type, (counts.get(contact.contact_type) ?? 0) + 1);
    }
    return {
        contacts: type ? all.filter((c) => c.contact_type === type) : all,
        types: [...counts.entries()]
            .map(([t, count]) => ({ type: t, count }))
            .sort((a, b) => b.count - a.count),
    };
}
/**
 * One row per person, not per booking: a repeat buyer holding two units is one
 * customer, and their outstanding balance is the sum across both. Grouped on
 * phone because that is the identifier villa_bookings always carries.
 */
async function customers() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_bookings")
        .select(`id, booking_number, lead_id, customer_name, customer_phone, customer_email,
       kyc_complete, value_inr, amount_paid_inr, booking_date, status, payment_status,
       unit:villa_units(unit_number), project:villa_projects(name),
       villa_type:villa_types(name), assignee:villa_team_members(name)`)
        .neq("status", "cancelled")
        .order("booking_date", { ascending: false })
        .limit(500);
    const byPhone = new Map();
    for (const booking of rows(data)) {
        let customer = byPhone.get(booking.customer_phone);
        if (!customer) {
            customer = {
                phone: booking.customer_phone,
                name: booking.customer_name,
                email: booking.customer_email,
                leadId: booking.lead_id,
                bookingCount: 0,
                bookingNumbers: [],
                kycPending: 0,
                units: [],
                projects: [],
                villaTypes: [],
                reps: [],
                totalValueInr: 0,
                paidInr: 0,
                outstandingInr: 0,
                // Rows arrive newest-first, so the first booking seen is the latest.
                latestStatus: booking.status,
                paymentStatus: booking.payment_status,
                latestBookingDate: booking.booking_date,
            };
            byPhone.set(booking.customer_phone, customer);
        }
        customer.bookingCount += 1;
        customer.bookingNumbers.push(booking.booking_number);
        if (!booking.kyc_complete)
            customer.kycPending += 1;
        customer.totalValueInr += toInt(booking.value_inr);
        customer.paidInr += toInt(booking.amount_paid_inr);
        customer.email ??= booking.customer_email;
        customer.leadId ??= booking.lead_id;
        pushUnique(customer.units, booking.unit?.unit_number);
        pushUnique(customer.projects, booking.project?.name);
        pushUnique(customer.villaTypes, booking.villa_type?.name);
        pushUnique(customer.reps, booking.assignee?.name);
    }
    for (const customer of byPhone.values()) {
        customer.outstandingInr = customer.totalValueInr - customer.paidInr;
    }
    return [...byPhone.values()].sort((a, b) => b.totalValueInr - a.totalValueInr);
}
function pushUnique(list, value) {
    if (value && !list.includes(value))
        list.push(value);
}
/** PostgREST serialises bigint as a number, but numeric aggregates as strings. */
function toInt(value) {
    const n = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(n) ? Math.round(n) : 0;
}
// -----------------------------------------------------------------------------
// Tasks & follow-ups
// -----------------------------------------------------------------------------
async function listTasks(assignedTo, limit = 300) {
    let query = (0, supabase_1.db)().from("villa_tasks").select(TASK_SELECT);
    if (assignedTo === exports.UNASSIGNED)
        query = query.is("assigned_to", null);
    else if (assignedTo)
        query = query.eq("assigned_to", assignedTo);
    const { data } = await query
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit);
    return rows(data);
}
async function listFollowUps(assignedTo, limit = 300) {
    let query = (0, supabase_1.db)().from("villa_follow_ups").select(FOLLOW_UP_SELECT);
    if (assignedTo === exports.UNASSIGNED)
        query = query.is("assigned_to", null);
    else if (assignedTo)
        query = query.eq("assigned_to", assignedTo);
    const { data } = await query.order("scheduled_at", { ascending: true }).limit(limit);
    return rows(data);
}
/** Leads offered in the "create task / follow-up" pickers. */
async function leadOptions(limit = 200) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("id, name, phone")
        .order("last_contact_at", { ascending: false })
        .limit(limit);
    return rows(data);
}
/** Empty → null, unparseable → the literal "invalid" so callers can 400 it. */
function toIso(value) {
    if (!value)
        return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return "invalid";
    return date.toISOString();
}
async function assignRep(leadId, memberId) {
    if (!leadId)
        return { ok: false, error: "A lead is required" };
    let name = "nobody";
    if (memberId) {
        const { data } = await (0, supabase_1.db)().from("villa_team_members").select("name").eq("id", memberId).maybeSingle();
        if (!data)
            return { ok: false, error: "That team member no longer exists" };
        name = data.name;
    }
    const { error } = await (0, supabase_1.db)().from("villa_leads").update({ assigned_to: memberId }).eq("id", leadId);
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId,
        type: "assigned",
        description: memberId ? `Assigned to ${name}` : "Unassigned",
        actorName: "Console",
    });
    return { ok: true };
}
async function setStage(leadId, stage) {
    if (!leadId)
        return { ok: false, error: "A lead is required" };
    if (!isPipelineStage(stage))
        return { ok: false, error: `Unknown pipeline stage: ${stage}` };
    const { error } = await (0, supabase_1.db)().from("villa_leads").update({ pipeline_stage: stage }).eq("id", leadId);
    if (error)
        return { ok: false, error: error.message };
    // The board reads days-in-stage back out of this row — see `pipelineBoard`.
    await (0, activities_1.logActivity)({
        leadId,
        type: "stage_changed",
        description: `Pipeline stage moved to ${exports.STAGE_LABELS[stage]}`,
        actorName: "Console",
    });
    return { ok: true };
}
async function setAiPaused(leadId, paused) {
    if (!leadId)
        return { ok: false, error: "A lead is required" };
    const { error } = await (0, supabase_1.db)().from("villa_leads").update({ ai_paused: paused }).eq("id", leadId);
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId,
        type: paused ? "ai_paused" : "ai_resumed",
        description: paused
            ? "AI replies paused — this lead is handled by a human"
            : "AI replies resumed",
        actorName: "Console",
    });
    return { ok: true };
}
async function setFutureProspect(leadId, isFuture, reconnectAt) {
    if (!leadId)
        return { ok: false, error: "A lead is required" };
    const iso = toIso(reconnectAt);
    if (iso === "invalid")
        return { ok: false, error: "Reconnect date is not a valid date" };
    if (isFuture && !iso)
        return { ok: false, error: "A future prospect needs a reconnect date" };
    const { error } = await (0, supabase_1.db)()
        .from("villa_leads")
        .update({ is_future_prospect: isFuture, reconnect_at: isFuture ? iso : null })
        .eq("id", leadId);
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId,
        type: "future_prospect",
        description: isFuture
            ? `Parked as a future prospect, reconnect ${formatDateTime(iso)}`
            : "Returned to the active pipeline",
        actorName: "Console",
    });
    return { ok: true };
}
async function createTask(input) {
    const title = input.title?.trim();
    if (!title)
        return { ok: false, error: "A task needs a title" };
    const priority = input.priority?.trim() || "medium";
    if (!isTaskPriority(priority))
        return { ok: false, error: `Unknown priority: ${priority}` };
    const dueAt = toIso(input.dueAt);
    if (dueAt === "invalid")
        return { ok: false, error: "Due date is not a valid date/time" };
    const { error } = await (0, supabase_1.db)()
        .from("villa_tasks")
        .insert({
        title,
        description: input.description?.trim() || null,
        lead_id: input.leadId || null,
        assigned_to: input.assignedTo || null,
        priority,
        task_type: input.taskType?.trim() || "follow_up",
        due_at: dueAt,
    });
    if (error)
        return { ok: false, error: error.message };
    if (input.leadId) {
        await (0, activities_1.logActivity)({
            leadId: input.leadId,
            type: "task_created",
            description: `Task created: ${title}`,
            actorName: "Console",
        });
    }
    return { ok: true };
}
async function completeTask(id) {
    if (!id)
        return { ok: false, error: "A task id is required" };
    const { error } = await (0, supabase_1.db)()
        .from("villa_tasks")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
async function startTask(id) {
    if (!id)
        return { ok: false, error: "A task id is required" };
    const { error } = await (0, supabase_1.db)()
        .from("villa_tasks")
        .update({ status: "in_progress", completed_at: null })
        .eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
async function createFollowUp(input) {
    if (!input.leadId)
        return { ok: false, error: "A follow-up needs a lead" };
    const scheduledAt = toIso(input.scheduledAt);
    if (scheduledAt === "invalid")
        return { ok: false, error: "Scheduled time is not a valid date/time" };
    if (!scheduledAt)
        return { ok: false, error: "A follow-up needs a scheduled time" };
    const channel = input.channel?.trim() || "whatsapp";
    if (!isCommChannel(channel))
        return { ok: false, error: `Unknown channel: ${channel}` };
    const { error } = await (0, supabase_1.db)()
        .from("villa_follow_ups")
        .insert({
        lead_id: input.leadId,
        assigned_to: input.assignedTo || null,
        scheduled_at: scheduledAt,
        channel,
        message: input.message?.trim() || null,
        template_name: input.templateName?.trim() || null,
        notes: input.notes?.trim() || null,
        ai_generated: false,
    });
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId: input.leadId,
        type: "follow_up_scheduled",
        description: `Follow-up scheduled for ${formatDateTime(scheduledAt)} on ${channel}`,
        channel,
        actorName: "Console",
    });
    return { ok: true };
}
async function completeFollowUp(id) {
    if (!id)
        return { ok: false, error: "A follow-up id is required" };
    const { error } = await (0, supabase_1.db)()
        .from("villa_follow_ups")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
