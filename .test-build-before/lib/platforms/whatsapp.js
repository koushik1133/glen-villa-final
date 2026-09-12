"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsapp = exports.TOO_LARGE_ERROR = void 0;
exports.fetchWhatsAppMedia = fetchWhatsAppMedia;
exports.isWithinServiceWindow = isWithinServiceWindow;
exports.sendWhatsApp = sendWhatsApp;
exports.parseWebhook = parseWebhook;
exports.parseStatuses = parseStatuses;
const storage_1 = require("../ops/storage");
const types_1 = require("./types");
/**
 * WHATSAPP CLOUD API
 *
 * WhatsApp is not a publishing channel — you cannot post to a feed. It is a
 * conversation channel, and it has one rule that dominates every integration:
 *
 *   **The 24-hour customer service window.** You may send free-form messages
 *   only within 24 hours of the customer's last message. Outside that window,
 *   the only thing that delivers is a pre-approved *template*. Getting this
 *   wrong is the single most common reason WhatsApp integrations silently fail,
 *   so `sendMessage` enforces it rather than letting Meta reject the call.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;
const KNOWN_TYPES = [
    "text", "image", "audio", "video", "sticker", "document", "location", "interactive", "button",
    "reaction", "system", "unsupported",
];
/** Same wording validateUpload uses, so one regex in the agent covers both paths. */
exports.TOO_LARGE_ERROR = `File is larger than ${Math.round(storage_1.MAX_DOCUMENT_BYTES / 1024 / 1024)}MB`;
/**
 * Download inbound media from the Graph API: the webhook only carries an id,
 * and the id resolves to a short-lived URL that itself needs the token.
 * Returns null in mock mode, without a token, or on any failure — the caller
 * tells the customer we could not retrieve the file rather than guessing.
 */
