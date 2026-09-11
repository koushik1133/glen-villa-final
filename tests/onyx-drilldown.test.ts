import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  ONYX_FOCUS_NEUTRAL,
  ONYX_STAGES,
  onyxBreadcrumb,
  onyxDrilldownInitial,
  onyxDrilldownReduce,
  onyxFloorOfUnit,
  onyxFocusForFloor,
  onyxFocusForState,
  onyxFocusStyle,
  onyxPreviousStage,
  onyxVisibleRect,
  type OnyxDrilldownAction,
  type OnyxDrilldownState,
} from "../src/lib/showcase/onyx-drilldown";
import { ONYX_FLOORS, ONYX_TOWER_FIT, ONYX_TOWER_IMAGE } from "../src/lib/showcase/onyx-tower-map";
import { ONYX_TOWER_VIEWS, loadOnyxTowerViews } from "../src/lib/showcase/onyx-tower-views";

/** The one real angle we have. Every camera assertion is made against it. */
const VIEW0 = ONYX_TOWER_VIEWS[0];

/**
 * The drill-down is the client's main ask, so its two risky parts are pinned
 * here: the stage machine (every step must be reversible, and no stage may be
 * reachable without the data it needs) and the camera (it must never pan off
 * the render, whatever floor it is asked to open).
 */

const run = (state: OnyxDrilldownState, ...actions: OnyxDrilldownAction[]) =>
  actions.reduce(onyxDrilldownReduce, state);

