"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rememberSentMessage = rememberSentMessage;
exports.isOwnSentMessage = isOwnSentMessage;
exports.sendEvolutionText = sendEvolutionText;
exports.sendEvolutionMedia = sendEvolutionMedia;
exports.fetchEvolutionMedia = fetchEvolutionMedia;
exports.evolutionConnectionState = evolutionConnectionState;
exports.deliverToEvolution = deliverToEvolution;
const env_1 = require("../env");
const format_1 = require("../whatsapp/format");
/**
 * Evolution API sender — the unofficial transport.
 *
 * Evolution drives a normal WhatsApp account over the Web protocol, so there
 * are no templates, no 24-hour window and no per-message fees. The flip side
 * is that interactive buttons are unreliable on this protocol (Meta half-
 * removed them from WhatsApp Web), so anything with options degrades to a
 * numbered text menu here rather than risking a message that renders blank on
 * the customer's phone.
 *
 * Every function throws on failure, same contract as the Meta client: the
 * agent must never believe a message was delivered when it was not.
 */
/**
 * IDs of messages this process has sent through Evolution.
 *
 * WhatsApp echoes our own outbound messages back through the same
 * messages.upsert webhook. In a normal customer chat those carry fromMe=true
 * and are easy to skip — but in a "message yourself" chat (testing on the
 * linked number) the customer's own messages ALSO carry fromMe=true, so
 * fromMe alone cannot tell an agent reply from a real question. Matching on the
 * id we got back when we sent can: it is unambiguous in every chat type.
 *
 * Bounded so a long-running process cannot grow this without limit.
 */
const sentMessageIds = new Set();
const SENT_ID_CAP = 1000;
function rememberSentMessage(id) {
    if (!id)
        return;
    if (sentMessageIds.size >= SENT_ID_CAP) {
        // Drop the oldest ~10% in insertion order.
        const drop = Math.floor(SENT_ID_CAP * 0.1);
        let i = 0;
        for (const k of sentMessageIds) {
            sentMessageIds.delete(k);
            if (++i >= drop)
                break;
        }
    }
    sentMessageIds.add(id);
}
function isOwnSentMessage(id) {
    return id ? sentMessageIds.has(id) : false;
}
function base() {
    const url = env_1.env.evolutionApiUrl;
    if (!/^https?:\/\//.test(url)) {
        throw new Error("EVOLUTION_API_URL must start with http:// or https://");
    }
    return url;
}
async function post(path, payload) {
    const response = await fetch(`${base()}${path}`, {
        method: "POST",
        headers: { apikey: env_1.env.evolutionApiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Evolution send failed (${response.status}): ${detail.slice(0, 400)}`);
    }
    return (await response.json().catch(() => ({})));
}
/** Digits only, international format — same rule as the Meta client. */
function recipient(to) {
    const digits = to.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
        throw new Error("WhatsApp recipient must be an international number in digits");
    }
    return digits;
}
async function sendEvolutionText(to, body) {
    const result = await post(`/message/sendText/${env_1.env.evolutionInstance}`, {
        number: recipient(to),
        text: (0, format_1.toWhatsApp)(body).slice(0, 4096),
        linkPreview: false,
    });
    rememberSentMessage(result.key?.id);
    return { messageId: result.key?.id ?? null };
}
function mediaTypeFor(kind) {
    if (kind === "image")
        return "image";
    if (kind === "video" || kind === "virtual_tour")
        return "video";
    return "document";
}
async function sendEvolutionMedia(to, url, kind, caption) {
    const link = new URL(url);
    if (link.protocol !== "https:" && link.protocol !== "http:") {
        throw new Error("Evolution media link must be http or https");
    }
    const mediatype = mediaTypeFor(kind);
    const result = await post(`/message/sendMedia/${env_1.env.evolutionInstance}`, {
        number: recipient(to),
        mediatype,
        media: link.href,
        ...(caption ? { caption: caption.slice(0, 1024) } : {}),
        ...(mediatype === "document" ? { fileName: `${kind.replace(/_/g, "-")}.pdf` } : {}),
    });
    rememberSentMessage(result.key?.id);
    return { messageId: result.key?.id ?? null };
}
/**
 * Downloads and decrypts a received media message (voice note, image).
 *
 * WhatsApp media arrives end-to-end encrypted; the Evolution server holds the
 * session keys, so it does the decryption and hands back plain base64.
 */
async function fetchEvolutionMedia(messageId) {
    try {
        const result = await post(`/chat/getBase64FromMediaMessage/${env_1.env.evolutionInstance}`, { message: { key: { id: messageId } }, convertToMp4: false });
        if (!result.base64)
            return null;
        return {
            bytes: Buffer.from(result.base64, "base64"),
            mimeType: result.mimetype ?? "audio/ogg",
        };
    }
    catch (e) {
        console.error("[evolution] media fetch failed", e);
        return null;
    }
}
/** "open" means the QR was scanned and the WhatsApp session is live. */
async function evolutionConnectionState() {
    const response = await fetch(`${base()}/instance/connectionState/${env_1.env.evolutionInstance}`, { headers: { apikey: env_1.env.evolutionApiKey } });
    if (!response.ok)
        throw new Error(`Evolution unreachable (${response.status})`);
    const json = (await response.json());
    return json.instance?.state ?? "unknown";
}
/**
 * The Evolution counterpart of deliverToWhatsApp — one AgentReply in, the
 * right Evolution call out. Options become a numbered menu (see module note).
 */
async function deliverToEvolution(to, reply) {
    if (reply.options?.length) {
        const body = reply.text ?? "Please choose:";
        const numbered = reply.options.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
        await sendEvolutionText(to, `${body}\n\n${numbered}\n\nReply with a number.`);
        return;
    }
    if (reply.mediaUrl && reply.mediaKind) {
        await sendEvolutionMedia(to, reply.mediaUrl, reply.mediaKind, reply.caption);
        return;
    }
    if (reply.text)
        await sendEvolutionText(to, reply.text);
}
