"use strict";
/**
 * Onyx unit types — transcribed from the client's "3D APARTMENT PLANS" sheet
 * and the seven "APARTMENT PLAN-UNIT n" sheets.
 *
 * Every size, facing and room dimension below is printed on those sheets.
 * Nothing here is inferred except `bhk`, which is derived from the bedroom
 * count actually drawn on the plan (a multipurpose room counts as the half),
 * and only stated where the schedule supports it.
 *
 * The tower repeats one plate for all 35 floors, so a unit number carries its
 * type: "1204" is floor 12, position 4.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONYX_UNIT_PLANS_OVERVIEW = exports.ONYX_UNIT_TYPES = exports.ONYX_PLATE_LAYOUT = void 0;
exports.onyxUnitPosition = onyxUnitPosition;
exports.onyxUnitFloor = onyxUnitFloor;
exports.onyxUnitType = onyxUnitType;
/** The key-plan inset is identical on all seven sheets: three bands around a
 *  central core — 2·3·4 across the top, 1 and 5 flanking the middle, 7 and 6
 *  along the bottom. Column/row are 0-indexed on a 3x3 grid, centre = core. */
exports.ONYX_PLATE_LAYOUT = {
    2: { col: 0, row: 0 },
    3: { col: 1, row: 0 },
    4: { col: 2, row: 0 },
    1: { col: 0, row: 1 },
    5: { col: 2, row: 1 },
    7: { col: 0, row: 2 },
    6: { col: 2, row: 2 },
};
exports.ONYX_UNIT_TYPES = [
    {
        position: 1,
        sqFt: 2594,
        facing: "North",
        bhk: "3.5 BHK",
        planImage: "/showcase/onyx/unit-plan-1.webp",
        keyPlanNote: "West end of the plate, on the middle band beside the core.",
        rooms: [
            { name: "Drawing", dimensions: `13'-0" x 12'-6"` },
            { name: "Living", dimensions: `17'-2" x 12'-0"` },
            { name: "Dining", dimensions: `13'-0" x 12'-0"` },
            { name: "Master bedroom", dimensions: `13'-11" x 12'-0"` },
            { name: "Bedroom 2", dimensions: `15'-0" x 12'-0"` },
            { name: "Bedroom 3", dimensions: `14'-5" x 12'-0"` },
            { name: "Multipurpose room", dimensions: `10'-0" x 12'-0"` },
            { name: "Dress", dimensions: `8'-11" x 6'-0"` },
            { name: "Kitchen", dimensions: `8'-6" x 12'-0"` },
            { name: "Utility", dimensions: `8'-6" x 5'-11"` },
            { name: "Puja", dimensions: `4'-11" x 5'-6"` },
            { name: "Toilet", dimensions: `5'-6" x 9'-6"` },
            { name: "Toilet", dimensions: `8'-11" x 5'-6"` },
            { name: "Toilet", dimensions: `8'-11" x 5'-5"` },
            { name: "Sitout", dimensions: `6'-0" x 12'-0"` },
            { name: "Sitout", dimensions: `5'-10" x 12'-0"` },
        ],
    },
    {
        position: 2,
        sqFt: 2945,
        facing: "East",
        bhk: "3.5 BHK",
        planImage: "/showcase/onyx/unit-plan-2.webp",
        keyPlanNote: "North-west corner, at the left end of the top band.",
        rooms: [
            { name: "Drawing", dimensions: `12'-6" x 11'-5"` },
            { name: "Living", dimensions: `13'-0" x 16'-9"` },
            { name: "Dining", dimensions: `13'-0" x 16'-6"` },
            { name: "Master bedroom", dimensions: `14'-5" x 12'-0"` },
            { name: "Bedroom 2", dimensions: `13'-6" x 11'-0"` },
            { name: "Bedroom 3", dimensions: `12'-0" x 12'-2"` },
            { name: "Multipurpose room", dimensions: `13'-6" x 11'-0"` },
            { name: "Dress", dimensions: `8'-11" x 6'-0"` },
            { name: "Kitchen", dimensions: `8'-6" x 12'-0"` },
            { name: "Utility", dimensions: `8'-6" x 4'-6"` },
            { name: "Puja", dimensions: `4'-6" x 5'-0"` },
            { name: "Toilet", dimensions: `8'-6" x 4'-8"` },
            { name: "Toilet", dimensions: `8'-2" x 4'-11"` },
            { name: "Toilet", dimensions: `8'-6" x 4'-11"` },
            { name: "Toilet", dimensions: `8'-11" x 5'-5"` },
            { name: "Sitout", dimensions: `39'-6" x 5'-3"` },
            { name: "Sitout", dimensions: `5'-7" x 15'-11"` },
            { name: "Sitout", dimensions: `5'-10" x 12'-0"` },
        ],
    },
    {
        position: 3,
        sqFt: 2032,
        facing: "East",
        bhk: "3 BHK",
        planImage: "/showcase/onyx/unit-plan-3.webp",
        keyPlanNote: "Centre of the top band, directly above the core.",
        rooms: [
            { name: "Living", dimensions: `12'-0" x 12'-0"` },
            { name: "Dining", dimensions: `11'-0" x 17'-7"` },
            { name: "Bedroom", dimensions: `12'-0" x 14'-7"` },
            { name: "Bedroom", dimensions: `12'-0" x 11'-0"` },
            { name: "Bedroom", dimensions: `11'-5" x 11'-0"` },
            { name: "Dress", dimensions: `5'-5" x 8'-0"` },
            { name: "Kitchen", dimensions: `11'-5" x 10'-7"` },
            { name: "Utility", dimensions: `11'-0" x 4'-11"` },
            { name: "Toilet", dimensions: `4'-11" x 11'-0"` },
            { name: "Toilet", dimensions: `5'-5" x 9'-0"` },
            { name: "Toilet", dimensions: `6'-0" x 8'-0"` },
            { name: "Sitout", dimensions: `35'-6" x 5'-9"` },
        ],
    },
    {
        position: 4,
        sqFt: 2405,
        facing: "West",
        bhk: "3 BHK",
        planImage: "/showcase/onyx/unit-plan-4.webp",
        keyPlanNote: "North-east corner, at the right end of the top band.",
        rooms: [
            { name: "Living", dimensions: `18'-7" x 13'-0"` },
            { name: "Dining", dimensions: `18'-3" x 13'-0"` },
            { name: "Master bedroom", dimensions: `13'-0" x 14'-0"` },
            { name: "Bedroom 2", dimensions: `12'-0" x 12'-0"` },
            { name: "Bedroom 3", dimensions: `12'-2" x 12'-0"` },
            { name: "Dress", dimensions: `12'-6" x 6'-0"` },
            { name: "Dress", dimensions: `6'-1" x 3'-5"` },
            { name: "Kitchen", dimensions: `10'-4" x 14'-0"` },
            { name: "Utility", dimensions: `4'-3" x 11'-7"` },
            { name: "Store", dimensions: `7'-5" x 4'-0"` },
            { name: "Puja" },
            { name: "Toilet", dimensions: `5'-7" x 8'-0"` },
            { name: "Toilet", dimensions: `5'-7" x 9'-0"` },
            { name: "Toilet", dimensions: `8'-0" x 7'-5"` },
            { name: "Sitout", dimensions: `24'-10" x 4'-3"` },
            { name: "Sitout", dimensions: `4'-3" x 14'-6"` },
        ],
    },
    {
        position: 5,
        sqFt: 2457,
        facing: "West",
        bhk: "3 BHK",
        planImage: "/showcase/onyx/unit-plan-5.webp",
        keyPlanNote: "East end of the plate, on the middle band beside the core.",
        rooms: [
            { name: "Drawing", dimensions: `12'-9" x 13'-0"` },
            { name: "Living / dining", dimensions: `24'-2" x 13'-0"` },
            { name: "Master bedroom", dimensions: `16'-0" x 13'-0"` },
            { name: "Bedroom 2", dimensions: `12'-0" x 13'-10"` },
            { name: "Bedroom 3", dimensions: `12'-3" x 13'-10"` },
            { name: "Dress", dimensions: `8'-11" x 6'-11"` },
            { name: "Kitchen", dimensions: `10'-10" x 13'-0"` },
            { name: "Utility", dimensions: `5'-10" x 13'-0"` },
            { name: "Puja", dimensions: `2'-11" x 3'-9"` },
            { name: "Toilet", dimensions: `5'-7" x 8'-11"` },
            { name: "Toilet", dimensions: `5'-6" x 11'-4"` },
            { name: "Toilet", dimensions: `8'-11" x 5'-6"` },
            { name: "Sitout", dimensions: `5'-10" x 13'-10"` },
            { name: "Sitout", dimensions: `5'-10" x 13'-0"` },
        ],
    },
    {
        position: 6,
        sqFt: 2529,
        facing: "West",
        bhk: "3 BHK",
        planImage: "/showcase/onyx/unit-plan-6.webp",
        keyPlanNote: "South-east corner, at the right end of the bottom band.",
        rooms: [
            { name: "Drawing", dimensions: `12'-9" x 13'-0"` },
            { name: "Living / dining", dimensions: `24'-2" x 13'-0"` },
            { name: "Master bedroom", dimensions: `16'-0" x 14'-0"` },
            { name: "Bedroom 2", dimensions: `12'-0" x 14'-0"` },
            { name: "Bedroom 3", dimensions: `12'-3" x 14'-0"` },
            { name: "Dress", dimensions: `8'-11" x 7'-5"` },
            { name: "Kitchen", dimensions: `10'-10" x 14'-0"` },
            { name: "Utility", dimensions: `5'-10" x 14'-0"` },
            { name: "Puja", dimensions: `2'-11" x 3'-9"` },
            { name: "Toilet", dimensions: `5'-7" x 8'-11"` },
            { name: "Toilet", dimensions: `5'-6" x 11'-6"` },
            { name: "Toilet", dimensions: `8'-11" x 6'-0"` },
            { name: "Sitout", dimensions: `5'-10" x 14'-0"` },
            { name: "Sitout", dimensions: `5'-10" x 13'-0"` },
        ],
    },
    {
        position: 7,
        sqFt: 2571,
        facing: "East",
        bhk: "3 BHK",
        planImage: "/showcase/onyx/unit-plan-7.webp",
        keyPlanNote: "South-west corner, at the left end of the bottom band.",
        rooms: [
            { name: "Drawing", dimensions: `13'-7" x 17'-5"` },
            { name: "Living / dining", dimensions: `32'-7" x 12'-0"` },
            { name: "Master bedroom", dimensions: `15'-0" x 12'-1"` },
            { name: "Bedroom 2", dimensions: `13'-0" x 12'-0"` },
            { name: "Bedroom 3", dimensions: `13'-0" x 12'-0"` },
            { name: "Dress", dimensions: `8'-0" x 5'-0"` },
            { name: "Kitchen", dimensions: `10'-4" x 9'-11"` },
            { name: "Utility", dimensions: `10'-4" x 5'-0"` },
            { name: "Puja", dimensions: `4'-3" x 6'-4"` },
            { name: "Toilet", dimensions: `5'-6" x 9'-6"` },
            { name: "Toilet", dimensions: `5'-6" x 9'-6"` },
            { name: "Toilet", dimensions: `8'-0" x 6'-0"` },
            { name: "Sitout", dimensions: `5'-10" x 12'-0"` },
            { name: "Sitout", dimensions: `4'-7" x 11'-11"` },
            { name: "Sitout", dimensions: `15'-0" x 2'-10"` },
        ],
    },
];
/** The combined "3D APARTMENT PLANS" reference sheet for all seven units. */
exports.ONYX_UNIT_PLANS_OVERVIEW = "/showcase/onyx/apartment-plans-overview.webp";
/** Position on the plate for a flat number: "1204" → 4, "0101" → 1. */
function onyxUnitPosition(unitNumber) {
    const digits = String(unitNumber ?? "").trim();
    if (!/^\d{3,}$/.test(digits))
        return null;
    const pos = Number(digits.slice(-2));
    return pos >= 1 && pos <= 7 ? pos : null;
}
/** Floor for a flat number: "1204" → 12, "0101" → 1. Null if unreadable. */
function onyxUnitFloor(unitNumber) {
    const digits = String(unitNumber ?? "").trim();
    if (!/^\d{3,}$/.test(digits))
        return null;
    const floor = Number(digits.slice(0, -2));
    return floor >= 1 ? floor : null;
}
/** The unit type behind a flat number, e.g. "1204" → the position-4 type. */
function onyxUnitType(unitNumber) {
    const pos = onyxUnitPosition(unitNumber);
    // A number with no readable floor ("0004") is not a flat in this tower.
    if (!pos || onyxUnitFloor(unitNumber) === null)
        return undefined;
    return exports.ONYX_UNIT_TYPES.find((t) => t.position === pos);
}
