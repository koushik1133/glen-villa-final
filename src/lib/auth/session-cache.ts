import { createHash } from "node:crypto";
import type { SessionResult } from "./session";

/**
 * SHORT-LIVED SESSION CACHE
 *
 * React's `cache()` dedupes `resolveSession()` within a single request. It does
 * nothing across requests, so every navigation and every API call paid a
 * `getUser()` round trip to Supabase plus two PostgREST queries — measured at
 * ~450ms before anything else on the page had started.
 *
 * This is an in-process (per Node worker) cache of the *resolved* result, keyed
 * by a SHA-256 of the raw auth cookie. The raw token is never stored: only its
 * digest is a key, so a heap dump or a log of the map's keys yields nothing
 * replayable, and two different users can never collide because the digest
 * covers the whole cookie value (all chunks, in order).
 *
 * THE TRADEOFF, EXACTLY:
 *   On a cache hit the JWT signature is NOT re-verified with Supabase and the
 *   profiles/user_roles rows are NOT re-read. So a revoked session, a disabled
 *   account, or a role that was just narrowed keeps its old access for at most
 *   TTL_MS (30 seconds) on workers that hold a warm entry.
 * That window is why:
 *   - the TTL is 30s rather than minutes;
 *   - sign-out calls clearSessionCache() for its own token;
 *   - role / active-flag writes call clearAllSessions();
 *
 *   BOTH INVALIDATORS ARE PROCESS-LOCAL. The map lives in one Node worker, and
 *   so do clearSessionCache() and clearAllSessions(): only the instance that
 *   handled the sign-out or the users PATCH drops its entry. On a multi-instance
 *   deployment every other warm instance keeps serving the old SessionResult
 *   until its own entry expires — so revocation, disabling an account, and
 *   narrowing a role are eventually-consistent within TTL_MS (30s), not
 *   immediate. Single-instance deployments (the current setup) see the
 *   invalidation immediately. Making it immediate everywhere means a shared
 *   signal (e.g. a per-user `sessions_invalidated_at` folded into the hit
 *   check), which is not implemented here.
 *
 *   - a non-active result is cached for at most FAILURE_TTL_MS (5s), so a user
 *     provisioned a moment ago is not locked out for a full TTL;
 *   - expired JWTs short-circuit locally (see isObviouslyExpired) and are never
 *     cached at all.
 * Signature validation is still done by getUser() on every cache miss; this
 * layer only skips work it has already paid for within the last 30 seconds.
 */

export const TTL_MS = 30_000;
export const FAILURE_TTL_MS = 5_000;
export const MAX_ENTRIES = 500;

interface Entry {
  result: SessionResult;
  expiresAt: number;
}

/** Insertion-ordered, which is what makes the LRU-ish eviction below work. */
const store = new Map<string, Entry>();

/** Digest of the caller's auth cookie. Never the raw token. */
export function cacheKeyFor(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("hex");
}

/**
 * Build the cache key from the request's Supabase auth cookies.
 *
 * Supabase names the cookie `sb-<project-ref>-auth-token` and splits large ones
 * into `.0`, `.1`, … chunks. Every chunk is folded in, sorted by name so chunk
 * order cannot vary between requests, and each is prefixed with its own name so
 * two different users' chunks can never concatenate to the same string.
 * Returns null when no auth cookie is present — an anonymous request, which is
 * cheap already and is not cached.
 */
export function cacheKeyFromCookies(all: Array<{ name: string; value: string }>): string | null {
  const parts = all
    .filter((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((c) => `${c.name}=${c.value}`);
  if (parts.length === 0) return null;
  return cacheKeyFor(parts.join("\n"));
}

/**
 * Pull the access token out of the cookie payload. Supabase stores a JSON
 * session object, optionally `base64-` prefixed. Best-effort by design: a
 * shape we do not recognise simply means no local expiry pre-check.
 */
export function extractAccessToken(cookieValue: string): string | null {
  let raw = cookieValue;
  if (raw.startsWith("base64-")) {
    try {
      raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
    if (parsed && typeof parsed.access_token === "string") return parsed.access_token;
  } catch {
    /* not JSON */
  }
  return raw.split(".").length === 3 ? raw : null;
}

/**
 * Does the cookie carry a refresh token? An expired access token with a refresh
 * token beside it is NOT a dead session: getUser() renews it transparently, so
 * the local-expiry short-circuit must not answer "anonymous" for one. Only a
 * cookie with no way to refresh can be rejected without a network call.
 */
export function hasRefreshToken(cookieValue: string): boolean {
  let raw = cookieValue;
  if (raw.startsWith("base64-")) {
    try {
      raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
    } catch {
      return false;
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return typeof parsed[1] === "string" && parsed[1].length > 0;
    return typeof parsed?.refresh_token === "string" && parsed.refresh_token.length > 0;
  } catch {
    return false;
  }
}

/**
 * Cheap "is this obviously expired" pre-check: decode the `exp` claim WITHOUT
 * verifying the signature and compare it to the clock. This is a fast path, not
 * a security check — a forged token trivially claims a future `exp`, and is
 * still rejected by getUser() on the miss path. All it buys is skipping a
 * network round trip for a token that could not possibly be accepted.
 */
export function isObviouslyExpired(accessToken: string, now = Date.now()): boolean {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload?.exp !== "number") return false;
    return payload.exp * 1000 <= now;
  } catch {
    return false;
  }
}

/** Cached result for this key, or null on a miss or an expired entry. */
export function getCachedSession(key: string, now = Date.now()): SessionResult | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  // Re-insert so the most recently used key moves to the end of the iteration
  // order; eviction then takes the least recently used.
  store.delete(key);
  store.set(key, hit);
  return hit.result;
}

export function setCachedSession(key: string, result: SessionResult, now = Date.now()): void {
  const ttl = result.status === "active" ? TTL_MS : FAILURE_TTL_MS;
  store.delete(key);
  store.set(key, { result, expiresAt: now + ttl });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/** Drop one entry (sign-out), or everything when no key is given. */
export function clearSessionCache(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}

/** Drop every entry. Used after role or account-status writes. */
export function clearAllSessions(): void {
  store.clear();
}

/** Test/diagnostic only. */
export function sessionCacheSize(): number {
  return store.size;
}
