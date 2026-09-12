"use strict";
/**
 * The panorama's paint step and its frame scheduler, lifted out of the React
 * component so both can be tested without a browser.
 *
 * Why this lives here: the viewer once shipped a scheduler whose "one frame in
 * flight" guard could latch. Cancelling the pending frame (on unmount, or on
 * React StrictMode's simulated unmount/remount in development) cancelled the
 * callback that was the only thing that ever cleared the guard, so every later
 * schedule() returned immediately and the canvas stayed blank forever while the
 * component still reported itself ready. That is a scheduling bug, not a
 * rendering bug, and it is only catchable by a test if the scheduling is
 * reachable without a DOM.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.canPaint = canPaint;
exports.paintPanorama = paintPanorama;
exports.createFrameLoop = createFrameLoop;
const panorama_1 = require("./panorama");
/**
 * True when there is enough to draw a frame. Kept separate so "ready but blank"
 * is an assertable condition rather than an early `return` buried in a closure.
 */
function canPaint(canvas, src, size) {
    return Boolean(canvas) && Boolean(src) && size.w >= 2 && size.h >= 2;
}
/**
 * Reproject the equirectangular source into a perspective frame.
 *
 * For every output pixel we take the ray through it, rotate it by pitch then
 * yaw, turn it into a latitude/longitude and sample the source. The per-row
 * part of the rotation is hoisted so the inner loop is three multiply-adds, an
 * atan2/asin pair and one array read.
 */
function paintPanorama(ctx, size, cam, src) {
    const { w, h } = size;
    const out = ctx.createImageData(w, h);
    const out32 = new Uint32Array(out.data.buffer);
    const { data, width: sw, height: sh } = src;
    const f = (0, panorama_1.focalLength)(h, cam.fov);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const halfW = w / 2;
    const halfH = h / 2;
    const uScale = sw / (Math.PI * 2);
    const vScale = sh / Math.PI;
    for (let py = 0; py < h; py++) {
        const ry = -(py - halfH);
        const ay = ry * cp + f * sp;
        const az = -ry * sp + f * cp;
        const rowBase = py * w;
        for (let px = 0; px < w; px++) {
            const ax = px - halfW;
            const wx = ax * cy + az * sy;
            const wz = -ax * sy + az * cy;
            const len = Math.sqrt(wx * wx + ay * ay + wz * wz);
            const u = (Math.atan2(wx, wz) + Math.PI) * uScale;
            const v = (Math.PI / 2 - Math.asin(ay / len)) * vScale;
            let sx = u | 0;
            if (sx < 0)
                sx += sw;
            else if (sx >= sw)
                sx -= sw;
            let sy2 = v | 0;
            if (sy2 < 0)
                sy2 = 0;
            else if (sy2 >= sh)
                sy2 = sh - 1;
            out32[rowBase + px] = data[sy2 * sw + sx];
        }
    }
    ctx.putImageData(out, 0, 0);
}
/**
 * A single-frame-in-flight scheduler that cannot latch.
 *
 * `tick` is invoked with no arguments and may call `schedule()` again to keep a
 * momentum animation alive; when it does not, the loop goes completely quiet —
 * there is no standing requestAnimationFrame.
 */
function createFrameLoop(tick, raf, caf) {
    // Resolved lazily rather than as default parameters: this module is imported
    // by a "use client" component that Next still renders on the server, where
    // requestAnimationFrame does not exist.
    const req = raf ??
        ((cb) => typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame(cb)
            : setTimeout(cb, 16));
    const cancelReq = caf ??
        ((n) => {
            if (typeof cancelAnimationFrame === 'function')
                cancelAnimationFrame(n);
            else
                clearTimeout(n);
        });
    let id = null;
    return {
        schedule() {
            if (id !== null)
                return;
            id = req(() => {
                // Cleared BEFORE the body so a schedule() made from inside tick() is
                // accepted, and so a throw cannot leave the guard latched.
                id = null;
                tick();
            });
        },
        cancel() {
            if (id !== null)
                cancelReq(id);
            id = null;
        },
        get pending() {
            return id !== null;
        },
    };
}
