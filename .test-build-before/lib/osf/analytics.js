"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SENTIMENTS = exports.EXPORT_ROW_LIMIT = exports.REPORT_META = exports.REPORT_KINDS = exports.FUNNEL_STAGES = void 0;
exports.rate = rate;
exports.delta = delta;
exports.analyticsWindow = analyticsWindow;
exports.leadTrend = leadTrend;
exports.snapshot = snapshot;
exports.funnelStages = funnelStages;
exports.sourceBreakdown = sourceBreakdown;
exports.collapseToSources = collapseToSources;
exports.multiTouch = multiTouch;
exports.pipelineBreakdown = pipelineBreakdown;
exports.objectionBreakdown = objectionBreakdown;
exports.openQuestions = openQuestions;
exports.salesVelocity = salesVelocity;
exports.recentActivity = recentActivity;
exports.unassignedHotLeads = unassignedHotLeads;
exports.isReportKind = isReportKind;
exports.toCsv = toCsv;
exports.reportPayload = reportPayload;
exports.reportSizes = reportSizes;
exports.clientRanking = clientRanking;
const crm_1 = require("./crm");
const supabase_1 = require("./supabase");
/**
 * Read-side analytics for the Overview dashboard and the /analytics section.
 *
 * Two rules run through this file.
 *
 * 1. Every metric reuses the definition its reporting view already fixed —
 *    "qualified" is lead_score >= 50, revenue excludes cancelled bookings. A
 *    date-filtered query cannot use those views (none of them carry a date
 *    column), so the definition is repeated against the base table here and
 *    nowhere else, which keeps the two answers reconcilable.
 * 2. A zero denominator means "not knowable yet", never zero. Every rate
 *    returns null in that case so the UI can render an em dash instead of
 *    NaN or Infinity.
 */
// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------
/**
 * PostgREST serialises numeric aggregates (sum, round, avg) as JSON strings,
 * and a string reaching arithmetic downstream surfaces as NaN in the UI rather
 * than failing loudly. Coerce once, at the read boundary.
 */
function num(value) {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}
function numOrNull(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}
/** Null when the denominator is zero — see rule 2 above. */
function rate(numerator, denominator) {
    if (!denominator)
        return null;
    const r = numerator / denominator;
    return Number.isFinite(r) ? r : null;
}
/** Percentage change against a prior period. Null when the prior period is empty. */
function delta(current, previous) {
    if (!previous)
        return null;
    return ((current - previous) / previous) * 100;
}
const DAY_MS = 86_400_000;
/** `villa_daily_leads` buckets on `created_at::date`, which is a UTC day. Match it. */
function utcDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
/**
 * Snaps the window to whole UTC days rather than "now minus N×24h".
 *
 * The daily rollup view can only be bucketed by day, so a timestamp cut-off
 * would make the KPI row and the trend chart above it disagree at the boundary
 * — a lead created this morning counted in one and not the other. Snapping
 * also makes "last 7 days" mean seven whole days including today, which is
 * what the range picker's label promises.
 */
function analyticsWindow(days) {
    if (days === null)
        return { days: null, startDay: null, startIso: null, prevStartDay: null };
    const now = Date.now();
    const startDay = utcDay(now - (days - 1) * DAY_MS);
    return {
        days,
        startDay,
        startIso: `${startDay}T00:00:00.000Z`,
        prevStartDay: utcDay(now - (2 * days - 1) * DAY_MS),
    };
}
/** Applies a lower bound only when the window is bounded. Keeps call sites flat. */
function since(query, column, bound) {
    return bound === null ? query : query.gte(column, bound);
}
const EMPTY_TOTALS = { leads: 0, qualified: 0, hot: 0 };
function addTotals(into, row) {
    into.leads += row.leads;
    into.qualified += row.qualified;
    into.hot += row.hot;
}
function dayLabel(day) {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
    });
}
/**
 * Daily leads/qualified/hot for the window, plus the equivalent totals for the
 * period immediately before it.
 *
 * Both periods come back in one query — asking for twice the window and
 * splitting on `startDay` is cheaper than two round-trips and guarantees the
 * two halves were read from the same snapshot.
 */
