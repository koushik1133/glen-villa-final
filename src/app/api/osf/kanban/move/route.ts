import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { moveLeadStage } from "@/lib/osf/kanban";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Moves one lead to a new pipeline stage.
 *
 * Accepts either a JSON body ({leadId, stage}) or a plain form POST (same two
 * field names) — the board submits the latter so the move works with zero
 * client JS, but anything scripted can hit this with fetch + JSON too.
 */
export async function POST(request: Request) {
  const denied = await guard("sales.write");
  if (denied) return denied;
  const contentType = request.headers.get("content-type") ?? "";
  let leadId: unknown;
  let stage: unknown;

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    leadId = body.leadId;
    stage = body.stage;
  } else {
    const form = await request.formData();
    leadId = form.get("leadId");
    stage = form.get("stage");
  }

  if (typeof leadId !== "string" || !leadId || typeof stage !== "string" || !stage) {
    return NextResponse.json({ error: "leadId and stage are required" }, { status: 400 });
  }

  const result = await moveLeadStage(leadId, stage);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  revalidatePath("/inbox/whatsapp/crm/pipeline");

  // Form submits navigate on POST — send the browser back to the board rather
  // than rendering the raw JSON response.
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(new URL("/inbox/whatsapp/crm/pipeline", request.url), { status: 303 });
  }
  return NextResponse.json({ ok: true });
}
