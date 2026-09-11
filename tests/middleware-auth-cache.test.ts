import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "src/middleware.ts"), "utf8");

/**
 * The middleware caches its authentication verdict so that opening a screen
 * with fifty links does not queue fifty network round-trips. That is a
 * performance fix sitting on the auth path, so these pin the properties that
 * make it safe rather than merely fast.
 */
describe("middleware auth verdict cache", () => {
  test("the cache is keyed by the auth cookie itself", () => {
    // If the key were anything coarser — an IP, a path, a user id parsed from
    // an unverified token — one visitor's verdict could be served to another.
    const fn = src.slice(src.indexOf("function authKey"), src.indexOf("function cachedVerdict"));
    assert.match(fn, /cookies[\s\S]*getAll\(\)/, "the key is not derived from cookies");
    assert.match(fn, /auth-token/, "the key does not read the Supabase auth cookie");
    assert.match(fn, /\$\{c\.name\}=\$\{c\.value\}/, "the cookie VALUE is not part of the key");
    assert.match(fn, /\.sort\(/, "chunk order is not normalised, so one session could produce two keys");
  });

  test("an anonymous request is never cached", () => {
    const fn = src.slice(src.indexOf("function authKey"), src.indexOf("function cachedVerdict"));
    assert.match(fn, /return parts\.length \? parts\.join\("&"\) : null;/,
      "authKey must return null with no auth cookie so nothing is cached for anonymous traffic");
    assert.match(src, /if \(key\) rememberVerdict/, "a null key must not be written to the cache");
  });

  test("entries expire, and the window is tighter than the session cache's", () => {
    const ttl = src.match(/const AUTH_TTL_MS = ([\d_]+);/);
    assert.ok(ttl, "no TTL constant");
    const ms = Number(ttl[1].replace(/_/g, ""));
    assert.ok(ms > 0, "TTL must be positive");
    assert.ok(ms <= 30_000, `TTL ${ms}ms is not tighter than the 30s session cache`);
    assert.match(src, /if \(hit\.expiresAt <= now\)[\s\S]{0,80}delete/,
      "an expired entry is not evicted on read");
  });

  test("the cache is bounded", () => {
    assert.match(src, /AUTH_CACHE_MAX/, "no size cap — a long-lived worker would grow without limit");
    assert.match(src, /authVerdicts\.size >= AUTH_CACHE_MAX/, "the cap is never checked");
  });

  test("a cache hit still cannot reach a page without a real check", () => {
    // The middleware is the coarse fence. This asserts the comment that says so
    // survives, because the safety of the cache rests on it being true.
    assert.match(
      src,
      /coarse gate, not the security boundary|outer fence, not the only one/,
      "the middleware no longer documents that pages verify independently",
    );
  });

  test("public paths are not keyed or cached at all", () => {
    assert.match(src, /const key = publicPath \? null : authKey\(req\)/,
      "public paths must not take part in the cache");
  });
});
