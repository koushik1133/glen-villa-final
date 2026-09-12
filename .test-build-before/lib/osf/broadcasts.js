"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAudience = resolveAudience;
exports.prepareBroadcast = prepareBroadcast;
exports.sendBroadcastBatch = sendBroadcastBatch;
const supabase_1 = require("./supabase");
const client_1 = require("./whatsapp/client");
const client_2 = require("./evolution/client");
const outbound_1 = require("./whatsapp/outbound");
const locks_1 = require("./locks");
/**
 * Broadcast engine.
 *
 * Three rules shape everything here, and all three come from Meta rather than
 * from taste:
 *
 *  1. A broadcast reaches people outside the 24-hour service window, so it can
 *     only ever be an approved template. Free text is not an option, and this
 *     module refuses to pretend otherwise.
 *  2. An opted-out lead must never be contacted again. That is checked at send
 *     time, not at audience-build time, because a customer can opt out in the
 *     minutes between the two.
 *  3. Sends are rate-limited. A tight loop over 5,000 numbers gets the number
 *     throttled or flagged, so this paces itself and is resumable.
 *
 * Each recipient is its own row with its own status, so one bad number fails
 * alone instead of stalling or silently truncating the rest of the send.
 */
/** Meta's default is 80 messages/second; well under it is the safe place to be. */
const SENDS_PER_SECOND = 10;
const BATCH_SIZE = 50;
/**
 * Resolves a saved filter to leads.
 *
 * Opt-outs are excluded in the query rather than filtered afterwards, so an
 * opted-out lead never even reaches the queue — and is checked again at send.
 */
async function resolveAudience(filter) {
    let q = (0, supabase_1.db)()
        .from("villa_leads")
        .select("*")
        .eq("opted_out", false)
        .not("phone", "is", null);
    if (filter.temperature?.length)
        q = q.in("lead_temperature", filter.temperature);
    if (filter.stage?.length)
        q = q.in("pipeline_stage", filter.stage);
    if (filter.source?.length)
        q = q.in("source", filter.source);
    if (filter.campaign?.length)
        q = q.in("campaign", filter.campaign);
    if (typeof filter.minScore === "number")
        q = q.gte("lead_score", filter.minScore);
    if (filter.createdWithinDays) {
        const since = new Date(Date.now() - filter.createdWithinDays * 86_400_000).toISOString();
        q = q.gte("created_at", since);
    }
    const { data, error } = await q;
    if (error)
        throw new Error(`Could not resolve audience: ${error.message}`);
    return (data ?? []);
}
/** Builds the recipient queue. Idempotent — re-running will not double-queue. */
async function prepareBroadcast(broadcastId) {
    const supabase = (0, supabase_1.db)();
    const { data: broadcast, error } = await supabase
        .from("villa_broadcasts")
        .select("*")
        .eq("id", broadcastId)
        .single();
    if (error || !broadcast)
        throw new Error(`Broadcast ${broadcastId} not found`);
    if (!broadcast.template_id) {
        throw new Error("This broadcast has no template. Outside the 24-hour window Meta only accepts approved templates.");
    }
    const leads = await resolveAudience((broadcast.audience ?? {}));
    if (leads.length > 0) {
        // on_conflict makes a re-run a no-op rather than a duplicate send.
        const { error: insertError } = await supabase.from("villa_broadcast_recipients").upsert(leads.map((l) => ({ broadcast_id: broadcastId, lead_id: l.id, phone: l.phone })), { onConflict: "broadcast_id,lead_id", ignoreDuplicates: true });
        if (insertError)
            throw new Error(`Could not queue recipients: ${insertError.message}`);
    }
    const { count } = await supabase
        .from("villa_broadcast_recipients")
        .select("id", { count: "exact", head: false })
        .eq("broadcast_id", broadcastId);
    await supabase
        .from("villa_broadcasts")
        .update({ total: count ?? leads.length, status: "scheduled" })
        .eq("id", broadcastId);
    return { queued: count ?? leads.length };
}
/**
 * Fills {{1}}..{{n}} from the lead.
 *
 * A missing value becomes "" rather than the literal "null" — Meta renders the
 * placeholder verbatim, so a null would go out as "Hi null" to a real customer.
 */
function renderVariables(variables, lead) {
    if (!Array.isArray(variables))
        return [];
    return variables.map((v) => {
        if (typeof v !== "string")
            return "";
        // "@name" pulls from the lead; anything else is a literal.
        if (v.startsWith("@")) {
            const value = lead[v.slice(1)];
            return value == null ? "" : String(value);
        }
        return v;
    });
}
/** {{1}}-style placeholders, numbered exactly as Meta numbers them. */
function fillPlaceholders(body, params) {
    return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
}
/**
 * Sends one batch and returns what is left.
 *
 * Deliberately batched rather than looping to completion: a serverless request
 * has a wall-clock limit, and a 5,000-recipient send has to survive being cut
 * off partway. Call it until `done`.
 *
 * The whole run holds a lock on the broadcast so two triggers — a cron and an
 * impatient click on Send — cannot double-send to the same people.
 */
