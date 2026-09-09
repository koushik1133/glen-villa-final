"use client";

/**
 * Glentree Onyx — the in-place drill-down.
 *
 * The client's ask was that picking a floor should open that floor WHERE IT IS
 * on the render, then a flat, then a room, rather than scrolling to a separate
 * section. So this composes <OnyxTowerRender/> and moves a CSS camera over it:
 *
 *   1 TOWER  the render, 35 clickable bands, coloured by live availability
 *   2 FLOOR  the camera zooms to the chosen band and the plate opens beside it
 *   3 FLAT   one more push-in; the unit's real schedule and its plan sheet
 *   4 ROOM   the existing 360 tour, or the plan sheet, for that unit
 *
 * The zoom is ONE transform on the already-painted image and overlay (see
 * src/lib/showcase/onyx-drilldown.ts) — the 35 polygons are not recomputed per
 * frame. Under prefers-reduced-motion the camera stays put and the stages
 * cross-fade instead.
 *
 * The container is a fixed 5:3 box at every stage: the panels are absolutely
 * positioned inside it, so nothing on the page moves as you drill in.
 */

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { ArrowLeft, ChevronRight, Compass, Loader2, Maximize2, Ruler } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import { OnyxTowerRender, type FloorSummary } from "./onyx-tower-render";
import {
  ONYX_FOCUS_NEUTRAL,
  onyxBreadcrumb,
  onyxDrilldownInitial,
  onyxDrilldownReduce,
  onyxFocusForState,
  onyxFocusStyle,
  type OnyxStage,
} from "@/lib/showcase/onyx-drilldown";
import { ONYX_PLATE_LAYOUT, onyxUnitType } from "@/lib/showcase/onyx-units";
import { ONYX_TOWER_VIEWS } from "@/lib/showcase/onyx-tower-views";

const OnyxTour = dynamic(() => import("./onyx-tour").then((m) => m.OnyxTour), {
  ssr: false,
  loading: () => (
    <div className="grid h-full min-h-[240px] place-items-center text-mist-400">
      <Loader2 className="size-5 animate-spin" aria-hidden />
    </div>
  ),
});

/* ------------------------------------------------------------------ */

/** What the explorer needs to know about a unit. The sale statuses and their
 *  colours are owned by the showcase, so they arrive already resolved. */
