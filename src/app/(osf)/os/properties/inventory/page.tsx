import type { ReactNode } from "react";
import Link from "next/link";
import { Compass, Grid3X3, Plus, AlertTriangle, X } from "lucide-react";
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
  formatPercent,
  timeAgo,
} from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import {
  UNIT_STATUSES,
  UNIT_STATUS_DOT,
  UNIT_STATUS_LABELS,
  UNIT_STATUS_TILE,
  absorption,
  availabilityBoard,
  isUnitStatus,
  type AvailabilityBoard,
  type ProjectBoard,
  type StatusCounts,
  type TypeBoard,
  type UnitRow,
} from "@/lib/osf/properties";

export const dynamic = "force-dynamic";

const BASE = "/os/properties/inventory";

/**
 * The availability board.
 *
 * Every tile is a real row in `villa_units`. Nothing here is generated to fill
 * the grid out: a project with no units renders as empty, because that is
 * exactly the state in which the agent refuses to quote availability to a
 * customer. Seeding plausible plots would make the board look healthy and make
 * the agent start naming unit numbers that do not exist.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; error?: string }>;
}) {
  const { unit: selectedId, error } = await searchParams;

  const page = await gatedLoad({ table: "villa_units", migration: "001_schema.sql" }, availabilityBoard);

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Inventory" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const board = page.data;
  const { projects, counts, total, schemaError } = board;
  const pct = absorption(counts);
  const absorbed = counts.sold + counts.reserved + counts.under_booking;
  const selected = selectedId ? findUnit(board, selectedId) : null;

  return (
    <>
      <PageHeader
        title="Inventory"
        sub="Live plot-by-plot availability, counted from the same rows the AI agent reads before it tells a customer what is left."
        actions={
          <div className="text-right">
            <p className="stat text-xl tabular-nums">{formatNumber(counts.available)}</p>
            <p className="label mt-0.5">available now</p>
          </div>
        }
      />

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-[rgba(244,105,95,0.3)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[--color-danger]">
          <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* Shown above the board rather than instead of it: when only the summary
          view is missing, the counts below were recomputed from the unit rows
          and are still true — the deployment is just behind the migration. */}
      {schemaError && <SetupNotice missing={[]} detail={schemaError} />}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Units loaded" value={total > 0 ? formatNumber(total) : "—"} sub={`${projects.length} project${projects.length === 1 ? "" : "s"}`} />
        <Stat label="Available" value={formatNumber(counts.available)} gold />
        <Stat
          label="Absorbed"
          value={pct === null ? "—" : formatPercent(pct, 0)}
          sub={pct === null ? "Nothing loaded to absorb" : `${formatNumber(absorbed)} sold, reserved or under booking`}
        />
        <Stat
          label="Blocked"
          value={formatNumber(counts.blocked)}
          sub={counts.blocked > 0 ? "Held back — not counted as absorbed" : undefined}
        />
      </div>

      {selected && <UnitInspector unit={selected.unit} project={selected.project} type={selected.type} />}

      <AddUnitForm board={board} />

      {total === 0 ? (
        <Card className="mt-5">
          <Empty
            action={
              <Link href="/os/properties/projects" className="btn-ghost">
                Review projects
              </Link>
            }
          >
            <span className="block font-medium text-[--color-ink]">No units are loaded.</span>
            <span className="mx-auto mt-2 block max-w-xl">
              <code className="rounded bg-[--color-canvas] px-1.5 py-0.5 text-xs">villa_units</code> is
              empty, so there is no availability to show — and the AI agent will decline to answer
              &ldquo;what&rsquo;s left?&rdquo; and hand the question to sales instead. That refusal is
              correct. Load the approved inventory sheet with the form above and the board, the counts
              and the agent all start working from the same rows.
            </span>
          </Empty>
        </Card>
      ) : (
        <>
          <Legend className="mt-5" />
          <div className="mt-4 space-y-5">
            {projects
              .filter((project) => project.total > 0 || project.types.length > 0)
              .map((project) => (
                <ProjectSection key={project.projectId} project={project} selectedId={selectedId} />
              ))}
          </div>
        </>
      )}
    </>
  );
}

