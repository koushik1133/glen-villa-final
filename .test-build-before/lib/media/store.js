"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BYTES = exports.STORAGE_SRC_PREFIX = exports.BUCKET = void 0;
exports.isStorageSrc = isStorageSrc;
exports.resolveSrc = resolveSrc;
exports.detectType = detectType;
exports.validateUpload = validateUpload;
exports.probeDimensions = probeDimensions;
exports.storageKey = storageKey;
exports.putMedia = putMedia;
exports.signedUrl = signedUrl;
exports.listMedia = listMedia;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * MARKETING MEDIA STORE
 *
 * Video and images destined for publishing live in the private `marketing-media`
 * bucket, with one row per object in `media_assets`. Nothing here is public: a
 * reel reaches Instagram by being handed to the Graph API, not by sitting at a
 * guessable URL, so the bucket stays private and reads go through a signed URL
 * that expires.
 *
 * Everything runs through the *anon* client carrying the caller's session, so
 * RLS decides what may be written. `media_assets_write` (migration 0005) admits
 * either `construction.upload` or `marketing.publish` — the site engineer
 * uploading progress photos and the marketing lead uploading a reel are
 * different people with different grants and both legitimately upload.
 */
exports.BUCKET = "marketing-media";
/**
 * Marks a `MediaAsset.src` as an object key in the bucket rather than a path on
 * disk. A signed URL cannot be stored in its place: it expires in an hour, and
 * a render requested next week must still be able to read the file.
 */