async function leadTrend(w) {
    const { data } = await since((0, supabase_1.db)().from("villa_daily_leads").select("day, leads, qualified, hot").order("day", { ascending: true }), "day", w.prevStartDay);
    const rows = (data ?? []).map((r) => {
        const row = r;
        return {
            day: String(row.day),
            leads: num(row.leads),
            qualified: num(row.qualified),
            hot: num(row.hot),
        };
    });
    const current = { ...EMPTY_TOTALS };
    const previous = w.startDay ? { ...EMPTY_TOTALS } : null;
    const byDay = new Map();
    for (const row of rows) {
        if (w.startDay && row.day < w.startDay) {
            if (previous)
                addTotals(previous, row);
            continue;
        }
        addTotals(current, row);
        byDay.set(row.day, row);
    }
    // A day with no leads really did have zero, so the gap is filled rather than
    // interpolated across — an unfilled series would draw a straight line through
    // a quiet week and imply activity that never happened.
    let points;
    if (w.startDay && w.days !== null) {
        const start = Date.parse(`${w.startDay}T00:00:00Z`);
        points = Array.from({ length: w.days }, (_, i) => {
            const day = utcDay(start + i * DAY_MS);
            const row = byDay.get(day);
            return {
                label: dayLabel(day),
                leads: row?.leads ?? 0,
                qualified: row?.qualified ?? 0,
                hot: row?.hot ?? 0,
            };
        });
    }
    else {
        points = [...byDay.values()].map((row) => ({
            label: dayLabel(row.day),
            leads: row.leads,
            qualified: row.qualified,
            hot: row.hot,
        }));
    }
    return { points, current, previous };
}
const EMPTY_SNAPSHOT = {
    conversations: 0,
    leads: 0,
    qualified: 0,
    hot: 0,
    siteVisits: 0,
    siteVisitsCompleted: 0,
    bookings: 0,
    revenueInr: 0,
};
/**
 * Headline counts for the window.
 *
 * All-time reads `villa_funnel`, which already computes every one of these in
 * a single row. A bounded window cannot use it — the view has no date column —
 * so the same definitions are re-issued as counts against the base tables.
 */
async function snapshot(w) {
    if (w.startDay === null) {
        const { data } = await (0, supabase_1.db)().from("villa_funnel").select("*").maybeSingle();
        if (!data)
            return { ...EMPTY_SNAPSHOT };
        const row = data;
        return {
            conversations: num(row.conversations),
            leads: num(row.leads),
            qualified: num(row.qualified_leads),
            hot: num(row.hot_leads),
            siteVisits: num(row.site_visits_requested),
            siteVisitsCompleted: num(row.site_visits_completed),
            bookings: num(row.bookings),
            revenueInr: num(row.revenue_inr),
        };
    }
    const head = { count: "exact", head: true };
    const [conversations, leads, qualified, hot, visits, visitsDone, bookings] = await Promise.all([
        since((0, supabase_1.db)().from("villa_conversations").select("id", head), "started_at", w.startIso),
        since((0, supabase_1.db)().from("villa_leads").select("id", head), "created_at", w.startIso),
        since((0, supabase_1.db)().from("villa_leads").select("id", head).gte("lead_score", 50), "created_at", w.startIso),
        since((0, supabase_1.db)().from("villa_leads").select("id", head).eq("lead_temperature", "hot"), "created_at", w.startIso),
        since((0, supabase_1.db)().from("villa_site_visits").select("id", head), "created_at", w.startIso),
        since((0, supabase_1.db)().from("villa_site_visits").select("id", head).eq("status", "completed"), "created_at", w.startIso),
        // Revenue needs the values themselves: PostgREST cannot sum without an RPC,
        // and bookings are few enough that pulling the column is cheaper than one.
        since((0, supabase_1.db)().from("villa_bookings").select("value_inr").neq("status", "cancelled"), "booking_date", w.startDay),
    ]);
    const bookingRows = (bookings.data ?? []);
    return {
        conversations: conversations.count ?? 0,
        leads: leads.count ?? 0,
        qualified: qualified.count ?? 0,
        hot: hot.count ?? 0,
        siteVisits: visits.count ?? 0,
        siteVisitsCompleted: visitsDone.count ?? 0,
        bookings: bookingRows.length,
        revenueInr: bookingRows.reduce((sum, r) => sum + num(r.value_inr), 0),
    };
}
/** The five stages the overview funnel renders, in order. */
function funnelStages(s) {
    return [
        { label: "Conversations", value: s.conversations },
        { label: "Leads", value: s.leads },
        { label: "Qualified", value: s.qualified },
        { label: "Site visits", value: s.siteVisits },
        { label: "Bookings", value: s.bookings },
    ];
}
/**
 * Leads by source and campaign — the first-touch view of attribution, taken
 * from the `source` column stored on the lead itself.
 */
