import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

import {
  onyxBreadcrumb,
  onyxDrilldownInitial,
  onyxDrilldownReduce,
  onyxFloorOfUnit,
  onyxFocusForState,
  type OnyxDrilldownAction,
  type OnyxDrilldownState,
} from "../src/lib/showcase/onyx-drilldown";
import { ONYX_TOWER_VIEWS } from "../src/lib/showcase/onyx-tower-views";

/**
 * REGRESSION: the selected floor drifted between two owners while idle.
 *
 * On /showcase?project=onyx, with no interaction at all, the tower's readout
 * label said "Floor 29 selected" while the floor plate heading, the rail and
 * the unit card below said Floor 30. Clicking was never broken — the two
 * owners simply settled at different values.
 *
 * The floor was stored twice: `useState` in onyx-showcase.tsx AND `floor` on
 * `OnyxDrilldownState` inside the explorer's reducer, reconciled by two
 * opposing effects (one dispatched `setFloor` from the prop, the other called
 * `onFloorChange(state.floor)` when they differed). Depending on effect
 * ordering a render could commit with the two disagreeing.
 *
 * The fix is structural, not another guard: the parent is the sole owner and
 * the reducer carries no floor. These tests pin that, at the reducer level and
 * at the source level for the component (in the style of onyx-plate-sync).
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const run = (state: OnyxDrilldownState, ...actions: OnyxDrilldownAction[]) =>
  actions.reduce(onyxDrilldownReduce, state);

describe("onyx floor — exactly one owner", () => {
  test("the reducer's state has no `floor` key", () => {
    const s = onyxDrilldownInitial();
    assert.ok(!("floor" in s));
    assert.deepEqual(Object.keys(s).sort(), ["stage", "unitNumber", "view"]);
  });

  test("no reducer transition can ever introduce one", () => {
    const actions: OnyxDrilldownAction[][] = [
      [{ type: "openFloor", floor: 30 }],
      [{ type: "openFloor" }],
      [{ type: "openFloor", floor: 30 }, { type: "openFlat", unitNumber: "3004" }],
      [{ type: "openFloor", floor: 30 }, { type: "openFlat", unitNumber: "3004" }, { type: "openRoom" }],
      [{ type: "openFloor", floor: 30 }, { type: "goto", stage: "tower" }],
      [{ type: "openFloor", floor: 30 }, { type: "back" }],
      [{ type: "setView", view: "plan" }],
      [{ type: "reset" }],
    ];
    for (const seq of actions) {
      const s = run(onyxDrilldownInitial(), ...seq);
      assert.ok(!("floor" in s), `${JSON.stringify(seq)} reintroduced a floor`);
    }
  });

  test("the parent's floor changing while at stage flat resets the stage and clears the unit", () => {
    const inFlat = run(
      onyxDrilldownInitial(),
      { type: "openFloor", floor: 29 },
      { type: "openFlat", unitNumber: "2904" },
    );
    assert.deepEqual([inFlat.stage, inFlat.unitNumber], ["flat", "2904"]);

    // The parent moved to floor 30. The explorer's one effect reports that as
    // an "openFloor" with no floor of its own — the flat was on floor 29.
    const moved = onyxDrilldownReduce(inFlat, { type: "openFloor" });
    assert.equal(moved.stage, "floor");
    assert.equal(moved.unitNumber, null);
    // And the same from stage "room".
    const fromRoom = onyxDrilldownReduce(
      onyxDrilldownReduce(inFlat, { type: "openRoom" }),
      { type: "openFloor" },
    );
    assert.equal(fromRoom.stage, "floor");
    assert.equal(fromRoom.unitNumber, null);
  });

  test("the floor-dependent helpers take the floor as a parameter", () => {
    const floorState = run(onyxDrilldownInitial(), { type: "openFloor", floor: 30 });
    // The crumb follows whatever the parent says, not a stored copy.
    assert.equal(onyxBreadcrumb(floorState, 29)[1].label, "Floor 29");
    assert.equal(onyxBreadcrumb(floorState, 30)[1].label, "Floor 30");
    // So does the camera.
    const view = ONYX_TOWER_VIEWS[0];
    assert.notDeepEqual(
      onyxFocusForState(floorState, 29, view),
      onyxFocusForState(floorState, 30, view),
    );
  });

  test("a flat still knows its own floor — from its number, not from state", () => {
    const s = run(onyxDrilldownInitial(), { type: "openFlat", unitNumber: "2904" });
    assert.equal(onyxFloorOfUnit(s.unitNumber!), 29);
  });
});

describe("onyx floor — the component reads the prop, not a copy", () => {
  const explorer = read("src/components/showcase/onyx-tower-explorer.tsx");
  const showcase = read("src/components/showcase/onyx-showcase.tsx");
  const render = read("src/components/showcase/onyx-tower-render.tsx");

  test("the explorer has no `state.floor` left anywhere", () => {
    assert.doesNotMatch(explorer, /state\.floor/);
    assert.doesNotMatch(explorer, /setFloor/);
  });

  test("the tower readout is drawn from the floor prop", () => {
    // `selected` is what draws the readout label. It must be the prop.
    assert.match(explorer, /selected=\{floor\}/);
    assert.match(explorer, /spotlightFloor=\{open \? floor : null\}/);
  });

  test("the render still takes `selected` as a prop and owns no floor state", () => {
    assert.match(render, /selected:\s*number;/);
    assert.doesNotMatch(render, /useState<number \| null>\(null\);\s*\n\s*const \[selected/);
    // The only selection-ish state it may own is the hover highlight.
    const states = [...render.matchAll(/const \[(\w+),/g)].map((m) => m[1]);
    for (const name of states) {
      assert.ok(
        !/^(floor|selected|selectedFloor)$/.test(name),
        `onyx-tower-render owns its own floor state: ${name}`,
      );
    }
    assert.ok(states.includes("hover"), "hover is legitimate and expected");
  });

  test("the parent is the sole owner of the floor state", () => {
    assert.match(showcase, /const \[floor, setFloor\] = useState\(FLOORS\)/);
    assert.match(showcase, /onFloorChange=\{setFloor\}/);
    assert.match(showcase, /floor=\{floor\}/);
  });

  test("the explorer keeps exactly ONE effect that reacts to the floor prop", () => {
    // The bug was two opposing reconciliation effects. Count the effects whose
    // dependency array mentions `floor`; there must be exactly one.
    const deps = [...explorer.matchAll(/\}\,\s*\[([^\]]*)\]\);/g)].map((m) => m[1]);
    const floorEffects = deps.filter((d) => /\bfloor\b/.test(d) && !/unitsByFloor/.test(d));
    assert.equal(
      floorEffects.length,
      1,
      `expected one floor-driven effect, found ${floorEffects.length}: ${floorEffects.join(" | ")}`,
    );
  });
});
