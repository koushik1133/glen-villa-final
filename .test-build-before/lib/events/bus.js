"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDEMPOTENCY_TTL_MS = exports.ALL_EVENTS = exports.ORBIT_EVENTS = void 0;
exports.isGlentreeEvent = isGlentreeEvent;
exports.checkWebhookUrl = checkWebhookUrl;
exports.subscribers = subscribers;
exports.publicSubscribers = publicSubscribers;
exports.subscribersFor = subscribersFor;
exports.addSubscriber = addSubscriber;
exports.removeSubscriber = removeSubscriber;
exports.recentDeliveries = recentDeliveries;
exports.replayReceipt = replayReceipt;
exports.rememberReceipt = rememberReceipt;
exports.signBody = signBody;
exports.dispatch = dispatch;
exports.sendTestEvent = sendTestEvent;
exports.emit = emit;
const node_crypto_1 = require("node:crypto");
const node_net_1 = require("node:net");
const db_1 = require("../db");
const ids_1 = require("../ids");
/**
 * OUTBOUND EVENT BUS — the surface n8n (or any other automation runner) reacts to.
 *
 * The product already knows when something interesting happened; until now that
 * knowledge stayed inside the process. This publishes it: a signed JSON POST to
 * every URL an operator registered for that event, so a workflow can send the
 * WhatsApp confirmation, push the lead into a spreadsheet, or page a manager
 * without anything in this codebase knowing those workflows exist.
 *
 * The single rule that shapes every decision below: **a delivery must never be
 * able to fail the business action that triggered it.** A villa booking that
 * throws because somebody's n8n instance is down is a far worse outcome than a
 * missed automation. So `emit()` returns void, starts the work off the caller's
 * stack, and swallows everything — including a store that will not read.
 */
exports.ORBIT_EVENTS = [
    "appointment.booked",
    "appointment.rescheduled",
    "appointment.cancelled",
    "appointment.reminder_due",
    "lead.created",
    "lead.stage_changed",
    "post.published",
    "post.failed",
    "review.received",
    "message.received",
];
function isGlentreeEvent(v) {
    return typeof v === "string" && exports.ORBIT_EVENTS.includes(v);
}
/** Wildcard a subscriber can register instead of naming all ten events. */
exports.ALL_EVENTS = "*";
/* -------------------------------------------------------------------------- */
/* Delivery tuning                                                            */
/* -------------------------------------------------------------------------- */
/** A subscriber that has not answered in ten seconds is not going to. */
const TIMEOUT_MS = 10_000;
/**
 * Attempts per subscriber, including the first. Bounded on purpose: an
 * unbounded retry against an endpoint that is down turns one booking into an
 * open-ended background job, and n8n webhook nodes are cheap to re-trigger by
 * hand once the operator has fixed whatever broke.
 */
const MAX_ATTEMPTS = 3;
/** Backoff before attempt N (index 0 is the first attempt — no wait). */
const BACKOFF_MS = [0, 500, 2_000];
/** How many outbound records the operator's view keeps. */
const MAX_DELIVERY_LOG = 200;
/** Idempotency window for inbound actions. */
exports.IDEMPOTENCY_TTL_MS = 24 * 3600_000;
/**
 * Hard cap on stored inbound receipts, independent of the TTL. The TTL alone
 * bounds nothing: a caller can mint a fresh key on every request, so without a
 * ceiling the store grows for as long as the traffic lasts.
 */
const MAX_RECEIPTS = 2_000;
/* -------------------------------------------------------------------------- */
/* URL safety                                                                 */
/* -------------------------------------------------------------------------- */
/**
 * A stored subscriber URL is a server-side fetch target chosen by a user, which
 * is the exact shape of an SSRF: `http://169.254.169.254/…` in a config field
 * turns this bus into a cloud-metadata reader, and `http://127.0.0.1:4321/api/…`
 * turns it into a way to call our own routes from inside the trust boundary.
 *
 * KNOWN LIMIT: this inspects the literal host only — it does not resolve DNS,
 * so `internal.example.com` pointing at 127.0.0.1 still passes. Closing that
 * needs resolution plus a re-check after the connect (DNS can change between
 * the two), which is a networking-layer job. The literal check removes the
 * class of *pasted* internal addresses, which is what a config field actually
 * attracts — including the IPv6 spellings of an IPv4 address (`::ffff:7f00:1`,
 * NAT64 `64:ff9b::7f00:1`) that a prefix match on the dotted form misses.
 */
