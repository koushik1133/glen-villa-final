import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { isAllowedMediaUrl } from "@/lib/osf/agent-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a file the WhatsApp agent sent, from this app's own origin.
 *
 * Why this exists rather than linking the stored URL directly: see
 * src/lib/osf/agent-media.ts. In short, the agent host serves plain http and
 * the browser will not load that into an https page or past our CSP, so the
 * brochure silently never appears.
 *
 * This is a deliberately narrow proxy, not a general fetcher:
 *
 *  - `customers.read` first, matching /api/osf/media. Whoever may read the
 *    conversation may read what was sent in it, and nobody else.
 *  - The URL is re-checked against the origin allowlist HERE rather than
 *    trusted from the caller. The value originates in a database row, and a
 *    row is not a permission to make a request on our behalf.
 *  - Only image, video, audio and PDF content is returned. A proxy that will
 *    stream back whatever the upstream labels it is a way to serve active
 *    content from our own origin, which is exactly what the CSP exists to stop.
 */

const ALLOWED_TYPES = /^(image\/|video\/|audio\/|application\/pdf\b)/i;

/** Big enough for a brochure or a site video, small enough not to be a tunnel. */
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET(req: Request) {
  const denied = await guard("customers.read");
  if (denied) return denied;

  const raw = new URL(req.url).searchParams.get("u") ?? "";
  if (!raw) return NextResponse.json({ error: "missing url" }, { status: 400 });
  if (!isAllowedMediaUrl(raw)) {
    return NextResponse.json({ error: "that host is not allowed" }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(raw, {
      redirect: "error", // a redirect could leave the allowlist
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "the media host did not respond" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "the file is not available" }, { status: 502 });
  }

  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (!ALLOWED_TYPES.test(type)) {
    return NextResponse.json({ error: "unsupported file type" }, { status: 415 });
  }

  const declared = Number(upstream.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": type,
      // Customer material: cached by the rep's browser, never by a shared
      // proxy, and never guessable from outside the session that fetched it.
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
