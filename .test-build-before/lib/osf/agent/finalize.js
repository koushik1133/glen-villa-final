"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeTurn = finalizeTurn;
const supabase_1 = require("../supabase");
const scoring_1 = require("./scoring");
/**
 * Rescores the lead and persists conversation state. Shared across every
 * provider implementation (Anthropic, Groq, ...) since it has nothing to do
 * with which LLM produced the reply.
 */
/**
 * Lightweight sentiment from the customer's own words plus their engagement
 * signals. Deterministic on purpose — it never depends on the model choosing
 * to report a mood, so it's consistent and cheap. Feeds the "sentiment" column
 * the sales team reads alongside the hot/warm/cold temperature.
 */
function analyzeSentiment(message, signals) {
    const t = message.toLowerCase();
    // Negative first — an objection outweighs a polite word around it.
    if (/(too expensive|very expensive|overpriced|out of (my )?budget|not interested|no thanks|too far|too costly|disappointed|waste|useless|worst|cheat|scam|fraud|misleading|angry|frustrat)/.test(t)) {
        return "negative";
    }
    // Strong buying intent or warm language → positive.
    if (signals.requestedSiteVisit ||
        signals.askedAboutBooking ||
        signals.requestedHandoff ||
        /(interested|love it|looks great|beautiful|excellent|perfect|amazing|wonderful|impressed|ready to|want to (buy|book|visit)|book (a )?visit|site visit|let'?s proceed|sounds good|very good|good deal|👍|❤|😍)/.test(t)) {
        return "positive";
    }
    return "neutral";
}
async function finalizeTurn(params) {
    const { lead, conversation, customerMessage, signals, repliesCount } = params;
    const supabase = (0, supabase_1.db)();
    const { count } = await supabase
        .from("villa_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversation.id)
        .eq("role", "customer");
    signals.customerMessageCount = count ?? 1;
    // Read intent straight from the customer's words too, not only from whether
    // the model happened to call a tool — the model's tool-calling is unreliable,
    // and a lead who says "I want a site visit" is warm whether or not the agent
    // logged it. These make the hot/warm/cold temperature reflect real intent.
    const t = customerMessage.toLowerCase();
    signals.askedAboutBooking =
        signals.askedAboutBooking ||
            /\b(book|booking|payment|emi|token|advance|availab|price|cost|how much|budget)/i.test(t);
    signals.requestedSiteVisit =
        signals.requestedSiteVisit ||
            /(site visit|visit the|come (and )?see|come to see|tour the|schedule a visit|see it in person|when can i visit)/i.test(t);
    signals.requestedMaterial =
        signals.requestedMaterial ||
            /(brochure|floor ?plan|price sheet|catalog|pictures|photos|images)/i.test(t);
    signals.requestedHandoff =
        signals.requestedHandoff ||
            /(call me|talk to|speak to|connect me|sales (team|person|manager)|contact number|phone number)/i.test(t);
    const leadScore = (0, scoring_1.scoreLead)(lead, signals);
    const temperature = (0, scoring_1.temperatureFor)(leadScore);
    const sentiment = analyzeSentiment(customerMessage, signals);
    await supabase
        .from("villa_leads")
        .update({
        lead_score: leadScore,
        lead_temperature: temperature,
        sentiment,
        last_contact_at: new Date().toISOString(),
    })
        .eq("id", lead.id);
    await supabase
        .from("villa_conversations")
        .update({
        last_message_at: new Date().toISOString(),
        message_count: conversation.message_count + 1 + repliesCount,
    })
        .eq("id", conversation.id);
    return { leadScore, temperature };
}
