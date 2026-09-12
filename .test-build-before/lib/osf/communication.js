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
exports.OUTSIDE_WINDOW_MESSAGE = exports.WHATSAPP_ENV_VARS = exports.SERVICE_WINDOW_HOURS = exports.CONVERSATION_STATUSES = exports.CHANNEL_LABELS = exports.CHANNELS = void 0;
exports.channelLabel = channelLabel;
exports.listConversations = listConversations;
exports.loadThread = loadThread;
exports.inboxFacets = inboxFacets;
exports.serviceWindow = serviceWindow;
exports.windowLabel = windowLabel;
exports.lastInboundFrom = lastInboundFrom;
exports.sendWhatsAppText = sendWhatsAppText;
exports.sendWhatsAppTemplate = sendWhatsAppTemplate;
exports.setAiPaused = setAiPaused;
exports.leadsWithEmail = leadsWithEmail;
const activities_1 = require("./activities");
const env_1 = require("./env");
const supabase_1 = require("./supabase");
const outbound_1 = require("./whatsapp/outbound");
/**
 * The communication centre's data layer.
 *
 * One module behind the unified inbox, the WhatsApp console and the email page.
 * Meta's 24-hour rule is enforced here rather than in a page: hiding the
 * free-text box in the UI is a courtesy, but the API route is what actually has
 * to refuse, because a rejected send costs the customer their reply.
 */
// -----------------------------------------------------------------------------
// Channels and statuses
// -----------------------------------------------------------------------------
/** villa_comm_channel, in the order the enum declares it. */
exports.CHANNELS = [
    "whatsapp",
    "instagram",
    "facebook",
    "email",
    "sms",
    "web_form",
    "call",
];
exports.CHANNEL_LABELS = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    facebook: "Facebook",
    email: "Email",
    sms: "SMS",
    web_form: "Web form",
    call: "Call",
};
function channelLabel(channel) {
    return exports.CHANNEL_LABELS[channel] ?? channel.replace(/_/g, " ");
}
/**
 * villa_conversations.status is free text with a default of 'open' — no enum
 * constrains it. These are the two values the application itself ever writes,
 * so they are the only ones offered as filters.
 */
exports.CONVERSATION_STATUSES = ["open", "closed"];
const LEAD_EMBED = "lead:villa_leads(id, name, phone, email, lead_temperature, lead_score, pipeline_stage, ai_paused, opted_out, preferred_language)";
/**
 * `preview` is an embedded resource limited to one row *per conversation* —
 * PostgREST applies `limit` on an embed per parent, which is the only way to
 * get a last-message preview for a whole list in a single round-trip.
 */
