import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

/**
 * The sales manager's call flow must never fail silently.
 *
 * `act()` clears the busy spinner in a `finally`. If the fetch rejects, or the
 * body is an HTML error page that `res.json()` cannot parse, or the request is
 * refused with a non-2xx status, the throw used to escape the click handler and
 * the manager saw the button simply stop — no error, no success, no way to tell
 * whether the loan case had been opened. Each of those three failures must land
 * in the error slot with its own message.
 */
const SRC = fs.readFileSync(
  path.join(process.cwd(), "src/components/ops/sales-actions.tsx"),
  "utf8",
);

describe("sales call flow error states", () => {
  const act = SRC.slice(SRC.indexOf("async function act("), SRC.indexOf("return (\n    <Card"));

  test("the fetch itself is guarded, so an unreachable server is reported", () => {
    const fetchCall = act.slice(act.indexOf("await fetch("));
    const catchAfterFetch = fetchCall.slice(0, fetchCall.indexOf("await res.json()"));
    assert.match(catchAfterFetch, /\}\s*catch\s*\{[\s\S]*setError\(/);
  });

  test("the JSON parse is guarded separately, so an unreadable body is reported", () => {
    const parse = act.slice(act.indexOf("await res.json()"));
    assert.match(parse.slice(0, 400), /\}\s*catch\s*\{[\s\S]*setError\(/);
  });

  test("a refused request is reported even when the body parses", () => {
    assert.match(act, /!res\.ok/);
    assert.match(act, /if \(!res\.ok[\s\S]*?setError\(/);
  });

  test("success is only announced after the ok check", () => {
    assert.ok(act.indexOf("!res.ok") < act.indexOf("setMessage(success)"));
  });

  test("the spinner is still always cleared", () => {
    assert.match(act, /finally \{\s*setBusy\(null\);/);
  });
});
