import { revalidatePath } from "next/cache";
import { readPost, respond, safePath, type ActionResult } from "@/lib/osf/form-post";
import { dismissInsight, generateInsights } from "@/lib/osf/insights";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Regenerate and dismiss for /ai/insights.
 *
 * Takes a plain form POST (so the page needs no client JS) or JSON, via the
 * shared `readPost`/os`respond` pair — which also means the redirect target is
 * validated rather than built from the request's own Host header.
 */

const PAGE = "/os/ai/insights";

export async function POST(request: Request) {
  const denied = await guard("analytics.view");
  if (denied) return denied;
  const body = await readPost(request);
  // `action` is what the older /api/insights callers send; `intent` matches the
  // rest of this console. Accept both so neither has to be rewritten.
  const intent = body.get("intent") ?? body.get("action") ?? "generate";
  const back = safePath(body.get("next"), PAGE);

  const done = (result: ActionResult) => {
    if (result.ok) revalidatePath(PAGE);
    return respond(request, body, back, result);
  };

  if (intent === "dismiss") {
    const id = body.get("id");
    if (!id) return done({ ok: false, error: "id is required to dismiss an insight" });
    const result = await dismissInsight(id);
    return done(result.ok ? { ok: true } : { ok: false, error: result.error ?? "dismiss failed" });
  }

  if (intent === "generate") {
    const result = await generateInsights();
    if (!result.ok) return done({ ok: false, error: result.error ?? "generation failed" });
    return done({
      ok: true,
      inserted: result.inserted,
      updated: result.updated,
      removed: result.removed,
      suppressed: result.suppressed,
      generatedByAi: result.aiCount,
    });
  }

  return done({ ok: false, error: `unknown intent: ${intent}` });
}
