"use strict";
/**
 * Published villa types for Glentree Serenity.
 *
 * Every figure below is read off the client's own villa-type sheets (plot size,
 * facing, "Total Build Up Area" and the Ground / First / Second area statement).
 * Only five sheets exist — 200 East, 267 East, 267 West, 300 East, 300 West —
 * so those are the only sizes for which a built-up area may ever be shown.
 * A 200 sq yd WEST sheet was not supplied; that combination is deliberately
 * absent rather than guessed from the East sheet.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLISHED_PLOT_SIZES = exports.VILLA_TYPES = void 0;
exports.isPublishedPlotSize = isPublishedPlotSize;
exports.villaTypeFor = villaTypeFor;
exports.villaTypeByKey = villaTypeByKey;
exports.VILLA_TYPES = [
    {
        key: "200-east",
        plotSqYds: 200,
        facing: "East",
        totalSqFt: 2876,
        floors: { ground: 1246, first: 1246, second: 384 },
        planImage: "/showcase/serenity/villa-plan-200-east.webp",
        heroImage: "/showcase/serenity/villa-elevation.webp",
        bhk: "3 BHK triplex",
    },
    {
        key: "267-east",
        plotSqYds: 267,
        facing: "East",
        totalSqFt: 3715,
        floors: { ground: 1455, first: 1404, second: 856 },
        planImage: "/showcase/serenity/villa-plan-267-east.webp",
        heroImage: "/showcase/serenity/villa-elevation-267.webp",
        bhk: "4 BHK triplex",
    },
    {
        key: "267-west",
        plotSqYds: 267,
        facing: "West",
        totalSqFt: 3665,
        floors: { ground: 1410, first: 1399, second: 856 },
        planImage: "/showcase/serenity/villa-plan-267-west.webp",
        heroImage: "/showcase/serenity/villa-elevation-267.webp",
        bhk: "4 BHK triplex",
    },
    {
        key: "300-east",
        plotSqYds: 300,
        facing: "East",
        totalSqFt: 4277,
        floors: { ground: 1697, first: 1627, second: 953 },
        planImage: "/showcase/serenity/villa-plan-300-east.webp",
        heroImage: "/showcase/serenity/villa-elevation-300.webp",
        bhk: "4 BHK triplex",
    },
    {
        key: "300-west",
        plotSqYds: 300,
        facing: "West",
        totalSqFt: 4274,
        floors: { ground: 1645, first: 1613, second: 1016 },
        planImage: "/showcase/serenity/villa-plan-300-west.webp",
        heroImage: "/showcase/serenity/villa-elevation-300.webp",
        bhk: "4 BHK triplex",
    },
];
/** The plot sizes that actually have a published sheet. */
exports.PUBLISHED_PLOT_SIZES = [200, 267, 300];
function isPublishedPlotSize(plotSqYds) {
    return exports.PUBLISHED_PLOT_SIZES.includes(plotSqYds);
}
/**
 * Match a plot on the master plan to a published villa type.
 *
 * The plan carries 51 distinct plot sizes from 162 to 573 sq yds, so most plots
 * are NOT 200 / 267 / 300. For those this returns the nearest published type
 * with `exact: false` — an indicative reference elevation and layout, never a
 * built-up area that can be quoted for that plot. Ties go to the smaller type.
 * With no `facing` given the East sheet is used, East being the published
 * default; a 200 sq yd West plot also falls back to the 200 East sheet, marked
 * inexact, because no 200 West sheet was supplied.
 */
function villaTypeFor(plotSqYds, facing) {
    if (typeof plotSqYds !== "number" || !Number.isFinite(plotSqYds) || plotSqYds <= 0)
        return null;
    // Nearest published plot size first; ties go to the smaller size.
    let size = exports.VILLA_TYPES[0].plotSqYds;
    for (const t of exports.VILLA_TYPES) {
        const d = Math.abs(plotSqYds - t.plotSqYds);
        const bd = Math.abs(plotSqYds - size);
        if (d < bd || (d === bd && t.plotSqYds < size))
            size = t.plotSqYds;
    }
    // Then the requested facing at that size, falling back to whatever sheet exists.
    const want = facing === "West" ? "West" : "East";
    const atSize = exports.VILLA_TYPES.filter((t) => t.plotSqYds === size);
    const best = atSize.find((t) => t.facing === want) ?? atSize[0];
    const exact = best.plotSqYds === plotSqYds && (facing == null || facing === undefined || best.facing === facing);
    return { type: best, exact, deltaSqYds: plotSqYds - best.plotSqYds };
}
function villaTypeByKey(key) {
    return exports.VILLA_TYPES.find((t) => t.key === key);
}
