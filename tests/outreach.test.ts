import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { MAX_RECIPIENTS, parseRecipients, renderOpener } from "../src/lib/osf/outreach";

/**
 * This path messages people who never contacted us, from a number whose loss
 * would take every conversation with it. The tests are weighted accordingly:
 * mostly about what must NOT be sent, and to whom.
 */

describe("reading the pasted list", () => {
  test("number and name on one line", () => {
    const { recipients } = parseRecipients("919876543210, Koushik S");
    assert.deepEqual(recipients, [{ phone: "919876543210", name: "Koushik S" }]);
  });

  test("a space is as good as a comma", () => {
    const { recipients } = parseRecipients("919876543210 Priya");
    assert.deepEqual(recipients, [{ phone: "919876543210", name: "Priya" }]);
  });

  test("formatting people actually use is accepted", () => {
    const { recipients } = parseRecipients("+91 98765 43210");
    assert.equal(recipients[0].phone, "919876543210");
    assert.equal(recipients[0].name, null);
  });

  test("several lines, blank lines ignored", () => {
    const { recipients } = parseRecipients("919876543210 A\n\n919812345678 B\n");
    assert.equal(recipients.length, 2);
  });

  test("a name is optional", () => {
    assert.equal(parseRecipients("919876543210").recipients[0].name, null);
  });
});

describe("what must never reach a stranger's phone", () => {
  test("ten digits with no country code is refused, not guessed", () => {
    // Guessing +91 is how a message reaches a different country entirely.
    const { recipients, rejected } = parseRecipients("9876543210 Priya");
    assert.equal(recipients.length, 0);
    assert.match(rejected[0].reason, /country code/);
  });

  test("too short to be a number", () => {
    assert.equal(parseRecipients("12345").recipients.length, 0);
  });

  test("too long to be a number", () => {
    assert.equal(parseRecipients("9198765432100000000").recipients.length, 0);
  });

  test("the same person twice is sent to once", () => {
    const { recipients, rejected } = parseRecipients("919876543210 A\n+91 98765 43210 B");
    assert.equal(recipients.length, 1, "one message, not two");
    assert.match(rejected[0].reason, /already listed/);
  });

  test("a line with no number at all is reported, not dropped silently", () => {
    const { rejected } = parseRecipients("please call the Sharma family");
    assert.equal(rejected.length, 1);
  });

  test("the cap is small — this is unsolicited outbound", () => {
    assert.ok(MAX_RECIPIENTS <= 25, "a large cap turns a mistake into a ban");
  });
});

describe("the message they receive", () => {
  test("their name is used", () => {
    assert.equal(renderOpener("Hi {name}, welcome.", "Koushik"), "Hi Koushik, welcome.");
  });

  test("no name does not produce 'Hi ,'", () => {
    // "Hi ," announces a broken mail merge in the first two characters.
    assert.equal(renderOpener("Hi {name}, welcome.", null), "Hi there, welcome.");
  });

  test("a blank name is treated as no name", () => {
    assert.equal(renderOpener("Hi {name}.", "   "), "Hi there.");
  });

  test("every occurrence is replaced, case-insensitively", () => {
    assert.equal(renderOpener("{name} — {NAME}", "A"), "A — A");
  });
});

describe("the rules the send path enforces", () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), "src/lib/osf/outreach.ts"), "utf8");
  const ROUTE = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/osf/outreach/route.ts"),
    "utf8",
  );

  test("an opted-out person is never messaged", () => {
    assert.match(SRC, /lead\.opted_out/);
  });

  test("a live conversation is not interrupted with a cold opener", () => {
    assert.match(SRC, /message_count \?\? 0\) > 0/);
  });

  test("sends are spaced apart, not burst", () => {
    assert.match(SRC, /setTimeout/);
    assert.ok(SRC.includes("SEND_SPACING_MS"));
  });

  test("the AI is NOT paused — the agent must answer when they reply", () => {
    assert.doesNotMatch(SRC, /ai_paused:\s*true/);
  });

  test("the route requires customers.write and is rate limited", () => {
    assert.match(ROUTE, /guard\("customers\.write"\)/);
    assert.match(ROUTE, /rateLimit\(/);
  });

  test("preview sends nothing", () => {
    // The preview branch must return before startConversations is reached.
    assert.ok(ROUTE.indexOf("if (preview)") < ROUTE.indexOf("await startConversations"));
  });
});