async function sourceBreakdown(w) {
    if (w.startDay === null) {
        const { data } = await (0, supabase_1.db)().from("villa_source_summary").select("*");
        return (data ?? [])
            .map((r) => {
            const row = r;
            return {
                source: String(row.source ?? "unknown"),
                campaign: row.campaign ?? null,
                leads: num(row.leads),
                qualified: num(row.qualified),
                hot: num(row.hot),
                avgScore: numOrNull(row.avg_score),
            };
        })
            .sort((a, b) => b.leads - a.leads);
    }
    const { data } = await since((0, supabase_1.db)().from("villa_leads").select("source, campaign, lead_temperature, lead_score"), "created_at", w.startIso);
    const groups = new Map();
    for (const r of (data ?? [])) {
        const source = String(r.source ?? "unknown");
        const campaign = r.campaign ?? null;
        // NUL separates the two halves of the key because Postgres text can never
        // contain one, so no pair of real values can collide the way source "a b"
        // + campaign "c" would collide with "a" + "b c" under a space.
        const key = `${source}\u0000${campaign ?? ""}`;
        let g = groups.get(key);
        if (!g) {
            g = { source, campaign, leads: 0, qualified: 0, hot: 0, avgScore: null, scoreTotal: 0 };
            groups.set(key, g);
        }
        const score = num(r.lead_score);
        g.leads += 1;
        g.scoreTotal += score;
        if (score >= 50)
            g.qualified += 1;
        if (r.lead_temperature === "hot")
            g.hot += 1;
    }
    return [...groups.values()]
        .map(({ scoreTotal, ...g }) => ({
        ...g,
        avgScore: g.leads ? Math.round((scoreTotal / g.leads) * 10) / 10 : null,
    }))
        .sort((a, b) => b.leads - a.leads);
}
/** Collapses the campaign dimension — what the overview donut needs. */
function collapseToSources(rows) {
    const totals = new Map();
    for (const r of rows)
        totals.set(r.source, (totals.get(r.source) ?? 0) + r.leads);
    return [...totals.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
}
/**
 * Groups every recorded touch into per-lead journeys and per-channel credit in
 * one pass.
 *
 * First-touch credits the channel that found the buyer, last-touch the one
 * that closed them. Reporting only the first — which is all `villa_leads.source`
 * can tell you — systematically over-credits whichever channel happens to sit
 * at the top of the funnel. The gap between the two columns is the point of
 * this function.
 */
async function multiTouch(w, limit = 4000) {
    const { data } = await since((0, supabase_1.db)()
        .from("villa_touchpoints")
        .select("lead_id, channel, occurred_at, villa_leads(name, phone)")
        .order("occurred_at", { ascending: true })
        .limit(limit), "occurred_at", w.startIso);
    const rows = (data ?? []);
    const byLead = new Map();
    for (const row of rows) {
        const existing = byLead.get(row.lead_id);
        if (existing)
            existing.push(row);
        else
            byLead.set(row.lead_id, [row]);
    }
    const journeys = [];
    for (const [leadId, touches] of byLead) {
        const first = touches[0];
        const last = touches[touches.length - 1];
        const path = [];
        for (const t of touches)
            if (!path.includes(t.channel))
                path.push(t.channel);
        journeys.push({
            leadId,
            name: first.villa_leads?.name ?? null,
            phone: first.villa_leads?.phone ?? null,
            firstChannel: first.channel,
            firstAt: first.occurred_at,
            lastChannel: last.channel,
            lastAt: last.occurred_at,
            touches: touches.length,
            path,
        });
    }
    journeys.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
    const stats = new Map();
    const bump = (channel) => {
        let s = stats.get(channel);
        if (!s) {
            s = { touches: 0, leads: new Set(), first: 0, last: 0 };
            stats.set(channel, s);
        }
        return s;
    };
    for (const row of rows) {
        const s = bump(row.channel);
        s.touches += 1;
        s.leads.add(row.lead_id);
    }
    for (const j of journeys) {
        bump(j.firstChannel).first += 1;
        bump(j.lastChannel).last += 1;
    }
    const channels = [...stats.entries()]
        .map(([channel, s]) => ({
        channel,
        touches: s.touches,
        leads: s.leads.size,
        firstTouches: s.first,
        lastTouches: s.last,
        share: rate(s.touches, rows.length),
        swing: s.last - s.first,
    }))
        .sort((a, b) => b.touches - a.touches);
    return {
        channels,
        journeys,
        totalTouches: rows.length,
        crossChannelLeads: journeys.filter((j) => j.firstChannel !== j.lastChannel).length,
        truncated: rows.length >= limit,
    };
}
// -----------------------------------------------------------------------------
// Pipeline — villa_leads.pipeline_stage
// -----------------------------------------------------------------------------
/**
 * The rungs of the funnel: `villa_pipeline_stage` in enum order, minus `lost`.
 *
 * Order and labels are taken from `crm.ts` rather than restated here, so the
 * funnel names a stage exactly as the pipeline board does — a stage that reads
 * "Visit scheduled" on the Kanban must not read "Site visit scheduled" in the
 * analytics. `lost` is filtered out because it is an exit from the funnel, not
 * a rung on it: an ordered rollup that included it would imply every lost lead
 * had first reached `booked`.
 */
exports.FUNNEL_STAGES = crm_1.PIPELINE_STAGES.filter((s) => s !== "lost");
/**
 * Stage-by-stage drop-off.
 *
 * `pipeline_stage` records where a lead is *now*, not everywhere it has been,
 * so the raw counts are a distribution rather than a funnel — a booked lead is
 * not also counted as qualified. `reached` fixes that by rolling the counts up
 * from the deepest stage, which is sound because the stages are strictly
 * ordered: you cannot be booked without having been qualified.
 *
 * Leads marked `lost` are excluded from the rollup and reported separately.
 * The schema does not record how far a lost lead got before dropping out, so
 * folding them into any stage would be an invention.
 */
async function pipelineBreakdown(w) {
    const { data } = await since((0, supabase_1.db)().from("villa_leads").select("pipeline_stage"), "created_at", w.startIso);
    const counts = new Map();
    for (const r of (data ?? [])) {
        counts.set(r.pipeline_stage, (counts.get(r.pipeline_stage) ?? 0) + 1);
    }
    const rows = [];
    let running = 0;
    // Walk backwards so `running` is the count of everything at or beyond a stage.
    for (let i = exports.FUNNEL_STAGES.length - 1; i >= 0; i--) {
        const stage = exports.FUNNEL_STAGES[i];
        const current = counts.get(stage) ?? 0;
        running += current;
        rows.unshift({
            stage,
            label: crm_1.STAGE_LABELS[stage],
            current,
            reached: running,
            stepRate: null,
        });
    }
    for (let i = 1; i < rows.length; i++) {
        rows[i].stepRate = rate(rows[i].reached, rows[i - 1].reached);
    }
    // The worst step is only meaningful once leads have actually flowed past it.
    const withRate = rows.filter((r) => r.stepRate !== null && r.reached > 0);
    const biggestDrop = withRate.length
        ? withRate.reduce((worst, r) => (r.stepRate < worst.stepRate ? r : worst))
        : null;
    return {
        rows,
        lost: counts.get("lost") ?? 0,
        total: [...counts.values()].reduce((a, b) => a + b, 0),
        biggestDrop,
    };
}
async function objectionBreakdown(w) {
    if (w.startDay === null) {
        const { data } = await (0, supabase_1.db)().from("villa_objection_summary").select("*");
        return (data ?? [])
            .map((r) => {
            const row = r;
            return {
                category: String(row.category),
                total: num(row.total),
                pct: numOrNull(row.pct),
            };
        })
            .sort((a, b) => b.total - a.total);
    }
    const { data } = await since((0, supabase_1.db)().from("villa_objections").select("category"), "created_at", w.startIso);
    const rows = (data ?? []);
    const counts = new Map();
    for (const r of rows)
        counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts.entries()]
        .map(([category, total]) => {
        const share = rate(total * 100, rows.length);
        return { category, total, pct: share === null ? null : Math.round(share * 10) / 10 };
    })
        .sort((a, b) => b.total - a.total);
}
async function openQuestions(w, limit = 60) {
    const { data } = await since((0, supabase_1.db)()
        .from("villa_questions")
        .select("id, topic, verbatim, created_at, lead_id")
        .eq("unanswered", true)
        .order("created_at", { ascending: false })
        .limit(limit), "created_at", w.startIso);
    return (data ?? []);
}
const VELOCITY_BUCKETS = [
    { label: "0–7 days", max: 7 },
    { label: "8–14 days", max: 14 },
    { label: "15–30 days", max: 30 },
    { label: "31–60 days", max: 60 },
    { label: "61–90 days", max: 90 },
    { label: "90+ days", max: Number.POSITIVE_INFINITY },
];
function average(values) {
    if (values.length === 0)
        return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
}
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function groupVelocity(rows, pick) {
    const groups = new Map();
    for (const r of rows) {
        const key = pick(r);
        if (!key)
            continue;
        let g = groups.get(key);
        if (!g) {
            g = { days: [], revenue: 0 };
            groups.set(key, g);
        }
        g.days.push(r.daysToClose);
        g.revenue += r.valueInr;
    }
    return [...groups.entries()]
        .map(([key, g]) => ({
        key,
        bookings: g.days.length,
        avgDays: average(g.days),
        revenueInr: g.revenue,
    }))
        .sort((a, b) => b.bookings - a.bookings);
}
/**
 * Lead-to-booking velocity.
 *
 * `villa_sales_velocity` carries no date column, so a bounded window is
 * applied by intersecting it with the bookings created inside that window —
 * the same `created_at` the view's own day arithmetic is anchored to.
 */