exports.STORAGE_SRC_PREFIX = "supabase://marketing-media/";
/** True when this asset lives in object storage rather than the local tree. */
function isStorageSrc(src) {
    return src.startsWith(exports.STORAGE_SRC_PREFIX);
}
/** A fresh, short-lived URL ffmpeg can read for a stored object. */
async function resolveSrc(sb, src, expiresInSeconds = 3600) {
    if (!isStorageSrc(src))
        return src;
    return signedUrl(sb, src.slice(exports.STORAGE_SRC_PREFIX.length), expiresInSeconds);
}
/** Hard ceiling. Instagram itself rejects a reel over 1GB; we stop far earlier. */
exports.MAX_BYTES = 512 * 1024 * 1024;
const TYPES = [
    {
        kind: "video",
        mime: "video/mp4",
        ext: "mp4",
        // ISO-BMFF: bytes 4..8 are "ftyp". Covers mp4 and the m4v/mov family below.
        match: (h) => h.length > 12 && h.subarray(4, 8).toString("latin1") === "ftyp",
    },
    {
        kind: "video",
        mime: "video/quicktime",
        ext: "mov",
        match: (h) => h.length > 12 &&
            h.subarray(4, 8).toString("latin1") === "ftyp" &&
            h.subarray(8, 12).toString("latin1").startsWith("qt"),
    },
    {
        kind: "video",
        mime: "video/webm",
        ext: "webm",
        match: (h) => h.length > 4 && h.readUInt32BE(0) === 0x1a45dfa3,
    },
    {
        kind: "image",
        mime: "image/jpeg",
        ext: "jpg",
        match: (h) => h.length > 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
    },
    {
        kind: "image",
        mime: "image/png",
        ext: "png",
        match: (h) => h.length > 8 && h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
    {
        kind: "image",
        mime: "image/webp",
        ext: "webp",
        match: (h) => h.length > 12 &&
            h.subarray(0, 4).toString("latin1") === "RIFF" &&
            h.subarray(8, 12).toString("latin1") === "WEBP",
    },
];
/**
 * Identify the file from its own bytes.
 *
 * `quicktime` is checked before the generic mp4 rule would swallow it, because
 * both are ISO-BMFF and only the brand at offset 8 separates them.
 */
function detectType(head) {
    const mov = TYPES.find((t) => t.ext === "mov");
    if (mov.match(head))
        return { kind: mov.kind, mime: mov.mime, ext: mov.ext };
    const hit = TYPES.find((t) => t.match(head));
    return hit ? { kind: hit.kind, mime: hit.mime, ext: hit.ext } : null;
}
function validateUpload(bytes) {
    if (bytes.byteLength === 0)
        return { error: "The file is empty." };
    if (bytes.byteLength > exports.MAX_BYTES) {
        return { error: `That file is ${(bytes.byteLength / 1048576).toFixed(0)} MB. The limit is ${exports.MAX_BYTES / 1048576} MB.` };
    }
    const type = detectType(bytes.subarray(0, 16));
    if (!type) {
        return { error: "Unsupported file. Upload MP4, MOV, WebM, JPEG, PNG or WebP." };
    }
    return type;
}
/**
 * Real dimensions, probed rather than assumed.
 *
 * The aspect-ratio validation and the ffmpeg crop both depend on knowing the
 * true frame size; storing a guess here produces a reel that is silently
 * letterboxed at publish time. Video goes through ffprobe (ffmpeg is already a
 * dependency of the render pipeline); images go through sharp.
 *
 * Returns zeroes when the probe is unavailable — the caller records that as
 * "unknown" rather than inventing a 1080x1920.
 */
async function probeDimensions(bytes, type) {
    if (type.kind === "image") {
        try {
            const sharp = (await Promise.resolve().then(() => __importStar(require("sharp")))).default;
            const meta = await sharp(bytes).metadata();
            return { width: meta.width ?? 0, height: meta.height ?? 0 };
        }
        catch {
            return { width: 0, height: 0 };
        }
    }
    // ffprobe needs a seekable file; a pipe fails on moov-at-end MP4s.
    const tmp = node_path_1.default.join(node_os_1.default.tmpdir(), `probe_${node_crypto_1.default.randomUUID()}.${type.ext}`);
    try {
        await node_fs_1.default.promises.writeFile(tmp, bytes);
        const out = (0, node_child_process_1.spawnSync)("ffprobe", ["-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height:format=duration",
            "-of", "json", tmp], { encoding: "utf8" });
        if (out.status !== 0)
            return { width: 0, height: 0 };
        const parsed = JSON.parse(out.stdout);
        const s = parsed.streams?.[0];
        const duration = Number(parsed.format?.duration);
        return {
            width: s?.width ?? 0,
            height: s?.height ?? 0,
            durationSec: Number.isFinite(duration) ? Math.round(duration * 100) / 100 : undefined,
        };
    }
    catch {
        return { width: 0, height: 0 };
    }
    finally {
        await node_fs_1.default.promises.unlink(tmp).catch(() => { });
    }
}
/**
 * Object key.
 *
 * Partitioned by org so one tenant's prefix is never another's, and named with
 * a random id rather than the uploaded filename — the original name is kept in
 * the row, where it cannot collide, be guessed, or carry a path separator.
 */
function storageKey(orgId, ext) {
    return `${orgId}/${node_crypto_1.default.randomUUID()}.${ext}`;
}
/**
 * Upload the object, then record it.
 *
 * In that order, and with the row removed if the insert fails: an orphaned
 * object costs storage, but an orphaned row points the Studio at a file that is
 * not there, which surfaces as a broken render much later and much less
 * obviously.
 */
async function putMedia(sb, args) {
    const key = storageKey(args.orgId, args.type.ext);
    const up = await sb.storage.from(exports.BUCKET).upload(key, args.bytes, {
        contentType: args.type.mime,
        upsert: false,
    });
    if (up.error)
        throw new Error(`Storage upload failed: ${up.error.message}`);
    const { data, error } = await sb
        .from("media_assets")
        .insert({
        org_id: args.orgId,
        storage_path: key,
        kind: args.type.kind,
        filename: args.filename,
        mime_type: args.type.mime,
        size_bytes: args.bytes.byteLength,
        width: args.dimensions.width || null,
        height: args.dimensions.height || null,
        project_id: args.projectId ?? null,
        uploaded_by: args.uploaderId,
        tags: args.tags ?? [],
    })
        .select("id, storage_path, kind, filename, mime_type, size_bytes, width, height, created_at")
        .single();
    if (error || !data) {
        // Do not leave the object behind pointing at nothing.
        await sb.storage.from(exports.BUCKET).remove([key]).catch(() => { });
        throw new Error(`Could not record the upload: ${error?.message ?? "no row returned"}`);
    }
    return {
        id: data.id,
        storagePath: data.storage_path,
        kind: data.kind,
        filename: data.filename,
        mimeType: data.mime_type,
        sizeBytes: Number(data.size_bytes ?? 0),
        width: Number(data.width ?? 0),
        height: Number(data.height ?? 0),
        createdAt: data.created_at,
    };
}
/**
 * A time-limited read URL. The bucket is private, so this is the only way the
 * browser (or a platform API fetching the file) can read the object, and the
 * link stops working when it expires.
 */
async function signedUrl(sb, storagePath, expiresInSeconds = 3600) {
    const { data, error } = await sb.storage.from(exports.BUCKET).createSignedUrl(storagePath, expiresInSeconds);
    return error ? null : data.signedUrl;
}
async function listMedia(sb, orgId, limit = 100) {
    const { data, error } = await sb
        .from("media_assets")
        .select("id, storage_path, kind, filename, mime_type, size_bytes, width, height, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error)
        throw error;
    return (data ?? []).map((d) => ({
        id: d.id,
        storagePath: d.storage_path,
        kind: d.kind,
        filename: d.filename,
        mimeType: d.mime_type,
        sizeBytes: Number(d.size_bytes ?? 0),
        width: Number(d.width ?? 0),
        height: Number(d.height ?? 0),
        createdAt: d.created_at,
    }));
}