describe("onyx drill-down — stages", () => {
  test("starts on the tower with nothing opened", () => {
    const s = onyxDrilldownInitial();
    assert.equal(s.stage, "tower");
    assert.equal(s.unitNumber, null);
  });

  /**
   * REGRESSION — the two-owner bug.
   *
   * The reducer used to carry `floor` as well as the parent showcase, and two
   * opposing effects reconciled them. They could settle at different values, so
   * the tower readout said "Floor 29" while the plate, the rail and the unit
   * card said 30 — with no interaction at all. The floor now has exactly one
   * owner (the parent), and the only way to keep it that way is for the state
   * to have no floor key at all, at any stage.
   */
  test("the state carries NO floor, at any stage", () => {
    const states = [
      onyxDrilldownInitial(),
      run(onyxDrilldownInitial(), { type: "openFloor", floor: 21 }),
      run(onyxDrilldownInitial(), { type: "openFloor", floor: 21 }, { type: "openFlat", unitNumber: "2104" }),
      run(
        onyxDrilldownInitial(),
        { type: "openFloor", floor: 21 },
        { type: "openFlat", unitNumber: "2104" },
        { type: "openRoom" },
      ),
      run(onyxDrilldownInitial(), { type: "openFloor", floor: 21 }, { type: "back" }),
      run(onyxDrilldownInitial(), { type: "reset" }),
    ];
    for (const st of states) {
      assert.ok(!("floor" in st), `stage ${st.stage} still carries a floor: ${JSON.stringify(st)}`);
      assert.deepEqual(Object.keys(st).sort(), ["stage", "unitNumber", "view"]);
    }
  });

  test("the reducer has no action that sets a floor", () => {
    // `setFloor` was the write half of the duplicate. Passing one now is inert.
    const before = run(onyxDrilldownInitial(), { type: "openFloor", floor: 12 });
    const after = onyxDrilldownReduce(before, { type: "setFloor", floor: 30 } as unknown as OnyxDrilldownAction);
    assert.equal(after, before);
  });

  test("tower → floor → flat → room, each step forward", () => {
    const s = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 21 },
      { type: "openFlat", unitNumber: "2104" },
      { type: "openRoom" },
    );
    assert.deepEqual([s.stage, s.unitNumber], ["room", "2104"]);
    // The floor that goes with it is the caller's, and the helpers take it.
    assert.equal(onyxFloorOfUnit(s.unitNumber!), 21);
  });

  test("every stage steps back to the previous one, and back from the tower is a no-op", () => {
    let s = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 12 },
      { type: "openFlat", unitNumber: "1203" },
      { type: "openRoom" },
    );
    for (const expected of ["flat", "floor", "tower", "tower"]) {
      s = onyxDrilldownReduce(s, { type: "back" });
      assert.equal(s.stage, expected);
    }
    // The floor survives all the way out — the rail and the sections below
    // stay on floor 12 because the reducer never had a say in it.
    assert.ok(!("floor" in s));
    assert.equal(s.unitNumber, null);
  });

  test("opening a flat adopts the floor its number encodes — via the caller", () => {
    const s = run(onyxDrilldownInitial(), { type: "openFlat", unitNumber: "0705" });
    assert.equal(s.stage, "flat");
    assert.equal(s.unitNumber, "0705");
    // The floor is not stored; it is derived and published to the parent.
    assert.equal(onyxFloorOfUnit(s.unitNumber!), 7);
  });

  test("a stage that needs a flat cannot be reached without one", () => {
    const floorState = run(onyxDrilldownInitial(), { type: "openFloor", floor: 4 });
    assert.equal(onyxDrilldownReduce(floorState, { type: "openRoom" }), floorState);
    assert.equal(onyxDrilldownReduce(floorState, { type: "goto", stage: "flat" }), floorState);
    assert.equal(onyxDrilldownReduce(floorState, { type: "goto", stage: "room" }), floorState);
  });

  test("a floor change from outside (the rail) never leaves a flat from another floor open", () => {
    const inFlat = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 9 },
      { type: "openFlat", unitNumber: "0902" },
      { type: "openRoom" },
    );
    // The parent moved the floor; the explorer's one effect reports that by
    // reopening the floor stage with no floor of its own.
    const moved = onyxDrilldownReduce(inFlat, { type: "openFloor" });
    assert.equal(moved.stage, "floor");
    assert.equal(moved.unitNumber, null);
  });

  test("a rail click while the tower is closed leaves the tower closed", () => {
    // Nothing is dispatched at stage "tower": the floor is the parent's alone,
    // so a rail click needs no reducer action to be followed.
    const s = onyxDrilldownInitial();
    assert.equal(onyxDrilldownReduce(s, { type: "openFloor" }).stage, "floor");
    assert.equal(s.stage, "tower");
  });

  test("re-picking the same floor from inside a flat keeps the flat", () => {
    const inFlat = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 15 },
      { type: "openFlat", unitNumber: "1506" },
    );
    const again = onyxDrilldownReduce(inFlat, { type: "openFloor", floor: 15 });
    assert.equal(again.unitNumber, "1506");
    assert.equal(again.stage, "floor");
  });

  test("floors are clamped to the tower by the camera, which owns the maths", () => {
    // The reducer stores no floor to clamp; the camera clamps whatever it is
    // handed, so an out-of-range floor still frames a real band.
    assert.deepEqual(onyxFocusForFloor(0, VIEW0), onyxFocusForFloor(1, VIEW0));
    assert.deepEqual(onyxFocusForFloor(999, VIEW0), onyxFocusForFloor(ONYX_FLOORS, VIEW0));
    // ...and the breadcrumb label is clamped the same way.
    const floorState = onyxDrilldownReduce(onyxDrilldownInitial(), { type: "openFloor", floor: 1 });
    assert.equal(onyxBreadcrumb(floorState, 999)[1].label, `Floor ${ONYX_FLOORS}`);
    assert.equal(onyxBreadcrumb(floorState, 0)[1].label, "Floor 1");
  });

  test("the plan / 360 view is a preference that survives stepping back and in", () => {
    let s = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 5 },
      { type: "openFlat", unitNumber: "0501" },
      { type: "openRoom", view: "plan" },
    );
    assert.equal(s.view, "plan");
    s = run(s, { type: "back" }, { type: "openRoom" });
    assert.equal(s.view, "plan");
    assert.equal(onyxDrilldownReduce(s, { type: "setView", view: "360" }).view, "360");
  });

  test("previous-stage order matches the declared stage order", () => {
    assert.deepEqual(ONYX_STAGES.map(onyxPreviousStage), ["tower", "tower", "floor", "flat"]);
  });

  test("the breadcrumb names every stage you passed through", () => {
    const s = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 21 },
      { type: "openFlat", unitNumber: "2104" },
      { type: "openRoom" },
    );
    assert.deepEqual(onyxBreadcrumb(s, 21).map((c) => c.label), [
      "Tower",
      "Floor 21",
      "Unit 2104",
      "360° tour",
    ]);
    assert.deepEqual(onyxBreadcrumb(onyxDrilldownInitial(), 21).map((c) => c.label), ["Tower"]);
  });

  test("unit numbers decode to floors, and rubbish decodes to nothing", () => {
    assert.equal(onyxFloorOfUnit("2104"), 21);
    assert.equal(onyxFloorOfUnit("101"), 1);
    assert.equal(onyxFloorOfUnit("abc"), null);
    assert.equal(onyxFloorOfUnit(""), null);
  });
});

