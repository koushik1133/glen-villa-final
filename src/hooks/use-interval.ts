import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `delay` milliseconds, starting immediately
 * on mount. Cleans up on unmount or when delay changes.
 *
 * Passing `null` as delay pauses the interval.
 *
 * Polling hygiene, applied to every caller at once:
 *  - ticks are skipped while the tab is hidden, and one catch-up tick fires
 *    when it becomes visible again;
 *  - if the callback returns a promise, the next tick waits for it, so slow
 *    responses never stack up overlapping requests;
 *  - a rejected promise, or one resolving to `false`, doubles the delay (capped
 *    at 8x) and a success resets it, so a failing endpoint is not hammered.
 */
export function useInterval(callback: () => unknown, delay: number | null) {
  const savedCallback = useRef<() => unknown>(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1;
    let running = false;

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(run, delay * backoff);
    };

    const run = async () => {
      if (cancelled || running) return;
      // Hidden tabs get no requests at all; visibilitychange fires the catch-up.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule();
        return;
      }
      running = true;
      try {
        const result = await savedCallback.current();
        backoff = result === false ? Math.min(backoff * 2, 8) : 1;
      } catch {
        backoff = Math.min(backoff * 2, 8);
      } finally {
        running = false;
        schedule();
      }
    };

    // Fire once immediately so the UI is fresh on mount without waiting for the first tick.
    void run();

    const onVisible = () => {
      if (document.visibilityState === "hidden") return;
      if (timer) clearTimeout(timer);
      void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [delay]);
}

/**
 * A signal that aborts when the component unmounts, so in-flight polls do not
 * outlive the panel that started them. Read it through the returned getter at
 * request time — it is stable across renders.
 */
export function useUnmountSignal(): () => AbortSignal {
  const ref = useRef<AbortController | null>(null);
  if (ref.current === null) ref.current = new AbortController();

  useEffect(() => {
    if (ref.current === null || ref.current.signal.aborted) ref.current = new AbortController();
    return () => ref.current?.abort();
  }, []);

  const getter = useRef<() => AbortSignal>(() => {
    if (ref.current === null || ref.current.signal.aborted) ref.current = new AbortController();
    return ref.current.signal;
  });
  return getter.current;
}

/** True for the rejection a fetch produces when its signal is aborted. */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === "AbortError" : (e as { name?: string })?.name === "AbortError";
}
