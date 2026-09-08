"use client";

import dynamic from "next/dynamic";

/**
 * The live studio is a recharts-heavy panel far below the fold that loads its
 * own data on the client anyway, so it is fetched on demand behind a
 * fixed-height placeholder — same slot, no layout shift, no visual change.
 */
const Studio = dynamic(
  () => import("./uploadpost-live-studio").then((m) => m.UploadPostLiveStudio),
  {
    ssr: false,
    loading: () => <div className="h-[560px] w-full animate-pulse rounded-2xl bg-ink-850/40" aria-hidden />,
  },
);

export function UploadPostLiveStudioLazy({ brandId }: { brandId: string }) {
  return <Studio brandId={brandId} />;
}
