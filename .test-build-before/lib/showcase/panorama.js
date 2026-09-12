"use strict";
/**
 * Pure maths for the equirectangular panorama viewer.
 *
 * No DOM, no React — everything here is a plain function so the projection can
 * be unit-tested and so the viewer component stays a thin shell around it.
 *
 * Conventions
 * -----------
 * - `yaw`   radians, 0 looks at the horizontal centre of the source image
 *           (u = 0.5) and grows to the right. Normalised to (-PI, PI].
 * - `pitch` radians, 0 is the horizon, positive looks up. Clamped so the
 *           camera can never flip over the pole.
 * - `fov`   *vertical* field of view in radians.
 * - Screen pixels are canvas pixels: x to the right, y downwards, origin at
 *   the top-left corner.
 * - World axes: +x right, +y up, +z forward (into the screen at yaw = pitch = 0).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FOV = exports.MAX_FOV = exports.MIN_FOV = exports.MAX_PITCH = exports.TWO_PI = void 0;
exports.normalizeYaw = normalizeYaw;
exports.clampPitch = clampPitch;
exports.clampFov = clampFov;
exports.clampCamera = clampCamera;
exports.focalLength = focalLength;
exports.screenToDirection = screenToDirection;
exports.directionToScreen = directionToScreen;
exports.anglesToDirection = anglesToDirection;
exports.directionToAngles = directionToAngles;
exports.directionToUv = directionToUv;
exports.uvToDirection = uvToDirection;
exports.projectHotspot = projectHotspot;
exports.shortestYawDelta = shortestYawDelta;
exports.dragToCamera = dragToCamera;
exports.zoomFov = zoomFov;
exports.TWO_PI = Math.PI * 2;
/** Hard stop short of the poles: at exactly +-90 deg the up-vector degenerates. */
exports.MAX_PITCH = (85 * Math.PI) / 180;
/** Zoom limits. Wider than 100 deg fisheyes the room; tighter than 30 deg is a crop. */
exports.MIN_FOV = (30 * Math.PI) / 180;
exports.MAX_FOV = (100 * Math.PI) / 180;
exports.DEFAULT_FOV = (75 * Math.PI) / 180;
/** Wrap any angle into (-PI, PI]. */
function normalizeYaw(yaw) {
    if (!Number.isFinite(yaw))
        return 0;
    let a = yaw % exports.TWO_PI;
    if (a > Math.PI)
        a -= exports.TWO_PI;
    if (a <= -Math.PI)
        a += exports.TWO_PI;
    // `-PI` maps to `+PI` so the range is half-open and round-trips are stable.
    return Object.is(a, -0) ? 0 : a;
}
/** Clamp pitch to the safe band; NaN falls back to the horizon. */
function clampPitch(pitch) {
    if (!Number.isFinite(pitch))
        return 0;
    return Math.min(exports.MAX_PITCH, Math.max(-exports.MAX_PITCH, pitch));
}
/** Clamp the vertical field of view to the usable zoom range. */
function clampFov(fov) {
    if (!Number.isFinite(fov))
        return exports.DEFAULT_FOV;
    return Math.min(exports.MAX_FOV, Math.max(exports.MIN_FOV, fov));
}
/** Apply both clamps and the yaw wrap in one go. */
function clampCamera(cam) {
    return {
        yaw: normalizeYaw(cam.yaw),
        pitch: clampPitch(cam.pitch),
        fov: clampFov(cam.fov),
    };
}
/**
 * Focal length in pixels for a viewport `height` px tall at this vertical fov.
 * Everything else in the projection is derived from this one number.
 */
function focalLength(height, fov) {
    return height / 2 / Math.tan(clampFov(fov) / 2);
}
/**
 * Direction the given canvas pixel looks at, in world space (unit length).
 * This is the forward half of the projection: the render loop walks every
 * pixel through it and samples the equirectangular source at the result.
 */
