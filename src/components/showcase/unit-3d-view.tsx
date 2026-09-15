"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, RotateCcw } from "lucide-react";
import { drawnArea, unitGeometry, type RoomBox, type RoomKind } from "@/lib/showcase/onyx-unit-geometry";

/**
 * THE 3D CUTAWAY — a doll's-house view of one apartment.
 *
 * Built with CSS 3D transforms rather than a WebGL library. The geometry is
 * seventeen boxes; pulling in three.js for that would add hundreds of
 * kilobytes to a page a buyer opens on a phone, and rule out every device
 * where WebGL is blocked. Transforms composite on the GPU, so this stays
 * smooth while remaining ordinary DOM — each room is a real element, which is
 * why it can be focused, tabbed to and read aloud. A canvas gives you none of
 * that.
 *
 * WHAT IS DRAWN
 *
 * Only what the approved plan sheet shows: each room at its printed size and
 * drawn position. There is no furniture, because we do not have the interior
 * drawings and inventing them would be showing a buyer a room that does not
 * exist. What this answers is the question a plan sheet is bad at — how the
 * rooms sit together, and what you walk past to reach the master bedroom.
 *
 * THE LOOK
 *
 * Warm light pooling inside each room against a cool dark surround, a low
 * camera that settles into an overhead three-quarter, and a soft contact
 * shadow. That reads as a lit home at dusk rather than a diagram, which is the
 * whole point: the same geometry drawn flat and grey is ignored.
 */

/* Wall height in feet. Real floor-to-floor is ~10ft; the cutaway uses a lower
   wall so every room stays visible from one angle. */
const WALL_FT = 4.6;

/**
 * Per-room materials.
 *
 * `lamp` is the warm pool cast on the floor, `floor` the material under it.
 * Living spaces and bedrooms are lit warm; baths and service rooms get a
 * cooler, dimmer pool, which is both how these rooms are actually lit and a
 * useful way to read the plan at a glance.
 */
/**
 * Three materials, not one hue per room type.
 *
 * Twelve slightly different browns read as a rendering mistake; wood, stone and
 * deck read as a specification. Which is also the truth — these are the three
 * floor finishes in the spec.
 */
const MATERIAL: Record<RoomKind, { floor: string; dark: string; glow: string }> = {
  living:  { floor: "#A9764A", dark: "#6E4A2D", glow: "rgba(255,186,96,0.50)" },
  bedroom: { floor: "#A9764A", dark: "#6E4A2D", glow: "rgba(255,172,104,0.44)" },
  kitchen: { floor: "#B9BCC1", dark: "#82878D", glow: "rgba(255,206,150,0.40)" },
  service: { floor: "#9BA0A8", dark: "#686D75", glow: "rgba(150,180,220,0.22)" },
  bath:    { floor: "#B9BCC1", dark: "#82878D", glow: "rgba(140,200,215,0.26)" },
  outdoor: { floor: "#6E7A63", dark: "#454E41", glow: "rgba(120,180,140,0.20)" },
};

/**
 * ONE light for the whole home, high to the north-west.
 *
 * Every room previously carried an identical centred glow, which at seventeen
 * repetitions read as a repeated CSS token rather than as light. Here each room
 * takes its share from where its centre falls relative to a single source, so
 * the plate is bright at the living end and falls away towards the utility
 * corner — which is what makes it look lit rather than coloured in.
 *
 * Computed per room rather than painted as an overlay plane: a plane above the
 * geometry flattens the walls it covers and slices through anything standing
 * proud of the floor.
 */
const LIGHT = { x: 0.3, y: 0.25 };

function lightAt(room: RoomBox, extent: { w: number; h: number }): number {
  const cx = (room.x + room.w / 2) / extent.w;
  const cy = (room.y + room.h / 2) / extent.h;
  const d = Math.hypot(cx - LIGHT.x, cy - LIGHT.y) / 1.25;
  return Math.max(0, Math.min(1, 1 - d * d * 1.15));
}

