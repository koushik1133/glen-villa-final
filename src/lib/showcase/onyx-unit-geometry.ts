/**
 * ROOM GEOMETRY FOR THE 3D CUTAWAY
 *
 * The room *sizes* in onyx-units.ts are printed on the approved plan sheets.
 * What those sheets also carry, and the data did not, is where each room sits
 * relative to the others — and without that you cannot draw a home, only a list
 * of rectangles.
 *
 * Every rectangle below was read off the sheet in `planImage` for that unit and
 * transcribed by hand. Origin is the top-left (north-west) corner of the slab,
 * x runs east, y runs south, both in feet, matching the plan's own orientation
 * and its north arrow.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is a faithful transcription of the drawn layout: the adjacencies, the
 * bands, and the footprint of each room are what the architect drew. It is not
 * a survey. Dimensions are the printed ones; positions are read to the nearest
 * few inches, because a scale drawing read by eye cannot be more honest than
 * that. Nothing here is generated, inferred or packed by an algorithm — an
 * auto-arranged floor plan would look plausible and be fiction, which is worse
 * than showing the sheet itself.
 *
 * A unit with no entry here simply has no 3D view yet, and the viewer says so
 * rather than drawing a guess.
 */

export type RoomKind =
  | "living"      // drawing, living, dining
  | "bedroom"
  | "kitchen"
  | "service"     // utility, cupboard, dress, puja
  | "bath"
  | "outdoor";    // sitout, balcony

export interface RoomBox {
  name: string;
  kind: RoomKind;
  /** Feet from the north-west corner of the slab. */
  x: number;
  y: number;
  /** Footprint in feet, as printed on the sheet. */
  w: number;
  h: number;
  /** Printed dimension string, shown on hover. */
  label?: string;
}

export interface UnitGeometry {
  /** Which unit on the plate (1–7), matching OnyxUnitType.position. */
  position: number;
  /** Slab extent in feet, used to centre and scale the view. */
  extent: { w: number; h: number };
  /** Where the front door is, for the entry marker. */
  entry?: { x: number; y: number };
  rooms: RoomBox[];
}

/** Feet-and-inches to decimal feet, so the source stays readable. */
const ft = (feet: number, inches = 0) => feet + inches / 12;

/**
 * Unit 1 — 2594 sq ft, north facing, west end of the plate.
 * Transcribed from /showcase/onyx/unit-plan-1.webp.
 *
 * Three bands run north to south: bedrooms and the drawing room across the
 * top, the living/dining spine through the middle, and the master suite with
 * the multipurpose room along the bottom. Both sitouts hang off the west edge,
 * which is why x starts negative for them — they are outside the walled slab.
 */
const UNIT_1: UnitGeometry = {
  position: 1,
  extent: { w: ft(54, 6), h: ft(37) },
  entry: { x: ft(27), y: 0 },
  rooms: [
    // North band
    { name: "Bedroom 3", kind: "bedroom", x: ft(6), y: 0, w: ft(14, 5), h: ft(12), label: `14'-5" x 12'-0"` },
    { name: "Toilet", kind: "bath", x: ft(20, 5), y: 0, w: ft(5, 6), h: ft(9, 6), label: `5'-6" x 9'-6"` },
    { name: "Drawing", kind: "living", x: ft(26), y: 0, w: ft(13), h: ft(12, 6), label: `13'-0" x 12'-6"` },
    { name: "Bedroom 2", kind: "bedroom", x: ft(39, 6), y: 0, w: ft(15), h: ft(12), label: `15'-0" x 12'-0"` },

    // Middle band — the living spine, with the sitout hanging off the west edge
    { name: "Sitout", kind: "outdoor", x: 0, y: ft(12, 6), w: ft(6), h: ft(12), label: `6'-0" x 12'-0"` },
    { name: "Living", kind: "living", x: ft(6), y: ft(12, 6), w: ft(17, 2), h: ft(12), label: `17'-2" x 12'-0"` },
    { name: "Dining", kind: "living", x: ft(24), y: ft(12, 6), w: ft(13), h: ft(12), label: `13'-0" x 12'-0"` },
    { name: "Puja", kind: "service", x: ft(37, 6), y: ft(12, 6), w: ft(4, 11), h: ft(5, 6), label: `4'-11" x 5'-6"` },
    { name: "Toilet", kind: "bath", x: ft(43), y: ft(12, 6), w: ft(8, 11), h: ft(5, 6), label: `8'-11" x 5'-6"` },
    { name: "Cupboard", kind: "service", x: ft(37, 6), y: ft(18, 6), w: ft(7), h: ft(6), label: `7'-0" x 6'-0"` },
    { name: "Kitchen", kind: "kitchen", x: ft(44, 6), y: ft(18, 6), w: ft(8, 6), h: ft(12), label: `8'-6" x 12'-0"` },

    // South band — master suite and the multipurpose room
    { name: "Sitout", kind: "outdoor", x: 0, y: ft(25), w: ft(5, 10), h: ft(12), label: `5'-10" x 12'-0"` },
    { name: "Master bedroom", kind: "bedroom", x: ft(6), y: ft(25), w: ft(13, 11), h: ft(12), label: `13'-11" x 12'-0"` },
    { name: "Dress", kind: "service", x: ft(20, 6), y: ft(25), w: ft(8, 11), h: ft(6), label: `8'-11" x 6'-0"` },
    { name: "Toilet", kind: "bath", x: ft(20, 6), y: ft(31), w: ft(8, 11), h: ft(5, 5), label: `8'-11" x 5'-5"` },
    { name: "Multipurpose room", kind: "living", x: ft(30), y: ft(25), w: ft(10), h: ft(12), label: `10'-0" x 12'-0"` },
    { name: "Utility", kind: "service", x: ft(44, 6), y: ft(30, 6), w: ft(8, 6), h: ft(5, 11), label: `8'-6" x 5'-11"` },
  ],
};

const GEOMETRIES: readonly UnitGeometry[] = [UNIT_1];

export function unitGeometry(position: number | null | undefined): UnitGeometry | undefined {
  if (position === null || position === undefined) return undefined;
  return GEOMETRIES.find((g) => g.position === position);
}

/** Positions that have a transcribed layout, for the UI to offer the tab. */
export function positionsWith3D(): number[] {
  return GEOMETRIES.map((g) => g.position);
}

/** Sum of the drawn footprints. Always below the printed built-up area, which
 *  includes walls and a share of the common areas — shown so the two numbers
 *  never look like a contradiction. */
export function drawnArea(geometry: UnitGeometry): number {
  return Math.round(geometry.rooms.reduce((sum, r) => sum + r.w * r.h, 0));
}
