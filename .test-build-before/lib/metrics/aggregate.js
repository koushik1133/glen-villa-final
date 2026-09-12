"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lastNDays = lastNDays;
exports.previousRange = previousRange;
exports.inRange = inRange;
exports.rollupByChannel = rollupByChannel;
exports.totals = totals;
exports.timeseries = timeseries;
exports.adTotals = adTotals;
exports.adStatsFor = adStatsFor;
exports.statsFor = statsFor;
exports.postsFor = postsFor;
exports.pctChange = pctChange;
exports.engagementRateByFollowers = engagementRateByFollowers;
function lastNDays(n, today = new Date()) {
    const to = new Date(today);
    const from = new Date(today);
    from.setDate(from.getDate() - (n - 1));
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
/** The equally-long window immediately before `range`, for period-over-period deltas. */
function previousRange(range) {
    const from = new Date(range.from);
    const to = new Date(range.to);
    const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - (days - 1));
    return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}
function inRange(date, range) {
    return date >= range.from && date <= range.to;
}
function rollupByChannel(stats, range) {
    const rows = stats.filter((s) => inRange(s.date, range));
    const byChannel = new Map();
    const latestFollowersByConnection = new Map();
    for (const s of rows) {
        const r = byChannel.get(s.channel) ??
            {
                channel: s.channel,
                followers: 0,
                followerDelta: 0,
                impressions: 0,
                reach: 0,
                engagements: 0,
                engagementRate: 0,
                linkClicks: 0,
                posts: 0,
                videoViews: 0,
                storyViews: 0,
            };
        r.impressions += s.impressions;
        r.reach += s.reach;
        r.engagements += s.engagements;
        r.linkClicks += s.linkClicks;
        r.posts += s.posts;
        r.videoViews += s.videoViews;
        r.storyViews += s.storyViews;
        r.followerDelta += s.followerDelta;
        byChannel.set(s.channel, r);
        // Followers is a level, not a sum: take the newest row per connection.
        const prev = latestFollowersByConnection.get(s.connectionId);
        if (!prev || s.date > prev.date) {
            latestFollowersByConnection.set(s.connectionId, { date: s.date, followers: s.followers });
        }
    }
    for (const [connectionId, v] of latestFollowersByConnection) {
        const channel = rows.find((s) => s.connectionId === connectionId)?.channel;
        if (!channel)
            continue;
        const r = byChannel.get(channel);
        if (r)
            r.followers += v.followers;
    }
    for (const r of byChannel.values()) {
        r.engagementRate = r.impressions ? (r.engagements / r.impressions) * 100 : 0;
    }
    return [...byChannel.values()].sort((a, b) => b.impressions - a.impressions);
}
function totals(stats, range) {
    const rollups = rollupByChannel(stats, range);
    const t = {
        followers: 0,
        followerDelta: 0,
        impressions: 0,
        reach: 0,
        engagements: 0,
        engagementRate: 0,
        linkClicks: 0,
        posts: 0,
        videoViews: 0,
    };
    for (const r of rollups) {
        t.followers += r.followers;
        t.followerDelta += r.followerDelta;
        t.impressions += r.impressions;
        t.reach += r.reach;
        t.engagements += r.engagements;
        t.linkClicks += r.linkClicks;
        t.posts += r.posts;
        t.videoViews += r.videoViews;
    }
    t.engagementRate = t.impressions ? (t.engagements / t.impressions) * 100 : 0;
    return t;
}
/** Daily series for the main chart, one point per day with every channel summed. */
function timeseries(stats, range, channels) {
    const byDate = new Map();
    for (const s of stats) {
        if (!inRange(s.date, range))
            continue;
        if (channels?.length && !channels.includes(s.channel))
            continue;
        const row = byDate.get(s.date) ?? {
            date: s.date,
            impressions: 0,
            engagements: 0,
            reach: 0,
            followers: 0,
            linkClicks: 0,
        };
        row.impressions += s.impressions;
        row.engagements += s.engagements;
        row.reach += s.reach;
        row.followers += s.followers;
        row.linkClicks += s.linkClicks;
        byDate.set(s.date, row);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function adTotals(rows) {
    const t = rows.reduce((a, r) => {
        a.spend += r.spend;
        a.impressions += r.impressions;
        a.clicks += r.clicks;
        a.conversions += r.conversions;
        a.conversionValue += r.conversionValue;
        a.reach += r.reach;
        a.freqWeighted += r.frequency * r.impressions;
        return a;
    }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0, freqWeighted: 0 });
    return {
        spend: t.spend,
        impressions: t.impressions,
        clicks: t.clicks,
        conversions: t.conversions,
        conversionValue: t.conversionValue,
        reach: t.reach,
        ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0,
        cpc: t.clicks ? t.spend / t.clicks : 0,
        cpm: t.impressions ? (t.spend / t.impressions) * 1000 : 0,
        cpa: t.conversions ? t.spend / t.conversions : 0,
        roas: t.spend ? t.conversionValue / t.spend : 0,
        frequency: t.impressions ? t.freqWeighted / t.impressions : 0,
    };
}
function adStatsFor(db, brandId, range) {
    return db.adStats.filter((r) => r.brandId === brandId && inRange(r.date, range));
}
function statsFor(db, brandId) {
    return db.dailyStats.filter((s) => s.brandId === brandId);
}
function postsFor(db, brandId) {
    return db.posts.filter((p) => p.brandId === brandId);
}
function pctChange(current, previous) {
    if (!previous)
        return current ? 100 : 0;
    return ((current - previous) / previous) * 100;
}
/** Engagement rate by follower base — the number clients actually recognise. */
function engagementRateByFollowers(engagements, followers) {
    return followers ? (engagements / followers) * 100 : 0;
}
