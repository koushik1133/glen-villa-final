#!/usr/bin/env node
/**
 * gen-panoramas.mjs — build the schematic 360 interiors for /showcase.
 *
 *   node scripts/gen-panoramas.mjs            # regenerate everything
 *   node scripts/gen-panoramas.mjs ser-267e-living onyx-u2-kitchen
 *
 * WHAT THIS IS
 * ------------
 * No 360 camera was ever taken on site, and the client has accepted created
 * interiors in place of one. So rather than pass off a stock photo, every scene
 * below is *derived from the published floor plan*: the room footprint is the
 * printed room dimension, to the inch, off the sanctioned sheet. The renderer
 * ray-traces that box — floor, ceiling, four walls, a window on the facing
 * side, a door, skirting, and blocked-in furniture — straight into
 * equirectangular space and writes a 2048x1024 webp.
 *
 * The result is honest architectural massing: the proportions, the sight lines
 * and the room size are real; the finishes are indicative. The UI watermarks
 * every one of these as a schematic preview so nobody reads it as photography.
 *
 * WHAT IS *NOT* FROM THE SHEETS
 * -----------------------------
 * Floor-to-floor height is not printed on any supplied drawing, so a nominal
 * 3.05 m (10 ft) clear height is used purely as a rendering parameter. Finishes,
 * furniture and daylight are indicative. None of it is published as fact.
 *
 * Output: public/showcase/panoramas/<id>.webp + manifest.json
 * Re-runnable and deterministic — no randomness anywhere in here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public/showcase/panoramas');

/* ------------------------------------------------------------------ */
/* Geometry conventions — the app's scene table mirrors these.          */
/*   +z is the window wall (yaw 0), -z is the door (yaw PI),            */
/*   +x is the optional archway (yaw +PI/2). The camera stands off-centre so    */
/*   the main piece of furniture reads across the room, not under the lens.     */
/* ------------------------------------------------------------------ */

const DOOR_YAW = Math.PI;
const WINDOW_YAW = 0;
const ARCH_YAW = Math.PI / 2;

/** Nominal clear height in metres. Not published — a rendering parameter only. */
const CEILING = 3.05;
const EYE = 1.55;

const FT = 0.3048;
/** `12'-6"` / `12-6` / `12'6` -> metres. Dimensions are copied off the sheets verbatim. */
function ft(spec) {
  const m = /^\s*(\d+)\s*'?\s*-?\s*(?:(\d+)\s*"?)?\s*$/.exec(String(spec));
  if (!m) throw new Error(`unparsable dimension: ${spec}`);
  return (Number(m[1]) + Number(m[2] ?? 0) / 12) * FT;
}

/* ------------------------------------------------------------------ */
/* Palette — warm neutral, low saturation, to sit beside the app UI.   */
/* Linear-ish sRGB triples 0..1.                                       */
/* ------------------------------------------------------------------ */

const C = {
  wall: [0.910, 0.882, 0.833],
  wallAccent: [0.784, 0.741, 0.678],
  ceiling: [0.957, 0.941, 0.914],
  floorLight: [0.827, 0.784, 0.729],
  floorDark: [0.706, 0.655, 0.596],
  skirting: [0.612, 0.573, 0.522],
  wood: [0.451, 0.325, 0.216],
  woodLight: [0.647, 0.518, 0.376],
  fabric: [0.792, 0.761, 0.706],
  fabricDark: [0.478, 0.451, 0.416],
  stone: [0.361, 0.341, 0.318],
  metal: [0.62, 0.612, 0.596],
  greenery: [0.361, 0.435, 0.322],
};

/* ------------------------------------------------------------------ */
/* Scenes. A `size` is the dimension printed on the plan sheet where the */
/* sheet prints one legibly; the Serenity 267-east rooms are labelled in  */
/* whole feet that the supplied artwork does not resolve, so their sizes  */
/* are indicative of the drawn footprint only (captions say so).          */
/* ------------------------------------------------------------------ */

/**
 * `kind` drives the furniture block-out. `w` runs left-right (x), `d` runs
 * toward the window (z). `windowW`/`sillH` are indicative.
 */
