"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conversationLockKey = void 0;
exports.acquireLock = acquireLock;
exports.withLock = withLock;
const node_crypto_1 = require("node:crypto");
const supabase_1 = require("./supabase");
/**
 * Lease-based mutex, backed by villa_locks.
 *
 * Why not a Postgres advisory lock: those are session-scoped, and Supabase
 * pools connections — a lock taken in one PostgREST call is not held during
 * the next. A row with an expiry survives pooling, and the expiry means a
 * process that dies mid-reply cannot wedge a customer's thread forever.
 */
const DEFAULT_TTL_SECONDS = 90;
const POLL_INTERVAL_MS = 120;
async function tryAcquire(key, holder, ttlSeconds) {
    const { data, error } = await (0, supabase_1.db)().rpc("villa_acquire_lock", {
        p_key: key,
        p_holder: holder,
        p_ttl_seconds: ttlSeconds,
    });
    if (error)
        throw new Error(`Lock acquire failed for ${key}: ${error.message}`);
    return data === true;
}
/**
 * Waits up to `waitMs` for the lock. Returns null on timeout rather than
 * throwing — the caller decides whether losing the race is fatal.
 */
async function acquireLock(key, opts = {}) {
    const waitMs = opts.waitMs ?? 15_000;
    const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const holder = (0, node_crypto_1.randomUUID)();
    const deadline = Date.now() + waitMs;
    for (;;) {
        if (await tryAcquire(key, holder, ttlSeconds)) {
            return {
                key,
                holder,
                release: async () => {
                    // Passing the holder means we can only ever delete our own lease —
                    // if ours already expired and someone else took over, we leave
                    // theirs alone instead of releasing a lock we no longer own.
                    // Best-effort: if the release call itself fails the lease still
                    // expires on its own, so a failure here delays the next message
                    // rather than losing it.
                    try {
                        await (0, supabase_1.db)().rpc("villa_release_lock", { p_key: key, p_holder: holder });
                    }
                    catch {
                        /* lease expiry is the backstop */
                    }
                },
            };
        }
        if (Date.now() >= deadline)
            return null;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
}
/** Runs `fn` holding `key`. `onBusy` decides what a timeout means. */
async function withLock(key, fn, opts = {}) {
    const lock = await acquireLock(key, opts);
    if (!lock) {
        if (opts.onBusy)
            return await opts.onBusy();
        throw new Error(`Timed out waiting for lock ${key}`);
    }
    try {
        return await fn();
    }
    finally {
        await lock.release();
    }
}
const conversationLockKey = (leadId) => `conv:${leadId}`;
exports.conversationLockKey = conversationLockKey;
