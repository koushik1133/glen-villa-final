"use client";

/**
 * A real equirectangular 360 viewer — no three.js, no new dependencies.
 *
 * The image is reprojected per pixel into a perspective view on a <canvas>:
 * for every output pixel we take the ray through it, turn that into a
 * latitude/longitude on the sphere, and sample the source. That is what makes
 * it an actual panorama rather than a wide image being scrolled sideways.
 *
 * Performance notes, because a naive version of this drops frames:
 *  - the source is decoded once into a flat Uint32Array, so sampling is a
 *    single array read rather than a canvas op;
 *  - the per-row yaw/pitch basis is precomputed, so the inner loop is three
 *    multiply-adds and a lookup;
 *  - the backing store is capped at 2x CSS pixels;
 *  - and there is NO standing requestAnimationFrame loop. Frames are scheduled
 *    on interaction and while momentum is still alive, then it goes quiet.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Compass, Maximize2, Minimize2, RotateCcw, Loader2, ImageOff, DoorOpen,
} from "lucide-react";
import {
  DEFAULT_FOV,
  clampFov, clampPitch, focalLength, normalizeYaw, projectHotspot,
  type Camera, type PanoHotspot,
} from "@/lib/showcase/panorama";
import {
  canPaint, createFrameLoop, paintPanorama,
  type FrameLoop, type PanoSource,
} from "@/lib/showcase/panorama-render";

export type PanoramaScene = {
  id: string;
  title: string;
  image: string;
  initialYaw?: number;
  hotspots?: PanoHotspot[];
};

const MAX_DPR = 2;
/** Per-frame decay of the flick velocity. Tuned to coast for roughly a second. */
const FRICTION = 0.92;
const MIN_SPEED = 0.00012;

