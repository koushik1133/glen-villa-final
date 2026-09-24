import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { findPhoneNumber } from "../src/lib/osf/phone-capture";

/**
 * A false positive here rings a stranger's phone, so the tests are weighted
 * towards everything that must NOT be read as a number.
 */

describe("a number the customer typed is found", () => {
  const cases: [string, string][] = [
    ["my number is 9876543210", "+919876543210"],
    ["call me on +91 98765 43210", "+919876543210"],
    ["contact: +919876543210 anytime", "+919876543210"],
    ["98765-43210 is my whatsapp", "+919876543210"],
    ["please call 09876543210", "+919876543210"],
    ["reach me at 0091 9876543210", "+919876543210"],
    ["Hi, interested in 4BHK. 8765432109", "+918765432109"],
  ];
  for (const [text, expected] of cases) {
    test(text, () => {
      assert.equal(findPhoneNumber(text)?.e164, expected);
    });
  }
});

describe("things that are not phone numbers are left alone", () => {
  const rejected: [string, string][] = [
    ["budget is around 50 lakhs", "a price"],
    ["the plot is 2400 sq ft", "an area"],
    ["my invoice number is 9876543210", "an invoice id"],
    ["account 9876543210 for the transfer", "a bank account"],
    ["flat 9876543210", "a flat reference"],
    ["1234567890123456 is the card", "a longer digit run"],
    ["call 1234567890", "does not start 6-9"],
    ["9999999999", "a placeholder"],
    ["I am interested", "no digits at all"],
    ["", "an empty message"],
  ];
  for (const [text, why] of rejected) {
    test(why, () => {
      assert.equal(findPhoneNumber(text), null, text);
    });
  }

  test("a ten-digit run inside a longer number is not extracted", () => {
    assert.equal(findPhoneNumber("ref 119876543210444"), null);
  });

  test("two different numbers are ambiguous, so neither is used", () => {
    // Guessing which one is theirs means calling the wrong person.
    assert.equal(findPhoneNumber("mine is 9876543210, my brother 9812345678"), null);
  });

  test("the same number written twice is still one number", () => {
    assert.equal(findPhoneNumber("9876543210 — yes, 9876543210")?.e164, "+919876543210");
  });
});

describe("the audit line keeps what they actually typed", () => {
  test("as-written is preserved", () => {
    assert.equal(findPhoneNumber("call me on 98765 43210")?.asWritten, "98765 43210");
  });
});
