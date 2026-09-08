import test from "node:test";
import assert from "node:assert/strict";
import {
  cacheKeyFor,
  cacheKeyFromCookies,
  clearAllSessions,
  clearSessionCache,
  extractAccessToken,
  getCachedSession,
  isObviouslyExpired,
  sessionCacheSize,
  setCachedSession,
  MAX_ENTRIES,
  TTL_MS,
  FAILURE_TTL_MS,
} from "../src/lib/auth/session-cache";
import type { SessionResult } from "../src/lib/auth/session";

function active(id: string): SessionResult {
  return {
    status: "active",
    session: {
      userId: id,
      email: `${id}@test.invalid`,
      fullName: id,
      orgId: "org-1",
      roles: ["ADMIN"],
      permissions: new Set(),
      mustChangePassword: false,
    },
  };
}

function jwt(exp: number): string {
  const body = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `h.${body}.sig`;
}

function cookie(name: string, value: string) {
  return { name, value };
}

/**
 * Stands in for the Supabase client. Counts how many times the network path is
 * entered, which is the only thing these tests actually care about.
 */
function stubSupabase() {
  const calls = { getUser: 0, queries: 0 };
  return {
    calls,
    auth: {
      getUser: async () => {
        calls.getUser += 1;
        return { data: { user: { id: "u1", email: "u1@test.invalid", app_metadata: {} } }, error: null };
      },
    },
    from() {
      calls.queries += 1;
      return this;
    },
  };
}

/** The same read-through shape resolveSession uses, minus next/headers. */
async function resolveWithCache(sb: ReturnType<typeof stubSupabase>, cookies: Array<{ name: string; value: string }>) {
  const key = cacheKeyFromCookies(cookies);
  if (key) {
    const raw = cookies.filter((c) => c.name.includes("-auth-token")).map((c) => c.value).join("");
    const token = extractAccessToken(raw);
    if (token && isObviouslyExpired(token)) return { status: "anonymous" } as SessionResult;
    const hit = getCachedSession(key);
    if (hit) return hit;
  }
  await sb.auth.getUser();
  sb.from();
  sb.from();
  const result = active("u1");
  if (key) setCachedSession(key, result);
  return result;
}

test.beforeEach(() => clearAllSessions());

test("miss then hit: the second resolve makes no network calls", async () => {
  const sb = stubSupabase();
  const cookies = [cookie("sb-proj-auth-token", JSON.stringify({ access_token: jwt(Math.floor(Date.now() / 1000) + 3600) }))];
  await resolveWithCache(sb, cookies);
  assert.equal(sb.calls.getUser, 1);
  assert.equal(sb.calls.queries, 2);
  const second = await resolveWithCache(sb, cookies);
  assert.equal(sb.calls.getUser, 1, "getUser must not run again on a hit");
  assert.equal(sb.calls.queries, 2, "profiles/user_roles must not run again on a hit");
  assert.equal(second.status, "active");
});

test("two different users never share an entry", () => {
  const a = cacheKeyFromCookies([cookie("sb-proj-auth-token", "token-a")]);
  const b = cacheKeyFromCookies([cookie("sb-proj-auth-token", "token-b")]);
  assert.notEqual(a, b);
  setCachedSession(a!, active("a"));
  const hit = getCachedSession(b!);
  assert.equal(hit, null);
});

test("chunked cookies fold into one stable key, and chunk order does not matter", () => {
  const k1 = cacheKeyFromCookies([cookie("sb-p-auth-token.0", "aa"), cookie("sb-p-auth-token.1", "bb")]);
  const k2 = cacheKeyFromCookies([cookie("sb-p-auth-token.1", "bb"), cookie("sb-p-auth-token.0", "aa")]);
  assert.equal(k1, k2);
  // and a different split of the same concatenation is a different key
  assert.notEqual(k1, cacheKeyFromCookies([cookie("sb-p-auth-token.0", "a"), cookie("sb-p-auth-token.1", "abb")]));
});

