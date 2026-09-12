"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INBOUND_BUCKET = void 0;
exports.describeMedia = describeMedia;
exports.storeInboundMedia = storeInboundMedia;
exports.signInboundMedia = signInboundMedia;
const supabase_1 = require("../supabase");
/**
 * INBOUND MEDIA — keeping what the customer actually sent.
 *
 * Before this, a voice note was transcribed and the audio thrown away, an
 * image or document was reduced to its caption, and anything with no caption
 * at all was dropped on the floor before it reached the database. The
 * conversation record then disagreed with the customer's own phone, which is
 * the one place a dispute ever gets settled.
 *
 * Files go to a PRIVATE bucket. These are customers' identity documents and
 * voice recordings; a public bucket would make every one of them readable by
 * anyone who guessed the URL, forever. Reading them back goes through a signed
 * URL minted on demand for someone who has already passed the permission check.
 */
exports.INBOUND_BUCKET = "inbound-media";
/** Extensions we are willing to write. Anything else is stored without one. */
const EXT = {
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr",
    "audio/wav": "wav", "audio/webm": "webm",
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/3gpp": "3gp", "video/webm": "webm",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
};
function extensionFor(mimeType, filename) {
    const fromName = filename?.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
    return EXT[mimeType.split(";")[0].trim().toLowerCase()] ?? fromName ?? "bin";
}
/**
 * A human-readable line for the message body when the customer sent media with
 * no caption.
 *
 * The body is never left empty: an empty row renders as a gap in the thread and
 * reads as "nothing was said", when in fact a document arrived. For a voice
 * note the transcript is the body — this is only the fallback.
 */
function describeMedia(kind, filename) {
    switch (kind) {
        case "audio": return "[voice note]";
        case "image": return "[photo]";
        case "video": return "[video]";
        case "sticker": return "[sticker]";
        case "document": return filename ? `[document: ${filename}]` : "[document]";
    }
}
/**
 * Upload and return the object path to record on the message row.
 *
 * Returns null rather than throwing: losing the file is bad, but losing the
 * MESSAGE because the upload failed is worse. The caller stores the row either
 * way and the thread still shows that something arrived.
 */
async function storeInboundMedia(leadId, media) {
    try {
        const ext = extensionFor(media.mimeType, media.filename);
        // Partitioned by lead so one customer's files can be found — and removed —
        // together when they ask to be forgotten.
        const path = `${leadId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error } = await (0, supabase_1.db)()
            .storage.from(exports.INBOUND_BUCKET)
            .upload(path, media.bytes, { contentType: media.mimeType, upsert: false });
        if (error) {
            console.error("[inbound-media] upload failed", error.message);
            return null;
        }
        return path;
    }
    catch (e) {
        console.error("[inbound-media] upload threw", e);
        return null;
    }
}
/**
 * Short-lived signed URL for playback or download. Minted per request for a
 * caller that has already cleared the permission check, so a leaked link stops
 * working rather than standing open on a private document indefinitely.
 */
async function signInboundMedia(path, seconds = 300) {
    const { data, error } = await (0, supabase_1.db)()
        .storage.from(exports.INBOUND_BUCKET)
        .createSignedUrl(path, seconds);
    if (error) {
        console.error("[inbound-media] sign failed", error.message);
        return null;
    }
    return data?.signedUrl ?? null;
}
