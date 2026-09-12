"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.READ_FILTERS = exports.SEVERITIES = void 0;
exports.isSeverity = isSeverity;
exports.parseReadFilter = parseReadFilter;
exports.listNotifications = listNotifications;
exports.unreadCount = unreadCount;
exports.notificationSummary = notificationSummary;
exports.markRead = markRead;
exports.markAllRead = markAllRead;
exports.createNotification = createNotification;
const supabase_1 = require("./supabase");
/** Ordered most to least urgent — the notification centre renders in this order. */
exports.SEVERITIES = ["critical", "warning", "success", "info"];
function isSeverity(value) {
    return typeof value === "string" && exports.SEVERITIES.includes(value);
}
exports.READ_FILTERS = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "read", label: "Read" },
];
/** Narrows an untrusted `?read=` value; anything unrecognised falls back. */
function parseReadFilter(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw === "unread" || raw === "read" ? raw : "all";
}
async function listNotifications(query = {}) {
    let request = (0, supabase_1.db)()
        .from("villa_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(query.limit ?? 100);
    if (query.read === "unread")
        request = request.eq("is_read", false);
    if (query.read === "read")
        request = request.eq("is_read", true);
    if (query.kind)
        request = request.eq("kind", query.kind);
    const { data } = await request;
    return (data ?? []);
}
async function unreadCount() {
    const { count } = await (0, supabase_1.db)()
        .from("villa_notifications")
        .select("id", { count: "exact", head: true })
        .eq("is_read", false);
    return count ?? 0;
}
/** How many rows the breakdown pass reads before it stops counting. */
const BREAKDOWN_CAP = 2000;
/**
 * Headline counts plus the kind/severity breakdown.
 *
 * PostgREST cannot group, so the breakdown is derived in JS from a capped
 * read while total and unread come from exact count queries. The two are
 * reported separately rather than blended: a breakdown that silently stopped
 * at 2,000 rows would otherwise contradict the headline and look like a bug.
 */
async function notificationSummary() {
    const [totalResult, unread, sample] = await Promise.all([
        (0, supabase_1.db)().from("villa_notifications").select("id", { count: "exact", head: true }),
        unreadCount(),
        (0, supabase_1.db)()
            .from("villa_notifications")
            .select("kind, severity, is_read")
            .order("created_at", { ascending: false })
            .limit(BREAKDOWN_CAP),
    ]);
    const rows = (sample.data ?? []);
    const kinds = new Map();
    const severities = new Map(exports.SEVERITIES.map((s) => [s, 0]));
    for (const row of rows) {
        const entry = kinds.get(row.kind) ?? { kind: row.kind, total: 0, unread: 0 };
        entry.total += 1;
        if (!row.is_read)
            entry.unread += 1;
        kinds.set(row.kind, entry);
        if (severities.has(row.severity)) {
            severities.set(row.severity, (severities.get(row.severity) ?? 0) + 1);
        }
    }
    return {
        total: totalResult.count ?? 0,
        unread,
        byKind: [...kinds.values()].sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind)),
        bySeverity: exports.SEVERITIES.map((severity) => ({ severity, total: severities.get(severity) ?? 0 })),
        capped: rows.length >= BREAKDOWN_CAP,
    };
}
async function markRead(id) {
    await (0, supabase_1.db)().from("villa_notifications").update({ is_read: true }).eq("id", id);
}
async function markAllRead() {
    await (0, supabase_1.db)().from("villa_notifications").update({ is_read: true }).eq("is_read", false);
}
async function createNotification(input) {
    const { data, error } = await (0, supabase_1.db)()
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
    if (error)
        throw new Error(error.message);
    return data.id;
}
