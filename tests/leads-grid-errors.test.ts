import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

/*
 * A rejected stage change used to be invisible: move() read res.json() blindly,
 * trusted json.ok and left the row untouched with no message, and an HTML error
 * page made res.json() throw straight out of the change handler. The component
 * is client-only React, so this guards the shape of the handler at the source
 * level: transport failure, unreadable body and refused request must each be
 * caught, and the grid must surface them in a role="alert" banner.
 */
const src = readFileSync(path.join(process.cwd(), "src/components/crm/leads-grid.tsx"), "utf8");
const move = src.slice(src.indexOf("async function move("), src.indexOf("function toggle<"));

describe("leads grid stage change error handling", () => {
  test("move() exists and is bounded", () => {
    assert.ok(move.length > 0, "move() not found in leads-grid.tsx");
  });

  test("an unreadable body is caught around res.json() rather than escaping", () => {
    const parse = move.indexOf("await res.json()");
    assert.ok(parse > 0, "move() no longer parses the response body");
    const before = move.slice(0, parse);
    assert.ok(/try\s*{[^}]*$/.test(before.slice(before.lastIndexOf("try"))), "res.json() is not inside its own try block");
    assert.match(move.slice(parse), /catch\s*{[\s\S]*?setError\(/, "an unreadable body does not set an error");
  });

  test("a non-ok response or a refused request sets an error and does not update the row", () => {
    assert.match(move, /!res\.ok/, "transport status is never checked");
    assert.match(move, /json\.ok !== true/, "the body's ok flag is never checked");
    const guard = move.indexOf("json.ok !== true");
    const update = move.indexOf("setRows(");
    assert.ok(guard < update, "rows are updated before the refusal guard runs");
    assert.match(move.slice(guard, update), /setError\([\s\S]*?return;/, "a refused request does not set an error and bail");
  });

  test("a network failure is caught and reported", () => {
    assert.match(move, /catch\s*{\s*setError\("Could not reach the server/, "fetch rejection is not reported");
  });

  test("errors surface in a dismissible alert region", () => {
    assert.match(src, /role="alert"/, "no role=alert banner renders the error");
    assert.match(src, /aria-label="Dismiss error"/, "the error banner is not dismissible");
    assert.match(src, /setError\(null\)/, "the error is never cleared");
  });
});

/*
 * A long lead name used to widen the auto-layout Lead column (truncate only
 * bites against a constrained width), squeezing "Last touch" into two lines.
 * The name wrapper is capped and the truncating child is min-w-0, with the
 * full name kept reachable via title.
 */
describe("leads grid name column width", () => {
  const cell = src.slice(src.indexOf("{initials(l.name)}"), src.indexOf("<Phone size={9} />"));

  test("the name wrapper is width-capped", () => {
    assert.match(cell, /max-w-\[\d+px\]/, "name wrapper has no max-width cap");
  });

  test("the truncating name is min-w-0 and keeps the full name in a title", () => {
    const end = cell.indexOf(">{l.name}<");
    assert.ok(end > 0, "lead name is no longer rendered as its own text node");
    const name = cell.slice(Math.max(0, end - 200), end);
    assert.match(name, /truncate/, "lead name no longer truncates");
    assert.match(name, /min-w-0/, "truncating name is not min-w-0");
    assert.match(name, /title=\{l\.name\}/, "full lead name is not exposed via title");
  });
});