/** Room names worth labelling on the model. The rest answer on hover. */
const PRIMARY_ROOMS = new Set(["Living", "Master bedroom", "Drawing", "Dining", "Kitchen"]);

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

/** Where the camera comes to rest. */
const RESTING: Camera = { pitch: 50, yaw: -34, zoom: 1.06 };
/** Where it starts before settling — lower and further round, so the move reads. */
const OPENING: Camera = { pitch: 28, yaw: -62, zoom: 0.88 };
const SETTLE_MS = 1900;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

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
  const [camera, setCamera] = useState<Camera>(OPENING);
  const [hover, setHover] = useState<string | null>(null);
  const [only, setOnly] = useState<RoomKind | null>(null);
  /** 0 = flat plan, 1 = walls fully up. Driven by the slider and by the wheel. */
  const [reveal, setReveal] = useState(0);
  const [settling, setSettling] = useState(true);

  const stage = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  /** Set the moment a person touches the model, so the intro never fights them. */
  const touched = useRef(false);

  /**
   * The opening move: the camera rises from a low three-quarter to its resting
   * overhead while the walls come up under it.
   *
   * Driven by requestAnimationFrame rather than a CSS transition because two
   * different things are being eased against the same clock, and because it has
   * to be abandonable — the first drag or wheel cancels it mid-flight instead of
   * fighting the person for the next second and a half.
   */
  useEffect(() => {
    if (!geometry) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setCamera(RESTING);
      setReveal(1);
      setSettling(false);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (touched.current) { setSettling(false); return; }
      const t = Math.min(1, (now - start) / SETTLE_MS);
      const e = easeOutCubic(t);
      setCamera({
        pitch: OPENING.pitch + (RESTING.pitch - OPENING.pitch) * e,
        yaw: OPENING.yaw + (RESTING.yaw - OPENING.yaw) * e,
        zoom: OPENING.zoom + (RESTING.zoom - OPENING.zoom) * e,
      });
      // Walls finish a little before the camera does, so the model is whole by
      // the time it comes to rest.
      setReveal(Math.min(1, easeOutCubic(Math.min(1, t * 1.25))));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setSettling(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [geometry]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    touched.current = true;
    setSettling(false);
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
      pitch: Math.min(88, Math.max(20, d.pitch - (e.clientY - d.y) * 0.3)),
    }));
  }, []);

  const endDrag = useCallback(() => { drag.current = null; }, []);

  /**
   * The wheel raises and lowers the walls rather than scrolling the page.
   *
   * Non-passive and registered by hand: React's onWheel is passive and cannot
   * call preventDefault, without which the page scrolls out from under the
   * model the moment anyone tries to use it.
   */
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = true;
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
            units whose sheet has been transcribed appear here — the rest show the
            sheet itself on the Plan tab, rather than a layout we guessed.
          </p>
        </div>
      </div>
    );
  }

  const { extent, rooms, entry } = geometry;
  const unitPx = 12;
  const drawn = drawnArea(geometry);
  const W = extent.w * unitPx;
  const H = extent.h * unitPx;

  const kinds = [...new Set(rooms.map((r) => r.kind))];
  const active = rooms.find((r) => roomKey(r) === hover) ?? null;

  return (
    <div className="flex h-full min-h-[380px] flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setOnly(null)} className={chip(only === null)}>
          All rooms
        </button>
        {kinds.map((k) => (
          <button key={k} type="button" onClick={() => setOnly(only === k ? null : k)} className={chip(only === k)}>
            <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: MATERIAL[k].floor }} />
            {KIND_LABEL[k]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { touched.current = false; setSettling(true); setCamera(OPENING); setReveal(0);
            // Re-running the intro is the clearest "reset": it puts the camera
            // back and re-explains the model in one gesture.
            const start = performance.now();
            const tick = (now: number) => {
              if (touched.current) { setSettling(false); return; }
              const t = Math.min(1, (now - start) / SETTLE_MS);
              const e = easeOutCubic(t);
              setCamera({
                pitch: OPENING.pitch + (RESTING.pitch - OPENING.pitch) * e,
                yaw: OPENING.yaw + (RESTING.yaw - OPENING.yaw) * e,
                zoom: OPENING.zoom + (RESTING.zoom - OPENING.zoom) * e,
              });
              setReveal(Math.min(1, easeOutCubic(Math.min(1, t * 1.25))));
              if (t < 1) requestAnimationFrame(tick); else setSettling(false);
            };
            requestAnimationFrame(tick);
          }}
          className={`${chip(false)} ml-auto`}
          title="Replay the opening move"
        >
          <RotateCcw className="mr-1 inline size-3" aria-hidden /> Replay
        </button>
      </div>

      <div
        ref={stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-xl border border-ink-700 shadow-[inset_0_0_180px_60px_rgba(2,4,10,0.85)] active:cursor-grabbing"
        style={{
          perspective: "1200px",
          // Cool dusk surround. The warm rooms only read as lit because
          // everything around them is cold and dark.
          background:
            "radial-gradient(ellipse at 42% 30%, #1E2A45 0%, #0A0F1C 55%, #05080F 100%)",
        }}
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
              `translate(${-W / 2}px, ${-H / 2}px)`,
            // While settling, rAF already supplies every frame; a transition on
            // top of it would lag one step behind and read as rubber-banding.
            transition: drag.current || settling ? "none" : "transform 260ms cubic-bezier(.22,.61,.36,1)",
          }}
        >
          {/* Contact shadow, sitting just under the slab. */}
          <div
            className="absolute"
            style={{
              left: -W * 0.06,
              top: -H * 0.06,
              width: W * 1.12,
              height: H * 1.12,
              transform: "translateZ(-14px)",
              background: "rgba(3,6,16,0.8)",
              borderRadius: 48,
              filter: "blur(42px)",
            }}
          />

          {/* Slab: a thin plinth the rooms stand on. */}
          <div
            className="absolute rounded-[3px]"
            style={{
              width: W,
              height: H,
              transform: "translateZ(-3px)",
              background: "linear-gradient(150deg, #6B6153 0%, #413A31 100%)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.10), inset 0 0 70px rgba(0,0,0,0.55)",
            }}
          />

          {rooms.map((r) => (
            <Room
              key={roomKey(r)}
              room={r}
              unitPx={unitPx}
              reveal={reveal}
              dimmed={only !== null && r.kind !== only}
              hovered={hover === roomKey(r)}
              onHover={setHover}
              pitch={camera.pitch}
              yaw={camera.yaw}
              extent={extent}
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
                boxShadow: "0 0 14px rgba(245,197,66,0.8)",
                transform: `translateZ(${WALL_FT * unitPx * reveal + 4}px) rotateZ(${-camera.yaw}deg) rotateX(${-camera.pitch}deg)`,
              }}
              title="Entry"
            >
              ▼
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute left-3 top-3 max-w-[60%]">
          {active ? (
            <>
              <div className="text-[15px] font-semibold text-white drop-shadow">{active.name}</div>
              {active.label && <div className="text-[12px] text-white/70">{active.label}</div>}
              <div className="text-[11px] text-white/50">{Math.round(active.w * active.h)} sq ft drawn</div>
            </>
          ) : (
            <>
              <div className="text-[15px] font-semibold text-white drop-shadow">
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

        <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <Maximize2 className="size-3 text-white/50" aria-hidden />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(reveal * 100)}
            onChange={(e) => { touched.current = true; setReveal(Number(e.target.value) / 100); }}
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

/** One room: a lit floor with four walls standing on its edges. */
function Room({
  room,
  unitPx,
  reveal,
  dimmed,
  hovered,
  onHover,
  pitch,
  yaw,
  extent,
}: {
  room: RoomBox;
  unitPx: number;
  reveal: number;
  dimmed: boolean;
  hovered: boolean;
  onHover: (key: string | null) => void;
  pitch: number;
  yaw: number;
  extent: { w: number; h: number };
}) {
  const m = MATERIAL[room.kind];
  const light = lightAt(room, extent);
  const w = room.w * unitPx;
  const h = room.h * unitPx;
  const wall = WALL_FT * unitPx * reveal;
  const key = roomKey(room);

  /** Walls are lit from the north-west, so each side takes a different value. */
  const faceStyle = (brightness: number, extra: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    // Dark at the base, body up the face, pale cap in the last 7% — the cap is
    // what makes the extrusion read as architecture rather than as an outline.
    background:
      "linear-gradient(to top, #141922 0%, #252C38 40%, #39424F 86%, #AEB5BF 93%, #D8DDE4 100%)",
    // Every face is also modulated by the one light, so a wall in the far
    // corner is dimmer than the same wall beside the living room.
    filter: `brightness(${(brightness * (0.75 + 0.35 * light)).toFixed(3)})`,
    opacity: dimmed ? 0.1 : 1,
    transition: "opacity 220ms, height 220ms cubic-bezier(.22,.61,.36,1)",
    backfaceVisibility: "hidden",
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
        transform: `translateZ(${hovered ? 7 : 0}px)`,
        transition: "transform 200ms cubic-bezier(.22,.61,.36,1)",
      }}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
      tabIndex={0}
      aria-label={`${room.name}${room.label ? `, ${room.label}` : ""}`}
    >
      {/* Floor: material, then a warm pool of light, then edge occlusion. */}
      <div
        className="absolute inset-0 overflow-hidden rounded-[1px]"
        style={{
          background:
            `linear-gradient(205deg, rgba(255,232,198,${(0.1 + 0.55 * light).toFixed(3)}) 0%, ` +
            `rgba(0,0,0,${(0.34 - 0.26 * light).toFixed(3)}) 100%), ` +
            `linear-gradient(160deg, ${m.floor} 0%, ${m.dark} 100%)`,
          filter: `brightness(${(0.72 + 0.5 * light).toFixed(3)})`,
          opacity: dimmed ? 0.14 : 1,
          // Ambient occlusion: rooms darken into their corners and under the
          // wall they meet, which is most of what stops this reading as paper.
          boxShadow: hovered
            ? `inset 0 0 0 2px #F5C542, inset 0 0 28px ${m.glow}`
            : "inset 0 0 26px 6px rgba(10,14,26,0.40), inset 0 7px 12px -6px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.35)",
          transition: "opacity 220ms, box-shadow 160ms",
        }}
      />

      {/*
        Label, counter-rotated to face the viewer and lifted CLEAR of the walls.
        Pinned to the floor it was painted over by whichever neighbouring room
        happened to come later in the DOM — sibling ordering inside preserve-3d
        is not reliably geometric — so half the names were sliced in two. Above
        the wall line nothing can occlude it, and the pill keeps it legible
        against any floor colour underneath.
      */}
      {!dimmed && PRIMARY_ROOMS.has(room.name) && (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center"
          style={{ transform: `translateZ(${wall + 8}px) rotateZ(${-yaw}deg) rotateX(${-pitch}deg)` }}
        >
          <span
            className="select-none whitespace-nowrap rounded-full px-1.5 py-0.5 font-semibold leading-none text-white"
            style={{
              fontSize: Math.max(9, Math.min(12, w / 7)),
              background: "rgba(8,12,18,0.72)",
              boxShadow: "0 1px 6px rgba(0,0,0,0.5)",
            }}
          >
            {room.name}
          </span>
        </div>
      )}

      {/* Four walls, each hinged along one edge of the floor. */}
      <div style={faceStyle(1.08, { left: 0, top: 0, width: w, height: wall, transformOrigin: "top", transform: "rotateX(-90deg)" })} />
      <div style={faceStyle(0.62, { left: 0, top: h, width: w, height: wall, transformOrigin: "top", transform: "rotateX(-90deg)" })} />
      <div style={faceStyle(0.94, { left: 0, top: 0, width: h, height: wall, transformOrigin: "top left", transform: "rotate(90deg) rotateX(-90deg)" })} />
      <div style={faceStyle(0.72, { left: w, top: 0, width: h, height: wall, transformOrigin: "top left", transform: "rotate(90deg) rotateX(-90deg)" })} />
    </div>
  );
}
