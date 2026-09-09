/**
 * Glentree Onyx — the ordered set of tower camera angles (the "turntable"),
 * plus the uncalibrated context stills that sit beside it.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The client asked to be able to rotate the building. Rotating a photoreal
 * building honestly means one render per camera angle, shot from a fixed
 * elevation/distance/lens. Exactly ONE full-tower render exists today
 * (tower.webp), so this module currently holds ONE view — and the UI is
 * required to hide the rotate control while that is true, because a rotate
 * affordance that cannot rotate is worse than none.
 *
 * Everything else is built: the type, the loader, the per-view floor geometry,
 * the neighbour lookup used for preloading, and the angle arithmetic. Dropping
 * in real angles is a data edit here plus one run of the derive script per
 * image — see docs/onyx-tower-renders.md.
 *
 * IMPORTANT: do not synthesise extra angles by mirroring, warping or
 * generating them. This tower is being sold to buyers off these images; a
 * fabricated elevation is a misrepresentation, not a placeholder.
 */

import {
  ONYX_FLOORS,
  ONYX_TOWER_FIT,
  ONYX_TOWER_IMAGE,
  buildOnyxFloorBands,
  type OnyxFloorBand,
  type OnyxTowerFit,
  type OnyxTowerImage,
} from "./onyx-tower-map";

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

export type OnyxTowerViewInput = {
  /** Stable id, also the file stem the derive script expects: `tower-000`. */
  id: string;
  /**
   * Camera azimuth in degrees, 0..360, increasing clockwise as seen from
   * above. 0 is defined as the angle of the existing marketing render; every
   * later angle is measured relative to it, so the numbers stay meaningful
   * without knowing the building's true north.
   */
  azimuthDeg: number;
  /** Short human label, e.g. "Three-quarter aerial". No vendor names. */
  label: string;
  image: OnyxTowerImage;
  /** The calibration for THIS image. One fit per angle — never shared. */
  fit: OnyxTowerFit;
  /** Alt text for the image at this angle. */
  alt: string;
};

export type OnyxTowerView = OnyxTowerViewInput & {
  /** Floor quads for this angle, in percent of this angle's image. */
  bands: readonly OnyxFloorBand[];
  byFloor: ReadonlyMap<number, OnyxFloorBand>;
};

/** Build the runtime view (geometry included) from a plain descriptor. */
function makeView(input: OnyxTowerViewInput): OnyxTowerView {
  const bands = Object.freeze(buildOnyxFloorBands(input.fit, input.image, ONYX_FLOORS));
  return {
    ...input,
    bands,
    byFloor: new Map(bands.map((b) => [b.floor, b])),
  };
}