async function sendBroadcastBatch(broadcastId) {
    return (0, locks_1.withLock)(`broadcast:${broadcastId}`, () => runBatch(broadcastId), {
        waitMs: 0, // A second caller should back off, not queue up behind the first.
        ttlSeconds: 300,
        onBusy: () => ({ sent: 0, failed: 0, skipped: 0, remaining: -1, done: false }),
    });
}
async function runBatch(broadcastId) {
    const supabase = (0, supabase_1.db)();
    const { data: broadcast } = await supabase
        .from("villa_broadcasts")
        .select("*, template:villa_templates(*)")
        .eq("id", broadcastId)
        .single();
    if (!broadcast)
        throw new Error(`Broadcast ${broadcastId} not found`);
    if (broadcast.status === "paused" || broadcast.status === "cancelled") {
        return { sent: 0, failed: 0, skipped: 0, remaining: 0, done: true };
    }
    const template = broadcast.template;
    if (!template)
        throw new Error("Broadcast has no template attached");
    // Meta refuses unapproved templates outright, so sending would fail 100% —
    // stop the broadcast before it burns through the queue. Evolution has no
    // approval concept: the template is just our own copy of the text, and
    // "draft" is a perfectly sendable state there.
    const provider = (0, outbound_1.activeProvider)();
    if (provider === "meta" && template.status !== "approved") {
        await supabase
            .from("villa_broadcasts")
            .update({ status: "failed" })
            .eq("id", broadcastId);
        throw new Error(`Template "${template.name}" is ${template.status}, not approved. Meta will reject every message in this broadcast.`);
    }
    await supabase
        .from("villa_broadcasts")
        .update({ status: "sending", started_at: broadcast.started_at ?? new Date().toISOString() })
        .eq("id", broadcastId);
    // Claims and marks in-flight in a single statement (FOR UPDATE SKIP LOCKED),
    // so two workers can never hand the same person the same message.
    const { data: claimed, error: claimError } = await supabase.rpc("villa_claim_broadcast_batch", {
        p_broadcast_id: broadcastId,
        p_limit: BATCH_SIZE,
    });
    if (claimError)
        throw new Error(`Could not claim batch: ${claimError.message}`);
    const batch = (claimed ?? []);
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const recipient of batch) {
        // Re-read opt-out at send time. Audience resolution may have run hours ago,
        // and an opt-out between then and now is exactly the case that must not slip.
        const { data: lead } = await supabase
            .from("villa_leads")
            .select("*")
            .eq("id", recipient.lead_id)
            .single();
        if (!lead || lead.opted_out) {
            await supabase
                .from("villa_broadcast_recipients")
                .update({ status: "skipped", error: "opted out" })
                .eq("id", recipient.id);
            skipped += 1;
            continue;
        }
        try {
            const params = renderVariables(broadcast.variables, lead);
            const { messageId } = provider === "evolution"
                ? await (0, client_2.sendEvolutionText)(recipient.phone, fillPlaceholders(template.body, params))
                : await (0, client_1.sendTemplate)(recipient.phone, template.name, template.language, params);
            await supabase
                .from("villa_broadcast_recipients")
                .update({ status: "sent", wa_message_id: messageId, sent_at: new Date().toISOString() })
                .eq("id", recipient.id);
            sent += 1;
        }
        catch (e) {
            await supabase
                .from("villa_broadcast_recipients")
                .update({
                status: "failed",
                error: e instanceof Error ? e.message.slice(0, 500) : "send failed",
            })
                .eq("id", recipient.id);
            failed += 1;
        }
        // Pace the sends. Meta throttles, and a throttled number is a worse
        // outcome than a slower broadcast.
        await new Promise((r) => setTimeout(r, 1000 / SENDS_PER_SECOND));
    }
    const { count: remaining } = await supabase
        .from("villa_broadcast_recipients")
        .select("id", { count: "exact", head: true })
        .eq("broadcast_id", broadcastId)
        .eq("status", "queued");
    const done = (remaining ?? 0) === 0;
    await supabase
        .from("villa_broadcasts")
        .update({
        sent: (broadcast.sent ?? 0) + sent,
        failed: (broadcast.failed ?? 0) + failed,
        ...(done ? { status: "completed", completed_at: new Date().toISOString() } : {}),
    })
        .eq("id", broadcastId);
    return { sent, failed, skipped, remaining: remaining ?? 0, done };
}
