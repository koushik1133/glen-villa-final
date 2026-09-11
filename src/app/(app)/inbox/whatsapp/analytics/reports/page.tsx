import { Download, Info } from "lucide-react";
import { parseRange, rangeLabel, rangeToDays } from "@/components/osf/shell/nav-config";
import { Badge, Card, PageHeader, SetupNotice, formatNumber } from "@/components/osf/ui";
import {
  EXPORT_ROW_LIMIT,
  REPORT_KINDS,
  REPORT_META,
  analyticsWindow,
  reportSizes,
} from "@/lib/osf/analytics";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const w = analyticsWindow(rangeToDays(range));

  const page = await gatedLoad({ table: "villa_campaign_performance", migration: "001_schema.sql" }, () =>
    reportSizes(w),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Reports" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const sizes = page.data;

  return (
    <>
      <PageHeader
        title="Reports"
        sub="CSV exports built from live data at the moment you click — nothing is cached or pre-generated."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {REPORT_KINDS.map((kind) => {
          const meta = REPORT_META[kind];
          const rows = sizes[kind];
          const href = meta.ranged ? `/api/osf/reports/${kind}?range=${range}` : `/api/osf/reports/${kind}`;

          return (
            <Card
              key={kind}
              title={meta.label}
              hint={meta.description}
              actions={
                <Badge tone={meta.ranged ? "gold" : "neutral"}>
                  {meta.ranged ? rangeLabel(range) : "All time"}
                </Badge>
              }
            >
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex gap-8">
                  <div>
                    <p className="label">Rows</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-ink)]">
                      {formatNumber(rows)}
                    </p>
                  </div>
                  <div>
                    <p className="label">Columns</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-muted)]">
                      {meta.columns}
                    </p>
                  </div>
                </div>

                {/*
                  A plain link, not fetch(): the browser handles the
                  Content-Disposition itself, so the download survives a slow
                  query and needs no client JavaScript at all.
                */}
                <a
                  href={href}
                  download
                  aria-disabled={rows === 0}
                  className={`btn-gold ${rows === 0 ? "pointer-events-none opacity-40" : ""}`}
                >
                  <Download size={15} strokeWidth={2} aria-hidden />
                  {rows === 0 ? "Nothing to export" : "Download CSV"}
                </a>
              </div>

              {meta.capped && rows > EXPORT_ROW_LIMIT && (
                <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-warm)]">
                  This export is capped at {formatNumber(EXPORT_ROW_LIMIT)} rows, so{" "}
                  {formatNumber(rows - EXPORT_ROW_LIMIT)} of the {formatNumber(rows)} above will not be in the file —
                  the newest are kept. Narrow the date range to export the rest.
                </p>
              )}

              {!meta.ranged && (
                <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-muted)]">
                  The date range does not apply here — this report reads a reporting view that aggregates over all
                  time, so a filtered export would not reconcile with the numbers on screen.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Formats" className="mt-5">
        <div className="flex items-start gap-3">
          <Info size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-info)]" />
          <div className="space-y-3 text-sm leading-relaxed text-[var(--color-muted)]">
            <p>
              <span className="font-medium text-[var(--color-ink)]">CSV is the only export this build produces.</span> PDF
              export is not built. Rendering one server-side needs a PDF library this project does not carry, and
              adding a dependency for it is a decision for whoever owns the deployment, not something to slip in
              behind a download button.
            </p>
            <p>
              Files are UTF-8 with a byte-order mark and CRLF line endings, so Excel opens Indian names and the rupee
              sign correctly rather than guessing a codepage. Values containing commas, quotes or newlines are quoted
              per RFC 4180, and a cell that would otherwise start with <code>=</code>, <code>+</code> or{" "}
              <code>@</code> is prefixed with an apostrophe so a spreadsheet treats it as text rather than a formula.
            </p>
            <p>
              Money columns are plain integer rupees — the unit the database stores — not crore. Format them in the
              spreadsheet if you need to; the raw number is what reconciles.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}
