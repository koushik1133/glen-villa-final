import Link from "next/link";
import { ArrowUpRight, Clock, UserPlus } from "lucide-react";
import { BarsChart, DonutChart } from "@/components/osf/charts";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  TemperaturePill,
  formatNumber,
  timeAgo,
} from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import { STAGE_LABELS, isPipelineStage } from "@/lib/osf/kanban";
import {
  FACTORS,
  HIGH_SCORE,
  NEGLECT_DAYS,
  loadLeadIntelligence,
  type ScoredLead,
} from "@/lib/osf/ai/scoring-explain";

export const dynamic = "force-dynamic";

/** Leads whose breakdown is rendered in full. The rest are one table row each. */
const EXPLAINED = 10;

function stageLabel(stage: string): string {
  return isPipelineStage(stage) ? STAGE_LABELS[stage] : stage.replace(/_/g, " ");
}

function FactorBreakdown({ lead }: { lead: ScoredLead }) {
  return (
    <div className="space-y-2.5">
      {FACTORS.map((factor) => {
        const points = lead.factors[factor.key];
        return (
          <div key={factor.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[11px]">
              <span className="text-[--color-muted]">{factor.label}</span>
              <span className="tabular-nums text-[--color-ink]">
                {points > 0 ? Math.round(points) : "—"}
                <span className="text-[--color-faint]"> / {factor.max}</span>
              </span>
            </div>
            <Meter value={points} max={factor.max} tone={points > 0 ? "gold" : "info"} />
          </div>
        );
      })}
    </div>
  );
}

function LeadCard({ lead }: { lead: ScoredLead }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/os/crm/leads/${lead.id}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-[--color-ink] hover:text-[--color-gold-100]"
          >
            {lead.name}
            <ArrowUpRight className="h-3.5 w-3.5 text-[--color-faint]" aria-hidden />
          </Link>
          <p className="mt-1 text-[11px] capitalize text-[--color-muted]">
            {stageLabel(lead.pipelineStage)} · {lead.source}
            {lead.campaign ? ` · ${lead.campaign}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-[--color-faint]">
            {lead.owner ? `Owned by ${lead.owner}` : "No owner assigned"} · last contact{" "}
            {timeAgo(lead.lastContactAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-2xl font-semibold tabular-nums text-[--color-gold-300]">
            {lead.score}
          </span>
          <TemperaturePill value={lead.temperature} />
        </div>
      </div>

      <div className="mt-4">
        <FactorBreakdown lead={lead} />
      </div>

      <p className="mt-3 border-t border-[--color-line] pt-2.5 text-[11px] leading-relaxed text-[--color-faint]">
        {lead.reconciled
          ? `The lead row now implies ${lead.profileSubtotal} profile points, more than the ${lead.score} stored — the row was edited after its last scored turn, or the 100-point cap bit. Bands are scaled to fit rather than shown wider than the score they explain.`
          : `Profile explains ${lead.profileSubtotal} of ${lead.score}. The remaining ${lead.score - lead.profileSubtotal} came from what happened in the conversation.`}
      </p>
    </Card>
  );
}

function FlagList({ leads, empty }: { leads: ScoredLead[]; empty: string }) {
  if (leads.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-[--color-line]">
      {leads.map((lead) => (
        <li key={lead.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
          <div className="min-w-0">
            <Link
              href={`/os/crm/leads/${lead.id}`}
              className="block truncate text-sm text-[--color-ink] hover:text-[--color-gold-100]"
            >
              {lead.name}
            </Link>
            <p className="text-[11px] capitalize text-[--color-faint]">
              {stageLabel(lead.pipelineStage)} · {lead.source}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {lead.daysSinceContact !== null && (
              <span className="text-[11px] tabular-nums text-[--color-muted]">
                {lead.daysSinceContact}d quiet
              </span>
            )}
            <span className="text-sm font-semibold tabular-nums text-[--color-gold-300]">
              {lead.score}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function LeadIntelligencePage() {
  const page = await gatedLoad(
    { table: "villa_leads", migration: "001_schema.sql" },
    loadLeadIntelligence,
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Lead Intelligence" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const intel = page.data;

  if (intel.scanned === 0) {
    return (
      <>
        <PageHeader
          title="Lead Intelligence"
          sub="Every score broken into the factors that produced it."
        />
        <Empty>
          <span className="font-medium text-[--color-ink]">No leads scored yet.</span>
          <span className="mx-auto mt-2 block max-w-lg">
            Scores are written by the WhatsApp agent as a conversation progresses. Once a lead
            exists in <code className="rounded bg-[--color-canvas] px-1.5 py-0.5 text-xs">villa_leads</code>
            , its breakdown appears here.
          </span>
        </Empty>
      </>
    );
  }

  const histogram = intel.buckets.map((b) => ({ label: b.label, leads: b.leads }));
  const temperature = [
    { label: "Hot", value: intel.temperatureCounts.hot },
    { label: "Warm", value: intel.temperatureCounts.warm },
    { label: "Cold", value: intel.temperatureCounts.cold },
  ].filter((t) => t.value > 0);
  const explained = intel.leads.slice(0, EXPLAINED);

  return (
    <>
      <PageHeader
        title="Lead Intelligence"
        sub="Scoring is deterministic, not model-judged — the same lead scores the same today as last month. This page takes each stored score apart into the factors that produced it, so a rep can see why a lead is an 82 rather than being told to trust it."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Leads scored"
          value={formatNumber(intel.scanned)}
          sub="Highest scores first, capped at 500"
        />
        <Stat
          label="Average score"
          value={intel.averageScore === null ? "—" : intel.averageScore.toFixed(1)}
          sub="Hot from 80, warm from 50"
          gold
        />
        <Stat
          label={`${HIGH_SCORE}+ with no owner`}
          value={formatNumber(intel.highScoreUnassigned.length)}
          sub="Nobody is working these"
        />
        <Stat
          label={`${HIGH_SCORE}+ gone quiet`}
          value={formatNumber(intel.highScoreNeglected.length)}
          sub={`No contact for ${NEGLECT_DAYS}+ days`}
        />
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-3">
        <Card
          title="Score distribution"
          hint={`All ${formatNumber(intel.scanned)} scanned leads, in bands of ten.`}
          className="lg:col-span-2"
        >
          <BarsChart data={histogram} keys={[{ key: "leads", name: "Leads" }]} height={240} />
        </Card>
        <Card title="Temperature" hint="Derived from the score, not set by hand.">
          {temperature.length === 0 ? (
            <Empty>No leads to split.</Empty>
          ) : (
            <DonutChart data={temperature} height={240} />
          )}
        </Card>
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <Card
          title={`High score, no owner`}
          hint={`Live leads scoring ${HIGH_SCORE} or more with nobody assigned. Booked, lost and opted-out leads are excluded.`}
          actions={<UserPlus className="h-4 w-4 text-[--color-gold-500]" aria-hidden />}
        >
          <FlagList
            leads={intel.highScoreUnassigned}
            empty="Every high-scoring lead has an owner."
          />
          {intel.highScoreUnassigned.length > 0 && (
            <Link href="/os/automation/routing" className="btn-ghost mt-4 w-full justify-center">
              Deal these out on Routing
            </Link>
          )}
        </Card>

        <Card
          title="High score, no recent contact"
          hint={`Scoring ${HIGH_SCORE} or more and silent for ${NEGLECT_DAYS} days or longer. Longest silence first.`}
          actions={<Clock className="h-4 w-4 text-[--color-warm]" aria-hidden />}
        >
          <FlagList
            leads={intel.highScoreNeglected}
            empty={`No high-scoring lead has been quiet for ${NEGLECT_DAYS} days.`}
          />
        </Card>
      </div>

      <Card
        title="How a score is built"
        hint="Profile points are a pure function of the lead row and are recomputed here exactly. Conversation signals are observed live during a chat and never stored, so that band is reported as the residual — the part of the stored score the row cannot account for."
        className="mb-6"
      >
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {FACTORS.map((factor) => (
            <div key={factor.key}>
              <dt className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-semibold text-[--color-ink]">{factor.label}</span>
                <span className="text-[11px] tabular-nums text-[--color-gold-300]">
                  up to {factor.max}
                </span>
              </dt>
              <dd className="mt-1 text-[11px] leading-relaxed text-[--color-muted]">
                {factor.basis}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-[--color-ink]">
            Top {Math.min(EXPLAINED, explained.length)} scores, explained
          </h2>
          <Badge>{formatNumber(intel.scanned)} scanned</Badge>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {explained.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      </section>
    </>
  );
}