async function salesVelocity(w, limit = 5000) {
    const [velocity, inWindow] = await Promise.all([
        (0, supabase_1.db)().from("villa_sales_velocity").select("*").limit(limit),
        w.startIso
            ? (0, supabase_1.db)().from("villa_bookings").select("id").gte("created_at", w.startIso)
            : Promise.resolve(null),
    ]);
    const allowed = inWindow
        ? new Set((inWindow.data ?? []).map((b) => b.id))
        : null;
    const rows = [];
    let excluded = 0;
    for (const r of (velocity.data ?? [])) {
        const bookingId = String(r.booking_id);
        if (allowed && !allowed.has(bookingId))
            continue;
        const days = numOrNull(r.days_to_close);
        if (days === null || days < 0) {
            excluded += 1;
            continue;
        }
        rows.push({
            bookingId,
            bookingNumber: String(r.booking_number ?? ""),
            source: r.source ?? null,
            campaign: r.campaign ?? null,
            valueInr: num(r.value_inr),
            daysToClose: days,
        });
    }
    rows.sort((a, b) => a.daysToClose - b.daysToClose);
    const days = rows.map((r) => r.daysToClose);
    const buckets = VELOCITY_BUCKETS.map((b, i) => {
        const min = i === 0 ? 0 : VELOCITY_BUCKETS[i - 1].max + 1;
        return { label: b.label, count: days.filter((d) => d >= min && d <= b.max).length };
    });
    return {
        rows,
        averageDays: average(days),
        medianDays: median(days),
        fastestDays: days.length ? days[0] : null,
        slowestDays: days.length ? days[days.length - 1] : null,
        totalRevenueInr: rows.reduce((sum, r) => sum + r.valueInr, 0),
        buckets,
        bySource: groupVelocity(rows, (r) => r.source),
        byCampaign: groupVelocity(rows, (r) => r.campaign),
        excluded,
    };
}
async function recentActivity(w, limit = 10) {
    const { data } = await since((0, supabase_1.db)()
        .from("villa_activities")
        .select("id, activity_type, description, actor, channel, created_at, villa_leads(id, name, phone)")
        .order("created_at", { ascending: false })
        .limit(limit), "created_at", w.startIso);
    return (data ?? []);
}
/**
 * Hot leads with no owner.
 *
 * Deliberately not range-filtered: this is a work queue, not a metric. A hot
 * lead that has been sitting unassigned since before the selected window is
 * the most urgent row on the page, not the least relevant.
 */