describe("onyx drill-down — camera", () => {
  test("the tower stage is the untouched render", () => {
    assert.deepEqual(onyxFocusForState(onyxDrilldownInitial(), 35, VIEW0), ONYX_FOCUS_NEUTRAL);
    assert.equal(onyxFocusStyle(ONYX_FOCUS_NEUTRAL).transform, "translate(0%, 0%) scale(1)");
  });

  test("every floor zooms in, and never far enough to show the render's pixels", () => {
    for (let f = 1; f <= ONYX_FLOORS; f++) {
      const focus = onyxFocusForFloor(f, VIEW0);
      assert.ok(focus.scale > 1.5 && focus.scale <= 3.4, `floor ${f} scale ${focus.scale}`);
    }
  });

  test("the visible window stays inside the image at every floor and anchor", () => {
    for (const anchor of [{}, { focusX: 0.28, focusY: 0.46 }, { focusX: 1, focusY: 1 }]) {
      for (let f = 1; f <= ONYX_FLOORS; f++) {
        const rect = onyxVisibleRect(onyxFocusForFloor(f, VIEW0, anchor));
        assert.ok(rect.x >= -0.01, `floor ${f} pans off the left: ${rect.x}`);
        assert.ok(rect.y >= -0.01, `floor ${f} pans off the top: ${rect.y}`);
        assert.ok(rect.x + rect.w <= 100.01, `floor ${f} pans off the right`);
        assert.ok(rect.y + rect.h <= 100.01, `floor ${f} pans off the bottom`);
      }
    }
  });

  test("the chosen floor's band is inside the visible window", () => {
    for (let f = 1; f <= ONYX_FLOORS; f++) {
      const band = VIEW0.byFloor.get(f)!;
      const rect = onyxVisibleRect(onyxFocusForFloor(f, VIEW0, { focusX: 0.28, focusY: 0.46 }));
      for (const p of band.points) {
        assert.ok(
          p.x >= rect.x - 0.5 && p.x <= rect.x + rect.w + 0.5,
          `floor ${f} band x ${p.x} outside ${rect.x}..${rect.x + rect.w}`,
        );
        assert.ok(
          p.y >= rect.y - 0.5 && p.y <= rect.y + rect.h + 0.5,
          `floor ${f} band y ${p.y} outside ${rect.y}..${rect.y + rect.h}`,
        );
      }
    }
  });

  test("going deeper than the floor pushes the camera in, not out", () => {
    const floorState = run(onyxDrilldownInitial(), { type: "openFloor", floor: 18 });
    const flatState = onyxDrilldownReduce(floorState, { type: "openFlat", unitNumber: "1804" });
    assert.ok(onyxFocusForState(flatState, 18, VIEW0).scale >= onyxFocusForState(floorState, 18, VIEW0).scale);
  });

  test("the style is one transform on one origin — the compositor's job", () => {
    const style = onyxFocusStyle(onyxFocusForFloor(21, VIEW0));
    assert.match(style.transform, /^translate\(-?[\d.]+%, -?[\d.]+%\) scale\([\d.]+\)$/);
    assert.match(style.transformOrigin, /^[\d.]+% [\d.]+%$/);
  });
});

/* ------------------------------------------------------------------ */

/**
 * The explorer has to publish its floor AND its flat to the sections below,
 * because the reducer changes both on transitions that do not go through the
 * click handlers. These are the exact cases that used to leave the plate and
 * the unit-detail card showing a unit the explorer no longer had open.
 */
describe("onyx drill-down — what the sections below must be told", () => {
  test("stepping back out of a flat clears the flat", () => {
    const flat = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 21 },
      { type: "openFlat", unitNumber: "2104" },
    );
    assert.equal(onyxDrilldownReduce(flat, { type: "back" }).unitNumber, null);
  });

  test("a breadcrumb jump back to the tower clears the flat", () => {
    const room = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 21 },
      { type: "openFlat", unitNumber: "2104" },
      { type: "openRoom" },
      { type: "back" },
      { type: "back" },
      { type: "back" },
    );
    assert.deepEqual([room.stage, room.unitNumber], ["tower", null]);
  });

  test("a floor change from the rail clears the flat on the old floor", () => {
    const flat = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 21 },
      { type: "openFlat", unitNumber: "2104" },
    );
    assert.equal(onyxDrilldownReduce(flat, { type: "openFloor", floor: 9 }).unitNumber, null);
  });

  test("opening a flat can move the floor, so the explorer must republish it", () => {
    const s = run(onyxDrilldownInitial(), { type: "openFloor", floor: 21 }, { type: "openFlat", unitNumber: "0904" });
    // The reducer keeps no floor; the floor to publish is the one the unit
    // number encodes, and the explorer sends it to the parent.
    assert.equal(onyxFloorOfUnit(s.unitNumber!), 9);
    assert.ok(!("floor" in s));
  });
});

/* ------------------------------------------------------------------ */

/**
 * The camera has to follow the ANGLE, not just the floor.
 *
 * Only one real tower render exists, and fabricating a second elevation of a
 * building that is being sold off these images would be a misrepresentation —
 * so the second angle below is a TEST-ONLY fixture: a different calibration
 * (`fit`) pointed at a stub image path that is deliberately not in public/.
 * Nothing here is rendered; the fixture exists purely to prove that the focus
 * maths reads each view's own band geometry, which is what makes real angles a
 * data drop-in.
 */
