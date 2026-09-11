import { env } from "../env";
import type { AgentReply } from "../types";

/**
 * Instagram Direct sender.
 *
 * Instagram uses the Messenger send API, not the WhatsApp one — different
 * endpoint, different payload, different recipient shape (an opaque IGSID
 * rather than a phone number). The agent above it does not know or care.
 *
 * Two limits differ from WhatsApp and both are hard rejections:
 *   * text is capped at 1000 characters, not 4096
 *   * quick replies cap at 13, and there is no list type — so a long menu has
 *     to be rendered as numbered text instead
 */

const TEXT_LIMIT = 1000;
const QUICK_REPLY_LIMIT = 13;
const QUICK_REPLY_TITLE_LIMIT = 20;

function endpoint(): string {
  const version = env.whatsappApiVersion;
  const account = env.instagramAccountId;
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error(`WHATSAPP_API_VERSION must look like v21.0, got "${version}"`);
  }
  if (!/^\d{5,25}$/.test(account)) {
    throw new Error("INSTAGRAM_ACCOUNT_ID must be the numeric Instagram professional account id");
  }
  return `https://graph.facebook.com/${version}/${account}/messages`;
}

async function post(payload: Record<string, unknown>): Promise<{ messageId: string | null }> {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.instagramAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Instagram send failed (${response.status}): ${detail.slice(0, 400)}`);
  }

  const json = (await response.json()) as { message_id?: string };
  return { messageId: json.message_id ?? null };
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export async function sendInstagramText(to: string, body: string) {
  return post({ recipient: { id: to }, message: { text: clamp(body, TEXT_LIMIT) } });
}

export async function sendInstagramMedia(to: string, url: string, kind: string) {
  // Instagram DMs accept image, video and audio attachments — but not
  // documents. A brochure PDF has to go as a link, which is why the caller
  // checks this rather than discovering it from a 400.
  const type = kind === "video" || kind === "virtual_tour" ? "video" : "image";
  return post({
    recipient: { id: to },
    message: { attachment: { type, payload: { url, is_reusable: true } } },
  });
}

/** Instagram has no list message, so 14+ options must degrade to text. */
export async function sendInstagramQuickReplies(
  to: string,
  body: string,
  options: Array<{ id: string; title: string }>,
) {
  return post({
    recipient: { id: to },
    message: {
      text: clamp(body, TEXT_LIMIT),
      quick_replies: options.slice(0, QUICK_REPLY_LIMIT).map((o) => ({
        content_type: "text",
        title: clamp(o.title, QUICK_REPLY_TITLE_LIMIT),
        payload: o.id,
      })),
    },
  });
}

/** The Instagram counterpart of deliverToWhatsApp — same reply, its own rules. */
export async function deliverToInstagram(to: string, reply: AgentReply): Promise<void> {
  if (reply.options?.length) {
    const body = reply.text ?? "Please choose:";
    if (reply.options.length <= QUICK_REPLY_LIMIT) {
      await sendInstagramQuickReplies(to, body, reply.options);
      return;
    }
    // No list type here. Numbering them keeps the choice legible instead of
    // silently dropping everything past the 13th.
    const numbered = reply.options.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
    await sendInstagramText(to, `${body}\n\n${numbered}`);
    return;
  }

  if (reply.mediaUrl && reply.mediaKind) {
    const isDocument = !["image", "video", "virtual_tour"].includes(reply.mediaKind);
    if (isDocument) {
      // Send it as a link rather than claiming a document went through.
      await sendInstagramText(
        to,
        `${reply.caption ? `${reply.caption}\n` : ""}${reply.mediaUrl}`,
      );
      return;
    }
    await sendInstagramMedia(to, reply.mediaUrl, reply.mediaKind);
    if (reply.caption) await sendInstagramText(to, reply.caption);
    return;
  }

  if (reply.text) await sendInstagramText(to, reply.text);
}
