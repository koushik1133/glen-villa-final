import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { linkedinVersion } from "../src/lib/platforms/others";

/**
 * THE LINKEDIN CHANNEL PAGE
 *
 * The page reads posts through /api/channels/linkedin/posts. Three faults in
 * that route are covered here, each of which produced a screen that looked
 * either broken or — worse — confidently wrong.
 */

const ROOT = process.cwd();
const ROUTE = fs.readFileSync(
  path.join(ROOT, "src/app/api/channels/linkedin/posts/route.ts"),
  "utf8",
);
const STUDIO = fs.readFileSync(
  path.join(ROOT, "src/components/channels/linkedin-studio.tsx"),
  "utf8",
);

describe("the API version is deployment state, not a constant", () => {
  test("the route asks linkedinVersion() rather than freezing a version inline", () => {
    assert.match(ROUTE, /linkedinVersion\(\)/);
    assert.ok(
      !/"LinkedIn-Version":\s*"\d{6}"/.test(ROUTE),
      "a hardcoded LinkedIn-Version means bumping LINKEDIN_API_VERSION fixes publishing and silently leaves this page on a retired version",
    );
  });

  test("publishing and this page resolve the same version", () => {
    // Both paths must move together. If they drift, one half of the product
    // talks to a version the other half has already left behind.
    assert.equal(typeof linkedinVersion(), "string");
    assert.match(linkedinVersion(), /^\d{6}$/, "LinkedIn versions are YYYYMM");
  });

  test("LINKEDIN_API_VERSION overrides the default", () => {
    const before = process.env.LINKEDIN_API_VERSION;
    try {
      process.env.LINKEDIN_API_VERSION = "202699";
      assert.equal(linkedinVersion(), "202699");
    } finally {
      if (before === undefined) delete process.env.LINKEDIN_API_VERSION;
      else process.env.LINKEDIN_API_VERSION = before;
    }
  });
});

describe("a pasted token is checked before the app calls itself connected", () => {
  test("the save path probes LinkedIn rather than trusting the string", () => {
    assert.match(ROUTE, /api\.linkedin\.com\/v2\/userinfo/);
  });

  test("a token LinkedIn rejects is refused, not stored", () => {
    // 401 from the probe must return before the mutate() that writes the row
    // and sets status "connected".
    const probeAt = ROUTE.indexOf("userinfo");
    const refuseAt = ROUTE.indexOf("LinkedIn rejected that access token");
    const writeAt = ROUTE.indexOf('await import("@/lib/db")');
    assert.ok(probeAt !== -1 && refuseAt !== -1 && writeAt !== -1, "all three steps must be present");
    assert.ok(probeAt < writeAt, "the token must be probed before it is written");
    assert.ok(refuseAt < writeAt, "the refusal must return before the write");
  });

  test("LinkedIn being unreachable does not strand a valid token", () => {
    // Only 401 refuses. A 5xx or a timeout means we learned nothing about the
    // token, and refusing then would block someone holding a working one.
    assert.match(ROUTE, /probe\.status === 401/);
    assert.ok(
      !/probe\.ok\s*\)/.test(ROUTE.slice(ROUTE.indexOf("userinfo"))),
      "must not treat every non-2xx as a bad token",
    );
  });
});

describe("unmeasured impressions are not reported as zero", () => {
  test("the route returns null for impressions, not 0", () => {
    assert.match(ROUTE, /impressions: null as number \| null/);
    assert.ok(
      !/impressions:\s*0\b/.test(ROUTE),
      "a hardcoded 0 renders as a measurement of none, which is a different claim from 'not measured'",
    );
  });

  test("the type admits null so the UI has to handle it", () => {
    assert.match(STUDIO, /impressions: number \| null/);
  });

  test("the table shows a dash and the total says so in words", () => {
    assert.match(STUDIO, /p\.metrics\.impressions === null \? [\s\S]{0,120}—/);
    assert.match(STUDIO, /totals\.impressions === null \? [\s\S]{0,80}not reported/);
  });
});

describe("failures tell the reader what to do about them", () => {
  const cases: Array<[number, RegExp]> = [
    [401, /expired or been revoked/i],
    [403, /r_organization_social/],
    [426, /retired API version/i],
    [429, /rate-limiting/i],
  ];
  for (const [status, expected] of cases) {
    test(`${status} is explained, not just numbered`, () => {
      const block = ROUTE.slice(ROUTE.indexOf("function describeFailure"), ROUTE.indexOf("export async function GET"));
      assert.match(block, new RegExp(String(status)));
      assert.match(block, expected);
    });
  }

  test("the generic branch still carries the status and some of the body", () => {
    const block = ROUTE.slice(ROUTE.indexOf("function describeFailure"), ROUTE.indexOf("export async function GET"));
    assert.match(block, /LinkedIn returned \$\{status\}/);
  });
});

describe("the route is still gated", () => {
  test("reading posts needs analytics.view and writing credentials needs marketing.publish", () => {
    assert.match(ROUTE, /guard\("analytics\.view"\)/);
    assert.match(ROUTE, /guard\("marketing\.publish"\)/);
  });
});

describe("the page does not offer an authorisation flow it cannot run", () => {
  test("oauthConfigured is false when the credentials are absent", async () => {
    const { oauthConfigured } = await import("../src/lib/platforms/oauth");
    const before = { id: process.env.LINKEDIN_CLIENT_ID, secret: process.env.LINKEDIN_CLIENT_SECRET };
    try {
      delete process.env.LINKEDIN_CLIENT_ID;
      delete process.env.LINKEDIN_CLIENT_SECRET;
      assert.equal(oauthConfigured("linkedin"), false);

      // A blank string is the case that actually occurs: the variable is
      // present in .env with nothing after the "=", and `?? ""` then builds a
      // valid-looking URL carrying an empty client_id.
      process.env.LINKEDIN_CLIENT_ID = "   ";
      process.env.LINKEDIN_CLIENT_SECRET = "   ";
      assert.equal(oauthConfigured("linkedin"), false, "whitespace is not a credential");

      process.env.LINKEDIN_CLIENT_ID = "abc";
      assert.equal(oauthConfigured("linkedin"), false, "every declared variable must be present");

      process.env.LINKEDIN_CLIENT_SECRET = "def";
      assert.equal(oauthConfigured("linkedin"), true);
    } finally {
      if (before.id === undefined) delete process.env.LINKEDIN_CLIENT_ID;
      else process.env.LINKEDIN_CLIENT_ID = before.id;
      if (before.secret === undefined) delete process.env.LINKEDIN_CLIENT_SECRET;
      else process.env.LINKEDIN_CLIENT_SECRET = before.secret;
    }
  });

  test("the studio takes the answer as a prop instead of guessing", () => {
    assert.match(STUDIO, /oauthAvailable/);
    assert.match(STUDIO, /\{oauthAvailable \? \(/);
  });

  test("the channel page computes it on the server and passes it down", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/app/(app)/channels/[channel]/page.tsx"), "utf8");
    assert.match(page, /oauthAvailable=\{oauthConfigured\("linkedin"\)\}/);
  });

  test("the token route is still offered when OAuth is not available", () => {
    // The fallback must never be hidden behind the same condition — it is the
    // only path that works on a deployment without an application registered.
    assert.match(STUDIO, /Enter Access Token/);
  });
});