async function fetchWhatsAppMedia(mediaId, token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_SYSTEM_USER_TOKEN, hint = {}) {
    if (!mediaId || !token || types_1.DRIVER !== "live")
        return null;
    try {
        const meta = await fetch(`https://graph.facebook.com/${(0, types_1.graphVersion)()}/${mediaId}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
        });
        if (!meta.ok)
            return null;
        const info = (await meta.json());
        if (!info.url)
            return null;
        // Strip codec parameters ("audio/ogg; codecs=opus") so the store sees a bare type.
        const mimeType = (info.mime_type ?? hint.mimeType ?? "application/octet-stream").split(";")[0].trim();
        const ext = mimeType === "application/pdf" ? "pdf" : (mimeType.split("/")[1] ?? "bin");
        const safeName = hint.filename?.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filename = safeName || `whatsapp-${mediaId}.${ext}`;
        // WhatsApp allows documents up to 100MB while the store caps at 15MB.
        // Refuse from the metadata (and again from Content-Length) BEFORE buffering
        // the body: this runs on every webhook delivery, retries included, and the
        // file would only be thrown away by validateUpload afterwards.
        const tooLarge = { data: Buffer.alloc(0), mimeType, filename, error: exports.TOO_LARGE_ERROR };
        if (Number(info.file_size) > storage_1.MAX_DOCUMENT_BYTES)
            return tooLarge;
        const bin = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
        if (!bin.ok)
            return null;
        if (Number(bin.headers.get("content-length")) > storage_1.MAX_DOCUMENT_BYTES) {
            await bin.body?.cancel().catch(() => { });
            return tooLarge;
        }
        return { data: Buffer.from(await bin.arrayBuffer()), mimeType, filename };
    }
    catch {
        return null;
    }
}
function isWithinServiceWindow(lastInboundAt) {
    if (!lastInboundAt)
        return false;
    return Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;
}
async function sendWhatsApp(opts) {
    const inWindow = isWithinServiceWindow(opts.lastInboundAt);
    if (!inWindow && !opts.template) {
        return {
            ok: false,
            requiresTemplate: true,
            error: "Outside the 24-hour service window — send an approved template instead of free text.",
        };
    }
    /**
     * Explicit test seam.
     *
     * The suites that exercise the agent — "did it tell the customer why the
     * document was rejected", "does it answer the message in front of it" — are
     * about what the agent SAYS, not about whether Meta accepted it. They need a
     * transport that succeeds without a network. That is a different thing from
     * the mock driver quietly reporting success to a real operator, so it is a
     * separate, explicitly named switch that only tests/helpers.ts sets. Nothing
     * in a running deployment turns it on by accident.
     */
    if (process.env.WHATSAPP_TRANSPORT === "stub") {
        return { ok: true, messageId: `wamid.stub${Math.random().toString(36).slice(2, 10)}` };
    }
    if (types_1.DRIVER === "mock") {
        /**
         * Fail, do not pretend.
         *
         * This returned `ok: true` with a fabricated `wamid.mock…`. The caller in
         * src/lib/ops/agent.ts takes that success and marks the reply delivered, so
         * a customer who never received anything showed in the inbox as answered —
         * and a follow-up that never went out was recorded as sent. A message that
         * was not transmitted is a failure with a reason.
         */
        return {
            ok: false,
            error: 'WhatsApp is running with PLATFORM_DRIVER="mock", so nothing was sent. ' +
                "Set PLATFORM_DRIVER=live to deliver messages.",
        };
    }
    const body = opts.template
        ? {
            messaging_product: "whatsapp",
            to: opts.to,
            type: "template",
            template: {
                name: opts.template.name,
                language: { code: opts.template.language },
                ...(opts.template.params?.length
                    ? { components: [{ type: "body", parameters: opts.template.params.map((t) => ({ type: "text", text: t })) }] }
                    : {}),
            },
        }
        : { messaging_product: "whatsapp", to: opts.to, type: "text", text: { preview_url: false, body: opts.text ?? "" } };
    try {
        const res = await fetch(`https://graph.facebook.com/${(0, types_1.graphVersion)()}/${opts.phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = (await res.json());
        if (!res.ok)
            return { ok: false, error: json.error?.message ?? `WhatsApp ${res.status}` };
        return { ok: true, messageId: json.messages?.[0]?.id };
    }
    catch (e) {
        return { ok: false, error: e.message };
    }
}
/**
 * Normalise an inbound webhook payload.
 *
 * Meta nests this four levels deep and delivers status callbacks (sent/read)
 * through the same endpoint as real messages, so the filter matters: without it
 * every delivery receipt would appear in the inbox as an empty conversation.
 */
function parseWebhook(payload) {
    const out = [];
    const body = payload;
    for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
            const value = change?.value;
            if (!Array.isArray(value?.messages))
                continue; // status callbacks arrive here too — ignore them
            for (const m of value.messages) {
                if (!m || typeof m.id !== "string" || typeof m.from !== "string")
                    continue;
                const contact = value.contacts?.find((c) => c.wa_id === m.from);
                const media = m.image ?? m.document ?? m.video ?? m.audio ?? m.sticker;
                const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
                const type = KNOWN_TYPES.includes(m.type) ? m.type : "unknown";
                out.push({
                    id: m.id,
                    from: m.from,
                    name: contact?.profile?.name,
                    // A caption is the customer's own words about the file; keep it as
                    // the body so intent extraction sees it. Otherwise a placeholder.
                    text: m.text?.body ??
                        reply?.title ??
                        m.button?.text ??
                        m.image?.caption ??
                        m.document?.caption ??
                        m.video?.caption ??
                        (m.location ? `[location] ${m.location.name ?? ""} ${m.location.address ?? ""}`.trim() : undefined) ??
                        (m.reaction ? `[reaction] ${m.reaction.emoji ?? ""}`.trim() : undefined) ??
                        `[${m.type}]`,
                    // Guarded exactly as parseStatuses guards its own: `Number(undefined)`
                    // is NaN and `new Date(NaN).toISOString()` THROWS. This function is
                    // called straight out of the webhook handler with no try/catch, so a
                    // single message missing a timestamp turned into a 500 — and Meta
                    // answers a 500 by redelivering the whole batch, on a schedule, for
                    // hours. A missing clock is worth "now", not an outage.
                    timestamp: Number.isFinite(Number(m.timestamp) * 1000) && Number(m.timestamp) > 0
                        ? new Date(Number(m.timestamp) * 1000).toISOString()
                        : new Date().toISOString(),
                    type,
                    mediaId: media?.id,
                    mimeType: media?.mime_type,
                    filename: m.document?.filename,
                    location: m.location,
                    interactive: reply
                        ? { id: reply.id, title: reply.title }
                        : m.button
                            ? { id: m.button.payload, title: m.button.text ?? "" }
                            : undefined,
                });
            }
        }
    }
    return out;
}
/**
 * WhatsApp appears in the channel registry so it shows up in Connections and
 * the Engagement inbox, but publishing is intentionally rejected — there is no
 * feed to post to, and pretending otherwise would produce a broken UI affordance.
 */
exports.whatsapp = {
    channel: "whatsapp",
    label: "WhatsApp",
    color: "#25D366",
    capabilities: {
        formats: [],
        captionLimit: 4096,
        hashtagLimit: 0,
        maxMedia: 1,
        supportsStories: false,
        supportsFirstComment: false,
        supportsNativeScheduling: false,
        supportsStickers: false,
        videoMaxSec: {},
        aspectRatios: {},
    },
    validate: () => ["WhatsApp is a conversation channel — reply from the Engagement inbox, not the composer."],
    publish: async () => ({
        ok: false,
        error: "WhatsApp has no feed to publish to. Use the Engagement inbox or a template broadcast.",
        retryable: false,
    }),
    rateLimit: async () => ({ used: 0, quota: 1000, windowHours: 24 }),
};
/**
 * Receipts arrive through the same webhook as messages, under `statuses`.
 * Unknown status values are dropped rather than stored as free text.
 */
function parseStatuses(payload) {
    const out = [];
    const body = payload;
    for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
            for (const s of Array.isArray(change?.value?.statuses) ? change.value.statuses : []) {
                if (!s?.id)
                    continue;
                if (!["sent", "delivered", "read", "failed"].includes(s.status))
                    continue;
                const err = s.errors?.[0];
                const ms = Number(s.timestamp) * 1000;
                out.push({
                    messageId: s.id,
                    status: s.status,
                    recipient: s.recipient_id,
                    timestamp: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString(),
                    error: err ? (err.title ?? err.message ?? (err.code != null ? `error ${err.code}` : undefined)) : undefined,
                });
            }
        }
    }
    return out;
}
