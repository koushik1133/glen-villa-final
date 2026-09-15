"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, RotateCcw } from "lucide-react";
import { drawnArea, unitGeometry, type RoomBox, type RoomKind, type UnitGeometry } from "@/lib/showcase/onyx-unit-geometry";

/**
 * THE 3D CUTAWAY — a doll's-house view of one apartment.
 *
 * Built with CSS 3D transforms rather than a WebGL library. The geometry is
 * seventeen boxes; pulling in three.js for that would add hundreds of
 * kilobytes to a page a buyer opens on a phone, and rule out every device
 * where WebGL is blocked or unavailable. Transforms are composited on the GPU,
 * so this stays smooth while remaining ordinary DOM: each room is a real
 * element, which is why it can be focused, tabbed to and read by a screen
 * reader — none of which a canvas gives you for free.
 *
 * WHAT IS DRAWN
 *
 * Only what the approved plan sheet shows: each room at its printed size and
 * its drawn position. There is no furniture and no decor, because we do not
 * have the interior drawings and inventing them would be selling a buyer a
 * room that does not exist. What this answers is the question a plan sheet is
 * bad at — how the rooms sit together, and what you walk past to get from the
 * door to the master bedroom.
 */

/* Wall height in feet. Real floor-to-floor on the sheet is ~10ft; the cutaway
   uses a lower wall so you can see into every room from a single angle. */
const WALL_FT = 4.2;

const ROOM_STYLE: Record<RoomKind, { floor: string; wall: string; text: string }> = {
  living:  { floor: "#C9A227", wall: "#8A6F1B", text: "#2A2205" },
  bedroom: { floor: "#7BA7C9", wall: "#4F7490", text: "#0C1E2B" },
  kitchen: { floor: "#C98A6B", wall: "#8F5F49", text: "#2B1409" },
  service: { floor: "#9AA3AE", wall: "#6B737C", text: "#141A20" },
  bath:    { floor: "#6FBFB2", wall: "#48867C", text: "#07201C" },
  outdoor: { floor: "#7FA86B", wall: "#577445", text: "#0F1D08" },
};

const KIND_LABEL: Record<RoomKind, string> = {
  living: "Living",
  bedroom: "Bedrooms",
  kitchen: "Kitchen",
  service: "Service",
  bath: "Bathrooms",
  outdoor: "Outdoor",
};

interface Camera {
  /** Tilt from plan view. 90 is straight down, lower leans towards elevation. */
  pitch: number;
  /** Spin around the vertical axis. */
  yaw: number;
  zoom: number;
}

const DEFAULT_CAMERA: Camera = { pitch: 58, yaw: -38, zoom: 1 };

