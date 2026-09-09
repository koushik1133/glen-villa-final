import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { read } from "@/lib/db";
import type { ChannelId } from "@/lib/types";

/**
 * GET /api/channels/[channel]/live?brandId=xxx
 * Returns the latest cached connection stats for a channel.
 * Used by client-side refresh on the channel detail page.
 *
 * `marketing.read`, matching the /channels page this feeds. It carried no
 * permission check, so the session gate in middleware was the whole of its
 * authorisation: any provisioned account could enumerate the connected
 * handles, follower counts and — via `lastError` — the verbatim provider
 * error, which is where an expired-token message names the account it belongs
 * to. The page that draws this is already `marketing.read`; the data it draws
 * from was not.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const denied = await guard("marketing.read");
  if (denied) return denied;

  const { channel } = await params;
  const brandId = req.nextUrl.searchParams.get("brandId");

  if (!brandId) {
    return NextResponse.json({ ok: false, error: "brandId required" }, { status: 400 });
  }

  const db = read();
  const connections = db.connections.filter(
    (c) => c.brandId === brandId && c.channel === (channel as ChannelId),
  );

  if (connections.length === 0) {
    return NextResponse.json({ ok: false, error: "No connections for this channel" }, { status: 404 });
  }

  const stats = connections.map((c) => ({
    id: c.id,
    handle: c.handle,
    status: c.status,
    followers: c.followers ?? 0,
    lastSyncedAt: c.lastSyncedAt ?? null,
    lastError: c.lastError ?? null,
  }));

  // Also pull the most recent daily stat for this channel/brand
  const recent = db.dailyStats
    .filter((s) => s.brandId === brandId && s.channel === channel)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  return NextResponse.json({
    ok: true,
    channel,
    connections: stats,
    recentStats: recent,
    fetchedAt: new Date().toISOString(),
  });
}
