import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

/**
 * Loading-state coverage.
 *
 * Every page under (app) is force-dynamic, so without a loading.tsx in scope a
 * nav click renders nothing until the server finishes. The segment-level
 * (app)/loading.tsx is what guarantees a skeleton for the routes that have no
 * loading.tsx of their own, so it must exist and must render a skeleton.
 */
const ROOT = process.cwd();
const SEGMENT = path.join(ROOT, "src/app/(app)");

function pageDirs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) pageDirs(full, out);
    else if (entry.name === "page.tsx") out.push(dir);
  }
  return out;
}

describe("(app) loading states", () => {
  test("segment-level loading.tsx exists and renders a skeleton", () => {
    const file = path.join(SEGMENT, "loading.tsx");
    assert.ok(fs.existsSync(file), "src/app/(app)/loading.tsx is missing");
    const src = fs.readFileSync(file, "utf8");
    assert.match(src, /PageSkeleton/, "segment loading.tsx should render PageSkeleton");
    assert.match(src, /export default function/, "loading.tsx needs a default export");
  });

  test("every (app) page has a loading.tsx in scope", () => {
    const uncovered = pageDirs(SEGMENT).filter((dir) => {
      let cur = dir;
      while (cur.startsWith(SEGMENT)) {
        if (fs.existsSync(path.join(cur, "loading.tsx"))) return false;
        cur = path.dirname(cur);
      }
      return true;
    });
    assert.deepEqual(uncovered.map((d) => path.relative(ROOT, d)), []);
  });
});