function findUnit(
  board: AvailabilityBoard,
  unitId: string,
): { unit: UnitRow; project: ProjectBoard; type: TypeBoard } | null {
  for (const project of board.projects) {
    for (const type of project.types) {
      const unit = type.units.find((row) => row.id === unitId);
      if (unit) return { unit, project, type };
    }
  }
  return null;
}

function Legend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[--color-line] bg-[--color-canvas] px-4 py-3 ${className}`}>
      <span className="label">Status</span>
      {UNIT_STATUSES.map((status) => (
        <span key={status} className="flex items-center gap-1.5 text-xs text-[--color-muted]">
          <span className={`h-2.5 w-2.5 rounded-sm ${UNIT_STATUS_DOT[status]}`} aria-hidden />
          {UNIT_STATUS_LABELS[status]}
        </span>
      ))}
      <span className="ml-auto text-[11px] text-[--color-faint]">
        Select a tile to change its status
      </span>
    </div>
  );
}

function CountStrip({ counts, total }: { counts: StatusCounts; total: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {UNIT_STATUSES.filter((status) => counts[status] > 0).map((status) => (
        <span key={status} className="flex items-center gap-1.5 text-[11px] text-[--color-muted]">
          <span className={`h-2 w-2 rounded-sm ${UNIT_STATUS_DOT[status]}`} aria-hidden />
          {UNIT_STATUS_LABELS[status]}
          <span className="tabular-nums text-[--color-ink]">{counts[status]}</span>
        </span>
      ))}
      {total === 0 && <span className="text-[11px] text-[--color-faint]">No units loaded</span>}
    </div>
  );
}

function ProjectSection({ project, selectedId }: { project: ProjectBoard; selectedId?: string }) {
  const pct = absorption(project.counts);
  const absorbed = project.counts.sold + project.counts.reserved + project.counts.under_booking;

  return (
    <Card
      title={project.projectName}
      hint={
        project.total > 0
          ? `${formatNumber(project.counts.available)} available of ${formatNumber(project.total)} loaded`
          : "No units loaded for this project"
      }
      actions={
        <Link
          href={`/os/properties/projects/${project.slug}`}
          className="text-xs text-[--color-gold-300] underline underline-offset-2"
        >
          Dossier
        </Link>
      }
    >
      {project.total > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <CountStrip counts={project.counts} total={project.total} />
          <div className="min-w-[180px] flex-1">
            <div className="mb-1 flex items-baseline justify-between text-[11px]">
              <span className="text-[--color-faint]">Absorption</span>
              <span className="tabular-nums text-[--color-gold-300]">{formatPercent(pct, 0)}</span>
            </div>
            <Meter value={absorbed} max={project.total} />
          </div>
        </div>
      )}

      {project.types.length === 0 ? (
        <Empty>No villa type on this project yet.</Empty>
      ) : (
        <div className="space-y-5">
          {project.types.map((type) => (
            <TypeSection
              key={type.villaTypeId ?? `${project.projectId}-unassigned`}
              type={type}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function TypeSection({ type, selectedId }: { type: TypeBoard; selectedId?: string }) {
  return (
    <section>
      <header className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-[--color-line] pb-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-[--color-ink]">{type.name}</h3>
          <span className="text-[11px] tabular-nums text-[--color-muted]">
            {type.plotAreaSqyd ? `${formatNumber(type.plotAreaSqyd)} yd²` : null}
            {type.plotAreaSqyd && type.builtUpSft ? " · " : null}
            {type.builtUpSft ? `${formatNumber(type.builtUpSft)} sft` : null}
          </span>
          {type.priceInr !== null ? (
            <span className="text-[11px] tabular-nums text-[--color-gold-300]">
              {formatInr(type.priceInr)}
            </span>
          ) : (
            <span className="text-[11px] text-[--color-warm]">Price confirmed by sales</span>
          )}
        </div>
        <CountStrip counts={type.counts} total={type.total} />
      </header>

      {type.verificationNote && (
        <p className="mb-2.5 text-[11px] leading-relaxed text-[--color-warm]">{type.verificationNote}</p>
      )}

      {type.units.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[--color-line] px-3 py-5 text-center text-xs text-[--color-faint]">
          No units loaded for this configuration — availability cannot be quoted for it.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5">
          {type.units.map((unit) => (
            <UnitTile key={unit.id} unit={unit} selected={unit.id === selectedId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UnitTile({ unit, selected }: { unit: UnitRow; selected: boolean }) {
  const status = isUnitStatus(unit.status) ? unit.status : "blocked";

  // The hover card is the only place price and facing appear on the board, so
  // it states plainly when they are absent rather than showing a blank.
  const title = [
    `Unit ${unit.unit_number}`,
    UNIT_STATUS_LABELS[status],
    unit.facing ? `${unit.facing} facing` : "Facing not recorded",
    unit.price_inr ? formatInr(unit.price_inr) : "Price not set",
    unit.is_corner ? "Corner plot" : null,
    unit.plot_area_sqyd ? `${formatNumber(unit.plot_area_sqyd)} yd²` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <Link
        href={selected ? BASE : `${BASE}?unit=${unit.id}`}
        title={title}
        aria-label={title}
        className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border text-center transition hover:brightness-125 ${
          UNIT_STATUS_TILE[status]
        } ${selected ? "ring-2 ring-[--color-gold-500] ring-offset-2 ring-offset-[--color-canvas]" : ""}`}
      >
        <span className="max-w-full truncate px-1 text-[11px] font-semibold tabular-nums">
          {unit.unit_number}
        </span>
        {unit.is_corner && (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-current opacity-70"
          />
        )}
      </Link>
    </li>
  );
}

