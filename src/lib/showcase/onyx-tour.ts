/**
 * The Glentree Onyx 360 tour: five rooms, how they connect, and where they sit
 * relative to each other on the minimap.
 *
 * The panoramas under /showcase/onyx/panos are REPRESENTATIVE interiors (CC0
 * Poly Haven HDRIs — see the CREDITS.md beside them), not photographs of a
 * Glentree apartment. The layout, the room names and every dimension quoted
 * here come from the client's own APARTMENT PLAN sheets via ONYX_UNIT_TYPES;
 * only the furnishing imagery is a stand-in, and `REPRESENTATIVE_NOTE` is the
 * line the UI must keep on screen wherever these images appear.
 *
 * No DOM, no React: the scene graph is plain data so tests can walk it.
 */

import { normalizeYaw, type PanoHotspot } from './panorama';
import { onyxUnitFloor, onyxUnitType, type OnyxUnitType } from './onyx-units';

/** Permanent, non-alarming caption. Drop it only when the client's own 360
 *  captures replace these files. */
export const REPRESENTATIVE_NOTE =
  'Layout, room names and dimensions are from the Glentree Onyx apartment plan. The furnishing imagery is representative, not a photograph of this apartment.';

export type OnyxRoomId = 'living' | 'dining' | 'bedroom' | 'kitchen' | 'balcony';

export type OnyxRoom = {
  id: OnyxRoomId;
  /** Pill label. */
  label: string;
  /** Public path to the 4096x2048 equirectangular source. */
  image: string;
  /** Where the room sits in the minimap's 100x100 box. */
  rect: { x: number; y: number; w: number; h: number };
  /** Rooms you can walk into from here. */
  neighbours: OnyxRoomId[];
  /**
   * Names to look for in the unit's printed room schedule, best first. The
   * first one that matches supplies the dimension shown in the caption.
   */
  planNames: string[];
};

/**
 * Room boxes. A schematic arrangement of the five rooms shown, not a scaled
 * reproduction of the plate — the minimap says which room you are standing in
 * and which way you are looking, and the plan sheet remains the drawing of
 * record.
 */
export const ONYX_TOUR_ROOMS: readonly OnyxRoom[] = [
  {
    id: 'bedroom',
    label: 'Master bedroom',
    image: '/showcase/onyx/panos/bedroom.webp',
    rect: { x: 2, y: 6, w: 30, h: 40 },
    neighbours: ['living'],
    planNames: ['Master bedroom', 'Bedroom 2', 'Bedroom'],
  },
  {
    id: 'living',
    label: 'Living',
    image: '/showcase/onyx/panos/living.webp',
    rect: { x: 34, y: 6, w: 34, h: 40 },
    neighbours: ['bedroom', 'balcony', 'dining'],
    planNames: ['Living', 'Living / dining', 'Drawing'],
  },
  {
    id: 'balcony',
    label: 'Balcony',
    image: '/showcase/onyx/panos/balcony.webp',
    rect: { x: 70, y: 6, w: 28, h: 40 },
    neighbours: ['living'],
    planNames: ['Sitout'],
  },
  {
    id: 'kitchen',
    label: 'Kitchen',
    image: '/showcase/onyx/panos/kitchen.webp',
    rect: { x: 2, y: 52, w: 30, h: 42 },
    neighbours: ['dining'],
    planNames: ['Kitchen'],
  },
  {
    id: 'dining',
    label: 'Dining',
    image: '/showcase/onyx/panos/dining.webp',
    rect: { x: 34, y: 52, w: 34, h: 42 },
    neighbours: ['living', 'kitchen'],
    planNames: ['Dining', 'Living / dining'],
  },
] as const;

export function onyxRoom(id: string): OnyxRoom | undefined {
  return ONYX_TOUR_ROOMS.find((r) => r.id === id);
}

/** Centre of a room box, in the same 100x100 minimap space. */
export function roomCentre(room: OnyxRoom): { x: number; y: number } {
  return { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 };
}

/**
 * Yaw from one room towards another, in the viewer's convention: 0 looks
 * "north" (up the minimap) and grows clockwise. Deriving it from the boxes
 * keeps the in-panorama arrow and the minimap cone pointing the same way.
 */
export function yawTowards(from: OnyxRoom, to: OnyxRoom): number {
  const a = roomCentre(from);
  const b = roomCentre(to);
  return normalizeYaw(Math.atan2(b.x - a.x, -(b.y - a.y)));
}

/** Doorway arrows sit just below the horizon, where a doorway actually is. */
const ARROW_PITCH = -0.08;

export function roomHotspots(room: OnyxRoom): PanoHotspot[] {
  return room.neighbours.map((id) => {
    const target = onyxRoom(id);
    if (!target) throw new Error(`onyx tour: ${room.id} points at unknown room ${id}`);
    return {
      id: `${room.id}-to-${id}`,
      yaw: yawTowards(room, target),
      pitch: ARROW_PITCH,
      label: target.label,
      targetSceneId: id,
    };
  });
}

/** The dimension this unit's plan prints for that room, if it prints one. */
export function roomPlanLine(room: OnyxRoom, unit?: OnyxUnitType): string {
  if (unit) {
    for (const name of room.planNames) {
      const hit = unit.rooms.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (hit) return hit.dimensions ? `${hit.name} ${hit.dimensions}` : `${hit.name} — dimensions to be confirmed`;
    }
  }
  return `${room.label} — dimensions to be confirmed`;
}

export type OnyxTourScene = {
  id: OnyxRoomId;
  title: string;
  image: string;
  initialYaw: number;
  hotspots: PanoHotspot[];
  /** Caption line: the room as the plan sheet names it. */
  plan: string;
};

/**
 * The scene list for a unit. The images are the same five for every unit — they
 * are representative — while the captions are that unit's own plan schedule.
 */
export function onyxTourScenes(unit?: OnyxUnitType): OnyxTourScene[] {
  return ONYX_TOUR_ROOMS.map((room) => ({
    id: room.id,
    title: room.label,
    image: room.image,
    // Face the first doorway so the way onward is visible on arrival.
    initialYaw: room.neighbours.length ? yawTowards(room, onyxRoom(room.neighbours[0])!) : 0,
    hotspots: roomHotspots(room),
    plan: roomPlanLine(room, unit),
  }));
}

export type OnyxTourContext = {
  unitNumber: string;
  floor: number | null;
  type?: OnyxUnitType;
  /** Header line: "Unit 1204 · 2,405 sq ft · West facing · 3 BHK". */
  headline: string;
  scenes: OnyxTourScene[];
};

/** Everything the tour header and minimap need for one flat number. */
export function onyxTourFor(unitNumber: string): OnyxTourContext {
  const type = onyxUnitType(unitNumber);
  const floor = onyxUnitFloor(unitNumber);
  const bits = [`Unit ${unitNumber}`];
  if (floor) bits.push(`floor ${floor}`);
  if (type) {
    bits.push(`${type.sqFt.toLocaleString('en-IN')} sq ft`);
    bits.push(`${type.facing} facing`);
    if (type.bhk) bits.push(type.bhk);
  }
  return { unitNumber, floor, type, headline: bits.join(' · '), scenes: onyxTourScenes(type) };
}
