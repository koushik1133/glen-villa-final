"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONYX_TOUR_ROOMS = exports.REPRESENTATIVE_NOTE = void 0;
exports.onyxRoom = onyxRoom;
exports.roomCentre = roomCentre;
exports.yawTowards = yawTowards;
exports.roomHotspots = roomHotspots;
exports.roomPlanLine = roomPlanLine;
exports.onyxTourScenes = onyxTourScenes;
exports.onyxTourFor = onyxTourFor;
const panorama_1 = require("./panorama");
const onyx_units_1 = require("./onyx-units");
/** Permanent, non-alarming caption. Drop it only when the client's own 360
 *  captures replace these files. */
exports.REPRESENTATIVE_NOTE = 'Layout, room names and dimensions are from the Glentree Onyx apartment plan. The furnishing imagery is representative, not a photograph of this apartment.';
/**
 * Room boxes. A schematic arrangement of the five rooms shown, not a scaled
 * reproduction of the plate — the minimap says which room you are standing in
 * and which way you are looking, and the plan sheet remains the drawing of
 * record.
 */
exports.ONYX_TOUR_ROOMS = [
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
];
function onyxRoom(id) {
    return exports.ONYX_TOUR_ROOMS.find((r) => r.id === id);
}
/** Centre of a room box, in the same 100x100 minimap space. */
function roomCentre(room) {
    return { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 };
}
/**
 * Yaw from one room towards another, in the viewer's convention: 0 looks
 * "north" (up the minimap) and grows clockwise. Deriving it from the boxes
 * keeps the in-panorama arrow and the minimap cone pointing the same way.
 */
function yawTowards(from, to) {
    const a = roomCentre(from);
    const b = roomCentre(to);
    return (0, panorama_1.normalizeYaw)(Math.atan2(b.x - a.x, -(b.y - a.y)));
}
/** Doorway arrows sit just below the horizon, where a doorway actually is. */
const ARROW_PITCH = -0.08;
function roomHotspots(room) {
    return room.neighbours.map((id) => {
        const target = onyxRoom(id);
        if (!target)
            throw new Error(`onyx tour: ${room.id} points at unknown room ${id}`);
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
function roomPlanLine(room, unit) {
    if (unit) {
        for (const name of room.planNames) {
            const hit = unit.rooms.find((r) => r.name.toLowerCase() === name.toLowerCase());
            if (hit)
                return hit.dimensions ? `${hit.name} ${hit.dimensions}` : `${hit.name} — dimensions to be confirmed`;
        }
    }
    return `${room.label} — dimensions to be confirmed`;
}
/**
 * The scene list for a unit. The images are the same five for every unit — they
 * are representative — while the captions are that unit's own plan schedule.
 */
function onyxTourScenes(unit) {
    return exports.ONYX_TOUR_ROOMS.map((room) => ({
        id: room.id,
        title: room.label,
        image: room.image,
        // Face the first doorway so the way onward is visible on arrival.
        initialYaw: room.neighbours.length ? yawTowards(room, onyxRoom(room.neighbours[0])) : 0,
        hotspots: roomHotspots(room),
        plan: roomPlanLine(room, unit),
    }));
}
/** Everything the tour header and minimap need for one flat number. */
function onyxTourFor(unitNumber) {
    const type = (0, onyx_units_1.onyxUnitType)(unitNumber);
    const floor = (0, onyx_units_1.onyxUnitFloor)(unitNumber);
    const bits = [`Unit ${unitNumber}`];
    if (floor)
        bits.push(`floor ${floor}`);
    if (type) {
        bits.push(`${type.sqFt.toLocaleString('en-IN')} sq ft`);
        bits.push(`${type.facing} facing`);
        if (type.bhk)
            bits.push(type.bhk);
    }
    return { unitNumber, floor, type, headline: bits.join(' · '), scenes: onyxTourScenes(type) };
}