function UnitInspector({
  unit,
  project,
  type,
}: {
  unit: UnitRow;
  project: ProjectBoard;
  type: TypeBoard;
}) {
  const status = isUnitStatus(unit.status) ? unit.status : "blocked";

  return (
    <Card
      gold
      className="mb-5"
      title={`Unit ${unit.unit_number}`}
      hint={`${project.projectName} · ${type.name}`}
      actions={
        <Link href={BASE} className="btn-ghost !px-3 !py-1.5 text-xs" aria-label="Close unit">
          <X size={13} strokeWidth={2} aria-hidden />
          Close
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label="Status">
            <Badge tone={statusTone(status)}>{UNIT_STATUS_LABELS[status]}</Badge>
          </Field>
          <Field label="Facing">
            {unit.facing ? (
              <span className="inline-flex items-center gap-1 text-sm text-[--color-ink]">
                <Compass size={12} strokeWidth={2} className="text-[--color-muted]" aria-hidden />
                {unit.facing}
              </span>
            ) : (
              <span className="text-sm text-[--color-faint]">Not recorded</span>
            )}
          </Field>
          <Field label="Price">
            <span
              className={`text-sm tabular-nums ${unit.price_inr ? "text-[--color-gold-300]" : "text-[--color-faint]"}`}
            >
              {unit.price_inr ? formatInr(unit.price_inr) : "Not set"}
            </span>
          </Field>
          <Field label="Plot area">
            <span className="text-sm tabular-nums text-[--color-ink]">
              {unit.plot_area_sqyd ? `${formatNumber(unit.plot_area_sqyd)} yd²` : "—"}
            </span>
          </Field>
          <Field label="Chargeable extra">
            <span className="text-sm tabular-nums text-[--color-ink]">
              {unit.chargeable_extra_sqyd ? `${formatNumber(unit.chargeable_extra_sqyd)} yd²` : "—"}
            </span>
          </Field>
          <Field label="Saleable">
            <span className="text-sm tabular-nums text-[--color-ink]">
              {unit.saleable_sft ? `${formatNumber(unit.saleable_sft)} sft` : "—"}
            </span>
          </Field>
          <Field label="Corner plot">
            <span className="text-sm text-[--color-ink]">{unit.is_corner ? "Yes" : "No"}</span>
          </Field>
          <Field label="Last changed">
            <span className="text-sm text-[--color-muted]">{timeAgo(unit.updated_at)}</span>
          </Field>
        </dl>

        <form action="/api/osf/properties" method="POST" className="space-y-2.5 rounded-xl border border-[--color-line] bg-[--color-void]/50 p-3.5">
          <input type="hidden" name="action" value="unit-status" />
          <input type="hidden" name="unitId" value={unit.id} />
          <input type="hidden" name="next" value={`${BASE}?unit=${unit.id}`} />
          <label className="label" htmlFor="unit-status">
            Change status
          </label>
          <select id="unit-status" name="status" defaultValue={status} className="field">
            {UNIT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {UNIT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-gold w-full justify-center">
            Save status
          </button>
          <p className="text-[11px] leading-relaxed text-[--color-muted]">
            This changes what the agent tells the next customer who asks, so the change is written to
            the activity log with who made it.
          </p>
        </form>
      </div>
    </Card>
  );
}

function statusTone(status: string) {
  if (status === "available") return "success" as const;
  if (status === "under_booking") return "warning" as const;
  if (status === "reserved") return "info" as const;
  if (status === "sold") return "neutral" as const;
  return "neutral" as const;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function AddUnitForm({ board }: { board: AvailabilityBoard }) {
  if (board.projectOptions.length === 0) {
    return (
      <Card>
        <Empty>
          There is no project to add a unit to. Load{" "}
          <code className="rounded bg-[--color-canvas] px-1.5 py-0.5 text-xs">villa_projects</code>{" "}
          first.
        </Empty>
      </Card>
    );
  }

  return (
    <details className="card">
      <summary className="cursor-pointer list-none text-sm font-semibold text-[--color-ink]">
        <span className="inline-flex items-center gap-2">
          <Plus size={14} strokeWidth={2} className="text-[--color-gold-300]" aria-hidden />
          Add a unit
        </span>
        <span className="ml-2 text-xs font-normal text-[--color-muted]">
          One plot at a time, from the approved inventory sheet.
        </span>
      </summary>

      <form action="/api/osf/properties" method="POST" className="mt-4 grid gap-3 lg:grid-cols-12">
        <input type="hidden" name="action" value="create-unit" />
        <input type="hidden" name="next" value={BASE} />

        <div className="lg:col-span-3">
          <label className="label" htmlFor="new-project">
            Project
          </label>
          <select id="new-project" name="projectId" required defaultValue="" className="field mt-1.5">
            <option value="" disabled>
              Choose
            </option>
            {board.projectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-3">
          <label className="label" htmlFor="new-type">
            Villa type
          </label>
          <select id="new-type" name="villaTypeId" defaultValue="" className="field mt-1.5">
            <option value="">Unassigned</option>
            {board.typeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.projectName} — {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-2">
          <label className="label" htmlFor="new-number">
            Unit number
          </label>
          <input id="new-number" name="unitNumber" required placeholder="A-14" className="field mt-1.5" />
        </div>

        <div className="lg:col-span-2">
          <label className="label" htmlFor="new-facing">
            Facing
          </label>
          <input id="new-facing" name="facing" placeholder="East" className="field mt-1.5" />
        </div>

        <div className="lg:col-span-2">
          <label className="label" htmlFor="new-status">
            Status
          </label>
          <select id="new-status" name="status" defaultValue="available" className="field mt-1.5">
            {UNIT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {UNIT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-3">
          <label className="label" htmlFor="new-plot">
            Plot area (sq yd)
          </label>
          <input
            id="new-plot"
            name="plotAreaSqyd"
            type="number"
            min="0"
            step="0.01"
            className="field mt-1.5"
          />
        </div>

        <div className="lg:col-span-4">
          <label className="label" htmlFor="new-price">
            Price (rupees)
          </label>
          <input
            id="new-price"
            name="priceInr"
            type="number"
            min="0"
            step="1"
            placeholder="Leave blank if not approved"
            className="field mt-1.5"
          />
        </div>

        <div className="flex items-end lg:col-span-3">
          <label className="flex items-center gap-2 pb-2.5 text-sm text-[--color-ink]">
            <input type="checkbox" name="isCorner" className="h-4 w-4 accent-[--color-gold-500]" />
            Corner plot
          </label>
        </div>

        <div className="flex items-end lg:col-span-2">
          <button type="submit" className="btn-gold w-full justify-center">
            <Grid3X3 size={14} strokeWidth={2} aria-hidden />
            Add unit
          </button>
        </div>

        <p className="text-xs leading-relaxed text-[--color-muted] lg:col-span-12">
          A unit added here becomes something the AI will quote by number. Leave the price blank if it
          has not been approved — a blank makes the agent defer, a wrong number makes it mislead.
        </p>
      </form>
    </details>
  );
}
