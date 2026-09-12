"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDrafts = listDrafts;
exports.publishChannels = publishChannels;
exports.publishLog = publishLog;
exports.queuePublish = queuePublish;
exports.markPosted = markPosted;
exports.setDraftStatus = setDraftStatus;
exports.cancelQueued = cancelQueued;
exports.studioData = studioData;
exports.queueByDraft = queueByDraft;
exports.overviewMetrics = overviewMetrics;
exports.platformSplit = platformSplit;
exports.campaignLeadFlow = campaignLeadFlow;
exports.marketingOverview = marketingOverview;
exports.whatsappMetrics = whatsappMetrics;
exports.whatsappMessageFlow = whatsappMessageFlow;
exports.whatsappChannel = whatsappChannel;
const campaigns_1 = require("../campaigns");
const queries_1 = require("../queries");
const supabase_1 = require("../supabase");
const formats_1 = require("./formats");
const DRAFT_COLUMNS = "id, project_id, villa_type_id, format, tone, language, headline, primary_text, secondary_text, " +
    "hashtags, call_to_action, cta_button_text, suggested_audio, video_script, visual_prompt, " +
    "target_audience_advice, target_platforms, generated_by_ai, status, created_at";
async function listDrafts(limit = 40, format) {
    let query = (0, supabase_1.db)().from("villa_content_drafts").select(DRAFT_COLUMNS);
    if (format)
        query = query.eq("format", format);
    const { data } = await query.order("created_at", { ascending: false }).limit(limit);
    return (data ?? []);
}
async function publishChannels() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_channel_settings")
        .select("channel, label, enabled, credential_status, notes")
        .order("label", { ascending: true });
    return (data ?? []);
}
async function publishLog(limit = 200) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_publish_log")
        .select("id, draft_id, channel, status, external_url, published_at, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
async function queuePublish(draftId, channels) {
    if (!draftId)
        return { ok: false, error: "Pick a draft first" };
    const wanted = [...new Set(channels.map((c) => c.trim()).filter(Boolean))];
    if (wanted.length === 0)
        return { ok: false, error: "Pick at least one channel" };
    const supabase = (0, supabase_1.db)();
    const [{ data: draft }, { data: settings }, { data: existing }] = await Promise.all([
        supabase.from("villa_content_drafts").select("id, status").eq("id", draftId).maybeSingle(),
        supabase.from("villa_channel_settings").select("channel, enabled"),
        supabase
            .from("villa_publish_log")
            .select("channel")
            .eq("draft_id", draftId)
            .eq("status", "pending_manual"),
    ]);
    if (!draft)
        return { ok: false, error: "That draft no longer exists" };
    // Re-checked server-side: the checkboxes are rendered from the same table,
    // but a disabled channel must not become postable by editing the form.
    const enabled = new Set((settings ?? [])
        .filter((s) => s.enabled)
        .map((s) => s.channel));
    const rejected = wanted.filter((c) => !enabled.has(c));
    if (rejected.length > 0) {
        return { ok: false, error: `Not enabled for publishing: ${rejected.join(", ")}` };
    }
    const alreadyQueued = new Set((existing ?? []).map((r) => r.channel));
    const fresh = wanted.filter((c) => !alreadyQueued.has(c));
    if (fresh.length === 0) {
        return { ok: false, error: "Already queued on every channel you picked" };
    }
    const { data: inserted, error } = await supabase
        .from("villa_publish_log")
        .insert(fresh.map((channel) => ({ draft_id: draftId, channel, status: "pending_manual" })))
        .select("id, draft_id, channel, status, external_url, published_at, created_at");
    if (error)
        return { ok: false, error: error.message };
    // A queued draft is committed to, so it should stop reading as a rough draft.
    // 'scheduled' is the closest honest word the enum has: somebody intends to
    // post it, and nobody has yet.
    if (draft.status === "draft" || draft.status === "ready") {
        await supabase.from("villa_content_drafts").update({ status: "scheduled" }).eq("id", draftId);
    }
    return { ok: true, entries: (inserted ?? []) };
}
/** Same-origin-agnostic, but still has to be a real web link before it is stored. */
function normaliseExternalUrl(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return { error: "The post URL must start with http:// or https://" };
        }
        return url.href;
    }
    catch {
        return { error: "That post URL isn't a valid link" };
    }
}
/**
 * A human confirming they posted it themselves.
 *
 * This is the only path by which a draft reaches 'published', and it requires
 * somebody to assert it — the app never infers it.
 */
