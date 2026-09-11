import { logActivity } from "./activities";
import { configStatus } from "./env";
import { db } from "./supabase";
import { sendPlainText, sendReengagement } from "./whatsapp/outbound";
import type { Conversation, LeadTemperature, Message, MessageRole } from "./types";

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
export const CHANNELS = [
  "whatsapp",
  "instagram",
  "facebook",
  "email",
  "sms",
  "web_form",
  "call",
] as const;

export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
  sms: "SMS",
  web_form: "Web form",
  call: "Call",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel as Channel] ?? channel.replace(/_/g, " ");
}

/**
 * villa_conversations.status is free text with a default of 'open' — no enum
 * constrains it. These are the two values the application itself ever writes,
 * so they are the only ones offered as filters.
 */
export const CONVERSATION_STATUSES = ["open", "closed"] as const;

// -----------------------------------------------------------------------------
// Reading threads
// -----------------------------------------------------------------------------

export interface ThreadLead {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  lead_temperature: LeadTemperature;
  lead_score: number;
  pipeline_stage: string;
  ai_paused: boolean;
  opted_out: boolean;
  preferred_language: string;
}

export interface MessagePreview {
  role: MessageRole;
  body: string | null;
  media_kind: string | null;
  created_at: string;
}

export interface InboxConversation {
  id: string;
  lead_id: string;
  channel: string;
  status: string;
  started_at: string;
  last_message_at: string;
  message_count: number;
  summary: string | null;
  lead: ThreadLead | null;
  /** Newest message in the thread, for the list preview line. */
  preview: MessagePreview | null;
}

const LEAD_EMBED =
  "lead:villa_leads(id, name, phone, email, lead_temperature, lead_score, pipeline_stage, ai_paused, opted_out, preferred_language)";

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

export interface ConversationFilter {
  channel?: string;
  status?: string;
  limit?: number;
}

export async function listConversations(
  filter: ConversationFilter = {},
): Promise<InboxConversation[]> {
  let query = db().from("villa_conversations").select(CONVERSATION_SELECT);
  if (filter.channel) query = query.eq("channel", filter.channel);
  if (filter.status) query = query.eq("status", filter.status);

  const { data } = await query
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "preview", ascending: false })
    .limit(1, { referencedTable: "preview" })
    .limit(filter.limit ?? 80);

  const rows = (data ?? []) as unknown as Array<
    Omit<InboxConversation, "preview"> & { preview: MessagePreview[] | null }
  >;

  return rows.map((row) => ({ ...row, preview: row.preview?.[0] ?? null }));
}

export interface Thread {
  conversation: Conversation;
  lead: ThreadLead | null;
  messages: Message[];
}

