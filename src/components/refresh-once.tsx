"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Pages kick their stats refresh without waiting for it (see
 * `ensureFreshStats`). This asks the server for the page once more a few
 * seconds later, so the fresh rows appear without the reader waiting for them.
 * Renders nothing; runs once per mount.
 */
export function RefreshOnce({ afterMs = 5000 }: { afterMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.refresh(), afterMs);
    return () => clearTimeout(t);
  }, [router, afterMs]);
  return null;
}