/** Sort by azimuth and reject duplicates, so the turntable order is the ring order. */
export function loadOnyxTowerViews(inputs: readonly OnyxTowerViewInput[]): OnyxTowerView[] {
  const seen = new Set<number>();
  const ordered = [...inputs]
    .map((v) => ({ ...v, azimuthDeg: ((v.azimuthDeg % 360) + 360) % 360 }))
    .sort((a, b) => a.azimuthDeg - b.azimuthDeg)
    .filter((v) => {
      const key = Math.round(v.azimuthDeg * 10);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return ordered.map(makeView);
}

/* ------------------------------------------------------------------ */
/* The views we actually have                                          */
/* ------------------------------------------------------------------ */

/**
 * TODAY: one angle. To add more, append descriptors here — one per render,
 * each with its own `fit` printed by
 *   node scripts/derive-onyx-tower-map.mjs public/showcase/onyx/tower-045.webp --check /tmp/a45.png
 * and each verified against that check PNG by eye before it ships.
 */
export const ONYX_TOWER_VIEW_INPUTS: readonly OnyxTowerViewInput[] = [
  {
    id: "tower-000",
    azimuthDeg: 0,
    label: "Three-quarter aerial",
    image: ONYX_TOWER_IMAGE,
    fit: ONYX_TOWER_FIT,
    alt: "Glentree Onyx — aerial view of the tower, podium and the metro line",
  },
];

export const ONYX_TOWER_VIEWS: readonly OnyxTowerView[] = Object.freeze(
  loadOnyxTowerViews(ONYX_TOWER_VIEW_INPUTS),
);

/** True only when there is something to rotate between. Gates the whole control. */
export const ONYX_TURNTABLE_AVAILABLE = ONYX_TOWER_VIEWS.length > 1;

/** Shown instead of a dead rotate button. Says the true reason, in client-safe words. */
export const ONYX_TURNTABLE_UNAVAILABLE_NOTE =
  "Rotation is ready in the interface but needs the renders: only one full-tower angle has been supplied so far. " +
  "Add a matched set of angles (same camera height, distance and lens) and the tower turns.";

/* ------------------------------------------------------------------ */
/* Angle arithmetic                                                    */
/* ------------------------------------------------------------------ */

/** Nearest view index to an azimuth, wrapping across 360/0. */
export function onyxViewIndexForAzimuth(deg: number, views = ONYX_TOWER_VIEWS): number {
  if (views.length === 0) return -1;
  const a = ((deg % 360) + 360) % 360;
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < views.length; i++) {
    const raw = Math.abs(views[i].azimuthDeg - a);
    const d = Math.min(raw, 360 - raw);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Step `by` places around the ring (wrapping). */
export function onyxStepViewIndex(index: number, by: number, count = ONYX_TOWER_VIEWS.length): number {
  if (count <= 0) return -1;
  return ((index + by) % count + count) % count;
}

/**
 * The indexes worth having decoded before the user gets there: the current one
 * and its two neighbours. Capped at three images regardless of set size, which
 * is what keeps memory flat on a 16- or 36-angle set.
 */
export function onyxNeighbourViewIndexes(index: number, count = ONYX_TOWER_VIEWS.length): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  if (count === 2) return [0, 1];
  return [index, onyxStepViewIndex(index, 1, count), onyxStepViewIndex(index, -1, count)];
}

/** Average angular step of the supplied set, for the scrubber's tick spacing. */
export const ONYX_TURNTABLE_STEP_DEG =
  ONYX_TOWER_VIEWS.length > 1 ? 360 / ONYX_TOWER_VIEWS.length : 0;

/* ------------------------------------------------------------------ */
/* Context stills — genuine extra viewpoints, NOT rotation             */
/* ------------------------------------------------------------------ */

export type OnyxContextView = {
  id: string;
  label: string;
  /** One line under the image saying exactly what it shows. */
  caption: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  /**
   * Fraction of the image height to crop off the TOP when displaying it.
   * Used only to remove a marketing overlay baked into the source file; the
   * photography itself is never altered.
   */
  cropTop?: number;
  /** Why the crop exists, so nobody "fixes" it back. */
  cropReason?: string;
};

/**
 * These two are real additional viewpoints of the project, and worth showing —
 * but neither shows the whole tower, so neither can carry floor hotspots and
 * neither is part of the turntable. The UI must label them as such.
 */
export const ONYX_CONTEXT_VIEWS: readonly OnyxContextView[] = Object.freeze([
  {
    id: "arrival",
    label: "Arrival",
    caption:
      "Ground level: the entrance forecourt and podium. Not part of the rotation — the tower above is out of frame.",
    src: "/showcase/onyx/hero-arrival.webp",
    width: 1920,
    height: 1004,
    alt: "Glentree Onyx — entrance forecourt and podium at dusk",
    // The supplied file has a four-column marketing stats bar composited over
    // the top of the frame. Everything above y≈236 px is that card and sky, so
    // cropping 23.5% off the top removes it cleanly without touching the
    // building, the podium or the forecourt. Cropping is done at display time;
    // the delivered file is left untouched.
    cropTop: 0.235,
    cropReason: "removes the marketing stats bar composited into the supplied file",
  },
  {
    id: "amenity",
    label: "Amenity deck",
    caption:
      "Close aerial of the podium amenity deck and sky garden. Not part of the rotation — only the podium levels are in frame.",
    src: "/showcase/onyx/hero-aerial.webp",
    width: 942,
    height: 504,
    alt: "Glentree Onyx — podium amenity deck and sky garden from above",
  },
]);
