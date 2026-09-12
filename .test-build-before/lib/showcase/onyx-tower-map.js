"use strict";
/**
 * Glentree Onyx — floor map for the photoreal tower render.
 *
 * The showcase presents the building as the marketing render
 * (`public/showcase/onyx/tower.webp`, 1600x960) rather than a procedural 3D
 * massing. This module turns "floor 17" into a quadrilateral that sits on the
 * real façade in that image, so an SVG overlay can make every floor clickable.
 *
 * ------------------------------------------------------------------
 * HOW THE NUMBERS BELOW WERE DERIVED  (see scripts/derive-onyx-tower-map.mjs)
 * ------------------------------------------------------------------
 * 1. FLOOR PITCH. A Sobel-Y edge profile of the wide right-hand façade
 *    (x 640..800) was averaged across the strip and peak-picked with a rolling
 *    median baseline. Each floor prints two lines in the render (slab edge and
 *    balcony railing, ~9 px apart), so peaks were merged at 3.5 px and the
 *    surviving lines are one per floor. A clean run of 19 consecutive lines
 *    (y 91.0 .. 423.7) seeded a quadratic fit y(k) = A + Bk + Ck², which was
 *    then re-snapped to the detected peaks and refitted five times.
 *      A = 91.376853, B = 19.050148, C = -0.027300
 *      26 of 35 lines matched a detected peak; max residual 3.37 px, RMS 1.40 px.
 *    The taper is real and the right way round for an aerial view: the top of
 *    the tower is nearer the camera, so the pitch FALLS from 19.02 px at the
 *    top to 17.22 px at the bottom. A linear model is wrong by ~15 px at the
 *    ends, which is most of a floor.
 *
 * 2. HOW MANY BANDS. The fit puts slab lines at y 91.4 (the top level, the one
 *    with the louvred plant screen, immediately under the crown) down to
 *    y 707.5 (the lowest level, sitting on the podium deck) — 34 intervals.
 *    The render therefore depicts 34 levels, but the sales inventory has 35
 *    residential floors. We keep the two endpoints exactly (floor 35 is the top
 *    band under the crown, floor 1 the bottom band above the podium) and divide
 *    the same span into 35 perspective-correct bands. That costs at most half a
 *    band (~8.8 px in image space, ~4 px at the size the render is displayed)
 *    of drift against the painted slab lines near mid-height; the alternative —
 *    keeping the painted pitch — would run floor 1 below the podium. See
 *    ONYX_TOWER_MAP_NOTE, which is surfaced to the client as a decision.
 *
 * 3. PERSPECTIVE OF THE FLOOR LINES. The bands are not horizontal. A sheared
 *    Sobel accumulation (maximising profile contrast over a slope sweep) gives
 *    dy/dx = -0.045 at y≈200, -0.080 at y≈400, -0.110 at y≈575. Those three
 *    slopes are consistent with a single horizontal vanishing point at
 *    (6490, -60), which is what the model uses: every floor line is the line
 *    through (720, yRef) and that vanishing point.
 *
 * 4. THE FAÇADE IS A SLANTED QUAD. The left boundary is the vertical corner
 *    between the narrow and wide wings; a sheared vertical-Sobel sweep put it
 *    at x ≈ 620 + 0.0333·(y - 100). The right silhouette is close to vertical,
 *    x ≈ 808 + 0.0150·(y - 100). Both were then checked against the rendered
 *    overlay and nudged so the bands hug the building instead of floating.
 *
 * TO RE-DERIVE after a new render: run
 *   node scripts/derive-onyx-tower-map.mjs --check /tmp/onyx-check.png
 * which re-detects the peaks, refits, prints the residual, and writes an
 * annotated PNG. Look at that PNG before trusting anything here.
 *
 * Everything exported is expressed in PERCENT of the image, so the overlay
 * scales with whatever size the <img> is rendered at.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONYX_FLOOR_TONE_COLOR = exports.ONYX_FLOOR_BANDS = exports.ONYX_TOWER_MAP_NOTE = exports.ONYX_TOWER_FIT = exports.ONYX_FLOORS = exports.ONYX_TOWER_IMAGE = void 0;
exports.buildOnyxFloorBands = buildOnyxFloorBands;
exports.onyxFloorBand = onyxFloorBand;
exports.onyxFloorTone = onyxFloorTone;
exports.onyxFloorColor = onyxFloorColor;
/** The render this map is calibrated against. */
exports.ONYX_TOWER_IMAGE = {
    src: "/showcase/onyx/tower.webp",
    width: 1600,
    height: 960,
};
/** Residential floors in the sales inventory. */
exports.ONYX_FLOORS = 35;
/** Fit parameters. Keep these together — they are one calibration, not five. */
exports.ONYX_TOWER_FIT = {
    /** y(k) = a + b·k + c·k² at the reference column, for k = 0 (top) .. 34. */
    a: 91.376853,
    b: 19.050148,
    c: -0.0273,
    /** Column the quadratic is measured at (centre of the sampled strip). */
    refX: 720,
    /** Intervals the detected lines actually span (34), vs the 35 we draw. */
    detectedIntervals: 34,
    /** Horizontal vanishing point shared by every floor line. */
    vanishX: 6490,
    vanishY: -60,
    /** Left corner of the wide façade: x = leftX0 + leftSlope·(y - 100). */
    leftX0: 620,
    leftSlope: 0.0333,
    /** Right silhouette: x = rightX0 + rightSlope·(y - 100). */
    rightX0: 808,
    rightSlope: 0.015,
    /** Worst residual of the fit against a detected edge peak, in pixels. */
    maxResidualPx: 3.37,
    rmsResidualPx: 1.4,
};
/**
 * Worth saying out loud on a call: the render shows 34 slab levels, the
 * inventory sells 35 floors.
 */
