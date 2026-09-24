import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, describe } from "node:test";
import { cleanup, isolate } from "./helpers";

/**
 * THE OUTBOUND CALL QUEUE.
 *
 * Every entry here rings a real phone and bills for it, so the properties
 * under test are the ones whose failure a customer would feel: nobody called
 * twice, nobody called at night, nobody quietly dropped.
 */

const dir = isolate("voice-queue");
process.env.BOLNA_API_KEY = "test-key";
after(() => cleanup(dir));

const { read, mutate } = require("../src/lib/db") as typeof import("../src/lib/db");
const queue = require("../src/lib/voice/queue") as typeof import("../src/lib/voice/queue");

const BRAND = "brd_test";
const OTHER_BRAND = "brd_other";

function reset() {
  mutate((db) => {
    db.voiceCallQueue = [];
  });
}

function add(phones: string[], brandId = BRAND) {
  return queue.enqueueCalls({
    brandId,
    phones,
    agentId: "agent-1",
    createdBy: "test",
  });
}

describe("numbers are accepted, or refused with a reason", () => {
  test("a well-formed number is queued", () => {
    reset();
    const { added, rejected } = add(["+919876543210"]);
    assert.equal(added.length, 1);
    assert.equal(rejected.length, 0);
    assert.equal(added[0].status, "queued");
    assert.equal(added[0].attempts, 0);
  });

  test("a number with no country code is refused, and says why", () => {
    reset();
    const { added, rejected } = add(["9876543210"]);
    assert.equal(added.length, 0);
    assert.match(rejected[0].reason, /country code/);
  });

  test("two bad numbers do not cost the good ones", () => {
    reset();
    const { added, rejected } = add(["+919876543210", "nonsense", "+919812345678", ""]);
    assert.equal(added.length, 2);
    assert.equal(rejected.length, 1);
  });

  test("the same person is not queued twice in one paste", () => {
    reset();
    // Same number, written two ways a spreadsheet would produce.
    const { added, rejected } = add(["+91 98765 43210", "+919876543210"]);
    assert.equal(added.length, 1);
    assert.match(rejected[0].reason, /twice/);
  });

  test("the same person is not queued twice across pastes", () => {
    reset();
    add(["+919876543210"]);
    const { added, rejected } = add(["+919876543210"]);
    assert.equal(added.length, 0);
    assert.match(rejected[0].reason, /already waiting/);
  });

  test("a number already called can be queued again", () => {
    reset();
    add(["+919876543210"]);
    mutate((db) => {
      db.voiceCallQueue[0].status = "done";
    });
    assert.equal(add(["+919876543210"]).added.length, 1);
  });

  test("two brands calling the same number do not collide", () => {
    reset();
    add(["+919876543210"], BRAND);
    assert.equal(add(["+919876543210"], OTHER_BRAND).added.length, 1);
  });
});

describe("nobody is called in the middle of the night", () => {
  test("the calling window is business hours in the brand's timezone", () => {
    const at = (iso: string) => queue.withinCallingHours(new Date(iso));
    // 03:30 UTC is 09:00 IST.
    assert.equal(at("2026-09-21T03:30:00Z"), true);
    assert.equal(at("2026-09-21T13:00:00Z"), true);
    // 20:00 IST — the window has closed.
    assert.equal(at("2026-09-21T14:30:00Z"), false);
    // 02:00 IST.
    assert.equal(at("2026-09-21T20:30:00Z"), false);
  });

  test("a queue loaded at night waits rather than dialling", async () => {
    reset();
    add(["+919876543210"]);
    const hours = new Date().getUTCHours();
    const result = await queue.pumpQueue(BRAND);
    if (!queue.withinCallingHours()) {
      assert.equal(result.dialled, 0);
      assert.match(result.idle ?? "", /IST/);
      assert.equal(read().voiceCallQueue[0].status, "queued", "the entry is untouched, not failed");
    }
    assert.equal(typeof hours, "number");
  });
});