function checkWebhookUrl(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        return "That is not a valid URL.";
    }
    // https only. The payload carries buyer names and phone numbers, and the
    // signature proves authorship, not confidentiality — plaintext would put the
    // PII on the wire for anyone on the path.
    if (u.protocol !== "https:")
        return "The webhook URL must use https.";
    // Credentials in the URL end up in every log line that records the target.
    if (u.username || u.password)
        return "The webhook URL must not embed credentials.";
    // A trailing dot is the same name to the resolver (`localhost.` == `localhost`).
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (host === "localhost" ||
        host.endsWith(".localhost") ||
        // Reserved for private naming (RFC 6762 / cloud conventions) — never public.
        host.endsWith(".internal") ||
        isPrivateAddress(host)) {
        return "The webhook URL must not point at a private or loopback address.";
    }
    return null;
}
/** True when `host` is an IP literal in a loopback, link-local, private or CGNAT range. */
function isPrivateAddress(host) {
    const kind = (0, node_net_1.isIP)(host);
    if (kind === 4)
        return isPrivateV4(host);
    if (kind !== 6)
        return false;
    if (host === "::1" || host === "::")
        return true;
    // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host))
        return true;
    // An IPv4 carried inside IPv6 — IPv4-mapped (::ffff:a.b.c.d, which Node also
    // spells ::ffff:hex:hex) and NAT64 (64:ff9b::/96) — reaches the IPv4 host, so
    // it inherits the IPv4 verdict.
    const embedded = embeddedV4(host);
    return embedded !== null && isPrivateV4(embedded);
}
function isPrivateV4(ip) {
    const [a, b] = ip.split(".").map(Number);
    return (a === 0 || // 0.0.0.0/8 — "this host"
        a === 127 ||
        a === 10 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64.0.0/10
    );
}
/** Dotted IPv4 embedded in the low 32 bits of a mapped/NAT64 IPv6 literal, else null. */
function embeddedV4(host) {
    const m = /^(?:::ffff:|64:ff9b::)(.+)$/.exec(host);
    if (!m)
        return null;
    const tail = m[1];
    if ((0, node_net_1.isIP)(tail) === 4)
        return tail;
    // Two hex groups, e.g. `7f00:1` → 127.0.0.1.
    const groups = tail.split(":");
    if (groups.length !== 2 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)))
        return null;
    const [hi, lo] = groups.map((g) => parseInt(g, 16));
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}
/* -------------------------------------------------------------------------- */
/* Subscriber storage                                                         */
/* -------------------------------------------------------------------------- */
function subscribers() {
    return (0, db_1.read)().webhookSubscribers ?? [];
}
/** The list the API is allowed to return — secrets removed, never redacted in place. */
function publicSubscribers() {
    return subscribers().map(({ secret: _secret, ...rest }) => rest);
}
function subscribersFor(event) {
    return subscribers().filter((s) => s.active && (s.events.includes(exports.ALL_EVENTS) || s.events.includes(event)));
}
function addSubscriber(input) {
    const sub = {
        id: (0, ids_1.uid)("hook"),
        url: input.url,
        events: input.events,
        secret: input.secret,
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: input.createdBy,
        consecutiveFailures: 0,
    };
    (0, db_1.mutate)((d) => {
        d.webhookSubscribers = d.webhookSubscribers ?? [];
        d.webhookSubscribers.push(sub);
    });
    return sub;
}
function removeSubscriber(id) {
    return (0, db_1.mutate)((d) => {
        const list = (d.webhookSubscribers = d.webhookSubscribers ?? []);
        const i = list.findIndex((s) => s.id === id);
        if (i < 0)
            return false;
        list.splice(i, 1);
        return true;
    });
}
/* -------------------------------------------------------------------------- */
/* Delivery log                                                               */
/* -------------------------------------------------------------------------- */
/**
 * Trim the shared log. Outbound records are capped by count — an operator wants
 * the recent past, not the whole history. Inbound receipts are kept for their
 * TTL instead, because dropping one early is not a cosmetic loss: it re-arms an
 * action that was already performed.
 */
function pruneLog(list) {
    const now = Date.now();
    const out = [];
    const inbound = [];
    for (const e of list) {
        if (e.direction === "outbound")
            out.push(e);
        else if (Date.parse(e.expiresAt) > now)
            inbound.push(e);
    }
    return [
        ...out.slice(-MAX_DELIVERY_LOG),
        ...inbound.slice(-MAX_RECEIPTS),
    ];
}
function recordDelivery(record) {
    (0, db_1.mutate)((d) => {
        d.webhookDeliveries = pruneLog([...(d.webhookDeliveries ?? []), record]);
        const sub = (d.webhookSubscribers ?? []).find((s) => s.id === record.subscriberId);
        if (!sub)
            return;
        sub.lastAttemptAt = record.at;
        if (record.ok) {
            sub.lastSuccessAt = record.at;
            sub.consecutiveFailures = 0;
        }
        else {
            sub.consecutiveFailures += 1;
        }
    });
}
/** Newest first, outbound only — what actually fired and what failed. */
function recentDeliveries(limit = 50) {
    return ((0, db_1.read)().webhookDeliveries ?? [])
        .filter((e) => e.direction === "outbound")
        .slice(-limit)
        .reverse();
}
/* -------------------------------------------------------------------------- */
/* Inbound idempotency                                                        */
/* -------------------------------------------------------------------------- */
/**
 * The stored answer for a key, or undefined if this is the first time.
 *
 * Only *successful* actions are recorded (see `rememberReceipt`), so a caller
 * who sent a malformed payload can fix it and retry under the same key. There
 * is nothing to protect them from: a rejected action never acted.
 */