const SCENES = [
  /* --- Glentree Serenity, 267 sq yds east facing villa (3715 Sft) --- */
  {
    id: 'ser-267e-living',
    kind: 'living',
    title: 'Living',
    plan: 'Living, ground floor (double height) — dimensions to be confirmed',
    // Indicative: the sheet's LIVING label is whole-foot and not legible.
    w: ft(`16'-0"`), d: ft(`16'-0"`),
    ceiling: 5.8, // the sheet marks this room "(DOUBLE HT.)"
    arch: true,
  },
  {
    id: 'ser-267e-master',
    kind: 'bedroom',
    title: 'Master bedroom',
    plan: 'Bedroom-2, first floor — dimensions to be confirmed',
    // Indicative: the sheet's BEDROOM-2 label is whole-foot and not legible.
    w: ft(`16'-0"`), d: ft(`13'-0"`),
    arch: true,
  },
  {
    id: 'ser-267e-kitchen',
    kind: 'kitchen',
    title: 'Kitchen',
    plan: 'Kitchen, ground floor — dimensions to be confirmed',
    // Indicative: the sheet's KITCHEN label is whole-foot and not legible.
    w: ft(`10'-0"`), d: ft(`13'-0"`),
  },
  {
    id: 'ser-267e-terrace',
    kind: 'terrace',
    title: 'Terrace',
    plan: 'Terrace, second floor — dimensions to be confirmed',
    // Indicative: the sheet's TERRACE label is whole-foot and not legible.
    w: ft(`16'-0"`), d: ft(`20'-0"`),
    ceiling: 3.2,
  },

  /* --- Glentree Onyx, unit 2 (2945 SFT, east facing) --- */
  {
    id: 'onyx-u2-living',
    kind: 'living',
    title: 'Living',
    plan: `Living 13'-0" x 16'-9"`,
    w: ft(`13'-0"`), d: ft(`16'-9"`),
    arch: true,
  },
  {
    id: 'onyx-u2-master',
    kind: 'bedroom',
    title: 'Master bedroom',
    plan: `M.Bedroom 14'-5" x 12'-0"`,
    w: ft(`14'-5"`), d: ft(`12'-0"`),
  },
  {
    id: 'onyx-u2-kitchen',
    kind: 'kitchen',
    title: 'Kitchen',
    plan: `Kitchen 8'-6" x 12'-0"`,
    w: ft(`8'-6"`), d: ft(`12'-0"`),
  },

  /* --- Glentree Onyx, unit 3 (2032 SFT, east facing) --- */
  {
    id: 'onyx-u3-living',
    kind: 'living',
    title: 'Living',
    plan: `Living 12'-0" x 12'-0"`,
    w: ft(`12'-0"`), d: ft(`12'-0"`),
    arch: true,
  },
  {
    id: 'onyx-u3-master',
    kind: 'bedroom',
    title: 'Master bedroom',
    // The unit 3 sheet labels this simply "BEDROOM"; it is the largest one and
    // the only one with an attached dress + toilet, so it reads as the master.
    plan: `Bedroom 12'-0" x 14'-7"`,
    w: ft(`12'-0"`), d: ft(`14'-7"`),
  },
  {
    id: 'onyx-u3-kitchen',
    kind: 'kitchen',
    title: 'Kitchen',
    plan: `Kitchen 11'-5" x 10'-7"`,
    w: ft(`11'-5"`), d: ft(`10'-7"`),
  },
];

/* ------------------------------------------------------------------ */
/* Furniture: axis-aligned boxes, in room coordinates.                 */
/* Origin is the room centre at floor level.                           */
/* ------------------------------------------------------------------ */

function box(x0, y0, z0, x1, y1, z1, color, opts = {}) {
  return { min: [x0, y0, z0], max: [x1, y1, z1], color, ...opts };
}