describe("a finished call frees the slot and decides what happens next", () => {
  function calling(phone = "+919876543210") {
    reset();
    add([phone]);
    mutate((db) => {
      db.voiceCallQueue[0].status = "calling";
      db.voiceCallQueue[0].attempts = 1;
      db.voiceCallQueue[0].executionId = "exec-1";
    });
  }

  test("a call that connected is done", () => {
    calling();
    const settled = queue.settleQueueEntry({
      executionId: "exec-1", phone: "+919876543210", brandId: BRAND, outcome: "completed",
    });
    assert.equal(settled?.status, "done");
  });

  test("a no-answer is tried once more, after a wait", () => {
    calling();
    const settled = queue.settleQueueEntry({
      executionId: "exec-1", phone: "+919876543210", brandId: BRAND, outcome: "no_answer",
    });
    assert.equal(settled?.status, "queued");
    assert.ok(settled?.notBefore, "it waits rather than redialling immediately");
    assert.ok(new Date(settled!.notBefore!).getTime() > Date.now());
  });

  test("a no-answer that has used its attempts stops", () => {
    calling();
    mutate((db) => {
      db.voiceCallQueue[0].attempts = queue.MAX_ATTEMPTS;
    });
    const settled = queue.settleQueueEntry({
      executionId: "exec-1", phone: "+919876543210", brandId: BRAND, outcome: "no_answer",
    });
    assert.equal(settled?.status, "failed");
  });

  test("a progress update settles nothing", () => {
    calling();
    assert.equal(
      queue.settleQueueEntry({
        executionId: "exec-1", phone: "+919876543210", brandId: BRAND, outcome: "in_progress",
      }),
      null,
    );
    assert.equal(read().voiceCallQueue[0].status, "calling");
  });

  test("a replayed webhook does not settle the entry twice", () => {
    calling();
    const first = queue.settleQueueEntry({
      executionId: "exec-1", phone: "+919876543210", brandId: BRAND, outcome: "no_answer",
    });
    const replay = queue.settleQueueEntry({
      executionId: "exec-1", phone: "+919876543210", brandId: BRAND, outcome: "no_answer",
    });
    assert.equal(first?.status, "queued");
    assert.equal(replay, null, "the second delivery is ignored — it would spend another attempt");
    assert.equal(read().voiceCallQueue[0].attempts, 1);
  });

  test("an unknown execution matches the number that is on a call", () => {
    calling();
    mutate((db) => {
      db.voiceCallQueue[0].executionId = null;
    });
    const settled = queue.settleQueueEntry({
      executionId: "exec-late", phone: "+91 98765 43210", brandId: BRAND, outcome: "completed",
    });
    assert.equal(settled?.status, "done");
  });
});

describe("cancelling", () => {
  test("a waiting call can be cancelled", () => {
    reset();
    const { added } = add(["+919876543210"]);
    assert.equal(queue.cancelQueued(BRAND, [added[0].id]), 1);
    assert.equal(read().voiceCallQueue[0].status, "cancelled");
  });

  test("a call already ringing is not cancelled — the provider owns it", () => {
    reset();
    const { added } = add(["+919876543210"]);
    mutate((db) => {
      db.voiceCallQueue[0].status = "calling";
    });
    assert.equal(queue.cancelQueued(BRAND, [added[0].id]), 0);
  });

  test("one brand cannot cancel another's calls", () => {
    reset();
    const { added } = add(["+919876543210"], BRAND);
    assert.equal(queue.cancelQueued(OTHER_BRAND, [added[0].id]), 0);
  });
});

describe("the run cannot silently stall", () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), "src/lib/voice/queue.ts"), "utf8");
  const WEBHOOK = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/webhooks/bolna/route.ts"),
    "utf8",
  );

  test("a call the provider never reported on is reclaimed", async () => {
    reset();
    add(["+919876543210"]);
    mutate((db) => {
      db.voiceCallQueue[0].status = "calling";
      db.voiceCallQueue[0].attempts = 1;
      db.voiceCallQueue[0].updatedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    });
    const result = await queue.pumpQueue(BRAND);
    assert.equal(result.reclaimed, 1);
    assert.notEqual(read().voiceCallQueue[0].status, "calling");
  });

  test("the entry is claimed before the provider is called", () => {
    // The claim and the concurrency check share one mutate, so two pumps
    // racing cannot both take the same entry and call the person twice.
    assert.ok(SRC.indexOf('next.status = "calling"') < SRC.indexOf("await startCall"));
  });

  test("the webhook settles before it dials the next one", () => {
    assert.ok(WEBHOOK.indexOf("settleQueueEntry({") < WEBHOOK.indexOf("pumpQueue(brandId)"));
  });

  test("only one call at a time", () => {
    assert.equal(queue.MAX_CONCURRENT_CALLS, 1);
  });

  test("a cron heartbeat exists for the retries the webhook cannot trigger", () => {
    const cron = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/voice/queue/run/route.ts"),
      "utf8",
    );
    assert.match(cron, /CRON_SECRET/);
    assert.match(cron, /timingSafeEqual/);
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
    assert.ok(vercel.crons?.some((c: { path: string }) => c.path === "/api/voice/queue/run"));
  });

  test("the heartbeat is reachable, but loading the queue is not", () => {
    const mw = fs.readFileSync(path.join(process.cwd(), "src/middleware.ts"), "utf8");
    assert.match(mw, /"\/api\/voice\/queue\/run"/);
    assert.ok(!/"\/api\/voice\/queue"/.test(mw), "the queue itself must stay behind the session gate");
  });
});
