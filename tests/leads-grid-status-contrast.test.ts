import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

/*
 * The per-row status <select> used to take its text colour straight from the
 * LEAD_STATUSES palette, which is tuned for a near-black surface: #22d3ee and
 * #fbbf24 as text on the white input of light mode land around 1.8:1, so the
 * lead's stage was unreadable. The hue now lives on the border plus a faint
 * tint of the input surface, and the label sits on a theme token.
 */
const root = process.cwd();
const src = readFileSync(path.join(root, "src/components/crm/leads-grid.tsx"), "utf8");
const start = src.indexOf("<select", src.indexOf("value={l.status}") - 400);
const select = src.slice(start, src.indexOf("</select>", start));

describe("leads grid status select contrast", () => {
  test("the select is found", () => {
    assert.ok(select.length > 0, "status <select> not found");
  });

  test("the raw status hue is not used as the text colour", () => {
    assert.doesNotMatch(select, /\bcolor:\s*status\.color/, "status.color is still the select's text colour");
    assert.doesNotMatch(select, /text-(white|black|slate-|gray-)/, "raw non-flipping text colour on the status select");
  });

  test("the label uses a theme token that flips between light and dark", () => {
    assert.match(select, /className="[^"]*\btext-mist-100\b/, "status label is not on text-mist-100");
  });

  test("the hue survives as a border and a tint of the input surface", () => {
    assert.match(select, /borderColor:\s*status\.color/, "status hue lost from the border");
    assert.match(select, /color-mix\(in srgb, \$\{status\.color\} \d+%, var\(--s-input\)\)/, "background is not a tint of the input surface");
  });

  test("the palette itself is unchanged (the filter dots still need it)", () => {
    const types = readFileSync(path.join(root, "src/lib/crm/types.ts"), "utf8");
    assert.match(types, /id: "contacted", label: "Contacted", color: "#22d3ee"/);
  });
});
