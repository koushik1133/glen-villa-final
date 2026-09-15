import { complete, extractJson, hasLLM } from "../ai/provider";
import { db } from "./supabase";
import { getOrCreateLead } from "./conversation";
import { scoreLead, temperatureFor } from "./agent/scoring";
import { sendReengagement } from "./whatsapp/outbound";
import { logActivity } from "./activities";
import type { BuyerPurpose, Lead, LeadTemperature, PurchaseTimeline } from "./types";

/**
 * THE BRIDGE BETWEEN THE CALL AND THE WHATSAPP THREAD
 *
 * A call ends, Bolna posts the transcript, and until now that was where the
 * voice side stopped: it wrote a customer, a transcript and a lead into the
 * JSON store, and the WhatsApp agent — which keeps its leads in Supabase —
 * never learned any of it. The same buyer, reached on the same number, existed
 * twice and neither half knew about the other.
 *
 * This module closes that. Given a finished call it:
 *
 *   1. reads FACTS out of the transcript,
 *   2. scores them with the same deterministic scorer the WhatsApp agent uses,
 *   3. writes the result onto the Supabase lead keyed by that phone number —
 *      the very record the WhatsApp agent reads and writes,
 *   4. and sends a follow-up appropriate to how the call actually went.
 *
 * WHY THE MODEL DOES NOT DECIDE THE TEMPERATURE
 *
 * It would be easy to ask an LLM "is this hot, warm or cold?". We deliberately
 * do not. `scoring.ts` says why: the score is rule-based "so the sales team can
 * see exactly why a lead is hot and the number means the same thing today as it
 * did last month". A model asked the same question twice gives two answers, and
 * nobody can audit it. So the model does the part it is genuinely good at —
 * pulling structured facts out of unstructured speech — and the arithmetic that
 * decides who gets called back stays deterministic and inspectable.
 *
 * Without an LLM configured this still works: `keywordSignals` reads the same
 * facts with patterns. Worse recall, identical scoring, no silent failure.
 */

/** What we try to learn from a transcript. Every field optional — calls ramble. */
export interface CallSignals {
  name?: string | null;
  purchaseTimeline?: PurchaseTimeline | null;
  buyerPurpose?: BuyerPurpose | null;
  bedrooms?: number | null;
  budgetMaxInr?: number | null;
  requestedSiteVisit?: boolean;
  askedAboutBooking?: boolean;
  requestedMaterial?: boolean;
  requestedHandoff?: boolean;
  /** Turns the CUSTOMER spoke — engagement, not call length. */
  customerTurns?: number;
  /** One line a human can read in the CRM. Never shown to the customer. */
  summary?: string | null;
}

const TIMELINES: PurchaseTimeline[] = [
  "immediate", "within_1_month", "1_3_months", "3_6_months", "6_12_months", "researching", "unknown",
];
const PURPOSES: BuyerPurpose[] = [
  "self_use", "family", "investment", "second_home", "vacation_home", "rental_income", "nri_purchase", "undecided",
];

/** Keep only values the schema actually accepts — a model will invent neighbours. */
function coerce(raw: Record<string, unknown>): CallSignals {
  const timeline = String(raw.purchaseTimeline ?? "").trim() as PurchaseTimeline;
  const purpose = String(raw.buyerPurpose ?? "").trim() as BuyerPurpose;
  const beds = Number(raw.bedrooms);
  const budget = Number(raw.budgetMaxInr);
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : null,
    purchaseTimeline: TIMELINES.includes(timeline) ? timeline : null,
    buyerPurpose: PURPOSES.includes(purpose) ? purpose : null,
    bedrooms: Number.isFinite(beds) && beds > 0 && beds < 15 ? Math.round(beds) : null,
    // A model that hears "one crore" sometimes writes 1. Anything below a lakh
    // is a misread, not a budget, and letting it through would mark a serious
    // buyer as having disclosed an absurd ceiling.
    budgetMaxInr: Number.isFinite(budget) && budget >= 100_000 ? Math.round(budget) : null,
    requestedSiteVisit: raw.requestedSiteVisit === true,
    askedAboutBooking: raw.askedAboutBooking === true,
    requestedMaterial: raw.requestedMaterial === true,
    requestedHandoff: raw.requestedHandoff === true,
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim().slice(0, 400) : null,
  };
}

