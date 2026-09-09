"use client";

/**
 * Glentree Onyx — the tower, presented as the photoreal marketing render.
 *
 * This replaces the procedural R3F massing. The client's decision was explicit:
 * the building is to be shown as the render, and the floors are to stay
 * clickable on it. So the render is an <img> and the interaction is an SVG
 * overlay of 35 quadrilaterals fitted to the real façade — see
 * src/lib/showcase/onyx-tower-map.ts for how that geometry was measured, and
 * scripts/derive-onyx-tower-map.mjs for how to re-measure it.
 *
 * The overlay's viewBox is 0..100 in both axes, i.e. percentages of the image,
 * and the image is drawn at its own 5:3 aspect with no cropping, so the two
 * stay registered at every size.
 *
 * TURNTABLE. The client asked to rotate the building. The mechanism is here —
 * drag, arrow keys and an angle scrubber step through
 * src/lib/showcase/onyx-tower-views.ts, and the floor overlay swaps to that
 * angle's own calibrated geometry, so hotspots stay on the façade at every
 * angle. Only ONE full-tower render has been supplied, so the control renders
 * as an honest disabled note rather than a button that does nothing. Adding
 * real angles turns it on with no code change.
 *
 * There is deliberately no Day/Dusk toggle here: the only honest way to fake
 * dusk on a bright daytime aerial render is a warm gradient wash, which reads
 * as a photo filter rather than a time of day. Dusk needs a second render.
 */

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ONYX_FLOORS, onyxFloorColor, type OnyxFloorBand } from "@/lib/showcase/onyx-tower-map";
import {
  ONYX_CONTEXT_VIEWS,
  ONYX_TOWER_VIEWS,
  ONYX_TURNTABLE_AVAILABLE,
  ONYX_TURNTABLE_UNAVAILABLE_NOTE,
  onyxNeighbourViewIndexes,
  onyxStepViewIndex,
  type OnyxContextView,
} from "@/lib/showcase/onyx-tower-views";

export type FloorSummary = { floor: number; open: number; total: number };

/* ------------------------------------------------------------------ */
/* One band                                                            */
/* ------------------------------------------------------------------ */

/**
 * Memoised so hovering floor 17 re-renders floors 17 and 18 only, not all 35.
 * Every prop is a primitive or a frozen module constant, so the comparison is
 * a cheap shallow one.
 */