exports.ONYX_TOWER_MAP_NOTE = "The render depicts 34 slab levels between the crown and the podium; the inventory sells 35 residential floors. " +
    "The overlay pins floor 35 to the top level and floor 1 to the lowest, and divides the stack into 35 equal bands.";
/**
 * Turn one calibration into one quad per floor, in percent of that image.
 *
 * This is deliberately parameterised rather than closed over the single
 * measured fit: a turntable needs the same maths run per camera angle, and the
 * only thing that changes between angles is the fit and the image size. See
 * src/lib/showcase/onyx-tower-views.ts.
 */
function buildOnyxFloorBands(fit, image, floors = exports.ONYX_FLOORS) {
    const F = fit;
    const pctX = 100 / image.width;
    const pctY = 100 / image.height;
    /** y of boundary line `i` (0 = top of the top floor … `floors` = base) at refX. */
    const lineYRef = (i) => {
        const k = (i * F.detectedIntervals) / floors;
        return F.a + F.b * k + F.c * k * k;
    };
    /** Slope of a floor line through (refX, y), from the horizontal vanishing point. */
    const lineSlope = (y) => (F.vanishY - y) / (F.vanishX - F.refX);
    const leftEdgeX = (y) => F.leftX0 + F.leftSlope * (y - 100);
    const rightEdgeX = (y) => F.rightX0 + F.rightSlope * (y - 100);
    /**
     * Where boundary line `i` meets an edge. The edge x depends on y and y depends
     * on x, so iterate — it converges in two steps, four is free insurance.
     */
    const meet = (i, edge, seed) => {
        const y0 = lineYRef(i);
        const slope = lineSlope(y0);
        let x = seed;
        let y = y0;
        for (let n = 0; n < 4; n++) {
            y = y0 + slope * (x - F.refX);
            x = edge(y);
        }
        return { x, y };
    };
    const bands = [];
    for (let i = 0; i < floors; i++) {
        const floor = floors - i; // band 0 is the top of the tower
        const tl = meet(i, leftEdgeX, F.leftX0);
        const tr = meet(i, rightEdgeX, F.rightX0);
        const br = meet(i + 1, rightEdgeX, F.rightX0);
        const bl = meet(i + 1, leftEdgeX, F.leftX0);
        const points = [tl, tr, br, bl].map((p) => ({
            x: +(p.x * pctX).toFixed(4),
            y: +(p.y * pctY).toFixed(4),
        }));
        bands.push({
            floor,
            points,
            polygon: points.map((p) => `${p.x},${p.y}`).join(" "),
            center: {
                x: +((points[0].x + points[1].x + points[2].x + points[3].x) / 4).toFixed(4),
                y: +((points[0].y + points[1].y + points[2].y + points[3].y) / 4).toFixed(4),
            },
        });
    }
    return bands;
}
exports.ONYX_FLOOR_BANDS = Object.freeze(buildOnyxFloorBands(exports.ONYX_TOWER_FIT, exports.ONYX_TOWER_IMAGE));
const BY_FLOOR = new Map(exports.ONYX_FLOOR_BANDS.map((b) => [b.floor, b]));
function onyxFloorBand(floor) {
    return BY_FLOOR.get(floor);
}
/** Hex colours mirroring the STATUS_META strokes used elsewhere in the showcase. */
exports.ONYX_FLOOR_TONE_COLOR = {
    empty: "#64748b",
    sold: "#f87171",
    limited: "#818cf8",
    mostly: "#fbbf24",
    available: "#34d399",
};
/**
 * Aggregate a floor's sale status into a band tone.
 * `open` is the count of units still sellable, `total` the units on the floor.
 */
function onyxFloorTone(open, total) {
    if (!Number.isFinite(total) || total <= 0)
        return "empty";
    const o = Math.max(0, Math.min(open, total));
    if (o === 0)
        return "sold";
    if (o === total)
        return "available";
    return o / total >= 0.5 ? "mostly" : "limited";
}
/** Convenience: floor availability straight to a hex colour. */
function onyxFloorColor(open, total) {
    return exports.ONYX_FLOOR_TONE_COLOR[onyxFloorTone(open, total)];
}
