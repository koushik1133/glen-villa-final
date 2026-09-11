import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/osf/activities";
import { readPost, respond, safePath, type ActionResult } from "@/lib/osf/form-post";
import { UNIT_STATUS_LABELS, createUnit, isUnitStatus, updateUnitStatus } from "@/lib/osf/properties";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inventory writes behind the availability board.
 *
 * Accepts a plain form POST — the board submits real forms so it works with no
 * client JS — or the same field names as JSON, for a script loading an approved
 * inventory sheet.
 *
 * Every write here changes what the AI agent is willing to say out loud: an
 * empty villa_units makes it refuse to quote availability, and a row added here
 * makes it start quoting unit numbers. So both actions are logged to the
 * activity feed — an availability claim made to a customer has to be traceable
 * back to whoever entered the stock.
 */
export async function POST(request: Request) {
  const denied = await guard("marketing.publish");
  if (denied) return denied;
  const body = await readPost(request);
  const back = safePath(body.get("next"), "/inbox/whatsapp/properties/inventory");
  const action = body.get("action") ?? "create-unit";

  const finish = (result: ActionResult) => {
    if (result.ok) revalidatePath("/inbox/whatsapp/properties/inventory");
    return respond(request, body, back, result);
  };

  if (action === "unit-status") {
    const status = body.get("status") ?? "";
    if (!isUnitStatus(status)) return finish({ ok: false, error: `invalid status: ${status}` });

    const result = await updateUnitStatus(body.get("unitId") ?? "", status);
    if (!result.ok) return finish(result);

    await logActivity({
      type: "inventory_updated",
      description: `Unit ${result.unit.unit_number} marked ${UNIT_STATUS_LABELS[status].toLowerCase()}`,
      actorName: "Console",
      metadata: { unit_id: result.unit.id, project_id: result.unit.project_id, status },
    });

    return finish({ ok: true, unit: result.unit });
  }

  if (action !== "create-unit") {
    return finish({ ok: false, error: `unknown action: ${action}` });
  }

  const numeric = (name: string): number | null | { error: string } => {
    const raw = body.get(name);
    if (raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { error: `${name} must be a positive number` };
    return value;
  };

  const priceInr = numeric("priceInr");
  if (priceInr !== null && typeof priceInr === "object") return finish({ ok: false, error: priceInr.error });
  const plotAreaSqyd = numeric("plotAreaSqyd");
  if (plotAreaSqyd !== null && typeof plotAreaSqyd === "object") {
    return finish({ ok: false, error: plotAreaSqyd.error });
  }

  const status = body.get("status") ?? "available";
  if (!isUnitStatus(status)) return finish({ ok: false, error: `invalid status: ${status}` });

  const result = await createUnit({
    projectId: body.get("projectId") ?? "",
    unitNumber: body.get("unitNumber") ?? "",
    villaTypeId: body.get("villaTypeId") ?? null,
    facing: body.get("facing") ?? null,
    isCorner: body.bool("isCorner"),
    plotAreaSqyd,
    priceInr,
    status,
  });
  if (!result.ok) return finish(result);

  await logActivity({
    type: "inventory_updated",
    description: `Unit ${result.unit.unit_number} added to live inventory as ${UNIT_STATUS_LABELS[status].toLowerCase()}`,
    actorName: "Console",
    metadata: { unit_id: result.unit.id, project_id: result.unit.project_id, status },
  });

  return finish({ ok: true, unit: result.unit });
}
