import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { drawnArea, positionsWith3D, unitGeometry, type RoomBox } from "../src/lib/showcase/onyx-unit-geometry";
import { ONYX_UNIT_TYPES } from "../src/lib/showcase/onyx-units";

/**
 * THE TRANSCRIBED FLOOR PLANS
 *
 * Each layout is read off an approved plan sheet by eye, which is exactly the
 * kind of work that goes subtly wrong: a room lands half a foot into its
 * neighbour, or hangs off the edge of the slab, and the render still looks
 * plausible enough that nobody notices.
 *
 * These checks caught a real one — unit 3's dining room overlapping the living
 * room by seven inches — before it shipped.
 */

function overlap(a: RoomBox, b: RoomBox): { x: number; y: number } | null {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  // An eighth of a foot of slop: these are hand-read positions, and abutting
  // rooms share a wall whose thickness nobody transcribed.
  return x > 0.08 && y > 0.08 ? { x, y } : null;
}

const POSITIONS = positionsWith3D();

describe("every transcribed unit is a possible building", () => {
  test("at least one unit has a layout, or the 3D view is dead code", () => {
    assert.ok(POSITIONS.length > 0);
  });

  for (const position of POSITIONS) {
    const g = unitGeometry(position)!;

    test(`unit ${position}: no room hangs off the slab`, () => {
      const escaped = g.rooms
        .filter((r) => r.x < -0.01 || r.y < -0.01 || r.x + r.w > g.extent.w + 0.05 || r.y + r.h > g.extent.h + 0.05)
        .map((r) => `${r.name} at ${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}x${r.h.toFixed(1)}`);
      assert.deepEqual(escaped, [], `outside the ${g.extent.w.toFixed(1)} x ${g.extent.h.toFixed(1)} ft slab`);
    });

    test(`unit ${position}: no two rooms occupy the same floor`, () => {
      const clashes: string[] = [];
      for (let i = 0; i < g.rooms.length; i++) {
        for (let j = i + 1; j < g.rooms.length; j++) {
          const o = overlap(g.rooms[i]!, g.rooms[j]!);
          if (o) clashes.push(`${g.rooms[i]!.name} / ${g.rooms[j]!.name} by ${o.x.toFixed(2)}x${o.y.toFixed(2)} ft`);
        }
      }
      assert.deepEqual(clashes, []);
    });

    test(`unit ${position}: every room has a real footprint`, () => {
      const silly = g.rooms.filter((r) => r.w <= 0 || r.h <= 0 || r.w > 60 || r.h > 60).map((r) => r.name);
      assert.deepEqual(silly, []);
    });

    test(`unit ${position}: the drawn area is under the printed built-up area`, () => {
      const printed = ONYX_UNIT_TYPES.find((u) => u.position === position)?.sqFt;
      assert.ok(printed, `unit ${position} has no printed area to check against`);
      const drawn = drawnArea(g);
      // Built-up includes walls and a share of the common areas, so the rooms
      // must total LESS. Drawn area exceeding it means a transcription is too
      // big somewhere; falling under a third means rooms are missing.
      assert.ok(drawn < printed!, `drawn ${drawn} should be under printed ${printed}`);
      assert.ok(drawn > printed! * 0.35, `drawn ${drawn} is implausibly small against ${printed}`);
    });

    test(`unit ${position}: every printed dimension is transcribed at its printed size`, () => {
      // The label carries the sheet's own text. Where it does, the rectangle
      // must actually be that size — a label saying 12'-0" on an 11ft box is
      // the worst kind of error, because it looks right and reads wrong.
      const wrong: string[] = [];
      for (const r of g.rooms) {
        if (!r.label) continue;
        const m = r.label.match(/(\d+)'-(\d+)" x (\d+)'-(\d+)"/);
        if (!m) { wrong.push(`${r.name}: unparseable label ${r.label}`); continue; }
        const w = Number(m[1]) + Number(m[2]) / 12;
        const h = Number(m[3]) + Number(m[4]) / 12;
        if (Math.abs(w - r.w) > 0.02 || Math.abs(h - r.h) > 0.02) {
          wrong.push(`${r.name}: drawn ${r.w.toFixed(2)}x${r.h.toFixed(2)} but labelled ${r.label}`);
        }
      }
      assert.deepEqual(wrong, []);
    });

    test(`unit ${position}: the entry sits on the slab`, () => {
      if (!g.entry) return;
      assert.ok(g.entry.x >= -0.05 && g.entry.x <= g.extent.w + 0.05, "entry x is off the slab");
      assert.ok(g.entry.y >= -0.05 && g.entry.y <= g.extent.h + 0.05, "entry y is off the slab");
    });
  }
});

describe("the transcriptions agree with the unit schedule", () => {
  for (const position of POSITIONS) {
    test(`unit ${position} exists in ONYX_UNIT_TYPES`, () => {
      assert.ok(
        ONYX_UNIT_TYPES.some((u) => u.position === position),
        "a layout for a unit the building does not have",
      );
    });

    test(`unit ${position}: no room is invented that the schedule does not list`, () => {
      const g = unitGeometry(position)!;
      const scheduled = new Set(
        ONYX_UNIT_TYPES.find((u) => u.position === position)!.rooms.map((r) => r.name.toLowerCase()),
      );
      // Numbered bedrooms and repeated toilets are named per-instance here, and
      // the study on unit 3 is drawn without a dimension, so those are exempt.
      const exempt = /^(bedroom \d|master bedroom|toilet|sitout|study|cupboard)$/i;
      const invented = g.rooms
        .map((r) => r.name)
        .filter((n) => !exempt.test(n) && !scheduled.has(n.toLowerCase()));
      assert.deepEqual(invented, [], "every room drawn must come from the sheet");
    });
  }
});
