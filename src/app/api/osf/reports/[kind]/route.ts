import { NextResponse } from "next/server";
import { parseRange, rangeToDays } from "@/components/osf/shell/nav-config";
import {
  REPORT_KINDS,
  REPORT_META,
  analyticsWindow,
  isReportKind,
  reportPayload,
  toCsv,
} from "@/lib/osf/analytics";
import { configStatus } from "@/lib/osf/env";
import { requireTable } from "@/lib/osf/queries";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV export for the four report kinds.
 *
 * A GET rather than a POST because the browser has to be the one performing the
 * navigation: it is what turns Content-Disposition into a save dialog. That
 * also means the page needs no client JavaScript, and a slow query blocks the
 * download rather than a half-written file.
 *
 * The session cookie is checked by middleware before this handler runs — the
 * route is deliberately not on the public allow-list, so an unauthenticated
 * request gets a 401 rather than a dump of every lead.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const denied = await guard("analytics.view");
  if (denied) return denied;
  const { kind } = await params;

  if (!isReportKind(kind)) {
    return NextResponse.json(
      { error: `Unknown report "${kind}". Expected one of: ${REPORT_KINDS.join(", ")}.` },
      { status: 404 },
    );
  }

  // db() throws on missing credentials, which would surface as an opaque 500
  // on what is meant to be a one-click download.
  if (!configStatus().supabase) {
    return NextResponse.json(
      {
        error:
          "Supabase is not configured. Set OSF_SUPABASE_URL and OSF_SUPABASE_SERVICE_ROLE_KEY in .env.local.",
      },
      { status: 503 },
    );
  }

  // Without this a missing migration downloads a file containing nothing but a
  // header row, which reads as "no data in this period" rather than "this
  // relation does not exist yet". An export that is silently empty is worse
  // than no export at all, so the caller gets the same migration hint the
  // pages show instead.
  const source = await requireTable(REPORT_META[kind].source, "001_schema.sql");
  if (!source.ok) return NextResponse.json({ error: source.error }, { status: 503 });

  const range = parseRange(new URL(request.url).searchParams.get("range"));
  const ranged = REPORT_META[kind].ranged;
  const window = analyticsWindow(ranged ? rangeToDays(range) : null);

  const { headers, rows } = await reportPayload(kind, window);

  // Both parts come from closed sets — `kind` is narrowed by isReportKind and
  // `range` by parseRange — so nothing a caller supplies reaches the header.
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = ranged ? `villaos-${kind}-${range}-${stamp}.csv` : `villaos-${kind}-${stamp}.csv`;

  return new NextResponse(toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // An export is a point-in-time snapshot; a cached copy served to the next
      // person would silently be somebody else's numbers.
      "cache-control": "no-store, private",
    },
  });
}
