/** Subset of the Meta WhatsApp Cloud API webhook payload that we actually use. */

export interface WhatsAppWebhookBody {
  object: string;
  entry?: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes?: WhatsAppChange[];
}

export interface WhatsAppChange {
  field: string;
  value: WhatsAppChangeValue;
}

export interface WhatsAppChangeValue {
  messaging_product: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
  messages?: WhatsAppInboundMessage[];
  statuses?: Array<{
    id: string;
    status: string;
    recipient_id: string;
    /** Unix seconds, as a string. */
    timestamp?: string;
    errors?: Array<{ title?: string; message?: string; code?: number }>;
  }>;
}

export interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  image?: { id: string; caption?: string };
  document?: { id: string; caption?: string; filename?: string };
  audio?: { id: string };
  video?: { id: string; caption?: string };
  /**
   * Present on Click-to-WhatsApp ad conversions. This is the attribution
   * bridge from an ad impression to a real lead (spec sections 21–22).
   */
  referral?: {
    source_url?: string;
    source_id?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    ctwa_clid?: string;
  };
}

/** Extracts human-readable text from whatever message type arrived. */
export function textFrom(message: WhatsAppInboundMessage): string | null {
  if (message.text?.body) return message.text.body;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.button?.text) return message.button.text;
  if (message.image?.caption) return message.image.caption;
  if (message.document?.caption) return message.document.caption;
  if (message.video?.caption) return message.video.caption;

  // A bare media message with no caption still deserves a reply.
  if (["image", "document", "audio", "video"].includes(message.type)) {
    return `[the customer sent ${message.type === "audio" ? "a voice note" : `an ${message.type}`} with no caption]`;
  }
  return null;
}
