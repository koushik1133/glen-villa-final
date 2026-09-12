"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsafeUrlError = void 0;
exports.isBlockedAddress = isBlockedAddress;
exports.assertSendableMediaUrl = assertSendableMediaUrl;
const promises_1 = require("node:dns/promises");
const node_net_1 = require("node:net");
const supabase_1 = require("../supabase");
const env_1 = require("../env");
/**
 * Egress allowlist for URLs the agent hands to a third party.
 *
 * The only link that should ever reach WhatsApp is one an operator put in
 * `villa_assets` and left shareable, one of the two configured asset URLs, or
 * something on the app's own origin. The system prompt already says as much —
 * but the model picks that argument, and a customer message can steer the
 * model, so the prompt is not a boundary. This module is: it re-derives the
 * allowlist from the app's own data and applies it to whatever the model
 * actually passed.
 */
class UnsafeUrlError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnsafeUrlError";
    }
}
exports.UnsafeUrlError = UnsafeUrlError;
function isProduction() {
    return process.env.NODE_ENV === "production";
}
// -----------------------------------------------------------------------------
// Address ranges
// -----------------------------------------------------------------------------
function isBlockedV4(address) {
    const octets = address.split(".");
    if (octets.length !== 4)
        return true;
    const parts = octets.map((o) => (/^\d{1,3}$/.test(o) ? Number(o) : NaN));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
        return true;
    const [a, b] = parts;
    if (a === 0)
        return true; // 0.0.0.0/8 — routes to the local host on Linux
    if (a === 10)
        return true; // 10/8
    if (a === 127)
        return true; // 127/8 loopback
    if (a === 169 && b === 254)
        return true; // 169.254/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31)
        return true; // 172.16/12
    if (a === 192 && b === 168)
        return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127)
        return true; // 100.64/10 carrier NAT
    if (a >= 224)
        return true; // multicast and reserved
    return false;
}
/** Expands an IPv6 literal to eight 16-bit groups, or null if unparseable. */
function expandV6(address) {
    let literal = address;
    // A trailing dotted-quad ("::ffff:10.0.0.1") occupies the last two groups.
    const dotted = literal.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) {
        const nums = dotted[1].split(".").map(Number);
        if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
            return null;
        const hi = ((nums[0] << 8) | nums[1]).toString(16);
        const lo = ((nums[2] << 8) | nums[3]).toString(16);
        literal = `${literal.slice(0, -dotted[1].length)}${hi}:${lo}`;
    }
    const halves = literal.split("::");
    if (halves.length > 2)
        return null;
    const split = (part) => (part === "" ? [] : part.split(":"));
    const head = split(halves[0]);
    const tail = halves.length === 2 ? split(halves[1]) : [];
    const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
    if (fill < 0)
        return null;
    const all = [...head, ...Array(fill).fill("0"), ...tail];
    if (all.length !== 8)
        return null;
    const out = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    return out.some((n) => !Number.isInteger(n)) ? null : out;
}
function isBlockedV6(address) {
    // Strip a zone id ("fe80::1%eth0") and any bracket form.
    const literal = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
    const groups = expandV6(literal);
    if (!groups)
        return true;
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible inherit the v4 verdict.
    if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
        const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
        if (groups[6] !== 0 || groups[7] > 1)
            return isBlockedV4(v4);
    }
    if (groups.every((g) => g === 0))
        return true; // ::
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1)
        return true; // ::1
    if ((groups[0] & 0xfe00) === 0xfc00)
        return true; // fc00::/7 unique local
    if ((groups[0] & 0xffc0) === 0xfe80)
        return true; // fe80::/10 link-local
    return false;
}
/** True for loopback, private, link-local, CGNAT, multicast and unparseable. */
function isBlockedAddress(address) {
    const family = (0, node_net_1.isIP)(address);
    if (family === 4)
        return isBlockedV4(address);
    if (family === 6)
        return isBlockedV6(address);
    return true;
}
/**
 * Rejects a host that resolves anywhere private.
 *
 * Every A and AAAA record is checked, not just the first, so a name that
 * rebinds between a public and an internal address never passes. Note this is
 * defence in depth rather than the primary control: the fetch is performed by
 * Meta's servers, not ours, so the allowlist below is what actually contains
 * the blast radius.
 */
async function assertResolvesPublic(hostname) {
    if ((0, node_net_1.isIP)(hostname)) {
        if (isBlockedAddress(hostname)) {
            throw new UnsafeUrlError("that address is not publicly routable");
        }
        return;
    }
    let records;
    try {
        records = await (0, promises_1.lookup)(hostname, { all: true, verbatim: true });
    }
    catch {
        throw new UnsafeUrlError("that host could not be resolved");
    }
    if (records.length === 0)
        throw new UnsafeUrlError("that host could not be resolved");
    for (const record of records) {
        if (isBlockedAddress(record.address)) {
            throw new UnsafeUrlError("that host resolves to a private address");
        }
    }
}
// -----------------------------------------------------------------------------
// Allowlist
// -----------------------------------------------------------------------------
function sameOrigin(url, base) {
    try {
        return url.origin === new URL(base).origin;
    }
    catch {
        return false;
    }
}
function sameUrl(url, candidate) {
    try {
        return new URL(candidate).href === url.href;
    }
    catch {
        return false;
    }
}
/**
 * Where this URL is approved from, or null if it is approved nowhere.
 *
 * Throws rather than returning null when the lookup itself fails: an
 * unreachable database must not degrade into "send whatever the model said".
 */
