/**
 * Glentree Onyx — the drill-down state machine and the camera maths behind it.
 *
 * The client asked for the tower to open "in place": pick a floor on the render
 * and the floor opens where that floor actually is, then a flat, then a room.
 * That is four stages, and the only honest way to build it against a single
 * photoreal render is to move a CSS camera over that render rather than to
 * invent geometry the render does not contain.
 *
 * Everything here is pure — no DOM, no React — so the stage transitions and the
 * camera clamping are unit-testable (tests/onyx-drilldown.test.ts) and the
 * component can stay a thin renderer.
 *
 * CAMERA MODEL. The viewer paints the render at its natural 5:3 aspect and an
 * SVG overlay in the same 0..100 percentage space. A stage focus is therefore
 * one CSS transform applied to BOTH layers:
 *
 *     transform-origin: cx% cy%
 *     transform: translate(tx%, ty%) scale(s)
 *
 * With the origin at the band centre (cx, cy), `scale` keeps that point fixed
 * and `translate` — which resolves against the untransformed box, so it is not
 * multiplied by s — slides it to wherever in the frame we want it. One
 * transform on two already-painted layers: the 35 polygons are not re-laid-out
 * per frame, the compositor moves them.
 */

import { ONYX_FLOORS, type OnyxFloorBand } from "./onyx-tower-map";

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

export const ONYX_STAGES = ["tower", "floor", "flat", "room"] as const;
export type OnyxStage = (typeof ONYX_STAGES)[number];

/** The two ways of looking at a flat once you are inside it. */
export type OnyxFlatView = "360" | "plan";

export type OnyxDrilldownState = {
  stage: OnyxStage;
  /** The flat, once one has been picked. Null at stages "tower" and "floor". */
  unitNumber: string | null;
  /** Which face of the flat stage 4 is showing. */
  view: OnyxFlatView;
};

/**
 * THE SELECTED FLOOR IS NOT IN HERE, ON PURPOSE.
 *
 * It used to be, and the parent showcase kept its own `floor` state as well —
 * two owners reconciled by two opposing effects. Depending on effect ordering
 * they settled at different values, and a render could commit with the tower's
 * readout label on one floor and the plate, the rail and the unit card on
 * another. That was the "glitch" the client reported three times.
 *
 * The floor now has exactly one owner: the parent. Every helper below that
 * needs it takes it as an explicit parameter.
 */
export function onyxDrilldownInitial(): OnyxDrilldownState {
  return { stage: "tower", unitNumber: null, view: "360" };
}

export type OnyxDrilldownAction =
  /**
   * Open the floor stage.
   *
   * `floor` is NOT stored — the caller owns the floor and tells the parent.
   * It is passed only so the reducer can honour one invariant: re-picking the
   * floor you are already inside keeps that floor's flat, while moving to any
   * other floor (or omitting it) clears it, because the flat is on the old one.
   */
  | { type: "openFloor"; floor?: number }
  | { type: "openFlat"; unitNumber: string }
  | { type: "openRoom"; view?: OnyxFlatView }
  | { type: "setView"; view: OnyxFlatView }
  | { type: "goto"; stage: OnyxStage }
  | { type: "back" }
  | { type: "reset" };

function clampFloor(f: number): number {
  if (!Number.isFinite(f)) return ONYX_FLOORS;
  return Math.min(ONYX_FLOORS, Math.max(1, Math.round(f)));
}

/** The stage you land on when you step back one level. */
export function onyxPreviousStage(stage: OnyxStage): OnyxStage {
  const i = ONYX_STAGES.indexOf(stage);
  return i <= 0 ? "tower" : ONYX_STAGES[i - 1];
}

/**
 * Every transition, in one place. Illegal jumps are refused rather than
 * half-applied: you cannot be at stage "flat" with no flat.
 */