function furniture(s) {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const F = [];

  if (s.kind === 'bedroom') {
    // Bed headboard against the -x wall, so from the standpoint it reads across
    // the room rather than sitting on the panorama seam behind the camera.
    const bw = Math.min(1.9, s.d * 0.42); // across the bed (z)
    const bl = Math.min(2.1, s.w * 0.42); // head to foot (x)
    const x0 = -hw + 0.14;
    const zc = -0.25;
    F.push(box(x0, 0.16, zc - bw / 2, x0 + bl, 0.58, zc + bw / 2, C.fabric)); // mattress
    F.push(box(x0, 0.0, zc - bw / 2, x0 + bl, 0.2, zc + bw / 2, C.wood)); // base
    F.push(box(x0 - 0.12, 0.2, zc - bw / 2 - 0.05, x0, 1.15, zc + bw / 2 + 0.05, C.woodLight)); // headboard
    F.push(box(x0 + 0.12, 0.5, zc - bw / 2, x0 + 0.72, 0.64, zc + bw / 2, [0.86, 0.84, 0.8])); // pillows
    F.push(box(x0 + bl - 0.55, 0.56, zc - bw / 2, x0 + bl, 0.63, zc + bw / 2, C.fabricDark)); // throw
    for (const sz of [-1, 1]) {
      const z = zc + (sz * bw) / 2;
      F.push(box(x0, 0, z + sz * 0.06, x0 + 0.5, 0.52, z + sz * 0.56, C.wood)); // side tables
      F.push(box(x0 + 0.14, 0.52, z + sz * 0.18, x0 + 0.3, 0.86, z + sz * 0.34, C.metal)); // lamps
    }
    // Low dresser on the door wall, clear of the door leaf.
    F.push(box(-0.5, 0, -hd + 0.05, 1.3, 0.8, -hd + 0.55, C.wood));
    F.push(box(-0.5, 0.8, -hd + 0.05, 1.3, 0.86, -hd + 0.6, C.stone));
    // Armchair by the glazing.
    F.push(box(hw - 1.15, 0, hd - 1.3, hw - 0.45, 0.42, hd - 0.6, C.fabricDark));
    F.push(box(hw - 1.15, 0.42, hd - 1.3, hw - 1.05, 1.05, hd - 0.6, C.fabricDark));
  }

  if (s.kind === 'living') {
    // Three-seat sofa backing onto -x, facing the window.
    const sl = Math.min(2.3, s.d * 0.6);
    F.push(box(-hw + 0.2, 0, -sl / 2, -hw + 1.15, 0.42, sl / 2, C.fabric));
    F.push(box(-hw + 0.2, 0.42, -sl / 2, -hw + 0.42, 0.88, sl / 2, C.fabric));
    F.push(box(-hw + 0.2, 0, -sl / 2, -hw + 1.15, 0.14, sl / 2, C.stone));
    // Coffee table, pushed toward the window so the standpoint is not on top of it.
    const cz = hd * 0.18;
    F.push(box(-hw + 1.55, 0.3, cz - 0.5, -hw + 2.65, 0.4, cz + 0.5, C.wood));
    F.push(box(-hw + 1.65, 0, cz - 0.4, -hw + 1.77, 0.3, cz - 0.28, C.metal));
    F.push(box(-hw + 2.43, 0, cz + 0.28, -hw + 2.55, 0.3, cz + 0.4, C.metal));
    // Console on the door wall + an accent chair facing the sofa.
    F.push(box(-0.9, 0, -hd + 0.05, 0.9, 0.75, -hd + 0.5, C.wood));
    F.push(box(-hw + 2.1, 0, cz + 1.5, -hw + 2.8, 0.44, cz + 2.2, C.fabricDark));
    F.push(box(-hw + 2.1, 0.44, cz + 2.05, -hw + 2.8, 1.0, cz + 2.2, C.fabricDark));
    // Planter by the glazing.
    F.push(box(hw - 0.9, 0, hd - 0.75, hw - 0.5, 0.4, hd - 0.35, C.stone));
    F.push(box(hw - 0.88, 0.4, hd - 0.73, hw - 0.52, 1.25, hd - 0.37, C.greenery));
  }

  if (s.kind === 'kitchen') {
    // Counter runs the full -x wall, second run along the door wall.
    F.push(box(-hw + 0.02, 0, -hd + 0.05, -hw + 0.64, 0.86, hd - 0.05, C.wood));
    F.push(box(-hw + 0.02, 0.86, -hd + 0.05, -hw + 0.68, 0.94, hd - 0.05, C.stone));
    F.push(box(-hw + 0.02, 1.55, -hd + 0.05, -hw + 0.42, 2.25, hd - 1.2, C.woodLight)); // wall units
    F.push(box(-hw + 0.64, 0, -hd + 0.05, hw - 0.05, 0.86, -hd + 0.67, C.wood));
    F.push(box(-hw + 0.64, 0.86, -hd + 0.05, hw - 0.05, 0.94, -hd + 0.71, C.stone));
    // Tall unit in the far corner.
    F.push(box(hw - 0.72, 0, -hd + 0.05, hw - 0.05, 2.25, -hd + 0.72, C.woodLight));
    // Island only where the room is wide enough to walk around it.
    if (s.w > 3.0 && s.d > 3.0) {
      F.push(box(-0.55, 0, -0.6, 0.75, 0.86, 0.6, C.wood));
      F.push(box(-0.62, 0.86, -0.67, 0.82, 0.94, 0.67, C.stone));
    }
  }

  if (s.kind === 'terrace') {
    // Open deck: planters along both long edges, a lounge set near the doors.
    for (let z = -hd + 0.8; z < hd - 0.6; z += 1.6) {
      F.push(box(-hw + 0.08, 0, z, -hw + 0.52, 0.45, z + 0.9, C.stone));
      F.push(box(-hw + 0.1, 0.45, z + 0.02, -hw + 0.5, 1.15, z + 0.88, C.greenery));
    }
    F.push(box(hw - 0.55, 0, -hd + 0.6, hw - 0.1, 0.42, hd - 0.6, C.stone)); // bench
    F.push(box(-0.7, 0, -hd + 1.0, 0.5, 0.4, -hd + 2.0, C.fabric));
    F.push(box(-0.7, 0.4, -hd + 1.0, 0.5, 0.9, -hd + 1.2, C.fabric));
    F.push(box(-0.35, 0.3, -hd + 2.3, 0.35, 0.42, -hd + 2.9, C.wood));
  }

  return F;
}

