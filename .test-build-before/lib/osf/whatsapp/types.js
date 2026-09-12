"use strict";
/** Subset of the Meta WhatsApp Cloud API webhook payload that we actually use. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.textFrom = textFrom;
/** Extracts human-readable text from whatever message type arrived. */
function textFrom(message) {
    if (message.text?.body)
        return message.text.body;
    if (message.interactive?.button_reply?.title)
        return message.interactive.button_reply.title;
    if (message.interactive?.list_reply?.title)
        return message.interactive.list_reply.title;
    if (message.button?.text)
        return message.button.text;
    if (message.image?.caption)
        return message.image.caption;
    if (message.document?.caption)
        return message.document.caption;
    if (message.video?.caption)
        return message.video.caption;
    // A bare media message with no caption still deserves a reply.
    if (["image", "document", "audio", "video"].includes(message.type)) {
        return `[the customer sent ${message.type === "audio" ? "a voice note" : `an ${message.type}`} with no caption]`;
    }
    return null;
}