export function onyxDrilldownReduce(
  state: OnyxDrilldownState,
  action: OnyxDrilldownAction,
): OnyxDrilldownState {
  switch (action.type) {
    case "openFloor": {
      const floor = action.floor === undefined ? null : clampFloor(action.floor);
      // Re-picking a floor from inside it should not drop you deeper.
      const keepFlat =
        floor !== null && state.unitNumber !== null && onyxFloorOfUnit(state.unitNumber) === floor;
      return {
        stage: "floor",
        unitNumber: keepFlat ? state.unitNumber : null,
        view: state.view,
      };
    }
    case "openFlat": {
      const unitNumber = String(action.unitNumber ?? "").trim();
      if (!unitNumber) return state;
      return { stage: "flat", unitNumber, view: state.view };
    }
    case "openRoom":
      if (!state.unitNumber) return state;
      return { ...state, stage: "room", view: action.view ?? state.view };
    case "setView":
      return state.view === action.view ? state : { ...state, view: action.view };
    case "goto": {
      if (action.stage === state.stage) return state;
      if ((action.stage === "flat" || action.stage === "room") && !state.unitNumber) return state;
      if (action.stage === "tower") return { ...state, stage: "tower" };
      return { ...state, stage: action.stage };
    }
    case "back": {
      const stage = onyxPreviousStage(state.stage);
      // Leaving the flat behind clears it, so stage "floor" never shows a
      // stale selection highlighted on the plate.
      if (stage === "floor") return { ...state, stage, unitNumber: null };
      if (stage === "tower") return { stage: "tower", unitNumber: null, view: state.view };
      return { ...state, stage };
    }
    case "reset":
      return onyxDrilldownInitial();
    default:
      return state;
  }
}

/** Floor for a flat number: "1204" → 12. Mirrors onyx-units, kept local so the
 *  reducer has no import cycle with the unit catalogue. */
export function onyxFloorOfUnit(unitNumber: string): number | null {
  const digits = String(unitNumber ?? "").trim();
  if (!/^\d{3,}$/.test(digits)) return null;
  const floor = Number(digits.slice(0, -2));
  return Number.isFinite(floor) && floor >= 1 ? floor : null;
}

/** Breadcrumb trail for the current state — label plus the stage it returns to.
 *  The floor is passed in: the state does not carry one. */