async function unassignedHotLeads(limit = 8) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("id, name, phone, lead_score, budget_max_inr, purchase_timeline, pipeline_stage, last_contact_at")
        .eq("lead_temperature", "hot")
        .is("assigned_to", null)
        .not("pipeline_stage", "in", "(booked,lost)")
        .order("lead_score", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
// -----------------------------------------------------------------------------
// CSV export
// -----------------------------------------------------------------------------
exports.REPORT_KINDS = ["leads", "bookings", "campaigns", "team"];
function isReportKind(value) {
    return exports.REPORT_KINDS.includes(value);
}
exports.REPORT_META = {
    leads: {
        source: "villa_leads",
        label: "Leads",
        description: "Every lead with its qualification, budget band, source, campaign, pipeline stage and owner.",
        ranged: true,
        capped: true,
        columns: 20,
    },
    bookings: {
        source: "villa_bookings",
        label: "Bookings",
        description: "Confirmed and in-progress bookings with unit, value, token, collections and attribution.",
        ranged: true,
        capped: true,
        columns: 19,
    },
    campaigns: {
        source: "villa_campaign_performance",
        label: "Campaign performance",
        description: "Spend, impressions, clicks, CTR, leads, bookings, CPL and ROAS from villa_campaign_performance.",
        ranged: false,
        capped: false,
        columns: 14,
    },
    team: {
        source: "villa_team_performance",
        label: "Team performance",
        description: "Per-rep leads, hot leads, site visits, bookings, revenue, conversion rate and quota attainment.",
        ranged: false,
        capped: false,
        columns: 12,
    },
};
/**
 * Hard cap on the row-bounded exports.
 *
 * A CSV is built in memory and held there until the response is written, so an
 * unbounded export of a large table is an out-of-memory risk on the server
 * rather than a slow download. `reportSizes` reports the true row count against
 * this so the page can warn when an export would be clipped, instead of handing
 * over a truncated file that looks complete.
 */
exports.EXPORT_ROW_LIMIT = 10000;
/**
 * RFC 4180 field escaping, plus a spreadsheet-formula guard.
 *
 * A cell beginning `=`, `+` or `@` is evaluated as a formula by Excel and
 * Sheets, so a lead who enters `=HYPERLINK("http://evil","Click")` as their
 * name gets code running on whoever opens the export. Those get an apostrophe
 * prefix, which both tools strip on display. A leading `-` is guarded only
 * when a digit does not follow — quoting every negative number would corrupt
 * far more rows than it protects.
 */
function csvField(value) {
    if (value === null || value === undefined)
        return "";
    let s = typeof value === "string" ? value : String(value);
    if (/^[=+@\t\r]/.test(s) || /^-(?![0-9.])/.test(s))
        s = `'${s}`;
    if (/[",\r\n]/.test(s) || s !== s.trim())
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}
function toCsv(headers, rows) {
    const lines = [headers.map(csvField).join(",")];
    for (const row of rows)
        lines.push(row.map(csvField).join(","));
    // CRLF per RFC 4180, and a BOM so Excel reads the file as UTF-8 rather than
    // guessing a local codepage and mangling every non-ASCII name.
    return `\uFEFF${lines.join("\r\n")}\r\n`;
}
/** All money columns are plain integer rupees — the unit the database stores. */
async function leadsReport(w) {
    const { data } = await since((0, supabase_1.db)()
        .from("villa_leads")
        .select("id, name, phone, email, city, country, is_nri, source, campaign, pipeline_stage, lead_temperature, lead_score, budget_min_inr, budget_max_inr, purchase_timeline, buyer_purpose, handoff_status, first_contact_at, last_contact_at, created_at, villa_team_members(name)")
        .order("created_at", { ascending: false })
        .limit(exports.EXPORT_ROW_LIMIT), "created_at", w.startIso);
    const rows = (data ?? []);
    return {
        headers: [
            "Lead ID", "Name", "Phone", "Email", "City", "Country", "NRI", "Source", "Campaign",
            "Pipeline stage", "Temperature", "Score", "Budget min (INR)", "Budget max (INR)",
            "Timeline", "Buyer purpose", "Handoff status", "Assigned to",
            "First contact", "Last contact",
        ],
        rows: rows.map((r) => [
            r.id,
            r.name,
            r.phone,
            r.email,
            r.city,
            r.country,
            r.is_nri ? "yes" : "no",
            r.source,
            r.campaign,
            r.pipeline_stage,
            r.lead_temperature,
            num(r.lead_score),
            numOrNull(r.budget_min_inr),
            numOrNull(r.budget_max_inr),
            r.purchase_timeline,
            r.buyer_purpose,
            r.handoff_status,
            r.villa_team_members?.name ?? null,
            r.first_contact_at,
            r.last_contact_at,
        ]),
    };
}
async function bookingsReport(w) {
    const { data } = await since((0, supabase_1.db)()
        .from("villa_bookings")
        .select("booking_number, customer_name, customer_phone, customer_email, kyc_complete, value_inr, token_amount_inr, amount_paid_inr, booking_date, agreement_date, registration_date, status, payment_status, source, campaign, villa_projects(name), villa_types(name), villa_units(unit_number), villa_team_members(name)")
        .order("booking_date", { ascending: false })
        .limit(exports.EXPORT_ROW_LIMIT), "booking_date", w.startDay);
    const rows = (data ?? []);
    return {
        headers: [
            "Booking no.", "Customer", "Phone", "Email", "KYC complete", "Project", "Villa type", "Unit",
            "Value (INR)", "Token (INR)", "Paid (INR)", "Outstanding (INR)",
            "Booking date", "Agreement date", "Registration date",
            "Status", "Payment status", "Source", "Campaign",
        ],
        rows: rows.map((r) => {
            const value = num(r.value_inr);
            const paid = num(r.amount_paid_inr);
            return [
                r.booking_number,
                r.customer_name,
                r.customer_phone,
                r.customer_email,
                r.kyc_complete ? "yes" : "no",
                r.villa_projects?.name ?? null,
                r.villa_types?.name ?? null,
                r.villa_units?.unit_number ?? null,
                value,
                num(r.token_amount_inr),
                paid,
                value - paid,
                r.booking_date,
                r.agreement_date,
                r.registration_date,
                r.status,
                r.payment_status,
                r.source,
                r.campaign,
            ];
        }),
    };
}
async function campaignsReport() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_campaign_performance")
        .select("*")
        .order("spent_inr", { ascending: false });
    return {
        headers: [
            "Campaign", "Platform", "Status", "Budget (INR)", "Spent (INR)", "Impressions", "Clicks",
            "CTR %", "Leads", "Qualified leads", "Bookings", "Revenue (INR)", "CPL (INR)", "ROAS",
        ],
        rows: (data ?? []).map((r) => {
            const row = r;
            return [
                row.name,
                row.platform,
                row.status,
                num(row.budget_inr),
                num(row.spent_inr),
                num(row.impressions),
                num(row.clicks),
                numOrNull(row.ctr),
                num(row.leads),
                num(row.qualified_leads),
                num(row.bookings),
                num(row.revenue_inr),
                numOrNull(row.cpl_inr),
                numOrNull(row.roas),
            ];
        }),
    };
}
async function teamReport() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_team_performance")
        .select("*")
        .order("revenue_inr", { ascending: false });
    return {
        headers: [
            "Name", "Role", "Department", "Quota (INR)", "Assigned leads", "Hot leads", "Site visits",
            "Bookings", "Revenue (INR)", "Conversion %", "Quota attainment %", "Revenue per lead (INR)",
        ],
        rows: (data ?? []).map((r) => {
            const row = r;
            const leads = num(row.assigned_leads);
            const revenue = num(row.revenue_inr);
            const perLead = rate(revenue, leads);
            return [
                row.name,
                row.role,
                row.department,
                numOrNull(row.quota_inr),
                leads,
                num(row.hot_leads),
                num(row.site_visits),
                num(row.bookings),
                revenue,
                numOrNull(row.conversion_rate),
                numOrNull(row.quota_attainment),
                perLead === null ? null : Math.round(perLead),
            ];
        }),
    };
}
async function reportPayload(kind, w) {
    switch (kind) {
        case "leads":
            return leadsReport(w);
        case "bookings":
            return bookingsReport(w);
        case "campaigns":
            return campaignsReport();
        case "team":
            return teamReport();
    }
}
/** Row counts shown next to each download, so nobody exports an empty file blind. */
async function reportSizes(w) {
    const head = { count: "exact", head: true };
    const [leads, bookings, campaigns, team] = await Promise.all([
        since((0, supabase_1.db)().from("villa_leads").select("id", head), "created_at", w.startIso),
        since((0, supabase_1.db)().from("villa_bookings").select("id", head), "booking_date", w.startDay),
        (0, supabase_1.db)().from("villa_campaign_performance").select("id", head),
        (0, supabase_1.db)().from("villa_team_performance").select("id", head),
    ]);
    return {
        leads: leads.count ?? 0,
        bookings: bookings.count ?? 0,
        campaigns: campaigns.count ?? 0,
        team: team.count ?? 0,
    };
}
// -----------------------------------------------------------------------------
// Client ranking
// -----------------------------------------------------------------------------
exports.SENTIMENTS = ["positive", "neutral", "negative"];
/**
 * Every client, ranked by how close they are to buying.
 *
 * The ordering is the lead score the agent maintains — deterministic and
 * rule-based (see agent/scoring.ts), so "why is this one above that one" always
 * has an answer. Ties break on recency of contact: two leads at the same score
 * are not equally interesting if one of them spoke to us this morning.
 *
 * Deliberately NOT range-filtered. This is a work queue — a ranking that hid
 * everyone who went quiet last month would hide exactly the people worth
 * chasing. Closed business (booked / lost) is excluded because it is no longer
 * rankable work, and opted-out contacts are excluded because ranking someone
 * who has asked not to be contacted is an invitation to contact them.
 */
async function clientRanking(limit) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select(`id, name, phone, lead_score, lead_temperature, sentiment, pipeline_stage,
       budget_max_inr, purchase_timeline, source, city, last_contact_at,
       assignee:villa_team_members(id, name)`)
        .eq("opted_out", false)
        .not("pipeline_stage", "in", "(booked,lost)")
        .order("lead_score", { ascending: false })
        .order("last_contact_at", { ascending: false });
    const rows = (data ?? []);
    const totals = { all: rows.length, hot: 0, warm: 0, cold: 0 };
    const sentiment = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
    for (const r of rows) {
        if (r.lead_temperature === "hot")
            totals.hot += 1;
        else if (r.lead_temperature === "warm")
            totals.warm += 1;
        else
            totals.cold += 1;
        if (r.sentiment === "positive")
            sentiment.positive += 1;
        else if (r.sentiment === "negative")
            sentiment.negative += 1;
        else if (r.sentiment === "neutral")
            sentiment.neutral += 1;
        else
            sentiment.unknown += 1;
    }
    // Rank is assigned over the full book before any limit is applied, so the
    // number beside a name means the same thing on the dashboard preview as it
    // does on the full list.
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    return { clients: limit ? ranked.slice(0, limit) : ranked, totals, sentiment };
}