function replayReceipt(idempotencyKey) {
    const now = Date.now();
    return ((0, db_1.read)().webhookDeliveries ?? []).find((e) => e.direction === "inbound" && e.idempotencyKey === idempotencyKey && Date.parse(e.expiresAt) > now);
}
function rememberReceipt(idempotencyKey, action, result) {
    const at = new Date();
    const record = {
        direction: "inbound",
        id: (0, ids_1.uid)("rcpt"),
        idempotencyKey,
        action,
        at: at.toISOString(),
        expiresAt: new Date(at.getTime() + exports.IDEMPOTENCY_TTL_MS).toISOString(),
        result,
    };
    (0, db_1.mutate)((d) => {
        const list = d.webhookDeliveries ?? [];
        // Re-check under the same mutate that writes: two concurrent calls with one
        // key would otherwise both miss the read above and store two receipts, and
        // the second would then shadow the first for the rest of the window.
        const clash = list.some((e) => e.direction === "inbound" && e.idempotencyKey === idempotencyKey);
        if (clash)
            return;
        d.webhookDeliveries = pruneLog([...list, record]);
    });
}
function signBody(secret, body) {
    return `sha256=${(0, node_crypto_1.createHmac)("sha256", secret).update(body, "utf8").digest("hex")}`;
}
/**
 * HOW n8n VERIFIES A DELIVERY.
 *
 * Every request carries three headers:
 *
 *   x-glentree-event      the event name, e.g. "appointment.booked"
 *   x-glentree-delivery   a uuid, unique per (event, subscriber) attempt-group
 *   x-glentree-signature  "sha256=" + lowercase hex HMAC
 *
 * In the n8n Webhook node set **Raw Body = on**, then in a Code node:
 *
 *   1. Take the raw request body as *bytes*, exactly as received. Do not parse
 *      the JSON and re-stringify it — key order and whitespace would change and
 *      the digest would not match.
 *   2. Compute  HMAC-SHA256(secret = <the secret you registered>, message = raw body)
 *      and hex-encode it lowercase.
 *   3. Compare  "sha256=" + that hex  against the x-glentree-signature header using
 *      a constant-time comparison (`crypto.timingSafeEqual` on equal-length
 *      buffers). A `===` here leaks the digest one byte at a time to anyone who
 *      can measure the response.
 *   4. Reject the request if it does not match. Nothing else in the payload is
 *      authenticated — the body is the only signed material.
 *   5. Treat x-glentree-delivery as a dedupe key. A retry after a timeout reuses
 *      it, so a workflow that stores the id can tell a retry from a new event.
 *
 * Node example:
 *
 *   const raw = $request.rawBody;                       // Buffer
 *   const mac = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
 *   const a = Buffer.from(`sha256=${mac}`);
 *   const b = Buffer.from($request.headers['x-glentree-signature'] ?? '');
 *   if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad signature');
 */
