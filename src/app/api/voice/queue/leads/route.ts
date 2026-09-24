import { read, resolveBrandId } from "@/lib/db";
import { assertBrandAccess, requirePermission } from "@/lib/auth/session";
import { apiError, apiOk } from "@/lib/auth/http";
import { db } from "@/lib/osf/supabase";
import { queueKey } from "@/lib/voice/queue";

export const dynamic = "force-dynamic";

/**
 * LEADS THE AGENT COULD RING.
 *
 * The desk's list of numbers does not only live in a spreadsheet. A lead who
 * came in through Instagram has no phone number from the platform, but very
 * often typed one into the DM — `phone-capture.ts` reads it out and stores it,
 * and this is where those numbers become something you can actually call.
 *
 * Read-only, and it queues nothing. The operator still chooses who is rung.
 */

/** Long enough to work through in a sitting; not a list nobody reads. */
const MAX = 100;

export async function GET(req: Request) {
  try {
    const session = await requirePermission("customers.write");
    const brandId = resolveBrandId(read(), new URL(req.url).searchParams.get("brand") ?? undefined);
    assertBrandAccess(session, brandId);

    // Already queued, ringing, or called in this run — offering them again is
    // how somebody gets rung twice.
    const spokenFor = new Set(
      (read().voiceCallQueue ?? [])
        .filter((e) => e.brandId === brandId && e.status !== "cancelled")
        .map((e) => queueKey(e.phone)),
    );

    let rows: { id: string; name: string | null; phone: string | null; source: string | null }[] = [];
    let unavailable: string | null = null;
    try {
      const { data, error } = await db()
        .from("villa_leads")
        .select("id, name, phone, source, lead_temperature, last_contact_at")
        .not("phone", "is", null)
        .eq("opted_out", false)
        .order("last_contact_at", { ascending: false, nullsFirst: false })
        .limit(MAX * 2);
      if (error) throw new Error(error.message);
      rows = data ?? [];
    } catch (e) {
      // The lead database is a separate Supabase project and may not be
      // configured yet. That is a setup state, not a fault: the paste box
      // still works, so this says so plainly instead of failing the screen.
      unavailable =
        "The lead database is not connected, so leads cannot be listed. Pasting numbers still works.";
    }

    const leads = rows
      .filter((l) => l.phone && !spokenFor.has(queueKey(l.phone)))
      .slice(0, MAX)
      .map((l) => ({ id: l.id, name: l.name, phone: l.phone as string, source: l.source }));

    return apiOk({ leads, unavailable });
  } catch (e) {
    return apiError(e);
  }
}
