import type { ReactNode } from "react";
import Link from "next/link";
import { Bath, Bed, Compass, Layers, Ruler, AlertTriangle } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatInr,
  formatNumber,
} from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import {
  UNIT_STATUSES,
  UNIT_STATUS_DOT,
  UNIT_STATUS_LABELS,
  villaCatalog,
  type CatalogEntry,
} from "@/lib/osf/properties";

export const dynamic = "force-dynamic";

const BASE = "/os/properties/villas";

/**
 * The villa-type catalog.
 *
 * A null price or a null bedroom count is deliberately NOT filled in here. The
 * knowledge base treats a missing value as "this fact has not been approved for
 * the agent to state", so the page shows the gap and the developer's own
 * verification note instead of a plausible-looking number. A buyer who is told
 * "confirm with sales" and gets a true answer is better served than one quoted
 * a guess.
 */
export default async function VillasPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;

  const page = await gatedLoad({ table: "villa_types", migration: "001_schema.sql" }, villaCatalog);

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Villas" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const { entries: all, schemaError } = page.data;
  const projects = [...new Map(all.map((entry) => [entry.projectSlug, entry.projectName])).entries()];
  const activeSlug = projects.some(([slug]) => slug === project) ? project : undefined;
  const entries = activeSlug ? all.filter((entry) => entry.projectSlug === activeSlug) : all;

  const unverified = all.filter(isUnverified);
  const priced = all.filter((entry) => entry.type.price_inr !== null);
  const entryPrice = priced.length ? Math.min(...priced.map((e) => e.type.price_inr as number)) : null;
  const stock = all.reduce((sum, entry) => sum + entry.units.available, 0);

  return (
    <>
      <PageHeader
        title="Villas"
        sub="Every configuration in the knowledge base. Where a price or a bedroom count is missing, that is the record speaking — the agent defers to sales rather than inventing one."
      />

      {/* A schema gap wins over the empty state: "no villa types" would be a
          claim about the data, and the query never got far enough to make it. */}
      {schemaError ? (
        <SetupNotice missing={[]} detail={schemaError} />
      ) : all.length === 0 ? (
        <Card>
          <Empty
            action={
              <Link href="/os/properties/projects" className="btn-ghost">
                Open projects
              </Link>
            }
          >
            <code className="rounded bg-[--color-canvas] px-1.5 py-0.5 text-xs">villa_types</code> has
            no active row. Until a configuration exists the agent has nothing to describe and no floor
            plan to send.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Villa types" value={formatNumber(all.length)} sub={`Across ${projects.length} project${projects.length === 1 ? "" : "s"}`} />
            <Stat label="Entry price" value={entryPrice === null ? "—" : formatInr(entryPrice)} gold />
            <Stat
              label="Awaiting verification"
              value={formatNumber(unverified.length)}
              sub={unverified.length ? "Price or bedroom count not approved" : "Every type is fully specified"}
            />
            <Stat label="Units available" value={formatNumber(stock)} sub="Across all loaded inventory" />
          </div>

          {projects.length > 1 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="label mr-1">Project</span>
              <FilterPill href={BASE} active={!activeSlug} label="All" count={all.length} />
              {projects.map(([slug, name]) => (
                <FilterPill
                  key={slug}
                  href={`${BASE}?project=${encodeURIComponent(slug)}`}
                  active={activeSlug === slug}
                  label={name}
                  count={all.filter((entry) => entry.projectSlug === slug).length}
                />
              ))}
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {entries.map((entry) => (
              <VillaTypeCard key={entry.type.id} entry={entry} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Missing price or missing bedroom count — the two facts a buyer asks first. */
function isUnverified(entry: CatalogEntry): boolean {
  return entry.type.price_inr === null || entry.type.bedrooms === null;
}

/** Fallback when the record is incomplete and nobody wrote a note explaining it. */
function missingFactsSentence(price: number | null, bedrooms: number | null): string {
  const missing = [price === null ? "a price" : null, bedrooms === null ? "a bedroom count" : null]
    .filter((f): f is string => f !== null)
    .join(" or ");
  return `The record carries no ${missing}, and no note explains why. Until one is added the agent hands this question to a human rather than estimating.`;
}

function FilterPill({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`pill border transition ${
        active
          ? "border-[--color-gold-line] bg-[--color-gold-soft] text-[--color-gold-100]"
          : "border-[--color-line] bg-[--color-surface] text-[--color-muted] hover:border-[--color-line-strong] hover:text-[--color-ink]"
      }`}
    >
      {label}
      <span className="tabular-nums text-[--color-faint]">{count}</span>
    </Link>
  );
}

function Spec({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[--color-line] bg-[--color-void]/40 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[--color-faint]">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm tabular-nums text-[--color-ink]">{value}</p>
    </div>
  );
}

function VillaTypeCard({ entry }: { entry: CatalogEntry }) {
  const { type, units, unitTotal } = entry;
  const unverified = isUnverified(entry);
  const absorbed = units.sold + units.reserved + units.under_booking;

  const features = [
    type.private_pool ? "Private pool" : null,
    type.has_home_theatre ? "Home theatre" : null,
    type.has_maid_room ? "Maid room" : null,
  ].filter((f): f is string => f !== null);

  return (
    <Card className="flex flex-col gap-4">
      <header>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-[family-name:--font-display] text-lg leading-tight text-[--color-ink]">
              {type.name}
            </h2>
            <Link
              href={`/os/properties/projects/${entry.projectSlug}`}
              className="mt-0.5 block truncate text-xs text-[--color-muted] underline-offset-2 hover:text-[--color-gold-300] hover:underline"
            >
              {entry.projectName}
            </Link>
          </div>
          {entry.projectStatus && <Badge>{entry.projectStatus}</Badge>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Spec
          icon={<Ruler size={10} strokeWidth={2} aria-hidden />}
          label="Plot"
          value={type.plot_area_sqyd ? `${formatNumber(type.plot_area_sqyd)} yd²` : "—"}
        />
        <Spec
          icon={<Layers size={10} strokeWidth={2} aria-hidden />}
          label="Built-up"
          value={type.built_up_sft ? `${formatNumber(type.built_up_sft)} sft` : "—"}
        />
        <Spec
          icon={<Bed size={10} strokeWidth={2} aria-hidden />}
          label="Beds"
          value={type.bedrooms !== null ? String(type.bedrooms) : "—"}
        />
        <Spec
          icon={<Bath size={10} strokeWidth={2} aria-hidden />}
          label="Baths"
          value={type.bathrooms !== null ? String(type.bathrooms) : "—"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {type.facing && (
          <Badge>
            <Compass size={11} strokeWidth={2} aria-hidden />
            {type.facing} facing
          </Badge>
        )}
        {type.floors !== null && <Badge>{type.floors} floors</Badge>}
        {type.carpet_area_sft && <Badge>{formatNumber(type.carpet_area_sft)} sft carpet</Badge>}
        {features.map((feature) => (
          <Badge key={feature} tone="gold">
            {feature}
          </Badge>
        ))}
      </div>

      <div className="rounded-xl border border-[--color-line] bg-[--color-void]/40 px-3.5 py-3">
        <p className="label">Price</p>
        {type.price_inr !== null ? (
          <p className="mt-1 text-xl font-semibold tabular-nums text-[--color-gold-300]">
            {formatInr(type.price_inr)}
          </p>
        ) : (
          <p className="mt-1 text-base font-semibold text-[--color-warm]">Confirm with sales</p>
        )}
      </div>

      {unverified && (
        <div className="rounded-xl border border-[rgba(239,180,92,0.3)] bg-[rgba(239,180,92,0.07)] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[--color-warm]">
            <AlertTriangle size={12} strokeWidth={2} aria-hidden />
            Not approved for quoting
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-[--color-muted]">
            {type.verification_note?.trim() || missingFactsSentence(type.price_inr, type.bedrooms)}
          </p>
        </div>
      )}

      <div className="mt-auto">
        {unitTotal === 0 ? (
          <p className="text-xs text-[--color-faint]">
            No units loaded — availability for this type cannot be quoted.
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {UNIT_STATUSES.filter((status) => units[status] > 0).map((status) => (
                <span key={status} className="flex items-center gap-1.5 text-[11px] text-[--color-muted]">
                  <span className={`h-2 w-2 rounded-sm ${UNIT_STATUS_DOT[status]}`} aria-hidden />
                  {UNIT_STATUS_LABELS[status]}
                  <span className="tabular-nums text-[--color-faint]">{units[status]}</span>
                </span>
              ))}
            </div>
            <Meter value={absorbed} max={unitTotal} />
            <p className="mt-1.5 text-[11px] text-[--color-muted]">
              <span className="tabular-nums text-[--color-success]">{formatNumber(units.available)}</span>{" "}
              available of {formatNumber(unitTotal)} loaded
            </p>
          </>
        )}
      </div>

      {type.floor_plan_url && (
        <a
          href={type.floor_plan_url}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-ghost w-full justify-center"
        >
          View floor plan
        </a>
      )}
    </Card>
  );
}
