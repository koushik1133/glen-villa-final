"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETRIEVAL_ENDPOINTS = void 0;
exports.retrieveAll = retrieveAll;
const registry_1 = require("../platforms/registry");
const db_1 = require("../db");
const ids_1 = require("../ids");
const reviews_1 = require("../ai/reviews");
const types_1 = require("../platforms/types");
const types_2 = require("../platforms/types");
const connections_1 = require("../uploadpost/connections");
const youtube_sync_1 = require("./youtube-sync");
const uploadpost_sync_1 = require("./uploadpost-sync");
/**
 * Why an Upload-Post-backed row cannot be retrieved from, per network.
 *
 * Upload-Post holds the network tokens on its side and exposes a publish API
 * only; there is no endpoint for comments, DMs, reviews or insights. Reading
 * any of those needs the network's own OAuth grant stored on the connection.
 */
const UPLOAD_POST_SKIP = {
    instagram: "Instagram comments and DMs need the native Meta connection (OAuth) — the publishing connector publishes and reports analytics only.",
    facebook: "Facebook comments and Messenger need the native Meta connection (OAuth) — the publishing connector publishes and reports analytics only.",
    linkedin: "LinkedIn comments need the native LinkedIn connection (OAuth) — the publishing connector publishes and reports analytics only.",
    tiktok: "TikTok comments and video stats need the native TikTok connection (OAuth) — the publishing connector publishes but does not expose them.",
    x: "X mentions and analytics need the native X connection (OAuth) — the publishing connector publishes but does not expose them.",
    google_business: "Google reviews and Q&A need the native Google Business Profile connection (OAuth) — the publishing connector publishes but does not expose them.",
};
function skipReason(conn) {
    return UPLOAD_POST_SKIP[conn.channel] ?? `${conn.channel} is linked through the publishing connector, which publishes but does not expose inbound data or insights.`;
}
/** Endpoints used per channel in live mode — kept next to the code that needs them. */
exports.RETRIEVAL_ENDPOINTS = {
    instagram: [
        "GET /{ig-user-id}/media?fields=comments{id,text,username,timestamp}",
        "GET /{ig-user-id}/tags  — posts that mention you",
        "GET /{ig-user-id}/conversations?platform=instagram — DMs",
    ],
    facebook: [
        "GET /{page-id}/feed?fields=comments{id,message,from,created_time}",
        "GET /{page-id}/conversations — Messenger threads",
        "GET /{page-id}/ratings — page recommendations",
    ],
    whatsapp: ["Webhook POST /api/webhooks/whatsapp (messages arrive push, not pull)"],
    google_business: [
        "GET /v4/accounts/{acct}/locations/{loc}/reviews",
        "GET /v1/locations/{loc}:fetchMultiDailyMetricsTimeSeries",
        "GET /v4/accounts/{acct}/locations/{loc}/questions",
    ],
    tiktok: ["GET /v2/video/comment/list/"],
    youtube: ["GET /youtube/v3/commentThreads?allThreadsRelatedToChannelId={id}"],
    linkedin: ["GET /rest/socialActions/{urn}/comments"],
    x: ["GET /2/users/{id}/mentions"],
};
/* -------------------------------------------------------------------------- */
/* Live fetchers                                                              */
/* -------------------------------------------------------------------------- */
async function fetchInstagramComments(igUserId, token) {
    const url = new URL(`https://graph.facebook.com/${(0, types_1.graphVersion)()}/${igUserId}/media`);
    url.search = new URLSearchParams({
        access_token: token,
        fields: "id,permalink,comments.limit(25){id,text,username,timestamp}",
        limit: "25",
    }).toString();
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Instagram comments ${res.status}`);
    const json = (await res.json());
    return (json.data ?? []).flatMap((m) => (m.comments?.data ?? []).map((c) => ({
        id: c.id,
        channel: "instagram",
        kind: "comment",
        author: `@${c.username}`,
        text: c.text,
        createdAt: c.timestamp,
        postId: m.id,
    })));
}
async function fetchGoogleReviews(account, location, token) {
    const res = await fetch(`https://mybusiness.googleapis.com/v4/accounts/${account}/locations/${location}/reviews`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok)
        throw new Error(`Google reviews ${res.status}`);
    const json = (await res.json());
    const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    return (json.reviews ?? []).map((r) => ({
        id: r.reviewId,
        source: "google",
        // Google allows a reviewer with no display name, so the absence is real and
        // gets said plainly rather than dressed up as a name we do not have.
        author: r.reviewer?.displayName ?? "Unknown reviewer",
        // No star rating (missing, or STAR_RATING_UNSPECIFIED) leaves this undefined
        // on purpose. The old `?? FIVE` turned every unrated review into a five-star
        // one, which silently pushed the brand's headline average up; the caller
        // decides what to do with a review it cannot score.
        rating: r.starRating ? STARS[r.starRating] : undefined,
        text: r.comment ?? "",
        createdAt: r.createTime ?? new Date().toISOString(),
        replied: Boolean(r.reviewReply),
        reply: r.reviewReply?.comment,
    }));
}
/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */
async function retrieveAll(brandId, opts = {}) {
    const db = (0, db_1.read)();
    // A tokenless row cannot be retrieved from, however "connected" it claims to be.
    const connections = db.connections.filter((c) => c.brandId === brandId && (0, registry_1.isUsableConnection)(c) && (!opts.only || opts.only.includes(c.channel)));
    const sources = [];
    const inbound = [];
    const inboundReviews = [];
    const base = (conn) => ({ channel: conn.channel, connectionId: conn.id, handle: conn.handle, fetched: 0, created: 0 });
    for (const conn of connections) {
        if (conn.channel === "meta_ads" || conn.channel === "google_ads")
            continue;
        // YouTube's numbers are public, so it gets a stats row whether the row is
        // native or Upload-Post-backed. Comments still need OAuth; say so rather
        // than pretend the inbox is quiet.
        if (conn.channel === "youtube") {
            const out = await (0, youtube_sync_1.syncYouTubeStats)(conn, opts.youtube);
            sources.push(out.ok
                ? { ...base(conn), status: "synced", stats: out.stats, detail: `Public stats refreshed for today: ${out.stats.posts} videos, ${out.stats.impressions} views, ${out.stats.followers} subscribers. Comments need the native YouTube connection (OAuth).` }
                : { ...base(conn), status: "error", error: out.error });
            continue;
        }
        // Connector-backed Instagram / Facebook / LinkedIn: the connector serves
        // account analytics (not comments or DMs), so a stats row gets written
        // the way YouTube's is. Networks the connector cannot report on — a
        // LinkedIn personal profile, a Facebook page with no id — are skips.
        if ((0, connections_1.isUploadPostConnection)(conn) && (0, uploadpost_sync_1.isSocialChannel)(conn.channel)) {
            const out = await (0, uploadpost_sync_1.syncSocialStats)(conn, opts.social);
            sources.push(out.ok
                ? { ...base(conn), status: "synced", stats: out.stats, detail: `${out.detail} ${skipReason(conn)}` }
                : out.skipped
                    ? { ...base(conn), status: "skipped", detail: out.detail }
                    : { ...base(conn), status: "error", error: out.error });
            continue;
        }
        // Other Upload-Post rows have no token of their own: nothing here can be fetched.
        // This is the expected state of this deployment, so it is a skip, not an error.
        if ((0, connections_1.isUploadPostConnection)(conn) || !conn.accessToken?.trim()) {
            sources.push({ ...base(conn), status: "skipped", detail: skipReason(conn) });
            continue;
        }
        try {
            let fetched = [];
            if (types_2.DRIVER === "live") {
                if (conn.channel === "instagram") {
                    fetched = await fetchInstagramComments(conn.externalId, conn.accessToken);
                }
                else if (conn.channel === "google_business") {
                    const reviews = await fetchGoogleReviews(process.env.GBP_ACCOUNT_ID ?? "", process.env.GBP_LOCATION_ID ?? conn.externalId, conn.accessToken);
                    inboundReviews.push(...reviews.map((r) => ({ ...r, brandId })));
                }
                else {
                    // Remaining channels: see RETRIEVAL_ENDPOINTS. Each is a self-contained
                    // fetcher following the same shape as the two above.
                    sources.push({ ...base(conn), status: "skipped", detail: `This build has no ${conn.channel} retrieval fetcher yet (see RETRIEVAL_ENDPOINTS).` });
                    continue;
                }
            }
            else {
                // No live credentials for this channel. Previously this fabricated a
                // handful of plausible comments and DMs so the inbox looked alive; that
                // put invented phone numbers and review text in front of operators with
                // nothing marking them as unreal. An unconfigured channel now retrieves
                // nothing and says so, which is the truth.
                sources.push({
                    ...base(conn),
                    status: "skipped",
                    detail: `PLATFORM_DRIVER="${types_2.DRIVER}" — set PLATFORM_DRIVER=live to retrieve real messages.`,
                });
                continue;
            }
            inbound.push(...fetched);
            sources.push({ ...base(conn), status: "synced", fetched: fetched.length });
        }
        catch (e) {
            // One dead token must not take the whole sync down.
            sources.push({ ...base(conn), status: "error", error: e.message });
        }
    }
    // A silent run that fetched nothing and synced nothing has no rows to write
    // and no stamp to set; skip the full-file rewrite of the store.
    const nothingToWrite = opts.silent && inbound.length === 0 && inboundReviews.length === 0 && !sources.some((s) => s.status === "synced");
    const created = nothingToWrite ? { conversations: 0, reviews: 0 } : (0, db_1.mutate)((d) => {
        let convCount = 0;
        let revCount = 0;
        let skippedRev = 0;
        const seenConv = new Set(d.conversations.map((c) => c.id));
        const seenRev = new Set(d.reviews.map((r) => r.id));
        for (const item of inbound) {
            const id = item.id ?? (0, ids_1.uid)("conv");
            if (seenConv.has(id))
                continue; // idempotent by platform id
            seenConv.add(id);
            convCount += 1;
            d.conversations.unshift({
                id,
                brandId,
                channel: item.channel ?? "instagram",
                kind: item.kind ?? "comment",
                author: item.author ?? "Unknown",
                text: item.text ?? "",
                createdAt: item.createdAt ?? new Date().toISOString(),
                status: "open",
                sentiment: /slow|not |never|broken|bad/i.test(item.text ?? "") ? "negative" : "neutral",
                isLead: item.isLead ?? /price|cost|how much|available|availability|book/i.test(item.text ?? ""),
            });
            const source = sources.find((s) => s.channel === item.channel);
            if (source)
                source.created += 1;
        }
        for (const r of inboundReviews) {
            const id = r.id ?? (0, ids_1.uid)("rev");
            if (seenRev.has(id))
                continue;
            // A review with no star rating cannot be stored: `rating` drives the
            // average, the star distribution and the sentiment call, so any default we
            // picked would be a number the reviewer never gave. Skip it and report the
            // skip instead of quietly inventing five stars.
            if (typeof r.rating !== "number") {
                skippedRev += 1;
                continue;
            }
            seenRev.add(id);
            revCount += 1;
            const { sentiment, topics } = (0, reviews_1.analyseReview)(r.text ?? "", r.rating);
            d.reviews.unshift({
                id,
                brandId,
                source: r.source ?? "google",
                author: r.author ?? "Unknown reviewer",
                rating: r.rating,
                text: r.text ?? "",
                createdAt: r.createdAt ?? new Date().toISOString(),
                replied: r.replied ?? false,
                reply: r.reply,
                sentiment,
                topics,
            });
        }
        // Stamp only the sources that actually synced, so "last synced" on the
        // Connections page is a fact about that channel, not about the button.
        const syncedIds = new Set(sources.filter((s) => s.status === "synced").map((s) => s.connectionId));
        for (const c of d.connections) {
            if (syncedIds.has(c.id))
                c.lastSyncedAt = new Date().toISOString();
        }
        if (!opts.silent)
            d.activity.unshift({
                id: (0, ids_1.uid)("act"),
                brandId,
                at: new Date().toISOString(),
                actor: "system",
                kind: "sync",
                message: `Retrieved ${convCount} new message(s) and ${revCount} review(s) · ` +
                    `${sources.filter((s) => s.status === "synced").length} synced, ` +
                    `${sources.filter((s) => s.status === "skipped").length} skipped, ` +
                    `${sources.filter((s) => s.status === "error").length} errored` +
                    (skippedRev > 0 ? ` · ${skippedRev} review(s) skipped: no star rating returned by the platform` : ""),
            });
        return { conversations: convCount, reviews: revCount };
    });
    const count = (st) => sources.filter((s) => s.status === st).length;
    return {
        ok: true,
        brandId,
        at: new Date().toISOString(),
        sources,
        totals: { ...created, synced: count("synced"), skipped: count("skipped"), errored: count("error") },
    };
}
