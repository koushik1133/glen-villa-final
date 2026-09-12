import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The ported module was moved under a route prefix by a script that rewrote
 * string literals beginning with "/". That script could not tell a ROUTE from
 * a bare "/" used to parse or validate something, so it corrupted fourteen
 * literals across seven files — including three security controls:
 *
 *   safe-url.ts   the guard deciding whether a URL may be handed to Meta
 *   form-post.ts  the open-redirect guard, and its backslash normalisation
 *   settings.ts   path validation
 *
 * The visible symptom was that the WhatsApp agent could not send the brochure,
 * the site map or any photo: every stored asset URL is site-relative, the
 * corrupted `startsWith` rejected all of them, and the model fell back to
 * telling customers "the sales team will share it shortly".
 *
 * These assert the repaired forms directly, so the same rewrite cannot land
 * again unnoticed.
 */

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("route-prefixing never corrupted a bare '/' literal", () => {
  test("no string operation is performed against a route prefix", () => {
    const roots = ["src/lib/osf", "src/components/osf", "src/app/(app)/inbox/whatsapp"];
    const bad: string[] = [];

    const walk = (dir: string) => {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) return;
      for (const e of fs.readdirSync(full, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name)) {
          const src = read(rel);
          // `startsWith("/inbox/whatsapp")` on a ROUTE is legitimate; on a value
          // being validated as a path it is the corruption. Both read the same,
          // so the rule is simply that these parsing helpers never take a route.
          for (const re of [
            /startsWith\(\s*["'`]\/(?:os|inbox\/whatsapp)["'`]\s*\)/g,
            /split\(\s*["'`]\/(?:os|inbox\/whatsapp)["'`]\s*\)/g,
            /join\(\s*["'`]\/(?:os|inbox\/whatsapp)["'`]\s*\)/g,
            /replace\(\s*\/\\\\\/g\s*,\s*["'`]\/(?:os|inbox\/whatsapp)["'`]\s*\)/g,
          ]) {
            for (const m of src.matchAll(re)) bad.push(`${rel}: ${m[0]}`);
          }
        }
      }
    };
    roots.forEach(walk);

    assert.deepEqual(bad, [], "a bare '/' literal was rewritten into a route prefix");
  });

  test("the media URL guard accepts a site-relative asset path", () => {
    const src = read("src/lib/osf/net/safe-url.ts");
    assert.match(
      src,
      /if \(!candidate\.startsWith\("\/"\)\) return new URL\(candidate\);/,
      "toAbsolute no longer recognises a site-relative path — every stored asset URL is one, " +
        "so the agent would be unable to send the brochure, the layout or any photo",
    );
    assert.match(
      src,
      /\.replace\(\/\\\\\/g, "\/"\)/,
      "backslash normalisation is broken, so `/\\evil.com` would not be caught",
    );
  });

  test("the open-redirect guard still recognises a path", () => {
    const src = read("src/lib/osf/form-post.ts");
    assert.match(src, /if \(!normalized\.startsWith\("\/"\) \|\| normalized\.startsWith\("\/\/"\)\) return fallback;/);
    assert.match(src, /if \(!path\.startsWith\("\/"\) \|\| path\.startsWith\("\/\/"\)\) return fallback;/);
    assert.match(src, /\.replace\(\/\\\\\/g, "\/"\)/);
  });

  test("MIME subtypes are split on a slash, not a route", () => {
    assert.match(read("src/lib/osf/properties.ts"), /mime_type\?\.split\("\/"\)\[1\]/);
  });
});
