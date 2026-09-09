import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

import {
  SERENITY_CLUSTERS,
  SERENITY_PLAN,
  SERENITY_PLOTS,
  plotByNumber,
} from "../src/lib/showcase/serenity-plots";

/**
 * The plot hotspots are read off the official master plan and shown to buyers,
 * so this guards the things a bad edit would silently break: the count, unique
 * villa numbers, coordinates that stay inside the image, plot areas drawn only
 * from the set actually printed on the plan, and no two hotspots stacked on the
 * same point.
 */
const PLOT_COUNT = 182;

// Every distinct "SQ.YDS" value printed on the master plan.
const KNOWN_SIZES = new Set([
  162, 197, 199, 200, 202, 204, 207, 208, 209, 211, 212, 214, 215, 218, 220,
  222, 227, 229, 230, 234, 235, 237, 239, 247, 249, 254, 256, 267, 272, 275,
  278, 287, 290, 291, 293, 295, 296, 300, 303, 306, 312, 327, 328, 332,
  342, 362, 363, 382, 413, 525, 573,
]);

describe("serenity plots", () => {
  test("plan frame matches the master-plan image", () => {
    assert.match(SERENITY_PLAN.src, /^\/showcase\/serenity\//);
    // Assert against the file actually served, not a copied-out number: the
    // hotspot percentages are meaningless if the declared frame and the image
    // disagree, and a hardcoded size silently rots the moment the asset is
    // re-exported at a different resolution.
    const file = path.join(process.cwd(), "public", SERENITY_PLAN.src);
    const buf = fs.readFileSync(file);
    // WebP VP8 keyframe: dimensions are 14-bit LE values at offset 26/28.
    const vp8 = buf.indexOf(Buffer.from("VP8 ", "ascii"));
    assert.ok(vp8 > 0, "master plan is not a VP8 WebP");
    const width = buf.readUInt16LE(vp8 + 14) & 0x3fff;
    const height = buf.readUInt16LE(vp8 + 16) & 0x3fff;
    assert.equal(SERENITY_PLAN.width, width);
    assert.equal(SERENITY_PLAN.height, height);
  });

  test("has every villa plot exactly once", () => {
    assert.equal(SERENITY_PLOTS.length, PLOT_COUNT);
    const numbers = new Set(SERENITY_PLOTS.map((p) => p.number));
    assert.equal(numbers.size, PLOT_COUNT);
  });

  test("coordinates sit inside the plan frame", () => {
    for (const plot of SERENITY_PLOTS) {
      assert.ok(
        plot.xPct >= 0 && plot.xPct <= 100,
        `plot ${plot.number} xPct out of range: ${plot.xPct}`,
      );
      assert.ok(
        plot.yPct >= 0 && plot.yPct <= 100,
        `plot ${plot.number} yPct out of range: ${plot.yPct}`,
      );
    }
  });

  test("no two hotspots share a coordinate", () => {
    const seen = new Set<string>();
    for (const plot of SERENITY_PLOTS) {
      const key = `${plot.xPct},${plot.yPct}`;
      assert.ok(!seen.has(key), `duplicate coordinate at ${key}`);
      seen.add(key);
    }
  });

  test("plot sizes come from the set printed on the plan", () => {
    for (const plot of SERENITY_PLOTS) {
      if (plot.plotSqYds === null) continue;
      assert.ok(
        KNOWN_SIZES.has(plot.plotSqYds),
        `plot ${plot.number} has an unknown area: ${plot.plotSqYds}`,
      );
    }
  });

  test("every plot belongs to a declared cluster", () => {
    const clusters = new Set(SERENITY_CLUSTERS);
    for (const plot of SERENITY_PLOTS) {
      assert.ok(
        clusters.has(plot.cluster),
        `plot ${plot.number} has an unknown cluster: ${plot.cluster}`,
      );
    }
    const used = new Set(SERENITY_PLOTS.map((p) => p.cluster));
    for (const cluster of SERENITY_CLUSTERS) {
      assert.ok(used.has(cluster), `cluster ${cluster} has no plots`);
    }
  });

  test("plotByNumber finds plots by string or number", () => {
    const first = SERENITY_PLOTS[0];
    assert.equal(plotByNumber(first.number), first);
    assert.equal(plotByNumber(Number(first.number)), first);
    assert.equal(plotByNumber("9999"), undefined);
  });
});