export function PanoramaViewer({
  scene,
  scenes,
  onSceneChange,
  className,
  /** Shown over the image so a schematic is never mistaken for a photograph. */
  watermark = "Schematic preview generated from the floor plan",
  caption,
  onCamera,
  overlay,
}: {
  scene: PanoramaScene;
  /** Other scenes reachable via hotspots. */
  scenes?: readonly PanoramaScene[];
  onSceneChange?: (id: string) => void;
  className?: string;
  watermark?: string | null;
  caption?: string;
  /**
   * Called on every painted frame with the live camera. Used by the Onyx tour
   * to keep its minimap cone pointing where the viewer is actually looking.
   */
  onCamera?: (cam: Camera) => void;
  /** Chrome drawn inside the viewport, so it follows into full screen. */
  overlay?: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<Camera>({ yaw: scene.initialYaw ?? 0, pitch: 0, fov: DEFAULT_FOV });
  const velRef = useRef({ yaw: 0, pitch: 0 });
  const imgRef = useRef<PanoSource | null>(null);
  const loopRef = useRef<FrameLoop | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  /** Set by the first frame that actually reached putImageData. */
  const paintedRef = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; fov: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  /** 0..1 while the source downloads; null when the size is not known. */
  const [progress, setProgress] = useState<number | null>(null);
  const onCameraRef = useRef(onCamera);
  onCameraRef.current = onCamera;
  const [full, setFull] = useState(false);
  // Hotspot pins live in React state; they are repainted at most once a frame.
  const [pins, setPins] = useState<{ h: PanoHotspot; x: number; y: number }[]>([]);
  const reduceMotion = usePrefersReducedMotion();
  const labelId = useId();

  const hotspots = useMemo(() => scene.hotspots ?? [], [scene.hotspots]);

  /* ---------------------------------------------------------------- */
  /* Source decode                                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setProgress(null);
    imgRef.current = null;
    paintedRef.current = false;
    camRef.current = { yaw: scene.initialYaw ?? 0, pitch: 0, fov: DEFAULT_FOV };
    velRef.current = { yaw: 0, pitch: 0 };
    // Wipe the backing store. Without this the previous room stays painted
    // underneath the loading overlay, so a switch to a slow-decoding scene
    // looks like the click did nothing — and anything sampling the canvas
    // mid-load reads the room the viewer already left.
    {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const off = document.createElement("canvas");
        off.width = img.naturalWidth;
        off.height = img.naturalHeight;
        const ctx = off.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0);
        const raw = ctx.getImageData(0, 0, off.width, off.height);
        imgRef.current = {
          data: new Uint32Array(raw.data.buffer.slice(0)),
          width: off.width,
          height: off.height,
        };
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    };
    img.onerror = () => {
      if (!cancelled) setStatus("error");
    };
    // Stream the file first so a 4K panorama shows real progress rather than a
    // spinner that sits still for a second. Any failure here (no streams, an
    // opaque response) falls straight back to letting the <img> fetch it.
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(scene.image, { cache: "force-cache" });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const total = Number(res.headers.get("content-length") ?? 0);
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (cancelled) {
            void reader.cancel();
            return;
          }
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (total > 0) setProgress(Math.min(1, received / total));
        }
        if (cancelled) return;
        setProgress(1);
        objectUrl = URL.createObjectURL(new Blob(chunks as BlobPart[]));
        img.src = objectUrl;
      } catch {
        if (!cancelled) img.src = scene.image;
      }
    })();

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [scene.image, scene.initialYaw]);

  /* ---------------------------------------------------------------- */
  /* Draw                                                              */
  /* ---------------------------------------------------------------- */

  const hotspotsRef = useRef(hotspots);
  hotspotsRef.current = hotspots;

  /**
   * Draw one frame.
   *
   * Deliberately dependency-free: everything it reads lives in a ref, so this
   * closure is stable for the life of the component. A `paint` whose identity
   * churned used to tear down and rebuild the ResizeObserver on every hotspot
   * update, and a stale copy of it could be left holding a canvas that had
   * since been replaced.
   */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const src = imgRef.current;
    const size = sizeRef.current;
    if (!canvas || !src || !canPaint(canvas, src, size)) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // A canvas that will not give us a 2D context can never paint. Say so,
      // rather than presenting an empty viewport that claims to be ready.
      setStatus("error");
      return;
    }

    const cam = camRef.current;
    paintPanorama(ctx, size, cam, src);
    paintedRef.current = true;
    onCameraRef.current?.(cam);

    // Reproject the pins onto the same frame.
    const hs = hotspotsRef.current;
    if (!hs.length) {
      setPins((prev) => (prev.length ? [] : prev));
      return;
    }
    const dpr = size.dpr;
    const next: { h: PanoHotspot; x: number; y: number }[] = [];
    for (const spot of hs) {
      const p = projectHotspot(spot, size.w, size.h, cam);
      if (p) next.push({ h: spot, x: p.x / dpr, y: p.y / dpr });
    }
    setPins((prev) => {
      if (prev.length !== next.length) return next;
      for (let i = 0; i < next.length; i++) {
        const a = prev[i];
        const b = next[i];
        if (a.h.id !== b.h.id || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5) return next;
      }
      return prev;
    });
  }, []);

  const paintRef = useRef(paint);
  paintRef.current = paint;

  /**
   * Schedule exactly one frame. Momentum re-schedules itself until it dies, so
   * the viewer costs nothing while the user is not touching it.
   *
   * The loop object owns the "a frame is already in flight" guard and clears it
   * both when the frame runs and when it is cancelled. The previous version
   * cancelled the frame on unmount without clearing the guard, so React's
   * StrictMode unmount/remount left it latched and every subsequent schedule()
   * returned immediately — a ready viewer that never drew a single pixel.
   */
  const schedule = useCallback(() => {
    let loop = loopRef.current;
    if (!loop) {
      loop = createFrameLoop(() => {
        const v = velRef.current;
        if (v.yaw !== 0 || v.pitch !== 0) {
          const cam = camRef.current;
          camRef.current = {
            yaw: normalizeYaw(cam.yaw + v.yaw),
            pitch: clampPitch(cam.pitch + v.pitch),
            fov: cam.fov,
          };
          v.yaw *= FRICTION;
          v.pitch *= FRICTION;
          if (Math.abs(v.yaw) < MIN_SPEED && Math.abs(v.pitch) < MIN_SPEED) {
            v.yaw = 0;
            v.pitch = 0;
          }
        }
        paintRef.current();
        if (velRef.current.yaw !== 0 || velRef.current.pitch !== 0) loopRef.current?.schedule();
      });
      loopRef.current = loop;
    }
    loop.schedule();
  }, []);

  /* ---------------------------------------------------------------- */
  /* Sizing                                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const measure = () => {
      const r = wrap.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (w === sizeRef.current.w && h === sizeRef.current.h) {
        // Same box, but the backing store may still be empty (the element was
        // hidden when the last frame was asked for). Never leave it blank.
        if (!paintedRef.current) schedule();
        return;
      }
      sizeRef.current = { w, h, dpr };
      canvas.width = w;
      canvas.height = h;
      // Resizing a canvas clears it, so whatever was drawn is gone.
      paintedRef.current = false;
      schedule();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [schedule]);

  /**
   * Repaint when the viewer scrolls back into view. A panel that was hidden or
   * zero-sized when its image finished decoding would otherwise stay blank
   * until the user happened to drag it.
   */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !paintedRef.current) schedule();
    });
    io.observe(wrap);
    return () => io.disconnect();
  }, [schedule]);

  /**
   * Paint as soon as the source is decoded — no interaction required — and keep
   * asking on following frames until one of them actually lands. `status` can
   * reach "ready" before the element has been laid out, and the frame that runs
   * then draws nothing.
   */
  useEffect(() => {
    if (status !== "ready") return;
    schedule();
    let tries = 0;
    let id: number | null = requestAnimationFrame(function again() {
      id = null;
      if (paintedRef.current || tries++ > 60) return;
      schedule();
      id = requestAnimationFrame(again);
    });
    return () => {
      if (id !== null) cancelAnimationFrame(id);
    };
  }, [status, schedule]);

  useEffect(
    () => () => {
      loopRef.current?.cancel();
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* Interaction                                                       */
  /* ---------------------------------------------------------------- */

  const look = useCallback(
    (dxCss: number, dyCss: number) => {
      const { h, dpr } = sizeRef.current;
      const cam = camRef.current;
      const f = focalLength(h, cam.fov) / dpr;
      const dYaw = -Math.atan2(dxCss, f);
      const dPitch = Math.atan2(dyCss, f);
      camRef.current = {
        yaw: normalizeYaw(cam.yaw + dYaw),
        pitch: clampPitch(cam.pitch + dPitch),
        fov: cam.fov,
      };
      if (!reduceMotion) velRef.current = { yaw: dYaw * 0.55, pitch: dPitch * 0.55 };
      schedule();
    },
    [reduceMotion, schedule],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (status !== "ready") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    velRef.current = { yaw: 0, pitch: 0 };
    if (pointers.current.size === 1) dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), fov: camRef.current.fov };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 4) {
        camRef.current = {
          ...camRef.current,
          fov: clampFov(pinchRef.current.fov * (pinchRef.current.dist / d)),
        };
        schedule();
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: drag.moved };
    look(dx, dy);
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (status !== "ready") return;
    camRef.current = {
      ...camRef.current,
      fov: clampFov(camRef.current.fov * (e.deltaY > 0 ? 1.09 : 1 / 1.09)),
    };
    schedule();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (status !== "ready") return;
    const step = 0.09;
    const cam = camRef.current;
    let handled = true;
    switch (e.key) {
      case "ArrowLeft": camRef.current = { ...cam, yaw: normalizeYaw(cam.yaw - step) }; break;
      case "ArrowRight": camRef.current = { ...cam, yaw: normalizeYaw(cam.yaw + step) }; break;
      case "ArrowUp": camRef.current = { ...cam, pitch: clampPitch(cam.pitch + step) }; break;
      case "ArrowDown": camRef.current = { ...cam, pitch: clampPitch(cam.pitch - step) }; break;
      case "+": case "=": camRef.current = { ...cam, fov: clampFov(cam.fov / 1.12) }; break;
      case "-": case "_": camRef.current = { ...cam, fov: clampFov(cam.fov * 1.12) }; break;
      case "Home": reset(); return;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      velRef.current = { yaw: 0, pitch: 0 };
      schedule();
    }
  };

  const reset = useCallback(() => {
    camRef.current = { yaw: scene.initialYaw ?? 0, pitch: 0, fov: DEFAULT_FOV };
    velRef.current = { yaw: 0, pitch: 0 };
    schedule();
  }, [scene.initialYaw, schedule]);

  const toggleFull = useCallback(() => {
    const el = wrapRef.current?.parentElement ?? wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onFs = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  /* ---------------------------------------------------------------- */

  return (
    <div className={clsx("relative", className)}>
      <div
        ref={wrapRef}
        className={clsx(
          "relative w-full select-none overflow-hidden rounded-xl border border-ink-700/70 bg-ink-800/40",
          status === "ready" ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        )}
        style={{ aspectRatio: full ? undefined : "16 / 9", height: full ? "100%" : undefined, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        role="application"
        tabIndex={0}
        aria-labelledby={labelId}
      >
        <canvas ref={canvasRef} className="block size-full" aria-hidden />
        <span id={labelId} className="sr-only">
          {`Interactive 360 degree view of the ${scene.title}. Drag or use the arrow keys to look around, plus and minus to zoom.`}
        </span>

        {status === "loading" && (
          <div className="absolute inset-0 grid place-items-center bg-ink-900/50 text-mist-400">
            <div className="flex w-40 flex-col items-center gap-2" role="status" aria-live="polite">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              <div className="h-1 w-full overflow-hidden rounded-full bg-ink-700/80">
                <div
                  className={clsx(
                    "h-full rounded-full bg-brand-400 transition-[width] duration-200",
                    progress === null && "w-1/3 animate-pulse",
                  )}
                  style={progress === null ? undefined : { width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className="text-[11px]">
                {progress === null
                  ? `Loading the ${scene.title} view…`
                  : `Loading the ${scene.title} view — ${Math.round(progress * 100)}%`}
              </span>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center bg-ink-900/60 px-6 text-center">
            <div className="flex flex-col items-center gap-2 text-mist-400">
              <ImageOff className="size-5" aria-hidden />
              <p className="text-[12.5px]">
                This 360 view could not be loaded. Nothing is missing from the plan — only the
                preview image failed to load.
              </p>
            </div>
          </div>
        )}

        {/* Hotspots */}
        {status === "ready" &&
          pins.map(({ h, x, y }) => (
            <button
              key={h.id}
              type="button"
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-ink-900/75 px-2.5 py-1 text-[11px] font-medium text-mist-100 backdrop-blur transition hover:border-white/50 hover:bg-ink-900/90"
              style={{ left: x, top: y }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (h.targetSceneId && scenes?.some((s) => s.id === h.targetSceneId)) {
                  onSceneChange?.(h.targetSceneId);
                }
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <DoorOpen className="size-3" aria-hidden />
                {h.label}
              </span>
            </button>
          ))}

        {overlay}

        {/* Controls */}
        {status === "ready" && (
          <div className="absolute right-2 top-2 z-10 flex gap-1.5">
            <IconBtn label="Reset the view" onClick={reset}>
              <RotateCcw className="size-3.5" aria-hidden />
            </IconBtn>
            <IconBtn label={full ? "Exit full screen" : "Full screen"} onClick={toggleFull}>
              {full ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
            </IconBtn>
          </div>
        )}

        {status === "ready" && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex flex-wrap items-end justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-900/70 px-2.5 py-1 text-[11px] text-mist-300 backdrop-blur">
              <Compass className="size-3" aria-hidden />
              Drag to look around · scroll to zoom
            </span>
            {watermark && (
              <span className="max-w-[60%] rounded-md border border-amber-400/25 bg-ink-900/75 px-2 py-1 text-right text-[10px] leading-tight text-amber-200/90 backdrop-blur">
                {watermark}
              </span>
            )}
          </div>
        )}
      </div>
      {caption && <p className="mt-2 text-[11px] text-mist-500">{caption}</p>}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="rounded-lg border border-ink-700 bg-ink-900/70 p-1.5 text-mist-300 backdrop-blur transition hover:text-mist-100"
    >
      {children}
    </button>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}
