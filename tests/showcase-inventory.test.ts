import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { cleanup, isolate } from "./helpers";

const dir = isolate("showcase-inventory");
after(() => cleanup(dir));

/* Imports must follow isolate() so the store points at the temp directory. */
const { read, resetToBootstrap } = require("../src/lib/db") as typeof import("../src/lib/db");
const inv = require("../src/lib/showcase/inventory") as typeof import("../src/lib/showcase/inventory");

let BRAND = "";
before(() => {
  resetToBootstrap();
  BRAND = read().brands[0].id;
  inv.ensureInventorySeed(BRAND);
});

describe("showcase inventory", () => {
  test("seeds both projects and is idempotent", () => {
    const first = inv.listUnits(BRAND).length;
    assert.equal(inv.listUnits(BRAND, "onyx").length, inv.ONYX_TOTAL);
    assert.ok(inv.listUnits(BRAND, "serenity").length >= 180);

    const again = inv.ensureInventorySeed(BRAND);
    assert.equal(again.created, 0);
    assert.equal(inv.listUnits(BRAND).length, first);
  });

  test("every unit has a status the layout can colour", () => {
    for (const u of inv.listUnits(BRAND)) {
      assert.ok(inv.UNIT_STATUSES.includes(u.status), `${u.unitNumber} has ${u.status}`);
    }
  });

  test("onyx unit numbers encode floor and unit", () => {
    const numbers = inv.onyxUnitNumbers();
    assert.equal(numbers.length, 245);
    assert.equal(new Set(numbers).size, 245);
    assert.equal(numbers[0], "101");
    assert.ok(numbers.includes("1204"));
    assert.equal(numbers[numbers.length - 1], "3507");

    const u = inv.listUnits(BRAND, "onyx").find((x) => x.unitNumber === "1204");
    assert.ok(u);
    assert.equal(u!.floor, 12);
    assert.equal(u!.kind, "flat");
  });

  test("the PRNG is stable across calls", () => {
    assert.equal(inv.seededRandom("onyx:1204")(), inv.seededRandom("onyx:1204")());
    assert.notEqual(inv.seededRandom("onyx:1204")(), inv.seededRandom("onyx:1205")());
    assert.equal(inv.demoStatus("onyx:1204"), inv.demoStatus("onyx:1204"));
  });

  test("the demo spread is plausible, not all one status", () => {
    const summary = inv.statusSummary(BRAND, "onyx");
    assert.equal(summary.total, inv.ONYX_TOTAL);
    assert.equal(
      inv.UNIT_STATUSES.reduce((n, s) => n + summary[s], 0),
      summary.total,
    );
    assert.ok(summary.available > summary.total * 0.3, `available=${summary.available}`);
    assert.ok(summary.sold > 0);
    assert.ok(summary.enquiry > 0);
  });

  test("transition guard: sold needs a customer, deal_pending needs a lead", () => {
    const unit = inv.listUnits(BRAND, "onyx")[0];
    assert.throws(() => inv.setUnitStatus(unit.id, "sold", "tester"), /linked customer/);
    assert.throws(() => inv.setUnitStatus(unit.id, "deal_pending", "tester"), /linked lead/);
    assert.throws(() => inv.setUnitStatus("unit_missing", "available", "tester"), /not found/);

    const sold = inv.setUnitStatus(unit.id, "sold", "tester", { customerId: "cust_1" });
    assert.equal(sold.status, "sold");
    assert.equal(sold.customerId, "cust_1");

    const forced = inv.setUnitStatus(inv.listUnits(BRAND, "onyx")[1].id, "sold", "tester", { override: true });
    assert.equal(forced.status, "sold");
  });

  test("a human change survives re-seeding", () => {
    const unit = inv.listUnits(BRAND, "serenity")[3];
    inv.setUnitStatus(unit.id, "blocked", "sales@example.com", { notes: "held for site visit" });
    inv.ensureInventorySeed(BRAND);
    const after = inv.getUnit(unit.id);
    assert.equal(after?.status, "blocked");
    assert.equal(after?.notes, "held for site visit");
  });

  test("linking a lead moves an untouched unit to enquiry and logs it", () => {
    const unit = inv.listUnits(BRAND, "serenity").find((u) => u.status === "available");
    assert.ok(unit);
    const linked = inv.linkLead(unit!.id, "lead_42", "sales@example.com");
    assert.equal(linked.status, "enquiry");
    assert.equal(linked.leadId, "lead_42");
    assert.ok(read().activity.some((a) => a.kind === "inventory_status"));
  });
});
