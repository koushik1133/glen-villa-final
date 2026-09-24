import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { keywordSignals, FOLLOW_UP_TEMPLATE } from "../src/lib/osf/voice-bridge";
import { scoreLead, temperatureFor } from "../src/lib/osf/agent/scoring";
import type { Lead } from "../src/lib/osf/types";

/**
 * CALL → SENTIMENT → WHATSAPP
 *
 * The behaviour these lock down is the part that decides whether a real buyer
 * gets messaged, so each test is written against a scenario rather than an
 * implementation detail.
 */

const ROOT = process.cwd();
const BRIDGE = fs.readFileSync(path.join(ROOT, "src/lib/osf/voice-bridge.ts"), "utf8");
const WEBHOOK = fs.readFileSync(path.join(ROOT, "src/app/api/webhooks/bolna/route.ts"), "utf8");

/** A lead with nothing known about it — the state a first call starts from. */
function blankLead(over: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    phone: "+919999999999",
    name: null,
    email: null,
    purchase_timeline: "unknown",
    buyer_purpose: null,
    bedrooms: null,
    villa_type_interest: null,
    facing_preference: null,
    budget_min_inr: null,
    budget_max_inr: null,
    financing_preference: null,
    lead_temperature: "cold",
    lead_score: 0,
    ...over,
  } as unknown as Lead;
}

describe("the transcript is read for facts, without a model present", () => {
  test("a buyer asking for a site visit is heard", () => {
    const s = keywordSignals("Caller: can you schedule a visit for Saturday, I want to see the villa");
    assert.equal(s.requestedSiteVisit, true);
  });

  test("a buyer asking how to book is heard", () => {
    const s = keywordSignals("Caller: what is the token amount and the payment plan?");
    assert.equal(s.askedAboutBooking, true);
  });

  test("a browser is heard as a browser", () => {
    const s = keywordSignals("Caller: no no, I am just looking for now, researching options");
    assert.equal(s.purchaseTimeline, "researching");
    assert.equal(s.requestedSiteVisit, false);
    assert.equal(s.askedAboutBooking, false);
  });

  test("urgency is heard", () => {
    assert.equal(keywordSignals("Caller: I need to move immediately").purchaseTimeline, "immediate");
  });
});

describe("the signals decide the temperature, and the arithmetic is the existing one", () => {
  test("a serious buyer reaches hot", () => {
    const lead = blankLead({
      purchase_timeline: "immediate",
      buyer_purpose: "self_use",
      bedrooms: 4,
      villa_type_interest: "serenity-4bhk",
      budget_max_inr: 20_000_000,
      name: "Priya",
      email: "priya@example.com",
      financing_preference: "home_loan",
    } as Partial<Lead>);
    const score = scoreLead(lead, {
      requestedSiteVisit: true,
      askedAboutBooking: true,
      customerMessageCount: 12,
    });
    assert.ok(score >= 80, `expected hot, scored ${score}`);
    assert.equal(temperatureFor(score), "hot");
  });

  test("a browser stays cold", () => {
    const score = scoreLead(blankLead({ purchase_timeline: "researching" } as Partial<Lead>), {
      customerMessageCount: 2,
    });
    assert.ok(score < 50, `expected cold, scored ${score}`);
    assert.equal(temperatureFor(score), "cold");
  });

  test("a chatty caller who asks for nothing cannot reach hot on talk alone", () => {
    const score = scoreLead(blankLead(), { customerMessageCount: 200 });
    assert.equal(temperatureFor(score), "cold", "engagement is capped so a tyre-kicker cannot buy their way to hot");
  });
});

