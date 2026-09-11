import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { safePath, type ActionResult } from "@/lib/osf/form-post";
import { cancelQueued, markPosted, queuePublish, setDraftStatus } from "@/lib/osf/marketing/studio";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The publish endpoint — which publishes nothing.
 *
 * There is no Instagram Graph client here, no Facebook Page token, no Ads API
 * credential, and no code path that opens a socket to any platform. Queuing a
 * draft writes a `villa_publish_log` row with status 'pending_manual' and stops.
 * A post becomes real only when a person comes back and says so, which is what
 * the 'mark-posted' action records.
 *
 * That constraint is the whole design: the alternative — a button that claims
 * success and a dashboard reporting reach nobody measured — would make every
 * other number in this console untrustworthy by association.
 *
 * Not built on `readPost()` from lib/form-post: the channel checkboxes submit
 * one `channel` field per box, and that helper collapses repeated keys to the
 * last value, which would silently queue a single channel out of four.
 */

interface Body {
  json: boolean;
  get(name: string): string | undefined;
  all(name: string): string[];
}

async function readBody(request: Request): Promise<Body> {
  const json = (request.headers.get("content-type") ?? "").includes("application/json");
  const single = new Map<string, string>();
  const multi = new Map<string, string[]>();

  if (json) {
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        multi.set(key, value.filter((v): v is string => typeof v === "string"));
      } else {
        single.set(key, String(value));
      }
    }
  } else {
    const form = await request.formData().catch(() => new FormData());
    for (const key of new Set(form.keys())) {
      const values = form.getAll(key).filter((v): v is string => typeof v === "string");
      multi.set(key, values);
      if (values.length > 0) single.set(key, values[values.length - 1]);
    }
  }

  return {
    json,
    get(name) {
      const value = single.get(name);
      if (value === undefined) return undefined;
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    all(name) {
      const value = multi.get(name);
      if (value) return value.map((v) => v.trim()).filter(Boolean);
      const one = single.get(name);
      return one ? [one.trim()].filter(Boolean) : [];
    },
  };
}

export async function POST(request: Request) {
  const denied = await guard("marketing.publish");
  if (denied) return denied;
  const body = await readBody(request);
  const action = body.get("action") ?? "queue";

  let result: ActionResult;

  switch (action) {
    case "queue": {
      const queued = await queuePublish(body.get("draftId") ?? "", body.all("channel"));
      result = queued.ok ? { ok: true, entries: queued.entries } : queued;
      break;
    }
    case "mark-posted":
      result = await markPosted(body.get("entryId") ?? "", body.get("externalUrl"));
      break;
    case "cancel":
      result = await cancelQueued(body.get("entryId") ?? "");
      break;
    case "set-status":
      result = await setDraftStatus(body.get("draftId") ?? "", body.get("status") ?? "");
      break;
    default:
      result = { ok: false, error: `Unknown action: ${action}` };
  }

  if (result.ok) {
    revalidatePath("/os/marketing/studio");
    revalidatePath("/os/marketing/whatsapp");
  }

  if (body.json) {
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Relative Location, and the target is re-derived from an allowlisted path
  // rather than from request.url — a spoofed Host header must not choose where
  // the browser lands.
  const target = new URL(safePath(body.get("next"), "/os/marketing/studio"), "http://form-post.invalid");
  if (!result.ok) target.searchParams.set("error", result.error);

  return new NextResponse(null, {
    status: 303,
    headers: { Location: `${target.pathname}${target.search}${target.hash}` },
  });
}