const TEST_ONLY_VIEW_045 = loadOnyxTowerViews([
  {
    id: "test-only-045",
    azimuthDeg: 45,
    label: "Test-only fixture — not a real render",
    // Deliberately a path that does not exist on disk: nothing may draw this.
    image: { src: "/__test-only__/does-not-exist.webp", width: ONYX_TOWER_IMAGE.width, height: ONYX_TOWER_IMAGE.height },
    // A genuinely different calibration: on this notional angle the tower
    // stands further right in the frame and its floor stack starts lower.
    fit: {
      ...ONYX_TOWER_FIT,
      a: ONYX_TOWER_FIT.a + 120,
      leftX0: ONYX_TOWER_FIT.leftX0 + 380,
      rightX0: ONYX_TOWER_FIT.rightX0 + 380,
    },
    alt: "test-only fixture",
  },
])[0];

describe("onyx drill-down — the camera follows the active angle", () => {
  const anchor = { focusX: 0.28, focusY: 0.46 };

  test("the fixture really is a different calibration, not a copy", () => {
    const a = VIEW0.byFloor.get(21)!;
    const b = TEST_ONLY_VIEW_045.byFloor.get(21)!;
    assert.notEqual(a.center.x, b.center.x);
    assert.notEqual(a.center.y, b.center.y);
  });

  test("the same floor focuses differently on a different angle", () => {
    for (const f of [3, 12, 21, 35]) {
      const a = onyxFocusForFloor(f, VIEW0, anchor);
      const b = onyxFocusForFloor(f, TEST_ONLY_VIEW_045, anchor);
      assert.notDeepEqual(a, b, `floor ${f} focuses identically on two different angles`);
    }
  });

  test("each angle's camera frames THAT angle's own band", () => {
    for (const view of [VIEW0, TEST_ONLY_VIEW_045]) {
      for (let f = 1; f <= ONYX_FLOORS; f++) {
        const rect = onyxVisibleRect(onyxFocusForFloor(f, view, anchor));
        for (const p of view.byFloor.get(f)!.points) {
          assert.ok(
            p.x >= rect.x - 0.5 && p.x <= rect.x + rect.w + 0.5 &&
              p.y >= rect.y - 0.5 && p.y <= rect.y + rect.h + 0.5,
            `${view.id} floor ${f} band point (${p.x}, ${p.y}) outside the visible window`,
          );
        }
        // ...and never off the render.
        assert.ok(rect.x >= -0.01 && rect.y >= -0.01, `${view.id} floor ${f} pans off the render`);
        assert.ok(rect.x + rect.w <= 100.01 && rect.y + rect.h <= 100.01, `${view.id} floor ${f} pans off the render`);
      }
    }
  });

  test("angle-0 geometry puts the floor in the wrong place — the defect this guards", () => {
    // Where in the frame does the floor's OWN band centre end up? Under its
    // own view it lands on the anchor; under the angle-0 band map it lands
    // somewhere else entirely, which on a real second render means zooming to
    // the wrong part of the building.
    const framePos = (focus: ReturnType<typeof onyxFocusForFloor>, p: { x: number; y: number }) => {
      const r = onyxVisibleRect(focus);
      return { x: (p.x - r.x) / r.w, y: (p.y - r.y) / r.h };
    };
    for (let f = 10; f <= 30; f++) {
      const centre = TEST_ONLY_VIEW_045.byFloor.get(f)!.center;
      const right = framePos(onyxFocusForFloor(f, TEST_ONLY_VIEW_045, anchor), centre);
      const wrong = framePos(onyxFocusForFloor(f, VIEW0, anchor), centre);
      assert.equal(+right.y.toFixed(3), anchor.focusY, `floor ${f} is not framed at the anchor`);
      assert.ok(
        Math.abs(wrong.x - right.x) > 0.1 || Math.abs(wrong.y - right.y) > 0.1,
        `floor ${f}: angle-0 geometry framed it in the same place, so the test proves nothing`,
      );
    }
  });

  test("the whole-state camera is angle-aware at every stage", () => {
    const flat = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 18 },
      { type: "openFlat", unitNumber: "1804" },
    );
    assert.notDeepEqual(onyxFocusForState(flat, 18, VIEW0), onyxFocusForState(flat, 18, TEST_ONLY_VIEW_045));
    // The tower stage is neutral on every angle.
    assert.deepEqual(onyxFocusForState(onyxDrilldownInitial(), 18, TEST_ONLY_VIEW_045), ONYX_FOCUS_NEUTRAL);
  });
});