function headersFor(sub, envelope, body) {
    return {
        "content-type": "application/json",
        "user-agent": "orbit-events/1",
        "x-glentree-event": envelope.event,
        "x-glentree-delivery": envelope.id,
        "x-glentree-signature": signBody(sub.secret, body),
    };
}
/** Retry only what a retry could plausibly fix. */
function retryable(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function deliverTo(sub, envelope) {
    const body = JSON.stringify(envelope);
    const started = Date.now();
    const base = {
        direction: "outbound",
        id: envelope.id,
        subscriberId: sub.id,
        url: sub.url,
        event: envelope.event,
        at: new Date().toISOString(),
    };
    // The URL passed validation when it was stored, but a rule tightened since
    // then — or a row written before this check existed — must not become a
    // standing SSRF. Re-check on the way out, every time.
    const unsafe = checkWebhookUrl(sub.url);
    if (unsafe) {
        return { ...base, ok: false, attempts: 0, error: unsafe, durationMs: 0 };
    }
    let lastError = "No attempt was made.";
    let lastStatus;
    // Counted rather than assumed: the loop can stop early on a non-retryable
    // status, and a log line claiming three tries when one was made sends an
    // operator looking for a flaky endpoint that is in fact refusing outright.
    let made = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (BACKOFF_MS[attempt - 1])
            await sleep(BACKOFF_MS[attempt - 1]);
        made = attempt;
        try {
            const res = await fetch(sub.url, {
                method: "POST",
                headers: headersFor(sub, envelope, body),
                body,
                // Bounded, so a subscriber that accepts the connection and then stalls
                // cannot hold a timer and a socket open for the life of the process.
                signal: AbortSignal.timeout(TIMEOUT_MS),
                // A 30x to a different host would re-point a signed, PII-carrying POST
                // at a target the operator never registered.
                redirect: "manual",
            });
            lastStatus = res.status;
            if (res.ok) {
                return { ...base, ok: true, attempts: attempt, status: res.status, durationMs: Date.now() - started };
            }
            lastError = `Subscriber answered ${res.status}.`;
            if (!retryable(res.status))
                break; // a deliberate rejection; retrying repeats it
        }
        catch (e) {
            // Includes the abort on timeout, DNS failure and TLS failure. The message
            // is kept because it is the only thing that tells an operator whether the
            // endpoint is wrong or merely down.
            lastError = e instanceof Error ? e.message : "Delivery failed.";
            lastStatus = undefined;
        }
    }
    return {
        ...base,
        ok: false,
        attempts: made,
        status: lastStatus,
        error: lastError,
        durationMs: Date.now() - started,
    };
}
/**
 * Deliver one event to every matching subscriber and return what happened.
 *
 * Awaitable, for the worker tick and for tests. Business code calls `emit()`.
 */
async function dispatch(event, data) {
    let targets;
    try {
        targets = subscribersFor(event);
    }
    catch {
        return []; // the store would not read; an event is not worth an exception
    }
    if (!targets.length)
        return [];
    const at = new Date().toISOString();
    const results = await Promise.all(targets.map(async (sub) => {
        // A fresh delivery id per subscriber, so one endpoint's retry cannot be
        // confused with another's in either log.
        const envelope = { id: crypto.randomUUID(), event, at, data };
        try {
            return await deliverTo(sub, envelope);
        }
        catch (e) {
            return {
                direction: "outbound",
                id: envelope.id,
                subscriberId: sub.id,
                url: sub.url,
                event,
                at,
                ok: false,
                attempts: 0,
                error: e instanceof Error ? e.message : "Delivery failed.",
                durationMs: 0,
            };
        }
    }));
    for (const r of results) {
        try {
            recordDelivery(r);
        }
        catch {
            /* the log is diagnostics; losing a line must not lose the event */
        }
    }
    return results;
}
/**
 * Deliver a probe to one subscriber and report exactly what happened.
 *
 * This is the answer to "is the endpoint I just registered actually reachable,
 * and does my workflow's signature check pass?" — a question that otherwise
 * waits for the next real booking to answer, at which point a mistake has
 * already cost a customer.
 *
 * Two deliberate choices:
 *
 *  - It reuses `deliverTo`, so the probe is signed, retried, timed out and
 *    re-checked for SSRF by the same code a real delivery is. A test that takes
 *    a shortcut tests the shortcut.
 *  - The payload carries `test: true` and nothing else. Inventing a plausible
 *    booking — a name, a phone number, a slot — is how a probe ends up in a
 *    spreadsheet as a customer, or sends a stranger a WhatsApp message. A
 *    workflow that does not branch on the flag will fail on the missing fields,
 *    which is loud, local and harmless.
 *
 * The event name is one the subscriber already registered for, because a
 * delivery it did not subscribe to would be filtered out by the very routing
 * this is meant to prove.
 */
async function sendTestEvent(subscriberId) {
    const sub = subscribers().find((s) => s.id === subscriberId);
    if (!sub)
        return null;
    const event = sub.events.includes(exports.ALL_EVENTS)
        ? exports.ORBIT_EVENTS[0]
        : (sub.events.find((e) => e !== exports.ALL_EVENTS) ?? exports.ORBIT_EVENTS[0]);
    const envelope = {
        id: crypto.randomUUID(),
        event,
        at: new Date().toISOString(),
        data: { test: true },
    };
    const record = await deliverTo(sub, envelope);
    try {
        recordDelivery(record);
    }
    catch {
        /* the log is diagnostics; losing a line must not lose the result */
    }
    return record;
}
/**
 * Announce that something happened. Fire-and-forget by design.
 *
 * Returns void rather than a promise so no call site can accidentally `await`
 * it and put a stranger's HTTP endpoint on the critical path of a booking. The
 * `.catch` is belt-and-braces — `dispatch` already swallows everything — but an
 * unhandled rejection escaping here would take the process down under
 * `--unhandled-rejections=throw`.
 */
function emit(event, data) {
    try {
        void dispatch(event, data).catch(() => { });
    }
    catch {
        /* never let an emit reach the caller */
    }
}
