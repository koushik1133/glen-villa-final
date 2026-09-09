import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

/**
 * Every full-screen overlay must be dismissible with Escape.
 *
 * These panels are shown to a customer sitting next to the salesperson; the way
 * out cannot be a small X in a corner. The Serenity master plan stacks three of
 * them (villa detail, full-screen layout image, interior tour) and must close
 * only the topmost one, so leaving the tour does not also drop the villa panel
 * underneath it.
 *
 * These are source assertions, not DOM tests: the app is auth-gated and there is
 * no browser test runner here, so we pin the handler's presence and ordering.
 */

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("overlay Escape handling", () => {
  const dialogs = [
    "src/components/board-settings.tsx",
    "src/components/whatsapp-inbox/simulator.tsx",
    "src/components/showcase/serenity-master-plan.tsx",
  ];

  for (const file of dialogs) {
    test(`${file} listens for Escape`, () => {
      const src = read(file);
      assert.match(src, /addEventListener\("keydown"/, `${file}: no keydown listener`);
      assert.match(src, /e\.key (===|!==) "Escape"/, `${file}: no Escape check`);
      assert.match(src, /removeEventListener\("keydown"/, `${file}: listener never removed`);
    });
  }

  for (const file of dialogs.slice(0, 2)) {
    test(`${file} is announced as a modal dialog`, () => {
      const src = read(file);
      assert.match(src, /role="dialog"/, `${file}: missing role=dialog`);
      assert.match(src, /aria-modal="true"/, `${file}: missing aria-modal`);
      assert.match(src, /aria-label=/, `${file}: dialog has no accessible name`);
    });
  }

  test("Serenity closes only the topmost stacked overlay", () => {
    const src = read("src/components/showcase/serenity-master-plan.tsx");
    const handler = src.slice(src.indexOf('if (e.key !== "Escape") return;'));
    const tour = handler.indexOf("setTour(null)");
    const zoom = handler.indexOf("setPlanZoom(null)");
    const selected = handler.indexOf("setSelected(null)");
    assert.ok(tour >= 0 && zoom >= 0 && selected >= 0, "all three overlays must be handled");
    // Innermost first, each in an else branch, so one Escape closes one layer.
    assert.ok(tour < zoom && zoom < selected, "layers must be closed topmost-first");
    assert.equal((handler.slice(tour, selected).match(/\belse\b/g) ?? []).length, 2);
  });
});
