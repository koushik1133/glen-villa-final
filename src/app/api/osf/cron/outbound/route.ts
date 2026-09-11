import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/osf/supabase";
import { prepareBroadcast, sendBroadcastBatch } from "@/lib/osf/broadcasts";
import { autoEnroll, runDueSequenceSteps } from "@/lib/osf/sequences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The outbound heartbeat. Point a cron at:
 *   GET /api/cron/outbound   with   Authorization: Bearer $CRON_SECRET
 *
 * Every few minutes it:
 *   1. starts any broadcast whose scheduled time has arrived
 *   2. keeps part-sent broadcasts moving, one batch per invocation
 *   3. auto-enrolls matching leads into active sequences
 *   4. fires every drip step that has come due
 *
 * Everything it calls is idempotent and claim-based, so overlapping cron
 * invocations (or a human clicking Send at the same moment) cannot
 * double-message anyone.
 */

function authorized(request: Request, secret: string): boolean {
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export async function GET(request: Request) {
  // One uniform 401 whether the secret is unset, absent or wrong. Splitting
  // those cases (503 vs 401) told anonymous callers which mistake they had
  // made — reconnaissance for free. The operator finds the real cause in the
  // server log, which is where it belongs.
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request, secret)) {
    if (!secret) console.error("[cron:outbound] refused: CRON_SECRET is not set in the environment");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = db();
  const report: Record<string, unknown> = {};

  // 1. Scheduled broadcasts whose time has come.
  const { data: due } = await supabase
    .from("villa_broadcasts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .limit(5);

  for (const b of due ?? []) {
    try {
      await prepareBroadcast(b.id);
      report[`broadcast:${b.id}`] = await sendBroadcastBatch(b.id);
    } catch (e) {
      report[`broadcast:${b.id}`] = { error: e instanceof Error ? e.message : "failed" };
    }
  }

  // 2. Anything mid-send keeps moving even if nobody is watching the UI.
  const { data: sending } = await supabase
    .from("villa_broadcasts")
    .select("id")
    .eq("status", "sending")
    .limit(5);

  for (const b of sending ?? []) {
    try {
      report[`resume:${b.id}`] = await sendBroadcastBatch(b.id);
    } catch (e) {
      report[`resume:${b.id}`] = { error: e instanceof Error ? e.message : "failed" };
    }
  }

  // 3 + 4. Drips.
  try {
    report.autoEnrolled = await autoEnroll();
  } catch (e) {
    report.autoEnrolled = { error: e instanceof Error ? e.message : "failed" };
  }
  try {
    report.sequences = await runDueSequenceSteps();
  } catch (e) {
    report.sequences = { error: e instanceof Error ? e.message : "failed" };
  }

  return NextResponse.json({ ok: true, ...report });
}
