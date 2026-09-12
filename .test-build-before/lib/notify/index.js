"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailConfigured = emailConfigured;
exports.configuredRecipients = configuredRecipients;
exports.sendEmail = sendEmail;
exports.notify = notify;
exports.notifyAppointment = notifyAppointment;
const db_1 = require("../db");
const ids_1 = require("../ids");
const engine_1 = require("../appointments/engine");
const audit_1 = require("../ops/audit");
const customers_1 = require("../ops/customers");
const agent_1 = require("../ops/agent");
const seed_1 = require("../ops/seed");
const ics_1 = require("./ics");
/** Log is bounded: it is evidence for the desk, not an archive. */
const LOG_CAP = 2000;
function emailConfigured() {
    return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL);
}
/** NOTIFY_EMAILS, comma-separated, blanks dropped. */
function configuredRecipients() {
    return (process.env.NOTIFY_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.includes("@"));
}
async function sendEmail(msg) {
    const to = [...new Set(msg.to.map((s) => s.trim()).filter((s) => s.includes("@")))];
    const joined = to.join(", ");
    if (!emailConfigured()) {
        return { channel: "email", ok: false, to: joined, detail: "not configured: set RESEND_API_KEY and NOTIFY_FROM_EMAIL" };
    }
    if (!to.length)
        return { channel: "email", ok: false, detail: "no recipients: set NOTIFY_EMAILS or assign a host with an email" };
    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: process.env.NOTIFY_FROM_EMAIL,
                to,
                subject: msg.subject,
                text: msg.text,
                html: msg.html,
                attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })),
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { channel: "email", ok: false, to: joined, detail: `Resend HTTP ${res.status}: ${body.slice(0, 200)}` };
        }
        const data = (await res.json().catch(() => ({})));
        return { channel: "email", ok: true, to: joined, detail: data.id ? `Resend id ${data.id}` : "sent" };
    }
    catch (e) {
        return { channel: "email", ok: false, to: joined, detail: e instanceof Error ? e.message : String(e) };
    }
}
function log(ev, outcomes) {
    const now = new Date().toISOString();
    const entries = outcomes.map((o) => ({
        id: (0, ids_1.uid)("nlog"),
        orgId: ev.orgId,
        event: ev.event,
        entity: ev.entity,
        entityId: ev.entityId,
        createdAt: now,
        ...o,
    }));
    (0, db_1.mutate)((d) => {
        d.notificationLog = [...(d.notificationLog ?? []), ...entries].slice(-LOG_CAP);
    });
}
async function notify(ev) {
    const outcomes = [];
    if (ev.inApp) {
        try {
            (0, audit_1.notify)({ orgId: ev.orgId, event: ev.event, customerId: ev.customerId, ...ev.inApp });
            outcomes.push({ channel: "in_app", ok: true, detail: ev.inApp.recipientId ?? ev.inApp.recipientRole ?? "broadcast" });
        }
        catch (e) {
            outcomes.push({ channel: "in_app", ok: false, detail: e instanceof Error ? e.message : String(e) });
        }
    }
    if (ev.email)
        outcomes.push(await sendEmail(ev.email));
    if (ev.whatsapp) {
        try {
            const res = await (0, agent_1.deliver)(ev.orgId, ev.whatsapp.customerId, ev.whatsapp.text, "ai", undefined, {
                automated: true,
                tag: ev.whatsapp.tag,
            });
            outcomes.push({
                channel: "whatsapp",
                ok: res.ok,
                to: ev.whatsapp.customerId,
                detail: res.ok ? "sent" : res.requiresTemplate ? "outside the 24h window — needs a template or a call" : res.error ?? "send failed",
            });
        }
        catch (e) {
            outcomes.push({ channel: "whatsapp", ok: false, to: ev.whatsapp.customerId, detail: e instanceof Error ? e.message : String(e) });
        }
    }
    log(ev, outcomes);
    return outcomes;
}
function when(a) {
    const tz = (0, engine_1.availabilityFor)(a.brandId).timezone || "Asia/Kolkata";
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    }).format(new Date(a.startsAt));
}
const TITLES = {
    booked: "Site visit booked",
    confirmed: "Site visit confirmed",
    rescheduled: "Site visit moved",
    cancelled: "Site visit cancelled",
    no_show: "Site visit no-show",
    reminder: "Site visit tomorrow",
};
/** What the buyer is told. `null` = nothing goes to the customer for this event. */
function customerText(a, event, brandName) {
    const first = a.customerName.split(" ")[0];
    const t = when(a);
    switch (event) {
        case "booked":
        case "confirmed":
            return `Hi ${first}, your site visit with ${brandName} is confirmed for ${t}. We'll send a reminder before it. Reply here if you need to change the time.`;
        case "rescheduled":
            return `Hi ${first}, your site visit with ${brandName} has been moved to ${t}. Reply here if that doesn't suit.`;
        case "cancelled":
            return `Hi ${first}, your site visit with ${brandName} on ${t} has been cancelled. Reply here whenever you'd like to pick another time.`;
        case "reminder":
            return `Hi ${first}, a reminder: your site visit with ${brandName} is ${t}. See you there — reply here if anything changes.`;
        case "no_show":
            return null;
    }
}
/**
 * Tell everyone who needs to know about a visit. Fire-and-forget from the
 * engine, awaited by the reminder tick. Never throws.
 */