export type ExplorerUnit = {
  id: string;
  number: string;
  bhk: string;
  sizeSqft: number | null;
  facing: string | null;
  priceLabel: string | null;
  statusLabel: string;
  fill: string;
  stroke: string;
  sellable: boolean;
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ */

export function OnyxTowerExplorer({
  summaries,
  units,
  floor,
  onFloorChange,
  onSelectUnit,
  brandId,
  src,
}: {
  summaries: FloorSummary[];
  /** The units on `floor`, in plate order. */
  units: ExplorerUnit[];
  floor: number;
  onFloorChange: (floor: number) => void;
  /**
   * Fired whenever the explorer's own flat selection changes — including when
   * it CLEARS (stepping back out of a flat, or opening a different floor). The
   * sections below render from this, so anything less would leave them showing
   * a unit the explorer no longer has open.
   */
  onSelectUnit: (unitId: string | null) => void;
  brandId: string;
  src?: string;
}) {
  const [state, dispatch] = useReducer(onyxDrilldownReduce, floor, onyxDrilldownInitial);
  /**
   * The turntable angle lives HERE, not in the render, because the drill-down
   * camera must be computed from the angle actually on screen: every render
   * has its own calibration, so floor 21's band is at different image
   * coordinates on each one.
   */
  const [viewIndex, setViewIndex] = useState(0);
  const reduced = usePrefersReducedMotion();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastStage = useRef<OnyxStage>(state.stage);

  /* The floor is the shared contract with the rail and the sections below. */
  useEffect(() => {
    // A rail click while the tower is closed follows the floor but does not
    // force the tower open; from inside, it re-opens the new floor's plate.
    dispatch({ type: "setFloor", floor });
  }, [floor]);

  const openFloor = useCallback(
    (f: number) => {
      dispatch({ type: "openFloor", floor: f });
      onFloorChange(f);
    },
    [onFloorChange],
  );

  const openFlat = useCallback(
    (u: ExplorerUnit) => {
      dispatch({ type: "openFlat", unitNumber: u.number });
      onSelectUnit(u.id);
    },
    [onSelectUnit],
  );

  /* Escape steps back exactly one stage. */
  useEffect(() => {
    if (state.stage === "tower") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!frameRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      dispatch({ type: "back" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.stage]);

  /* Entering a stage moves focus into its panel, so the keyboard follows the
     eye and Escape has something to act on. */
  useEffect(() => {
    if (lastStage.current === state.stage) return;
    lastStage.current = state.stage;
    if (state.stage !== "tower") panelRef.current?.focus();
  }, [state.stage]);

  const view = ONYX_TOWER_VIEWS[Math.min(viewIndex, ONYX_TOWER_VIEWS.length - 1)];

  const focus = useMemo(
    () => (reduced ? ONYX_FOCUS_NEUTRAL : onyxFocusForState(state, view, { focusX: 0.28, focusY: 0.46 })),
    [reduced, state, view],
  );
  const focusStyle = onyxFocusStyle(focus);
  const crumbs = onyxBreadcrumb(state);
  const open = state.stage !== "tower";

  const unit = units.find((u) => u.number === state.unitNumber) ?? null;

  /* Keep the sections below in step with the stages above. The reducer clears
     the flat on "back", on a breadcrumb jump and on a floor change, and it can
     move the floor itself (opening a flat adopts that flat's floor) — none of
     which goes through openFloor/openFlat, so without this the plate and the
     unit-detail card below would keep showing a unit the explorer has closed,
     or one that is not on the floor being shown. */
  useEffect(() => {
    if (state.floor !== floor) onFloorChange(state.floor);
  }, [state.floor, floor, onFloorChange]);

  const reportedUnitId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = unit?.id ?? null;
    // Only report a resolved selection: while `units` is still loading the
    // new floor, an unresolved number must not be published as "nothing".
    if (state.unitNumber && !unit) return;
    if (reportedUnitId.current === id) return;
    reportedUnitId.current = id;
    onSelectUnit(id);
  }, [state.unitNumber, unit, onSelectUnit]);

  const type = state.unitNumber ? onyxUnitType(state.unitNumber) : undefined;

  return (
    <div ref={frameRef} className="relative" data-stage={state.stage}>
      <OnyxTowerRender
        summaries={summaries}
        selected={state.floor}
        onSelectFloor={openFloor}
        src={src}
        chromeless={open}
        viewIndex={viewIndex}
        onViewIndexChange={setViewIndex}
        focusStyle={focusStyle}
        focusTransition={!reduced}
        spotlightFloor={open ? state.floor : null}
        overlay={
          <>
            {/* Breadcrumb + back. Present from stage 2 on. */}
            {open && (
              <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => dispatch({ type: "back" })}
                  aria-label="Back one step"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                </Button>
                <nav
                  aria-label="Breadcrumb"
                  className="flex min-w-0 items-center gap-1 rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 text-[11.5px] text-white/85 backdrop-blur"
                >
                  {crumbs.map((c, i) => (
                    <span key={c.stage} className="flex min-w-0 items-center gap-1">
                      {i > 0 && <ChevronRight className="size-3 shrink-0 text-white/40" aria-hidden />}
                      {i === crumbs.length - 1 ? (
                        <span aria-current="step" className="truncate font-medium text-white">
                          {c.label}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => dispatch({ type: "goto", stage: c.stage })}
                          className="truncate rounded px-0.5 text-white/70 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400"
                        >
                          {c.label}
                        </button>
                      )}
                    </span>
                  ))}
                </nav>
              </div>
            )}

            {/* Stage panels. Absolutely positioned inside the frame, so the
                page never reflows as you drill in. */}
            <div
              ref={panelRef}
              tabIndex={-1}
              className={clsx(
                "absolute z-10 outline-none transition-opacity duration-300",
                state.stage === "room"
                  ? "inset-0"
                  : "inset-x-2 bottom-2 top-14 sm:left-auto sm:right-2 sm:w-[54%] sm:max-w-[400px]",
                open ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              aria-live="polite"
            >
              {state.stage === "floor" && (
                <PlatePanel floor={state.floor} units={units} onOpenFlat={openFlat} />
              )}

              {state.stage === "flat" && unit && (
                <FlatPanel
                  unit={unit}
                  planImage={type?.planImage ?? null}
                  rooms={type?.rooms ?? []}
                  position={type?.position ?? null}
                  onEnter={(view) => dispatch({ type: "openRoom", view })}
                />
              )}

              {state.stage === "room" && state.unitNumber && (
                <RoomPanel
                  unitNumber={state.unitNumber}
                  brandId={brandId}
                  view={state.view}
                  planImage={type?.planImage ?? null}
                  onView={(view) => dispatch({ type: "setView", view })}
                />
              )}
            </div>
          </>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stage 2 — the plate, opened at the band                             */
/* ------------------------------------------------------------------ */

const GRID_POS: Record<number, string> = (() => {
  const out: Record<number, string> = {};
  for (const [pos, cell] of Object.entries(ONYX_PLATE_LAYOUT)) {
    // grid-area shorthand is row-start / column-start — not x / y.
    out[Number(pos)] = `${cell.row + 1} / ${cell.col + 1}`;
  }
  return out;
})();

function Shell({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-xl border border-ink-500 bg-ink-900/85 shadow-2xl backdrop-blur-md">
      <div className="shrink-0 border-b border-ink-700 px-3.5 py-2.5">
        <p className="text-[13px] font-semibold text-mist-100">{title}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-mist-400">{hint}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </div>
  );
}

function PlatePanel({
  floor,
  units,
  onOpenFlat,
}: {
  floor: number;
  units: ExplorerUnit[];
  onOpenFlat: (u: ExplorerUnit) => void;
}) {
  const openCount = units.filter((u) => u.sellable).length;
  return (
    <Shell
      title={`Floor ${floor} — plate`}
      hint="Seven residences per floor, in their real key-plan positions. Pick one to open it."
    >
      {units.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-mist-400">No units are recorded on this floor.</p>
      ) : (
        <>
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gridTemplateRows: "repeat(3, minmax(0, 1fr))" }}
            role="group"
            aria-label={`Floor ${floor} units`}
          >
            <div
              className="grid place-items-center rounded-md border border-ink-700 bg-ink-800/40 px-1 text-center text-[9.5px] leading-tight text-mist-300"
              style={{ gridArea: "2 / 2 / 4 / 3" }}
              aria-hidden
            >
              Lift lobby
              <br />
              &amp; stair
            </div>
            {units.map((u) => {
              const pos = Number(u.number.slice(-2));
              const area = GRID_POS[pos];
              if (!area) return null;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onOpenFlat(u)}
                  style={{ gridArea: area, background: u.fill, borderColor: u.stroke }}
                  className="rounded-md border px-2 py-2 text-left outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <span className="block text-[12px] font-semibold tabular-nums text-mist-100">{u.number}</span>
                  <span className="block truncate text-[9.5px] text-mist-300">
                    {u.sizeSqft ? `${u.sizeSqft.toLocaleString("en-IN")} sq ft` : u.bhk}
                  </span>
                  <span className="block truncate text-[9.5px]" style={{ color: u.stroke }}>
                    {u.statusLabel}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-[11px] text-mist-400">
            {openCount} of {units.length} still open for sale on this floor.
          </p>
        </>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Stage 3 — the flat                                                  */
/* ------------------------------------------------------------------ */

function FlatPanel({
  unit,
  planImage,
  rooms,
  position,
  onEnter,
}: {
  unit: ExplorerUnit;
  planImage: string | null;
  rooms: Array<{ name: string; dimensions?: string }>;
  position: number | null;
  onEnter: (view: "360" | "plan") => void;
}) {
  return (
    <Shell
      title={`Unit ${unit.number}`}
      hint={position ? `Position ${position} on the plate · ${unit.statusLabel}` : unit.statusLabel}
    >
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="neutral">{unit.bhk}</Badge>
        {unit.sizeSqft && <Badge tone="neutral">{unit.sizeSqft.toLocaleString("en-IN")} sq ft</Badge>}
        {unit.facing && <Badge tone="neutral">{unit.facing} facing</Badge>}
      </div>
      <p className="mt-2 text-[11.5px] text-mist-300">
        {unit.priceLabel ?? "Price to be confirmed"}
      </p>

      {planImage && (
        <button
          type="button"
          onClick={() => onEnter("plan")}
          className="mt-3 block w-full overflow-hidden rounded-lg border border-white/15 bg-white outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          aria-label={`Open the apartment plan for unit ${unit.number}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={planImage} alt={`Apartment plan for unit ${unit.number}`} loading="lazy" decoding="async" className="h-24 w-full object-contain" />
        </button>
      )}

      {rooms.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {rooms.slice(0, 8).map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="text-mist-300">{r.name}</span>
              <span className="tabular-nums text-mist-400">{r.dimensions ?? "—"}</span>
            </li>
          ))}
          {rooms.length > 8 && (
            <li className="pt-0.5 text-[10.5px] text-mist-500">+{rooms.length - 8} more in the full schedule below</li>
          )}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => onEnter("360")}>
          <Compass className="mr-1 size-3.5" aria-hidden /> Walk the rooms
        </Button>
        {planImage && (
          <Button size="sm" variant="secondary" onClick={() => onEnter("plan")}>
            <Ruler className="mr-1 size-3.5" aria-hidden /> Plan
          </Button>
        )}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Stage 4 — the room: the existing 360 tour, or the plan sheet        */
/* ------------------------------------------------------------------ */

function RoomPanel({
  unitNumber,
  brandId,
  view,
  planImage,
  onView,
}: {
  unitNumber: string;
  brandId: string;
  view: "360" | "plan";
  planImage: string | null;
  onView: (v: "360" | "plan") => void;
}) {
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-xl border border-ink-500 bg-ink-900/95 backdrop-blur-md">
      <div className="flex shrink-0 items-center justify-end gap-1.5 px-3 pb-1 pt-12 sm:pt-2.5">
        <div className="flex gap-1.5" role="tablist" aria-label="How to view this home">
          <Button
            size="sm"
            role="tab"
            aria-selected={view === "360"}
            variant={view === "360" ? "primary" : "secondary"}
            onClick={() => onView("360")}
          >
            360°
          </Button>
          <Button
            size="sm"
            role="tab"
            aria-selected={view === "plan"}
            variant={view === "plan" ? "primary" : "secondary"}
            onClick={() => onView("plan")}
            disabled={!planImage}
          >
            Plan
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {view === "360" ? (
          <OnyxTour unitNumber={unitNumber} brandId={brandId} />
        ) : planImage ? (
          <div className="grid h-full place-items-center rounded-xl bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={planImage}
              alt={`Apartment plan for unit ${unitNumber}`}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <p className="grid h-full place-items-center text-[12px] text-mist-400">
            <span className="inline-flex items-center gap-1.5">
              <Maximize2 className="size-3.5" aria-hidden /> No plan sheet supplied for this unit yet.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

export default OnyxTowerExplorer;
