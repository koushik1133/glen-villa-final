"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncYouTubeStats = syncYouTubeStats;
const db_1 = require("../db");
const public_1 = require("../youtube/public");
function today() {
    return new Date().toISOString().slice(0, 10);
}
async function syncYouTubeStats(conn, fetcher) {
    let snap;
    // Native rows keep the channel title in `handle`; the UC… id resolves reliably.
    const ref = (0, public_1.youtubeChannelRef)(conn);
    if (fetcher) {
        snap = await fetcher(ref);
    }
    else {
        // The public client never throws; it hands back a coded error we can show
        // verbatim ("quota exceeded" beats "unavailable").
        const r = await (0, public_1.fetchYouTubeSnapshotResult)(ref);
        if (!r.ok)
            return { ok: false, error: `YouTube stats unavailable for ${conn.handle}: ${r.error}` };
        snap = r.snapshot;
    }
    if (!snap)
        return { ok: false, error: `YouTube stats unavailable for ${conn.handle} — set YOUTUBE_API_KEY or check the handle.` };
    const date = today();
    // Lifetime levels — what the sync report shows and what the deltas below are measured against.
    const lifetimeViews = snap.videos.reduce((n, v) => n + v.views, 0);
    const lifetimeEngagements = snap.videos.reduce((n, v) => n + v.likes + v.comments, 0);
    const stats = { impressions: lifetimeViews, engagements: lifetimeEngagements, posts: snap.videos.length, followers: snap.channel.stats.subscribers };
    (0, db_1.mutate)((d) => {
        const existing = d.dailyStats.find((s) => s.connectionId === conn.id && s.date === date);
        // Today's row is excluded so a same-day re-run diffs against the same base
        // as the first run did, instead of against itself.
        const earlier = d.dailyStats.filter((s) => s.connectionId === conn.id && s.date < date);
        // Subscriber movement is measured against the newest earlier day we hold,
        // so a first sync reports 0 delta rather than "gained every subscriber today".
        const prior = [...earlier].sort((a, b) => b.date.localeCompare(a.date))[0];
        const followerDelta = prior ? stats.followers - prior.followers : 0;
        // Earlier rows sum to the lifetime level as of the last sync (see header),
        // so today's movement is whatever the API level has grown past that. A
        // deleted video can push the level below the stored sum; clamp at 0 rather
        // than book negative views — the sum then sits above the level until real
        // growth catches up, which is the least surprising of the options.
        const priorSum = (k) => earlier.reduce((n, s) => n + s[k], 0);
        const impressions = Math.max(0, lifetimeViews - priorSum("impressions"));
        const engagements = Math.max(0, lifetimeEngagements - priorSum("engagements"));
        const posts = Math.max(0, stats.posts - priorSum("posts"));
        const row = {
            brandId: conn.brandId,
            connectionId: conn.id,
            channel: "youtube",
            date,
            followers: stats.followers,
            followerDelta,
            impressions,
            // Public data has no reach/profile/story/link figures; videoViews is the
            // same public view count, which is what the tile means on YouTube.
            reach: 0,
            engagements,
            profileVisits: 0,
            linkClicks: 0,
            posts,
            storyViews: 0,
            videoViews: impressions,
        };
        if (existing)
            Object.assign(existing, row);
        else
            d.dailyStats.push(row);
        // The connection card and /channels/youtube read the level off the row.
        const c = d.connections.find((x) => x.id === conn.id);
        if (c) {
            c.followers = stats.followers;
            c.lastSyncedAt = new Date().toISOString();
        }
    });
    return { ok: true, stats };
}