async function allowlistSource(url, raw) {
    if (sameOrigin(url, env_1.env.appUrl))
        return "app_origin";
    for (const configured of [env_1.env.brochureUrl, env_1.env.projectMapsUrl]) {
        if (configured && sameUrl(url, configured))
            return "env_asset";
    }
    const candidates = Array.from(new Set([raw, url.href]));
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_assets")
        .select("id")
        .in("url", candidates)
        // Both columns are operator controls, so both have to gate the send.
        // `shareable_by_ai` is the /admin toggle meaning "the agent may hand this
        // to a customer" (setAssetShareable in lib/permissions.ts); `is_current`
        // retires a superseded file. A URL the model saw earlier in the
        // conversation stays in its context after either is revoked, so matching on
        // the row alone would let a withdrawn price sheet still go out.
        .eq("is_current", true)
        .eq("shareable_by_ai", true)
        .limit(1);
    if (error)
        throw new UnsafeUrlError("the approved asset list could not be checked");
    return data && data.length > 0 ? "villa_assets" : null;
}
/**
 * Resolves the model's argument to an absolute URL.
 *
 * Assets are registered in villa_assets as app-relative paths (`/Brochure.pdf`
 * served from `public/`), so a leading slash is resolved against the app's own
 * origin — Graph needs an absolute link and will not accept a bare path.
 *
 * A "path" is only treated as one if it cannot be read as an authority. The
 * URL parser drops tab/CR/LF anywhere and treats `\` as `/`, so `//evil.com`
 * and `/\evil.com` would both resolve off-origin; both are rejected here.
 */
function toAbsolute(candidate) {
    if (!candidate.startsWith("/"))
        return new URL(candidate);
    const normalized = candidate.replace(/[\t\n\r]/g, "").replace(/\\/g, "/");
    if (normalized.startsWith("//")) {
        throw new UnsafeUrlError("that is not a valid asset path");
    }
    const resolved = new URL(candidate, env_1.env.appUrl);
    if (!sameOrigin(resolved, env_1.env.appUrl)) {
        throw new UnsafeUrlError("that is not a valid asset path");
    }
    return resolved;
}
/**
 * Validates a URL the model wants delivered, or throws `UnsafeUrlError`.
 *
 * Callers surface the message to the model as a tool error so it corrects
 * itself rather than telling the customer something was sent.
 */
async function assertSendableMediaUrl(raw) {
    if (typeof raw !== "string" || raw.trim() === "") {
        throw new UnsafeUrlError("no URL was supplied");
    }
    const candidate = raw.trim();
    let url;
    try {
        url = toAbsolute(candidate);
    }
    catch (e) {
        if (e instanceof UnsafeUrlError)
            throw e;
        throw new UnsafeUrlError("that is not a complete URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new UnsafeUrlError("only http and https links can be sent");
    }
    if (url.username || url.password) {
        throw new UnsafeUrlError("a link with embedded credentials cannot be sent");
    }
    const source = await allowlistSource(url, candidate);
    if (!source) {
        throw new UnsafeUrlError("that link is not an approved asset. Only send a URL that get_assets returned in this conversation.");
    }
    // Plain http is refused in production for anything on the open internet —
    // but not for the app's own origin, which a self-hosted deployment commonly
    // serves over http on a private network name the bridge reaches directly
    // (host.docker.internal, or loopback). This check ran BEFORE the source was
    // known, so such a deployment could not send its own brochure at all.
    if (url.protocol === "http:" && isProduction() && source !== "app_origin") {
        throw new UnsafeUrlError("only https links can be sent");
    }
    // The app's OWN origin is exempt from the public-resolution check, in every
    // environment.
    //
    // That check exists to stop a model being talked into pointing Meta at
    // internal infrastructure. It cannot do that here: `app_origin` means the URL
    // resolved against NEXT_PUBLIC_APP_URL, a value the operator configures and
    // no message can influence — the allowlist above is the real control, as the
    // note on assertResolvesPublic says.
    //
    // Enforcing it here was actively harmful. A self-hosted deployment reaches
    // its own assets on a name that is only meaningful to the machine fetching
    // them — `host.docker.internal` for a containerised WhatsApp bridge, or
    // loopback in development. Neither resolves from the app process, so every
    // brochure, layout and photo spent a DNS timeout and was then refused as
    // "that host could not be resolved". Measured: 80-115s per send, then the
    // customer was told the sales team would follow up.
    if (source !== "app_origin")
        await assertResolvesPublic(url.hostname);
    return { href: url.href, source };
}
