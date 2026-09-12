"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONYX_CONTEXT_VIEWS = exports.ONYX_TURNTABLE_STEP_DEG = exports.ONYX_TURNTABLE_UNAVAILABLE_NOTE = exports.ONYX_TURNTABLE_AVAILABLE = exports.ONYX_TOWER_VIEWS = exports.ONYX_TOWER_VIEW_INPUTS = void 0;
exports.loadOnyxTowerViews = loadOnyxTowerViews;
exports.onyxViewIndexForAzimuth = onyxViewIndexForAzimuth;
exports.onyxStepViewIndex = onyxStepViewIndex;
exports.onyxNeighbourViewIndexes = onyxNeighbourViewIndexes;
const onyx_tower_map_1 = require("./onyx-tower-map");
/** Build the runtime view (geometry included) from a plain descriptor. */
function makeView(input) {
    const bands = Object.freeze((0, onyx_tower_map_1.buildOnyxFloorBands)(input.fit, input.image, onyx_tower_map_1.ONYX_FLOORS));
    return {
        ...input,
        bands,
        byFloor: new Map(bands.map((b) => [b.floor, b])),
    };
}
/** Sort by azimuth and reject duplicates, so the turntable order is the ring order. */
function loadOnyxTowerViews(inputs) {
    const seen = new Set();
    const ordered = [...inputs]
        .map((v) => ({ ...v, azimuthDeg: ((v.azimuthDeg % 360) + 360) % 360 }))
        .sort((a, b) => a.azimuthDeg - b.azimuthDeg)
        .filter((v) => {
        const key = Math.round(v.azimuthDeg * 10);
        if (seen.has(key))
            return false;
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
exports.ONYX_TOWER_VIEW_INPUTS = [
    {
        id: "tower-000",
        azimuthDeg: 0,
        label: "Three-quarter aerial",
        image: onyx_tower_map_1.ONYX_TOWER_IMAGE,
        fit: onyx_tower_map_1.ONYX_TOWER_FIT,
        alt: "Glentree Onyx — aerial view of the tower, podium and the metro line",
    },
];
exports.ONYX_TOWER_VIEWS = Object.freeze(loadOnyxTowerViews(exports.ONYX_TOWER_VIEW_INPUTS));
/** True only when there is something to rotate between. Gates the whole control. */
exports.ONYX_TURNTABLE_AVAILABLE = exports.ONYX_TOWER_VIEWS.length > 1;
/** Shown instead of a dead rotate button. Says the true reason, in client-safe words. */
exports.ONYX_TURNTABLE_UNAVAILABLE_NOTE = "Rotation is ready in the interface but needs the renders: only one full-tower angle has been supplied so far. " +
    "Add a matched set of angles (same camera height, distance and lens) and the tower turns.";
/* ------------------------------------------------------------------ */
/* Angle arithmetic                                                    */
/* ------------------------------------------------------------------ */
/** Nearest view index to an azimuth, wrapping across 360/0. */
function onyxViewIndexForAzimuth(deg, views = exports.ONYX_TOWER_VIEWS) {
    if (views.length === 0)
        return -1;
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
function onyxStepViewIndex(index, by, count = exports.ONYX_TOWER_VIEWS.length) {
    if (count <= 0)
        return -1;
    return ((index + by) % count + count) % count;
}
/**
 * The indexes worth having decoded before the user gets there: the current one
 * and its two neighbours. Capped at three images regardless of set size, which
 * is what keeps memory flat on a 16- or 36-angle set.
 */
function onyxNeighbourViewIndexes(index, count = exports.ONYX_TOWER_VIEWS.length) {
    if (count <= 0)
        return [];
    if (count === 1)
        return [0];
    if (count === 2)
        return [0, 1];
    return [index, onyxStepViewIndex(index, 1, count), onyxStepViewIndex(index, -1, count)];
}
/** Average angular step of the supplied set, for the scrubber's tick spacing. */
exports.ONYX_TURNTABLE_STEP_DEG = exports.ONYX_TOWER_VIEWS.length > 1 ? 360 / exports.ONYX_TOWER_VIEWS.length : 0;
/**
 * These two are real additional viewpoints of the project, and worth showing —
 * but neither shows the whole tower, so neither can carry floor hotspots and
 * neither is part of the turntable. The UI must label them as such.
 */
exports.ONYX_CONTEXT_VIEWS = Object.freeze([
    {
        id: "arrival",
        label: "Arrival",
        caption: "Ground level: the entrance forecourt and podium. Not part of the rotation — the tower above is out of frame.",
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
        caption: "Close aerial of the podium amenity deck and sky garden. Not part of the rotation — only the podium levels are in frame.",
        src: "/showcase/onyx/hero-aerial.webp",
        width: 942,
        height: 504,
        alt: "Glentree Onyx — podium amenity deck and sky garden from above",
    },
]);
