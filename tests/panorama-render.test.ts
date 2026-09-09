import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { DEFAULT_FOV, type Camera } from "../src/lib/showcase/panorama";
import {
  canPaint,
  createFrameLoop,
  paintPanorama,
  type PanoContext2D,
  type PanoSource,
} from "../src/lib/showcase/panorama-render";

/** A 4x2 source whose every pixel is a distinct non-zero colour. */
function source(): PanoSource {
  const width = 4;
  const height = 2;
  const data = new Uint32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = 0xff000000 | (i + 1) * 0x010101;
  return { data, width, height };
}

/** Records what the viewer would have drawn, without a canvas. */
function recorder() {
  const calls: { created: number; put: number; last: Uint8ClampedArray | null } = {
    created: 0,
    put: 0,
    last: null,
  };
  const ctx: PanoContext2D = {
    createImageData(w, h) {
      calls.created++;
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(image) {
      calls.put++;
      calls.last = image.data;
    },
  };
  return { ctx, calls };
}

/** A hand-driven requestAnimationFrame. */
function fakeRaf() {
  let next = 1;
  const queued = new Map<number, () => void>();
  return {
    raf: (cb: () => void) => {
      const id = next++;
      queued.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      queued.delete(id);
    },
    /** Run everything currently queued. */
    flush() {
      const now = [...queued.entries()];
      queued.clear();
      for (const [, cb] of now) cb();
      return now.length;
    },
    get size() {
      return queued.size;
    },
  };
}

const CAM: Camera = { yaw: 0, pitch: 0, fov: DEFAULT_FOV };

describe("canPaint", () => {
  test("needs a canvas, a decoded source and a sized viewport", () => {
    const src = source();
    assert.equal(canPaint({}, src, { w: 64, h: 36 }), true);
    assert.equal(canPaint(null, src, { w: 64, h: 36 }), false);
    assert.equal(canPaint({}, null, { w: 64, h: 36 }), false);
    assert.equal(canPaint({}, src, { w: 0, h: 0 }), false);
    assert.equal(canPaint({}, src, { w: 1, h: 1 }), false);
  });
});

describe("paintPanorama", () => {
  test("writes an opaque, non-empty frame", () => {
    const { ctx, calls } = recorder();
    paintPanorama(ctx, { w: 32, h: 18 }, CAM, source());
    assert.equal(calls.created, 1);
    assert.equal(calls.put, 1);
    const px = calls.last!;
    assert.equal(px.length, 32 * 18 * 4);
    assert.ok(px.some((v) => v !== 0), "the frame must not be blank");
  });
});

describe("frame loop", () => {
  test("coalesces repeated schedules into one frame", () => {
    const raf = fakeRaf();
    let ticks = 0;
    const loop = createFrameLoop(() => ticks++, raf.raf, raf.caf);
    loop.schedule();
    loop.schedule();
    loop.schedule();
    assert.equal(raf.size, 1);
    raf.flush();
    assert.equal(ticks, 1);
    assert.equal(loop.pending, false);
  });

  test("momentum can re-schedule from inside the tick", () => {
    const raf = fakeRaf();
    let ticks = 0;
    const loop = createFrameLoop(() => {
      ticks++;
      if (ticks < 3) loop.schedule();
    }, raf.raf, raf.caf);
    loop.schedule();
    raf.flush();
    raf.flush();
    raf.flush();
    assert.equal(ticks, 3);
    // ...and then goes quiet: no standing rAF.
    assert.equal(raf.size, 0);
  });

  test("REGRESSION: cancelling a pending frame does not latch the loop", () => {
    // The bug: the viewer cancelled its pending frame on unmount but left the
    // "one frame in flight" guard set. React StrictMode's mount/unmount/mount
    // therefore left every later schedule() a no-op, and the 360 canvas stayed
    // blank forever while the component still reported itself ready.
    const raf = fakeRaf();
    let ticks = 0;
    const loop = createFrameLoop(() => ticks++, raf.raf, raf.caf);
    loop.schedule();
    loop.cancel();
    assert.equal(loop.pending, false, "cancel must clear the in-flight guard");
    loop.schedule();
    raf.flush();
    assert.equal(ticks, 1, "a schedule after a cancel must still produce a frame");
  });

  test("a throwing tick does not latch the loop either", () => {
    const raf = fakeRaf();
    let ticks = 0;
    const loop = createFrameLoop(() => {
      ticks++;
      throw new Error("boom");
    }, raf.raf, raf.caf);
    loop.schedule();
    assert.throws(() => raf.flush());
    assert.equal(loop.pending, false);
    loop.schedule();
    assert.throws(() => raf.flush());
    assert.equal(ticks, 2);
  });
});

describe("the viewer paints without any user interaction", () => {
  /**
   * The end-to-end shape of the bug, in the units the component is built from:
   * a decoded image plus a sized canvas must produce a drawn frame on its own.
   * It is driven through a StrictMode-style mount / unmount / mount first,
   * because that is the sequence that used to leave the canvas blank.
   */
  test("decoded source + sized canvas => a frame, after a StrictMode remount", () => {
    const raf = fakeRaf();
    const { ctx, calls } = recorder();

    const canvas = {} as object;
    let src: PanoSource | null = null;
    const size = { w: 0, h: 0 };
    let painted = false;

    const loop = createFrameLoop(() => {
      if (!canPaint(canvas, src, size)) return;
      paintPanorama(ctx, size, CAM, src!);
      painted = true;
    }, raf.raf, raf.caf);

    // Mount: the element is measured, so a frame is asked for immediately.
    size.w = 64;
    size.h = 36;
    loop.schedule();

    // StrictMode tears the effects down and sets them up again.
    loop.cancel();
    loop.schedule();

    // The image finishes decoding. No pointer, wheel or key event happens.
    src = source();
    loop.schedule();
    raf.flush();

    assert.equal(painted, true, "a ready viewer must never be left blank");
    assert.equal(calls.put, 1);
    assert.ok(calls.last!.some((v) => v !== 0));
  });
});
