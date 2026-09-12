"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAMPAIGN_STATUSES = void 0;
exports.isCampaignStatus = isCampaignStatus;
exports.safeRatio = safeRatio;
exports.listCampaigns = listCampaigns;
exports.campaignPerformance = campaignPerformance;
exports.createCampaign = createCampaign;
exports.updateCampaignSpend = updateCampaignSpend;
exports.marketingSummary = marketingSummary;
exports.recordTouchpoint = recordTouchpoint;
exports.multiTouchAttribution = multiTouchAttribution;
const supabase_1 = require("./supabase");
/** Filter order, not enum order — this is what the status <select> renders. */
exports.CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"];
const STATUS_SET = new Set(exports.CAMPAIGN_STATUSES);
function isCampaignStatus(value) {
    return STATUS_SET.has(value);
}
/**
 * A zero denominator means "not knowable yet", never 0. Returning null here is
 * what keeps NaN and Infinity out of every rate shown on the marketing pages.
 */
function safeRatio(numerator, denominator) {
    if (!denominator)
        return null;
    const ratio = numerator / denominator;
    return Number.isFinite(ratio) ? ratio : null;
}
/**
 * PostgREST serialises wide bigint/numeric aggregates as JSON strings, and a
 * string reaching arithmetic downstream shows up as NaN in the UI instead of
 * failing loudly. Coerce once, at the read boundary.
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
function nonNegativeInt(value, label) {
    if (!Number.isFinite(value) || value < 0)
        return `${label} must be zero or a positive number`;
    return Math.round(value);
}
// -----------------------------------------------------------------------------
// Campaigns
// -----------------------------------------------------------------------------
async function listCampaigns() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_campaigns")
        .select("*")
        .order("created_at", { ascending: false });
    return (data ?? []);
}
async function campaignPerformance() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_campaign_performance")
        .select("*")
        .order("spent_inr", { ascending: false });
    return (data ?? []).map((row) => {
        const impressions = num(row.impressions);
        const clicks = num(row.clicks);
        return {
            id: String(row.id),
            name: String(row.name),
            platform: String(row.platform),
            status: String(row.status),
            budget_inr: num(row.budget_inr),
            spent_inr: num(row.spent_inr),
            impressions,
            clicks,
            leads: num(row.leads),
            qualified_leads: num(row.qualified_leads),
            bookings: num(row.bookings),
            revenue_inr: num(row.revenue_inr),
            cpl_inr: numOrNull(row.cpl_inr),
            roas: numOrNull(row.roas),
            ctr: safeRatio(clicks, impressions),
        };
    });
}
async function createCampaign(input) {
    const name = input.name.trim();
    const platform = input.platform.trim();
    if (!name)
        return { ok: false, error: "Campaign name is required" };
    if (!platform)
        return { ok: false, error: "Platform is required" };
    const budget = nonNegativeInt(input.budgetInr ?? 0, "Budget");
    if (typeof budget === "string")
        return { ok: false, error: budget };
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_campaigns")
        .insert({
        name,
        platform,
        status: input.status ?? "draft",
        budget_inr: budget,
        start_date: input.startDate || null,
        end_date: input.endDate || null,
    })
        .select("id")
        .single();
    if (error) {
        // The table is unique on (platform, name); say that plainly rather than
        // leaking a Postgres constraint name to whoever filled in the form.
        if (error.code === "23505") {
            return { ok: false, error: `A campaign named "${name}" already exists on ${platform}` };
        }
        return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
}
/**
 * Only the fields actually supplied are written, so the form can leave
 * impressions or clicks blank to mean "unchanged" instead of zeroing a figure
 * that was already correct.
 */
async function updateCampaignSpend(id, patch) {
    if (!id)
        return { ok: false, error: "Campaign is required" };
    const update = {};
    const fields = [
        ["spentInr", "spent_inr", "Spend"],
        ["impressions", "impressions", "Impressions"],
        ["clicks", "clicks", "Clicks"],
    ];
    for (const [key, column, label] of fields) {
        const value = patch[key];
        if (value === undefined)
            continue;
        const checked = nonNegativeInt(value, label);
        if (typeof checked === "string")
            return { ok: false, error: checked };
        update[column] = checked;
    }
    if (Object.keys(update).length === 0) {
        return { ok: false, error: "Enter at least one of spend, impressions or clicks" };
    }
    const { error } = await (0, supabase_1.db)().from("villa_campaigns").update(update).eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
/**
 * Blended marketing economics.
 *
 * Leads are summed from villa_campaign_performance, which joins leads on
 * campaign name — so this counts campaign-attributed leads only. Organic,
 * referral and walk-in leads are deliberately excluded: dividing ad spend by
 * leads it did not buy would flatter the CPL.
 */
async function marketingSummary() {
    const rows = await campaignPerformance();
    const totalSpendInr = rows.reduce((sum, r) => sum + r.spent_inr, 0);
    const totalLeads = rows.reduce((sum, r) => sum + r.leads, 0);
    const totalRevenueInr = rows.reduce((sum, r) => sum + r.revenue_inr, 0);
    return {
        campaigns: rows.length,
        totalSpendInr,
        totalLeads,
        blendedCplInr: safeRatio(totalSpendInr, totalLeads),
        totalRevenueInr,
        blendedRoas: safeRatio(totalRevenueInr, totalSpendInr),
    };
}
/**
 * Records one interaction on a lead's path. villa_leads already stores the
 * first-touch source; this is what makes last-touch and everything between
 * knowable, so it should be called wherever a lead surfaces on a channel.
 */
async function recordTouchpoint(leadId, channel, campaign, detail) {
    if (!leadId)
        return { ok: false, error: "leadId is required" };
    const trimmed = channel.trim();
    if (!trimmed)
        return { ok: false, error: "channel is required" };
    const { error } = await (0, supabase_1.db)().from("villa_touchpoints").insert({
        lead_id: leadId,
        channel: trimmed,
        campaign: campaign || null,
        detail: detail || null,
    });
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
/**
 * Groups every recorded touch into per-lead journeys and a channel breakdown
 * in one pass, so the attribution page costs a single query.
 */
async function multiTouchAttribution(limit = 2000) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_touchpoints")
        .select("id, lead_id, channel, campaign, detail, occurred_at, villa_leads(name, phone)")
        .order("occurred_at", { ascending: true })
        .limit(limit);
    const rows = (data ?? []);
    const byLead = new Map();
    for (const row of rows) {
        const existing = byLead.get(row.lead_id);
        if (existing)
            existing.touches.push(row);
        else
            byLead.set(row.lead_id, { row, touches: [row] });
    }
    const journeys = [];
    for (const [leadId, { row, touches }] of byLead) {
        const first = touches[0];
        const last = touches[touches.length - 1];
        const path = [];
        for (const t of touches)
            if (!path.includes(t.channel))
                path.push(t.channel);
        journeys.push({
            leadId,
            name: row.villa_leads?.name ?? null,
            phone: row.villa_leads?.phone ?? null,
            firstChannel: first.channel,
            firstAt: first.occurred_at,
            lastChannel: last.channel,
            lastAt: last.occurred_at,
            touches: touches.length,
            path,
        });
    }
    journeys.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
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
        share: safeRatio(s.touches, rows.length),
    }))
        .sort((a, b) => b.touches - a.touches);
    return { journeys, channels, totalTouches: rows.length };
}