/** The deterministic floor. Runs with no model, and alongside one. */
export function keywordSignals(transcript: string): CallSignals {
  const t = transcript.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  return {
    requestedSiteVisit: has(/\b(site visit|visit the site|come and see|show me the (villa|property|plot)|schedule a visit|site dekh)/),
    askedAboutBooking: has(/\b(book|booking|token|advance|payment plan|emi|down payment|register)/),
    requestedMaterial: has(/\b(brochure|floor plan|price list|price sheet|send me the details|pdf)/),
    requestedHandoff: has(/\b(talk to (a|someone|your) (person|human|manager|sales)|call me back|speak to someone)/),
    purchaseTimeline: has(/\b(immediately|right away|this month|as soon as possible|urgent)/)
      ? "immediate"
      : has(/\b(next month|within a month)/)
        ? "within_1_month"
        : has(/\b(just looking|just checking|browsing|researching|exploring)/)
          ? "researching"
          : null,
  };
}

/**
 * Pull facts out of the transcript. Returns the keyword floor when no model is
 * configured, or when the model's answer cannot be parsed.
 */
export async function extractCallSignals(transcript: string): Promise<CallSignals> {
  const floor = keywordSignals(transcript);
  if (!hasLLM() || transcript.trim().length < 40) return floor;

  try {
    const text = await complete({
      system:
        "You extract structured facts from sales call transcripts for a villa developer. " +
        "You never guess. A fact the caller did not state is null. You answer with JSON only.",
      prompt: `Read this call transcript and extract only what the CALLER actually said.

TRANSCRIPT:
${transcript.slice(0, 12_000)}

Return exactly this JSON object, no prose, no fences:
{
 "name": string|null,
 "purchaseTimeline": ${TIMELINES.map((t) => `"${t}"`).join("|")}|null,
 "buyerPurpose": ${PURPOSES.map((p) => `"${p}"`).join("|")}|null,
 "bedrooms": number|null,
 "budgetMaxInr": number|null,
 "requestedSiteVisit": boolean,
 "askedAboutBooking": boolean,
 "requestedMaterial": boolean,
 "requestedHandoff": boolean,
 "summary": string
}

Rules:
- budgetMaxInr in rupees as a number. "one crore" is 10000000, "80 lakhs" is 8000000. Null if no figure was said.
- Booleans are true only if the CALLER asked. The agent offering something does not count.
- summary: one sentence, factual, for the sales team.`,
      json: true,
      maxTokens: 900,
      timeoutMs: 20_000,
      temperature: 0.1,
    });

    const parsed = extractJson<Record<string, unknown>>(text);
    if (!parsed) return floor;
    const model = coerce(parsed);

    // Union with the keyword pass: a regex hit is evidence the model missed,
    // and these booleans only ever raise the score, never lower it.
    return {
      ...model,
      requestedSiteVisit: model.requestedSiteVisit || floor.requestedSiteVisit,
      askedAboutBooking: model.askedAboutBooking || floor.askedAboutBooking,
      requestedMaterial: model.requestedMaterial || floor.requestedMaterial,
      requestedHandoff: model.requestedHandoff || floor.requestedHandoff,
      purchaseTimeline: model.purchaseTimeline ?? floor.purchaseTimeline ?? null,
    };
  } catch {
    return floor;
  }
}

/** Which template a call of this temperature earns. Cold gets nothing. */
export const FOLLOW_UP_TEMPLATE: Record<LeadTemperature, string | null> = {
  hot: "call_followup_hot",
  warm: "call_followup_warm",
  // A buyer who said "just browsing" does not want a message thirty seconds
  // later. The call is recorded and scored; silence is the correct follow-up.
  cold: null,
};

export interface BridgeResult {
  leadId: string | null;
  temperature: LeadTemperature | null;
  score: number | null;
  messaged: boolean;
  /** Why nothing was sent, when nothing was sent. */
  skipped?: string;
}

/**
 * Run after a call is FINALISED. Never throws: a follow-up that fails must not
 * cost us the call record the webhook already wrote.
 */
