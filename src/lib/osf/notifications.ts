import { db } from "./supabase";

/**
 * Reads and writes for /notifications (villa_notifications, migration 0009).
 *
 * Rows are only ever written by something that actually happened — an
 * automation that matched, a handoff, a due follow-up. Nothing here
 * manufactures a notification to fill an empty list.
 */

export type InsightSeverity = "info" | "warning" | "critical" | "success";

/** Ordered most to least urgent — the notification centre renders in this order. */
export const SEVERITIES: InsightSeverity[] = ["critical", "warning", "success", "info"];

export function isSeverity(value: unknown): value is InsightSeverity {
  return typeof value === "string" && (SEVERITIES as string[]).includes(value);
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  severity: InsightSeverity;
  href: string | null;
  is_read: boolean;
  lead_id: string | null;
  created_at: string;
}

export type ReadFilter = "all" | "unread" | "read";

export const READ_FILTERS: Array<{ key: ReadFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
];

/** Narrows an untrusted `?read=` value; anything unrecognised falls back. */
export function parseReadFilter(value: string | string[] | undefined | null): ReadFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "unread" || raw === "read" ? raw : "all";
}

export interface NotificationQuery {
  read?: ReadFilter;
  /** Exact `kind` match. Undefined means every kind. */
  kind?: string | null;
  limit?: number;
}

export async function listNotifications(query: NotificationQuery = {}): Promise<Notification[]> {
  let request = db()
    .from("villa_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(query.limit ?? 100);

  if (query.read === "unread") request = request.eq("is_read", false);
  if (query.read === "read") request = request.eq("is_read", true);
  if (query.kind) request = request.eq("kind", query.kind);

  const { data } = await request;
  return (data ?? []) as Notification[];
}

export async function unreadCount(): Promise<number> {
  const { count } = await db()
    .from("villa_notifications")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false);
  return count ?? 0;
}

/** How many rows the breakdown pass reads before it stops counting. */
const BREAKDOWN_CAP = 2000;

export interface KindCount {
  kind: string;
  total: number;
  unread: number;
}

export interface NotificationSummary {
  /** Exact, from a count query — never the capped sample. */
  total: number;
  unread: number;
  byKind: KindCount[];
  bySeverity: Array<{ severity: InsightSeverity; total: number }>;
  /** True when the breakdown hit BREAKDOWN_CAP, so it is a floor not a total. */
  capped: boolean;
}

/**
 * Headline counts plus the kind/severity breakdown.
 *
 * PostgREST cannot group, so the breakdown is derived in JS from a capped
 * read while total and unread come from exact count queries. The two are
 * reported separately rather than blended: a breakdown that silently stopped
 * at 2,000 rows would otherwise contradict the headline and look like a bug.
 */
export async function notificationSummary(): Promise<NotificationSummary> {
  const [totalResult, unread, sample] = await Promise.all([
    db().from("villa_notifications").select("id", { count: "exact", head: true }),
    unreadCount(),
    db()
      .from("villa_notifications")
      .select("kind, severity, is_read")
      .order("created_at", { ascending: false })
      .limit(BREAKDOWN_CAP),
  ]);

  const rows = (sample.data ?? []) as Array<{
    kind: string;
    severity: InsightSeverity;
    is_read: boolean;
  }>;

  const kinds = new Map<string, KindCount>();
  const severities = new Map<InsightSeverity, number>(SEVERITIES.map((s) => [s, 0]));

  for (const row of rows) {
    const entry = kinds.get(row.kind) ?? { kind: row.kind, total: 0, unread: 0 };
    entry.total += 1;
    if (!row.is_read) entry.unread += 1;
    kinds.set(row.kind, entry);
    if (severities.has(row.severity)) {
      severities.set(row.severity, (severities.get(row.severity) ?? 0) + 1);
    }
  }

  return {
    total: totalResult.count ?? 0,
    unread,
    byKind: [...kinds.values()].sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind)),
    bySeverity: SEVERITIES.map((severity) => ({ severity, total: severities.get(severity) ?? 0 })),
    capped: rows.length >= BREAKDOWN_CAP,
  };
}

export async function markRead(id: string): Promise<void> {
  await db().from("villa_notifications").update({ is_read: true }).eq("id", id);
}

export async function markAllRead(): Promise<void> {
  await db().from("villa_notifications").update({ is_read: true }).eq("is_read", false);
}

export async function createNotification(input: {
  kind: string;
  title: string;
  description?: string | null;
  severity?: InsightSeverity;
  href?: string | null;
  leadId?: string | null;
}): Promise<string> {
  const { data, error } = await db()
    .from("villa_notifications")
    .insert({
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      severity: input.severity ?? "info",
      href: input.href ?? null,
      lead_id: input.leadId ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
