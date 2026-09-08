import { Suspense } from "react";
import { pageContext } from "@/lib/page-context";
import { getSession, hasPermission } from "@/lib/auth/session";
import { TopBar } from "@/components/shell";
import { loadVoiceOverview } from "@/lib/voice/overview";
import { VoicePanel } from "@/components/voice/voice-panel";
import { CardSkeleton } from "@/components/skeletons";
import type { Brand } from "@/lib/types";

export const dynamic = "force-dynamic";

const RANGES = new Set([7, 30, 90]);

/**
 * Voice agent tab — client view.
 *
 * Server-rendered first paint from the same `loadVoiceOverview` the panel
 * refreshes through /api/voice, so the two never disagree. Diagnostics are
 * attached only for administrators; the panel renders them only when present.
 */
export default async function VoicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { db, brand, brandId } = pageContext(sp);
  const requested = Number(typeof sp.range === "string" ? sp.range : 30);
  const days = RANGES.has(requested) ? requested : 30;

  // The overview calls the voice provider; stream it so the shell paints at once.
  return (
    <Suspense
      fallback={
        <>
          <TopBar brands={db.brands} brandId={brandId} title="Voice agent" subtitle={`${brand.name} · last ${days} days`} />
          <div className="p-7"><CardSkeleton rows={5} /></div>
        </>
      }
    >
      <VoiceSection brands={db.brands} brand={brand} brandId={brandId} days={days} />
    </Suspense>
  );
}

async function VoiceSection({
  brands, brand, brandId, days,
}: {
  brands: Brand[];
  brand: { name: string };
  brandId: string;
  days: number;
}) {
  const session = await getSession();
  const overview = await loadVoiceOverview(brandId, { days, diagnostics: hasPermission(session, "users.manage") });

  return (
    <>
      <TopBar
        brands={brands}
        brandId={brandId}
        title="Voice agent"
        subtitle={`${overview.funnel.calls} call${overview.funnel.calls === 1 ? "" : "s"} in ${days} days · ${brand.name}`}
      />
      <div className="p-7">
        <VoicePanel initial={overview} brandId={brandId} canEditSettings={hasPermission(session, "workflows.manage")} />
      </div>
    </>
  );
}
