"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_ORDER = exports.AD_CHANNELS = void 0;
exports.adapterFor = adapterFor;
exports.contentAdapters = contentAdapters;
exports.channelMeta = channelMeta;
exports.isUsableConnection = isUsableConnection;
exports.connectionProblem = connectionProblem;
const meta_1 = require("./meta");
const others_1 = require("./others");
const whatsapp_1 = require("./whatsapp");
const adapters = {
    instagram: meta_1.instagram,
    facebook: meta_1.facebook,
    tiktok: others_1.tiktok,
    youtube: others_1.youtube,
    linkedin: others_1.linkedin,
    x: others_1.x,
    google_business: others_1.googleBusiness,
    whatsapp: whatsapp_1.whatsapp,
};
function adapterFor(channel) {
    return adapters[channel];
}
function contentAdapters() {
    return Object.values(adapters);
}
/** Presentation metadata for ad channels, which have no publish path. */
exports.AD_CHANNELS = {
    meta_ads: { label: "Meta Ads", color: "#0866FF" },
    google_ads: { label: "Google Ads", color: "#FBBC04" },
};
function channelMeta(channel) {
    const a = adapters[channel];
    if (a)
        return { label: a.label, color: a.color };
    return exports.AD_CHANNELS[channel] ?? { label: channel, color: "#64748b" };
}
exports.CHANNEL_ORDER = [
    "instagram",
    "facebook",
    "tiktok",
    "youtube",
    "linkedin",
    "x",
    "google_business",
    "whatsapp",
    "meta_ads",
    "google_ads",
];
/**
 * Is this connection actually usable?
 *
 * `status === "connected"` was trusted everywhere — the Connections screen, the
 * per-channel tabs, the retrieval sync and the WhatsApp send path all keyed off
 * it alone. A row can carry that status with no access token at all (two did:
 * Instagram and YouTube, written outside the OAuth callback), and every one of
 * those surfaces then reported a live integration that could not publish, fetch
 * a metric or send a message. A channel is connected when it holds a credential
 * that can act, not when a string says so.
 */
function isUsableConnection(c) {
    if (c.status !== "connected")
        return false;
    if (c.accessToken?.trim())
        return true;
    // Upload-Post-backed rows carry no token of their own; the API key publishes.
    if (c.externalId?.startsWith("uploadpost:") && Boolean(process.env.UPLOAD_POST_API_KEY?.trim())) {
        return true;
    }
    if ((c.channel === "youtube" || c.channel === "instagram") && Boolean(process.env.UPLOAD_POST_API_KEY?.trim())) {
        return true;
    }
    return false;
}
/** Why a connection that claims to be connected cannot actually be used. */
function connectionProblem(c) {
    if (c.status !== "connected")
        return null;
    if (!c.accessToken?.trim()) {
        if (c.externalId?.startsWith("uploadpost:")) {
            return process.env.UPLOAD_POST_API_KEY?.trim() ? null : "The publishing connector is not configured — this channel publishes through it.";
        }
        if ((c.channel === "youtube" || c.channel === "instagram") && Boolean(process.env.UPLOAD_POST_API_KEY?.trim())) {
            return null;
        }
        return "No access token stored — reconnect this channel to publish or read metrics.";
    }
    return null;
}