/** Null when the id doesn't exist — a stale `?c=` link must not 500 the page. */
export async function loadThread(conversationId: string, limit = 300): Promise<Thread | null> {
  const supabase = db();

  const [{ data: conversation }, { data: messages }] = await Promise.all([
    supabase
      .from("villa_conversations")
      .select(
        `id, lead_id, channel, status, started_at, last_message_at, message_count, summary, ${LEAD_EMBED}`,
      )
      .eq("id", conversationId)
      .maybeSingle(),
    supabase
      .from("villa_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(limit),
  ]);

  if (!conversation) return null;

  const { lead, ...rest } = conversation as unknown as Conversation & { lead: ThreadLead | null };
  return { conversation: rest as Conversation, lead: lead ?? null, messages: (messages ?? []) as Message[] };
}

export interface InboxFacets {
  total: number;
  byChannel: Record<string, number>;
  byStatus: Record<string, number>;
}

/**
 * Counts for the filter pills.
 *
 * Two columns of at most `cap` rows, tallied in memory. PostgREST has no
 * GROUP BY, and the alternative — one head-count request per channel per
 * status — is eighteen round-trips to render a sidebar.
 */
export async function inboxFacets(cap = 2000): Promise<InboxFacets> {
  const { data } = await db().from("villa_conversations").select("channel, status").limit(cap);
  const rows = (data ?? []) as Array<{ channel: string; status: string }>;

  const facets: InboxFacets = { total: rows.length, byChannel: {}, byStatus: {} };
  for (const row of rows) {
    facets.byChannel[row.channel] = (facets.byChannel[row.channel] ?? 0) + 1;
    facets.byStatus[row.status] = (facets.byStatus[row.status] ?? 0) + 1;
  }
  return facets;
}

// -----------------------------------------------------------------------------
// Meta's 24-hour customer-service window
// -----------------------------------------------------------------------------

export const SERVICE_WINDOW_HOURS = 24;

export interface ServiceWindow {
  /** The customer's most recent inbound message, or null if they never wrote. */
  lastInboundAt: string | null;
  /** Null when there has been no inbound message at all. */
  hoursSince: number | null;
  /** True only while free-form text is permitted. */
  open: boolean;
  /** Whole minutes of free-text time left; null once the window is shut. */
  minutesLeft: number | null;
}

/**
 * Meta only allows a free-form message within 24 hours of the customer's last
 * inbound one. Outside that, the sole legal outbound is an approved template.
 * A conversation that has never received an inbound message is *never* open —
 * an outbound-first thread has no window to be inside.
 */
export function serviceWindow(lastInboundAt: string | null, now = Date.now()): ServiceWindow {
  if (!lastInboundAt) {
    return { lastInboundAt: null, hoursSince: null, open: false, minutesLeft: null };
  }

  const at = new Date(lastInboundAt).getTime();
  if (Number.isNaN(at)) {
    return { lastInboundAt, hoursSince: null, open: false, minutesLeft: null };
  }

  const elapsedMs = now - at;
  const remainingMs = SERVICE_WINDOW_HOURS * 3_600_000 - elapsedMs;
  const open = remainingMs > 0;

  return {
    lastInboundAt,
    hoursSince: elapsedMs / 3_600_000,
    open,
    minutesLeft: open ? Math.floor(remainingMs / 60_000) : null,
  };
}

/** "3h 12m left" / "closed 5h ago" — the phrasing the console shows a rep. */
export function windowLabel(window: ServiceWindow): string {
  if (window.hoursSince === null) return "No inbound message yet";
  if (window.open && window.minutesLeft !== null) {
    const hours = Math.floor(window.minutesLeft / 60);
    const minutes = window.minutesLeft % 60;
    return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
  }
  const closedFor = window.hoursSince - SERVICE_WINDOW_HOURS;
  return closedFor >= 24
    ? `Closed ${Math.floor(closedFor / 24)}d ago`
    : `Closed ${Math.max(0, Math.floor(closedFor))}h ago`;
}

export function lastInboundFrom(
  messages: Array<Pick<Message, "role" | "created_at">>,
): string | null {
  let latest: string | null = null;
  for (const message of messages) {
    if (message.role !== "customer") continue;
    if (!latest || message.created_at > latest) latest = message.created_at;
  }
  return latest;
}

async function lastInboundAt(conversationId: string): Promise<string | null> {
  const { data } = await db()
    .from("villa_messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { created_at: string } | null)?.created_at ?? null;
}

// -----------------------------------------------------------------------------
// Sending
// -----------------------------------------------------------------------------

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string };
export type WriteResult = { ok: true } | { ok: false; error: string };

export const WHATSAPP_ENV_VARS = [
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
];

const NOT_CONFIGURED =
  "WhatsApp isn't connected. Set the WHATSAPP_* variables in .env.local before sending.";

export const OUTSIDE_WINDOW_MESSAGE =
  "The 24-hour customer-service window has closed. Meta rejects free-form text here — " +
  "send an approved template to re-open the conversation.";

interface SendTarget {
  conversation: Pick<Conversation, "id" | "message_count" | "channel">;
  lead: Pick<ThreadLead, "id" | "phone" | "opted_out" | "name"> & {
    instagram_id?: string | null;
  };
}

async function loadTarget(conversationId: string): Promise<SendTarget | { error: string }> {
  const { data } = await db()
    .from("villa_conversations")
    .select("id, message_count, channel, lead:villa_leads(id, phone, opted_out, name, instagram_id)")
    .eq("id", conversationId)
    .maybeSingle();

  if (!data) return { error: "That conversation no longer exists." };

  const row = data as unknown as {
    id: string;
    message_count: number;
    channel: string;
    lead: SendTarget["lead"] | null;
  };

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
async function recordOutbound(params: {
  target: SendTarget;
  body: string;
  waMessageId: string | null;
  activityDescription: string;
}): Promise<void> {
  const supabase = db();
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
  if (error) console.error("[communication] could not record outbound message:", error.message);

  await supabase
    .from("villa_conversations")
    .update({ last_message_at: now, message_count: params.target.conversation.message_count + 1 })
    .eq("id", params.target.conversation.id);

  await supabase
    .from("villa_leads")
    .update({ ai_paused: true, last_contact_at: now })
    .eq("id", params.target.lead.id);

  await logActivity({
    leadId: params.target.lead.id,
    type: "message_sent",
    description: params.activityDescription,
    channel: "whatsapp",
    metadata: { conversation_id: params.target.conversation.id, sent_by: "human" },
  });
}

export async function sendWhatsAppText(input: {
  conversationId: string;
  text: string;
}): Promise<SendResult> {
  if (!configStatus().whatsapp) return { ok: false, error: NOT_CONFIGURED };

  const body = input.text?.trim();
  if (!body) return { ok: false, error: "Type a message before sending." };
  if (body.length > 4096) return { ok: false, error: "WhatsApp caps a text message at 4096 characters." };

  const target = await loadTarget(input.conversationId);
  if ("error" in target) return { ok: false, error: target.error };
  if (target.lead.opted_out) {
    return { ok: false, error: "This customer opted out. Nothing may be sent to them." };
  }

  // Re-checked server-side: the UI hides the box, but a stale tab still has it.
  if (!serviceWindow(await lastInboundAt(input.conversationId)).open) {
    return { ok: false, error: OUTSIDE_WINDOW_MESSAGE };
  }

  let messageId: string | null = null;
  try {
    if (target.lead.phone) {
      ({ messageId } = await sendPlainText(target.lead.phone, body));
    } else if (target.lead.instagram_id) {
      // Instagram-only lead: same inbox, different transport.
      const { sendInstagramText } = await import("./instagram/client");
      ({ messageId } = await sendInstagramText(target.lead.instagram_id, body));
    } else {
      return { ok: false, error: "This lead has no phone number or Instagram id to send to." };
    }
  } catch (e) {
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

export async function sendWhatsAppTemplate(input: {
  conversationId: string;
  templateName: string;
  language?: string | null;
  params?: string[];
}): Promise<SendResult> {
  if (!configStatus().whatsapp) return { ok: false, error: NOT_CONFIGURED };

  const name = input.templateName?.trim().toLowerCase();
  if (!name) return { ok: false, error: "A template name is required." };
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
  if ("error" in target) return { ok: false, error: target.error };
  if (target.lead.opted_out) {
    return { ok: false, error: "This customer opted out. Nothing may be sent to them." };
  }

  let messageId: string | null = null;
  try {
    ({ messageId } = await sendReengagement(target.lead.phone, {
      name,
      language,
      params: input.params ?? [],
    }));
  } catch (e) {
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

export async function setAiPaused(leadId: string, paused: boolean): Promise<WriteResult> {
  if (!leadId) return { ok: false, error: "A lead is required." };

  const { error } = await db().from("villa_leads").update({ ai_paused: paused }).eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  await logActivity({
    leadId,
    type: "note",
    description: paused ? "AI paused — a human owns this thread" : "AI resumed on this thread",
    channel: "whatsapp",
  });
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Email
// -----------------------------------------------------------------------------

export interface EmailLead {
  id: string;
  name: string | null;
  email: string;
  phone: string;
  lead_temperature: LeadTemperature;
  lead_score: number;
  pipeline_stage: string;
  source: string;
  campaign: string | null;
  opted_out: boolean;
  last_contact_at: string;
}

/**
 * Leads that could be emailed at all.
 *
 * Blank strings are dropped in memory rather than with a `.neq` filter so the
 * intent stays legible: an empty email is the same as no email.
 */
export async function leadsWithEmail(limit = 200): Promise<EmailLead[]> {
  const { data } = await db()
    .from("villa_leads")
    .select(
      "id, name, email, phone, lead_temperature, lead_score, pipeline_stage, source, campaign, opted_out, last_contact_at",
    )
    .not("email", "is", null)
    .order("last_contact_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as unknown as EmailLead[]).filter((lead) => lead.email.trim() !== "");
}