const CONVERSATION_SELECT = [
    "id, lead_id, channel, status, started_at, last_message_at, message_count, summary",
    LEAD_EMBED,
    "preview:villa_messages(role, body, media_kind, created_at)",
].join(", ");
async function listConversations(filter = {}) {
    let query = (0, supabase_1.db)().from("villa_conversations").select(CONVERSATION_SELECT);
    if (filter.channel)
        query = query.eq("channel", filter.channel);
    if (filter.status)
        query = query.eq("status", filter.status);
    const { data } = await query
        .order("last_message_at", { ascending: false })
        .order("created_at", { referencedTable: "preview", ascending: false })
        .limit(1, { referencedTable: "preview" })
        .limit(filter.limit ?? 80);
    const rows = (data ?? []);
    return rows.map((row) => ({ ...row, preview: row.preview?.[0] ?? null }));
}
/** Null when the id doesn't exist — a stale `?c=` link must not 500 the page. */
async function loadThread(conversationId, limit = 300) {
    const supabase = (0, supabase_1.db)();
    const [{ data: conversation }, { data: messages }] = await Promise.all([
        supabase
            .from("villa_conversations")
            .select(`id, lead_id, channel, status, started_at, last_message_at, message_count, summary, ${LEAD_EMBED}`)
            .eq("id", conversationId)
            .maybeSingle(),
        supabase
            .from("villa_messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })
            .limit(limit),
    ]);
    if (!conversation)
        return null;
    const { lead, ...rest } = conversation;
    return { conversation: rest, lead: lead ?? null, messages: (messages ?? []) };
}
/**
 * Counts for the filter pills.
 *
 * Two columns of at most `cap` rows, tallied in memory. PostgREST has no
 * GROUP BY, and the alternative — one head-count request per channel per
 * status — is eighteen round-trips to render a sidebar.
 */
async function inboxFacets(cap = 2000) {
    const { data } = await (0, supabase_1.db)().from("villa_conversations").select("channel, status").limit(cap);
    const rows = (data ?? []);
    const facets = { total: rows.length, byChannel: {}, byStatus: {} };
    for (const row of rows) {
        facets.byChannel[row.channel] = (facets.byChannel[row.channel] ?? 0) + 1;
        facets.byStatus[row.status] = (facets.byStatus[row.status] ?? 0) + 1;
    }
    return facets;
}
// -----------------------------------------------------------------------------
// Meta's 24-hour customer-service window
// -----------------------------------------------------------------------------
exports.SERVICE_WINDOW_HOURS = 24;
/**
 * Meta only allows a free-form message within 24 hours of the customer's last
 * inbound one. Outside that, the sole legal outbound is an approved template.
 * A conversation that has never received an inbound message is *never* open —
 * an outbound-first thread has no window to be inside.
 */
function serviceWindow(lastInboundAt, now = Date.now()) {
    if (!lastInboundAt) {
        return { lastInboundAt: null, hoursSince: null, open: false, minutesLeft: null };
    }
    const at = new Date(lastInboundAt).getTime();
    if (Number.isNaN(at)) {
        return { lastInboundAt, hoursSince: null, open: false, minutesLeft: null };
    }
    const elapsedMs = now - at;
    const remainingMs = exports.SERVICE_WINDOW_HOURS * 3_600_000 - elapsedMs;
    const open = remainingMs > 0;
    return {
        lastInboundAt,
        hoursSince: elapsedMs / 3_600_000,
        open,
        minutesLeft: open ? Math.floor(remainingMs / 60_000) : null,
    };
}
/** "3h 12m left" / "closed 5h ago" — the phrasing the console shows a rep. */
function windowLabel(window) {
    if (window.hoursSince === null)
        return "No inbound message yet";
    if (window.open && window.minutesLeft !== null) {
        const hours = Math.floor(window.minutesLeft / 60);
        const minutes = window.minutesLeft % 60;
        return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
    }
    const closedFor = window.hoursSince - exports.SERVICE_WINDOW_HOURS;
    return closedFor >= 24
        ? `Closed ${Math.floor(closedFor / 24)}d ago`
        : `Closed ${Math.max(0, Math.floor(closedFor))}h ago`;
}
function lastInboundFrom(messages) {
    let latest = null;
    for (const message of messages) {
        if (message.role !== "customer")
            continue;
        if (!latest || message.created_at > latest)
            latest = message.created_at;
    }
    return latest;
}
async function lastInboundAt(conversationId) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_messages")
        .select("created_at")
        .eq("conversation_id", conversationId)
        .eq("role", "customer")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    return data?.created_at ?? null;
}
exports.WHATSAPP_ENV_VARS = [
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
];
const NOT_CONFIGURED = "WhatsApp isn't connected. Set the WHATSAPP_* variables in .env.local before sending.";
exports.OUTSIDE_WINDOW_MESSAGE = "The 24-hour customer-service window has closed. Meta rejects free-form text here — " +
    "send an approved template to re-open the conversation.";
async function loadTarget(conversationId) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_conversations")
        .select("id, message_count, channel, lead:villa_leads(id, phone, opted_out, name, instagram_id)")
        .eq("id", conversationId)
        .maybeSingle();
    if (!data)
        return { error: "That conversation no longer exists." };
    const row = data;
    if (!row.lead) {
        return { error: "This conversation has no lead attached, so there is nobody to reply to." };
    }
    if (row.channel !== "whatsapp") {
        return { error: `This is a ${channelLabel(row.channel)} thread — only WhatsApp can be replied to from here.` };
    }
    return {
        conversation: { id: row.id, message_count: row.message_count, channel: row.channel },
        lead: row.lead,
    };
}
/**
 * Writes what we just sent into the thread and hands the conversation to the
 * human who sent it.
 *
 * Pausing the AI is part of sending rather than a separate button: the agent
 * replying on top of a rep is the failure mode this whole console exists to
 * prevent, and a rep should not have to remember a second click to avoid it.
 */
