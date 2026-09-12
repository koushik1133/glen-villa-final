"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRIVER = void 0;
exports.graphVersion = graphVersion;
exports.baseValidate = baseValidate;
exports.mockPublish = mockPublish;
/**
 * The driver, resolved once and fail-closed.
 *
 * This was an unchecked cast of the raw env var, and every call site then asked
 * `DRIVER === "mock" ? mock : live`. Those two facts together meant anything
 * that was not exactly the string "mock" selected the LIVE path — including the
 * empty string, which `?? "mock"` does not catch because it is not nullish, and
 * including "Live", "LIVE" and any typo. A blank or misspelled PLATFORM_DRIVER
 * therefore published real posts to real accounts.
 *
 * Live is now opt-in by exact match and everything else degrades to mock, so the
 * failure mode of a misconfiguration is "nothing was published" rather than
 * "something was published that nobody intended".
 */
exports.DRIVER = process.env.PLATFORM_DRIVER?.trim().toLowerCase() === "live" ? "live" : "mock";
function graphVersion() {
    return process.env.META_GRAPH_VERSION ?? "v23.0";
}
/** Shared validation used by every adapter before its own extra rules. */
function baseValidate(req, caps, label) {
    const errors = [];
    const full = [req.caption, ...req.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))].join(" ").trim();
    if (!caps.formats.includes(req.format)) {
        errors.push(`${label} does not support ${req.format} posts.`);
    }
    if (full.length > caps.captionLimit) {
        errors.push(`${label} caption is ${full.length} chars, limit is ${caps.captionLimit}.`);
    }
    if (req.hashtags.length > caps.hashtagLimit) {
        errors.push(`${label} allows ${caps.hashtagLimit} hashtags, you have ${req.hashtags.length}.`);
    }
    if (req.mediaUrls.length > caps.maxMedia) {
        errors.push(`${label} accepts ${caps.maxMedia} media items, you attached ${req.mediaUrls.length}.`);
    }
    if (req.format !== "text" && req.mediaUrls.length === 0) {
        errors.push(`${label} ${req.format} posts need at least one media file.`);
    }
    if (req.stickers?.length && !caps.supportsStickers) {
        errors.push(`${label} does not support interactive stickers.`);
    }
    return errors;
}
/**
 * The not-live publish path. Every adapter falls back to it, and it always fails.
 *
 * Nothing leaves the process here, so returning success would mean inventing the
 * external id and permalink that a real publish returns — and that invention does
 * not stay local. The target is recorded as published, the calendar shows the post
 * as out, analytics counts it, and the permalink leads nowhere. A failure is the
 * only result that matches what actually happened.
 *
 * The failure is permanent by construction: no number of attempts turns a missing
 * credential or a missing adapter into a published post. Marking it retryable would
 * only spend the publisher's backoff budget and bury the real cause under four
 * identical errors, so `retryable` is false and the message names the one thing an
 * operator has to change.
 */
function mockPublish(channel, req) {
    const account = req.connection.handle ? ` as ${req.connection.handle}` : "";
    const reason = exports.DRIVER === "live"
        ? `this build has no live ${channel} API integration, so it cannot publish even with PLATFORM_DRIVER=live`
        : `publishing is running with PLATFORM_DRIVER="${exports.DRIVER}" — set PLATFORM_DRIVER=live and configure ${channel} API credentials, then re-queue this post`;
    return {
        ok: false,
        error: `Nothing was sent to ${channel}${account}: ${reason}.`,
        retryable: false,
    };
}
