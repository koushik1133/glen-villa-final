"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AD_PLATFORMS = exports.GOOGLE_ADS_GAQL = exports.META_INSIGHT_FIELDS = void 0;
exports.fetchMetaAdStats = fetchMetaAdStats;
exports.normaliseMetaRow = normaliseMetaRow;
exports.fetchGoogleAdStats = fetchGoogleAdStats;
exports.normaliseGoogleRow = normaliseGoogleRow;
exports.setMetaBudget = setMetaBudget;
exports.setAdStatus = setAdStatus;
const types_1 = require("./types");
/**
 * Ads connectors. Meta and Google model campaigns very differently, so we
 * normalise both into the same `AdStat` row shape at the edge. Every chart,
 * every AI signal and the whole /ads page work off that one shape — which is
 * what makes "Meta and Google in one place" actually true rather than two
 * dashboards sitting side by side.
 */
/** Fields we pull from Meta Insights. Enough to derive ROAS, fatigue and CPM drift. */
exports.META_INSIGHT_FIELDS = [
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "inline_link_clicks",
    "ctr",
    "cpc",
    "cpm",
    "spend",
    "actions",
    "action_values",
    "video_play_actions",
    "video_thruplay_watched_actions",
].join(",");
/**
 * GET /{ad_account}/insights with level=ad and a daily time_increment gives one
 * row per ad per day — the finest grain that still fits comfortably in the API's
 * async-job-free path for a single account.
 */
async function fetchMetaAdStats(opts) {
    if (types_1.DRIVER === "mock")
        return [];
    const url = new URL(`https://graph.facebook.com/${(0, types_1.graphVersion)()}/${opts.accountId}/insights`);
    url.search = new URLSearchParams({
        access_token: opts.token,
        level: "ad",
        time_increment: "1",
        limit: "500",
        fields: exports.META_INSIGHT_FIELDS,
        time_range: JSON.stringify({ since: opts.since, until: opts.until }),
    }).toString();
    const rows = [];
    let next = url.toString();
    while (next) {
        const res = await fetch(next);
        if (!res.ok)
            throw new Error(`Meta insights ${res.status}`);
        const json = (await res.json());
        for (const r of json.data)
            rows.push(normaliseMetaRow(r));
        next = json.paging?.next;
    }
    return rows;
}
/** Pull the purchase/lead conversion count and value out of Meta's actions arrays. */
function sumActions(list, types) {
    if (!Array.isArray(list))
        return 0;
    return list
        .filter((a) => types.includes(a.action_type ?? ""))
        .reduce((sum, a) => sum + Number(a.value ?? 0), 0);
}
const CONVERSION_ACTIONS = [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "lead",
    "offsite_conversion.fb_pixel_lead",
    "onsite_conversion.messaging_conversation_started_7d",
];
function normaliseMetaRow(r) {
    return {
        platform: "meta_ads",
        campaignId: String(r.campaign_id ?? ""),
        adSetId: String(r.adset_id ?? ""),
        adId: String(r.ad_id ?? ""),
        date: String(r.date_start ?? ""),
        impressions: Number(r.impressions ?? 0),
        reach: Number(r.reach ?? 0),
        frequency: Number(r.frequency ?? 0),
        clicks: Number(r.inline_link_clicks ?? r.clicks ?? 0),
        spend: Number(r.spend ?? 0),
        conversions: sumActions(r.actions, CONVERSION_ACTIONS),
        conversionValue: sumActions(r.action_values, CONVERSION_ACTIONS),
        videoPlays: sumActions(r.video_play_actions, ["video_view"]),
        thruPlays: sumActions(r.video_thruplay_watched_actions, ["video_view"]),
    };
}
/**
 * Google Ads speaks GAQL over REST. `segments.date` gives the same daily grain,
 * and micros→currency conversion happens here so nothing downstream has to know
 * Google stores money as millionths.
 */
exports.GOOGLE_ADS_GAQL = `
  SELECT
    campaign.id, campaign.name, campaign.status,
    ad_group.id, ad_group.name,
    ad_group_ad.ad.id, ad_group_ad.ad.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value,
    metrics.video_views, metrics.average_cpc,
    segments.date
  FROM ad_group_ad
  WHERE segments.date BETWEEN '{since}' AND '{until}'
`;
async function fetchGoogleAdStats(opts) {
    if (types_1.DRIVER === "mock")
        return [];
    const res = await fetch(`https://googleads.googleapis.com/v18/customers/${opts.customerId}/googleAds:searchStream`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${opts.token}`,
            "developer-token": opts.developerToken,
            ...(opts.loginCustomerId ? { "login-customer-id": opts.loginCustomerId } : {}),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            query: exports.GOOGLE_ADS_GAQL.replace("{since}", opts.since).replace("{until}", opts.until),
        }),
    });
    if (!res.ok)
        throw new Error(`Google Ads ${res.status}`);
    const chunks = (await res.json());
    const rows = [];
    for (const chunk of chunks) {
        for (const r of chunk.results ?? [])
            rows.push(normaliseGoogleRow(r));
    }
    return rows;
}
function normaliseGoogleRow(r) {
    const m = (r.metrics ?? {});
    return {
        platform: "google_ads",
        campaignId: String(r.campaign?.id ?? ""),
        adSetId: String(r.adGroup?.id ?? ""),
        adId: String((r.adGroupAd?.ad ?? {}).id ?? ""),
        date: String(r.segments?.date ?? ""),
        impressions: Number(m.impressions ?? 0),
        clicks: Number(m.clicks ?? 0),
        // Google reports money in micros.
        spend: Number(m.costMicros ?? 0) / 1_000_000,
        conversions: Number(m.conversions ?? 0),
        conversionValue: Number(m.conversionsValue ?? 0),
        videoPlays: Number(m.videoViews ?? 0),
        thruPlays: Number(m.videoViews ?? 0),
        frequency: 0,
        reach: 0,
    };
}
/** Budget writes. Guarded so a mock run can never spend real money. */
async function setMetaBudget(adSetId, dailyBudgetMinor, token) {
    if (types_1.DRIVER === "mock")
        return { ok: true };
    const res = await fetch(`https://graph.facebook.com/${(0, types_1.graphVersion)()}/${adSetId}`, {
        method: "POST",
        body: new URLSearchParams({ access_token: token, daily_budget: String(dailyBudgetMinor) }),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Meta budget write ${res.status}` };
}
async function setAdStatus(adId, status, token) {
    if (types_1.DRIVER === "mock")
        return { ok: true };
    const res = await fetch(`https://graph.facebook.com/${(0, types_1.graphVersion)()}/${adId}`, {
        method: "POST",
        body: new URLSearchParams({ access_token: token, status }),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Meta status write ${res.status}` };
}
exports.AD_PLATFORMS = ["meta_ads", "google_ads"];
