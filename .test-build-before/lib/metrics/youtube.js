"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_AFTER_MS = void 0;
exports.youtubeSeries = youtubeSeries;
exports.youtubeRangeRollup = youtubeRangeRollup;
exports.topVideos = topVideos;
exports.uploadsInRange = uploadsInRange;
exports.engagementComposition = engagementComposition;
exports.snapshotTotals = snapshotTotals;
exports.isStale = isStale;
exports.updatedAgo = updatedAgo;
const aggregate_1 = require("./aggregate");
const yt = (stats) => stats.filter((s) => s.channel === "youtube");
/** One point per day (views = that day's movement), oldest first. */
function youtubeSeries(stats, range) {
    const byDate = new Map();
    for (const s of yt(stats)) {
        if (!(0, aggregate_1.inRange)(s.date, range))
            continue;
        const row = byDate.get(s.date) ?? { date: s.date, views: 0, engagements: 0, followers: 0 };
        row.views += s.videoViews;
        row.engagements += s.engagements;
        row.followers += s.followers;
        byDate.set(s.date, row);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function youtubeRangeRollup(stats, range) {
    const rows = yt(stats).filter((s) => (0, aggregate_1.inRange)(s.date, range)).sort((a, b) => a.date.localeCompare(b.date));
    const out = { subscribers: 0, subscriberDelta: 0, views: 0, engagements: 0, uploads: 0, days: 0 };
    const dates = new Set();
    for (const s of rows) {
        out.subscriberDelta += s.followerDelta;
        out.views += s.videoViews;
        out.engagements += s.engagements;
        out.uploads += s.posts;
        dates.add(s.date);
    }
    // Followers is a level: the newest row wins, summed across connections on that day.
    const last = rows[rows.length - 1]?.date;
    out.subscribers = last ? rows.filter((s) => s.date === last).reduce((n, s) => n + s.followers, 0) : 0;
    out.days = dates.size;
    return out;
}
/** Highest-viewed first; ties broken by likes so the order is stable. */
function topVideos(videos, n = 5) {
    return [...videos].sort((a, b) => b.views - a.views || b.likes - a.likes).slice(0, n);
}
/** Uploads whose publish date (UTC day) falls inside the range. */
function uploadsInRange(videos, range) {
    return videos.filter((v) => v.publishedAt && (0, aggregate_1.inRange)(v.publishedAt.slice(0, 10), range));
}
function engagementComposition(videos) {
    const likes = videos.reduce((n, v) => n + v.likes, 0);
    const comments = videos.reduce((n, v) => n + v.comments, 0);
    const total = likes + comments;
    return {
        likes,
        comments,
        total,
        likeShare: total ? (likes / total) * 100 : 0,
        commentShare: total ? (comments / total) * 100 : 0,
    };
}
/** Sum of a snapshot's per-video counts — the lifetime totals the tiles show. */
function snapshotTotals(videos) {
    return videos.reduce((a, v) => ({ views: a.views + v.views, likes: a.likes + v.likes, comments: a.comments + v.comments }), { views: 0, likes: 0, comments: 0 });
}
/* ------------------------------------------------------------------ */
/* Freshness                                                            */
/* ------------------------------------------------------------------ */
exports.STALE_AFTER_MS = 10 * 60 * 1000;
/**
 * Should the page trigger a YouTube re-sync before rendering?
 *
 * `lastSyncedAt` is the connection stamp; `newestStatDate` the newest YouTube
 * dailyStats day. Either being fresh is enough — a stats row written today by
 * a sync that then failed to stamp the connection is still today's data.
 * No data at all is stale by definition.
 */
function isStale(input, now = new Date(), ttlMs = exports.STALE_AFTER_MS) {
    const t = input.lastSyncedAt ? Date.parse(input.lastSyncedAt) : NaN;
    if (Number.isFinite(t) && now.getTime() - t < ttlMs)
        return false;
    // A day-granular row cannot prove it is under ten minutes old; only trust
    // it when the connection stamp is missing entirely and the row is today's.
    if (!input.lastSyncedAt && input.newestStatDate === now.toISOString().slice(0, 10))
        return false;
    return true;
}
/** "just now" | "4 min ago" | "3 h ago" | "2 d ago" | "never". */
function updatedAgo(iso, now = new Date()) {
    if (!iso)
        return "never";
    const ms = now.getTime() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0)
        return "just now";
    const min = Math.floor(ms / 60000);
    if (min < 1)
        return "just now";
    if (min < 60)
        return `${min} min ago`;
    const h = Math.floor(min / 60);
    if (h < 24)
        return `${h} h ago`;
    return `${Math.floor(h / 24)} d ago`;
}
