import Link from "next/link";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  TemperaturePill,
  formatCr,
  formatNumber,
  timeAgo,
} from "@/components/osf/ui";
import { clientRanking, type RankedClient } from "@/lib/osf/analytics";
import { STAGE_LABELS, STAGE_TONES, humanise, type PipelineStage } from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";
import { SENTIMENT_TONES, SentimentPill } from "./sentiment";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function filterHref(temp?: string, sent?: string): string {
  const p = new URLSearchParams();
  if (temp) p.set("temp", temp);
  if (sent) p.set("sent", sent);
  const q = p.toString();
  return q ? `/os/crm/rankings?${q}` : "/os/crm/rankings";
}

/**
 * CLIENT RANKINGS
 *
 * Every client in one ordered list, most likely to buy at the top.
 *
 * The position comes from the lead score the WhatsApp agent maintains on each
 * turn — deterministic and rule-based rather than model-judged, so a rep can
 * always be told why one name sits above another. Temperature (hot / warm /
 * cold) is a band over that same score; sentiment is read separately from the
 * customer's own words, so a warm lead who has turned unhappy is visible as
 * exactly that rather than averaging into the middle.
 */
export default async function RankingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const temp = one(sp.temp);
  const sent = one(sp.sent);

  const page = await gatedLoad(
    { table: "villa_leads", migration: "001_schema.sql" },
    () => clientRanking(),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Client rankings" sub="Every client, ordered by how close they are to buying." />
        <SetupNotice missing={page.missing ?? []} detail={page.error} />
      </>
    );
  }

  const { clients, totals, sentiment } = page.data;
  const shown = clients.filter(
    (c) =>
      (!temp || c.lead_temperature === temp) &&
      (!sent || (sent === "unknown" ? c.sentiment === null : c.sentiment === sent)),
  );

  return (
    <>
      <PageHeader
        title="Client rankings"
        sub={`All ${formatNumber(totals.all)} active clients, ranked by buying intent. Position is the agent's lead score; ties break on who spoke to us most recently.`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <RankStat label="Hot" value={totals.hot} total={totals.all} temp="hot" active={temp} />
        <RankStat label="Warm" value={totals.warm} total={totals.all} temp="warm" active={temp} />
        <RankStat label="Cold" value={totals.cold} total={totals.all} temp="cold" active={temp} />
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Sentiment</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(["positive", "neutral", "negative", "unknown"] as const).map((k) => (
              <Link key={k} href={filterHref(temp, sent === k ? undefined : k)}>
                <span
                  className={`pill ${SENTIMENT_TONES[k]} ${sent === k ? "ring-1 ring-[var(--color-gold-line)]" : ""}`}
                >
                  {formatNumber(sentiment[k])} {k}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-faint)]">
            Read from the customer&apos;s own words on every reply.
          </p>
        </Card>
      </div>

      {(temp || sent) && (
        <div className="mb-4 flex items-center gap-2 text-xs text-[var(--color-muted)]">
          <span>
            Showing {formatNumber(shown.length)} of {formatNumber(totals.all)}
          </span>
          <Link href={filterHref()} className="text-[var(--color-gold-300)] hover:underline">
            Clear filters
          </Link>
        </div>
      )}

      <Card>
        {shown.length === 0 ? (
          <Empty>
            No client matches this filter. The ranking covers active clients only — booked, lost
            and opted-out contacts are left out of it.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-faint)]">
                  <th className="w-14 pb-2.5 pl-1">#</th>
                  <th className="pb-2.5">Client</th>
                  <th className="pb-2.5">Score</th>
                  <th className="pb-2.5">Temp</th>
                  <th className="pb-2.5">Sentiment</th>
                  <th className="pb-2.5">Stage</th>
                  <th className="pb-2.5">Budget</th>
                  <th className="pb-2.5">Owner</th>
                  <th className="pb-2.5 pr-1 text-right">Last contact</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <Row key={c.id} client={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function RankStat({
  label,
  value,
  total,
  temp,
  active,
}: {
  label: string;
  value: number;
  total: number;
  temp: string;
  active?: string;
}) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <Link href={filterHref(active === temp ? undefined : temp)}>
      <Card className={active === temp ? "ring-1 ring-[var(--color-gold-line)]" : undefined}>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">{label}</p>
          <TemperaturePill value={temp} />
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(value)}</p>
        <p className="mt-1 text-[11px] text-[var(--color-faint)]">{share}% of all active clients</p>
      </Card>
    </Link>
  );
}

function Row({ client: c }: { client: RankedClient }) {
  const stage = c.pipeline_stage as PipelineStage;
  return (
    <tr className="border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-raised)]/50">
      <td className="py-3 pl-1 align-middle">
        <span className="tabular-nums text-[var(--color-faint)]">{c.rank}</span>
      </td>
      <td className="py-3 align-middle">
        <Link href={`/os/crm/leads/${c.id}`} className="font-medium hover:text-[var(--color-gold-300)]">
          {c.name ?? "Unnamed"}
        </Link>
        <p className="text-xs text-[var(--color-faint)]">
          {c.phone}
          {c.city ? ` · ${c.city}` : ""}
        </p>
      </td>
      <td className="w-28 py-3 align-middle">
        <div className="flex items-center gap-2">
          <span className="w-7 tabular-nums text-xs">{c.lead_score}</span>
          <div className="flex-1">
            <Meter value={c.lead_score} max={100} />
          </div>
        </div>
      </td>
      <td className="py-3 align-middle">
        <TemperaturePill value={c.lead_temperature} />
      </td>
      <td className="py-3 align-middle">
        <SentimentPill value={c.sentiment} />
      </td>
      <td className="py-3 align-middle">
        <Badge tone={STAGE_TONES[stage] ?? "neutral"}>{STAGE_LABELS[stage] ?? humanise(stage)}</Badge>
      </td>
      <td className="py-3 align-middle tabular-nums text-xs">{formatCr(c.budget_max_inr)}</td>
      <td className="py-3 align-middle text-xs text-[var(--color-muted)]">
        {c.assignee?.name ?? <span className="text-[var(--color-faint)]">Unassigned</span>}
      </td>
      <td className="py-3 pr-1 text-right align-middle text-xs text-[var(--color-faint)]">
        {timeAgo(c.last_contact_at)}
      </td>
    </tr>
  );
}
