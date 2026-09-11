import type { Lead, LeadTemperature } from "../types";

/**
 * Lead scoring (spec section 7).
 *
 * Deterministic and rule-based rather than model-judged, so the sales team can
 * see exactly why a lead is hot and the number means the same thing today as
 * it did last month. The score is internal — never surfaced to the customer.
 */

export interface ScoringSignals {
  /** The agent asked for a human, or the customer did. */
  requestedHandoff?: boolean;
  /** A site visit or virtual tour was requested. */
  requestedSiteVisit?: boolean;
  /** They asked about booking, payment procedure or availability. */
  askedAboutBooking?: boolean;
  /** They asked for a brochure, floor plan or price sheet. */
  requestedMaterial?: boolean;
  /** Number of messages the customer has sent in this conversation. */
  customerMessageCount?: number;
}

const TIMELINE_POINTS: Record<string, number> = {
  immediate: 30,
  within_1_month: 26,
  "1_3_months": 20,
  "3_6_months": 12,
  "6_12_months": 6,
  researching: 2,
  unknown: 0,
};

const PURPOSE_POINTS: Record<string, number> = {
  self_use: 12,
  family: 12,
  nri_purchase: 12,
  second_home: 10,
  investment: 10,
  rental_income: 8,
  vacation_home: 8,
  undecided: 2,
};

export function scoreLead(lead: Lead, signals: ScoringSignals = {}): number {
  let score = 0;

  // Intent — the single strongest predictor.
  score += TIMELINE_POINTS[lead.purchase_timeline] ?? 0;

  // Purpose clarity.
  if (lead.buyer_purpose) score += PURPOSE_POINTS[lead.buyer_purpose] ?? 0;

  // Requirement specificity — a buyer who knows what they want is further along.
  if (lead.bedrooms !== null) score += 6;
  if (lead.villa_type_interest !== null) score += 8;
  if (lead.facing_preference) score += 3;

  // Budget disclosed at all is a trust signal; a budget that clears the entry
  // price is a qualification signal.
  if (lead.budget_max_inr !== null || lead.budget_min_inr !== null) score += 8;

  // Contactability.
  if (lead.name) score += 4;
  if (lead.email) score += 3;
  if (lead.financing_preference && lead.financing_preference !== "undecided") score += 4;

  // Behavioural signals from this conversation.
  if (signals.requestedSiteVisit) score += 20;
  if (signals.askedAboutBooking) score += 15;
  if (signals.requestedHandoff) score += 12;
  if (signals.requestedMaterial) score += 5;

  // Sustained engagement, capped so a chatty tyre-kicker can't reach HOT.
  const turns = signals.customerMessageCount ?? 0;
  score += Math.min(6, Math.floor(turns / 3) * 2);

  return Math.max(0, Math.min(100, score));
}

export function temperatureFor(score: number): LeadTemperature {
  if (score >= 80) return "hot";
  if (score >= 50) return "warm";
  return "cold";
}

/**
 * True when the budget clears the project's published entry price.
 * Used only to decide whether budget counts as qualifying — never to tell a
 * customer they cannot afford something.
 */
export function budgetClears(lead: Lead, startingPriceInr: number | null): boolean {
  if (startingPriceInr === null) return true;
  const ceiling = lead.budget_max_inr ?? lead.budget_min_inr;
  if (ceiling === null) return true;
  // Within 10% counts — buyers routinely understate by a little.
  return ceiling >= startingPriceInr * 0.9;
}
