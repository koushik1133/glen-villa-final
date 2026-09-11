import Link from "next/link";
import { ExternalLink, ShieldCheck, Trees, Building2, Compass, Ruler, CalendarClock, Phone, Mail, MapPin } from "lucide-react";
import { pageContext, qs } from "@/lib/page-context";
import { TopBar } from "@/components/shell";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { SerenityMasterPlan, type PlanMeta, type PlanPlot } from "@/components/showcase/serenity-master-plan";
import { CinematicStage } from "@/components/showcase/cinematic-stage";
import { SERENITY_PLAN, SERENITY_PLOTS } from "@/lib/showcase/serenity-plots";
import { villaTypeFor } from "@/lib/showcase/villa-types";
import { SERENITY_RENDERS, SERENITY_WALKTHROUGH_YOUTUBE_ID } from "@/lib/showcase/assets";
import { OnyxShowcase } from "@/components/showcase/onyx-showcase";

export const dynamic = "force-dynamic";

const SITE = "https://glentreehomes.in/glentree-serenity/";

/**
 * The plan module is owned by another workstream, so it is read structurally
 * rather than by its exact declared type: a field the plan file renames must
 * not take this page down with a build error.
 */
const plan: PlanMeta = {
  image: SERENITY_PLAN.image,
  imageHd: SERENITY_PLAN.imageHd,
  width: SERENITY_PLAN.width || 1600,
  height: SERENITY_PLAN.height || 1100,
  note: SERENITY_PLAN.note,
  clusters: SERENITY_PLAN.clusters ?? [],
  plotSizes: SERENITY_PLAN.plotSizes ?? [],
};
const plots: PlanPlot[] = SERENITY_PLOTS.map((p) => {
  // Most plot sizes on the plan have no published sheet, so the match is
  // carried with its `exact` flag and the drawer labels it indicative.
  const match = villaTypeFor(p.plotSqYds ?? null, p.facing ?? null);
  return {
    villaNo: p.number,
    xPct: p.xPct,
    yPct: p.yPct,
    cluster: p.cluster,
    plotSqYds: p.plotSqYds ?? 0,
    bhk: "3 & 4 BHK",
    builtUpSqFt: "2,800 – 4,286 sq ft",
    villaType: match
      ? {
          key: match.type.key,
          plotSqYds: match.type.plotSqYds,
          facing: match.type.facing,
          totalSqFt: match.type.totalSqFt,
          floors: match.type.floors,
          planImage: match.type.planImage,
          bhk: match.type.bhk,
          exact: match.exact,
        }
      : undefined,
  };
});

const STATS = [
  { icon: Building2, label: "Villas", value: String(SERENITY_PLOTS.length), sub: "Triplex villas on the sanctioned plan" },
  { icon: Trees, label: "Land", value: "18 – 19.5 acres", sub: "2 acres forest" },
  { icon: Ruler, label: "Plot sizes", value: "200 / 267 / 300", sub: "sq yds" },
  { icon: Compass, label: "Built-up", value: "2,800 – 4,286", sub: "sq ft · 3 & 4 BHK" },
  { icon: Building2, label: "Clubhouses", value: "2", sub: "~36,821 + 42,000 sq ft" },
  { icon: CalendarClock, label: "Possession", value: "Oct 2029", sub: "As per RERA" },
];

const AMENITY_GROUPS: Array<{ title: string; items: string[] }> = [
  {
    title: "Clubhouses",
    items: [
      "Two clubhouses, approximately 36,821 sq ft and 42,000 sq ft",
      "100+ amenities across the community",
    ],
  },
  {
    title: "Themed parks",
    items: ["Sahavas", "Veer Gardens", "Aranya", "Ekaanth", "Ananda Vana"],
  },
  {
    title: "Landscape",
    items: ["2 acres of preserved forest", "18 – 19.5 acre gated community"],
  },
  {
    title: "Homes",
    items: [
      "Triplex villas over 3 levels with internal lift provision",
      "3 BHK and 4 BHK configurations",
      "Built-up 2,800 – 4,286 sq ft on 200 / 267 / 300 sq yd plots",
    ],
  },
];

