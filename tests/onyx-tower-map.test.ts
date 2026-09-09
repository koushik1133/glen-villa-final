import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  ONYX_FLOORS,
  ONYX_FLOOR_BANDS,
  ONYX_FLOOR_TONE_COLOR,
  ONYX_TOWER_FIT,
  ONYX_TOWER_IMAGE,
  onyxFloorBand,
  onyxFloorColor,
  onyxFloorTone,
} from "../src/lib/showcase/onyx-tower-map";

/**
 * The overlay is only worth anything if the bands land on the building. The
 * visual check lives in scripts/derive-onyx-tower-map.mjs --check; these tests
 * guard the invariants that a bad edit would break silently.
 */

const band = (floor: number) => {
  const b = onyxFloorBand(floor);
  assert.ok(b, `floor ${floor} has a band`);
  return b!;
};

/** Mean y of a band, in percent of the image. */
const midY = (floor: number) =>
  band(floor).points.reduce((a, p) => a + p.y, 0) / band(floor).points.length;

describe("onyx tower map — coverage", () => {
  test("one band per residential floor, ordered top to bottom", () => {
    assert.equal(ONYX_FLOORS, 35);
    assert.equal(ONYX_FLOOR_BANDS.length, 35);
    assert.deepEqual(
      ONYX_FLOOR_BANDS.map((b) => b.floor),
      Array.from({ length: 35 }, (_, i) => 35 - i),
    );
  });

  test("every band is a four-point quad with a matching polygon string", () => {
    for (const b of ONYX_FLOOR_BANDS) {
      assert.equal(b.points.length, 4, `floor ${b.floor}`);
      assert.equal(b.polygon, b.points.map((p) => `${p.x},${p.y}`).join(" "));
    }
  });

  test("an out-of-range floor has no band", () => {
    assert.equal(onyxFloorBand(0), undefined);
    assert.equal(onyxFloorBand(36), undefined);
  });
});

describe("onyx tower map — geometry", () => {
  test("floors ascend up the image: floor 1 is below floor 35", () => {
    assert.ok(midY(1) > midY(35));
  });

  test("y is strictly monotonic from floor 35 down to floor 1", () => {
    for (let f = 35; f > 1; f--) {
      assert.ok(midY(f - 1) > midY(f), `floor ${f - 1} must sit below floor ${f}`);
    }
  });

  test("bands stack without gaps: each floor's base is the next one's top", () => {
    for (let f = 35; f > 1; f--) {
      const upper = band(f); // TL, TR, BR, BL
      const lower = band(f - 1);
      assert.deepEqual(upper.points[3], lower.points[0]);
      assert.deepEqual(upper.points[2], lower.points[1]);
    }
  });

  test("every point sits inside the image", () => {
    for (const b of ONYX_FLOOR_BANDS) {
      for (const p of b.points) {
        assert.ok(p.x >= 0 && p.x <= 100, `floor ${b.floor} x=${p.x}`);
        assert.ok(p.y >= 0 && p.y <= 100, `floor ${b.floor} y=${p.y}`);
      }
    }
  });

  test("bands cover the façade, not the sky: x stays in the tower's column", () => {
    // The wide façade runs x 620..818 px of 1600 — 38.7%..51.2%.
    for (const b of ONYX_FLOOR_BANDS) {
      for (const p of b.points) {
        assert.ok(p.x > 37 && p.x < 53, `floor ${b.floor} x=${p.x} is off the façade`);
      }
    }
  });

  test("the stack spans the residential extent measured off the render", () => {
    // Bands are slanted, so take the mid-span of each edge — that is the y the
    // fit is stated at (the reference column, x = 720).
    const topPx = ((band(35).points[0].y + band(35).points[1].y) / 200) * ONYX_TOWER_IMAGE.height;
    const botPx = ((band(1).points[3].y + band(1).points[2].y) / 200) * ONYX_TOWER_IMAGE.height;
    // Top level under the crown at y≈91, lowest above the podium at y≈708.
    assert.ok(Math.abs(topPx - 91.4) < 3, `top ${topPx}`);
    assert.ok(Math.abs(botPx - 707.5) < 3, `bottom ${botPx}`);
  });

  test("each band is left-slanted: the right edge sits higher than the left", () => {
    for (const b of ONYX_FLOOR_BANDS) {
      const [tl, tr] = b.points;
      assert.ok(tr.y < tl.y, `floor ${b.floor} band should rise to the right`);
      assert.ok(tr.x > tl.x, `floor ${b.floor} right edge should be right of the left edge`);
    }
  });

  test("the perspective taper is real: upper bands are taller than lower ones", () => {
    const height = (f: number) => (band(f).points[3].y + band(f).points[2].y) / 2 -
      (band(f).points[0].y + band(f).points[1].y) / 2;
    assert.ok(height(35) > height(1));
    // …and the taper is gentle — no band is more than 15% off the mean.
    const hs = ONYX_FLOOR_BANDS.map((b) => height(b.floor));
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    for (const h of hs) assert.ok(Math.abs(h - mean) / mean < 0.15);
  });
});

describe("onyx tower map — fit quality", () => {
  test("the recorded residual is within a fifth of a floor", () => {
    const pitchPx =
      ((band(1).points[3].y - band(1).points[0].y) / 100) * ONYX_TOWER_IMAGE.height;
    assert.ok(ONYX_TOWER_FIT.maxResidualPx < pitchPx * 0.25, "max residual");
    assert.ok(ONYX_TOWER_FIT.rmsResidualPx < ONYX_TOWER_FIT.maxResidualPx);
  });

  test("the fit reproduces the detected line positions", () => {
    // The quadratic is stated for k = 0..34 (the 34 intervals actually painted
    // on the render); check the two ends against what the detector found.
    const y = (k: number) => ONYX_TOWER_FIT.a + ONYX_TOWER_FIT.b * k + ONYX_TOWER_FIT.c * k * k;
    assert.ok(Math.abs(y(0) - 91.4) < ONYX_TOWER_FIT.maxResidualPx);
    assert.ok(Math.abs(y(34) - 707.5) < ONYX_TOWER_FIT.maxResidualPx);
    // Aerial view: the top of the tower is nearer, so the pitch falls downward.
    assert.ok(y(1) - y(0) > y(34) - y(33));
  });
});

describe("onyx tower map — status to colour", () => {
  test("a floor with no units reads as empty", () => {
    assert.equal(onyxFloorTone(0, 0), "empty");
  });

  test("nothing open is sold, everything open is available", () => {
    assert.equal(onyxFloorTone(0, 7), "sold");
    assert.equal(onyxFloorTone(7, 7), "available");
  });

  test("half or more open is mostly, less is limited", () => {
    assert.equal(onyxFloorTone(4, 7), "mostly");
    assert.equal(onyxFloorTone(2, 7), "limited");
  });

  test("colour follows the tone", () => {
    assert.equal(onyxFloorColor(7, 7), ONYX_FLOOR_TONE_COLOR.available);
    assert.equal(onyxFloorColor(0, 7), ONYX_FLOOR_TONE_COLOR.sold);
    assert.equal(onyxFloorColor(0, 0), ONYX_FLOOR_TONE_COLOR.empty);
  });

  test("nonsense counts clamp instead of throwing", () => {
    assert.equal(onyxFloorTone(99, 7), "available");
    assert.equal(onyxFloorTone(-3, 7), "sold");
    assert.equal(onyxFloorTone(3, Number.NaN), "empty");
  });
});
