import { randomUUID } from "node:crypto";
import { db } from "./supabase";

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

export interface LockHandle {
  key: string;
  holder: string;
  release: () => Promise<void>;
}

async function tryAcquire(key: string, holder: string, ttlSeconds: number): Promise<boolean> {
  const { data, error } = await db().rpc("villa_acquire_lock", {
    p_key: key,
    p_holder: holder,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error(`Lock acquire failed for ${key}: ${error.message}`);
  return data === true;
}

/**
 * Waits up to `waitMs` for the lock. Returns null on timeout rather than
 * throwing — the caller decides whether losing the race is fatal.
 */
export async function acquireLock(
  key: string,
  opts: { waitMs?: number; ttlSeconds?: number } = {},
): Promise<LockHandle | null> {
  const waitMs = opts.waitMs ?? 15_000;
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const holder = randomUUID();
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
            await db().rpc("villa_release_lock", { p_key: key, p_holder: holder });
          } catch {
            /* lease expiry is the backstop */
          }
        },
      };
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/** Runs `fn` holding `key`. `onBusy` decides what a timeout means. */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { waitMs?: number; ttlSeconds?: number; onBusy?: () => T | Promise<T> } = {},
): Promise<T> {
  const lock = await acquireLock(key, opts);
  if (!lock) {
    if (opts.onBusy) return await opts.onBusy();
    throw new Error(`Timed out waiting for lock ${key}`);
  }
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

export const conversationLockKey = (leadId: string) => `conv:${leadId}`;
