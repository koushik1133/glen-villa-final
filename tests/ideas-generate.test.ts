import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateIdeas } from "../src/lib/ideas/generate";
import type { Database } from "../src/lib/types";

/**
 * The Post ideas page promises "generated from your own data" and prints a
 * "Why now" on every card. These guard that promise: an idea must be derived
 * from something the store actually holds, and must cite it.
 */
const BRAND = "brd_test";

function emptyDb(): Database {
  return {
    inventoryUnits: [], posts: [], dailyStats: [], brands: [], ideas: [],
  } as unknown as Database;
}

function unit(n: number, project: string, status: string, plotSqYds?: number) {
  return {
    id: `u${n}`, brandId: BRAND, project, unitNumber: String(n),
    kind: "villa", status, plotSqYds, tower: "", updatedAt: "", notes: "",
  };
}

describe("post idea generation", () => {
  test("an empty store yields no ideas rather than invented ones", () => {
    const { ideas, signals } = generateIdeas(emptyDb(), BRAND, new Date("2026-06-15"));
    assert.equal(ideas.length, 0, "ideas were produced with nothing to derive from");
    assert.equal(signals.read.length, 0);
  });

  test("inventory counts in the reason match the store exactly", () => {
    const db = emptyDb();
    db.inventoryUnits = [
      ...Array.from({ length: 7 }, (_, i) => unit(i, "serenity", "available", 300)),
      ...Array.from({ length: 5 }, (_, i) => unit(100 + i, "serenity", "no_leads", 400)),
    ] as never;

    const { ideas } = generateIdeas(db, BRAND, new Date("2026-06-15"));
    const walk = ideas.find((i) => i.title.includes("Walkthrough"));
    assert.ok(walk, "no inventory idea produced");
    // 7 available of 12 total — both numbers must be the real ones.
    assert.match(walk.reason, /7 of 12 units/);

    const gap = ideas.find((i) => i.title.includes("nobody has asked about"));
    assert.ok(gap, "no demand-gap idea produced");
    assert.match(gap.reason, /^5 units/);
  });

  test("a plot-size idea only fires when the sizes genuinely differ", () => {
    const db = emptyDb();
    // Same size throughout: there is no range to explain, so no idea.
    db.inventoryUnits = Array.from({ length: 6 }, (_, i) =>
      unit(i, "serenity", "available", 300)) as never;
    const same = generateIdeas(db, BRAND, new Date("2026-06-15")).ideas;
    assert.equal(same.filter((i) => i.title.includes("sq yds")).length, 0);

    db.inventoryUnits = [
      unit(1, "serenity", "available", 200),
      unit(2, "serenity", "available", 350),
      unit(3, "serenity", "available", 500),
    ] as never;
    const varied = generateIdeas(db, BRAND, new Date("2026-06-15")).ideas;
    const sizeIdea = varied.find((i) => i.title.includes("sq yds"));
    assert.ok(sizeIdea, "no plot-size idea despite a real range");
    assert.match(sizeIdea.title, /200–500 sq yds/);
  });

  test("a seasonal idea only appears inside its own lead window", () => {
    const db = emptyDb();
    // Diwali is 20 Oct with a 40-day lead. Mid-June is far outside it.
    const far = generateIdeas(db, BRAND, new Date("2026-06-15")).ideas;
    assert.equal(far.filter((i) => i.title.startsWith("Diwali")).length, 0);

    const near = generateIdeas(db, BRAND, new Date("2026-10-05")).ideas;
    const diwali = near.find((i) => i.title.startsWith("Diwali"));
    assert.ok(diwali, "Diwali idea missing 15 days out");
    assert.match(diwali.reason, /Diwali falls in 15 days/);
  });

  test("every idea states a reason and a usable outline", () => {
    const db = emptyDb();
    db.inventoryUnits = Array.from({ length: 9 }, (_, i) =>
      unit(i, "onyx", i % 2 ? "available" : "no_leads", 250 + i * 30)) as never;

    const { ideas } = generateIdeas(db, BRAND, new Date("2026-10-05"));
    assert.ok(ideas.length > 0);
    for (const i of ideas) {
      assert.ok(i.reason.trim().length > 30, `"${i.title}" has no real reason`);
      assert.ok(i.outline.length >= 3, `"${i.title}" has no usable outline`);
      assert.ok(i.hook.trim().length > 0, `"${i.title}" has no hook`);
      assert.ok(i.score > 0 && i.score <= 100, `"${i.title}" scored ${i.score}`);
      assert.equal(i.brandId, BRAND);
      assert.equal(i.used, false);
    }
  });

  test("ideas come back highest-confidence first", () => {
    const db = emptyDb();
    db.inventoryUnits = Array.from({ length: 20 }, (_, i) =>
      unit(i, "serenity", i < 12 ? "available" : "no_leads", 200 + i * 20)) as never;
    const { ideas } = generateIdeas(db, BRAND, new Date("2026-10-05"));
    const scores = ideas.map((i) => i.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });
});
