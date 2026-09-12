"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPhoneInfo = fetchPhoneInfo;
exports.whatsappHealth = whatsappHealth;
const db_1 = require("../db");
const provider_1 = require("../ai/provider");
const types_1 = require("./types");
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
async function fetchPhoneInfo(phoneNumberId, token = process.env.META_SYSTEM_USER_TOKEN, now = Date.now()) {
    if (!phoneNumberId || !token)
        return null;
    const hit = cache.get(phoneNumberId);
    if (hit && now - hit.at < CACHE_MS)
        return hit.value;
    let value;
    try {
        const fields = "display_phone_number,verified_name,quality_rating,name_status,code_verification_status";
        const res = await fetch(`https://graph.facebook.com/${(0, types_1.graphVersion)()}/${phoneNumberId}?fields=${fields}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5_000),
        });
        const json = (await res.json());
        value = res.ok
            ? {
                displayNumber: json.display_phone_number,
                verifiedName: json.verified_name,
                qualityRating: json.quality_rating,
                nameStatus: json.name_status,
                verificationStatus: json.code_verification_status,
            }
            : { error: json.error?.message ?? `Graph ${res.status}` };
    }
    catch (e) {
        value = { error: e.message };
    }
    cache.set(phoneNumberId, { at: now, value });
    return value;
}
async function whatsappHealth() {
    const set = (k) => Boolean(process.env[k]?.trim());
    const db = (0, db_1.read)();
    const conn = db.connections.find((c) => c.channel === "whatsapp");
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || conn?.externalId || "";
    const lastInbound = db.opsMessages
        .filter((m) => m.channel === "whatsapp" && m.direction === "inbound")
        .reduce((best, m) => (!best || m.createdAt > best ? m.createdAt : best), null);
    return {
        phoneNumberId,
        phone: await fetchPhoneInfo(phoneNumberId),
        verifyTokenSet: set("WHATSAPP_VERIFY_TOKEN"),
        appSecretSet: set("META_APP_SECRET"),
        tokenSet: set("META_SYSTEM_USER_TOKEN"),
        publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() ?? "",
        lastInboundAt: lastInbound,
        aiWriterReady: (0, provider_1.activeProvider)() !== null,
    };
}