test("no auth cookie means no key, so anonymous traffic is never cached", () => {
  assert.equal(cacheKeyFromCookies([cookie("theme", "dark")]), null);
  assert.equal(cacheKeyFromCookies([]), null);
});

test("entries expire after the TTL", () => {
  const key = cacheKeyFor("t");
  const now = Date.now();
  setCachedSession(key, active("u1"), now);
  assert.notEqual(getCachedSession(key, now + TTL_MS - 1), null);
  assert.equal(getCachedSession(key, now + TTL_MS), null, "expired entry must not be served");
});

test("non-active results live at most FAILURE_TTL_MS", () => {
  const key = cacheKeyFor("t2");
  const now = Date.now();
  setCachedSession(key, { status: "unprovisioned", email: "x@test.invalid" }, now);
  assert.notEqual(getCachedSession(key, now + FAILURE_TTL_MS - 1), null);
  assert.equal(getCachedSession(key, now + FAILURE_TTL_MS), null);
  assert.ok(FAILURE_TTL_MS < TTL_MS);
});

test("the map is capped and evicts the least recently used entry", () => {
  for (let i = 0; i < MAX_ENTRIES; i++) setCachedSession(cacheKeyFor(`k${i}`), active(`u${i}`));
  assert.equal(sessionCacheSize(), MAX_ENTRIES);
  // Touch the oldest so it is no longer the eviction candidate.
  assert.notEqual(getCachedSession(cacheKeyFor("k0")), null);
  setCachedSession(cacheKeyFor("overflow"), active("u-overflow"));
  assert.equal(sessionCacheSize(), MAX_ENTRIES);
  assert.notEqual(getCachedSession(cacheKeyFor("k0")), null, "recently used entry survives");
  assert.equal(getCachedSession(cacheKeyFor("k1")), null, "least recently used entry is evicted");
});

test("sign-out drops only that caller's entry", () => {
  const mine = cacheKeyFromCookies([cookie("sb-p-auth-token", "mine")])!;
  const theirs = cacheKeyFromCookies([cookie("sb-p-auth-token", "theirs")])!;
  setCachedSession(mine, active("me"));
  setCachedSession(theirs, active("them"));
  clearSessionCache(mine);
  assert.equal(getCachedSession(mine), null);
  assert.notEqual(getCachedSession(theirs), null);
});

test("a role change clears everything", () => {
  setCachedSession(cacheKeyFor("a"), active("a"));
  setCachedSession(cacheKeyFor("b"), active("b"));
  clearAllSessions();
  assert.equal(sessionCacheSize(), 0);
});

test("an expired token short-circuits to anonymous with no network call", async () => {
  const sb = stubSupabase();
  const expired = JSON.stringify({ access_token: jwt(Math.floor(Date.now() / 1000) - 60) });
  const result = await resolveWithCache(sb, [cookie("sb-p-auth-token", expired)]);
  assert.equal(result.status, "anonymous");
  assert.equal(sb.calls.getUser, 0, "an obviously expired token must not reach Supabase");
});

test("a still-valid token is not treated as expired", () => {
  assert.equal(isObviouslyExpired(jwt(Math.floor(Date.now() / 1000) + 600)), false);
  // Unparseable or non-JWT values fall through to the network path rather than
  // being guessed at — getUser() remains the authority.
  assert.equal(isObviouslyExpired("not-a-jwt"), false);
});

test("access token is recovered from both plain and base64- cookie payloads", () => {
  const token = jwt(Math.floor(Date.now() / 1000) + 60);
  const plain = JSON.stringify({ access_token: token });
  assert.equal(extractAccessToken(plain), token);
  assert.equal(extractAccessToken(`base64-${Buffer.from(plain).toString("base64")}`), token);
  assert.equal(extractAccessToken(JSON.stringify([token, "refresh"])), token);
  assert.equal(extractAccessToken(token), token);
});