/* ------------------------------------------------------------------ */
/* Ray tracing                                                         */
/* ------------------------------------------------------------------ */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const mixC = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Nearest entry hit with an AABB from a ray starting outside it. */
function hitBox(o, dir, b) {
  let t0 = -Infinity;
  let t1 = Infinity;
  let axis = 0;
  let sign = 1;
  for (let a = 0; a < 3; a++) {
    const inv = 1 / (dir[a] || 1e-12);
    let ta = (b.min[a] - o[a]) * inv;
    let tb = (b.max[a] - o[a]) * inv;
    let s = -1;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
      s = 1;
    }
    if (ta > t0) {
      t0 = ta;
      axis = a;
      sign = s;
    }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (t1 < 1e-4) return null;
  if (t0 < 1e-4) return null; // camera inside the box — ignore
  const n = [0, 0, 0];
  n[axis] = sign;
  return { t: t0, n };
}

/** Exit point of the ray from the room shell, plus the face normal (inward). */
function exitRoom(o, dir, hw, h, hd) {
  const lo = [-hw, 0, -hd];
  const hi = [hw, h, hd];
  let t1 = Infinity;
  let axis = 0;
  let sign = 1;
  for (let a = 0; a < 3; a++) {
    const inv = 1 / (dir[a] || 1e-12);
    const ta = (lo[a] - o[a]) * inv;
    const tb = (hi[a] - o[a]) * inv;
    const near = Math.min(ta, tb);
    const far = Math.max(ta, tb);
    void near;
    if (far < t1) {
      t1 = far;
      axis = a;
      sign = dir[a] > 0 ? -1 : 1; // inward-facing normal
    }
  }
  const n = [0, 0, 0];
  n[axis] = sign;
  return { t: t1, n, axis };
}

/**
 * Shade one ray. Returns a linear-ish sRGB triple.
 * Lighting is deliberately simple and soft: a warm ceiling source, a large cool
 * daylight source at the window, and a wrapped ambient term. No hard shadows —
 * the look we want is architectural massing, not a fake photograph.
 */
