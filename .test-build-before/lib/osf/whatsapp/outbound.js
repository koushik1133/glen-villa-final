"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeProvider = activeProvider;
exports.deliverReply = deliverReply;
exports.sendPlainText = sendPlainText;
exports.sendReengagement = sendReengagement;
const supabase_1 = require("../supabase");
const env_1 = require("../env");
const client_1 = require("./client");
const deliver_1 = require("./deliver");
const client_2 = require("../evolution/client");
/**
 * Provider-aware outbound facade.
 *
 * Everything that sends WhatsApp messages outside the webhook reply path —
 * hot-lead alerts, follow-ups, broadcasts, the communication console — goes
 * through here, so flipping WHATSAPP_PROVIDER moves the whole app at once
 * instead of leaving call sites pinned to the old transport.
 */
function activeProvider() {
    return env_1.env.whatsappProvider;
}
async function deliverReply(to, reply) {
    if (activeProvider() === "evolution")
        return (0, client_2.deliverToEvolution)(to, reply);
    return (0, deliver_1.deliverToWhatsApp)(to, reply);
}
async function sendPlainText(to, body) {
    if (activeProvider() === "evolution")
        return (0, client_2.sendEvolutionText)(to, body);
    return (0, client_1.sendText)(to, body);
}
/**
 * Sends re-engagement content outside the 24-hour window.
 *
 * On Meta that legally requires a Meta-approved template, addressed by name.
 * On Evolution there is no window and no approval — but the *text* still has
 * to come from somewhere, so the same name is resolved against our own
 * villa_templates registry and its {{n}} placeholders filled from `params`.
 * One template name works on both providers; only who renders it differs.
 */
async function sendReengagement(to, template, renderedBody) {
    if (activeProvider() === "evolution") {
        const body = renderedBody ?? (await renderFromRegistry(template));
        if (!body) {
            throw new Error(`No text to send: template "${template.name}" is not in villa_templates and no rendered body was supplied.`);
        }
        return (0, client_2.sendEvolutionText)(to, body);
    }
    return (0, client_1.sendTemplate)(to, template.name, template.language ?? "en", template.params ?? []);
}
async function renderFromRegistry(template) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_templates")
        .select("body")
        .eq("name", template.name)
        .order("language", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (!data?.body)
        return null;
    // {{1}}-style placeholders, exactly as Meta numbers them. A param that was
    // never provided renders as "" rather than leaking the "{{2}}" literal.
    return data.body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
        return template.params?.[Number(n) - 1] ?? "";
    });
}