async function notifyAppointment(a, event) {
    try {
        const db = (0, db_1.read)();
        const orgId = await (0, seed_1.resolveDefaultOrgId)();
        const brand = db.brands.find((b) => b.id === a.brandId);
        const brandName = brand?.name ?? "the team";
        const host = a.assignedTo
            ? db.teamMembers.find((m) => m.active && (m.name === a.assignedTo || m.email === a.assignedTo))
            : undefined;
        const last = a.history.at(-1);
        const title = `${TITLES[event]}: ${a.customerName}`;
        const lines = [
            `${a.customerName} · ${a.customerPhone}${a.customerEmail ? ` · ${a.customerEmail}` : ""}`,
            `When: ${when(a)} (${a.durationMinutes} min)`,
            `Host: ${a.assignedTo || "Unassigned"} · Source: ${a.channel} · Status: ${a.status}`,
            last?.reason ? `Reason: ${last.reason}` : "",
            a.notes ? `Notes: ${a.notes}` : "",
        ].filter(Boolean);
        const recipients = [...configuredRecipients(), ...(host?.email ? [host.email] : [])];
        const customer = (0, customers_1.findByPhone)(orgId, a.customerPhone);
        const text = customerText(a, event, brandName);
        // The WhatsApp agent's own reply is the confirmation for a chat booking;
        // a second "you're booked" a moment later reads as a glitch.
        const agentBooked = event === "booked" && a.channel === "whatsapp" && a.createdBy === "ai";
        const whatsapp = text && customer && !agentBooked ? { customerId: customer.id, text, tag: `appointment_${event}` } : undefined;
        const outcomes = await notify({
            orgId,
            event: `appointment.${event}`,
            entity: "appointment",
            entityId: a.id,
            customerId: customer?.id,
            inApp: {
                title,
                body: lines.join("\n"),
                category: "SALES",
                recipientId: host?.id,
                recipientRole: host ? undefined : "SALES_MANAGER",
                severity: event === "cancelled" || event === "no_show" ? "WARNING" : "INFO",
            },
            email: {
                to: recipients,
                subject: `[${brandName}] ${title} — ${when(a)}`,
                text: lines.join("\n"),
                attachments: [{
                        filename: `site-visit-${a.id}.ics`,
                        content: Buffer.from((0, ics_1.icsFor)(a, { brandName })).toString("base64"),
                        contentType: "text/calendar",
                    }],
            },
            whatsapp,
        });
        if (text && !whatsapp) {
            const detail = agentBooked ? "skipped: the assistant's reply was the confirmation" : "skipped: no customer record for this phone";
            log({ orgId, event: `appointment.${event}`, entity: "appointment", entityId: a.id }, [{ channel: "whatsapp", ok: false, detail }]);
            outcomes.push({ channel: "whatsapp", ok: false, detail });
        }
        if ((event === "booked" || event === "confirmed") && outcomes.some((o) => o.channel === "whatsapp" && o.ok)) {
            (0, engine_1.markConfirmationSent)(a.id);
        }
        return outcomes;
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        try {
            (0, audit_1.audit)({ orgId: "unknown", actorType: "system", action: "notify.failed", entity: "appointment", entityId: a.id, metadata: { event, detail } });
        }
        catch { /* the log must not be the thing that breaks */ }
        return [{ channel: "in_app", ok: false, detail }];
    }
}