export function onyxBreadcrumb(
  state: OnyxDrilldownState,
  floor: number,
): Array<{ stage: OnyxStage; label: string }> {
  const trail: Array<{ stage: OnyxStage; label: string }> = [{ stage: "tower", label: "Tower" }];
  if (state.stage !== "tower") trail.push({ stage: "floor", label: `Floor ${clampFloor(floor)}` });
  if (state.unitNumber && (state.stage === "flat" || state.stage === "room")) {
    trail.push({ stage: "flat", label: `Unit ${state.unitNumber}` });
  }
  if (state.stage === "room") trail.push({ stage: "room", label: state.view === "plan" ? "Plan" : "360° tour" });
  return trail;
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

export type OnyxFocus = {
  /** Scale factor applied to the render and the overlay together. */
  scale: number;
  /** transform-origin, in percent of the image box. */
  originX: number;
  originY: number;
  /** translate(), in percent of the UNSCALED image box. */
  translateX: number;
  translateY: number;
};

/** How much of the frame height one floor band should occupy once opened. */
const TARGET_BAND_FRACTION = 5;
/** Above ~3x the 1600px render starts to show its own pixels. Zoom is a sales
 *  aid, not a magnifier: cap it and let the plate panel carry the detail. */
const MAX_SCALE = 3.4;
const MIN_SCALE = 1.6;

/**
 * The angle the camera is being computed FOR.
 *
 * Every tower render has its own calibration, so a floor's band lives at
 * different image coordinates on each angle. The camera therefore has to be
 * told which angle is on screen — it may never reach for the angle-0 band map,
 * or drilling into a floor on a second angle would zoom to the wrong part of
 * the building. Structural on purpose: an `OnyxTowerView` satisfies it, and so
 * does any test double, without this module importing the view catalogue.
 */
export type OnyxFocusView = { byFloor: ReadonlyMap<number, OnyxFloorBand> };

export type OnyxFocusOptions = {
  /** Where in the frame the band centre should land, 0..1. Default dead centre. */
  focusX?: number;
  focusY?: number;
  /** Override the computed zoom (stage 3 and 4 push in slightly further). */
  scale?: number;
};

export const ONYX_FOCUS_NEUTRAL: OnyxFocus = {
  scale: 1,
  originX: 50,
  originY: 50,
  translateX: 0,
  translateY: 0,
};

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/**
 * The camera that opens `floor` in place, in `view`'s own band geometry.
 *
 * The band centre is clamped so the scaled image always covers the frame — a
 * pan that exposed the container background would read as a broken zoom.
 */
export function onyxFocusForFloor(
  floor: number,
  view: OnyxFocusView,
  opts: OnyxFocusOptions = {},
): OnyxFocus {
  const band = view.byFloor.get(clampFloor(floor));
  if (!band) return ONYX_FOCUS_NEUTRAL;

  const ys = band.points.map((p) => p.y);
  const bandHeight = Math.max(0.1, Math.max(...ys) - Math.min(...ys));
  const scale = clamp(opts.scale ?? TARGET_BAND_FRACTION / bandHeight, MIN_SCALE, MAX_SCALE);

  const fx = clamp(opts.focusX ?? 0.5, 0, 1);
  const fy = clamp(opts.focusY ?? 0.5, 0, 1);

  // Keep the visible window inside the image: the window is 100/scale percent
  // of the image in each axis, and fx/fy say how much of it sits before the
  // focus point.
  const span = 100 / scale;
  const cx = clamp(band.center.x, fx * span, 100 - (1 - fx) * span);
  const cy = clamp(band.center.y, fy * span, 100 - (1 - fy) * span);

  return {
    scale: +scale.toFixed(4),
    originX: +cx.toFixed(4),
    originY: +cy.toFixed(4),
    translateX: +(fx * 100 - cx).toFixed(4),
    translateY: +(fy * 100 - cy).toFixed(4),
  };
}

/** The focus for a whole state — one function so the component never branches. */
export function onyxFocusForState(
  state: OnyxDrilldownState,
  floor: number,
  view: OnyxFocusView,
  opts: OnyxFocusOptions = {},
): OnyxFocus {
  if (state.stage === "tower") return ONYX_FOCUS_NEUTRAL;
  const base = onyxFocusForFloor(floor, view, opts);
  // Stages 3 and 4 push in a touch further, so stepping in always reads as
  // movement even when stage 2 already hit the zoom cap.
  if (state.stage === "floor") return base;
  return onyxFocusForFloor(floor, view, { ...opts, scale: base.scale + 0.35 });
}

/** Ready-made CSS for a focus. Both layers get exactly this. */
export function onyxFocusStyle(focus: OnyxFocus): { transform: string; transformOrigin: string } {
  return {
    transform: `translate(${focus.translateX}%, ${focus.translateY}%) scale(${focus.scale})`,
    transformOrigin: `${focus.originX}% ${focus.originY}%`,
  };
}

/**
 * The rectangle of the image that is visible under a focus, in percent.
 * Used by the tests to prove the camera never pans off the render.
 */
export function onyxVisibleRect(focus: OnyxFocus): { x: number; y: number; w: number; h: number } {
  const w = 100 / focus.scale;
  const h = 100 / focus.scale;
  // The point of the image now at frame (0,0): invert p' = o + T + s(p - o).
  const x = focus.originX + (0 - focus.translateX - focus.originX) / focus.scale;
  const y = focus.originY + (0 - focus.translateY - focus.originY) / focus.scale;
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}