function shade(s, geo, o, dir) {
  const { hw, hd, h, win, door, arch, F } = geo;

  const room = exitRoom(o, dir, hw, h, hd);
  let best = room.t;
  let n = room.n;
  let color = null;
  let isFloor = false;
  let isCeiling = false;
  let isWall = false;
  let hitFurniture = false;

  for (const b of F) {
    const hitb = hitBox(o, dir, b);
    if (hitb && hitb.t < best) {
      best = hitb.t;
      n = hitb.n;
      color = b.color;
      hitFurniture = true;
    }
  }

  const p = [o[0] + dir[0] * best, o[1] + dir[1] * best, o[2] + dir[2] * best];

  if (!hitFurniture) {
    if (room.axis === 1) {
      if (n[1] > 0) {
        isFloor = true;
        // Large-format tile: a soft grid, never a hard checkerboard.
        const g = Math.min(
          Math.abs(((p[0] / 0.8) % 1) - 0.5),
          Math.abs(((p[2] / 0.8) % 1) - 0.5),
        );
        const joint = 1 - smooth(0.0, 0.03, g);
        const drift = 0.5 + 0.5 * Math.sin(p[0] * 1.7) * Math.sin(p[2] * 1.3);
        color = mixC(C.floorLight, C.floorDark, 0.25 * drift + 0.55 * joint);
      } else if (s.kind === 'terrace') {
        // Open deck: there is no slab overhead, so the "ceiling" is sky.
        return [1.42, 1.5, 1.62];
      } else {
        isCeiling = true;
        // Recessed cove: a slightly brighter tray in the middle of the slab.
        const inTray =
          Math.abs(p[0]) < hw - 0.55 && Math.abs(p[2]) < hd - 0.55 ? 1 : 0;
        color = mixC(C.ceiling, [1, 0.985, 0.955], inTray * 0.6);
      }
    } else {
      isWall = true;
      color = C.wall;
      // Skirting.
      if (p[1] < 0.11) color = C.skirting;
      // A single panelled accent wall behind the bed / sofa keeps it from
      // reading as an empty white box.
      if (s.kind !== 'terrace' && room.axis === 2 && n[2] > 0) {
        const rib = Math.abs(((p[0] / 0.24) % 1) - 0.5);
        color = mixC(C.wallAccent, mixC(C.wallAccent, C.wood, 0.35), 1 - smooth(0.0, 0.12, rib));
        if (p[1] < 0.11) color = C.skirting;
      }
    }
  }

  /* --- Openings punched through the shell --- */
  let sky = 0;
  let doorway = 0;
  if (!hitFurniture && isWall) {
    if (s.kind === 'terrace' && room.axis === 0 && p[1] > win.sill) {
      // The deck is open along both long sides above the parapet.
      sky = 1;
    }
    if (room.axis === 2 && n[2] < 0) {
      // Window wall (+z).
      const inX = Math.abs(p[0]) < win.halfW;
      const inY = p[1] > win.sill && p[1] < win.head;
      if (inX && inY) sky = 1;
      // Mullion.
      if (sky) {
        const m = p[0] / 1.25;
        if (Math.abs(m - Math.round(m)) < 0.028) sky = 0; // mullion
        if (Math.abs(p[1] - win.head) < 0.05 || Math.abs(p[1] - win.sill) < 0.05) sky = 0; // frame
      }
    }
    if (room.axis === 2 && n[2] > 0) {
      // Door wall (-z).
      if (Math.abs(p[0] - door.x) < door.halfW && p[1] < door.head) doorway = 1;
    }
    if (arch && room.axis === 0 && n[0] < 0) {
      // Archway on the +x wall.
      if (Math.abs(p[2]) < arch.halfW && p[1] < arch.head) doorway = 1;
    }
  }

  if (sky) {
    // Daylight seen through the glazing: a soft sky-to-haze gradient with a
    // hint of the greenery the renders show outside every one of these rooms.
    const t = clamp01((p[1] - win.sill) / Math.max(0.001, win.head - win.sill));
    const skyC = mixC([0.796, 0.847, 0.878], [0.98, 0.973, 0.941], 1 - t);
    const ground = mixC(skyC, [0.494, 0.553, 0.435], smooth(0.26, 0.0, t));
    return [ground[0] * 0.98, ground[1] * 0.97, ground[2] * 0.93];
  }

  if (doorway) {
    // Looking into the next space: dim, warm, slightly graded.
    const t = clamp01(p[1] / 2.1);
    const c = mixC([0.243, 0.227, 0.208], [0.42, 0.392, 0.353], t);
    return c;
  }

  /* --- Lighting --- */
  const lights = [
    // Warm ceiling source.
    { p: [0, h - 0.15, 0], c: [1.0, 0.9, 0.76], i: 2.2 },
    // Daylight, standing just inside the glazing so it wraps the room.
    {
      p: [0, mix(win.sill, win.head, 0.55), hd - 0.25],
      c: [0.9, 0.94, 1.0],
      i: s.kind === 'terrace' ? 6.2 : 3.6,
    },
  ];
  if (s.w > 4.2) {
    lights.push({ p: [-hw * 0.55, h - 0.15, 0], c: [1.0, 0.9, 0.76], i: 1.1 });
    lights.push({ p: [hw * 0.55, h - 0.15, 0], c: [1.0, 0.9, 0.76], i: 1.1 });
  }

  let r = 0;
  let g = 0;
  let b = 0;
  for (const L of lights) {
    const dx = L.p[0] - p[0];
    const dy = L.p[1] - p[1];
    const dz = L.p[2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz + 0.35;
    const d = Math.sqrt(d2);
    // Wrapped lambert: half-lit surfaces still pick up bounce, which is what
    // keeps the corners from going black.
    const ndl = (dx * n[0] + dy * n[1] + dz * n[2]) / d;
    const w = clamp01((ndl + 0.55) / 1.55);
    const f = (L.i * w) / d2;
    r += L.c[0] * f;
    g += L.c[1] * f;
    b += L.c[2] * f;
  }

  // Ambient: sky above, warm bounce off the floor below.
  const up = clamp01(n[1] * 0.5 + 0.5);
  // Ambient plus a flat daylight bounce: real rooms this glazed are filled by
  // light coming back off the floor and ceiling, which no point light gives us.
  const amb = 0.34;
  r += amb * mix(1.0, 0.9, up) + 0.16;
  g += amb * mix(0.94, 0.93, up) + 0.155;
  b += amb * mix(0.84, 1.0, up) + 0.145;

  // Corner darkening — a cheap stand-in for ambient occlusion.
  let ao = 1;
  if (isWall || isFloor || isCeiling) {
    const dWall = Math.min(hw - Math.abs(p[0]), hd - Math.abs(p[2]));
    const dY = Math.min(p[1], h - p[1]);
    ao *= mix(0.62, 1, smooth(0, 0.7, dWall));
    ao *= mix(0.7, 1, smooth(0, 0.55, dY));
  }
  // Contact shadow under each furniture block.
  if (isFloor) {
    for (const bx of F) {
      if (bx.min[1] > 0.6) continue;
      const cx = Math.max(bx.min[0], Math.min(p[0], bx.max[0]));
      const cz = Math.max(bx.min[2], Math.min(p[2], bx.max[2]));
      const dist = Math.hypot(p[0] - cx, p[2] - cz);
      ao *= mix(0.55, 1, smooth(0, 0.55, dist));
    }
  }
  if (hitFurniture) ao *= 0.96;

  r *= color[0] * ao;
  g *= color[1] * ao;
  b *= color[2] * ao;

  // Extended Reinhard: rolls the bright window wall off instead of clipping it
  // to flat white, while leaving the mid-tones close to linear.
  const WHITE = 2.7;
  const tone = (v) => (v * (1 + v / (WHITE * WHITE))) / (1 + v);
  return [tone(r), tone(g), tone(b)];
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

/** Shipping size. `PANO_W=512 PANO_SS=1` renders a fast rough preview instead. */
const W_OUT = Number(process.env.PANO_W || 2048);
const H_OUT = W_OUT / 2;
const SS = Number(process.env.PANO_SS || 2); // supersample; the webp is downsampled from SS x

function geometryFor(s) {
  const h = s.ceiling ?? CEILING;
  const hw = s.w / 2;
  const hd = s.d / 2;
  // Terrace: a solid parapet up to 1.05 m, open above it along the whole edge.
  const sill = s.kind === 'terrace' ? 1.05 : s.kind === 'kitchen' ? 1.0 : 0.35;
  return {
    hw,
    hd,
    h,
    win: {
      halfW:
        s.kind === 'terrace'
          ? hw - 0.08
          : Math.min(hw - 0.35, s.kind === 'kitchen' ? 0.9 : Math.max(0.9, hw * 0.72)),
      sill,
      head: s.kind === 'terrace' ? h : Math.min(h - 0.35, 2.5),
    },
    door: { x: Math.max(-hw + 0.7, Math.min(hw - 0.7, hw * 0.45)), halfW: 0.55, head: 2.15 },
    arch: s.arch ? { halfW: Math.min(hd - 0.4, 0.85), head: 2.35 } : null,
    F: furniture(s),
  };
}

/**
 * Where the virtual tripod stands. Dead centre puts the camera inside the
 * furniture in the tighter rooms, so each kind gets a standpoint that keeps the
 * window ahead and the main piece across the room.
 */
function standpoint(s, geo) {
  const y = Math.min(EYE, geo.h - 0.3);
  if (s.kind === 'bedroom') return [Math.min(geo.hw * 0.42, 1.5), y, -geo.hd * 0.1];
  if (s.kind === 'living') return [Math.min(geo.hw * 0.16, 0.6), y, -geo.hd * 0.4];
  if (s.kind === 'kitchen') return [Math.min(geo.hw * 0.3, 0.9), y, geo.hd * 0.22];
  if (s.kind === 'terrace') return [0, y, -geo.hd + Math.min(3.4, s.d * 0.28)];
  return [0, y, 0];
}

async function render(s) {
  const geo = geometryFor(s);
  const w = W_OUT * SS;
  const h = H_OUT * SS;
  const buf = Buffer.allocUnsafe(w * h * 3);
  const eye = standpoint(s, geo);

  for (let y = 0; y < h; y++) {
    const pitch = (0.5 - (y + 0.5) / h) * Math.PI;
    const cp = Math.cos(pitch);
    const sy = Math.sin(pitch);
    for (let x = 0; x < w; x++) {
      const yaw = ((x + 0.5) / w - 0.5) * Math.PI * 2;
      const dir = [cp * Math.sin(yaw), sy, cp * Math.cos(yaw)];
      const c = shade(s, geo, eye, dir);
      const i = (y * w + x) * 3;
      // Linear -> display. The material albedos are already authored close to
      // sRGB, so this is a light lift rather than a full 2.2 conversion.
      buf[i] = Math.round(255 * clamp01(Math.pow(c[0], 1 / 1.3)));
      buf[i + 1] = Math.round(255 * clamp01(Math.pow(c[1], 1 / 1.3)));
      buf[i + 2] = Math.round(255 * clamp01(Math.pow(c[2], 1 / 1.3)));
    }
  }

  const file = path.join(OUT_DIR, `${s.id}.webp`);
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .resize(W_OUT, H_OUT, { kernel: 'lanczos3' })
    .webp({ quality: 82, effort: 5 })
    .toFile(file);
  return file;
}

/* ------------------------------------------------------------------ */

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const todo = only.length ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
  if (!todo.length) {
    console.error(`no scene matched. known ids:\n  ${SCENES.map((s) => s.id).join('\n  ')}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const s of todo) {
    const t0 = Date.now();
    const file = await render(s);
    const kb = Math.round(fs.statSync(file).size / 1024);
    console.log(`${s.id.padEnd(20)} ${W_OUT}x${H_OUT}  ${String(kb).padStart(4)} kB  ${Date.now() - t0} ms`);
  }

  // The manifest always describes the full set, so a partial re-run does not
  // silently shrink it. The UI's scene table is checked against this in tests.
  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    generator: 'scripts/gen-panoramas.mjs',
    kind: 'schematic',
    note:
      'Schematic 360 interiors ray-traced from the published floor-plan dimensions. ' +
      'Room footprints are the printed plan dimensions. Clear height, finishes, furniture ' +
      'and daylight are indicative and not published facts. These are not photographs.',
    width: W_OUT,
    height: H_OUT,
    conventions: { doorYaw: DOOR_YAW, windowYaw: WINDOW_YAW, archYaw: ARCH_YAW, eyeHeightM: EYE },
    scenes: SCENES.map((s) => ({
      id: s.id,
      path: `/showcase/panoramas/${s.id}.webp`,
      title: s.title,
      plan: s.plan,
      widthM: Number(s.w.toFixed(3)),
      depthM: Number(s.d.toFixed(3)),
      ceilingM: Number((s.ceiling ?? CEILING).toFixed(3)),
      hasArch: Boolean(s.arch),
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nmanifest -> public/showcase/panoramas/manifest.json (${SCENES.length} scenes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
