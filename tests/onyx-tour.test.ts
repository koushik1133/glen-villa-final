import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

import { MAX_PITCH, normalizeYaw } from "../src/lib/showcase/panorama";
import {
  ONYX_TOUR_ROOMS,
  REPRESENTATIVE_NOTE,
  onyxRoom,
  onyxTourFor,
  onyxTourScenes,
  roomCentre,
  roomPlanLine,
  yawTowards,
} from "../src/lib/showcase/onyx-tour";
import { ONYX_UNIT_TYPES, onyxUnitType } from "../src/lib/showcase/onyx-units";

const ROOT = process.cwd();

describe("onyx 360 tour — scene graph", () => {
  test("the five rooms are the ones the client asked for, with no duplicates", () => {
    const ids = ONYX_TOUR_ROOMS.map((r) => r.id);
    assert.deepEqual([...ids].sort(), ["balcony", "bedroom", "dining", "kitchen", "living"]);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("every panorama referenced by the tour exists on disk", () => {
    for (const room of ONYX_TOUR_ROOMS) {
      assert.ok(room.image.startsWith("/showcase/onyx/panos/"), `${room.id} points outside the pano folder`);
      const file = path.join(ROOT, "public", room.image);
      assert.ok(fs.existsSync(file), `missing panorama for ${room.id}: ${room.image}`);
      assert.ok(fs.statSync(file).size > 10_000, `${room.image} looks like a placeholder`);
    }
  });

  test("their provenance is recorded, so nobody later mistakes them for the client's photography", () => {
    const credits = path.join(ROOT, "public/showcase/onyx/panos/CREDITS.md");
    assert.ok(fs.existsSync(credits));
    assert.match(REPRESENTATIVE_NOTE.toLowerCase(), /representative, not a photograph/);
    assert.match(REPRESENTATIVE_NOTE.toLowerCase(), /glentree onyx apartment plan/);
  });

  test("adjacency is symmetric — you can always walk back the way you came", () => {
    for (const room of ONYX_TOUR_ROOMS) {
      for (const id of room.neighbours) {
        const other = onyxRoom(id);
        assert.ok(other, `${room.id} points at unknown room ${id}`);
        assert.notEqual(id, room.id, `${room.id} links to itself`);
        assert.ok(other.neighbours.includes(room.id), `${id} has no way back to ${room.id}`);
      }
    }
  });

  test("every room is reachable from the living room by walking through doorways", () => {
    const seen = new Set(["living"]);
    const queue = ["living"];
    while (queue.length) {
      const cur = onyxRoom(queue.shift()!)!;
      for (const id of cur.neighbours) {
        if (!seen.has(id)) {
          seen.add(id);
          queue.push(id);
        }
      }
    }
    assert.equal(seen.size, ONYX_TOUR_ROOMS.length, `unreachable rooms: ${
      ONYX_TOUR_ROOMS.filter((r) => !seen.has(r.id)).map((r) => r.id).join(", ")
    }`);
  });

  test("hotspot targets are real scenes and their angles are inside the camera limits", () => {
    const scenes = onyxTourScenes();
    const ids = new Set(scenes.map((s) => s.id));
    assert.equal(scenes.length, ONYX_TOUR_ROOMS.length);
    for (const scene of scenes) {
      assert.ok(scene.hotspots.length > 0, `${scene.id} has no way out`);
      for (const h of scene.hotspots) {
        assert.ok(h.targetSceneId && (ids as Set<string>).has(h.targetSceneId), `${h.id} points nowhere`);
        assert.notEqual(h.targetSceneId, scene.id);
        assert.ok(h.label.length > 0, `${h.id} has no label`);
        assert.equal(normalizeYaw(h.yaw), h.yaw, `${h.id} yaw is not normalised`);
        assert.ok(Math.abs(h.pitch) < MAX_PITCH, `${h.id} pitch is past the clamp`);
      }
      assert.equal(normalizeYaw(scene.initialYaw), scene.initialYaw);
    }
  });

  test("room boxes do not overlap, so the minimap cone is never ambiguous", () => {
    for (let i = 0; i < ONYX_TOUR_ROOMS.length; i++) {
      for (let j = i + 1; j < ONYX_TOUR_ROOMS.length; j++) {
        const a = ONYX_TOUR_ROOMS[i].rect;
        const b = ONYX_TOUR_ROOMS[j].rect;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `${ONYX_TOUR_ROOMS[i].id} overlaps ${ONYX_TOUR_ROOMS[j].id} on the minimap`);
      }
      const r = ONYX_TOUR_ROOMS[i].rect;
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 100 && r.y + r.h <= 100, "room box is off the minimap");
    }
  });

  test("the arrow into a room points the same way the minimap does", () => {
    const living = onyxRoom("living")!;
    const balcony = onyxRoom("balcony")!;
    const dining = onyxRoom("dining")!;
    // Balcony sits east of the living room, dining sits south of it.
    assert.ok(roomCentre(balcony).x > roomCentre(living).x);
    assert.ok(Math.abs(yawTowards(living, balcony) - Math.PI / 2) < 0.3, "balcony arrow should point east");
    assert.ok(Math.abs(yawTowards(living, dining) - Math.PI) < 0.4, "dining arrow should point south");
    // And back the other way.
    assert.ok(Math.abs(normalizeYaw(yawTowards(balcony, living) + Math.PI / 2)) < 0.3);
  });
});

describe("onyx 360 tour — unit context", () => {
  test("each unit's header quotes its own real size, facing and BHK", () => {
    for (const type of ONYX_UNIT_TYPES) {
      const number = `12${String(type.position).padStart(2, "0")}`;
      const tour = onyxTourFor(number);
      assert.equal(tour.type?.position, type.position);
      assert.equal(tour.floor, 12);
      assert.ok(tour.headline.includes(`Unit ${number}`));
      assert.ok(tour.headline.includes(type.sqFt.toLocaleString("en-IN")), tour.headline);
      assert.ok(tour.headline.includes(`${type.facing} facing`), tour.headline);
      if (type.bhk) assert.ok(tour.headline.includes(type.bhk), tour.headline);
      assert.equal(tour.scenes.length, ONYX_TOUR_ROOMS.length);
    }
  });

  test("captions quote a dimension printed on that unit's sheet, or say it is to be confirmed", () => {
    for (const type of ONYX_UNIT_TYPES) {
      const printed = new Set(
        type.rooms.filter((r) => r.dimensions).map((r) => `${r.name} ${r.dimensions}`),
      );
      for (const scene of onyxTourScenes(type)) {
        assert.ok(scene.plan.length > 0);
        if (!/to be confirmed/.test(scene.plan)) {
          assert.ok(printed.has(scene.plan), `unit ${type.position}: "${scene.plan}" is not on the sheet`);
        }
      }
    }
  });

  test("the living, dining and kitchen captions come off the plan for every unit", () => {
    for (const type of ONYX_UNIT_TYPES) {
      for (const id of ["living", "dining", "kitchen"] as const) {
        const line = roomPlanLine(onyxRoom(id)!, type);
        assert.ok(!/to be confirmed/.test(line), `unit ${type.position} ${id}: ${line}`);
      }
    }
  });

  test("an unreadable flat number still gets a tour, just without unit facts", () => {
    const tour = onyxTourFor("0009");
    assert.equal(tour.type, undefined);
    assert.equal(tour.scenes.length, ONYX_TOUR_ROOMS.length);
    assert.equal(onyxUnitType("0009"), undefined);
    for (const scene of tour.scenes) assert.match(scene.plan, /to be confirmed/);
  });
});
