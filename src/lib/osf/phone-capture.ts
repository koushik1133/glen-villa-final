/**
 * FINDING A PHONE NUMBER INSIDE A MESSAGE.
 *
 * An Instagram lead has no phone number — the platform does not give us one,
 * so `villa_leads.phone` is null and the sales desk has no way to ring them.
 * But people type their number into the DM constantly: "call me on 98765
 * 43210", "my number is +91 98765 43210". That number was arriving, being
 * stored inside the message body, and going no further.
 *
 * This reads it out so the lead becomes callable. It is deliberately strict.
 * A false positive here does not produce a slightly wrong record — it makes
 * the voice agent ring a stranger, or ring a number that is really a flat
 * number or an invoice id. So every rule below fails towards "not a phone
 * number", and a number we are unsure about is left for a human.
 */

/**
 * An Indian mobile: ten digits starting 6-9, optionally with a +91 / 91 / 0
 * prefix, and freely spaced or hyphenated the way people actually write them.
 *
 * Anchored on both sides against digits and the separators people put INSIDE
 * numbers, so a ten-digit run sitting in the middle of a longer one — an order
 * id, an Aadhaar, an account number — cannot match part of itself.
 */
const INDIAN_MOBILE =
  /(?<![\d\-.])(?:(?:\+|00)?91[\s\-.]?|0)?([6-9]\d(?:[\s\-.]?\d){8})(?![\d\-.])/g;

/** Contexts where a run of digits is nearly always something else. */
const NOT_A_PHONE_NEARBY =
  /\b(lakh|lakhs|crore|crores|rupees|rs\.?|inr|sq\s?ft|sqft|square feet|pin ?code|gst|pan|aadhaar|aadhar|invoice|order|account|a\/c|ifsc|flat|plot|survey)\b/i;

export interface CapturedPhone {
  /** E.164, ready to dial. */
  e164: string;
  /** Exactly as the customer typed it, for the audit line. */
  asWritten: string;
}

/**
 * The first plausible mobile number in `text`, or null.
 *
 * Returns the FIRST rather than all of them: a message containing two numbers
 * is ambiguous about which one is theirs, and guessing wrong means calling
 * the wrong person. Two candidates therefore yield nothing and the message
 * goes to a human unchanged.
 */
export function findPhoneNumber(text: string): CapturedPhone | null {
  if (!text) return null;

  const found: CapturedPhone[] = [];
  for (const match of text.matchAll(INDIAN_MOBILE)) {
    const asWritten = match[0].trim();
    const digits = match[1].replace(/\D/g, "");
    if (digits.length !== 10) continue;

    // A number quoted next to a price or a document id is that thing, not a
    // phone. Judged on the words around it, not the digits themselves.
    const from = Math.max(0, (match.index ?? 0) - 25);
    const context = text.slice(from, (match.index ?? 0) + asWritten.length + 25);
    if (NOT_A_PHONE_NEARBY.test(context)) continue;

    // All-same or trivially sequential digits are placeholders, not people.
    if (/^(\d)\1{9}$/.test(digits)) continue;

    const e164 = `+91${digits}`;
    if (!found.some((f) => f.e164 === e164)) found.push({ e164, asWritten });
  }

  if (found.length !== 1) return null;
  return found[0];
}