async function recordOutbound(params) {
    const supabase = (0, supabase_1.db)();
    const now = new Date().toISOString();
    const { error } = await supabase.from("villa_messages").insert({
        conversation_id: params.target.conversation.id,
        lead_id: params.target.lead.id,
        role: "human_agent",
        channel: "whatsapp",
        body: params.body,
        wa_message_id: params.waMessageId,
    });
    // Meta has already delivered the message by this point, so a failed write is
    // a logging problem, not a send failure. Reporting it as one would tell the
    // rep to send again — which would actually double-message the customer.
    if (error)
        console.error("[communication] could not record outbound message:", error.message);
    await supabase
        .from("villa_conversations")
        .update({ last_message_at: now, message_count: params.target.conversation.message_count + 1 })
        .eq("id", params.target.conversation.id);
    await supabase
        .from("villa_leads")
        .update({ ai_paused: true, last_contact_at: now })
        .eq("id", params.target.lead.id);
    await (0, activities_1.logActivity)({
        leadId: params.target.lead.id,
        type: "message_sent",
        description: params.activityDescription,
        channel: "whatsapp",
        metadata: { conversation_id: params.target.conversation.id, sent_by: "human" },
    });
}
async function sendWhatsAppText(input) {
    if (!(0, env_1.configStatus)().whatsapp)
        return { ok: false, error: NOT_CONFIGURED };
    const body = input.text?.trim();
    if (!body)
        return { ok: false, error: "Type a message before sending." };
    if (body.length > 4096)
        return { ok: false, error: "WhatsApp caps a text message at 4096 characters." };
    const target = await loadTarget(input.conversationId);
    if ("error" in target)
        return { ok: false, error: target.error };
    if (target.lead.opted_out) {
        return { ok: false, error: "This customer opted out. Nothing may be sent to them." };
    }
    // Re-checked server-side: the UI hides the box, but a stale tab still has it.
    if (!serviceWindow(await lastInboundAt(input.conversationId)).open) {
        return { ok: false, error: exports.OUTSIDE_WINDOW_MESSAGE };
    }
    let messageId = null;
    try {
        if (target.lead.phone) {
            ({ messageId } = await (0, outbound_1.sendPlainText)(target.lead.phone, body));
        }
        else if (target.lead.instagram_id) {
            // Instagram-only lead: same inbox, different transport.
            const { sendInstagramText } = await Promise.resolve().then(() => __importStar(require("./instagram/client")));
            ({ messageId } = await sendInstagramText(target.lead.instagram_id, body));
        }
        else {
            return { ok: false, error: "This lead has no phone number or Instagram id to send to." };
        }
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
    }
    await recordOutbound({
        target,
        body,
        waMessageId: messageId,
        activityDescription: "Rep replied on WhatsApp",
    });
    return { ok: true, messageId };
}
/** Meta's rule: lowercase letters, digits and underscores only. */
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_CODE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
async function sendWhatsAppTemplate(input) {
    if (!(0, env_1.configStatus)().whatsapp)
        return { ok: false, error: NOT_CONFIGURED };
    const name = input.templateName?.trim().toLowerCase();
    if (!name)
        return { ok: false, error: "A template name is required." };
    if (!TEMPLATE_NAME.test(name)) {
        return {
            ok: false,
            error: `"${input.templateName}" isn't a valid template name — Meta allows lowercase letters, digits and underscores.`,
        };
    }
    const language = input.language?.trim() || "en";
    if (!LANGUAGE_CODE.test(language)) {
        return { ok: false, error: `"${language}" isn't a language code. Use en, en_US, hi, te.` };
    }
    const target = await loadTarget(input.conversationId);
    if ("error" in target)
        return { ok: false, error: target.error };
    if (target.lead.opted_out) {
        return { ok: false, error: "This customer opted out. Nothing may be sent to them." };
    }
    let messageId = null;
    try {
        ({ messageId } = await (0, outbound_1.sendReengagement)(target.lead.phone, {
            name,
            language,
            params: input.params ?? [],
        }));
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "WhatsApp send failed." };
    }
    // The rendered body lives in Meta's template library, not here, so the thread
    // records which template went out rather than inventing the text it contained.
    await recordOutbound({
        target,
        body: `[template: ${name}]${input.params?.length ? ` ${input.params.join(" · ")}` : ""}`,
        waMessageId: messageId,
        activityDescription: `Rep sent WhatsApp template "${name}"`,
    });
    return { ok: true, messageId };
}
async function setAiPaused(leadId, paused) {
    if (!leadId)
        return { ok: false, error: "A lead is required." };
    const { error } = await (0, supabase_1.db)().from("villa_leads").update({ ai_paused: paused }).eq("id", leadId);
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId,
        type: "note",
        description: paused ? "AI paused — a human owns this thread" : "AI resumed on this thread",
        channel: "whatsapp",
    });
    return { ok: true };
}
/**
 * Leads that could be emailed at all.
 *
 * Blank strings are dropped in memory rather than with a `.neq` filter so the
 * intent stays legible: an empty email is the same as no email.
 */
async function leadsWithEmail(limit = 200) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("id, name, email, phone, lead_temperature, lead_score, pipeline_stage, source, campaign, opted_out, last_contact_at")
        .not("email", "is", null)
        .order("last_contact_at", { ascending: false })
        .limit(limit);
    return (data ?? []).filter((lead) => lead.email.trim() !== "");
}
