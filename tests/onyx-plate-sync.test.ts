import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

/**
 * REGRESSION: the floor plate showed one floor's heading above another floor's
 * units.
 *
 * The explorer drew the plate title from its own reducer floor but
 * received the tiles as a prop the parent had already resolved from ITS floor
 * state. The two advance on different ticks, so every floor change — most
 * visibly a rail click during the 700ms camera transition — had frames where
 * the heading said "Floor 27" above units 1901-1907.
 *
 * The fix is structural: the explorer takes a units-by-floor map and resolves
 * the list from the `floor` prop, so heading and tiles cannot disagree. These
 * assertions pin that shape, because a future edit could quietly reintroduce a
 * pre-resolved list and the desync would come back looking like a render glitch.
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("onyx floor plate stays in step with its heading", () => {
  const explorer = read("src/components/showcase/onyx-tower-explorer.tsx");
  const showcase = read("src/components/showcase/onyx-showcase.tsx");

  test("the explorer takes a per-floor map, not one pre-resolved list", () => {
    assert.match(explorer, /unitsByFloor:\s*ReadonlyMap<number,\s*ExplorerUnit\[\]>/);
    // Scope this to the exported component's own destructured props: the inner
    // presentational PlatePanel legitimately receives an already-resolved list.
    const params = explorer.slice(
      explorer.indexOf("export function OnyxTowerExplorer("),
      explorer.indexOf("const [state, dispatch]"),
    );
    assert.doesNotMatch(
      params,
      /^\s*units,\s*$/m,
      "a pre-resolved `units` prop on the explorer reintroduces the desync",
    );
  });

  test("the shown units are resolved from the single owner of the floor", () => {
    assert.match(explorer, /unitsByFloor\.get\(floor\)/);
    assert.doesNotMatch(explorer, /state\.floor/, "the reducer must not own a floor again");
  });

  test("the plate heading and its tiles come from the same floor", () => {
    const plate = explorer.match(/<PlatePanel[^/]*?\/>/s)?.[0] ?? "";
    assert.match(plate, /floor=\{floor\}/);
    assert.match(plate, /units=\{units\}/);
  });

  test("the parent supplies every floor, not just the selected one", () => {
    assert.match(showcase, /explorerUnitsByFloor/);
    assert.match(showcase, /unitsByFloor=\{explorerUnitsByFloor\}/);
  });
});