async function markPosted(entryId, externalUrl) {
    if (!entryId)
        return { ok: false, error: "Pick a queued post first" };
    const url = normaliseExternalUrl(externalUrl);
    if (url !== null && typeof url === "object")
        return { ok: false, error: url.error };
    const supabase = (0, supabase_1.db)();
    const { data: entry } = await supabase
        .from("villa_publish_log")
        .select("id, draft_id")
        .eq("id", entryId)
        .maybeSingle();
    if (!entry)
        return { ok: false, error: "That queue entry no longer exists" };
    const { error } = await supabase
        .from("villa_publish_log")
        .update({
        status: "posted_manually",
        external_url: url,
        published_at: new Date().toISOString(),
    })
        .eq("id", entryId);
    if (error)
        return { ok: false, error: error.message };
    const draftId = entry.draft_id;
    if (draftId) {
        const { count } = await supabase
            .from("villa_publish_log")
            .select("id", { count: "exact", head: true })
            .eq("draft_id", draftId)
            .eq("status", "pending_manual");
        // Only once nothing is still waiting — a draft posted to Instagram but not
        // yet to Facebook is not published.
        if ((count ?? 0) === 0) {
            await supabase.from("villa_content_drafts").update({ status: "published" }).eq("id", draftId);
        }
    }
    return { ok: true, id: entryId };
}
/**
 * Hand-editing of a draft's status.
 *
 * Restricted to EDITABLE_STATUSES: 'scheduled' is owned by `queuePublish` and
 * 'published' by `markPosted`, so letting a <select> write either would let the
 * library contradict the publish log sitting next to it.
 */
async function setDraftStatus(draftId, status) {
    if (!draftId)
        return { ok: false, error: "Pick a draft first" };
    if (!formats_1.EDITABLE_STATUSES.includes(status)) {
        return { ok: false, error: `Status "${status}" is set by the publish queue, not by hand` };
    }
    const { error } = await (0, supabase_1.db)()
        .from("villa_content_drafts")
        .update({ status })
        .eq("id", draftId);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id: draftId };
}
async function cancelQueued(entryId) {
    if (!entryId)
        return { ok: false, error: "Pick a queued post first" };
    const { error } = await (0, supabase_1.db)()
        .from("villa_publish_log")
        .update({ status: "cancelled" })
        .eq("id", entryId)
        .eq("status", "pending_manual");
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id: entryId };
}
/**
 * Everything /marketing/studio renders, in one parallel round-trip.
 *
 * The queue is fetched whole rather than per-draft: the library shows a
 * "queued on N channels" state for every card, and issuing one query per card
 * would turn a 30-draft page into 31 round-trips.
 */
async function studioData() {
    const [{ projects, villaTypes }, drafts, channels, queue] = await Promise.all([
        (0, queries_1.projectsWithTypes)(),
        listDrafts(30),
        publishChannels(),
        publishLog(120),
    ]);
    const queueHeadlines = new Map(drafts.map((d) => [d.id, d.headline]));
    const unknown = [...new Set(queue.map((q) => q.draft_id))].filter((id) => id && !queueHeadlines.has(id));
    // Second round-trip only when the queue actually reaches past the library
    // window, which is the uncommon case.
    if (unknown.length > 0) {
        const { data } = await (0, supabase_1.db)()
            .from("villa_content_drafts")
            .select("id, headline")
            .in("id", unknown);
        for (const row of (data ?? [])) {
            queueHeadlines.set(row.id, row.headline);
        }
    }
    return { projects, villaTypes, drafts, channels, queue, queueHeadlines };
}
/** Queue entries grouped by the draft they belong to, newest first within each. */
function queueByDraft(queue) {
    const byDraft = new Map();
    for (const entry of queue) {
        const list = byDraft.get(entry.draft_id);
        if (list)
            list.push(entry);
        else
            byDraft.set(entry.draft_id, [entry]);
    }
    return byDraft;
}
// -----------------------------------------------------------------------------
// Time bucketing
// -----------------------------------------------------------------------------
const DAY_MS = 86_400_000;
/** Beyond this a daily axis is unreadable, so buckets widen instead of multiplying. */
const MAX_BUCKETS = 60;
function planBuckets(days, earliestMs) {
    const now = Date.now();
    const rawStart = days !== null ? now - (days - 1) * DAY_MS : (earliestMs ?? now);
    const start = new Date(rawStart);
    start.setHours(0, 0, 0, 0);
    const spanDays = Math.max(1, Math.round((now - start.getTime()) / DAY_MS) + 1);
    const stepDays = Math.max(1, Math.ceil(spanDays / MAX_BUCKETS));
    const step = stepDays * DAY_MS;
    const starts = [];
    for (let t = start.getTime(); t <= now; t += step)
        starts.push(t);
    if (starts.length === 0)
        starts.push(start.getTime());
    const granularity = stepDays === 1 ? "daily" : stepDays === 7 ? "weekly" : `${stepDays}-day`;
    return { starts, step, granularity };
}
function bucketLabel(ms) {
    return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function bucketIndex(buckets, iso) {
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms))
        return null;
    const i = Math.floor((ms - buckets.starts[0]) / buckets.step);
    if (i < 0)
        return null;
    return Math.min(i, buckets.starts.length - 1);
}
/**
 * Rolls timestamped rows into a fixed set of buckets.
 *
 * Buckets with no rows stay in the output at zero rather than being dropped: a
 * day with no leads is a fact about the day, and collapsing it would make a
 * quiet week look like a busy one.
 */
