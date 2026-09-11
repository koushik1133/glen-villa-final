import { Suspense } from "react";
import { pageContext } from "@/lib/page-context";
import { activeProvider, hasLLM } from "@/lib/ai/provider";
import { hasFfmpeg } from "@/lib/media/render";
import { DRIVER } from "@/lib/platforms/types";
import { TopBar } from "@/components/shell";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth/session";
import { AdminDiagnostics, vendorDiagnostics } from "@/components/settings/admin-diagnostics";
import { KnowledgeEditor } from "@/components/knowledge-editor";
import { WhatsAppHealthCard } from "@/components/settings/whatsapp-health";
import { whatsappHealth } from "@/lib/platforms/whatsapp-health";
import { CardSkeleton } from "@/components/skeletons";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { db, brand, brandId } = pageContext(sp);
  // Vendor names are an admin concern; everyone else sees product wording.
  const isAdmin = hasPermission(await getSession(), "users.manage");

  const checks = [
    // Not "simulated": with the mock driver publishing fails outright rather than
    // faking a success, so this reads warn — the queue cannot go out in this state.
    { label: "Platform driver", value: DRIVER, ok: DRIVER === "live", hint: DRIVER === "live" ? "Publishing for real" : "Publishing is off — every post fails until PLATFORM_DRIVER=live and credentials are set" },
    {
      label: "AI writer",
      // Which provider answered is shown in the admin diagnostics below.
      value: hasLLM() ? "configured" : "not set",
      ok: hasLLM(),
      hint: hasLLM()
        ? "Written narratives and captions are on"
        : "Optional — engines fall back to the deterministic writer until an administrator connects one",
    },
    { label: "ffmpeg", value: hasFfmpeg() ? "available" : "missing", ok: hasFfmpeg(), hint: "Needed to render edits; the Studio still shows the commands without it" },
    { label: "Worker secret", value: process.env.WORKER_SECRET ? "set" : "unset", ok: Boolean(process.env.WORKER_SECRET), hint: "Protects the publish tick endpoint" },
  ];

  return (
    <>
      <TopBar brands={db.brands} brandId={brandId} title="Settings" subtitle={brand.name} />
      <div className="space-y-6 p-7">
        <Card>
          <SectionTitle title="System status" hint="What is wired up on this install" />
          <div className="grid gap-2 md:grid-cols-2">
            {checks.map((c) => (
              <div key={c.label} className="flex items-start gap-3 rounded-lg border border-ink-700 p-3">
                <Badge tone={c.ok ? "good" : "warn"}>{c.value}</Badge>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-mist-100">{c.label}</div>
                  <div className="text-[11px] text-mist-400">{c.hint}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/*
          Vendor diagnostics name the third parties behind the product, so they
          are gated on an environment flag rather than on a permission. The
          client's own administrator holds `users.manage` — gating on that alone
          would have shown them the whole supplier list in one card, which is
          exactly what white-labelling is meant to prevent. Operators set
          SHOW_VENDOR_DIAGNOSTICS=1 on their own deployments; the client's does
          not have it.
        */}
        {isAdmin && process.env.SHOW_VENDOR_DIAGNOSTICS === "1" && (
          <AdminDiagnostics rows={vendorDiagnostics(activeProvider())} />
        )}
        {/* One Meta Graph call — streamed so the rest of Settings paints first. */}
        {isAdmin && (
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <WhatsAppHealthSection />
          </Suspense>
        )}

        <Card>
          <SectionTitle title="Brand profile" hint="This is what every AI engine conditions on — keep it specific" />
          <dl className="space-y-3 text-[12.5px]">
            <div><dt className="text-[11px] uppercase tracking-wider text-mist-400">Name</dt><dd className="text-mist-100">{brand.name}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wider text-mist-400">Industry</dt><dd className="text-mist-100">{brand.industry}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wider text-mist-400">Voice</dt><dd className="leading-relaxed text-mist-300">{brand.voice}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wider text-mist-400">Audience</dt><dd className="text-mist-300">{brand.audience}</dd></div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-mist-400">Offerings</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {brand.offerings.map((o) => <Badge key={o} tone="neutral">{o}</Badge>)}
              </dd>
            </div>
            <div><dt className="text-[11px] uppercase tracking-wider text-mist-400">Timezone</dt><dd className="text-mist-300">{brand.timezone}</dd></div>
          </dl>
        </Card>

        <KnowledgeEditor brandId={brandId} />

        <Card>
          <SectionTitle title="All brands in this workspace" hint="The dashboard is multi-tenant — add a brand and everything works for it" />
          <div className="space-y-2">
            {db.brands.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-lg border border-ink-700 p-3">
                <span className="h-7 w-7 rounded-lg" style={{ background: b.color }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-mist-100">{b.name}</div>
                  <div className="text-[11px] text-mist-400">
                    {b.industry} · {db.connections.filter((c) => c.brandId === b.id).length} connections · {db.posts.filter((p) => p.brandId === b.id).length} posts
                  </div>
                </div>
                {b.id === brandId && <Badge tone="brand">active</Badge>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * The one part of Settings that talks to an external API. Kept in its own
 * async component so a slow (or unavailable) Graph call streams in late
 * instead of holding the page. The page checks the permission; this only draws.
 */
async function WhatsAppHealthSection() {
  const h = await whatsappHealth().catch(() => null);
  if (!h) return null;
  return <WhatsAppHealthCard h={h} />;
}
