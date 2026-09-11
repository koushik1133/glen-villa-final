/**
 * Trigger-word gate for personal-number mode.
 *
 * When the agent runs on someone's personal WhatsApp, it must answer ONLY
 * messages that begin with the trigger word (e.g. "villa") and stay completely
 * silent on every private chat. This is the single source of truth for that
 * decision — every inbound path (text, voice transcript, edit, button tap)
 * runs through it, so there is no way for a non-trigger message to slip past.
 *
 * Robustness the naive `text.trim().toLowerCase().startsWith("villa")` missed:
 *  - Leading invisible characters WhatsApp/clients inject — narrow no-break
 *    space (U+202F), non-breaking space (U+00A0), zero-width marks, BOM. A
 *    plain trim() leaves some of these, so "⁠Villa" would fail to match.
 *  - Leading punctuation or an emoji before the word ("👉 Villa", "*Villa*").
 *  - "village"/os"villas" must NOT match — the trigger is the whole word "villa",
 *    so the first word must equal it, not merely start with it.
 */

// Characters to strip from the FRONT before looking for the word: standard
// whitespace, common unicode spaces, zero-width marks, and leading punctuation.
const LEADING_JUNK = /^[\s  ​‌‍﻿ - "'*_~`>().¡¿!?,.:;\-–—•▪◦\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️]+/u;

/** The first word of the message, lowercased, with leading junk removed. */
function firstWord(text: string): string {
  const cleaned = text.replace(LEADING_JUNK, "");
  // A "word" runs until the first space or punctuation. Letters and digits only.
  const match = cleaned.match(/^[\p{L}\p{N}]+/u);
  return (match ? match[0] : "").toLowerCase();
}

/**
 * True when `text` should be handled by the agent.
 *
 * If no trigger is configured (dedicated business number), everything passes —
 * the agent answers all customers. If a trigger IS set (personal number), only
 * messages whose FIRST WORD is exactly the trigger pass.
 */
export function passesTrigger(text: string | null | undefined, trigger: string | null): boolean {
  if (!trigger) return true; // no trigger configured → answer everyone
  if (!text) return false;
  return firstWord(text) === trigger.trim().toLowerCase();
}

/**
 * Whether a message is about the villa / real estate at all.
 *
 * Voice notes are different from text: a caller won't say "villa" first, they
 * just speak. So voice notes skip the strict trigger-word prefix and use this
 * broader relevance check instead — transcribe any voice note, but only let the
 * agent reply when the content is actually about the project (price, location,
 * schools, a site visit, a brochure, and so on). A friend's unrelated voice
 * note transcribes but gets no reply, keeping a personal number private.
 */
const VILLA_TERMS = [
  // property
  "villa", "plot", "flat", "apartment", "home", "house", "property", "project",
  "glentree", "serenity", "bhk", "sqft", "sq ft", "square feet", "square yard",
  "sqyd", "triplex", "gated", "community",
  // commercial
  "price", "cost", "rate", "crore", "cr", "lakh", "budget", "emi", "loan",
  "payment", "booking", "book", "offer", "discount", "deal", "pre-launch",
  "prelaunch", "buy", "purchase", "invest", "investment", "interested",
  // actions / assets
  "visit", "site", "tour", "brochure", "floor plan", "floorplan", "layout",
  "picture", "photo", "image", "video", "availability", "available", "details",
  "information",
  // location / nearby
  "location", "where", "address", "nearby", "near", "distance", "far",
  "airport", "school", "hospital", "mall", "road", "orr", "metro",
  "connectivity", "area", "adibatla", "nadergul", "hyderabad", "lb nagar",
  // attributes
  "facing", "east facing", "west facing", "corner", "amenities", "clubhouse",
  "pool", "gym", "park", "vastu", "possession", "ready", "construction",
  "handover", "rera", "hmda", "approval", "approved", "maintenance", "corpus",
  // hindi / telugu common
  "ghar", "makaan", "makan", "keemat", "daam", "kitna", "kitne", "kaha",
  "kahan", "kharid", "nivesh", "paisa", "rupaye", "इल्लु", "villa ki",
];

export function isVillaRelated(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return VILLA_TERMS.some((term) => t.includes(term));
}