function toSeries(rows, at, keys, days, truncated) {
    const earliest = rows.length > 0 ? Math.min(...rows.map((r) => new Date(at(r)).getTime())) : null;
    const buckets = planBuckets(days, Number.isFinite(earliest ?? NaN) ? earliest : null);
    const points = buckets.starts.map((ms) => {
        const point = { label: bucketLabel(ms) };
        for (const k of keys)
            point[k.key] = 0;
        return point;
    });
    for (const row of rows) {
        const i = bucketIndex(buckets, at(row));
        if (i === null)
            continue;
        for (const k of keys) {
            if (k.matches(row))
                points[i][k.key] += 1;
        }
    }
    return { points, granularity: buckets.granularity, truncated };
}
function overviewMetrics(rows) {
    const sum = (pick) => rows.reduce((t, r) => t + pick(r), 0);
    const totalSpendInr = sum((r) => r.spent_inr);
    const totalImpressions = sum((r) => r.impressions);
    const totalClicks = sum((r) => r.clicks);
    const totalLeads = sum((r) => r.leads);
    const totalQualified = sum((r) => r.qualified_leads);
    const totalBookings = sum((r) => r.bookings);
    const totalRevenueInr = sum((r) => r.revenue_inr);
    return {
        campaigns: rows.length,
        activeCampaigns: rows.filter((r) => r.status === "active").length,
        totalSpendInr,
        totalBudgetInr: sum((r) => r.budget_inr),
        totalImpressions,
        totalClicks,
        totalLeads,
        totalQualified,
        totalBookings,
        totalRevenueInr,
        blendedCtr: (0, campaigns_1.safeRatio)(totalClicks, totalImpressions),
        blendedCplInr: (0, campaigns_1.safeRatio)(totalSpendInr, totalLeads),
        qualifiedCplInr: (0, campaigns_1.safeRatio)(totalSpendInr, totalQualified),
        blendedRoas: (0, campaigns_1.safeRatio)(totalRevenueInr, totalSpendInr),
        qualifyRate: (0, campaigns_1.safeRatio)(totalQualified, totalLeads),
        bookingRate: (0, campaigns_1.safeRatio)(totalBookings, totalLeads),
    };
}
function platformSplit(rows) {
    const totals = new Map();
    for (const row of rows) {
        const bucket = totals.get(row.platform) ?? { spendInr: 0, leads: 0, qualified: 0, revenueInr: 0 };
        bucket.spendInr += row.spent_inr;
        bucket.leads += row.leads;
        bucket.qualified += row.qualified_leads;
        bucket.revenueInr += row.revenue_inr;
        totals.set(row.platform, bucket);
    }
    const allSpend = [...totals.values()].reduce((t, b) => t + b.spendInr, 0);
    const allLeads = [...totals.values()].reduce((t, b) => t + b.leads, 0);
    return [...totals.entries()]
        .map(([platform, b]) => ({
        platform,
        spendInr: b.spendInr,
        leads: b.leads,
        qualified: b.qualified,
        revenueInr: b.revenueInr,
        cplInr: (0, campaigns_1.safeRatio)(b.spendInr, b.leads),
        roas: (0, campaigns_1.safeRatio)(b.revenueInr, b.spendInr),
        spendSharePct: mulPct((0, campaigns_1.safeRatio)(b.spendInr, allSpend)),
        leadSharePct: mulPct((0, campaigns_1.safeRatio)(b.leads, allLeads)),
    }))
        .sort((a, b) => b.spendInr - a.spendInr);
}
function mulPct(ratio) {
    return ratio === null ? null : Number((ratio * 100).toFixed(1));
}
const LEAD_FLOW_CAP = 4000;
/**
 * Campaign-attributed leads over time.
 *
 * Only leads carrying a campaign name, because this chart sits under ad spend —
 * counting walk-ins and referrals here would credit the ads with traffic they
 * did not buy.
 */
