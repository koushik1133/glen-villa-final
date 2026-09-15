import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { drawnArea, positionsWith3D, unitGeometry } from "../src/lib/showcase/onyx-unit-geometry";
import { ONYX_UNIT_TYPES } from "../src/lib/showcase/onyx-units";

/**
 * THE 3D CUTAWAY'S GEOMETRY
 *
 * The room rectangles are a hand transcription of an architect's sheet, which
 * means the failure mode is not a crash — it is a plausible-looking apartment
 * that is not the one being sold. These tests check the transcription against
 * the printed dimensions it claims to come from, and against itself.
 */

/** `13'-11" x 12'-0"` → { w: 13.9167, h: 12 } */
function parseDimensions(label: string): { w: number; h: number } | null {
  const m = label.match(/(\d+)'-(\d+)"\s*[xX]\s*(\d+)'-(\d+)"/);
  if (!m) return null;
  return {
    w: Number(m[1]) + Number(m[2]) / 12,
    h: Number(m[3]) + Number(m[4]) / 12,
  };
}

describe("every transcribed unit is a real unit", () => {
  for (const position of positionsWith3D()) {
    test(`unit ${position} exists in the plate's unit types`, () => {
      const type = ONYX_UNIT_TYPES.find((t) => t.position === position);
      assert.ok(type, `geometry claims a unit ${position} that the plate does not have`);
    });

    test(`unit ${position} cites the plan sheet it was read from`, () => {
      const type = ONYX_UNIT_TYPES.find((t) => t.position === position)!;
      assert.ok(type.planImage, "a transcription with no source sheet cannot be checked against anything");
    });
  }
});

describe("the drawn rooms match the printed schedule", () => {
  for (const position of positionsWith3D()) {
    const geometry = unitGeometry(position)!;
    const type = ONYX_UNIT_TYPES.find((t) => t.position === position)!;

    test(`unit ${position}: every room's footprint equals its printed dimensions`, () => {
      const wrong: string[] = [];
      for (const room of geometry.rooms) {
        if (!room.label) continue;
        const printed = parseDimensions(room.label);
        if (!printed) {
          wrong.push(`${room.name}: label "${room.label}" is not a dimension`);
          continue;
        }
        // An inch of slack: feet-and-inches to decimal is exact, but a room may
        // legitimately be entered transposed if the sheet reads that way.
        const matches =
          (Math.abs(room.w - printed.w) < 0.09 && Math.abs(room.h - printed.h) < 0.09) ||
          (Math.abs(room.w - printed.h) < 0.09 && Math.abs(room.h - printed.w) < 0.09);
        if (!matches) {
          wrong.push(`${room.name}: drawn ${room.w.toFixed(2)}x${room.h.toFixed(2)}, printed ${room.label}`);
        }
      }
      assert.deepEqual(wrong, [], `rooms drawn at a size the sheet does not print:\n  ${wrong.join("\n  ")}`);
    });

    test(`unit ${position}: every room the schedule lists is drawn`, () => {
      // Names repeat (three toilets, two sitouts), so compare counts per name.
      const count = (list: Array<{ name: string }>) =>
        list.reduce<Record<string, number>>((acc, r) => {
          const k = r.name.toLowerCase().replace(/^m\./, "master ").trim();
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {});
      const drawn = count(geometry.rooms);
      const printed = count([...type.rooms]);
      const missing = Object.entries(printed)
        .filter(([name, n]) => (drawn[name] ?? 0) < n)
        .map(([name, n]) => `${name} (${drawn[name] ?? 0} drawn, ${n} printed)`);
      assert.deepEqual(missing, [], `rooms on the sheet that the cutaway omits: ${missing.join(", ")}`);
    });
  }
});

describe("the layout is physically coherent", () => {
  for (const position of positionsWith3D()) {
    const geometry = unitGeometry(position)!;

    test(`unit ${position}: no room escapes the slab`, () => {
      const outside = geometry.rooms
        .filter((r) => r.x < -0.01 || r.y < -0.01 || r.x + r.w > geometry.extent.w + 0.01 || r.y + r.h > geometry.extent.h + 0.01)
        .map((r) => r.name);
      assert.deepEqual(outside, [], `rooms hanging off the slab: ${outside.join(", ")}`);
    });

    test(`unit ${position}: no two rooms occupy the same floor`, () => {
      const clashes: string[] = [];
      for (let i = 0; i < geometry.rooms.length; i++) {
        for (let j = i + 1; j < geometry.rooms.length; j++) {
          const a = geometry.rooms[i]!;
          const b = geometry.rooms[j]!;
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          // A quarter-foot of tolerance absorbs wall thickness read by eye;
          // anything more is two rooms in one place, which is a misread.
          if (ox > 0.25 && oy > 0.25) {
            clashes.push(`${a.name} over ${b.name} by ${ox.toFixed(1)}x${oy.toFixed(1)}ft`);
          }
        }
      }
      assert.deepEqual(clashes, [], `overlapping rooms:\n  ${clashes.join("\n  ")}`);
    });

    test(`unit ${position}: the drawn area is below the printed built-up area`, () => {
      const type = ONYX_UNIT_TYPES.find((t) => t.position === position)!;
      const drawn = drawnArea(geometry);
      assert.ok(drawn > 0, "nothing was drawn");
      assert.ok(
        drawn < type.sqFt,
        `drawn ${drawn} sq ft must be under the ${type.sqFt} sq ft built-up figure — ` +
          "built-up includes walls and a share of the common areas, so a drawn total " +
          "at or above it means rooms were transcribed too large",
      );
      // Sanity the other way: a plausible transcription is most of the unit.
      assert.ok(drawn > type.sqFt * 0.5, `drawn ${drawn} sq ft is implausibly small against ${type.sqFt} built-up`);
    });
  }
});

describe("a unit with no transcription offers no 3D view", () => {
  test("unitGeometry returns nothing rather than a guess", () => {
    const untranscribed = ONYX_UNIT_TYPES.map((t) => t.position).filter((p) => !positionsWith3D().includes(p));
    for (const p of untranscribed) {
      assert.equal(unitGeometry(p), undefined, `unit ${p} must have no geometry until its sheet is read`);
    }
  });

  test("null and undefined are handled", () => {
    assert.equal(unitGeometry(null), undefined);
    assert.equal(unitGeometry(undefined), undefined);
  });
});
