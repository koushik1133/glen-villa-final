import { db } from "../supabase";

/**
 * Delivery receipts.
 *
 * Meta reports sent → delivered → read against the message id we got back when
 * we sent. Without recording these, every read rate in the dashboard is zero
 * and broadcasts look like they failed when they actually landed.
 *
 * Receipts arrive out of order — a `delivered` can follow a `read` — so status
 * only ever moves forward. Otherwise a late `delivered` would quietly downgrade
 * a message the customer has already opened.
 */

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export interface StatusUpdate {
  id: string;
  status: string;
  timestamp?: string;
  errors?: Array<{ title?: string; message?: string; code?: number }>;
}

function tsToIso(timestamp?: string): string {
  // Meta sends Unix seconds as a string.
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

export async function recordStatuses(statuses: StatusUpdate[]): Promise<void> {
  const supabase = db();

  for (const s of statuses) {
    const rank = RANK[s.status];
    if (!rank || !s.id) continue;

    const at = tsToIso(s.timestamp);
    const error = s.errors?.[0]
      ? `${s.errors[0].code ?? ""} ${s.errors[0].title ?? ""} ${s.errors[0].message ?? ""}`.trim()
      : null;

    const patch: Record<string, unknown> = { delivery_status: s.status };
    if (s.status === "delivered") patch.delivered_at = at;
    if (s.status === "read") patch.read_at = at;
    if (s.status === "failed") patch.error = error;

    // Only move forward. `in` on the states that rank below this one is what
    // stops an out-of-order receipt from undoing a later one.
    const behind = Object.entries(RANK)
      .filter(([, r]) => r < rank)
      .map(([name]) => name);

    await supabase
      .from("villa_messages")
      .update(patch)
      .eq("wa_message_id", s.id)
      .or(`delivery_status.is.null,delivery_status.in.(${behind.join(",")})`);

    // Broadcast recipients are tracked separately so a 5,000-row send can be
    // reported on without scanning the whole message table.
    const rPatch: Record<string, unknown> = {};
    if (s.status === "delivered") {
      rPatch.status = "delivered";
      rPatch.delivered_at = at;
    } else if (s.status === "read") {
      rPatch.status = "read";
      rPatch.read_at = at;
    } else if (s.status === "failed") {
      rPatch.status = "failed";
      rPatch.error = error;
    }

    if (Object.keys(rPatch).length > 0) {
      await supabase
        .from("villa_broadcast_recipients")
        .update(rPatch)
        .eq("wa_message_id", s.id)
        .or(`status.in.(${behind.join(",")}),status.eq.queued`);
    }
  }
}