export default async function ShowcasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { db, brandId } = pageContext(sp);
  const link = qs(sp);
  const session = await getSession();
  const canWrite = session?.permissions.has("sales.write") ?? false;

  const project = sp.project === "onyx" ? "onyx" : "serenity";
  const tabHref = (p: "serenity" | "onyx") => {
    const params = new URLSearchParams(link.replace(/^\?/, ""));
    params.set("project", p);
    return `/showcase?${params.toString()}`;
  };

  return (
    <>
      <TopBar
        brands={db.brands}
        brandId={brandId}
        title="Project Showcase"
        subtitle="Interactive master plan, cinematic renders and project information"
        right={
          <a
            href={SITE}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-800/80 px-3 py-1.5 text-xs font-medium text-mist-200 transition hover:border-ink-600 hover:text-mist-100"
          >
            <span>Official Site</span>
            <ExternalLink size={11} />
          </a>
        }
      />

      <div className="space-y-6 p-4 sm:p-6 lg:p-7">
        {/* A. Project switcher */}
        <div className="inline-flex items-center gap-1 rounded-full border border-ink-700/70 bg-ink-900/60 p-1">
          {([
            { id: "serenity", label: "Serenity · Villas" },
            { id: "onyx", label: "Onyx · Apartments" },
          ] as const).map((t) => (
            <Link
              key={t.id}
              href={tabHref(t.id)}
              aria-current={project === t.id}
              className={
                project === t.id
                  ? "rounded-full bg-mist-100 px-4 py-1.5 text-xs font-semibold text-ink-950"
                  : "rounded-full px-4 py-1.5 text-xs font-medium text-mist-300 transition hover:bg-ink-800 hover:text-mist-100"
              }
            >
              {t.label}
            </Link>
          ))}
        </div>

        {project === "onyx" ? (
          <OnyxShowcase brandId={brandId} />
        ) : (
          <>
            {/* B. Interactive master plan — first */}
            <SerenityMasterPlan plan={plan} plots={plots} brandId={brandId} canWrite={canWrite} />

            {/* C. Cinematic view — second */}
            <CinematicStage
              images={SERENITY_RENDERS}
              youtubeId={SERENITY_WALKTHROUGH_YOUTUBE_ID}
              title="Cinematic view"
              hint="Project renders and the walkthrough video"
            />

            {/* D. Project information — bottom */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {STATS.map((s) => (
                <div key={s.label} className="rounded-2xl border border-ink-700/60 bg-ink-900/60 p-4">
                  <div className="flex items-center gap-2 text-mist-400">
                    <s.icon size={15} />
                    <span className="text-[10.5px] font-bold uppercase tracking-wider">{s.label}</span>
                  </div>
                  <p className="tnum mt-2 text-lg font-bold text-mist-100">{s.value}</p>
                  <p className="text-[11px] text-mist-400">{s.sub}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <SectionTitle title="Amenities" hint="100+ amenities across two clubhouses and five themed parks" />
                <div className="grid gap-3 sm:grid-cols-2">
                  {AMENITY_GROUPS.map((g) => (
                    <div key={g.title} className="rounded-xl border border-ink-700/60 bg-ink-900/50 p-3.5">
                      <h3 className="text-xs font-bold text-mist-100">{g.title}</h3>
                      <ul className="mt-1.5 space-y-1">
                        {g.items.map((it) => (
                          <li key={it} className="text-[11px] text-mist-400">· {it}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="space-y-6">
                <Card>
                  <SectionTitle title="Approvals" />
                  <div className="space-y-2 text-[11.5px]">
                    <div className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 px-3 py-2.5">
                      <ShieldCheck size={14} className="text-emerald-400" />
                      <span className="text-mist-200">TG-RERA</span>
                      <span className="tnum ml-auto text-mist-100">P02400010707</span>
                    </div>
                    <div className="rounded-lg border border-ink-700/60 bg-ink-900/50 px-3 py-2.5">
                      <span className="text-mist-200">HMDA permit</span>
                      <p className="tnum mt-0.5 break-all text-mist-100">012013/LO/HMDA/3194/SMD/2024</p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <SectionTitle title="Location" />
                  <div className="space-y-2 text-[11.5px]">
                    <div className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 px-3 py-2.5">
                      <MapPin size={14} className="text-amber-400" />
                      <span className="text-mist-200">Nadergul, Hyderabad</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-ink-700/60 bg-ink-900/50 px-3 py-2.5">
                      <span className="text-mist-200">Outer Ring Road</span>
                      <span className="tnum font-bold text-amber-400">10 mins</span>
                    </div>
                  </div>
                </Card>

                <Card>
                  <SectionTitle title="Contact" />
                  <div className="space-y-2 text-[11.5px]">
                    <a href="tel:+919646644644" className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 px-3 py-2.5 text-mist-200 hover:text-mist-100">
                      <Phone size={14} /> <span className="tnum">+91 96466 44644</span>
                    </a>
                    <a href="tel:+919133555509" className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 px-3 py-2.5 text-mist-200 hover:text-mist-100">
                      <Phone size={14} /> <span className="tnum">+91 91335 55509</span>
                    </a>
                    <a href="mailto:sales@glentreehomes.in" className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 px-3 py-2.5 text-mist-200 hover:text-mist-100">
                      <Mail size={14} /> sales@glentreehomes.in
                    </a>
                  </div>
                  <Badge tone="neutral">Prices and availability to be confirmed with sales</Badge>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
