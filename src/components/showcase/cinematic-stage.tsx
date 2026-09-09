"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Play } from "lucide-react";
import clsx from "clsx";
import { Card, SectionTitle } from "../ui";

export interface StageImage {
  src: string;
  caption: string;
}

/**
 * Slideshow of the project renders.
 *
 * It is a slideshow, not a rendering engine: the Ken-Burns drift exists to make
 * stills read as a walkthrough, and nothing here claims a live 3D pipeline.
 */
export function CinematicStage({
  images,
  youtubeId,
  title = "Cinematic view",
  hint,
}: {
  images: StageImage[];
  youtubeId?: string;
  title?: string;
  hint?: string;
}) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const usable = images.filter((i) => !broken[i.src]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const count = usable.length;
  const next = useCallback(() => setI((n) => (count ? (n + 1) % count : 0)), [count]);
  const prev = useCallback(() => setI((n) => (count ? (n - 1 + count) % count : 0)), [count]);

  useEffect(() => {
    if (paused || reduced || showVideo || count < 2) return;
    const t = setInterval(next, 6000);
    return () => clearInterval(t);
  }, [paused, reduced, showVideo, count, next]);

  const current = usable[Math.min(i, Math.max(count - 1, 0))];

  return (
    <Card className="overflow-hidden">
      <SectionTitle
        title={title}
        hint={hint}
        action={
          <div className="flex items-center gap-1.5">
            {youtubeId && !showVideo && (
              <button
                type="button"
                onClick={() => setShowVideo(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-800/70 px-3 py-1.5 text-[11px] font-medium text-mist-200 hover:text-mist-100"
              >
                <Play size={12} /> Play walkthrough
              </button>
            )}
            <button
              type="button"
              aria-label="Fullscreen"
              onClick={() => stageRef.current?.requestFullscreen?.()}
              className="rounded-lg border border-ink-700 bg-ink-800/70 p-1.5 text-mist-300 hover:text-mist-100"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        }
      />

      <div
        ref={stageRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-ink-700/60 bg-ink-950"
      >
        {showVideo && youtubeId ? (
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
            title="Project walkthrough"
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : count === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-mist-500">
            Project renders to be confirmed — no imagery has been placed yet.
            {youtubeId && " Use “Play walkthrough” for the project video."}
          </div>
        ) : (
          <>
            {usable.map((img, n) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={img.src}
                src={img.src}
                alt={img.caption}
                loading={n === 0 ? "eager" : "lazy"}
                decoding="async"
                onError={() => setBroken((b) => ({ ...b, [img.src]: true }))}
                className={clsx(
                  "absolute inset-0 h-full w-full object-cover transition-opacity duration-1000",
                  n === i ? "opacity-100" : "opacity-0",
                  n === i && !reduced && "showcase-kenburns",
                )}
              />
            ))}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <p className="text-[12px] font-medium text-white">{current?.caption}</p>
            </div>
            {count > 1 && (
              <>
                <button type="button" onClick={prev} aria-label="Previous image"
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70">
                  <ChevronLeft size={16} />
                </button>
                <button type="button" onClick={next} aria-label="Next image"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70">
                  <ChevronRight size={16} />
                </button>
                <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
                  {usable.map((img, n) => (
                    <button
                      key={img.src}
                      type="button"
                      onClick={() => setI(n)}
                      aria-label={`Show ${img.caption}`}
                      aria-current={n === i}
                      className={clsx("h-1.5 rounded-full transition-all",
                        n === i ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70")}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