describe("who gets messaged", () => {
  test("hot and warm have a template; cold deliberately has none", () => {
    assert.equal(typeof FOLLOW_UP_TEMPLATE.hot, "string");
    assert.equal(typeof FOLLOW_UP_TEMPLATE.warm, "string");
    assert.equal(FOLLOW_UP_TEMPLATE.cold, null, "a caller who said 'just browsing' must not be messaged");
  });

  test("an opted-out lead is never messaged, whatever the score", () => {
    assert.match(BRIDGE, /lead\.opted_out/);
    const optOutAt = BRIDGE.indexOf("lead.opted_out");
    const sendAt = BRIDGE.indexOf("sendReengagement(");
    assert.ok(optOutAt !== -1 && sendAt !== -1);
    assert.ok(optOutAt < sendAt, "the opt-out check must come before the send");
  });

  test("the follow-up is a template, never free text", () => {
    // The caller may never have messaged us, so no 24-hour window is open and
    // Meta rejects anything that is not an approved template.
    assert.match(BRIDGE, /sendReengagement\(/);
    assert.ok(!/sendTextMessage\(|sendText\(/.test(BRIDGE), "free text would be rejected outside the window");
  });
});

describe("a webhook retry does not message the same person twice", () => {
  test("the execution id is checked against past activity before anything is sent", () => {
    const dedupeAt = BRIDGE.indexOf("already handled");
    const sendAt = BRIDGE.indexOf("sendReengagement(");
    assert.ok(dedupeAt !== -1, "there must be a dedup guard");
    assert.ok(dedupeAt < sendAt, "dedup must precede the send");
    assert.match(BRIDGE, /executionId: input\.executionId/);
  });
});

describe("only a finished call is scored", () => {
  test("the bridge runs behind result.finalised", () => {
    assert.match(WEBHOOK, /if \(result\.finalised\)/);
    const finalisedAt = WEBHOOK.indexOf("result.finalised");
    const bridgeAt = WEBHOOK.indexOf("bridgeCallToWhatsApp({");
    assert.ok(finalisedAt < bridgeAt, "an in-progress call must not be scored or messaged");
  });

  test("the follow-up is awaited, not fired and forgotten", () => {
    // On a serverless function, work still in flight when the response returns
    // is killed with the process.
    assert.match(WEBHOOK, /await bridgeCallToWhatsApp\(/);
  });

  test("only the caller's turns count as engagement", () => {
    assert.match(WEBHOOK, /turns\.filter\(\(t\) => t\.role === "caller"\)\.length/);
  });
});

describe("the model extracts, it does not judge", () => {
  test("the temperature comes from the deterministic scorer", () => {
    assert.match(BRIDGE, /temperatureFor\(score\)/);
    assert.match(BRIDGE, /scoreLead\(merged, \{/);
  });

  test("nothing asks a model for hot/warm/cold", () => {
    const prompt = BRIDGE.slice(BRIDGE.indexOf("Read this call transcript"), BRIDGE.indexOf("Rules:"));
    assert.ok(
      !/hot|warm|cold|temperature|sentiment/i.test(prompt),
      "asking the model for the verdict would make the score unauditable",
    );
  });

  test("a value outside the schema is discarded rather than written", () => {
    assert.match(BRIDGE, /TIMELINES\.includes\(timeline\) \? timeline : null/);
    assert.match(BRIDGE, /PURPOSES\.includes\(purpose\) \? purpose : null/);
  });

  test("an absurd budget is treated as a misheard number", () => {
    // "one crore" misread as 1 would otherwise record a ceiling of one rupee.
    assert.match(BRIDGE, /budget >= 100_000/);
  });
});

describe("a call never destroys what WhatsApp already knew", () => {
  test("one quiet call cannot cool a lead that was hot", () => {
    assert.match(BRIDGE, /RANK\[temperature\] >= RANK\[existing\] \? temperature : existing/);
  });

  test("a fact the call did not mention is not written as null", () => {
    // Every patch field is behind a truthiness check rather than assigned
    // unconditionally, so a call that never discussed budget leaves the budget
    // WhatsApp captured intact.
    assert.match(BRIDGE, /if \(signals\.budgetMaxInr\) patch\.budget_max_inr/);
    assert.match(BRIDGE, /if \(signals\.purchaseTimeline\) patch\.purchase_timeline/);
  });

  test("the score only ever rises", () => {
    assert.match(BRIDGE, /Math\.max\(score, Number\(lead\.lead_score \?\? 0\)\)/);
  });
});

describe("a failed follow-up does not cost the call record", () => {
  test("the bridge reports failure instead of throwing", () => {
    assert.match(BRIDGE, /catch \(e\) \{[\s\S]{0,200}voice-bridge/);
    assert.match(BRIDGE, /skipped: e instanceof Error \? e\.message/);
  });
});

/**
 * "SEND IT ON WHATSAPP"
 *
 * The agent promises it on the call. These lock down that the promise is kept,
 * and — just as important — that it is never kept to someone who did not ask.
 */
describe("what the caller asked to be sent is heard, and attributed", () => {
  test("a brochure request is heard", () => {
    const s = keywordSignals("Agent: hello\nCaller: can you send me the brochure on WhatsApp");
    assert.deepEqual(s.requestedAssetKinds, ["brochure"]);
  });

  test("several asks in one breath are all heard", () => {
    const s = keywordSignals(
      "Caller: send me the floor plan and the price list, and the location also",
    );
    assert.deepEqual([...(s.requestedAssetKinds ?? [])].sort(), ["floor_plan", "price_sheet"]);
    assert.equal(s.requestedLocation, true);
  });

  test("the AGENT offering the brochure is not a request", () => {
    const s = keywordSignals(
      "Agent: shall I send you the brochure and the price list on WhatsApp?\nCaller: no thanks, not now",
    );
    assert.deepEqual(s.requestedAssetKinds, []);
  });

  test("a call where nothing was asked for sends nothing", () => {
    const s = keywordSignals("Caller: I was just calling to check if you are open on Sunday");
    assert.deepEqual(s.requestedAssetKinds, []);
    assert.equal(s.requestedLocation, false);
  });

  test("photos are never picked by the machine — they are a human's job", () => {
    const s = keywordSignals("Caller: send me some photos of the villa");
    assert.deepEqual(s.requestedAssetKinds, []);
  });
});

describe("delivering what was asked for", () => {
  test("only operator-approved assets can go out", () => {
    // deliverApprovedAssets re-runs the allowlist and is-it-a-file gates and
    // reads only shareable_by_ai rows. Sending any other way would bypass both.
    assert.match(BRIDGE, /deliverApprovedAssets/);
    assert.doesNotMatch(BRIDGE, /sendMedia\(/);
  });

  test("the location goes as a link, never as an attachment", () => {
    assert.match(BRIDGE, /sendPlainText\(phone, `Here is the location/);
  });

  test("a request is honoured even on a call the scorer read as cold", () => {
    // The cold-call early return must come AFTER fulfilment, or a buyer who
    // asked for the brochure and little else would be met with silence.
    assert.ok(
      BRIDGE.indexOf("fulfilCallRequests({") < BRIDGE.indexOf("cold call — recorded, not messaged"),
    );
  });

  test("an opted-out lead is never messaged, whatever they asked for", () => {
    assert.ok(BRIDGE.indexOf("lead has opted out") < BRIDGE.indexOf("fulfilCallRequests({"));
  });

  test("delivering the ask replaces the generic template rather than adding to it", () => {
    assert.match(BRIDGE, /if \(anythingSent\) \{/);
  });

  test("a shut 24-hour window defers rather than pretending to send", () => {
    assert.match(BRIDGE, /serviceWindow\(lastInbound\?\.created_at \?\? null\)\.open/);
    assert.match(BRIDGE, /deferred/);
  });

  test("an unmet request becomes a human's job", () => {
    assert.match(BRIDGE, /handoff_status: "requested"/);
  });
});
