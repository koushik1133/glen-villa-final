import { read } from "../db";
import { keepAlive } from "../background";
import { STALE_AFTER_MS, isStale } from "../metrics/youtube";
import { retrieveAll } from "./sync";

/**
 * PAGE-DRIVEN FRESHNESS
 *
 * The analytics, dashboard and channels pages read `dailyStats`; nothing
 * refreshes those rows unless someone presses Sync or a cron runs. So each of
 * those pages asks here first: if the newest YouTube row/stamp is older than
 * ten minutes, run the YouTube part of the retrieval sync before rendering.
 *
 * Non-blocking by contract: the refresh is kicked off and never awaited, so a
 * render costs nothing beyond a store read. Failures (no API key, quota,
 * network) are swallowed and remembered for a backoff TTL. One refresh at a
 * time per brand — concurrent renders share the in-flight promise.
 */

const inflight = new Map<string, Promise<boolean>>();
/** Last attempt per brand that synced nothing (quota, bad key): skip retries within the TTL. */
const lastFailedAt = new Map<string, number>();

/** Test hook: forget remembered failures. */
export function resetFreshnessBackoff(): void {
  lastFailedAt.clear();
}
/** Legacy deadline constant — kept for callers/tests; renders no longer wait at all. */
export const REFRESH_DEADLINE_MS = 4000;

export interface FreshnessInfo {
  /** Newest YouTube sync stamp for the brand after the (possible) refresh. */
  lastSyncedAt: string | null;
  refreshed: boolean;
}

/** What the freshness decision is made from — separated so it can be unit-tested. */
export function youtubeFreshnessInput(
  db: { connections: Array<{ brandId: string; channel: string; status: string; lastSyncedAt?: string }>; dailyStats: Array<{ brandId: string; channel: string; date: string }> },
  brandId: string,
  channels: string[] = ["youtube"],
): { lastSyncedAt: string | null; newestStatDate: string | null; connected: boolean } {
  const conns = db.connections.filter((c) => c.brandId === brandId && channels.includes(c.channel) && c.status !== "disconnected");
  const lastSyncedAt = conns.map((c) => c.lastSyncedAt ?? "").filter(Boolean).sort().pop() ?? null;
  const newestStatDate = db.dailyStats
    .filter((s) => s.brandId === brandId && channels.includes(s.channel))
    .map((s) => s.date).sort().pop() ?? null;
  return { lastSyncedAt, newestStatDate, connected: conns.length > 0 };
}

/**
 * Channels the page-driven refresh covers: YouTube (public API) and the three
 * networks whose analytics the publishing connector serves. Nothing else has
 * a keyless source to refresh from.
 */
export const FRESH_CHANNELS = ["youtube", "instagram", "facebook", "linkedin"] as const;

export async function ensureFreshStats(brandId: string): Promise<FreshnessInfo> {
  const before = youtubeFreshnessInput(read(), brandId, [...FRESH_CHANNELS]);
  if (!before.connected || !isStale(before)) return { lastSyncedAt: before.lastSyncedAt, refreshed: false };

  const failed = lastFailedAt.get(brandId);
  if (failed !== undefined && Date.now() - failed < STALE_AFTER_MS) return { lastSyncedAt: before.lastSyncedAt, refreshed: false };

  // Fire and forget: the render never waits on the network. One refresh at a
  // time per brand (the in-flight map), failures remembered for the backoff
  // TTL, and the client-side refresh picks the new rows up a moment later.
  if (!inflight.get(brandId)) {
    const p = retrieveAll(brandId, { only: [...FRESH_CHANNELS], silent: true })
      .then((r) => r.totals.synced > 0)
      .catch(() => false)
      .then((ok) => { if (ok) lastFailedAt.delete(brandId); else lastFailedAt.set(brandId, Date.now()); return ok; })
      .finally(() => inflight.delete(brandId));
    inflight.set(brandId, p);
    keepAlive(p);
  }
  return { lastSyncedAt: before.lastSyncedAt, refreshed: false };
}
