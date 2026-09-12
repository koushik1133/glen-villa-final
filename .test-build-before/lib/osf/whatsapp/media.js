"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadMedia = downloadMedia;
exports.transcriptionConfigured = transcriptionConfigured;
exports.transcribeAudio = transcribeAudio;
exports.transcribeVoiceNote = transcribeVoiceNote;
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const env_1 = require("../env");
/**
 * Inbound media: WhatsApp voice notes and images.
 *
 * WhatsApp never sends the file itself on the webhook — only a media id. The
 * bytes take two authenticated calls: id → a short-lived CDN URL, then that URL
 * → the file. Both need the access token; the CDN URL is NOT public.
 *
 * Voice notes matter more here than anywhere else: Indian buyers send them
 * constantly, and without transcription the agent sees "[a voice note]" and can
 * only ask the customer to type it out, which reads as broken.
 */
const GRAPH = "https://graph.facebook.com";
/** Voice notes are short; this is a sanity ceiling, not a real limit. */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
async function mediaMeta(mediaId) {
    const res = await fetch(`${GRAPH}/${env_1.env.whatsappApiVersion}/${mediaId}`, {
        headers: { Authorization: `Bearer ${env_1.env.whatsappAccessToken}` },
    });
    if (!res.ok) {
        throw new Error(`Media lookup failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json());
}
/** Fetches the bytes for a WhatsApp media id. */
async function downloadMedia(mediaId) {
    const meta = await mediaMeta(mediaId);
    if (meta.file_size && meta.file_size > MAX_MEDIA_BYTES) {
        throw new Error(`Media too large: ${meta.file_size} bytes`);
    }
    // The CDN URL is signed and expires, and still requires the bearer token.
    const res = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${env_1.env.whatsappAccessToken}` },
    });
    if (!res.ok)
        throw new Error(`Media download failed (${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES)
        throw new Error("Media too large");
    return { bytes, mimeType: meta.mime_type ?? "application/octet-stream" };
}
// -----------------------------------------------------------------------------
// Transcription
// -----------------------------------------------------------------------------
let groq = null;
function groqClient() {
    if (!groq)
        groq = new groq_sdk_1.default({ apiKey: env_1.env.groqApiKey });
    return groq;
}
/**
 * Whisper on Groq. Uses the same GROQ_API_KEY the chat agent already has, so
 * voice works with no additional vendor account — which is why this is
 * hardcoded to Groq rather than following LLM_PROVIDER. Anthropic has no
 * speech-to-text endpoint, so switching the chat provider must not switch this.
 */
function transcriptionConfigured() {
    return Boolean((0, env_1.optional)("GROQ_API_KEY"));
}
async function transcribeAudio(bytes, mimeType) {
    // WhatsApp voice notes are OGG/Opus. Whisper infers format from the filename
    // extension, so a wrong one silently degrades quality — map it explicitly.
    const ext = mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("mp4") || mimeType.includes("m4a")
            ? "m4a"
            : mimeType.includes("mpeg") || mimeType.includes("mp3")
                ? "mp3"
                : mimeType.includes("wav")
                    ? "wav"
                    : "ogg";
    const file = new File([new Uint8Array(bytes)], `voice.${ext}`, { type: mimeType });
    const result = await groqClient().audio.transcriptions.create({
        file,
        model: (0, env_1.optional)("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo"),
        // Left unset on purpose: forcing a language would mangle the Hindi,
        // Telugu and code-mixed notes this project actually receives. Whisper
        // detects it, and the agent replies in whatever language comes back.
        response_format: "verbose_json",
    });
    const r = result;
    return { text: (r.text ?? "").trim(), language: r.language };
}
/**
 * Full inbound-voice path: media id → bytes → text.
 *
 * Returns null rather than throwing so a failed transcription degrades to the
 * agent asking the customer to type, instead of dropping the message entirely.
 */
async function transcribeVoiceNote(mediaId) {
    try {
        const { bytes, mimeType } = await downloadMedia(mediaId);
        const transcript = await transcribeAudio(bytes, mimeType);
        return transcript.text ? transcript : null;
    }
    catch (e) {
        console.error("[whatsapp] voice transcription failed", e);
        return null;
    }
}
