import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

import {
  PUBLISHED_PLOT_SIZES,
  VILLA_TYPES,
  isPublishedPlotSize,
  villaTypeByKey,
  villaTypeFor,
} from "../src/lib/showcase/villa-types";

/**
 * The five villa-type sheets are the only source for a Serenity built-up area.
 * These figures are transcribed from the "Total Build Up Area" and "Area
 * Statement" blocks printed on each sheet; if a number here ever drifts from
 * the artwork the site starts quoting areas the client never published.
 */
const PRINTED = [
  { key: "200-east", plotSqYds: 200, facing: "East", total: 2876, ground: 1246, first: 1246, second: 384 },
  { key: "267-east", plotSqYds: 267, facing: "East", total: 3715, ground: 1455, first: 1404, second: 856 },
  { key: "267-west", plotSqYds: 267, facing: "West", total: 3665, ground: 1410, first: 1399, second: 856 },
  { key: "300-east", plotSqYds: 300, facing: "East", total: 4277, ground: 1697, first: 1627, second: 953 },
  { key: "300-west", plotSqYds: 300, facing: "West", total: 4274, ground: 1645, first: 1613, second: 1016 },
] as const;

describe("villa types", () => {
  test("exactly the five published sheets exist", () => {
    assert.equal(VILLA_TYPES.length, 5);
    assert.deepEqual(
      VILLA_TYPES.map((t) => t.key).sort(),
      PRINTED.map((p) => p.key).sort(),
    );
  });

  test("every figure matches the printed sheet", () => {
    for (const p of PRINTED) {
      const t = villaTypeByKey(p.key);
      assert.ok(t, `missing ${p.key}`);
      assert.equal(t.plotSqYds, p.plotSqYds);
      assert.equal(t.facing, p.facing);
      assert.equal(t.totalSqFt, p.total);
      assert.deepEqual(t.floors, { ground: p.ground, first: p.first, second: p.second });
    }
  });

  test("the area statement sums to the printed total on every sheet", () => {
    for (const t of VILLA_TYPES) {
      const sum = t.floors.ground + t.floors.first + t.floors.second;
      assert.equal(sum, t.totalSqFt, `${t.key}: ${sum} != ${t.totalSqFt}`);
    }
  });

  test("no type is invented for an unpublished plot size or facing", () => {
    for (const t of VILLA_TYPES) {
      assert.ok(PUBLISHED_PLOT_SIZES.includes(t.plotSqYds));
    }
    // The client supplied no 200 sq yd WEST sheet, so no such type may exist.
    assert.equal(villaTypeByKey("200-west"), undefined);
    assert.equal(isPublishedPlotSize(234), false);
    assert.equal(isPublishedPlotSize(267), true);
  });

  test("plan images point at files that exist in public/", () => {
    // Tests run from the compiled .test-build tree, so anchor on the repo root.
    const root = process.cwd();
    for (const t of VILLA_TYPES) {
      assert.ok(fs.existsSync(path.join(root, "public", t.planImage)), `missing ${t.planImage}`);
      if (t.heroImage) {
        assert.ok(fs.existsSync(path.join(root, "public", t.heroImage)), `missing ${t.heroImage}`);
      }
    }
  });
});

describe("villaTypeFor", () => {
  test("an exact published size and facing is an exact match", () => {
    const m = villaTypeFor(267, "West");
    assert.ok(m);
    assert.equal(m.exact, true);
    assert.equal(m.type.key, "267-west");
    assert.equal(m.deltaSqYds, 0);
  });

  test("with no facing given the East sheet is used and still counts as exact", () => {
    const m = villaTypeFor(300);
    assert.ok(m);
    assert.equal(m.type.key, "300-east");
    assert.equal(m.exact, true);
  });

  test("a published size with no sheet for that facing is not exact", () => {
    const m = villaTypeFor(200, "West");
    assert.ok(m);
    assert.equal(m.type.key, "200-east");
    assert.equal(m.exact, false);
  });

  test("an unpublished size falls back to the nearest type, never exact", () => {
    for (const [size, key] of [
      [162, "200-east"],
      [220, "200-east"],
      [234, "267-east"],
      [290, "300-east"],
      [573, "300-east"],
    ] as const) {
      const m = villaTypeFor(size);
      assert.ok(m);
      assert.equal(m.type.key, key, `${size}`);
      assert.equal(m.exact, false);
      assert.equal(m.deltaSqYds, size - m.type.plotSqYds);
    }
  });

  test("boundaries: the midpoint goes to the smaller published type", () => {
    // 200/267 midpoint is 233.5, 267/300 midpoint is 283.5.
    assert.equal(villaTypeFor(233)!.type.plotSqYds, 200);
    assert.equal(villaTypeFor(234)!.type.plotSqYds, 267);
    assert.equal(villaTypeFor(283)!.type.plotSqYds, 267);
    assert.equal(villaTypeFor(284)!.type.plotSqYds, 300);
    // An exact tie resolves downward rather than by declaration order.
    assert.equal(villaTypeFor(283.5)!.type.plotSqYds, 267);
  });

  test("no plot size yields no match at all", () => {
    assert.equal(villaTypeFor(null), null);
    assert.equal(villaTypeFor(undefined), null);
    assert.equal(villaTypeFor(0), null);
    assert.equal(villaTypeFor(Number.NaN), null);
  });
});
