import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { markAllRead, markRead } from "@/lib/osf/notifications";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marks one notification read, or clears the whole unread list. */
export async function POST(request: Request) {
  const denied = await guard("customers.write");
  if (denied) return denied;
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");

  let intent: unknown;
  let id: unknown;

  if (isJson) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    intent = body.intent;
    id = body.id;
  } else {
    const form = await request.formData();
    intent = form.get("intent");
    id = form.get("id");
  }

  if (intent === "mark-all") {
    await markAllRead();
  } else if (intent === "mark-read") {
    if (typeof id !== "string" || !id) {
      return isJson
        ? NextResponse.json({ error: "id is required" }, { status: 400 })
        : NextResponse.redirect(new URL("/inbox/whatsapp/automation/notifications", request.url), { status: 303 });
    }
    await markRead(id);
  } else {
    return isJson
      ? NextResponse.json({ error: `unknown intent: ${String(intent)}` }, { status: 400 })
      : NextResponse.redirect(new URL("/inbox/whatsapp/automation/notifications", request.url), { status: 303 });
  }

  revalidatePath("/inbox/whatsapp/automation/notifications");
  return isJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL("/inbox/whatsapp/automation/notifications", request.url), { status: 303 });
}
