/**
 * MEDIA THE AGENT SENT, SHOWN IN THIS CONSOLE.
 *
 * The WhatsApp agent runs on its own host and writes absolute URLs into
 * `villa_messages.media_url`, e.g.
 *
 *   http://<agent-host>:3000/brochures/SERENITY%20%20Brochure.pdf
 *
 * Two things stop those rendering here if they are used as-is:
 *
 *  - the Content-Security-Policy allows `img-src … https:` and no plain http,
 *    so the browser refuses them outright; and
 *  - once this console is served over https, a browser blocks http subresources
 *    as mixed content whatever the CSP says.
 *
 * The result is not an error anybody sees — it is an empty bubble where the
 * brochure should be. So the URL is rewritten to a same-origin path and the
 * bytes are fetched server-side, where neither rule applies.
 *
 * The origin is configurable because it belongs to a deployment, not to the
 * code, and it is an ALLOWLIST rather than an open proxy: this route takes a
 * full URL from the database, and a row an attacker could influence must never
 * become a request to an arbitrary host from inside our network.
 */

const DEFAULT_ORIGINS = ["http://187.127.169.216:3000"];

/** Origins whose media this console will fetch. Exact origin match only. */
export function allowedMediaOrigins(): string[] {
  const configured = (process.env.AGENT_MEDIA_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_ORIGINS;
}

export function isAllowedMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return allowedMediaOrigins().includes(u.origin);
  } catch {
    return false;
  }
}

/**
 * What to put in `src`/`href` for a stored `media_url`.
 *
 * Three shapes arrive here and each keeps its existing behaviour:
 *
 *  - an agent-host URL  → proxied through this app, same-origin;
 *  - any other absolute URL → passed through untouched (already https, or an
 *    origin somebody deliberately configured elsewhere);
 *  - a bare storage path → left alone for /api/osf/media, which signs private
 *    inbound files after checking a permission.
 */
export function mediaSrc(url: string): string {
  if (!/^https?:\/\//.test(url)) return `/api/osf/media/${url}`;
  if (!isAllowedMediaUrl(url)) return url;
  return `/api/osf/agent-media?u=${encodeURIComponent(url)}`;
}
