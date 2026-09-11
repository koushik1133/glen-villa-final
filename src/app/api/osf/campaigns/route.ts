import { revalidatePath } from "next/cache";
import { readPost, respond, safePath, type ActionResult } from "@/lib/osf/form-post";
import {
  createCampaign,
  isCampaignStatus,
  updateCampaignSpend,
  type SpendPatch,
  type WriteResult,
} from "@/lib/osf/campaigns";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Parsed = { ok: true; value: number | undefined } | { ok: false; error: string };

/** A blank input means "leave it alone", which is not the same as zero. */
function parseNumber(value: string | undefined, label: string): Parsed {
  if (value === undefined) return { ok: true, value: undefined };
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
  return { ok: true, value: n };
}

/**
 * Creates a campaign, or records the latest spend/impressions/clicks against
 * an existing one.
 *
 * Accepts a JSON body or a plain form POST with the same field names — the
 * page submits the latter so it works with zero client JS, and the 303 sends
 * the browser back to a freshly rendered table rather than to raw JSON.
 */
export async function POST(request: Request) {
  const denied = await guard("marketing.publish");
  if (denied) return denied;
  const body = await readPost(request);
  const action = body.get("action") ?? "create";

  let result: WriteResult;

  if (action === "create") {
    const budget = parseNumber(body.get("budgetInr") ?? body.get("budget_inr"), "Budget");
    const status = body.get("status") ?? "";
    result = !budget.ok
      ? budget
      : await createCampaign({
          name: body.get("name") ?? "",
          platform: body.get("platform") ?? "",
          status: isCampaignStatus(status) ? status : "draft",
          budgetInr: budget.value ?? 0,
          startDate: body.get("startDate") ?? body.get("start_date") ?? null,
          endDate: body.get("endDate") ?? body.get("end_date") ?? null,
        });
  } else if (action === "update-spend") {
    const spent = parseNumber(body.get("spentInr") ?? body.get("spent_inr"), "Spend");
    const impressions = parseNumber(body.get("impressions"), "Impressions");
    const clicks = parseNumber(body.get("clicks"), "Clicks");
    const invalid = [spent, impressions, clicks].find((p) => !p.ok);

    if (invalid && !invalid.ok) {
      result = invalid;
    } else {
      const patch: SpendPatch = {
        spentInr: spent.ok ? spent.value : undefined,
        impressions: impressions.ok ? impressions.value : undefined,
        clicks: clicks.ok ? clicks.value : undefined,
      };
      result = await updateCampaignSpend(body.get("id") ?? "", patch);
    }
  } else {
    result = { ok: false, error: `Unknown action: ${action}` };
  }

  if (result.ok) {
    // Both marketing pages read villa_campaign_performance, so a spend edit
    // that refreshed only the table would leave the blended ROAS beside it stale.
    revalidatePath("/inbox/whatsapp/marketing/campaigns");
    revalidatePath("/inbox/whatsapp/marketing/overview");
  }

  const outcome: ActionResult = result.ok ? { ok: true, id: result.id } : result;
  // Sanitised here rather than left to respond(), whose own fallback is "/inbox/whatsapp" —
  // a tampered `next` should still land the browser back on this page.
  const back = safePath(body.get("next"), "/inbox/whatsapp/marketing/campaigns");
  return respond(request, body, back, outcome);
}