export async function bridgeCallToWhatsApp(input: {
  phone: string | null | undefined;
  name?: string | null;
  transcript: string;
  /** Bolna's execution id — the dedup key. */
  executionId: string;
  customerTurns?: number;
}): Promise<BridgeResult> {
  const empty: BridgeResult = { leadId: null, temperature: null, score: null, messaged: false };

  const phone = (input.phone ?? "").replace(/[^\d+]/g, "");
  if (!phone) return { ...empty, skipped: "the call carried no phone number" };

  try {
    // A webhook retry must not message the same person twice. Bolna retries on
    // any non-2xx, and this runs after the record is already written, so
    // without this the second delivery is a duplicate message to a customer.
    const { data: seen } = await db()
      .from("villa_activities")
      .select("id")
      .eq("activity_type", "voice_followup")
      .contains("metadata", { executionId: input.executionId })
      .limit(1);
    if (seen && seen.length > 0) {
      return { ...empty, skipped: "already handled — this is a webhook retry" };
    }

    const signals = await extractCallSignals(input.transcript);

    const lead = await getOrCreateLead({
      phone,
      name: input.name ?? signals.name ?? null,
      channel: "voice",
      attribution: { source: "voice_call" },
    });

    // Fill in only what the call actually taught us. A call that never
    // mentioned budget must not blank a budget WhatsApp already captured.
    const patch: Record<string, unknown> = {};
    if (signals.purchaseTimeline) patch.purchase_timeline = signals.purchaseTimeline;
    if (signals.buyerPurpose) patch.buyer_purpose = signals.buyerPurpose;
    if (signals.bedrooms !== null && signals.bedrooms !== undefined) patch.bedrooms = signals.bedrooms;
    if (signals.budgetMaxInr) patch.budget_max_inr = signals.budgetMaxInr;
    if (signals.name && !lead.name) patch.name = signals.name;

    const merged = { ...lead, ...patch } as Lead;
    const score = scoreLead(merged, {
      requestedSiteVisit: signals.requestedSiteVisit,
      askedAboutBooking: signals.askedAboutBooking,
      requestedHandoff: signals.requestedHandoff,
      requestedMaterial: signals.requestedMaterial,
      customerMessageCount: input.customerTurns ?? signals.customerTurns ?? 0,
    });
    const temperature = temperatureFor(score);

    // Never cool a lead on the strength of one quiet call — a buyer who was
    // hot on WhatsApp and terse on the phone is still hot.
    const RANK: Record<LeadTemperature, number> = { cold: 0, warm: 1, hot: 2 };
    const existing = (lead.lead_temperature ?? "cold") as LeadTemperature;
    const finalTemperature = RANK[temperature] >= RANK[existing] ? temperature : existing;

    patch.lead_temperature = finalTemperature;
    patch.lead_score = Math.max(score, Number(lead.lead_score ?? 0));
    patch.last_contact_at = new Date().toISOString();

    await db().from("villa_leads").update(patch).eq("id", lead.id);

    await logActivity({
      leadId: lead.id,
      type: "voice_followup",
      channel: "voice",
      description: signals.summary ?? `Call scored ${score} (${finalTemperature}).`,
      // The execution id lives here because it is also the dedup key above.
      metadata: { executionId: input.executionId, score, temperature: finalTemperature },
    }).catch(() => {});

    // ---- the follow-up itself ----

    if (lead.opted_out) {
      return { leadId: lead.id, temperature: finalTemperature, score, messaged: false, skipped: "lead has opted out" };
    }

    const templateName = FOLLOW_UP_TEMPLATE[finalTemperature];
    if (!templateName) {
      return { leadId: lead.id, temperature: finalTemperature, score, messaged: false, skipped: "cold call — recorded, not messaged" };
    }

    // A template, not free text. The person may never have messaged us on
    // WhatsApp, so there is no open 24-hour window and Meta rejects anything
    // that is not an approved template. sendReengagement renders from the
    // villa_templates registry on Evolution and calls the template API on Meta.
    await sendReengagement(phone, {
      name: templateName,
      language: "en",
      params: [lead.name ?? signals.name ?? "there"],
    });

    await logActivity({
      leadId: lead.id,
      type: "follow_up_sent",
      channel: "whatsapp",
      description: `Post-call WhatsApp follow-up sent (${finalTemperature}).`,
      metadata: { executionId: input.executionId, template: templateName },
    }).catch(() => {});

    return { leadId: lead.id, temperature: finalTemperature, score, messaged: true };
  } catch (e) {
    console.error("[voice-bridge] follow-up failed", e);
    return { ...empty, skipped: e instanceof Error ? e.message : "unknown failure" };
  }
}