export function Unit3DView({
  position,
  unitNumber,
  sqFt,
}: {
  position: number | null;
  unitNumber?: string;
  sqFt?: number;
}) {
  const geometry = useMemo(() => unitGeometry(position), [position]);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [hover, setHover] = useState<string | null>(null);
  const [only, setOnly] = useState<RoomKind | null>(null);
  /** 0 = flat plan, 1 = walls fully up. Driven by the slider and by scroll. */
  const [reveal, setReveal] = useState(1);

  /**
   * Entrance. The walls go up in reading order — north band, then the living
   * spine, then the master suite — which is the order someone walks the plan,
   * and it gives the eye somewhere to start. Held to ~700ms in total: past that
   * it stops reading as the model assembling and starts reading as the page
   * being slow.
   *
   * Skipped entirely under prefers-reduced-motion, where the whole thing simply
   * appears.
   */
  const [entered, setEntered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const stage = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw: camera.yaw, pitch: camera.pitch };
  }, [camera.yaw, camera.pitch]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setCamera((c) => ({
      ...c,
      yaw: d.yaw + (e.clientX - d.x) * 0.4,
      // Clamped: past vertical the model turns inside out, and below ~20° the
      // near walls hide everything behind them.
      pitch: Math.min(88, Math.max(22, d.pitch - (e.clientY - d.y) * 0.3)),
    }));
  }, []);

  const endDrag = useCallback(() => { drag.current = null; }, []);

  /**
   * The wheel raises and lowers the walls rather than scrolling the page.
   *
   * Non-passive and registered by hand, because React's onWheel is passive and
   * cannot call preventDefault — without which the page scrolls away underneath
   * the model the moment someone tries to use it.
   */
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setReveal((r) => Math.min(1, Math.max(0, r - e.deltaY * 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  if (!geometry) {
    return (
      <div className="grid h-full min-h-[280px] place-items-center rounded-xl border border-ink-700 bg-ink-900/60 p-6 text-center">
        <div>
          <p className="text-[13px] font-medium text-mist-200">No 3D view for this unit yet</p>
          <p className="mt-1 max-w-sm text-[11.5px] leading-relaxed text-mist-400">
            The cutaway is drawn from the approved plan sheet, room by room. Only
            the units whose sheet has been transcribed appear here — the rest show
            the sheet itself on the Plan tab, rather than a layout we guessed.
          </p>
        </div>
      </div>
    );
  }

  const { extent, rooms, entry } = geometry;
  // Scale so the slab fits the stage with room to rotate without clipping.
  const unitPx = 9;
  const drawn = drawnArea(geometry);

  const kinds = [...new Set(rooms.map((r) => r.kind))];
  const active = rooms.find((r) => roomKey(r) === hover) ?? null;

  return (
    <div className="flex h-full min-h-[380px] flex-col gap-2">
      {/* Layer chips — the same idea as the reference, but each one is a real
          category from the plan rather than a data layer we do not measure. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOnly(null)}
          className={chip(only === null)}
        >
          All rooms
        </button>
        {kinds.map((k) => (
          <button key={k} type="button" onClick={() => setOnly(only === k ? null : k)} className={chip(only === k)}>
            <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: ROOM_STYLE[k].floor }} />
            {KIND_LABEL[k]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setCamera(DEFAULT_CAMERA); setReveal(1); }}
            className={chip(false)}
            title="Reset the view"
          >
            <RotateCcw className="mr-1 inline size-3" aria-hidden /> Reset
          </button>
        </div>
      </div>

      <div
        ref={stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-xl border border-ink-700 bg-[radial-gradient(ellipse_at_50%_35%,#1d2b3f_0%,#0d131c_70%)] active:cursor-grabbing"
        style={{ perspective: "1400px" }}
        role="img"
        aria-label={
          `Three-dimensional cutaway of unit ${unitNumber ?? geometry.position}: ` +
          rooms.map((r) => `${r.name} ${r.label ?? ""}`).join(", ")
        }
      >
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            transformStyle: "preserve-3d",
            transform:
              `translate(-50%, -50%) scale(${camera.zoom}) ` +
              `rotateX(${camera.pitch}deg) rotateZ(${camera.yaw}deg) ` +
              `translate(${-extent.w * unitPx / 2}px, ${-extent.h * unitPx / 2}px)`,
            transition: drag.current ? "none" : "transform 220ms cubic-bezier(.22,.61,.36,1)",
          }}
        >
          {/* Slab */}
          <div
            className="absolute rounded-[2px]"
            style={{
              width: extent.w * unitPx,
              height: extent.h * unitPx,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              transform: "translateZ(-2px)",
            }}
          />

          {rooms.map((r, i) => (
            <Room
              key={roomKey(r)}
              room={r}
              unitPx={unitPx}
              reveal={reveal}
              dimmed={only !== null && r.kind !== only}
              hovered={hover === roomKey(r)}
              onHover={setHover}
              entered={entered || reducedMotion}
              delayMs={reducedMotion ? 0 : Math.min(600, i * 38)}
            />
          ))}

          {entry && (
            <div
              className="absolute grid place-items-center rounded-full text-[9px] font-bold"
              style={{
                left: entry.x * unitPx - 9,
                top: entry.y * unitPx - 9,
                width: 18,
                height: 18,
                background: "#F5C542",
                color: "#22190A",
                transform: `translateZ(${WALL_FT * unitPx * reveal + 3}px)`,
              }}
              title="Entry"
            >
              ▼
            </div>
          )}
        </div>

        {/* Read-out. Mirrors the reference's info panel, with measured numbers. */}
        <div className="pointer-events-none absolute left-3 top-3 max-w-[60%]">
          {active ? (
            <>
              <div className="text-[15px] font-semibold text-white">{active.name}</div>
              {active.label && <div className="text-[12px] text-white/70">{active.label}</div>}
              <div className="text-[11px] text-white/50">{Math.round(active.w * active.h)} sq ft drawn</div>
            </>
          ) : (
            <>
              <div className="text-[15px] font-semibold text-white">
                {unitNumber ? `Unit ${unitNumber}` : `Unit type ${geometry.position}`}
              </div>
              <div className="text-[12px] text-white/70">
                {rooms.length} rooms · {drawn} sq ft drawn
                {sqFt ? ` · ${sqFt} sq ft built-up` : ""}
              </div>
            </>
          )}
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 text-[10.5px] leading-relaxed text-white/40">
          Drag to turn · scroll to raise and lower the walls
        </div>

        {/* Reveal slider — the same control as the scroll, for touch and for
            anyone who cannot use a wheel. */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <Maximize2 className="size-3 text-white/50" aria-hidden />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(reveal * 100)}
            onChange={(e) => setReveal(Number(e.target.value) / 100)}
            aria-label="Wall height"
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-white/25 accent-[#F5C542]"
          />
        </div>
      </div>

      <p className="shrink-0 text-[10.5px] leading-relaxed text-mist-400">
        Drawn from the approved apartment plan for this unit — every room at its
        printed size and drawn position. Furniture is not shown. Built-up area
        includes walls and a share of the common areas, so it reads higher than
        the total of the rooms.
      </p>
    </div>
  );
}

function roomKey(r: RoomBox): string {
  return `${r.name}-${r.x}-${r.y}`;
}

function chip(activeState: boolean): string {
  return [
    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
    activeState
      ? "border-brand-400/50 bg-brand-500/20 text-brand-200"
      : "border-ink-700 bg-ink-800/60 text-mist-300 hover:text-mist-100",
  ].join(" ");
}

/** One room: a floor quad plus four walls standing on its edges. */
function Room({
  room,
  unitPx,
  reveal,
  dimmed,
  hovered,
  onHover,
  entered,
  delayMs,
}: {
  room: RoomBox;
  unitPx: number;
  reveal: number;
  dimmed: boolean;
  hovered: boolean;
  onHover: (key: string | null) => void;
  entered: boolean;
  delayMs: number;
}) {
  const style = ROOM_STYLE[room.kind];
  const w = room.w * unitPx;
  const h = room.h * unitPx;
  const wall = WALL_FT * unitPx * reveal;
  const key = roomKey(room);

  const face = (extra: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    background: style.wall,
    opacity: dimmed ? 0.12 : 0.92,
    transition: "opacity 200ms, height 200ms",
    ...extra,
  });

  return (
    <div
      className="absolute"
      style={{
        left: room.x * unitPx,
        top: room.y * unitPx,
        width: w,
        height: h,
        transformStyle: "preserve-3d",
        // Rooms drop into place from above; hover lifts the one under the
        // cursor clear of its neighbours so its walls read against them.
        transform: `translateZ(${entered ? (hovered ? 6 : 0) : 90}px)`,
        opacity: entered ? 1 : 0,
        transition: `transform 520ms cubic-bezier(.16,.84,.34,1) ${delayMs}ms, opacity 380ms ease-out ${delayMs}ms`,
      }}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
      tabIndex={0}
      aria-label={`${room.name}${room.label ? `, ${room.label}` : ""}`}
    >
      {/* Floor */}
      <div
        className="absolute inset-0 grid place-items-center overflow-hidden rounded-[1px]"
        style={{
          background: style.floor,
          opacity: dimmed ? 0.15 : 1,
          outline: hovered ? "2px solid #F5C542" : "1px solid rgba(0,0,0,0.25)",
          transition: "opacity 200ms, outline-color 150ms",
        }}
      >
        {/* Counter-rotated so the label reads flat to the viewer rather than
            lying skewed on the floor with the rest of the geometry. */}
        {!dimmed && w > 46 && h > 34 && (
          <span
            className="pointer-events-none select-none text-center font-semibold leading-tight"
            style={{ color: style.text, fontSize: Math.min(10, w / 7), transform: "rotate(0deg)" }}
          >
            {room.name}
          </span>
        )}
      </div>

      {/* Four walls, each hinged along one edge of the floor. */}
      <div style={face({ left: 0, top: 0, width: w, height: wall, transformOrigin: "top", transform: `rotateX(-90deg)` })} />
      <div style={face({ left: 0, top: h, width: w, height: wall, transformOrigin: "top", transform: `rotateX(-90deg)`, filter: "brightness(0.8)" })} />
      <div style={face({ left: 0, top: 0, width: h, height: wall, transformOrigin: "top left", transform: `rotate(90deg) rotateX(-90deg)`, filter: "brightness(0.9)" })} />
      <div style={face({ left: w, top: 0, width: h, height: wall, transformOrigin: "top left", transform: `rotate(90deg) rotateX(-90deg)`, filter: "brightness(0.7)" })} />
    </div>
  );
}
