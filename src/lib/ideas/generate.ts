import type { Database, Idea, InventoryUnit, PostFormat } from "../types";
import { uid } from "../ids";

/**
 * POST IDEAS — derived, not invented.
 *
 * The page promises "ideas generated from your own data", and every card shows
 * a "Why now". That line is the whole point: an idea without a reason is just a
 * prompt, and a reason that is not true is worse than no idea at all. So every
 * generator below cites a fact this workspace actually holds — a count of
 * unsold units, a format nobody has posted, a real date in the calendar, a
 * number taken from the channel stats — and nothing here makes a claim the
 * store cannot back.
 *
 * Where there is no signal, there is no idea. An empty section is honest.
 */

export interface IdeaSignals {
  /** Facts the generator found, surfaced so the UI can say what it read. */
  read: string[];
}

const FORMATS: PostFormat[] = ["reel", "carousel", "feed", "story", "short"];

/** Pretty project name from the inventory's slug. */
function projectName(slug: string): string {
  if (slug === "serenity") return "Glentree Serenity";
  if (slug === "onyx") return "Glentree Onyx";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * The Indian property-marketing calendar.
 *
 * Dates are the ones that actually move enquiry volume for a Hyderabad
 * developer. `monthDay` is the window's rough centre; an idea fires when today
 * is inside `leadDays` of it, so the suggestion arrives with enough time to
 * shoot and approve rather than on the morning of.
 */
const CALENDAR: { name: string; month: number; day: number; leadDays: number; angle: string }[] = [
  { name: "Ugadi", month: 3, day: 30, leadDays: 35, angle: "New-year muhurat buying" },
  { name: "Akshaya Tritiya", month: 4, day: 30, leadDays: 30, angle: "The most auspicious day to buy property" },
  { name: "Ganesh Chaturthi", month: 8, day: 27, leadDays: 25, angle: "Community and neighbourhood life" },
  { name: "Dussehra", month: 10, day: 2, leadDays: 30, angle: "Traditional possession and gruhapravesham season" },
  { name: "Diwali", month: 10, day: 20, leadDays: 40, angle: "Festive offers and year-end closings" },
  { name: "Sankranti", month: 1, day: 14, leadDays: 30, angle: "NRI families are in Hyderabad" },
];

function daysUntil(month: number, day: number, now: Date): number {
  const year = now.getFullYear();
  let target = new Date(year, month - 1, day);
  if (target.getTime() < now.getTime() - 3 * 86400000) target = new Date(year + 1, month - 1, day);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

function idea(
  brandId: string,
  parts: Omit<Idea, "id" | "brandId" | "createdAt" | "used">,
): Idea {
  return {
    id: uid("idea"),
    brandId,
    createdAt: new Date().toISOString(),
    used: false,
    ...parts,
  };
}

/**
 * Build the idea list for one brand.
 *
 * `now` is injected so the seasonal window is testable rather than depending on
 * the day the suite happens to run.
 */
export function generateIdeas(db: Database, brandId: string, now = new Date()): { ideas: Idea[]; signals: IdeaSignals } {
  const out: Idea[] = [];
  const read: string[] = [];

  // ---- Signal 1: the inventory that is actually still for sale ------------
  const units = db.inventoryUnits.filter((u) => u.brandId === brandId);
  const byProject = new Map<string, typeof units>();
  for (const u of units) {
    const list = byProject.get(u.project) ?? [];
    list.push(u);
    byProject.set(u.project, list);
  }

  for (const [slug, list] of byProject) {
    const available = list.filter((u) => u.status === "available");
    const noLeads = list.filter((u) => u.status === "no_leads");
    const name = projectName(slug);
    if (available.length === 0 && noLeads.length === 0) continue;

    read.push(`${name}: ${available.length} available, ${noLeads.length} with no enquiries yet, of ${list.length} units`);

    if (available.length > 0) {
      out.push(
        idea(brandId, {
          title: `Walkthrough of a ready ${name} home`,
          angle: "Inventory",
          format: "reel",
          hook: `${available.length} homes at ${name} are ready to see this week.`,
          outline: [
            "Open on the approach and the gate — establish the address",
            "One continuous walk through the main living level",
            "Hold on the detail buyers ask about: ceiling height, natural light, storage",
            "Close on the number available and how to book a visit",
          ],
          reason: `${available.length} of ${list.length} units at ${name} are marked available in your own inventory. Stock that is ready to show is the cheapest content you have.`,
          score: Math.min(96, 70 + Math.round((available.length / Math.max(1, list.length)) * 30)),
        }),
      );
    }

    if (noLeads.length >= 5) {
      out.push(
        idea(brandId, {
          title: `The ${name} homes nobody has asked about yet`,
          angle: "Demand gap",
          format: "carousel",
          hook: `Quietly, some of the best plots at ${name} are still unclaimed.`,
          outline: [
            "Card 1: the plan, with the overlooked units marked",
            "Card 2: why they were overlooked — position, orientation, floor",
            "Card 3: the argument for each one",
            "Card 4: what it costs and who to ask",
          ],
          reason: `${noLeads.length} units at ${name} have had no enquiry at all. Marketing that names the overlooked stock moves it; marketing that repeats the hero unit does not.`,
          score: Math.min(94, 64 + noLeads.length),
        }),
      );
    }

    // Plot size is the spec buyers compare first, so lead with the real range.
    const sizes = available.map((u) => u.plotSqYds).filter((n): n is number => typeof n === "number");
    if (sizes.length >= 3) {
      const min = Math.min(...sizes);
      const max = Math.max(...sizes);
      if (max > min) {
        out.push(
          idea(brandId, {
            title: `${min}–${max} sq yds: choosing your plot at ${name}`,
            angle: "Buyer education",
            format: "carousel",
            hook: `The difference between ${min} and ${max} sq yds is not what most buyers think.`,
            outline: [
              "What each size actually gives you in built-up terms",
              "Which family shape each one suits",
              "The resale argument for each",
              "A side-by-side of the two ends of the range",
            ],
            reason: `Your available plots at ${name} range from ${min} to ${max} sq yds. Buyers compare size first, and the range is a real differentiator you are not currently explaining.`,
            score: 78,
          }),
        );
      }
    }
  }

  // ---- Signal 2: formats this brand has not used -------------------------
  const posts = db.posts.filter((p) => p.brandId === brandId);
  const used = new Set<string>();
  for (const p of posts) for (const t of p.targets ?? []) if (t.format) used.add(t.format);
  const missing = FORMATS.filter((f) => !used.has(f));

  if (posts.length > 0 && missing.length > 0) {
    read.push(`${posts.length} posts on record, using ${used.size || 0} of ${FORMATS.length} formats`);
    const gap = missing[0]!;
    out.push(
      idea(brandId, {
        title: `Your first ${gap} — a day at the site`,
        angle: "Format gap",
        format: gap,
        hook: "The same project, told in a format your audience has not seen from you.",
        outline: [
          "Pick the one thing this format does better than the others",
          "Shoot it in a single visit — no second trip",
          "Keep the first two seconds free of branding",
          "Post at the hour your channel stats already favour",
        ],
        reason: `You have published ${posts.length} post${posts.length === 1 ? "" : "s"} and never used ${gap}. Reach on a new format is usually cheap the first few times.`,
        score: 72,
      }),
    );
  }

  // ---- Signal 3: the calendar -------------------------------------------
  const upcoming = CALENDAR
    .map((c) => ({ ...c, days: daysUntil(c.month, c.day, now) }))
    .filter((c) => c.days >= 0 && c.days <= c.leadDays)
    .sort((a, b) => a.days - b.days);

  for (const window of upcoming.slice(0, 2)) {
    read.push(`${window.name} is ${window.days} day${window.days === 1 ? "" : "s"} away`);
    out.push(
      idea(brandId, {
        title: `${window.name} — ${window.angle.toLowerCase()}`,
        angle: window.angle,
        format: "feed",
        hook: `${window.name} is ${window.days} day${window.days === 1 ? "" : "s"} away.`,
        outline: [
          "Say something true about the occasion before selling anything",
          "Connect it to one specific thing about the project",
          "One clear action — a visit, a call, a plan",
          "Schedule it to land the week before, not the morning of",
        ],
        reason: `${window.name} falls in ${window.days} day${window.days === 1 ? "" : "s"}. Shooting and approval need lead time, which is why this is showing now rather than that week.`,
        score: Math.max(68, 95 - window.days),
      }),
    );
  }

  // ---- Signal 4: what the channel stats already say ----------------------
  const stats = db.dailyStats.filter((s) => s.brandId === brandId);
  if (stats.length >= 14) {
    const best = [...stats].sort((a, b) => b.engagements - a.engagements)[0];
    if (best && best.engagements > 0) {
      const when = new Date(best.date).toLocaleDateString("en-IN", { weekday: "long" });
      read.push(`Best engagement day on record: ${when} (${best.engagements} engagements on ${best.channel})`);
      out.push(
        idea(brandId, {
          title: `Repeat what worked on ${when}`,
          angle: "Performance",
          format: "reel",
          hook: "You already know which day your audience shows up.",
          outline: [
            `Look at what went out around ${new Date(best.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
            "Isolate the one variable worth repeating — subject, length, or hour",
            "Rebuild it with this month's inventory",
            `Schedule for a ${when}`,
          ],
          reason: `Your best day on record is ${when} on ${best.channel}, at ${best.engagements} engagements. That is from your own ${stats.length} days of channel stats, not a benchmark.`,
          score: 82,
        }),
      );
    }
  }

  // Highest-confidence first, which is the order the page renders in anyway.
  out.sort((a, b) => b.score - a.score);
  return { ideas: out, signals: { read } };
}
