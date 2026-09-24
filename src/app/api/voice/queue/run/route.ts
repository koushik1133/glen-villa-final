import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { read } from "@/lib/db";
import { pumpQueue } from "@/lib/voice/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * THE CALL QUEUE HEARTBEAT.
 *
 *   GET /api/voice/queue/run   with   Authorization: Bearer $CRON_SECRET
 *
 * The webhook is what normally keeps a run moving — a call ends, the next one
 * starts. This exists for the cases the webhook cannot cover:
 *
 *   · a no-answer waiting out its hour of backoff, where nothing is in flight
 *     to trigger the next dial;
 *   · a queue loaded overnight, which must start itself when calling hours open;
 *   · a call the provider never reported on, which `pumpQueue` reclaims.
 *
 * Without it a run can go quiet and stay quiet. Every five minutes is ample.
 */
function authorized(request: Request, secret: string): boolean {
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export async function GET(request: Request) {
  // One uniform 401 whether the secret is unset, absent or wrong — following
  // /api/osf/cron/outbound. Splitting the cases tells an anonymous caller
  // which mistake they made.
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request, secret)) {
    if (!secret) console.error("[cron:voice-queue] refused: CRON_SECRET is not set in the environment");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Every brand with something waiting, not just the default one.
  const brands = [
    ...new Set((read().voiceCallQueue ?? []).filter((e) => e.status === "queued").map((e) => e.brandId)),
  ];

  const report: Record<string, unknown> = {};
  for (const brandId of brands) {
    try {
      report[brandId] = await pumpQueue(brandId);
    } catch (e) {
      report[brandId] = { error: e instanceof Error ? e.message : "pump failed" };
    }
  }

  return NextResponse.json({ ok: true, brands: brands.length, report });
}
