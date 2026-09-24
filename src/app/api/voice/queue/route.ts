import { read, resolveBrandId } from "@/lib/db";
import { actorLabel, assertBrandAccess, requirePermission } from "@/lib/auth/session";
import { apiError, apiFail, apiOk } from "@/lib/auth/http";
import { rateLimit } from "@/lib/ops/ratelimit";
import { configuredAgentId, isConfigured } from "@/lib/bolna/client";
import { cancelQueued, enqueueCalls, pumpQueue, queueSummary } from "@/lib/voice/queue";

export const dynamic = "force-dynamic";

/**
 * THE OUTBOUND CALL QUEUE — the desk's own surface.
 *
 * GET    the current run, POST numbers onto it, DELETE what has not been
 * dialled yet.
 *
 * Permissions match /api/voice/call, and for the same reason: loading this
 * queue rings real phones and spends real money, so it needs `customers.write`
 * rather than a read scope. The per-call rate limit still applies underneath —
 * this route only decides who is *waiting* to be called.
 */

/** Pasting a thousand numbers is not a busy desk, it is a mistake or a script. */
const MAX_PER_REQUEST = 200;

export async function GET(req: Request) {
  try {
    const session = await requirePermission("customers.read");
    const brandId = resolveBrandId(read(), new URL(req.url).searchParams.get("brand") ?? undefined);
    assertBrandAccess(session, brandId);
    return apiOk({ ...queueSummary(brandId), configured: isConfigured() });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("customers.write");

    if (!isConfigured()) {
      return apiFail(
        "The voice agent is not connected. Ask an administrator to configure it before queueing calls.",
        503,
      );
    }

    const limit = rateLimit(`voice:queue:${session.userId}`, { max: 20, windowSeconds: 300 });
    if (!limit.allowed) {
      return apiFail(`Too many queue changes. Try again in ${limit.retryAfterSeconds ?? 300}s.`, 429);
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return apiFail("Send a JSON object.");
      body = parsed as Record<string, unknown>;
    } catch {
      return apiFail("Send a JSON object.");
    }

    const brandId = resolveBrandId(read(), typeof body.brandId === "string" ? body.brandId : undefined);
    assertBrandAccess(session, brandId);

    const agentId =
      (typeof body.agentId === "string" && body.agentId.trim()) || configuredAgentId();
    if (!agentId) return apiFail("No agent is configured to make these calls.");

    // Accept a pasted block as readily as a JSON array — the desk works from a
    // spreadsheet column, and making them hand-build an array invites errors
    // in exactly the field that decides whose phone rings.
    const raw =
      Array.isArray(body.phones) ? body.phones.map(String)
      : typeof body.phones === "string" ? body.phones.split(/[\s,;]+/)
      : [];
    const phones = raw.map((p) => p.trim()).filter(Boolean);

    if (phones.length === 0) return apiFail("No numbers to call.");
    if (phones.length > MAX_PER_REQUEST) {
      return apiFail(`That is ${phones.length} numbers. Add at most ${MAX_PER_REQUEST} at a time.`);
    }

    const names =
      body.names && typeof body.names === "object" && !Array.isArray(body.names)
        ? Object.fromEntries(
            Object.entries(body.names as Record<string, unknown>).map(([k, v]) => [k, String(v).slice(0, 80)]),
          )
        : undefined;

    const result = enqueueCalls({
      brandId,
      phones,
      agentId,
      names,
      createdBy: actorLabel(session),
    });

    // Start dialling straight away rather than waiting for the next heartbeat.
    // Outside calling hours this is a no-op that says so, which is the message
    // the operator needs to see before they walk away from the screen.
    const pumped = await pumpQueue(brandId);

    return apiOk({ ...result, pumped, queue: queueSummary(brandId) }, 202);
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requirePermission("customers.write");
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return apiFail("Send a JSON object.");
    }
    const brandId = resolveBrandId(read(), typeof body.brandId === "string" ? body.brandId : undefined);
    assertBrandAccess(session, brandId);

    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (ids.length === 0) return apiFail("Nothing to cancel.");

    const cancelled = cancelQueued(brandId, ids);
    return apiOk({ cancelled, queue: queueSummary(brandId) });
  } catch (e) {
    return apiError(e);
  }
}
