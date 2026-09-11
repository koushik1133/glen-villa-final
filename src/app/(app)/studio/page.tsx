import { pageContext } from "@/lib/page-context";
import { getSession, hasPermission } from "@/lib/auth/session";
import { DEFAULT_EDIT, hasFfmpeg } from "@/lib/media/render";
import { TopBar } from "@/components/shell";
import { Studio } from "@/components/studio";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { db, brand, brandId } = pageContext(sp);
  const media = db.media.filter((m) => m.brandId === brandId);

  // The upload route requires `marketing.publish`. Resolving it here means a
  // reader sees why they cannot upload instead of a button that 403s.
  const canUpload = hasPermission(await getSession(), "marketing.publish");

  return (
    <>
      <TopBar
        brands={db.brands}
        brandId={brandId}
        title="Video Studio"
        subtitle={`Edit once, render per network · ${brand.name}`}
        right={<Badge tone={hasFfmpeg() ? "good" : "warn"}>{hasFfmpeg() ? "ffmpeg ready" : "ffmpeg not found"}</Badge>}
      />
      <div className="p-4 sm:p-6 lg:p-7">
        <Studio brand={brand} media={media} defaultEdit={DEFAULT_EDIT} canUpload={canUpload} />
      </div>
    </>
  );
}
