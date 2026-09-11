import { env } from "../env";
import { toWhatsApp } from "./format";
import type { AssetKind } from "../types";

/**
 * WhatsApp Cloud API sender.
 *
 * Every function throws on failure rather than swallowing it, so the agent can
 * tell the customer the truth instead of claiming a file was delivered when it
 * was not.
 */

function endpoint(): string {
  const version = env.whatsappApiVersion;
  const phoneNumberId = env.whatsappPhoneNumberId;

  // Both are interpolated into a URL path. They are operator-supplied rather
  // than user-supplied, but a stray slash here silently retargets every send,
  // so the shape is asserted rather than assumed.
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error(`WHATSAPP_API_VERSION must look like v21.0, got "${version}"`);
  }
  if (!/^\d{5,20}$/.test(phoneNumberId)) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID must be the numeric id from the Meta dashboard");
  }

  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

/** A high or low surrogate with no partner — see truncate(). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Truncates without leaving an unpaired surrogate.
 *
 * JSON.stringify emits a lone surrogate as an unpaired \uD8xx escape, which
 * Graph rejects with a 400 — costing the customer their whole reply, or a
 * handoff its live alert to the sales rep. A plain slice can create one by
 * cutting an emoji in half, so the cut is aligned; but one can also arrive
 * already in the text, since a customer can type it and it survives into a
 * lead's name and from there into the handoff briefing. Strip those too.
 */
function truncate(text: string, max: number): string {
  const code = text.charCodeAt(max - 1);
  const cut = text.length <= max ? text.length : code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return text.slice(0, cut).replace(LONE_SURROGATE, "");
}

/** Graph wants bare international digits; strip anything an operator added. */
function recipient(to: string): string {
  const digits = to.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("WhatsApp recipient must be an international number in digits");
  }
  return digits;
}

async function post(payload: Record<string, unknown>): Promise<{ messageId: string | null }> {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsappAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`WhatsApp send failed (${response.status}): ${detail.slice(0, 400)}`);
  }

  const json = (await response.json()) as { messages?: Array<{ id: string }> };
  return { messageId: json.messages?.[0]?.id ?? null };
}

/** `to` must be digits only in international format, e.g. 919876543210. */
export async function sendText(to: string, body: string) {
  return post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient(to),
    type: "text",
    // Link previews off: cleaner, and stops Meta rendering a preview for a
    // brochure URL that hasn't been sent yet.
    text: { body: truncate(toWhatsApp(body), 4096), preview_url: false },
  });
}

/** Maps our asset kinds onto the WhatsApp media message types. */
function mediaTypeFor(kind: AssetKind): "image" | "video" | "document" {
  if (kind === "image") return "image";
  if (kind === "video" || kind === "virtual_tour") return "video";
  return "document";
}

export async function sendMedia(
  to: string,
  url: string,
  kind: AssetKind,
  caption?: string,
) {
  const type = mediaTypeFor(kind);

  // `url` is expected to have already cleared assertSendableMediaUrl. Re-parse
  // anyway: this is the last point before it becomes a link Meta will fetch.
  const link = new URL(url);
  if (link.protocol !== "https:" && link.protocol !== "http:") {
    throw new Error("WhatsApp media link must be http or https");
  }

  const media: Record<string, unknown> = { link: link.href };
  if (caption) media.caption = truncate(caption, 1024);
  if (type === "document") {
    media.filename = `${kind.replace(/_/g, "-")}.pdf`;
  }

  return post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient(to),
    type,
    [type]: media,
  });
}

/**
 * Sends a pre-approved template. Required to re-open a conversation outside
 * the 24-hour customer service window — a free-form message there is rejected
 * by Meta, so follow-ups must go through this.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode = "en",
  bodyParams: string[] = [],
) {
  return post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(bodyParams.length
        ? {
            components: [
              {
                type: "body",
                parameters: bodyParams.map((text) => ({
                  type: "text",
                  text: truncate(text, 1024),
                })),
              },
            ],
          }
        : {}),
    },
  });
}

/** Marks an inbound message read so the customer sees the blue ticks. */
export async function markRead(messageId: string) {
  try {
    await post({ messaging_product: "whatsapp", status: "read", message_id: messageId });
  } catch {
    // Cosmetic only — never let this break the reply path.
  }
}

// -----------------------------------------------------------------------------
// Interactive messages
//
// Meta's limits are hard rejections, not warnings, and a 400 here costs the
// customer their whole reply. So each one is enforced before the send rather
// than discovered from Graph:
//   buttons  — max 3, title max 20 chars, ids max 256
//   list     — max 10 rows total across max 10 sections, titles max 24 chars
//   body     — max 1024 chars in interactive messages (not the 4096 of text)
// -----------------------------------------------------------------------------

export interface ReplyButton {
  /** Echoed back verbatim in the webhook, so keep it stable and meaningful. */
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

/** Trims to Meta's limit on a word boundary where one is close by. */
function label(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/**
 * Up to three tappable quick replies. Anything beyond three would be silently
 * dropped by Meta, so we fail loudly instead — a truncated set of options is a
 * sales bug, not a formatting one.
 */
export async function sendButtons(
  to: string,
  body: string,
  buttons: ReplyButton[],
  opts: { header?: string; footer?: string } = {},
) {
  if (buttons.length === 0) throw new Error("sendButtons needs at least one button");
  if (buttons.length > 3) {
    throw new Error(`WhatsApp allows at most 3 reply buttons, got ${buttons.length} — use sendList`);
  }

  return post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient(to),
    type: "interactive",
    interactive: {
      type: "button",
      ...(opts.header ? { header: { type: "text", text: label(opts.header, 60) } } : {}),
      body: { text: truncate(body, 1024) },
      ...(opts.footer ? { footer: { text: label(opts.footer, 60) } } : {}),
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: label(b.id, 256), title: label(b.title, 20) },
        })),
      },
    },
  });
}

/**
 * A tappable menu — the right shape for "which villa type?" where three
 * buttons cannot hold the options.
 */
export async function sendList(
  to: string,
  body: string,
  buttonLabel: string,
  sections: ListSection[],
  opts: { header?: string; footer?: string } = {},
) {
  const rowCount = sections.reduce((n, s) => n + s.rows.length, 0);
  if (rowCount === 0) throw new Error("sendList needs at least one row");
  if (rowCount > 10) {
    throw new Error(`WhatsApp allows at most 10 list rows in total, got ${rowCount}`);
  }
  if (sections.length > 10) {
    throw new Error(`WhatsApp allows at most 10 list sections, got ${sections.length}`);
  }

  return post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient(to),
    type: "interactive",
    interactive: {
      type: "list",
      ...(opts.header ? { header: { type: "text", text: label(opts.header, 60) } } : {}),
      body: { text: truncate(body, 1024) },
      ...(opts.footer ? { footer: { text: label(opts.footer, 60) } } : {}),
      action: {
        button: label(buttonLabel, 20),
        sections: sections.map((s) => ({
          title: label(s.title, 24),
          rows: s.rows.map((r) => ({
            id: label(r.id, 200),
            title: label(r.title, 24),
            ...(r.description ? { description: label(r.description, 72) } : {}),
          })),
        })),
      },
    },
  });
}
