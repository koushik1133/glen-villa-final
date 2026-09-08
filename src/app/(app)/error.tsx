"use client";

import { useEffect } from "react";

/**
 * Error boundary for the app shell. Pages stream their data sections inside
 * Suspense, so a provider failure now happens after the shell has been sent;
 * without this boundary the stream would break with nothing to recover it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render error", error);
  }, [error]);

  return (
    <div className="p-7">
      <div className="rounded-xl border border-black/10 bg-white p-6">
        <h2 className="text-base font-semibold">Something went wrong</h2>
        <p className="mt-1 text-sm text-black/60">
          This section could not be loaded. It is usually a temporary problem with an upstream provider.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
