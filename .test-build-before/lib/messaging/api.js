"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MEDIA_BYTES = exports.PAGE_SIZE = void 0;
exports.fetchProfiles = fetchProfiles;
exports.toMessage = toMessage;
exports.fetchMessages = fetchMessages;
exports.fetchReadIds = fetchReadIds;
exports.markRead = markRead;
exports.sendMessage = sendMessage;
exports.toggleReaction = toggleReaction;
exports.editMessage = editMessage;
exports.deleteMessage = deleteMessage;
exports.uploadMedia = uploadMedia;
exports.mediaUrl = mediaUrl;
/**
 * Messaging data access.
 *
 * Everything here runs through the *anon* client carrying the user's session, so
 * RLS is the security boundary. Nothing in this file uses the service role — if
 * a query needs it, that is a missing policy, not a reason to escalate.
 */
const MEDIA_BUCKET = "message-media";
exports.PAGE_SIZE = 50;
function toProfile(r) {
    const dept = Array.isArray(r.departments) ? r.departments[0] : r.departments;
    return {
        id: r.id,
        fullName: r.full_name?.trim() || r.email.split("@")[0],
        email: r.email,
        department: dept?.key ?? null,
    };
}
async function fetchProfiles(sb) {
    const { data, error } = await sb
        .from("profiles")
        .select("id, full_name, email, departments(key)")
        .eq("active", true)
        .order("full_name");
    if (error)
        throw error;
    return data.map(toProfile);
}
function toMessage(r, byId) {
    return {
        id: r.id,
        orgId: r.org_id,
        senderId: r.sender_id,
        recipientType: r.recipient_type,
        recipientId: r.recipient_id,
        body: r.body,
        createdAt: r.created_at,
        editedAt: r.edited_at,
        deletedAt: r.deleted_at,
        sender: byId.get(r.sender_id),
        recipient: r.recipient_id ? byId.get(r.recipient_id) : undefined,
    };
}
/**
 * Newest-first from the database, reversed to chronological for rendering.
 * Paginating on `created_at` rather than an offset keeps the window stable while
 * new messages arrive underneath.
 */
async function fetchMessages(sb, profiles, opts = {}) {
    const limit = opts.limit ?? exports.PAGE_SIZE;
    let q = sb
        .from("messages")
        .select("id, org_id, sender_id, recipient_type, recipient_id, body, created_at, edited_at, deleted_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit + 1);
    if (opts.beforeCreatedAt)
        q = q.lt("created_at", opts.beforeCreatedAt);
    const { data, error } = await q;
    if (error)
        throw error;
    const rows = data;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { messages: page.reverse().map((r) => toMessage(r, profiles)), hasMore };
}
/** Which of these message ids the current user has already read. */
async function fetchReadIds(sb, profileId, messageIds) {
    if (!messageIds.length)
        return new Set();
    const { data, error } = await sb
        .from("message_reads")
        .select("message_id")
        .eq("profile_id", profileId)
        .in("message_id", messageIds);
    if (error)
        throw error;
    return new Set(data.map((r) => r.message_id));
}
async function markRead(sb, profileId, messageIds) {
    if (!messageIds.length)
        return;
    // Upsert so a re-read is a no-op rather than a duplicate-key error.
    const { error } = await sb
        .from("message_reads")
        .upsert(messageIds.map((message_id) => ({ message_id, profile_id: profileId })), {
        onConflict: "message_id,profile_id",
        ignoreDuplicates: true,
    });
    if (error)
        throw error;
}
async function sendMessage(sb, input) {
    const { data, error } = await sb
        .from("messages")
        .insert({
        org_id: input.orgId,
        sender_id: input.senderId,
        recipient_type: input.recipientType,
        // The CHECK constraint requires this to be null for a broadcast.
        recipient_id: input.recipientType === "everyone" ? null : input.recipientId,
        body: input.body,
    })
        .select("id, org_id, sender_id, recipient_type, recipient_id, body, created_at, edited_at, deleted_at")
        .single();
    if (error)
        throw error;
    return toMessage(data, new Map());
}
/**
 * Toggling a reaction rewrites someone else's row, so it goes through the
 * definer function rather than a broad UPDATE policy.
 */
async function toggleReaction(sb, messageId, emoji) {
    const { error } = await sb.rpc("toggle_message_reaction", { p_message_id: messageId, p_emoji: emoji });
    if (error)
        throw error;
}
async function editMessage(sb, messageId, body) {
    const { error } = await sb.from("messages").update({ body, edited_at: new Date().toISOString() }).eq("id", messageId);
    if (error)
        throw error;
}
/** Soft delete, so a reply that quotes it still renders. */
async function deleteMessage(sb, messageId) {
    const { error } = await sb.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", messageId);
    if (error)
        throw error;
}
/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */
exports.MAX_MEDIA_BYTES = 15 * 1024 * 1024;
async function uploadMedia(sb, orgId, file, filename) {
    if (file.size > exports.MAX_MEDIA_BYTES)
        throw new Error("File is larger than 15MB");
    const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const path = `${orgId}/${crypto.randomUUID()}.${ext || "bin"}`;
    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
    });
    if (error)
        throw error;
    return path;
}
/** Short-lived signed URL. The bucket is private; nothing is ever public. */
async function mediaUrl(sb, path) {
    if (path.startsWith("data:"))
        return path; // legacy inline payload
    const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(path, 300);
    if (error)
        return null;
    return data.signedUrl;
}
