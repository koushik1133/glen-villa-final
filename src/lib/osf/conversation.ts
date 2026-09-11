import { db } from "./supabase";
import { logActivity } from "./activities";
import { runAgent, type RunResult } from "./agent";
import { conversationLockKey, withLock } from "./locks";
import type { AgentReply, Conversation, Lead } from "./types";
import { storeInboundMedia, type InboundMedia } from "./whatsapp/inbound-media";

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
async function fireAutomations(
  triggerEvent: string,
  lead: Lead,
  opts: { reload?: boolean } = {},
): Promise<void> {
  try {
    let subject = lead;
    if (opts.reload) {
      // The agent's tools write budget, timeline, score and stage straight to
      // the row, so the caller's copy is stale by the time a turn finishes.
      const { data } = await db()
        .from("villa_leads")
        .select("*")
        .eq("id", lead.id)
        .maybeSingle();
      if (data) subject = data as Lead;
    }
    const { runAutomations } = await import("./automations");
    await runAutomations(triggerEvent, subject);
  } catch (e) {
    console.error(`[automations] ${triggerEvent} failed:`, e);
  }
}

export interface InboundAttribution {
  source?: string;
  campaign?: string;
  adId?: string;
  creative?: string;
  keyword?: string;
  landingPage?: string;
  referrer?: string;
  utm?: Record<string, string>;
}

export async function getOrCreateLead(params: {
  /** Required for WhatsApp. Instagram leads often have no number at all. */
  phone?: string | null;
  instagramId?: string | null;
  name?: string | null;
  channel?: string;
  attribution?: InboundAttribution;
}): Promise<Lead> {
  const a = params.attribution ?? {};

  // Instagram identifies people by an opaque IGSID, so it gets its own
  // keyed upsert rather than a synthetic phone number that would later be
  // mistaken for something we could actually send a WhatsApp message to.
  if (params.instagramId) {
    const { data, error } = await db().rpc("villa_upsert_lead_instagram", {
      p_instagram_id: params.instagramId,
      p_name: params.name ?? null,
      p_source: a.source ?? "instagram",
    });
    if (error) throw new Error(`Could not create lead: ${error.message}`);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { lead: Lead; created: boolean }
      | undefined;
    if (!row?.lead) throw new Error("Could not create lead: no row returned");

    if (row.created) {
      await logActivity({
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
  const { data, error } = await db().rpc("villa_upsert_lead", {
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

  if (error) throw new Error(`Could not create lead: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { lead: Lead; created: boolean }
    | undefined;
  if (!row?.lead) throw new Error("Could not create lead: no row returned");

  const lead = row.lead;

  // Only the caller that actually inserted announces the lead, so twenty
  // racing messages produce one "new lead" activity, not twenty.
  if (row.created) {
    await logActivity({
      leadId: lead.id,
      type: "lead_created",
      description: `New lead from ${lead.campaign ? `${lead.source} · ${lead.campaign}` : lead.source}`,
      channel: params.channel ?? "whatsapp",
    });
    await fireAutomations("lead_created", lead);
  }
  return lead;
}

export async function getOrCreateConversation(
  leadId: string,
  channel = "whatsapp",
): Promise<Conversation> {
  // Backed by a partial unique index on (lead_id, channel) where status =
  // 'open', so "at most one open thread" is a database rule rather than an
  // application hope.
  const { data, error } = await db().rpc("villa_upsert_conversation", {
    p_lead_id: leadId,
    p_channel: channel,
  });
  if (error) throw new Error(`Could not create conversation: ${error.message}`);

  const conv = (Array.isArray(data) ? data[0] : data) as Conversation | undefined;
  if (!conv) throw new Error("Could not create conversation: no row returned");
  return conv;
}

export type InboundOutcome =
  | { status: "handled"; result: RunResult; lead: Lead }
  | { status: "skipped"; reason: "duplicate" | "opted_out" | "ai_paused" | "busy" | "not_addressed"; lead: Lead };

/**
 * Processes one inbound customer message end to end.
 *
 * Returns `skipped` rather than throwing for the three cases where staying
 * quiet is the correct behaviour: a redelivered webhook, a customer who opted
 * out, and a conversation a human has taken over.
 */
export async function handleInbound(params: {
  /** WhatsApp identity. Omit for Instagram, which uses instagramId instead. */
  phone?: string | null;
  instagramId?: string | null;
  text: string;
  profileName?: string | null;
  channel?: string;
  waMessageId?: string | null;
  attribution?: InboundAttribution;
  /**
   * What the customer actually sent, when it was not plain text. Stored
   * alongside the message so the thread keeps the voice note or the document
   * itself, not only the transcript or the caption.
   */
  media?: InboundMedia | null;
  /**
   * False when the caller has decided the agent must stay silent on this one
   * (e.g. a personal-number trigger word was not used). The message is still
   * recorded — staying silent is not the same as the message never happening.
   */
  reply?: boolean;
  deliver: (reply: AgentReply) => Promise<void>;
}): Promise<InboundOutcome> {
  const supabase = db();
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
  const mediaPath = params.media ? await storeInboundMedia(lead.id, params.media) : null;
  const mediaColumns = params.media
    ? { media_kind: params.media.kind, media_url: mediaPath }
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
      if ((error as { code?: string }).code === "23505") {
        return { status: "skipped", reason: "duplicate", lead };
      }
      throw new Error(`Could not record message: ${error.message}`);
    }
  } else {
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
  const result = await withLock(
    conversationLockKey(lead.id),
    () =>
      runAgent({
        lead,
        conversation,
        customerMessage: params.text,
        deliver: params.deliver,
      }),
    {
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
    },
  );

  // The message is already recorded, so the run that holds the lock will pick
  // it up in the transcript. Staying quiet beats replying twice.
  if (result === null) {
    return { status: "skipped", reason: "busy", lead };
  }

  // Fired only after the reply has been delivered, so a rule can never delay
  // or block what the customer sees.
  await fireAutomations("lead_status_changed", lead, { reload: true });

  return { status: "handled", result, lead };
}
