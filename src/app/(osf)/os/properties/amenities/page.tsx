import Link from "next/link";
import {
  Car,
  Droplets,
  Dumbbell,
  Leaf,
  MapPin,
  ShieldCheck,
  Sparkles,
  Trees,
  Users,
  Waves,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card, Empty, PageHeader, SetupNotice, Stat, formatNumber } from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import { amenityShowcase, countJsonLeaves, type AmenityShowcase } from "@/lib/osf/properties";
import { JsonTree } from "../JsonTree";

export const dynamic = "force-dynamic";

const BASE = "/os/properties/amenities";

/**
 * The amenity showcase.
 *
 * `villa_projects.amenities` is free-form jsonb transcribed from each
 * developer's brochure, so its depth and shape differ per project. It is walked
 * rather than mapped onto a fixed schema: whatever categories the developer
 * used are the categories shown, at whatever depth they wrote them. Nothing is
 * added to round a list out, because the agent quotes this same jsonb — an
 * amenity invented here would be an amenity promised to a buyer.
 */
export default async function AmenitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;

  const page = await gatedLoad({ table: "villa_projects", migration: "001_schema.sql" }, amenityShowcase);

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Amenities" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const { projects: all, schemaError } = page.data;
  const documented = all.filter((entry) => entry.categories.length > 0);
  const undocumented = all.filter((entry) => entry.categories.length === 0);

  const activeSlug = documented.some((entry) => entry.slug === project) ? project : undefined;
  const visible = activeSlug ? documented.filter((entry) => entry.slug === activeSlug) : documented;

  const totalAmenities = documented.reduce((sum, entry) => sum + entry.total, 0);
  const totalCategories = documented.reduce((sum, entry) => sum + entry.categories.length, 0);

  return (
    <>
      <PageHeader
        title="Amenities"
        sub="What each community actually offers, in the developer's own categories. This is the exact record the AI agent quotes from — if it is not listed here, the agent will not claim it."
      />

      {schemaError ? (
        <SetupNotice missing={[]} detail={schemaError} />
      ) : documented.length === 0 ? (
        <Card>
          <Empty
            action={
              <Link href="/os/properties/projects" className="btn-ghost">
                Open projects
              </Link>
            }
          >
            No project has an{" "}
            <code className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-xs">amenities</code>{" "}
            record. Until one is transcribed from the developer&rsquo;s collateral, the agent answers
            &ldquo;what does the community have?&rdquo; by handing the question to sales.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Amenities documented" value={formatNumber(totalAmenities)} gold />
            <Stat label="Categories" value={formatNumber(totalCategories)} />
            <Stat
              label="Projects covered"
              value={`${documented.length} of ${all.length}`}
              sub={undocumented.length ? `${undocumented.length} with nothing recorded` : undefined}
            />
            <Stat
              label="Richest list"
              value={formatNumber(Math.max(...documented.map((entry) => entry.total)))}
              sub={richest(documented)}
            />
          </div>

          {documented.length > 1 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="label mr-1">Project</span>
              <ProjectPill href={BASE} active={!activeSlug} label="All" count={totalAmenities} />
              {documented.map((entry) => (
                <ProjectPill
                  key={entry.slug}
                  href={`${BASE}?project=${encodeURIComponent(entry.slug)}`}
                  active={activeSlug === entry.slug}
                  label={entry.projectName}
                  count={entry.total}
                />
              ))}
            </div>
          )}

          <div className="space-y-6">
            {visible.map((entry) => (
              <ProjectAmenities key={entry.projectId} entry={entry} />
            ))}
          </div>

          {undocumented.length > 0 && !activeSlug && (
            <Card className="mt-6" title="Not documented yet">
              <ul className="space-y-2">
                {undocumented.map((entry) => (
                  <li key={entry.projectId} className="flex flex-wrap items-baseline justify-between gap-3">
                    <Link
                      href={`/os/properties/projects/${entry.slug}`}
                      className="text-sm text-[var(--color-ink)] underline-offset-2 hover:text-[var(--color-gold-300)] hover:underline"
                    >
                      {entry.projectName}
                    </Link>
                    <span className="text-xs text-[var(--color-faint)]">
                      No amenity recorded — the agent will not describe this community&rsquo;s facilities.
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function richest(entries: AmenityShowcase[]): string | undefined {
  const best = entries.reduce((top, entry) => (entry.total > top.total ? entry : top), entries[0]);
  return best ? best.projectName : undefined;
}

function ProjectPill({
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
          ? "border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] text-[var(--color-gold-100)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
      }`}
    >
      {label}
      <span className="tabular-nums text-[var(--color-faint)]">{count}</span>
    </Link>
  );
}

function ProjectAmenities({ entry }: { entry: AmenityShowcase }) {
  return (
    <section>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl leading-tight text-[var(--color-ink)]">
            {entry.projectName}
          </h2>
          {entry.location && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <MapPin size={11} strokeWidth={1.75} className="text-[var(--color-gold-300)]" aria-hidden />
              {entry.location}
            </p>
          )}
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          <span className="tabular-nums text-[var(--color-gold-300)]">{formatNumber(entry.total)}</span>{" "}
          amenities in {entry.categories.length} categor{entry.categories.length === 1 ? "y" : "ies"} ·{" "}
          <Link
            href={`/os/properties/projects/${entry.slug}`}
            className="underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            Dossier
          </Link>
        </p>
      </header>

      {/* Columns, not a grid: category lists differ wildly in length, and a grid
          would leave a short list padding out the row of a long one. */}
      <div className="columns-1 gap-4 md:columns-2 2xl:columns-3">
        {entry.categories.map((category) => {
          const Icon = iconFor(category.label);
          const leaves = countJsonLeaves(category.node);
          return (
            <div key={category.key} className="mb-4 break-inside-avoid">
              <Card>
                <header className="mb-3 flex items-center gap-2.5 border-b border-[var(--color-line)] pb-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] text-[var(--color-gold-300)]">
                    <Icon size={15} strokeWidth={1.6} aria-hidden />
                  </span>
                  <h3 className="flex-1 text-sm font-semibold text-[var(--color-ink)]">{category.label}</h3>
                  {leaves > 0 && (
                    <span className="text-[11px] tabular-nums text-[var(--color-faint)]">{leaves}</span>
                  )}
                </header>
                {category.node ? (
                  <JsonTree node={category.node} depth={1} />
                ) : (
                  <p className="text-xs text-[var(--color-faint)]">Listed by name only.</p>
                )}
              </Card>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Category label → icon. Presentation only: the mapping never changes, adds or
 * reinterprets a word in the record, it just picks a glyph to sit beside it.
 */
const ICON_RULES: Array<[RegExp, LucideIcon]> = [
  [/pool|swim|water body|lagoon/i, Waves],
  [/gym|fitness|sport|court|yoga|play/i, Dumbbell],
  [/park|garden|green|landscap|tree|lawn|forest/i, Trees],
  [/club|community|social|lounge|hall|banquet/i, Users],
  [/security|safety|surveillance|gate/i, ShieldCheck],
  [/park(ing)?|drive|road|transport|ev\b/i, Car],
  [/sustain|solar|energy|eco|rain|recycl/i, Leaf],
  [/water|plumb|stp|wtp|sewage/i, Droplets],
  [/power|electric|dg\b|backup/i, Zap],
  [/wifi|internet|smart|automation|tech/i, Wifi],
];

function iconFor(label: string): LucideIcon {
  for (const [pattern, icon] of ICON_RULES) {
    if (pattern.test(label)) return icon;
  }
  return Sparkles;
}
