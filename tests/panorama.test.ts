import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

import {
  DEFAULT_FOV,
  MAX_FOV,
  MAX_PITCH,
  MIN_FOV,
  anglesToDirection,
  clampCamera,
  clampFov,
  clampPitch,
  directionToAngles,
  directionToScreen,
  directionToUv,
  focalLength,
  normalizeYaw,
  projectHotspot,
  screenToDirection,
  shortestYawDelta,
  uvToDirection,
  type Camera,
} from "../src/lib/showcase/panorama";
import { PANO_TOURS, onyxTourForUnit, serenityTourForPlot } from "../src/lib/showcase/panorama-scenes";

const D = (deg: number) => (deg * Math.PI) / 180;
const near = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b} (eps ${eps})`);

describe("yaw normalisation", () => {
  test("wraps into (-PI, PI]", () => {
    near(normalizeYaw(0), 0);
    near(normalizeYaw(D(370)), D(10), 1e-12);
    near(normalizeYaw(-D(370)), -D(10), 1e-12);
    near(normalizeYaw(3 * Math.PI), Math.PI, 1e-12);
    // -PI folds up to +PI so the range stays half-open.
    near(normalizeYaw(-Math.PI), Math.PI);
  });

  test("is idempotent", () => {
    for (const a of [-9, -3.2, -0.4, 0, 0.4, 3.2, 9, 100]) {
      near(normalizeYaw(normalizeYaw(a)), normalizeYaw(a), 1e-12);
    }
  });

  test("non-finite input falls back to zero", () => {
    assert.equal(normalizeYaw(Number.NaN), 0);
    assert.equal(normalizeYaw(Number.POSITIVE_INFINITY), 0);
  });
});

describe("pitch clamping", () => {
  test("the camera can never reach the poles", () => {
    assert.ok(MAX_PITCH < Math.PI / 2);
    assert.equal(clampPitch(Math.PI), MAX_PITCH);
    assert.equal(clampPitch(-Math.PI), -MAX_PITCH);
    assert.equal(clampPitch(D(10)), D(10));
    assert.equal(clampPitch(Number.NaN), 0);
  });

  test("no accumulation of look-up input can flip the view", () => {
    let pitch = 0;
    for (let i = 0; i < 500; i++) pitch = clampPitch(pitch + 0.2);
    assert.equal(pitch, MAX_PITCH);
    for (let i = 0; i < 1000; i++) pitch = clampPitch(pitch - 0.2);
    assert.equal(pitch, -MAX_PITCH);
  });
});

describe("field of view limits", () => {
  test("stays inside the zoom range", () => {
    assert.ok(MIN_FOV < DEFAULT_FOV && DEFAULT_FOV < MAX_FOV);
    assert.equal(clampFov(0), MIN_FOV);
    assert.equal(clampFov(D(1000)), MAX_FOV);
    assert.equal(clampFov(DEFAULT_FOV), DEFAULT_FOV);
    assert.equal(clampFov(Number.NaN), DEFAULT_FOV);
  });

  test("repeated zoom steps converge on the limits, never past them", () => {
    let fov = DEFAULT_FOV;
    for (let i = 0; i < 200; i++) fov = clampFov(fov / 1.1);
    assert.equal(fov, MIN_FOV);
    for (let i = 0; i < 200; i++) fov = clampFov(fov * 1.1);
    assert.equal(fov, MAX_FOV);
  });

  test("focal length grows as the fov narrows", () => {
    assert.ok(focalLength(720, MIN_FOV) > focalLength(720, MAX_FOV));
    // At a 90 degree vertical fov the focal length is exactly half the height.
    near(focalLength(1000, D(90)), 500, 1e-9);
  });

  test("clampCamera applies all three rules at once", () => {
    const c = clampCamera({ yaw: D(400), pitch: D(120), fov: D(5) });
    near(c.yaw, D(40), 1e-12);
    assert.equal(c.pitch, MAX_PITCH);
    assert.equal(c.fov, MIN_FOV);
  });
});

describe("screen <-> sphere round trip", () => {
  const W = 960;
  const H = 540;
  const cams: Camera[] = [
    { yaw: 0, pitch: 0, fov: DEFAULT_FOV },
    { yaw: D(37), pitch: D(-18), fov: D(50) },
    { yaw: D(-160), pitch: D(41), fov: D(95) },
    { yaw: D(179), pitch: MAX_PITCH, fov: MIN_FOV },
  ];

  test("every pixel maps to a direction and back to itself", () => {
    for (const cam of cams) {
      for (const x of [0, 1, W / 3, W / 2, W - 1]) {
        for (const y of [0, 1, H / 4, H / 2, H - 1]) {
          const dir = screenToDirection(x, y, W, H, cam);
          const back = directionToScreen(dir, W, H, cam);
          assert.ok(back, `pixel ${x},${y} projected to nothing`);
          near(back.x, x, 1e-6);
          near(back.y, y, 1e-6);
        }
      }
    }
  });

  test("the centre pixel looks exactly along the camera axis", () => {
    for (const cam of cams) {
      const dir = screenToDirection(W / 2, H / 2, W, H, cam);
      const a = directionToAngles(dir);
      near(a.yaw, normalizeYaw(cam.yaw), 1e-9);
      near(a.pitch, cam.pitch, 1e-9);
    }
  });

  test("directions round-trip through yaw/pitch", () => {
    for (const yaw of [-3.1, -1, 0, 0.7, 3.0]) {
      for (const pitch of [-1.2, -0.3, 0, 0.5, 1.2]) {
        const a = directionToAngles(anglesToDirection(yaw, pitch));
        near(a.yaw, normalizeYaw(yaw), 1e-9);
        near(a.pitch, pitch, 1e-9);
      }
    }
  });

  test("directions round-trip through equirectangular uv", () => {
    for (const yaw of [-3.0, -0.5, 0, 1.4, 3.1]) {
      for (const pitch of [-1.4, 0, 0.9]) {
        const dir = anglesToDirection(yaw, pitch);
        const uv = directionToUv(dir);
        assert.ok(uv.u >= 0 && uv.u < 1, `u out of range: ${uv.u}`);
        assert.ok(uv.v >= 0 && uv.v <= 1, `v out of range: ${uv.v}`);
        const back = directionToAngles(uvToDirection(uv.u, uv.v));
        near(back.yaw, normalizeYaw(yaw), 1e-9);
        near(back.pitch, pitch, 1e-9);
      }
    }
  });

  test("the image centre column is yaw 0 and the middle row is the horizon", () => {
    near(directionToUv(anglesToDirection(0, 0)).u, 0.5, 1e-12);
    near(directionToUv(anglesToDirection(0, 0)).v, 0.5, 1e-12);
    // Straight up is the top edge of the source.
    near(directionToUv(anglesToDirection(0, Math.PI / 2)).v, 0, 1e-12);
  });
});

describe("hotspot projection", () => {
  const W = 800;
  const H = 450;

  test("a hotspot dead ahead lands in the middle of the frame", () => {
    const cam: Camera = { yaw: D(25), pitch: D(-5), fov: DEFAULT_FOV };
    const p = projectHotspot({ yaw: D(25), pitch: D(-5) }, W, H, cam);
    assert.ok(p);
    near(p.x, W / 2, 1e-6);
    near(p.y, H / 2, 1e-6);
  });

  test("a hotspot behind the camera is not drawn", () => {
    const cam: Camera = { yaw: 0, pitch: 0, fov: DEFAULT_FOV };
    assert.equal(projectHotspot({ yaw: Math.PI, pitch: 0 }, W, H, cam), null);
    assert.equal(projectHotspot({ yaw: D(150), pitch: 0 }, W, H, cam), null);
  });

  test("a hotspot just off the edge is culled, and the margin lets it back in", () => {
    const cam: Camera = { yaw: 0, pitch: 0, fov: D(60) };
    // Half the horizontal fov for this aspect, plus a nudge.
    const halfH = Math.atan2(W / 2, focalLength(H, cam.fov));
    const outside = { yaw: halfH + D(1.5), pitch: 0 };
    assert.equal(projectHotspot(outside, W, H, cam), null);
    assert.ok(projectHotspot(outside, W, H, cam, 400));
  });

  test("turning toward a hotspot moves it across the frame monotonically", () => {
    const target = { yaw: D(40), pitch: 0 };
    let prev = Infinity;
    for (const yaw of [0, D(10), D(20), D(30), D(40)]) {
      const p = projectHotspot(target, W, H, { yaw, pitch: 0, fov: DEFAULT_FOV });
      assert.ok(p, `lost the hotspot at yaw ${yaw}`);
      const offset = Math.abs(p.x - W / 2);
      assert.ok(offset < prev, `hotspot did not converge: ${offset} >= ${prev}`);
      prev = offset;
    }
  });

  test("the shortest turn is taken across the seam", () => {
    near(shortestYawDelta(D(170), D(-170)), D(20), 1e-9);
    near(shortestYawDelta(D(-170), D(170)), D(-20), 1e-9);
    near(shortestYawDelta(0, D(90)), D(90), 1e-9);
  });
});

/* ------------------------------------------------------------------ */
/* The UI can only point at scenes the generator has actually produced. */
/* ------------------------------------------------------------------ */

type Manifest = {
  width: number;
  height: number;
  scenes: { id: string; path: string }[];
};

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, "public/showcase/panoramas/manifest.json");

describe("generated panorama manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as Manifest;
  const byId = new Map(manifest.scenes.map((s) => [s.id, s]));

  test("the manifest is 2048x1024 equirectangular", () => {
    assert.equal(manifest.width, 2048);
    assert.equal(manifest.height, 1024);
    assert.equal(manifest.width / manifest.height, 2, "equirectangular sources must be 2:1");
  });

  test("scenes referenced by the UI exist in the manifest, on disk, and are unique", () => {
    const seen = new Set<string>();
    let count = 0;
    for (const tour of PANO_TOURS) {
      assert.ok(tour.scenes.length > 0, `${tour.id} has no scenes`);
      for (const scene of tour.scenes) {
        count++;
        assert.ok(!seen.has(scene.id), `duplicate scene id ${scene.id}`);
        seen.add(scene.id);

        const entry = byId.get(scene.id);
        assert.ok(entry, `scene ${scene.id} is referenced by the UI but was never generated`);
        assert.equal(scene.image, entry.path, `scene ${scene.id} points at the wrong file`);
        assert.ok(
          fs.existsSync(path.join(ROOT, "public", scene.image)),
          `missing panorama file for ${scene.id}: ${scene.image}`,
        );
      }
    }
    assert.ok(count >= 10, `expected at least 10 scenes, found ${count}`);
  });

  test("every hotspot target is a scene inside the same tour", () => {
    for (const tour of PANO_TOURS) {
      const ids = new Set(tour.scenes.map((s) => s.id));
      for (const scene of tour.scenes) {
        for (const h of scene.hotspots) {
          if (!h.targetSceneId) continue;
          assert.ok(
            ids.has(h.targetSceneId),
            `${scene.id} hotspot ${h.id} points outside its tour: ${h.targetSceneId}`,
          );
          assert.notEqual(h.targetSceneId, scene.id, `${scene.id} links to itself`);
        }
      }
    }
  });

  test("hotspot angles are inside the camera's own limits", () => {
    for (const tour of PANO_TOURS) {
      for (const scene of tour.scenes) {
        for (const h of scene.hotspots) {
          assert.equal(normalizeYaw(h.yaw), normalizeYaw(normalizeYaw(h.yaw)));
          assert.equal(clampPitch(h.pitch), h.pitch, `${h.id} pitch is past the clamp`);
          assert.ok(h.label.length > 0, `${h.id} has no label`);
        }
      }
    }
  });

  test("every room in a tour is reachable from its first scene", () => {
    for (const tour of PANO_TOURS) {
      const byIdLocal = new Map(tour.scenes.map((s) => [s.id, s]));
      const seen = new Set<string>([tour.scenes[0].id]);
      const queue = [tour.scenes[0].id];
      while (queue.length) {
        const cur = byIdLocal.get(queue.shift()!)!;
        for (const h of cur.hotspots) {
          if (h.targetSceneId && !seen.has(h.targetSceneId)) {
            seen.add(h.targetSceneId);
            queue.push(h.targetSceneId);
          }
        }
      }
      assert.equal(
        seen.size,
        tour.scenes.length,
        `${tour.id}: ${tour.scenes.length - seen.size} room(s) cannot be walked to`,
      );
    }
  });
});

describe("tour lookup", () => {
  test("Onyx units 2 and 3 have a tour, the rest honestly have none", () => {
    assert.equal(onyxTourForUnit("1202")?.id, "onyx-unit-2");
    assert.equal(onyxTourForUnit("0503")?.id, "onyx-unit-3");
    for (const n of ["1201", "1204", "1205", "1206", "1207"]) {
      assert.equal(onyxTourForUnit(n), undefined, `unit ${n} should not claim a tour`);
    }
  });

  test("only the 267 sq yds east facing villa type has a tour", () => {
    assert.equal(serenityTourForPlot(267, "East")?.id, "serenity-267-east");
    assert.equal(serenityTourForPlot(267)?.id, "serenity-267-east");
    assert.equal(serenityTourForPlot(267, "West"), undefined);
    assert.equal(serenityTourForPlot(200, "East"), undefined);
    assert.equal(serenityTourForPlot(300, "East"), undefined);
  });
});