async function campaignLeadFlow(sinceIso, days) {
    let query = (0, supabase_1.db)()
        .from("villa_leads")
        .select("created_at, lead_score")
        .not("campaign", "is", null);
    if (sinceIso)
        query = query.gte("created_at", sinceIso);
    const { data } = await query.order("created_at", { ascending: false }).limit(LEAD_FLOW_CAP);
    const rows = (data ?? []);
    return toSeries(rows, (r) => r.created_at, [
        { key: "leads", matches: () => true },
        // 50 is the qualified threshold villa_campaign_performance uses; the two
        // must agree or the chart contradicts the table above it.
        { key: "qualified", matches: (r) => r.lead_score >= 50 },
    ], days, rows.length === LEAD_FLOW_CAP);
}
async function marketingOverview(sinceIso, days) {
    const [rows, leadFlow] = await Promise.all([(0, campaigns_1.campaignPerformance)(), campaignLeadFlow(sinceIso, days)]);
    return {
        rows,
        metrics: overviewMetrics(rows),
        platforms: platformSplit(rows),
        leadFlow,
    };
}
// -----------------------------------------------------------------------------
// WhatsApp channel
// -----------------------------------------------------------------------------
/** Roles the agent writes; everything else on the channel came from the buyer. */
const OUTBOUND_ROLES = ["agent", "human_agent"];
/** Supabase builders are lazy thenables, so these all fire together under Promise.all. */
async function countOf(query) {
    const { count } = await query;
    return count ?? 0;
}
const MESSAGE_TREND_CAP = 5000;
async function whatsappMetrics(sinceIso) {
    const supabase = (0, supabase_1.db)();
    const messages = () => {
        const q = supabase.from("villa_messages").select("id", { count: "exact", head: true }).eq("channel", "whatsapp");
        return sinceIso ? q.gte("created_at", sinceIso) : q;
    };
    const leads = () => {
        const q = supabase.from("villa_leads").select("id", { count: "exact", head: true }).eq("source", "whatsapp");
        return sinceIso ? q.gte("created_at", sinceIso) : q;
    };
    const [aiSent, humanSent, received, mediaMessages, conversations, openConversations, leadCount, qualifiedLeads, optedOut, aiPaused, handoffs, brochureSent, floorPlanSent, priceSheetSent, videoSent,] = await Promise.all([
        countOf(messages().eq("role", "agent")),
        countOf(messages().eq("role", "human_agent")),
        countOf(messages().eq("role", "customer")),
        countOf(messages().not("media_url", "is", null)),
        countOf((() => {
            const q = supabase
                .from("villa_conversations")
                .select("id", { count: "exact", head: true })
                .eq("channel", "whatsapp");
            return sinceIso ? q.gte("started_at", sinceIso) : q;
        })()),
        countOf((() => {
            const q = supabase
                .from("villa_conversations")
                .select("id", { count: "exact", head: true })
                .eq("channel", "whatsapp")
                .eq("status", "open");
            return sinceIso ? q.gte("started_at", sinceIso) : q;
        })()),
        countOf(leads()),
        countOf(leads().gte("lead_score", 50)),
        countOf(leads().eq("opted_out", true)),
        countOf(leads().eq("ai_paused", true)),
        countOf((() => {
            const q = supabase.from("villa_handoffs").select("id", { count: "exact", head: true });
            return sinceIso ? q.gte("created_at", sinceIso) : q;
        })()),
        countOf(leads().eq("brochure_sent", true)),
        countOf(leads().eq("floor_plan_sent", true)),
        countOf(leads().eq("price_sheet_sent", true)),
        countOf(leads().eq("video_sent", true)),
    ]);
    return {
        aiSent,
        humanSent,
        sent: aiSent + humanSent,
        received,
        mediaMessages,
        conversations,
        openConversations,
        leads: leadCount,
        qualifiedLeads,
        optedOut,
        aiPaused,
        handoffs,
        brochureSent,
        floorPlanSent,
        priceSheetSent,
        videoSent,
    };
}
async function whatsappMessageFlow(sinceIso, days) {
    let query = (0, supabase_1.db)()
        .from("villa_messages")
        .select("created_at, role")
        .eq("channel", "whatsapp");
    if (sinceIso)
        query = query.gte("created_at", sinceIso);
    // Newest-first then reversed: hitting the cap should cost the oldest rows,
    // not the ones nearest the right-hand edge of the chart.
    const { data } = await query.order("created_at", { ascending: false }).limit(MESSAGE_TREND_CAP);
    const rows = (data ?? []).slice().reverse();
    return toSeries(rows, (r) => r.created_at, [
        { key: "received", matches: (r) => r.role === "customer" },
        { key: "sent", matches: (r) => OUTBOUND_ROLES.includes(r.role) },
    ], days, rows.length === MESSAGE_TREND_CAP);
}
async function whatsappChannel(sinceIso, days) {
    const [metrics, flow, broadcasts] = await Promise.all([
        whatsappMetrics(sinceIso),
        whatsappMessageFlow(sinceIso, days),
        listDrafts(8, "whatsapp"),
    ]);
    return { metrics, flow, broadcasts };
}
