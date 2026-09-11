import Link from "next/link";
import { X } from "lucide-react";
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
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  STAGE_TONES,
  TEMPERATURES,
  UNASSIGNED,
  budgetRange,
  humanise,
  isPipelineStage,
  isTemperature,
  leadSources,
  listLeads,
  teamMembers,
} from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

const SCORE_STEPS = [50, 60, 70, 80, 90];

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** Active filters, normalised once so the chips, the form and the query agree. */
interface Active {
  temp?: string;
  stage?: string;
  source?: string;
  rep?: string;
  min?: string;
  q?: string;
}

function href(active: Active, drop?: keyof Active): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(active)) {
    if (value && key !== drop) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/inbox/whatsapp/crm/leads?${query}` : "/inbox/whatsapp/crm/leads";
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  // Anything unrecognised is dropped rather than passed to PostgREST, so a
  // hand-edited URL narrows nothing instead of erroring.
  const temp = isTemperature(one(sp.temp)) ? one(sp.temp) : undefined;
  const stage = isPipelineStage(one(sp.stage)) ? one(sp.stage) : undefined;
  const source = one(sp.source);
  const rep = one(sp.rep);
  const minRaw = Number(one(sp.min));
  const min = Number.isFinite(minRaw) && minRaw > 0 ? Math.min(100, Math.round(minRaw)) : undefined;
  const q = one(sp.q);

  const active: Active = { temp, stage, source, rep, min: min ? String(min) : undefined, q };

  const page = await gatedLoad(null, () =>
    Promise.all([
      listLeads({ temperature: temp, stage, source, rep, minScore: min, q }),
      leadSources(),
      teamMembers(),
    ] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Leads" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [leads, sources, team] = page.data;
  const repName = new Map(team.map((m) => [m.id, m.name]));

  const hot = leads.filter((l) => l.lead_temperature === "hot").length;
  const unassigned = leads.filter((l) => !l.assigned_to).length;

  const chips: { key: keyof Active; label: string }[] = [];
  if (temp) chips.push({ key: "temp", label: `Temp · ${temp}` });
  if (stage) chips.push({ key: "stage", label: `Stage · ${STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage}` });
  if (source) chips.push({ key: "source", label: `Source · ${source}` });
  if (rep) {
    chips.push({
      key: "rep",
      label: `Rep · ${rep === UNASSIGNED ? "Unassigned" : (repName.get(rep) ?? "Unknown")}`,
    });
  }
  if (min) chips.push({ key: "min", label: `Score ≥ ${min}` });
  if (q) chips.push({ key: "q", label: `Search · ${q}` });

  return (
    <>
      <PageHeader
        title="Leads"
        sub="Everyone who has messaged, newest activity first. Scores are internal and never shown to the customer."
        actions={
          <div className="text-right">
            <p className="stat text-xl">{formatNumber(leads.length)}</p>
            <p className="label mt-0.5">
              {hot} hot · {unassigned} unassigned
            </p>
          </div>
        }
      />

      <Card className="mb-5">
        {/* A GET form, so every filter lives in the URL and the page stays a
            Server Component — no client state to fall out of sync. */}
        <form method="GET" action="/inbox/whatsapp/crm/leads" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="lg:col-span-2">
            <span className="label mb-1.5 block">Search</span>
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Name, phone or email"
              className="field"
            />
          </label>

          <label>
            <span className="label mb-1.5 block">Temperature</span>
            <select name="temp" defaultValue={temp ?? ""} className="field">
              <option value="">Any</option>
              {TEMPERATURES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="label mb-1.5 block">Stage</span>
            <select name="stage" defaultValue={stage ?? ""} className="field">
              <option value="">Any</option>
              {PIPELINE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="label mb-1.5 block">Source</span>
            <select name="source" defaultValue={source ?? ""} className="field">
              <option value="">Any</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="label mb-1.5 block">Assigned rep</span>
            <select name="rep" defaultValue={rep ?? ""} className="field">
              <option value="">Anyone</option>
              <option value={UNASSIGNED}>Unassigned</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="label mb-1.5 block">Min score</span>
            <select name="min" defaultValue={min ? String(min) : ""} className="field">
              <option value="">Any</option>
              {SCORE_STEPS.map((s) => (
                <option key={s} value={s}>
                  {s}+
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-2 lg:col-span-5">
            <button type="submit" className="btn-gold">
              Apply filters
            </button>
            {chips.length > 0 && (
              <Link href="/inbox/whatsapp/crm/leads" className="btn-ghost">
                Clear all
              </Link>
            )}
          </div>
        </form>

        {chips.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4">
            <span className="label">Filtering by</span>
            {chips.map((chip) => (
              <Link
                key={chip.key}
                href={href(active, chip.key)}
                className="pill border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] text-[var(--color-gold-100)] transition hover:bg-[color-mix(in_oklab,var(--a-500)_20%,transparent)]"
              >
                {chip.label}
                <X className="h-3 w-3" strokeWidth={2.5} />
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        {leads.length === 0 ? (
          <Empty
            action={
              chips.length > 0 ? (
                <Link href="/inbox/whatsapp/crm/leads" className="btn-ghost">
                  Clear filters
                </Link>
              ) : (
                <Link href="/inbox/whatsapp/simulator" className="btn-ghost">
                  Open the simulator
                </Link>
              )
            }
          >
            {chips.length > 0
              ? "No lead matches these filters."
              : "No leads yet. A lead is created the first time someone messages the WhatsApp number."}
          </Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[1080px]">
              <thead className="border-b border-[var(--color-line)]">
                <tr>
                  <th className="th">Lead</th>
                  <th className="th">Temp</th>
                  <th className="th w-32">Score</th>
                  <th className="th">Budget</th>
                  <th className="th">Timeline</th>
                  <th className="th">Stage</th>
                  <th className="th">Source</th>
                  <th className="th">Rep</th>
                  <th className="th text-right">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {leads.map((lead) => (
                  <tr key={lead.id} className="row-hover relative">
                    <td className="td">
                      {/* Stretched link: the whole row is the hit area, but the
                          markup stays a valid table. */}
                      <Link href={`/inbox/whatsapp/crm/leads/${lead.id}`} className="after:absolute after:inset-0">
                        <span className="font-medium">{lead.name ?? "Unnamed"}</span>
                      </Link>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                        +{lead.phone}
                        {lead.is_nri && <span className="text-[var(--color-gold-300)]">NRI</span>}
                        {lead.ai_paused && <span className="text-[var(--color-warm)]">AI paused</span>}
                        {lead.opted_out && <span className="text-[var(--color-danger)]">Opted out</span>}
                      </span>
                    </td>
                    <td className="td">
                      <TemperaturePill value={lead.lead_temperature} />
                    </td>
                    <td className="td">
                      <span className="mb-1.5 block text-xs font-semibold tabular-nums">
                        {lead.lead_score}
                        <span className="text-[var(--color-faint)]">/100</span>
                      </span>
                      <Meter value={lead.lead_score} max={100} />
                    </td>
                    <td className="td whitespace-nowrap text-xs">
                      {budgetRange(lead.budget_min_inr, lead.budget_max_inr, formatCr)}
                    </td>
                    <td className="td text-xs capitalize">{humanise(lead.purchase_timeline)}</td>
                    <td className="td">
                      <Badge tone={STAGE_TONES[lead.pipeline_stage]}>
                        {STAGE_LABELS[lead.pipeline_stage]}
                      </Badge>
                    </td>
                    <td className="td text-xs">
                      {lead.source}
                      {lead.campaign && (
                        <span className="block text-[var(--color-faint)]">{lead.campaign}</span>
                      )}
                    </td>
                    <td className="td text-xs">
                      {lead.assignee?.name ?? <span className="text-[var(--color-faint)]">Unassigned</span>}
                    </td>
                    <td className="td whitespace-nowrap text-right text-xs text-[var(--color-muted)]">
                      {timeAgo(lead.last_contact_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
