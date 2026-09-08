import assert from "node:assert/strict";
import test, { after, describe } from "node:test";
import { cleanup, isolate } from "./helpers";

/**
 * ensureFreshStats must never hold a render. It kicks the refresh and returns
 * on the spot with whatever the store already holds; the client refresh picks
 * the new rows up afterwards.
 */
const dir = isolate("freshness-nonblocking");
after(() => cleanup(dir));

const fr = require("../src/lib/engine/freshness") as typeof import("../src/lib/engine/freshness");
const { read, mutate, resetToBootstrap } = require("../src/lib/db") as typeof import("../src/lib/db");

function stageStale(): string {
  resetToBootstrap();
  const brandId = read().brands[0].id;
  mutate((d) => {
    d.connections = d.connections.filter((c) => c.brandId !== brandId);
    d.dailyStats = [];
    d.activity = [];
    d.connections.push({
      id: "con_yt", brandId, channel: "youtube", handle: "@villa-yt", externalId: "uploadpost:default:youtube",
      status: "connected", scopes: [], avatarColor: "#000", followers: 0,
      connectedAt: "2026-01-01T00:00:00Z", lastSyncedAt: "2026-01-01T00:00:00Z",
    });
  });
  fr.resetFreshnessBackoff();
  return brandId;
}

describe("ensureFreshStats is non-blocking", () => {
  test("returns immediately even when the upstream fetch never resolves", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const brandId = stageStale();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch; // never settles
    const started = Date.now();
    try {
      const out = await fr.ensureFreshStats(brandId);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 250, `expected an immediate return, took ${elapsed}ms`);
      assert.equal(out.refreshed, false, "the render shows the rows it already has");
      assert.equal(out.lastSyncedAt, "2026-01-01T00:00:00Z");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.YOUTUBE_API_KEY;
      fr.resetFreshnessBackoff();
    }
  });

  test("concurrent renders share one in-flight refresh", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const brandId = stageStale();
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls += 1; return new Promise<Response>(() => {}); }) as typeof fetch;
    try {
      await Promise.all([
        fr.ensureFreshStats(brandId),
        fr.ensureFreshStats(brandId),
        fr.ensureFreshStats(brandId),
      ]);
      assert.ok(calls <= 1, `expected at most one upstream call, got ${calls}`);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.YOUTUBE_API_KEY;
      fr.resetFreshnessBackoff();
    }
  });
});
