import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { cleanup, isolate } from "./helpers";

const dir = isolate("onyx-units");
after(() => cleanup(dir));

/* Imports must follow isolate() so the store points at the temp directory. */
const { read, resetToBootstrap } = require("../src/lib/db") as typeof import("../src/lib/db");
const inv = require("../src/lib/showcase/inventory") as typeof import("../src/lib/showcase/inventory");
const units = require("../src/lib/showcase/onyx-units") as typeof import("../src/lib/showcase/onyx-units");

/** Exactly as printed on the client's "3D APARTMENT PLANS" sheet. */
const PRINTED: Array<[number, number, string]> = [
  [1, 2594, "North"],
  [2, 2945, "East"],
  [3, 2032, "East"],
  [4, 2405, "West"],
  [5, 2457, "West"],
  [6, 2529, "West"],
  [7, 2571, "East"],
];

let BRAND = "";
before(() => {
  resetToBootstrap();
  BRAND = read().brands[0].id;
  inv.ensureInventorySeed(BRAND);
});

describe("onyx unit types", () => {
  test("seven types carry the printed size and facing", () => {
    assert.equal(units.ONYX_UNIT_TYPES.length, 7);
    for (const [position, sqFt, facing] of PRINTED) {
      const t = units.ONYX_UNIT_TYPES.find((x) => x.position === position);
      assert.ok(t, `no type for position ${position}`);
      assert.equal(t.sqFt, sqFt);
      assert.equal(t.facing, facing);
      assert.equal(t.planImage, `/showcase/onyx/unit-plan-${position}.webp`);
    }
  });

  test("seven units per floor across 35 floors matches the published count", () => {
    assert.equal(units.ONYX_UNIT_TYPES.length * 35, inv.ONYX_TOTAL);
  });

  test("every type has a room schedule with at least three bedrooms", () => {
    for (const t of units.ONYX_UNIT_TYPES) {
      assert.ok(t.rooms.length >= 10, `position ${t.position} has too few rooms`);
      const beds = t.rooms.filter((r) => /bedroom/i.test(r.name)).length;
      assert.ok(beds >= 3, `position ${t.position} lists ${beds} bedrooms`);
      // Every stated BHK must be justified by the drawn bedroom count.
      if (t.bhk) {
        const stated = Number.parseFloat(t.bhk);
        assert.ok(stated >= beds && stated < beds + 1, `position ${t.position}: ${t.bhk} vs ${beds} bedrooms`);
      }
      const kitchen = t.rooms.some((r) => /kitchen/i.test(r.name));
      assert.ok(kitchen, `position ${t.position} has no kitchen`);
    }
  });

  test("every plate position appears exactly once in the key-plan layout", () => {
    const cells = new Set<string>();
    for (const t of units.ONYX_UNIT_TYPES) {
      const cell = units.ONYX_PLATE_LAYOUT[t.position];
      assert.ok(cell, `position ${t.position} missing from the layout`);
      const key = `${cell.col}:${cell.row}`;
      assert.ok(!cells.has(key), `two units share plate cell ${key}`);
      cells.add(key);
    }
    // The centre of the middle band is the lift core, not a unit.
    assert.ok(!cells.has("1:1"));
  });
});

describe("unit number mapping", () => {
  test("maps floor and position across the tower", () => {
    assert.equal(units.onyxUnitPosition("1204"), 4);
    assert.equal(units.onyxUnitFloor("1204"), 12);
    assert.equal(units.onyxUnitType("1204")?.sqFt, 2405);

    assert.equal(units.onyxUnitPosition("3507"), 7);
    assert.equal(units.onyxUnitFloor("3507"), 35);
    assert.equal(units.onyxUnitType("3507")?.facing, "East");

    assert.equal(units.onyxUnitPosition("0101"), 1);
    assert.equal(units.onyxUnitFloor("0101"), 1);
    assert.equal(units.onyxUnitType("0101")?.sqFt, 2594);

    assert.equal(units.onyxUnitPosition("101"), 1);
    assert.equal(units.onyxUnitFloor("101"), 1);
  });

  test("rejects numbers that are not a floor plus a real position", () => {
    for (const bad of ["", "12", "abc", "1208", "1200", "12a4", "0004"]) {
      assert.equal(units.onyxUnitType(bad), undefined, `accepted "${bad}"`);
    }
    assert.equal(units.onyxUnitFloor("0004"), null);
  });

  test("every seeded onyx number resolves to a type", () => {
    for (const n of inv.onyxUnitNumbers()) {
      assert.ok(units.onyxUnitType(n), `no type for ${n}`);
    }
  });
});

describe("inventory carries the printed specification", () => {
  test("seeded sizes, facings and configurations match the type table", () => {
    const list = inv.listUnits(BRAND, "onyx");
    assert.equal(list.length, inv.ONYX_TOTAL);
    for (const u of list) {
      const t = units.onyxUnitType(u.unitNumber);
      assert.ok(t, `no type for ${u.unitNumber}`);
      assert.equal(u.builtUpSqFt, t.sqFt);
      assert.equal(u.facing, t.facing);
      assert.equal(u.bhk, t.bhk);
    }
  });

  test("published range and count still hold", () => {
    const sizes = inv.listUnits(BRAND, "onyx").map((u) => u.builtUpSqFt as number);
    assert.equal(Math.min(...sizes), 2032);
    assert.equal(Math.max(...sizes), 2945);
  });

  test("re-seeding backfills specs without disturbing a human-set status", () => {
    const unit = inv.listUnits(BRAND, "onyx")[0];
    inv.setUnitStatus(unit.id, "blocked", "tester", { override: true, notes: "held for a site visit" });
    inv.ensureInventorySeed(BRAND);
    const after = inv.getUnit(unit.id);
    assert.equal(after?.status, "blocked");
    assert.equal(after?.notes, "held for a site visit");
    assert.equal(after?.builtUpSqFt, units.onyxUnitType(unit.unitNumber)?.sqFt);
  });
});
