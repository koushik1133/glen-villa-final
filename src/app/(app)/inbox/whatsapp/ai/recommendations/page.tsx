import { Info } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  type BadgeTone,
  formatNumber,
  formatPercent,
} from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import {
  MIN,
  loadPricingReport,
  type Recommendation,
  type PricingEvidenceBase,
} from "@/lib/osf/ai/pricing";

export const dynamic = "force-dynamic";

/**
 * Derived observations about how the inventory is moving.
 *
 * Nothing on this page names a price, and nothing on it is a forecast. This
 * database records what was sold and what was asked for; it contains no basis
 * whatsoever for what a villa is worth, so every card ends by handing the
 * number back to the sales team.
 */

const CATEGORY_LABEL: Record<Recommendation["category"], string> = {
  absorption: "Absorption",
  demand: "Demand",
  objections: "Objections",
  premium: "Premium",
};

const TONE: Record<Recommendation["tone"], BadgeTone> = {
  gold: "gold",
  info: "info",
  warning: "warning",
  success: "success",
};

const RAIL: Record<Recommendation["tone"], string> = {
  gold: "border-l-[var(--color-gold-500)]",
  info: "border-l-[var(--color-info)]",
  warning: "border-l-[var(--color-warm)]",
  success: "border-l-[var(--color-success)]",
};

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <Card className={`border-l-4 ${RAIL[rec.tone]}`}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium leading-relaxed text-[var(--color-ink)]">{rec.observation}</p>
        <Badge tone={TONE[rec.tone]}>{CATEGORY_LABEL[rec.category]}</Badge>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label">What it might mean</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-muted)]">{rec.reading}</p>
        </div>
        <div>
          <p className="label">Direction</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">{rec.action}</p>
        </div>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-3.5 sm:grid-cols-2">
        {rec.evidence.map((e, i) => (
          <div key={`${e.label}-${i}`} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-[var(--color-muted)]">{e.label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">{e.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function AbsorptionTable({ base }: { base: PricingEvidenceBase }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead className="border-b border-[var(--color-line)]">
          <tr>
            <th className="th">Villa type</th>
            <th className="th">Units</th>
            <th className="th">Taken</th>
            <th className="th">Absorption</th>
            <th className="th">Leads naming it</th>
            <th className="th">Price objections</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {base.types.map((t) => {
            const taken = t.sold + t.reserved + t.underBooking;
            const thin = t.totalUnits < MIN.unitsPerType;
            return (
              <tr key={t.villaTypeId} className="row-hover">
                <td className="td">
                  <span className="font-medium">{t.villaType}</span>
                  <span className="block text-[11px] text-[var(--color-faint)]">{t.projectName}</span>
                </td>
                <td className="td tabular-nums">{formatNumber(t.totalUnits)}</td>
                <td className="td tabular-nums">
                  {formatNumber(taken)}
                  <span className="block text-[11px] text-[var(--color-faint)]">
                    {t.available} available
                  </span>
                </td>
                <td className="td w-44">
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="tabular-nums text-[var(--color-gold-300)]">
                      {formatPercent(t.absorptionPct, 0)}
                    </span>
                    {thin && <span className="text-[var(--color-faint)]">too few to compare</span>}
                  </div>
                  <Meter value={taken} max={Math.max(t.totalUnits, 1)} tone={thin ? "info" : "gold"} />
                </td>
                <td className="td tabular-nums">
                  {t.leadInterest > 0 ? formatNumber(t.leadInterest) : "—"}
                </td>
                <td className="td tabular-nums">
                  {t.priceObjections > 0 ? formatNumber(t.priceObjections) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function RecommendationsPage() {
  const page = await gatedLoad(
    { table: "villa_units", migration: "001_schema.sql" },
    loadPricingReport,
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Recommendations" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const { base, recommendations, blockers } = page.data;
  const taken = base.cornerTaken + base.standardTaken;
  const absorbed = base.totalUnits > 0 ? (100 * taken) / base.totalUnits : null;
  const typedPriceObjections = base.types.reduce((s, t) => s + t.priceObjections, 0);
  const leadInterest = base.types.reduce((s, t) => s + t.leadInterest, 0);

  return (
    <>
      <PageHeader
        title="Recommendations"
        sub="Derived from what actually happened: units taken per configuration, which configurations buyers ask for, where price objections concentrate, and how corner plots with chargeable extra area are moving. Every card ends in a direction to review, never in a number — nothing in this database says what a villa is worth."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Units recorded"
          value={formatNumber(base.totalUnits)}
          sub={`${base.types.length} villa type${base.types.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Absorbed"
          value={formatPercent(absorbed, 0)}
          sub={`${formatNumber(taken)} sold, reserved or under booking`}
          gold
        />
        <Stat
          label="Leads naming a type"
          value={leadInterest > 0 ? formatNumber(leadInterest) : "—"}
          sub={`${MIN.leadInterestTotal} needed to rank demand`}
        />
        <Stat
          label="Price objections"
          value={base.totalObjections > 0 ? formatNumber(base.totalObjections) : "—"}
          sub={`${formatNumber(typedPriceObjections)} traceable to a villa type`}
        />
      </div>

      {base.unavailable.length > 0 && (
        <div className="mb-6 rounded-xl border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--color-gold-300)]">
            Some evidence could not be read
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {base.unavailable.join(", ")}. Rules depending on those tables were skipped rather than
            run against a zero.
          </p>
        </div>
      )}

      {recommendations.length > 0 ? (
        <div className="mb-6 space-y-4">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      ) : (
        <div className="mb-6">
          <Empty>
            <span className="font-medium text-[var(--color-ink)]">
              Nothing in the data reaches a threshold worth acting on.
            </span>
            <span className="mx-auto mt-2 block max-w-xl">
              A ratio between two small numbers is arithmetic, not a finding — so a comparison only
              appears once it has enough units, leads or objections behind it. The list below says
              exactly what is missing.
            </span>
          </Empty>
        </div>
      )}

      {blockers.length > 0 && (
        <Card
          title="What would produce more"
          hint="Each line is a rule that stayed silent, and the evidence it is waiting on."
          className="mb-6"
        >
          <ul className="space-y-2.5">
            {blockers.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-info)]" aria-hidden />
                <span className="text-sm leading-relaxed text-[var(--color-muted)]">{b}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {base.types.length > 0 && (
        <Card
          title="Absorption by configuration"
          hint={`Taken counts sold, reserved and under-booking units. A type with fewer than ${MIN.unitsPerType} units is shown but never compared.`}
          className="mb-6"
        >
          <AbsorptionTable base={base} />
        </Card>
      )}

      {base.facings.length > 0 && (
        <Card
          title="Facing and chargeable extra area"
          hint={`Facing is a per-plot attribute, so this reads units rather than types. Corner premiums are charged as extra area on villa_units — ${base.avgCornerExtraSqyd === null ? "none is recorded yet" : `${base.avgCornerExtraSqyd} sq yd on average`}.`}
        >
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-[var(--color-line)]">
                <tr>
                  <th className="th">Facing</th>
                  <th className="th">Units</th>
                  <th className="th">Taken</th>
                  <th className="th">Share taken</th>
                  <th className="th">Avg chargeable extra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {base.facings.map((f) => (
                  <tr key={f.facing} className="row-hover">
                    <td className="td capitalize">{f.facing}</td>
                    <td className="td tabular-nums">{formatNumber(f.units)}</td>
                    <td className="td tabular-nums">{formatNumber(f.taken)}</td>
                    <td className="td w-40">
                      <div className="mb-1 text-[11px] tabular-nums text-[var(--color-gold-300)]">
                        {formatPercent(f.takenPct, 0)}
                      </div>
                      <Meter
                        value={f.taken}
                        max={Math.max(f.units, 1)}
                        tone={f.units >= MIN.unitsPerFacing ? "gold" : "info"}
                      />
                    </td>
                    <td className="td tabular-nums">
                      {f.avgExtraSqyd === null ? "—" : `${f.avgExtraSqyd} sq yd`}
                      {f.unitsWithExtra > 0 && (
                        <span className="block text-[11px] text-[var(--color-faint)]">
                          on {f.unitsWithExtra} of {f.units}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-4 border-t border-[var(--color-line)] pt-4 sm:grid-cols-2">
            <div>
              <p className="label">Corner plots</p>
              <p className="mt-1 text-sm tabular-nums text-[var(--color-ink)]">
                {formatNumber(base.cornerTaken)} of {formatNumber(base.cornerUnits)} taken
                <span className="ml-2 text-[var(--color-gold-300)]">
                  {formatPercent(
                    base.cornerUnits > 0 ? (100 * base.cornerTaken) / base.cornerUnits : null,
                    0,
                  )}
                </span>
              </p>
            </div>
            <div>
              <p className="label">Standard plots</p>
              <p className="mt-1 text-sm tabular-nums text-[var(--color-ink)]">
                {formatNumber(base.standardTaken)} of {formatNumber(base.standardUnits)} taken
                <span className="ml-2 text-[var(--color-gold-300)]">
                  {formatPercent(
                    base.standardUnits > 0 ? (100 * base.standardTaken) / base.standardUnits : null,
                    0,
                  )}
                </span>
              </p>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