function screenToDirection(x, y, width, height, cam) {
    const f = focalLength(height, cam.fov);
    // Camera-space ray. Screen y grows downwards, world y grows up.
    const cx = x - width / 2;
    const cy = -(y - height / 2);
    const cz = f;
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    // Rotate about X by pitch: positive pitch tips the forward axis upward.
    const px = cx;
    const py = cy * cp + cz * sp;
    const pz = -cy * sp + cz * cp;
    const cyw = Math.cos(cam.yaw);
    const syw = Math.sin(cam.yaw);
    // Rotate about Y by yaw.
    const wx = px * cyw + pz * syw;
    const wy = py;
    const wz = -px * syw + pz * cyw;
    const len = Math.hypot(wx, wy, wz) || 1;
    return { x: wx / len, y: wy / len, z: wz / len };
}
/**
 * Inverse of {@link screenToDirection}. Returns `null` when the direction is
 * behind the camera (or exactly on the image plane), which is what the hotspot
 * layer uses to decide whether a pin is on screen at all.
 */
function directionToScreen(dir, width, height, cam) {
    const f = focalLength(height, cam.fov);
    const cyw = Math.cos(-cam.yaw);
    const syw = Math.sin(-cam.yaw);
    // Undo yaw.
    const ux = dir.x * cyw + dir.z * syw;
    const uy = dir.y;
    const uz = -dir.x * syw + dir.z * cyw;
    const cp = Math.cos(-cam.pitch);
    const sp = Math.sin(-cam.pitch);
    // Undo pitch.
    const vx = ux;
    const vy = uy * cp + uz * sp;
    const vz = -uy * sp + uz * cp;
    if (vz <= 1e-9)
        return null;
    return { x: width / 2 + (f * vx) / vz, y: height / 2 - (f * vy) / vz };
}
/** Unit direction for a yaw/pitch pair. */
function anglesToDirection(yaw, pitch) {
    const cp = Math.cos(pitch);
    return { x: cp * Math.sin(yaw), y: Math.sin(pitch), z: cp * Math.cos(yaw) };
}
/** Yaw/pitch of a direction. Inverse of {@link anglesToDirection}. */
function directionToAngles(dir) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    return {
        yaw: normalizeYaw(Math.atan2(dir.x / len, dir.z / len)),
        pitch: Math.asin(Math.min(1, Math.max(-1, dir.y / len))),
    };
}
/**
 * Equirectangular texture coordinates for a direction.
 * `u` runs 0..1 left-to-right, `v` runs 0..1 top (zenith) to bottom (nadir).
 */
function directionToUv(dir) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const u = 0.5 + Math.atan2(dir.x / len, dir.z / len) / exports.TWO_PI;
    const v = 0.5 - Math.asin(Math.min(1, Math.max(-1, dir.y / len))) / Math.PI;
    return { u: u - Math.floor(u), v: Math.min(1, Math.max(0, v)) };
}
/** Inverse of {@link directionToUv}. */
function uvToDirection(u, v) {
    const yaw = (u - 0.5) * exports.TWO_PI;
    const pitch = (0.5 - v) * Math.PI;
    return anglesToDirection(yaw, pitch);
}
/**
 * Where a hotspot lands on screen, or `null` when it is out of frame.
 * `margin` (px) lets the caller keep pins that are just past the edge, so a pin
 * does not pop as it crosses the border.
 */
function projectHotspot(hotspot, width, height, cam, margin = 0) {
    const p = directionToScreen(anglesToDirection(hotspot.yaw, hotspot.pitch), width, height, cam);
    if (!p)
        return null;
    if (p.x < -margin || p.x > width + margin)
        return null;
    if (p.y < -margin || p.y > height + margin)
        return null;
    return p;
}
/**
 * Shortest signed distance from `from` to `to` around the yaw circle.
 * Used to animate between scenes without spinning the long way round.
 */
function shortestYawDelta(from, to) {
    return normalizeYaw(to - from);
}
/**
 * Drag in screen pixels converted into a camera rotation.
 * The scale is tied to the focal length so a drag tracks the pixel under the
 * pointer at any zoom level, which is what makes the interaction feel direct.
 */
function dragToCamera(dx, dy, width, height, cam) {
    void width;
    const f = focalLength(height, cam.fov);
    return clampCamera({
        yaw: cam.yaw - Math.atan2(dx, f),
        pitch: cam.pitch + Math.atan2(dy, f),
        fov: cam.fov,
    });
}
/** Multiplicative zoom step, clamped. `factor` < 1 zooms in (narrows the fov). */
function zoomFov(fov, factor) {
    return clampFov(fov * factor);
}
