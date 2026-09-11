import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  PageHeader,
  SetupNotice,
  Stat,
  TemperaturePill,
  formatCr,
  formatInr,
  formatNumber,
} from "@/components/osf/ui";
import {
  STAGE_LABELS,
  budgetRange,
  daysSince,
  pipelineBoard,
  statedBudget,
  type PipelineCard,
  type PipelineColumn,
} from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";
import StageMove from "./StageMove";

export const dynamic = "force-dynamic";

/** Stages a deal has left the funnel through — excluded from "open pipeline". */
const CLOSED_STAGES = new Set(["booked", "lost"]);

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const page = await gatedLoad(null, pipelineBoard);

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Pipeline" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const columns = page.data;
  const now = Date.now();
  const totalLeads = columns.reduce((sum, column) => sum + column.cards.length, 0);

  const open = columns.filter((column) => !CLOSED_STAGES.has(column.stage));
  const openValue = open.reduce((sum, column) => sum + column.valueInr, 0);
  const openCount = open.reduce((sum, column) => sum + column.cards.length, 0);
  const unknownBudget = columns.reduce((sum, column) => sum + column.unknownBudget, 0);
  const booked = columns.find((column) => column.stage === "booked");

  if (totalLeads === 0) {
    return (
      <>
        <PageHeader title="Pipeline" sub="Every lead, by the stage it is actually in." />
        <Card>
          <Empty
            action={
              <Link href="/inbox/whatsapp/simulator" className="btn-ghost">
                Open the simulator
              </Link>
            }
          >
            No lead is in the pipeline yet. A lead enters at{" "}
            <span className="text-[var(--color-ink)]">New</span> the first time someone messages the
            WhatsApp number.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Pipeline"
        sub="Every lead by stage. Column totals sum only the budgets buyers have actually stated — a lead who has not named one is counted, not guessed at."
      />

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] p-4 text-sm text-[var(--color-danger)]">
          <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Leads on the board" value={formatNumber(totalLeads)} />
        <Stat label="Open deals" value={formatNumber(openCount)} sub="Excludes booked and lost" />
        <Stat
          label="Open pipeline value"
          value={openValue > 0 ? formatCr(openValue) : "—"}
          sub={unknownBudget > 0 ? `${unknownBudget} lead${unknownBudget === 1 ? "" : "s"} with no budget stated` : undefined}
          gold
        />
        <Stat
          label="Booked"
          value={booked && booked.valueInr > 0 ? formatCr(booked.valueInr) : "—"}
          sub={booked ? `${formatNumber(booked.cards.length)} deal${booked.cards.length === 1 ? "" : "s"}` : undefined}
        />
      </div>

      {/* One horizontal scroller for the whole board: columns keep a fixed width
          so a busy stage never squeezes a quiet one down to a sliver. */}
      <div className="-mx-1 overflow-x-auto pb-3">
        <div className="flex min-w-max gap-3 px-1">
          {columns.map((column) => (
            <Column key={column.stage} column={column} now={now} />
          ))}
        </div>
      </div>
    </>
  );
}

function Column({ column, now }: { column: PipelineColumn; now: number }) {
  return (
    <section className="flex w-[286px] shrink-0 flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-canvas)]">
      <header className="border-b border-[var(--color-line)] px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold text-[var(--color-ink)]">{STAGE_LABELS[column.stage]}</h2>
          <span className="pill bg-[var(--color-raised)] tabular-nums text-[var(--color-muted)]">
            {formatNumber(column.cards.length)}
          </span>
        </div>
        <p className="mt-1.5 text-sm font-semibold tabular-nums text-[var(--color-gold-300)]">
          {column.valueInr > 0 ? formatCr(column.valueInr) : "—"}
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--color-faint)]">
          {column.valueInr > 0 ? "stated budgets in this stage" : "no stated budget in this stage"}
          {column.unknownBudget > 0 && ` · ${column.unknownBudget} unknown`}
        </p>
      </header>

      <div className="max-h-[calc(100vh-22rem)] min-h-[6rem] space-y-2 overflow-y-auto p-2.5">
        {column.cards.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-[var(--color-faint)]">Empty</p>
        ) : (
          column.cards.map((card) => <DealCard key={card.id} card={card} now={now} />)
        )}
      </div>
    </section>
  );
}

function DealCard({ card, now }: { card: PipelineCard; now: number }) {
  const days = daysSince(card.stage_since, now);
  const budget = statedBudget(card);
  // Two weeks with no movement is where a deal starts going quiet; flag it
  // rather than let it look identical to one that arrived this morning.
  const stale = days !== null && days >= 14 && !CLOSED_STAGES.has(card.pipeline_stage);

  return (
    <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 transition hover:border-[var(--color-line-strong)]">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/inbox/whatsapp/crm/leads/${card.id}`}
          className="min-w-0 truncate text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-gold-300)]"
        >
          {card.name?.trim() || `+${card.phone}`}
        </Link>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--color-gold-300)]">
          {card.lead_score}
        </span>
      </div>

      <p className="mt-1 text-xs tabular-nums text-[var(--color-muted)]">
        {budget === null ? (
          <span className="text-[var(--color-faint)]">Budget not stated</span>
        ) : (
          budgetRange(card.budget_min_inr, card.budget_max_inr, formatInr)
        )}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TemperaturePill value={card.lead_temperature} />
        {card.is_future_prospect && <Badge tone="neutral">Parked</Badge>}
        {card.ai_paused && <Badge tone="warning">AI paused</Badge>}
        {card.opted_out && <Badge tone="danger">Opted out</Badge>}
      </div>

      <p className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-[var(--color-muted)]">
          {card.assignee?.name ?? <span className="text-[var(--color-faint)]">Unassigned</span>}
        </span>
        <span className={`shrink-0 tabular-nums ${stale ? "text-[var(--color-warm)]" : "text-[var(--color-faint)]"}`}>
          {days === null ? "—" : days === 0 ? "today" : `${days}d in stage`}
        </span>
      </p>

      <div className="mt-2.5 border-t border-[var(--color-line)] pt-2.5">
        <StageMove leadId={card.id} stage={card.pipeline_stage} />
      </div>
    </article>
  );
}
