"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateLead = getOrCreateLead;
exports.getOrCreateConversation = getOrCreateConversation;
exports.handleInbound = handleInbound;
const supabase_1 = require("./supabase");
const activities_1 = require("./activities");
const agent_1 = require("./agent");
const locks_1 = require("./locks");
const inbound_media_1 = require("./whatsapp/inbound-media");
const env_1 = require("./env");
const execute_1 = require("./agent/execute");
/**
 * The single inbound path.
 *
 * Both the WhatsApp webhook and the dashboard simulator funnel through here so
 * that what you test locally is byte-for-byte the behaviour customers get.
 */
/**
 * Runs the automation rules for a trigger without ever being able to break the
 * reply.
 *
 * Imported lazily so the automations engine — which pulls in the Kanban and
 * notification modules — is only loaded on the path that needs it. The
 * try/catch is the point of the function: a rule an operator mis-configured
 * yesterday must not stop a customer getting an answer today, so a failure is
 * logged and swallowed here rather than propagating into the webhook.
 */
async function fireAutomations(triggerEvent, lead, opts = {}) {
    try {
        let subject = lead;
        if (opts.reload) {
            // The agent's tools write budget, timeline, score and stage straight to
            // the row, so the caller's copy is stale by the time a turn finishes.
            const { data } = await (0, supabase_1.db)()
                .from("villa_leads")
                .select("*")
                .eq("id", lead.id)
                .maybeSingle();
            if (data)
                subject = data;
        }
        const { runAutomations } = await Promise.resolve().then(() => __importStar(require("./automations")));
        await runAutomations(triggerEvent, subject);
    }
    catch (e) {
        console.error(`[automations] ${triggerEvent} failed:`, e);
    }
}
async function getOrCreateLead(params) {
    const a = params.attribution ?? {};
    // Instagram identifies people by an opaque IGSID, so it gets its own
    // keyed upsert rather than a synthetic phone number that would later be
    // mistaken for something we could actually send a WhatsApp message to.
    if (params.instagramId) {
        const { data, error } = await (0, supabase_1.db)().rpc("villa_upsert_lead_instagram", {
            p_instagram_id: params.instagramId,
            p_name: params.name ?? null,
            p_source: a.source ?? "instagram",
        });
        if (error)
            throw new Error(`Could not create lead: ${error.message}`);
        const row = (Array.isArray(data) ? data[0] : data);
        if (!row?.lead)
            throw new Error("Could not create lead: no row returned");
        if (row.created) {
            await (0, activities_1.logActivity)({
                leadId: row.lead.id,
                type: "lead_created",
                description: "New lead from Instagram DM",
                channel: "instagram",
            });
            await fireAutomations("lead_created", row.lead);
        }
        return row.lead;
    }
    if (!params.phone) {
        throw new Error("getOrCreateLead needs either a phone number or an Instagram id");
    }
    // One statement, not select-then-insert. Two webhooks for the same new
    // number used to both see "no lead" and both insert; the unique index then
    // turned the loser into a hard error that dropped a real customer message.
    const { data, error } = await (0, supabase_1.db)().rpc("villa_upsert_lead", {
        p_phone: params.phone,
        p_name: params.name ?? null,
        p_source: a.source ?? params.channel ?? "whatsapp",
        p_campaign: a.campaign ?? null,
        p_ad_id: a.adId ?? null,
        p_creative: a.creative ?? null,
        p_keyword: a.keyword ?? null,
        p_landing_page: a.landingPage ?? null,
        p_referrer: a.referrer ?? null,
        p_utm: a.utm ?? {},
    });
    if (error)
        throw new Error(`Could not create lead: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data);
    if (!row?.lead)
        throw new Error("Could not create lead: no row returned");
    const lead = row.lead;
    // Only the caller that actually inserted announces the lead, so twenty
    // racing messages produce one "new lead" activity, not twenty.
    if (row.created) {
        await (0, activities_1.logActivity)({
            leadId: lead.id,
            type: "lead_created",
            description: `New lead from ${lead.campaign ? `${lead.source} · ${lead.campaign}` : lead.source}`,
            channel: params.channel ?? "whatsapp",
        });
        await fireAutomations("lead_created", lead);
    }
    return lead;
}
async function getOrCreateConversation(leadId, channel = "whatsapp") {
    // Backed by a partial unique index on (lead_id, channel) where status =
    // 'open', so "at most one open thread" is a database rule rather than an
    // application hope.
    const { data, error } = await (0, supabase_1.db)().rpc("villa_upsert_conversation", {
        p_lead_id: leadId,
        p_channel: channel,
    });
    if (error)
        throw new Error(`Could not create conversation: ${error.message}`);
    const conv = (Array.isArray(data) ? data[0] : data);
    if (!conv)
        throw new Error("Could not create conversation: no row returned");
    return conv;
}
/**
 * Processes one inbound customer message end to end.
 *
 * Returns `skipped` rather than throwing for the three cases where staying
 * quiet is the correct behaviour: a redelivered webhook, a customer who opted
 * out, and a conversation a human has taken over.
 */
/**
 * `villa_messages.media_kind` is a Postgres ENUM shared with `villa_assets`,
 * whose values describe OUTBOUND sales collateral — brochure, image,
 * master_plan, other. Inbound media is a different vocabulary: a voice note, a
 * PDF the buyer scanned, a video of the plot.
 *
 * Writing "audio" into that column did not degrade, it THREW — and the insert
 * that threw was the customer's own message, so a voice note vanished
 * completely: not stored, not answered, no trace beyond a line in the server
 * log. Mapped onto the values the column accepts so the message always lands;
 * the transcript, filename and stored file carry the real detail.
 */
function dbMediaKind(kind) {
    return kind === "image" ? "image" : "other";
}
async function handleInbound(params) {
    const supabase = (0, supabase_1.db)();
    const channel = params.channel ?? "whatsapp";
    const lead = await getOrCreateLead({
        phone: params.phone,
        instagramId: params.instagramId,
        name: params.profileName,
        channel,
        attribution: params.attribution,
    });
    const conversation = await getOrCreateConversation(lead.id, channel);
    // Upload before the insert so the row carries the path from the start — a
    // message that pointed at a file only after a second write would be a window
    // in which the thread showed a voice note with nothing behind it. A failed
    // upload yields null and the message is still recorded.
    const mediaPath = params.media ? await (0, inbound_media_1.storeInboundMedia)(lead.id, params.media) : null;
    const mediaColumns = params.media
        ? { media_kind: dbMediaKind(params.media.kind), media_url: mediaPath }
        : {};
    // Meta redelivers on any non-200, so the same message can arrive twice.
    // The unique index on wa_message_id makes this idempotent.
    if (params.waMessageId) {
        const { error } = await supabase.from("villa_messages").insert({
            conversation_id: conversation.id,
            lead_id: lead.id,
            role: "customer",
            body: params.text,
            wa_message_id: params.waMessageId,
            ...mediaColumns,
        });
        if (error) {
            // 23505 = unique violation = we already answered this one.
            if (error.code === "23505") {
                return { status: "skipped", reason: "duplicate", lead };
            }
            throw new Error(`Could not record message: ${error.message}`);
        }
    }
    else {
        await supabase.from("villa_messages").insert({
            conversation_id: conversation.id,
            lead_id: lead.id,
            role: "customer",
            body: params.text,
            ...mediaColumns,
        });
    }
    // Recorded above, deliberately not answered. Same shape as every other
    // "stored but no reply" outcome so callers need no special case.
    if (params.reply === false) {
        return { status: "skipped", reason: "not_addressed", lead };
    }
    // Section 25: an opt-out is absolute. Record the message, send nothing.
    if (lead.opted_out) {
        return { status: "skipped", reason: "opted_out", lead };
    }
    // Section 46: a human has taken over this conversation.
    if (lead.ai_paused) {
        return { status: "skipped", reason: "ai_paused", lead };
    }
    // Serialise per conversation.
    //
    // WhatsApp delivers each message as its own webhook, so a customer firing
    // off three lines in a row produces three concurrent runs. Unserialised they
    // all read the same history and all reply, and the customer gets three
    // answers that ignore each other. Holding the lock means message two waits
    // for message one to finish and then sees it in the transcript.
    //
    // Different customers take different keys, so this never serialises the
    // system as a whole — only one person's own thread.
    // Everything the turn actually sent, so the location guarantee below can tell
    // whether the customer already got the link.
    const sent = [];
    const deliver = async (reply) => {
        sent.push(reply);
        await params.deliver(reply);
    };
    const result = await (0, locks_1.withLock)((0, locks_1.conversationLockKey)(lead.id), () => (0, agent_1.runAgent)({
        lead,
        conversation,
        customerMessage: params.text,
        deliver,
    }), {
        // Short: a customer's own back-to-back messages should not each wait out
        // a full 45s turn behind the previous one. If the thread is busy, skip
        // (the message is already stored; the running turn will see it in the
        // transcript) rather than queue a slow backlog. One genuine message with
        // no contention still acquires the lock immediately.
        waitMs: 8_000,
        // Groq's free tier stretches a tool-heavy turn past 4 minutes, and a
        // lease that expires mid-turn hands the lock to the next message —
        // exactly the overlap it exists to prevent. 6 minutes covers the worst
        // observed turn; a crashed worker still frees the thread in that time.
        ttlSeconds: 360,
        onBusy: () => null,
    });
    // The message is already recorded, so the run that holds the lock will pick
    // it up in the transcript. Staying quiet beats replying twice.
    if (result === null) {
        return { status: "skipped", reason: "busy", lead };
    }
    // GUARANTEE: someone who asked where the project is gets the map link.
    //
    // The location is the one asset that is not a file — it is a Google Maps
    // link, and the only correct way to deliver it is as text the customer can
    // tap. Attaching it as a document produced `location-map.pdf`, 220 KB of
    // HTML that opens to nothing. Leaving it to the model produced the opposite
    // failure: the link retyped from memory with a character added, and, when
    // the model was rate-limited, no link at all.
    //
    // So it is sent from here, verbatim from the configured value, and only when
    // the turn did not already carry it.
    await ensureLocationLink(params.text, sent, lead, conversation.id, deliver);
    // GUARANTEE: "send me the brochure" means both of them.
    //
    // There are two approved brochures — the full one and the mini one with the
    // area statement — and asking for "the brochure" has always meant both. The
    // model sends both when it is healthy; this tops up whichever it missed.
    await ensureAllBrochures(params.text, sent, lead, conversation.id, deliver);
    // Fired only after the reply has been delivered, so a rule can never delay
    // or block what the customer sees.
    await fireAutomations("lead_status_changed", lead, { reload: true });
    return { status: "handled", result, lead };
}
/** "Where is it?", in the forms customers actually type it. */
function asksForLocation(text) {
    const t = text.toLowerCase();
    if (/\b(floor\s?plan|brochure|price|layout plan)\b/.test(t))
        return false;
    return /\b(location|address|directions?|google\s?maps?|map link|pin)\b/.test(t) ||
        /where (is|are|exactly)|where'?s |how do i (get|reach)|kahan|site address/.test(t);
}
/**
 * Sends the configured Google Maps link as plain text, unless this turn
 * already did. Never throws — a missed link must not fail the webhook.
 */
async function ensureLocationLink(customerText, sent, lead, conversationId, deliver) {
    const link = env_1.env.projectMapsUrl;
    if (!link || !asksForLocation(customerText))
        return;
    if (sent.some((r) => typeof r.text === "string" && r.text.includes(link)))
        return;
    const body = `Here is the exact location on Google Maps:\n${link}`;
    try {
        await deliver({ text: body });
        await (0, supabase_1.db)().from("villa_messages").insert({
            conversation_id: conversationId,
            lead_id: lead.id,
            role: "agent",
            body,
        });
    }
    catch {
        /* the customer still has the rest of the turn */
    }
}
/**
 * Sends any approved brochure the turn did not already deliver.
 *
 * Only fires when the customer actually asked for one, and only for files that
 * were not already sent in this same turn — so a healthy model turn that sent
 * both adds nothing, and a degraded turn that sent one is completed.
 */
async function ensureAllBrochures(customerText, sent, lead, conversationId, deliver) {
    if (!/\b(brochure|brochures|catalog|catalogue)\b/i.test(customerText))
        return;
    const already = new Set(sent.map((r) => r.mediaUrl).filter((u) => typeof u === "string"));
    try {
        await (0, execute_1.deliverApprovedAssets)({
            lead,
            conversationId,
            kind: "brochure",
            deliver,
            skip: already,
        });
    }
    catch {
        /* the customer still has the rest of the turn */
    }
}
