"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverToWhatsApp = deliverToWhatsApp;
const client_1 = require("./client");
/**
 * Turns one AgentReply into the right WhatsApp send call.
 *
 * The agent decides *what* to say; this decides *how* it goes out. Keeping
 * that split in one place means the webhook, the simulator and any future
 * channel cannot drift apart in how they render the same reply.
 */
async function deliverToWhatsApp(to, reply) {
    // Options first: a reply carrying choices also carries the question text, so
    // checking text first would send the question and drop the buttons.
    if (reply.options?.length) {
        const body = reply.text ?? "Please choose:";
        // 3 or fewer render as buttons, more as a tappable menu. Meta hard-rejects
        // a 4th button, so this is a correctness branch, not a style one.
        if (reply.options.length <= 3) {
            await (0, client_1.sendButtons)(to, body, reply.options.map((o) => ({ id: o.id, title: o.title })));
            return;
        }
        await (0, client_1.sendList)(to, body, reply.listButtonLabel ?? "Choose", [
            { title: "Options", rows: reply.options.slice(0, 10) },
        ]);
        return;
    }
    if (reply.mediaUrl && reply.mediaKind) {
        await (0, client_1.sendMedia)(to, reply.mediaUrl, reply.mediaKind, reply.caption);
        return;
    }
    if (reply.text)
        await (0, client_1.sendText)(to, reply.text);
}
