"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * KEEPS THE INBOX MOVING WITHOUT A REFRESH.
 *
 * The conversations and the thread are Server Components reading the live
 * database, so the cheapest way to show a new message is to ask the router to
 * re-run them: `router.refresh()` re-renders on the server and streams the
 * result into the existing page. No second API route, no client-side copy of
 * the query, and no duplicated shape to keep in step with the server one.
 *
 * Realtime over WebSockets is not an option here and it is worth saying why:
 * every `villa_*` table has RLS on with no policy and is revoked from
 * anon/authenticated, so a browser subscription authenticated with the anon
 * key receives nothing at all. It would fail silently, which is worse than
 * polling. Reads happen server-side; this just re-triggers them.
 *
 * Two things keep the cost honest:
 *
 *  - it stops while the tab is hidden, because nobody is reading a background
 *    tab and a parked laptop should not query the database all night; and
 *  - it refreshes once immediately on becoming visible again, so coming back
 *    to the tab shows current data rather than whatever was on screen when it
 *    was hidden.
 */
export function LiveRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  const [live, setLive] = useState(true);
  // Held in a ref so changing the interval does not re-run the effect and
  // restart the clock on every render.
  const everyMs = useRef(Math.max(5, seconds) * 1000);
  everyMs.current = Math.max(5, seconds) * 1000;

  useEffect(() => {
    if (!live) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => router.refresh(), everyMs.current);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, live]);

  return (
    <button
      type="button"
      onClick={() => setLive((v) => !v)}
      aria-pressed={live}
      title={
        live
          ? `Updating every ${Math.max(5, seconds)} seconds. Click to pause.`
          : "Updates paused. Click to resume."
      }
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] text-[var(--color-ink-400)] transition-colors hover:text-[var(--color-ink-100)]"
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          live ? "animate-pulse bg-[var(--color-gold-300)]" : "bg-[var(--color-ink-500)]"
        }`}
      />
      {live ? "Live" : "Paused"}
    </button>
  );
}
