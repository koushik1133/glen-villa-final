"use strict";
/**
 * PUBLISHING-CONNECTOR ANALYTICS (Upload-Post)
 *
 * Typed fetchers over the connector's analytics endpoints, plus the pure
 * mapping from the raw payload to what the app stores and renders. The
 * network layer is confined to `fetchSocialAnalytics` / `fetchHistory` /
 * `fetchPostAnalytics`; everything else takes plain objects so the node:test
 * suite pins it without a server.
 *
 * Verified payload (GET /api/analytics/{profile}?platforms=instagram,facebook,linkedin):
 *  - instagram: { followers, reach, views, impressions, profileViews, likes,
 *    comments, shares, saves, reach_timeseries:[{date,value}], available_metrics,
 *    metric_labels, primary_impressions_field }
 *  - facebook: needs `&page_id=`; without it { success:false, message }
 *  - linkedin: { success:false, linkedin_personal_unsupported:true, message }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_TTL_MS = exports.FreshBypassThrottle = exports.EMPTY_TOTALS = exports.SOCIAL_CHANNELS = void 0;
exports.mapChannelAnalytics = mapChannelAnalytics;
exports.mapHistory = mapHistory;
exports.mapPostAnalytics = mapPostAnalytics;
exports.recentPosts = recentPosts;
exports.resetAnalyticsCache = resetAnalyticsCache;
exports.fetchSocialAnalytics = fetchSocialAnalytics;
exports.fetchHistory = fetchHistory;
exports.fetchPostAnalytics = fetchPostAnalytics;
exports.discoverFacebookPageId = discoverFacebookPageId;
const client_1 = require("./client");
const BASE = "https://api.upload-post.com/api";
exports.SOCIAL_CHANNELS = ["instagram", "facebook", "linkedin"];
/* -------------------------------------------------------------------------- */
/* Pure mapping                                                                */
/* -------------------------------------------------------------------------- */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
function series(v) {
    if (!Array.isArray(v))
        return [];
    return v
        .filter((p) => Boolean(p) && typeof p.date === "string")
        .map((p) => ({ date: p.date.slice(0, 10), value: num(p.value) }))
        .sort((a, b) => a.date.localeCompare(b.date));
}
exports.EMPTY_TOTALS = { followers: 0, reach: 0, views: 0, impressions: 0, profileViews: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
/** Turn one network's slice of the analytics payload into the app's shape, error states included. */
function mapChannelAnalytics(channel, raw) {
    const base = { channel, ok: false, totals: { ...exports.EMPTY_TOTALS }, reachSeries: [], impressionsSeries: [], availableMetrics: [], metricLabels: {}, periodDays: 30 };
    if (!raw || typeof raw !== "object")
        return { ...base, reason: "error", message: `The publishing connector returned no ${channel} analytics.` };
    const r = raw;
    if (r.success === false) {
        const message = typeof r.message === "string" ? r.message : `The publishing connector could not read ${channel} analytics.`;
        if (r.linkedin_personal_unsupported === true)
            return { ...base, reason: "personal_unsupported", message };
        if (/page_id/i.test(message))
            return { ...base, reason: "page_id_required", message };
        return { ...base, reason: "error", message };
    }
    const labels = {};
    if (r.metric_labels && typeof r.metric_labels === "object") {
        for (const [k, v] of Object.entries(r.metric_labels))
            if (typeof v === "string")
                labels[k] = v;
    }
    return {
        ...base,
        ok: true,
        totals: {
            followers: num(r.followers),
            reach: num(r.reach),
            views: num(r.views),
            impressions: num(r.impressions),
            profileViews: num(r.profileViews),
            likes: num(r.likes),
            comments: num(r.comments),
            shares: num(r.shares),
            saves: num(r.saves),
        },
        reachSeries: series(r.reach_timeseries),
        impressionsSeries: series(r.impressions_timeseries),
        availableMetrics: Array.isArray(r.available_metrics) ? r.available_metrics.filter((m) => typeof m === "string") : [],
        metricLabels: labels,
        periodDays: num(r.period_days) || 30,
    };
}
function mapHistory(raw) {
    const list = raw && typeof raw === "object" && Array.isArray(raw.history) ? (raw.history) : [];
    return list
        .filter((x) => Boolean(x) && typeof x === "object")
        .map((x) => ({
        platform: String(x.platform ?? ""),
        uploadedAt: typeof x.upload_timestamp === "string" ? x.upload_timestamp : "",
        success: x.success === true,
        platformPostId: typeof x.platform_post_id === "string" && x.platform_post_id ? x.platform_post_id : null,
        postUrl: typeof x.post_url === "string" && x.post_url ? x.post_url : null,
        title: String(x.post_title ?? x.post_caption ?? ""),
        mediaType: String(x.media_type ?? ""),
        error: typeof x.error_message === "string" ? x.error_message : null,
    }))
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}
/** Per-post metrics keyed by platform post id; tolerant of the connector's field names. */
function mapPostAnalytics(raw) {
    const out = new Map();
    const list = raw && typeof raw === "object" && Array.isArray(raw.posts) ? (raw.posts) : [];
    for (const p of list) {
        if (!p || typeof p !== "object")
            continue;
        const x = p;
        const id = String(x.platform_post_id ?? x.post_id ?? x.id ?? "");
        if (!id)
            continue;
        const m = (x.metrics && typeof x.metrics === "object" ? x.metrics : x);
        out.set(id, {
            views: num(m.views ?? m.plays ?? m.video_views),
            reach: num(m.reach),
            impressions: num(m.impressions),
            likes: num(m.likes ?? m.like_count),
            comments: num(m.comments ?? m.comments_count),
            shares: num(m.shares),
            saves: num(m.saves ?? m.saved),
        });
    }
    return out;
}
/** Successful uploads for one network, newest first, joined to whatever per-post metrics exist. */
function recentPosts(channel, history, metrics, max = 20) {
    return history
        .filter((h) => h.platform === channel && h.success)
        .slice(0, max)
        .map((h) => ({ ...h, metrics: h.platformPostId ? metrics.get(h.platformPostId) ?? null : null }));
}
/* -------------------------------------------------------------------------- */
/* Throttle (same contract as the YouTube studio's, kept independent)         */
/* -------------------------------------------------------------------------- */
/** One cache bypass per key per window, so a held-down Refresh cannot hammer the connector. */
class FreshBypassThrottle {
    windowMs;
    clock;
    last = new Map();
    constructor(windowMs = 20_000, clock = Date.now) {
        this.windowMs = windowMs;
        this.clock = clock;
    }
    allow(key) {
        const now = this.clock();
        const prev = this.last.get(key) ?? -Infinity;
        if (now - prev < this.windowMs)
            return false;
        this.last.set(key, now);
        return true;
    }
    retryAfter(key) {
        const prev = this.last.get(key);
        if (prev === undefined)
            return 0;
        return Math.max(0, Math.ceil((this.windowMs - (this.clock() - prev)) / 1000));
    }
}
exports.FreshBypassThrottle = FreshBypassThrottle;
/* -------------------------------------------------------------------------- */
/* Network                                                                     */
/* -------------------------------------------------------------------------- */
exports.CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
/** Test hook. */
function resetAnalyticsCache() {
    cache.clear();
}
async function getJson(path, cacheKey, fresh) {
    const key = (0, client_1.uploadPostApiKey)();
    if (!key)
        return { ok: false, error: "The publishing connector is not configured." };
    const hit = cache.get(cacheKey);
    if (!fresh && hit && Date.now() - hit.at < exports.CACHE_TTL_MS)
        return { ok: true, json: hit.value };
    try {
        const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Apikey ${key}` }, cache: "no-store", signal: AbortSignal.timeout(5000) });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            const msg = json && typeof json === "object" && typeof json.message === "string" ? json.message : `HTTP ${res.status}`;
            return { ok: false, error: msg };
        }
        cache.set(cacheKey, { at: Date.now(), value: json });
        return { ok: true, json };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
/** All three networks in one call; each slice carries its own ok/reason. */
async function fetchSocialAnalytics(opts = {}) {
    const profile = (0, client_1.uploadPostUser)();
    const params = new URLSearchParams({ platforms: exports.SOCIAL_CHANNELS.join(",") });
    if (opts.facebookPageId)
        params.set("page_id", opts.facebookPageId);
    const r = await getJson(`/analytics/${encodeURIComponent(profile)}?${params}`, `analytics:${profile}:${opts.facebookPageId ?? ""}`, Boolean(opts.fresh));
    const out = {};
    for (const ch of exports.SOCIAL_CHANNELS) {
        if (!r.ok) {
            const notConfigured = /not configured/i.test(r.error);
            out[ch] = { ...mapChannelAnalytics(ch, null), reason: notConfigured ? "not_configured" : "error", message: r.error };
            continue;
        }
        const slice = r.json && typeof r.json === "object" ? r.json[ch] : undefined;
        out[ch] = mapChannelAnalytics(ch, slice);
        // A missing page id is a configuration gap we can name precisely.
        if (ch === "facebook" && !opts.facebookPageId && !out[ch].ok && out[ch].reason !== "page_id_required")
            out[ch].reason = "page_id_required";
    }
    return out;
}
async function fetchHistory(fresh = false) {
    const profile = (0, client_1.uploadPostUser)();
    const r = await getJson(`/uploadposts/history?user=${encodeURIComponent(profile)}`, `history:${profile}`, fresh);
    return r.ok ? mapHistory(r.json) : [];
}
async function fetchPostAnalytics(fresh = false) {
    const profile = (0, client_1.uploadPostUser)();
    const r = await getJson(`/uploadposts/post-analytics/cached?user=${encodeURIComponent(profile)}&limit=50`, `post-analytics:${profile}`, fresh);
    return r.ok ? mapPostAnalytics(r.json) : new Map();
}
/**
 * Facebook page id discovery, in order: the brand's saved setting, the
 * connector profile (`facebook_page_id`), then Graph `/me/accounts` with the
 * system-user token. Null means "ask the operator".
 */
async function discoverFacebookPageId(saved) {
    if (saved?.trim())
        return saved.trim();
    const profile = (0, client_1.uploadPostUser)();
    const users = await getJson(`/uploadposts/users`, `users`, false);
    if (users.ok && users.json && typeof users.json === "object") {
        const profiles = users.json.profiles ?? [];
        const p = profiles.find((x) => x.username === profile) ?? profiles[0];
        const fb = p?.social_accounts && typeof p.social_accounts === "object" ? p.social_accounts.facebook : undefined;
        const fromAccount = fb && typeof fb === "object" ? fb : undefined;
        const id = p?.facebook_page_id ?? fromAccount?.page_id ?? fromAccount?.id;
        if (typeof id === "string" && id.trim())
            return id.trim();
        if (typeof id === "number")
            return String(id);
    }
    const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
    if (token) {
        try {
            const v = process.env.META_GRAPH_VERSION?.trim() || "v21.0";
            const res = await fetch(`https://graph.facebook.com/${v}/me/accounts?fields=id&limit=1&access_token=${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
            const json = (await res.json().catch(() => null));
            const id = json?.data?.[0]?.id;
            if (res.ok && id)
                return id;
        }
        catch { /* fall through */ }
    }
    return null;
}
