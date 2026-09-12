import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  assertDeliverableFile,
  isDeliverableFile,
  isLinkOnlyUrl,
  isPageContentType,
  UndeliverableMediaError,
} from "../src/lib/osf/net/deliverable";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * A web page must never leave as a document.
 *
 * This locks in a defect that reached real customers: BROCHURE_URL was a Google
 * Drive *view* page and PROJECT_MAPS_URL a maps.app.goo.gl page — both 200,
 * both text/html — and both were handed to send_media, which renames whatever
 * it is given to `brochure.pdf` / `location-map.pdf`. The customer received a
 * 28 KB file that opens to nothing. The allowlist said yes to both, because
 * "may this link be sent" is a different question from "is this a file".
 */
describe("a web page cannot be delivered as a document", () => {
  let origin = "";
  let server: http.Server;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      if (url.startsWith("/page")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>a drive viewer, not your brochure</body></html>");
      } else if (url.startsWith("/redirect")) {
        res.writeHead(302, { location: "/page" });
        res.end();
      } else if (url.startsWith("/no-head") && req.method === "HEAD") {
        res.writeHead(405);
        res.end();
      } else if (url.startsWith("/no-head")) {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF-1.4");
      } else if (url.startsWith("/missing")) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<html>not found</html>");
      } else {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF-1.4");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    origin = `http://127.0.0.1:${addr.port}`;
  });

  after(() => server.close());

  test("a 200 text/html URL is refused", async () => {
    await assert.rejects(
      () => assertDeliverableFile(`${origin}/page`, false),
      (e: unknown) =>
        e instanceof UndeliverableMediaError && /web page/.test((e as Error).message),
      "an HTML page was accepted as a sendable document",
    );
    assert.equal(await isDeliverableFile(`${origin}/page`, false), false);
  });

  test("a redirect that lands on HTML is refused", async () => {
    assert.equal(await isDeliverableFile(`${origin}/redirect`, false), false);
  });

  test("a 404 is refused", async () => {
    assert.equal(await isDeliverableFile(`${origin}/missing`, false), false);
  });

  test("a real PDF is allowed, including when HEAD is not permitted", async () => {
    assert.equal(await isDeliverableFile(`${origin}/real.pdf`, false), true);
    assert.equal(await isDeliverableFile(`${origin}/no-head.pdf`, false), true);
  });

  test("content types: only a real file type passes", () => {
    for (const bad of ["text/html", "text/html; charset=utf-8", "application/xhtml+xml", "text/plain", null]) {
      assert.equal(isPageContentType(bad), true, `${bad} should be treated as a page`);
    }
    for (const good of ["application/pdf", "image/jpeg", "video/mp4", "application/octet-stream"]) {
      assert.equal(isPageContentType(good), false, `${good} should be treated as a file`);
    }
  });
});

describe("a maps link is a link, never an attachment", () => {
  test("map hosts are refused outright", () => {
    for (const url of [
      "https://maps.app.goo.gl/aQsDQ2BhfgR6s9qk9?g_st=iw",
      "https://goo.gl/maps/abc",
      "https://maps.google.com/?q=x",
      "https://www.google.com/maps/place/x",
    ]) {
      assert.equal(isLinkOnlyUrl(url), true, `${url} must not be sendable as media`);
    }
    assert.equal(isLinkOnlyUrl("https://example.com/brochure.pdf"), false);
  });

  test("assertDeliverableFile refuses a maps link without a network call", async () => {
    await assert.rejects(
      () => assertDeliverableFile("https://maps.app.goo.gl/aQsDQ2BhfgR6s9qk9", false),
      (e: unknown) => e instanceof UndeliverableMediaError,
    );
  });
});

describe("a URL on our own origin must point at a file that exists", () => {
  test("an invented path is refused", async () => {
    await assert.rejects(
      () => assertDeliverableFile("http://host.docker.internal:4321/brobros/%3F%3F%3F", true),
      (e: unknown) => e instanceof UndeliverableMediaError,
      "a path the model invented was accepted",
    );
  });

  test("an .html file on our origin is refused", async () => {
    assert.equal(
      await isDeliverableFile("http://host.docker.internal:4321/index.html", true),
      false,
    );
  });

  test("the real hosted brochures pass", async () => {
    for (const p of [
      "/brochures/SERENITY%20%20Brochure.pdf",
      "/brochures/SERENITY%20mini%20Brochure.pdf",
      "/brochures/Serenity%20Layout.pdf",
    ]) {
      if (!fs.existsSync(path.join(ROOT, "public", decodeURIComponent(p)))) continue;
      assert.equal(
        await isDeliverableFile(`http://host.docker.internal:4321${p}`, true),
        true,
        `${p} is a real hosted file and must stay sendable`,
      );
    }
  });
});

describe("the send path actually applies the check", () => {
  const EXECUTE = "src/lib/osf/agent/execute.ts";

  test("send_media checks deliverability after the allowlist, before delivering", () => {
    const src = read(EXECUTE);
    const send = src.indexOf("async function sendMedia(");
    assert.notEqual(send, -1);
    const body = src.slice(send);
    const allow = body.indexOf("assertSendableMediaUrl");
    const check = body.indexOf("assertDeliverableFile");
    const deliver = body.indexOf("ctx.deliver({ mediaUrl:");
    assert.ok(allow !== -1 && check !== -1 && deliver !== -1, "send_media lost one of its gates");
    assert.ok(allow < check, "the allowlist must run first");
    assert.ok(check < deliver, "nothing may be delivered before it is confirmed to be a file");
  });

  test("the env fallback URLs are only used if they pass the check", () => {
    const src = read(EXECUTE);
    const fallback = src.indexOf("env.brochureUrl");
    assert.notEqual(fallback, -1);
    const window = src.slice(fallback - 400, fallback + 400);
    assert.ok(
      window.includes("isDeliverableFile"),
      "env.brochureUrl is handed out without confirming it serves a file",
    );
  });

  test("send_media refuses kind location_map", () => {
    const src = read(EXECUTE);
    const send = src.slice(src.indexOf("async function sendMedia("));
    assert.match(
      send.slice(0, 1200),
      /kind === "location_map"/,
      "send_media no longer refuses to attach a location",
    );
  });
});
