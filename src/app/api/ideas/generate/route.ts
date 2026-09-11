import { guard } from "@/lib/auth/guard";
import { apiError, apiFail, apiOk } from "@/lib/auth/http";
import { mutate, read, resolveBrandId } from "@/lib/db";
import { generateIdeas } from "@/lib/ideas/generate";

/**
 * Regenerate the post-idea list for one brand.
 *
 * Writes content the team will act on, so it takes `marketing.publish` rather
 * than the read permission the page itself needs.
 *
 * Regenerating REPLACES the unused ideas and keeps the used ones. An idea
 * somebody has already turned into a post is a record of a decision; silently
 * deleting it would make the "used" flag meaningless.
 */
export async function POST(req: Request) {
  const denied = await guard("marketing.publish");
  if (denied) return denied;

  try {
    const db = read();
    const brandId = resolveBrandId(db, new URL(req.url).searchParams.get("brand"));
    if (!brandId) return apiFail("No brand configured.", 404);

    const { ideas, signals } = generateIdeas(db, brandId);

    if (ideas.length === 0) {
      return apiOk({
        created: 0,
        signals: signals.read,
        note:
          "Nothing to derive from yet. Ideas come from your own inventory, posting history, channel stats and the calendar — once any of those has data, they appear here.",
      });
    }

    mutate((d) => {
      const keep = d.ideas.filter((i) => i.brandId !== brandId || i.used);
      d.ideas = [...keep, ...ideas];
    });

    return apiOk({ created: ideas.length, signals: signals.read });
  } catch (e) {
    return apiError(e);
  }
}
