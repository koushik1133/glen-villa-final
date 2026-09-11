import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/osf/activities";
import { createUnit, isUnitStatus, updateUnitStatus } from "@/lib/osf/inventory";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates a unit or changes a unit's status.
 *
 * Accepts a plain form POST (the /inventory board submits these, so the page
 * works with no client JS) or a JSON body with the same field names, for a
 * script loading a real inventory sheet.
 *
 * Writes here are what flips the agent from "the sales team will confirm
 * availability" to quoting actual unit numbers, so both actions are logged to
 * the activity feed — an availability claim should be traceable to whoever
 * entered the stock.
 */
export async function POST(request: Request) {
  const denied = await guard("marketing.publish");
  if (denied) return denied;
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  let fields: Record<string, unknown>;
  if (isJson) {
    fields = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    fields = Object.fromEntries((await request.formData()).entries());
  }

  const str = (key: string): string => {
    const value = fields[key];
    return typeof value === "string" ? value.trim() : "";
  };

  const action = str("action") || "create";

  if (action === "status") {
    const result = await updateUnitStatus(str("unitId"), str("status"));
    if (!result.ok) return respond(isJson, request, { error: result.error }, 400);

    await logActivity({
      type: "inventory_updated",
      description: `Unit ${str("unitNumber") || str("unitId")} marked ${str("status")}`,
      actorName: "Console",
      metadata: { unit_id: str("unitId"), status: str("status") },
    });

    revalidatePath("/inbox/whatsapp/properties/inventory");
    return respond(isJson, request, { ok: true }, 200);
  }

  if (action !== "create") {
    return respond(isJson, request, { error: `unknown action: ${action}` }, 400);
  }

  const rawPrice = str("priceInr");
  const priceInr = rawPrice ? Number(rawPrice) : null;
  if (priceInr !== null && !Number.isFinite(priceInr)) {
    return respond(isJson, request, { error: "priceInr must be a number" }, 400);
  }

  const status = str("status") || "available";
  if (!isUnitStatus(status)) {
    return respond(isJson, request, { error: `invalid status: ${status}` }, 400);
  }

  const result = await createUnit({
    projectId: str("projectId"),
    unitNumber: str("unitNumber"),
    villaTypeId: str("villaTypeId") || null,
    facing: str("facing") || null,
    isCorner: fields.isCorner === "on" || fields.isCorner === true,
    priceInr,
    status,
  });

  if (!result.ok) return respond(isJson, request, { error: result.error }, 400);

  await logActivity({
    type: "inventory_updated",
    description: `Unit ${result.unit.unit_number} added to live inventory as ${result.unit.status}`,
    actorName: "Console",
    metadata: { unit_id: result.unit.id, project_id: result.unit.project_id },
  });

  revalidatePath("/inbox/whatsapp/properties/inventory");
  return respond(isJson, request, { ok: true, unit: result.unit }, 200);
}

/** Form posts navigate, so send the browser back to the board instead of JSON. */
function respond(isJson: boolean, request: Request, body: Record<string, unknown>, status: number) {
  if (isJson) return NextResponse.json(body, { status });

  const url = new URL("/inbox/whatsapp/properties/inventory", request.url);
  if (typeof body.error === "string") url.searchParams.set("error", body.error);
  return NextResponse.redirect(url, { status: 303 });
}