const FloorBand = memo(function FloorBand({
  band,
  color,
  label,
  selected,
  hovered,
  tabbable,
  onSelect,
  onHover,
  onKeyDown,
}: {
  band: OnyxFloorBand;
  color: string;
  label: string;
  selected: boolean;
  hovered: boolean;
  tabbable: boolean;
  onSelect: (floor: number) => void;
  onHover: (floor: number | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const active = selected || hovered;
  return (
    <polygon
      points={band.polygon}
      role="option"
      aria-selected={selected}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      data-floor={band.floor}
      fill={color}
      fillOpacity={selected ? 0.55 : hovered ? 0.4 : 0.001}
      stroke={active ? "#ffffff" : color}
      strokeOpacity={active ? 0.95 : 0}
      strokeWidth={selected ? 0.28 : 0.2}
      vectorEffect="non-scaling-stroke"
      className="cursor-pointer outline-none transition-[fill-opacity,stroke-opacity] duration-150 focus-visible:stroke-white focus-visible:[stroke-opacity:1]"
      onClick={() => onSelect(band.floor)}
      onPointerOver={() => onHover(band.floor)}
      onFocus={() => onHover(band.floor)}
      onKeyDown={onKeyDown}
    />
  );
});

/* ------------------------------------------------------------------ */
/* Context stills — additional viewpoints, explicitly not rotation      */
/* ------------------------------------------------------------------ */

/**
 * A cropped-at-display-time still. `cropTop` exists only to hide a marketing
 * overlay baked into a supplied file; the image is never otherwise altered.
 */
function ContextStill({ view, className }: { view: OnyxContextView; className?: string }) {
  const crop = view.cropTop ?? 0;
  const visible = 1 - crop;
  return (
    <div
      className={className}
      style={{ aspectRatio: `${view.width} / ${view.height * visible}` }}
    >
      <div className="relative size-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={view.src}
          alt={view.alt}
          width={view.width}
          height={view.height}
          draggable={false}
          className="absolute left-0 w-full select-none"
          style={{ top: `${(-crop / visible) * 100}%`, height: `${(1 / visible) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The "more views" strip. It lives INSIDE the tower frame as an overlay, so
 * this component keeps the caller's layout contract (root = the 5:3 frame).
 */
function ContextViewsStrip({
  active,
  onOpen,
}: {
  active: string | null;
  onOpen: (id: string | null) => void;
}) {
  if (ONYX_CONTEXT_VIEWS.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-xl border border-white/10 bg-black/55 p-1.5 backdrop-blur">
      <p className="px-1 text-[9.5px] uppercase tracking-wide text-white/60">More views</p>
      <button
        type="button"
        onClick={() => onOpen(null)}
        aria-pressed={active === null}
        className={`rounded-md border px-2 py-1 text-left text-[11px] text-white/90 transition ${
          active === null ? "border-white/70 bg-white/10" : "border-white/15 hover:border-white/40"
        }`}
      >
        The tower
      </button>
      {ONYX_CONTEXT_VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onOpen(v.id)}
          aria-pressed={active === v.id}
          title={v.caption}
          className={`overflow-hidden rounded-md border text-left transition ${
            active === v.id ? "border-white/70" : "border-white/15 hover:border-white/40"
          }`}
        >
          <ContextStill view={v} className="w-full" />
          <span className="block px-1.5 py-1 text-[10.5px] text-white/90">{v.label}</span>
        </button>
      ))}
      <p className="px-1 pb-0.5 text-[9.5px] leading-tight text-white/50">
        Extra viewpoints, not rotation — no clickable floors.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tower                                                               */
/* ------------------------------------------------------------------ */

/** Horizontal pixels of drag that advance one angle. Tuned to feel like a dial. */
const DRAG_PX_PER_STEP = 46;

export function OnyxTowerRender({
  summaries,
  selected,
  onSelectFloor,
  src,
  chromeless = false,
  focusStyle,
  focusTransition = false,
  spotlightFloor = null,
  overlay,
  viewIndex: viewIndexProp,
  onViewIndexChange,
}: {
  summaries: FloorSummary[];
  selected: number;
  onSelectFloor: (floor: number) => void;
  /** Override only if the angle-0 render itself is replaced; the map is calibrated to the default. */
  src?: string;
  /**
   * The five props below exist for <OnyxTowerExplorer/>, which drills into the
   * tower in place. They are all inert by default, so the plain tower is
   * exactly what it was.
   *
   * `chromeless` drops this component's own floating captions, because the
   * explorer puts a breadcrumb in the same corner.
   */
  chromeless?: boolean;
  /** A transform applied to the render AND the floor overlay together, so the
   *  two stay registered while the camera moves. */
  focusStyle?: React.CSSProperties;
  /** Animate changes to `focusStyle`. Off under prefers-reduced-motion. */
  focusTransition?: boolean;
  /** Dim the tower except this floor's band, in the overlay's own space. */
  spotlightFloor?: number | null;
  /** Rendered inside the frame, above the overlay — the explorer's panels. */
  overlay?: React.ReactNode;
  /**
   * The turntable angle, lifted. The explorer owns it because the drill-down
   * camera has to be computed from the SAME angle that is on screen (see
   * onyxFocusForState). Omit both props and the component keeps its own.
   */
  viewIndex?: number;
  onViewIndexChange?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ownViewIndex, setOwnViewIndex] = useState(0);
  const controlledView = viewIndexProp !== undefined;
  const viewIndex = controlledView ? viewIndexProp : ownViewIndex;
  const setViewIndex = useCallback(
    (next: number | ((i: number) => number)) => {
      const resolve = (i: number) => (typeof next === "function" ? next(i) : next);
      if (controlledView) onViewIndexChange?.(resolve(viewIndexProp));
      else setOwnViewIndex((i) => resolve(i));
    },
    [controlledView, onViewIndexChange, viewIndexProp],
  );
  const [context, setContext] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const listId = useId();

  const view = ONYX_TOWER_VIEWS[Math.min(viewIndex, ONYX_TOWER_VIEWS.length - 1)];
  const bands = view.bands;
  const imageSrc = view.azimuthDeg === 0 && src ? src : view.image.src;

  const map = useMemo(() => new Map(summaries.map((s) => [s.floor, s])), [summaries]);

  /** Colour per floor, recomputed only when the live inventory changes. */
  const colors = useMemo(() => {
    const out = new Map<number, string>();
    for (const s of map.values()) out.set(s.floor, onyxFloorColor(s.open, s.total));
    for (let f = 1; f <= ONYX_FLOORS; f++) if (!out.has(f)) out.set(f, onyxFloorColor(0, 0));
    return out;
  }, [map]);

  const labels = useMemo(() => {
    const out = new Map<number, string>();
    for (let f = 1; f <= ONYX_FLOORS; f++) {
      const s = map.get(f);
      out.set(f, s && s.total > 0 ? `Floor ${f} — ${s.open} of ${s.total} available` : `Floor ${f}`);
    }
    return out;
  }, [map]);

  /* ---------------- turntable ---------------- */

  /**
   * Decode the current angle and its two neighbours ahead of time, so stepping
   * never flashes. Capped at three images however many angles exist, and the
   * Image objects are dropped as soon as the browser has them in its cache.
   */
  useEffect(() => {
    if (!ONYX_TURNTABLE_AVAILABLE) return;
    let pending: HTMLImageElement[] = onyxNeighbourViewIndexes(viewIndex).map((i) => {
      const img = new Image();
      img.decoding = "async";
      img.src = ONYX_TOWER_VIEWS[i].image.src;
      void img.decode?.().catch(() => {});
      return img;
    });
    // Drop our references on the way out; the browser cache keeps the bytes.
    return () => {
      pending = [];
      void pending;
    };
  }, [viewIndex]);

  /**
   * Rotation is a STAGE-1 affordance only. Once the explorer has drilled in
   * (`chromeless`), the frame is showing a floor/flat/room opened at a
   * specific band, with a panel of that floor's units beside it; spinning the
   * building under that panel is not something a user can mean, and it would
   * fight the 700ms camera transition. So the drag, the arrow keys and the
   * scrubber are all inert while drilled in — step back out to the tower to
   * rotate. (The camera itself is angle-aware regardless, so this is a
   * usability choice, not the thing keeping the overlay registered.)
   */
  const canRotate = ONYX_TURNTABLE_AVAILABLE && !chromeless;

  const stepView = useCallback(
    (by: number) => {
      if (!canRotate) return;
      setViewIndex((i) => onyxStepViewIndex(i, by));
    },
    [canRotate, setViewIndex],
  );

  /**
   * Drag to rotate. Pointer capture on the wrapper, angle advanced every
   * DRAG_PX_PER_STEP of travel — no per-frame state writes, so nothing janks,
   * and the swap is a src change on an already-decoded image.
   */
  const drag = useRef<{ id: number; lastX: number; moved: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!canRotate || e.button !== 0) return;
    drag.current = { id: e.pointerId, lastX: e.clientX, moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [canRotate]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.lastX;
      d.moved += Math.abs(dx);
      if (Math.abs(dx) >= DRAG_PX_PER_STEP) {
        // Dragging left turns the building to the next angle clockwise.
        stepView(dx < 0 ? 1 : -1);
        d.lastX = e.clientX;
      }
    },
    [stepView],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if ((e.currentTarget as HTMLElement).hasPointerCapture?.(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }, []);

  /* ---------------- floor keyboard ---------------- */

  /** Move focus with the arrow keys; Home/End jump to the ends of the stack. */
  const focusFloor = useCallback((floor: number) => {
    const f = Math.min(ONYX_FLOORS, Math.max(1, floor));
    const el = svgRef.current?.querySelector<SVGPolygonElement>(`[data-floor="${f}"]`);
    el?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const floor = Number((e.currentTarget as SVGPolygonElement).dataset.floor);
      if (!Number.isFinite(floor)) return;
      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          onSelectFloor(floor);
          break;
        case "ArrowUp":
          e.preventDefault();
          focusFloor(floor + 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          focusFloor(floor - 1);
          break;
        // Left/right rotate the tower once there is more than one angle;
        // until then they keep their old job of moving up and down the stack.
        case "ArrowRight":
          e.preventDefault();
          if (canRotate) stepView(1);
          else focusFloor(floor + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (canRotate) stepView(-1);
          else focusFloor(floor - 1);
          break;
        case "Home":
          e.preventDefault();
          focusFloor(ONYX_FLOORS);
          break;
        case "End":
          e.preventDefault();
          focusFloor(1);
          break;
        default:
      }
    },
    [canRotate, focusFloor, onSelectFloor, stepView],
  );

  const readout = hover !== null ? map.get(hover) : map.get(selected);
  const readoutFloor = hover ?? selected;

  const contextView = context ? ONYX_CONTEXT_VIEWS.find((v) => v.id === context) : undefined;

  /** The band to spotlight, in the CURRENT angle's geometry. */
  const spotlightBand =
    spotlightFloor === null ? undefined : bands.find((b) => b.floor === spotlightFloor);

  return (
    <div
      className="relative aspect-[5/3] w-full touch-pan-y overflow-hidden rounded-2xl border border-ink-700/70 bg-ink-900"
      onPointerDown={contextView ? undefined : onPointerDown}
      onPointerMove={contextView ? undefined : onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={canRotate && !contextView ? { cursor: "ew-resize" } : undefined}
    >
      {contextView ? (
        /* A genuine extra viewpoint of the project, shown full-frame and
           explicitly without floor hotspots — it is not a calibrated angle and
           the whole tower is not in shot. */
        <>
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            {/* Both stills are wider than the 5:3 frame, so width-bound is the
                 fitting rule; the wrapper centres what is left over. */}
            <ContextStill view={contextView} className="w-full" />
          </div>
          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg border border-white/15 bg-black/65 px-3 py-1.5 text-[11.5px] text-white/90 backdrop-blur">
            {contextView.caption}
            {contextView.cropReason && (
              <span className="block text-[10.5px] text-white/60">
                Top of the frame is cropped here — it {contextView.cropReason}.
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          {/* The render and the floor overlay share ONE transformed layer, so
              the explorer's camera (src/lib/showcase/onyx-drilldown.ts) moves
              both with a single compositor transform and the percentage
              coordinates stay registered at every zoom. Inert by default. */}
          <div
            className={
              focusTransition
                ? "absolute inset-0 transition-transform duration-[700ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] will-change-transform"
                : "absolute inset-0"
            }
            style={focusStyle}
          >
          {/* The render is drawn at its own aspect ratio — no object-cover — so the
              overlay's percentage coordinates land on the same pixels it does. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt={view.alt}
            width={view.image.width}
            height={view.image.height}
            className="absolute inset-0 size-full select-none"
            draggable={false}
          />

          <svg
            ref={svgRef}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full"
            role="listbox"
            aria-label="Select a floor on the tower"
            id={listId}
            onPointerLeave={() => setHover(null)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
            }}
          >
            {bands.map((band) => (
              <FloorBand
                key={band.floor}
                band={band}
                color={colors.get(band.floor) ?? "#64748b"}
                label={labels.get(band.floor) ?? `Floor ${band.floor}`}
                selected={band.floor === selected}
                hovered={band.floor === hover}
                tabbable={band.floor === selected}
                onSelect={onSelectFloor}
                onHover={setHover}
                onKeyDown={handleKeyDown}
              />
            ))}
          </svg>

          {/* Everything but the open floor, dimmed. Drawn in the overlay's own
              coordinates, so it tracks whichever angle is on screen. */}
          {spotlightBand && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 size-full"
              aria-hidden
            >
              <defs>
                <mask id={`${listId}-spot`}>
                  <rect x="0" y="0" width="100" height="100" fill="#fff" />
                  <polygon points={spotlightBand.polygon} fill="#000" />
                </mask>
              </defs>
              <rect
                x="0"
                y="0"
                width="100"
                height="100"
                fill="#040711"
                opacity="0.62"
                mask={`url(#${listId}-spot)`}
              />
              <polygon
                points={spotlightBand.polygon}
                fill="none"
                stroke="#e2e8f0"
                strokeOpacity="0.9"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          </div>

          {/* Floating label for whatever the pointer or keyboard is on. */}
          <div
            hidden={chromeless}
            className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-white/15 bg-black/60 px-3 py-1.5 text-[11.5px] text-white/90 backdrop-blur"
            aria-live="polite"
          >
            {readout && readout.total > 0
              ? `Floor ${readoutFloor}${hover === null ? " selected" : ""} — ${readout.open} of ${readout.total} available`
              : `Floor ${readoutFloor}${hover === null ? " selected" : ""}`}
          </div>
        </>
      )}

      {/* The explorer's own stage panels, inside the frame. */}
      {overlay}

      {/* Chrome: the turntable control and the extra-views strip. */}
      {!chromeless && (
        <>
          <div className="absolute right-3 top-3 flex w-28 flex-col gap-2">
            <ContextViewsStrip active={context} onOpen={setContext} />
            {!ONYX_TURNTABLE_AVAILABLE && (
              /* No rotate affordance that does nothing: a disabled note that says
                 why, with the full explanation on hover and for screen readers. */
              <p
                className="rounded-xl border border-white/10 bg-black/55 px-2 py-1.5 text-[10px] leading-tight text-white/55 backdrop-blur"
                title={ONYX_TURNTABLE_UNAVAILABLE_NOTE}
              >
                Rotation off: one tower angle supplied.
                <span className="sr-only"> {ONYX_TURNTABLE_UNAVAILABLE_NOTE}</span>
              </p>
            )}
          </div>

          {ONYX_TURNTABLE_AVAILABLE ? (
            <div className="absolute inset-x-3 bottom-14 flex items-center gap-2 rounded-xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur sm:inset-x-auto sm:left-1/2 sm:w-[min(26rem,80%)] sm:-translate-x-1/2">
              <button
                type="button"
                onClick={() => stepView(-1)}
                aria-label="Rotate tower left"
                className="rounded-md border border-white/20 px-2 py-0.5 text-[13px] text-white/90 hover:border-white/50"
              >
                &lsaquo;
              </button>
              <input
                type="range"
                min={0}
                max={ONYX_TOWER_VIEWS.length - 1}
                step={1}
                value={viewIndex}
                onChange={(e) => setViewIndex(Number(e.target.value))}
                aria-label="Camera angle around the tower"
                aria-valuetext={`${Math.round(view.azimuthDeg)} degrees — ${view.label}`}
                className="h-1 min-w-0 flex-1 cursor-ew-resize accent-white"
              />
              <button
                type="button"
                onClick={() => stepView(1)}
                aria-label="Rotate tower right"
                className="rounded-md border border-white/20 px-2 py-0.5 text-[13px] text-white/90 hover:border-white/50"
              >
                &rsaquo;
              </button>
              <span className="shrink-0 text-[11px] tabular-nums text-white/80">
                {Math.round(view.azimuthDeg)}&deg;
              </span>
            </div>
          ) : null}

          {!contextView && (
            <p className="pointer-events-none absolute bottom-3 right-3 hidden text-[10.5px] text-white/60 sm:block">
              {ONYX_TURNTABLE_AVAILABLE ? "Click a floor \u00b7 drag to rotate" : "Click a floor on the tower"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default OnyxTowerRender;
