import { AlertCircle, PencilLine, Plus } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatCr,
  formatDate,
  formatNumber,
  formatPercent,
  type BadgeTone,
} from "@/components/osf/ui";
import { CAMPAIGN_STATUSES, campaignPerformance, listCampaigns } from "@/lib/osf/campaigns";
import { humanise } from "@/lib/osf/crm";
import { overviewMetrics } from "@/lib/osf/marketing/studio";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function rupees(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${INR.format(Math.round(value))}`;
}

function multiple(ratio: number | null): string {
  return ratio === null ? "—" : `${ratio.toFixed(2)}×`;
}

function pct(ratio: number | null): string {
  return ratio === null ? "—" : formatPercent(ratio * 100, 2);
}

const STATUS_TONE: Record<string, BadgeTone> = {
  active: "success",
  paused: "warning",
  ended: "neutral",
  draft: "info",
};

/** Suggestions only — the field is free text, and the value is never validated against this. */
const PLATFORM_SUGGESTIONS = [
  "Meta Ads",
  "Google Ads",
  "Instagram",
  "Facebook",
  "WhatsApp",
  "Housing.com",
  "MagicBricks",
  "99acres",
  "Referral",
  "Hoarding",
];

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const page = await gatedLoad({ table: "villa_campaigns", migration: "001_schema.sql" }, () =>
    Promise.all([campaignPerformance(), listCampaigns()] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Campaigns" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [rows, campaigns] = page.data;
  const metrics = overviewMetrics(rows);
  const maxSpend = Math.max(0, ...rows.map((r) => r.spent_inr));
  const lastTouched = campaigns.reduce<string | null>(
    (latest, c) => (latest === null || c.updated_at > latest ? c.updated_at : latest),
    null,
  );

  return (
    <>
      <PageHeader
        title="Campaigns"
        sub="Every economic figure here is derived from numbers a person typed in. Until an ad API is connected, spend is only as current as the last manual update."
      />

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] px-4 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle size={15} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Campaigns"
          value={formatNumber(metrics.campaigns)}
          sub={`${metrics.activeCampaigns} active`}
        />
        <Stat
          label="Recorded spend"
          value={rupees(metrics.totalSpendInr)}
          sub={lastTouched ? `Last edited ${formatDate(lastTouched)}` : "Nothing recorded yet"}
        />
        <Stat
          label="Blended CTR"
          value={pct(metrics.blendedCtr)}
          sub={`${formatNumber(metrics.totalClicks)} clicks / ${formatNumber(metrics.totalImpressions)} impressions`}
        />
        <Stat
          label="Blended CPL"
          value={rupees(metrics.blendedCplInr)}
          sub={`${formatNumber(metrics.totalLeads)} campaign leads`}
        />
        <Stat
          gold
          label="Blended ROAS"
          value={multiple(metrics.blendedRoas)}
          sub={`${formatCr(metrics.totalRevenueInr)} booked`}
        />
      </div>

      <Card className="mt-5">
        {rows.length === 0 ? (
          <Empty>No campaigns yet. Add the first one below, using the exact name you tag on the ad.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead className="border-b border-[var(--color-line)]">
                <tr>
                  <th className="th">Campaign</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Spend</th>
                  <th className="th text-right">Impressions</th>
                  <th className="th text-right">Clicks</th>
                  <th className="th text-right">CTR</th>
                  <th className="th text-right">Leads</th>
                  <th className="th text-right">Qualified</th>
                  <th className="th text-right">Bookings</th>
                  <th className="th text-right">Revenue</th>
                  <th className="th text-right">CPL</th>
                  <th className="th text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {rows.map((c) => (
                  <tr key={c.id} className="row-hover">
                    <td className="td">
                      <span className="font-medium">{c.name}</span>
                      <span className="block text-xs text-[var(--color-muted)]">{humanise(c.platform)}</span>
                      <span className="mt-1.5 block w-24">
                        <Meter value={c.spent_inr} max={maxSpend} />
                      </span>
                    </td>
                    <td className="td">
                      <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status.toUpperCase()}</Badge>
                    </td>
                    <td className="td whitespace-nowrap text-right tabular-nums">{rupees(c.spent_inr)}</td>
                    <td className="td text-right tabular-nums">{formatNumber(c.impressions)}</td>
                    <td className="td text-right tabular-nums">{formatNumber(c.clicks)}</td>
                    <td className="td text-right tabular-nums">{pct(c.ctr)}</td>
                    <td className="td text-right tabular-nums">{formatNumber(c.leads)}</td>
                    <td className="td text-right tabular-nums">
                      {formatNumber(c.qualified_leads)}
                      <span className="ml-1.5 text-xs text-[var(--color-faint)]">
                        {c.leads > 0 ? formatPercent((c.qualified_leads / c.leads) * 100, 0) : "—"}
                      </span>
                    </td>
                    <td className="td text-right tabular-nums">{formatNumber(c.bookings)}</td>
                    <td className="td whitespace-nowrap text-right tabular-nums">
                      {c.revenue_inr > 0 ? formatCr(c.revenue_inr) : "—"}
                    </td>
                    <td className="td whitespace-nowrap text-right tabular-nums">{rupees(c.cpl_inr)}</td>
                    <td
                      className={`td text-right tabular-nums ${
                        c.roas !== null && c.roas >= 1 ? "text-[var(--color-success)]" : ""
                      }`}
                    >
                      {multiple(c.roas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card
          title="Add a campaign"
          hint="Leads attach by exact name match, so use the same string you put in the click-to-WhatsApp link or the utm_campaign parameter."
        >
          <form action="/api/osf/campaigns" method="POST" className="space-y-4">
            <input type="hidden" name="action" value="create" />
            <input type="hidden" name="next" value="/inbox/whatsapp/marketing/campaigns" />

            <Labelled label="Name">
              <input name="name" required maxLength={120} className="field" placeholder="serenity-launch-oct" />
            </Labelled>

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Platform">
                <input name="platform" required list="campaign-platforms" className="field" />
                <datalist id="campaign-platforms">
                  {PLATFORM_SUGGESTIONS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Labelled>

              <Labelled label="Status">
                <select name="status" defaultValue="draft" className="field">
                  {CAMPAIGN_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </Labelled>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Labelled label="Budget (₹)">
                <input name="budgetInr" type="number" min={0} step={1000} className="field" placeholder="0" />
              </Labelled>
              <Labelled label="Starts">
                <input name="startDate" type="date" className="field" />
              </Labelled>
              <Labelled label="Ends">
                <input name="endDate" type="date" className="field" />
              </Labelled>
            </div>

            <button type="submit" className="btn-gold">
              <Plus size={14} strokeWidth={2} aria-hidden />
              Add campaign
            </button>
          </form>
        </Card>

        <Card
          title="Record spend"
          hint="Copy the current totals out of Ads Manager and paste them here. Leave a box empty to keep the figure that is already stored."
        >
          {campaigns.length === 0 ? (
            <Empty>Add a campaign first.</Empty>
          ) : (
            <form action="/api/osf/campaigns" method="POST" className="space-y-4">
              <input type="hidden" name="action" value="update-spend" />
              <input type="hidden" name="next" value="/inbox/whatsapp/marketing/campaigns" />

              <Labelled label="Campaign">
                <select name="id" required className="field">
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.platform} — now {rupees(c.spent_inr)},{" "}
                      {formatNumber(c.impressions)} impr, {formatNumber(c.clicks)} clicks
                    </option>
                  ))}
                </select>
              </Labelled>

              <div className="grid gap-4 sm:grid-cols-3">
                <Labelled label="Spend to date (₹)">
                  <input name="spentInr" type="number" min={0} step={100} className="field" placeholder="unchanged" />
                </Labelled>
                <Labelled label="Impressions">
                  <input name="impressions" type="number" min={0} step={1} className="field" placeholder="unchanged" />
                </Labelled>
                <Labelled label="Clicks">
                  <input name="clicks" type="number" min={0} step={1} className="field" placeholder="unchanged" />
                </Labelled>
              </div>

              <button type="submit" className="btn-gold">
                <PencilLine size={14} strokeWidth={2} aria-hidden />
                Update figures
              </button>

              <p className="text-xs leading-relaxed text-[var(--color-faint)]">
                These are cumulative totals, not increments — whatever you enter replaces the stored value.
                There is no history, so a previous figure cannot be recovered.
              </p>
            </form>
          )}
        </Card>
      </div>

      <Card gold title="Why this is typed in by hand" className="mt-5">
        <p className="text-sm leading-relaxed text-[var(--color-muted)]">
          Pulling spend automatically needs a Meta Marketing API app with <code className="rounded bg-[var(--color-raised)] px-1.5 py-0.5 text-xs">ads_read</code>{" "}
          on a reviewed business, or a Google Ads developer token plus an OAuth flow. Neither exists in this
          codebase and no credential for either is in the environment, so no button here could do it. Manual
          entry is the honest version: the numbers are real, and their staleness is visible in the
          &ldquo;last edited&rdquo; date rather than hidden behind a sync icon that never ran.
        </p>
      </Card>
    </>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
