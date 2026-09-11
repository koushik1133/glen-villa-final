import { sendButtons, sendList, sendMedia, sendText } from "./client";
import type { AgentReply } from "../types";

/**
 * Turns one AgentReply into the right WhatsApp send call.
 *
 * The agent decides *what* to say; this decides *how* it goes out. Keeping
 * that split in one place means the webhook, the simulator and any future
 * channel cannot drift apart in how they render the same reply.
 */
export async function deliverToWhatsApp(to: string, reply: AgentReply): Promise<void> {
  // Options first: a reply carrying choices also carries the question text, so
  // checking text first would send the question and drop the buttons.
  if (reply.options?.length) {
    const body = reply.text ?? "Please choose:";

    // 3 or fewer render as buttons, more as a tappable menu. Meta hard-rejects
    // a 4th button, so this is a correctness branch, not a style one.
    if (reply.options.length <= 3) {
      await sendButtons(
        to,
        body,
        reply.options.map((o) => ({ id: o.id, title: o.title })),
      );
      return;
    }

    await sendList(to, body, reply.listButtonLabel ?? "Choose", [
      { title: "Options", rows: reply.options.slice(0, 10) },
    ]);
    return;
  }

  if (reply.mediaUrl && reply.mediaKind) {
    await sendMedia(to, reply.mediaUrl, reply.mediaKind, reply.caption);
    return;
  }

  if (reply.text) await sendText(to, reply.text);
}
