import fs from "node:fs";
import path from "node:path";

/**
 * "Is this URL actually a FILE?"
 *
 * `assertSendableMediaUrl` answers a different question — *may* this link be
 * handed to WhatsApp at all. Both questions have to be answered, and this is
 * the one nobody was asking.
 *
 * Measured on the live configuration:
 *
 *   BROCHURE_URL     https://drive.google.com/file/d/…/view  -> 200 text/html  86 KB
 *   PROJECT_MAPS_URL https://maps.app.goo.gl/…               -> 200 text/html 224 KB
 *   a path the model invented on our own origin (/brobros/???) -> the 404 page
 *
 * Every one of those passes the allowlist, and WhatsApp happily attaches a web
 * page as `brochure.pdf`. The customer gets a 28 KB document that opens to
 * nothing. So before anything is delivered, confirm the bytes behind the URL
 * are a file and not a web page.
 *
 * Nothing here loosens the allowlist. It is a second, narrower gate that runs
 * after it and can only ever reject.
 */

export class UndeliverableMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndeliverableMediaError";
  }
}

/** This runs on the reply path with the customer waiting. Keep it short. */
const PROBE_TIMEOUT_MS = 2500;

/**
 * Hosts that serve an interactive page and never a file, whatever the path.
 *
 * A Google Maps short link is a LINK — the customer should receive it as text
 * they can tap, which is what the agent's own message already does. Attaching
 * it as a document is wrong every single time, so it is refused by host rather
 * than left to the content-type probe (which would also refuse it, one network
 * round-trip later, on the reply path).
 */
const LINK_ONLY_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
  "maps.apple.com",
]);

/** True for a link that is a place to visit, not a file to attach. */
export function isLinkOnlyUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (LINK_ONLY_HOSTS.has(host)) return true;
  // google.com is only link-only for its map paths; it is in the set above for
  // safety, but keep the explicit path test so the intent is readable.
  return /(^|\.)google\.[a-z.]+$/.test(host) && /^\/maps(\/|$)/.test(url.pathname);
}

/**
 * Extensions that WhatsApp can attach. Anything else — notably .html — is a
 * page, not a document, however it is renamed on the way out.
 */
const FILE_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".mp4", ".mov", ".3gp", ".mp3", ".ogg", ".m4a",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt",
]);

/** True for a content-type that is a web page rather than a file. */
export function isPageContentType(contentType: string | null): boolean {
  if (!contentType) return true; // unknown is not "known good"
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return (
    type === "text/html" ||
    type === "application/xhtml+xml" ||
    type === "text/plain" || // Drive's "sorry, can't scan" interstitial, among others
    type === ""
  );
}

// -----------------------------------------------------------------------------
// Our own origin: check the file on disk
// -----------------------------------------------------------------------------

/**
 * Assets on the app's own origin are files in `public/`, so they are verified
 * from disk instead of over the network.
 *
 * This is not an optimisation detour — it is the only check that works here.
 * NEXT_PUBLIC_APP_URL is `http://host.docker.internal:4321`, a name that means
 * something to the WhatsApp bridge container and nothing to this process; a
 * network probe of our own asset would spend the whole timeout and then reject
 * every real brochure. See the same note on assertResolvesPublic in safe-url.ts.
 */
function publicFileVerdict(pathname: string): "file" | "missing" | "unknown" {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "missing";
  }

  const root = path.join(process.cwd(), "public");
  const resolved = path.resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  // Refuse anything that climbs out of public/, even though the allowlist has
  // already constrained the origin.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return "missing";

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    // Not a file in public/. It may still be a legitimate dynamic route, so say
    // "unknown" and let the caller fall through to the network probe rather
    // than rejecting an asset this module simply cannot see.
    return fs.existsSync(root) ? "missing" : "unknown";
  }

  if (!stat.isFile() || stat.size === 0) return "missing";
  return FILE_EXTENSIONS.has(path.extname(resolved).toLowerCase()) ? "file" : "missing";
}

// -----------------------------------------------------------------------------
// Everything else: probe it
// -----------------------------------------------------------------------------

async function probe(href: string, method: "HEAD" | "GET"): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(href, {
      method,
      redirect: "follow",
      signal: controller.signal,
      // A one-byte ranged GET is enough to read the headers of a server that
      // refuses HEAD, without pulling a 12 MB brochure onto the reply path.
      headers: method === "GET" ? { range: "bytes=0-0" } : undefined,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Throws `UndeliverableMediaError` unless `href` really serves a file.
 *
 * `isAppOrigin` comes from the allowlist verdict, not from parsing the string
 * again — the caller already knows which of the two worlds this URL is in.
 */
export async function assertDeliverableFile(
  href: string,
  isAppOrigin: boolean,
): Promise<void> {
  if (isLinkOnlyUrl(href)) {
    throw new UndeliverableMediaError(
      "that link is a map/web page, not a file — it cannot be sent as a document. Send it to the customer as a plain text link in your reply instead.",
    );
  }

  if (isAppOrigin) {
    const verdict = publicFileVerdict(new URL(href).pathname);
    if (verdict === "file") return;
    if (verdict === "missing") {
      throw new UndeliverableMediaError(
        "no file exists at that path — you invented or mistyped the URL.",
      );
    }
    // "unknown" — fall through and probe it like any other URL.
  }

  let response = await probe(href, "HEAD");
  // 405/501 mean HEAD is not allowed; some CDNs answer 403 to HEAD only.
  if (!response || response.status === 405 || response.status === 501 || response.status === 403) {
    response = await probe(href, "GET");
  }

  if (!response) {
    throw new UndeliverableMediaError("that link could not be reached in time.");
  }
  if (!response.ok && response.status !== 206) {
    throw new UndeliverableMediaError(`that link returned ${response.status}, so there is no file there.`);
  }
  if (isPageContentType(response.headers.get("content-type"))) {
    throw new UndeliverableMediaError(
      "that link serves a web page, not a file — sending it would deliver an unreadable document.",
    );
  }
}

/** Convenience wrapper: true when the URL really serves a file. */
export async function isDeliverableFile(href: string, isAppOrigin: boolean): Promise<boolean> {
  try {
    await assertDeliverableFile(href, isAppOrigin);
    return true;
  } catch {
    return false;
  }
}
