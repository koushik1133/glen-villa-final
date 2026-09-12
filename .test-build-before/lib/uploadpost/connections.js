"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_POST_PLATFORM = exports.UPLOAD_POST_PREFIX = void 0;
exports.isUploadPostConnection = isUploadPostConnection;
exports.uploadPostExternalId = uploadPostExternalId;
exports.uploadPostLinkedAccount = uploadPostLinkedAccount;
exports.publishViaUploadPost = publishViaUploadPost;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const client_1 = require("../supabase/client");
const store_1 = require("../media/store");
const client_2 = require("./client");
/**
 * UPLOAD-POST BACKED CONNECTIONS
 *
 * The app's own connect flow is OAuth: each network needs its own developer
 * app and client credentials, and the token lands in `connections`. Upload-Post
 * is the alternative this deployment actually uses — the networks are linked
 * once in the Upload-Post dashboard and one API key publishes to all of them.
 *
 * Before this module the two never met: the validation layer accepted an
 * Upload-Post-backed row, but nothing created one, so every channel read
 * "not connected" and the composer had nothing to target. A connection here is
 * a row whose `externalId` carries the `uploadpost:` prefix; the publisher
 * recognises that prefix and sends media through Upload-Post instead of the
 * network's own API.
 */
exports.UPLOAD_POST_PREFIX = "uploadpost:";
/** App channel → Upload-Post platform key. */
exports.UPLOAD_POST_PLATFORM = {
    instagram: "instagram",
    youtube: "youtube",
    facebook: "facebook",
    linkedin: "linkedin",
    tiktok: "tiktok",
    x: "x",
    google_business: "google_business",
};
function isUploadPostConnection(c) {
    return Boolean(c.externalId?.startsWith(exports.UPLOAD_POST_PREFIX));
}
function uploadPostExternalId(channel) {
    return `${exports.UPLOAD_POST_PREFIX}${(0, client_2.uploadPostUser)()}:${exports.UPLOAD_POST_PLATFORM[channel] ?? channel}`;
}
/** The account linked for this channel in the Upload-Post profile, if any. */
async function uploadPostLinkedAccount(channel) {
    const platform = exports.UPLOAD_POST_PLATFORM[channel];
    if (!platform || !(0, client_2.isUploadPostConfigured)())
        return null;
    const status = await (0, client_2.checkUploadPostStatus)();
    if (!status.valid)
        return null;
    const profile = status.profiles.find((p) => p.username === status.activeProfile) ?? status.profiles[0];
    const raw = profile?.social_accounts?.[platform];
    if (!raw || typeof raw !== "object")
        return null;
    return raw.handle || raw.display_name ? raw : null;
}
/* -------------------------------------------------------------------------- */
/* Publishing                                                                  */
/* -------------------------------------------------------------------------- */
const VIDEO_RE = /\.(mp4|mov|m4v|webm)(\?|$)/i;
/**
 * Turn a media reference into something Upload-Post can take: a public URL, or
 * the file's bytes. Local paths under /public are read directly, so publishing
 * through Upload-Post does not need PUBLIC_BASE_URL — the one hard requirement
 * of the native adapters that a localhost deployment can never satisfy.
 */
async function loadMedia(ref) {
    const filename = node_path_1.default.basename(ref.split("?")[0]) || "media";
    if (/^https?:\/\//i.test(ref))
        return { value: ref, filename };
    if ((0, store_1.isStorageSrc)(ref)) {
        if (!(0, client_1.isSupabaseConfigured)() || !(0, client_1.hasServiceRole)())
            return null;
        const url = await (0, store_1.resolveSrc)((0, client_1.adminClient)(), ref);
        return url ? { value: url, filename } : null;
    }
    const publicDir = node_path_1.default.join(process.cwd(), "public");
    const local = node_path_1.default.resolve(publicDir, ref.replace(/^\/+/, ""));
    // Never read outside the public tree, whatever the stored path says. The
    // separator is part of the prefix: a bare `startsWith(publicDir)` also
    // accepted `../public-archive/...`, i.e. any sibling whose name begins with
    // "public".
    if (!local.startsWith(publicDir + node_path_1.default.sep))
        return null;
    try {
        return { value: await promises_1.default.readFile(local), filename };
    }
    catch {
        return null;
    }
}
function pickId(data, platform) {
    const d = (data ?? {});
    const results = (d.results ?? d.result ?? {});
    const mine = (results[platform] ?? {});
    const externalId = String(mine.id ?? mine.post_id ?? mine.video_id ?? d.request_id ?? d.id ?? `uploadpost-${Date.now()}`);
    const permalink = typeof mine.url === "string" ? mine.url : typeof mine.permalink === "string" ? mine.permalink : undefined;
    return { externalId, permalink };
}
async function publishViaUploadPost(channel, req) {
    const platform = exports.UPLOAD_POST_PLATFORM[channel];
    if (!platform)
        return { ok: false, error: `${channel} cannot publish through the publishing connector.`, retryable: false };
    if (!(0, client_2.isUploadPostConfigured)())
        return { ok: false, error: "The publishing connector is not configured.", retryable: false };
    const hashtags = req.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    const description = [req.caption, hashtags].filter(Boolean).join("\n\n");
    const title = (req.caption.split("\n")[0] || description).slice(0, 100);
    if (!req.mediaUrls.length) {
        return { ok: false, error: "The publishing connector needs a video or at least one image — text-only posts are not supported on this path.", retryable: false };
    }
    const loaded = [];
    for (const ref of req.mediaUrls) {
        const m = await loadMedia(ref);
        if (!m)
            return { ok: false, error: `Could not read media "${ref}" for the publishing connector.`, retryable: false };
        loaded.push({ ...m, isVideo: VIDEO_RE.test(ref) });
    }
    const video = loaded.find((m) => m.isVideo);
    const res = video
        ? await (0, client_2.uploadPostVideo)({
            platforms: [platform],
            video: video.value,
            filename: video.filename,
            title,
            description,
            mediaType: req.format === "story" ? "STORIES" : req.format === "reel" || req.format === "short" ? "REELS" : undefined,
        })
        : await (0, client_2.uploadPostPhotos)({
            platforms: [platform],
            photos: loaded.map((m) => m.value),
            title,
            description,
        });
    if (!res.ok) {
        const msg = res.error ?? "Publishing connector publish failed";
        // Rate limits and upstream outages are worth another attempt; rejected media is not.
        const retryable = /429|rate|timeout|5\d\d|temporar/i.test(msg);
        return { ok: false, error: msg, retryable };
    }
    const { externalId, permalink } = pickId(res.data, platform);
    return { ok: true, externalId, permalink };
}
