"use strict";
/**
 * The 360 scenes the showcase screens can open, and how they connect.
 *
 * Every entry here must exist in public/showcase/panoramas/manifest.json,
 * which `scripts/gen-panoramas.mjs` writes. tests/panorama.test.ts enforces
 * that, so a scene can never be referenced by the UI without the image having
 * been generated.
 *
 * These panoramas are SCHEMATIC. They are ray-traced from the published floor
 * plan. Where the sheet legibly prints a room dimension the footprint is that
 * figure; where it does not, the footprint is the drawn proportion only and
 * the caption says the dimensions are to be confirmed.
 * Clear height, finishes, furniture and daylight are indicative. The viewer
 * watermarks every one of them so they are never mistaken for photography.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PANO_TOURS = void 0;
exports.panoTour = panoTour;
exports.allPanoScenes = allPanoScenes;
exports.onyxTourForUnit = onyxTourForUnit;
exports.serenityTourForPlot = serenityTourForPlot;
/** Matches the geometry convention baked into the generator. */
const DOOR_YAW = Math.PI;
const ARCH_YAW = Math.PI / 2;
/** Pins sit a touch below the horizon, where a doorway actually is. */
const PIN_PITCH = -0.09;
function door(target, label) {
    return { id: `door-${target}`, yaw: DOOR_YAW, pitch: PIN_PITCH, label, targetSceneId: target };
}
function arch(target, label) {
    return { id: `arch-${target}`, yaw: ARCH_YAW, pitch: PIN_PITCH, label, targetSceneId: target };
}
function scene(id, title, plan, hotspots, initialYaw = 0) {
    return { id, title, plan, image: `/showcase/panoramas/${id}.webp`, initialYaw, hotspots };
}
exports.PANO_TOURS = [
    {
        id: 'serenity-267-east',
        label: '267 sq yds east facing villa',
        source: "267 sq yds east facing triplex, total 3,715 Sft (G+2)",
        scenes: [
            scene('ser-267e-living', 'Living', 'Living, ground floor (double height) — dimensions to be confirmed', [
                door('ser-267e-master', 'Master bedroom'),
                arch('ser-267e-kitchen', 'Kitchen'),
            ]),
            scene('ser-267e-master', 'Master bedroom', 'Bedroom-2, first floor — dimensions to be confirmed', [
                door('ser-267e-living', 'Living'),
                arch('ser-267e-terrace', 'Terrace'),
            ]),
            scene('ser-267e-kitchen', 'Kitchen', 'Kitchen, ground floor — dimensions to be confirmed', [
                door('ser-267e-living', 'Living'),
            ]),
            scene('ser-267e-terrace', 'Terrace', 'Terrace, second floor — dimensions to be confirmed', [
                door('ser-267e-master', 'Master bedroom'),
            ]),
        ],
    },
    {
        id: 'onyx-unit-2',
        label: 'Unit 2 — 2,945 sq ft',
        source: 'Apartment plan, unit 2 — 2,945 SFT, east facing',
        scenes: [
            scene('onyx-u2-living', 'Living', `Living 13'-0" x 16'-9"`, [
                door('onyx-u2-master', 'Master bedroom'),
                arch('onyx-u2-kitchen', 'Kitchen'),
            ]),
            scene('onyx-u2-master', 'Master bedroom', `M.Bedroom 14'-5" x 12'-0"`, [
                door('onyx-u2-living', 'Living'),
            ]),
            scene('onyx-u2-kitchen', 'Kitchen', `Kitchen 8'-6" x 12'-0"`, [
                door('onyx-u2-living', 'Living'),
            ]),
        ],
    },
    {
        id: 'onyx-unit-3',
        label: 'Unit 3 — 2,032 sq ft',
        source: 'Apartment plan, unit 3 — 2,032 SFT, east facing',
        scenes: [
            scene('onyx-u3-living', 'Living', `Living 12'-0" x 12'-0"`, [
                door('onyx-u3-master', 'Master bedroom'),
                arch('onyx-u3-kitchen', 'Kitchen'),
            ]),
            scene('onyx-u3-master', 'Master bedroom', `Bedroom 12'-0" x 14'-7"`, [
                door('onyx-u3-living', 'Living'),
            ]),
            scene('onyx-u3-kitchen', 'Kitchen', `Kitchen 11'-5" x 10'-7"`, [
                door('onyx-u3-living', 'Living'),
            ]),
        ],
    },
];
function panoTour(id) {
    return exports.PANO_TOURS.find((t) => t.id === id);
}
/** Every scene across every tour, id -> scene. */
function allPanoScenes() {
    const m = new Map();
    for (const t of exports.PANO_TOURS)
        for (const s of t.scenes)
            m.set(s.id, s);
    return m;
}
/**
 * Which Onyx unit number maps to a generated tour.
 *
 * Only units 2 and 3 have panoramas so far — they are the two plans the client
 * asked to lead with. The other five fall back to the flat plan sheet, and the
 * UI says so rather than showing a stand-in.
 */
function onyxTourForUnit(unitNumber) {
    const suffix = unitNumber.trim().slice(-1);
    if (suffix === '2')
        return panoTour('onyx-unit-2');
    if (suffix === '3')
        return panoTour('onyx-unit-3');
    return undefined;
}
/**
 * Which Serenity villa type maps to a generated tour.
 *
 * The 267 sq yds east facing type is by far the most common on the master plan
 * (25 plots), so it is the one that was built first. Plots of any other size
 * get no tour until those types are generated too.
 */
function serenityTourForPlot(plotSqYds, facing) {
    if (plotSqYds !== 267)
        return undefined;
    if (facing && facing.toLowerCase() !== 'east')
        return undefined;
    return panoTour('serenity-267-east');
}
