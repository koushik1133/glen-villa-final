import { db } from "../supabase";
import type { Faq, Project, VillaType } from "../types";

/**
 * The knowledge-base snapshot that gets baked into the cached prompt prefix.
 *
 * Rendering is deterministic on purpose — fixed field order, sorted lists, no
 * JSON.stringify of arbitrary objects — because any byte that moves between
 * requests invalidates the prompt cache for every customer at once.
 *
 * Detail beyond this summary is fetched on demand through tools; this block is
 * only what the agent needs constantly in view to stay grounded.
 */

const TTL_MS = 10 * 60 * 1000;

let cached: { text: string; at: number } | null = null;

export interface KbBundle {
  projects: Project[];
  villaTypes: VillaType[];
  faqs: Faq[];
}

export async function loadKb(): Promise<KbBundle> {
  const supabase = db();

  const [projects, villaTypes, faqs] = await Promise.all([
    supabase.from("villa_projects").select("*").eq("is_active", true).order("slug"),
    supabase.from("villa_types").select("*").eq("is_active", true).order("name"),
    supabase.from("villa_faqs").select("*").order("question"),
  ]);

  if (projects.error) throw new Error(`Knowledge base unavailable: ${projects.error.message}`);

  return {
    projects: (projects.data ?? []) as Project[],
    villaTypes: (villaTypes.data ?? []) as VillaType[],
    faqs: (faqs.data ?? []) as Faq[],
  };
}

function money(inr: number | null): string {
  if (inr === null || inr === undefined) return "NOT RECORDED — sales team must confirm";
  return `₹${(inr / 10000000).toFixed(2)} Cr (₹${inr.toLocaleString("en-IN")})`;
}

function list(values: unknown): string {
  if (!Array.isArray(values)) return "";
  return values
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .join("; ");
}

/** Renders a nested amenities/specs object as stable, readable lines. */
function renderObject(obj: unknown, indent = "  "): string {
  if (!obj || typeof obj !== "object") return "";
  const entries = Object.entries(obj as Record<string, unknown>);
  const lines: string[] = [];
  for (const [key, value] of entries) {
    const label = key.replace(/_/g, " ");
    if (Array.isArray(value)) {
      lines.push(`${indent}${label}: ${list(value)}`);
    } else if (value && typeof value === "object") {
      lines.push(`${indent}${label}:`);
      lines.push(renderObject(value, indent + "  "));
    } else if (value !== null && value !== undefined) {
      lines.push(`${indent}${label}: ${String(value)}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

function renderProject(p: Project, types: VillaType[], faqs: Faq[]): string {
  const mine = types.filter((t) => t.project_id === p.id);
  const myFaqs = faqs.filter((f) => f.project_id === p.id || f.project_id === null);

  const location = [p.survey_no, p.village, p.mandal, p.district, p.state, p.pincode]
    .filter(Boolean)
    .join(", ");

  const typeLines = mine.length
    ? mine
        .map((t) => {
          const bits = [
            t.plot_area_sqyd ? `${t.plot_area_sqyd} sq yd plot` : null,
            t.built_up_sft ? `${t.built_up_sft} SFT built-up` : null,
            t.facing ? `${t.facing} facing` : null,
            t.bedrooms ? `${t.bedrooms} BHK` : "bedroom count NOT RECORDED",
            t.floors ? `${t.floors} floors` : null,
            t.has_home_theatre ? "home theatre" : null,
          ].filter(Boolean);
          const note = t.verification_note ? `\n      note: ${t.verification_note}` : "";
          return `    - ${t.name}: ${bits.join(", ")}. Price: ${money(t.price_inr)}${note}`;
        })
        .join("\n")
    : "    (no villa types recorded)";

  const faqLines = myFaqs.length
    ? myFaqs.map((f) => `    Q: ${f.question}\n    A: ${f.answer}`).join("\n")
    : "    (none)";

  return `## ${p.name}

  Status: ${p.status ?? "not recorded"}
  Expected delivery: ${p.expected_delivery ?? "not recorded"}
  Location: ${location || "not recorded"}
  HMDA permit: ${p.hmda_permit_no ?? "not recorded"}${p.hmda_permit_date ? ` dated ${p.hmda_permit_date}` : ""}
  RERA: ${p.rera_number ?? p.rera_status ?? "not recorded"}
  Land area: ${p.total_land_acres ? `${p.total_land_acres} acres` : "not recorded"}
  Total villas: ${p.total_units ?? "not recorded"}
  Configurations: ${p.configurations?.join(", ") ?? "not recorded"}
  Starting price: ${money(p.starting_price_inr)}
  Price note: ${p.price_note ?? "none"}

  Positioning: ${p.positioning ?? "not recorded"}

  Key selling points:
${Array.isArray(p.usps) ? (p.usps as string[]).map((u) => `    - ${u}`).join("\n") : "    (none)"}

  Villa types:
${typeLines}

  Amenities:
${renderObject(p.amenities)}

  Specifications:
${renderObject(p.specifications)}

  Sustainability:
${renderObject(p.sustainability)}

  Connectivity (developer-published estimates — always add that actual travel time varies with traffic):
${
  Array.isArray(p.connectivity)
    ? (p.connectivity as Array<{ place: string; distance_km?: string; minutes?: string }>)
        .map((c) => {
          const bits = [
            c.distance_km ? `approx ${c.distance_km} km` : null,
            c.minutes ? `approx ${c.minutes} min drive` : null,
          ].filter(Boolean);
          return `    - ${c.place}: ${bits.join(", ") || "distance not recorded"}`;
        })
        .join("\n")
    : "    (none)"
}

  Social infrastructure:
${renderObject(p.social_infrastructure)}

  Home loan partners: ${p.financing_partners?.join(", ") ?? "not recorded"}

  Frequently asked:
${faqLines}`;
}

/**
 * Returns the rendered knowledge base, memoised for TTL_MS.
 *
 * The memo matters for cost as much as latency: a stable string keeps the
 * prompt-cache prefix intact between requests.
 */
export async function knowledgeBaseBlock(): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.text;

  const { projects, villaTypes, faqs } = await loadKb();

  const body = projects.length
    ? projects.map((p) => renderProject(p, villaTypes, faqs)).join("\n\n")
    : "(No projects are loaded. Tell the customer you will have the sales team assist them, and do not describe any property.)";

  const text = `# APPROVED KNOWLEDGE BASE

Everything below is approved for you to state to a customer. Nothing outside it is.

Where a field reads "not recorded" or "NOT RECORDED", that fact is not approved for you to state. Do not infer it, do not estimate it, do not reason it out from other fields. Tell the customer the sales team will confirm, and log it.

${body}

# END OF APPROVED KNOWLEDGE BASE`;

  cached = { text, at: Date.now() };
  return text;
}

/** Call after editing project data so the next reply reflects it. */
export function invalidateKbCache(): void {
  cached = null;
}

/**
 * A compact knowledge base for the Groq free tier.
 *
 * The full block is ~7,300 tokens — too large to inline under Groq's 8K/min
 * cap. But NOT inlining it forced the agent to make a separate
 * search_knowledge_base round-trip for every question, and each round-trip
 * resends the whole prompt + tools + growing context, costing far more in
 * total than one call with the facts already present. This trims to the
 * sellable essentials (project facts, the villa types with prices, and the
 * FAQs) so the agent answers most questions in a single call — faster, and it
 * stops deferring facts it actually has. Same NULL-means-unconfirmed rule.
 */
export async function compactKnowledgeBase(): Promise<string> {
  const { projects, villaTypes } = await loadKb();
  if (!projects.length) {
    return "(No project data is loaded. Tell the customer the sales team will assist; describe no property.)";
  }

  const lines: string[] = [
    "# APPROVED FACTS — you ALREADY have these; answer directly from them.",
    "Do NOT call search_knowledge_base OR get_villa_types for anything covered below (location, price, rate, HMDA/RERA, the villa types with their sizes/facing/prices, nearby places, payment) — it is ALL here already. Answer straight from this text. Only reach for a tool for a detail genuinely not listed. Calling a tool you don't need makes the customer wait.",
    "State only what appears here; anything absent → say the sales team will confirm.",
  ];

  for (const p of projects) {
    const loc = [p.village, p.mandal, p.district, p.state, p.pincode].filter(Boolean).join(", ");
    lines.push(`\n## ${p.name}${p.developer ? ` by ${p.developer}` : ""}`);
    if (loc) lines.push(`Location: ${loc}`);
    if (p.status) lines.push(`Status: ${p.status}${p.expected_delivery ? `, delivery ${p.expected_delivery}` : ""}`);
    if (p.rera_number) lines.push(`RERA: ${p.rera_number}`);
    if (p.hmda_permit_no) lines.push(`HMDA permit: ${p.hmda_permit_no}`);
    if (p.price_per_sft_inr) lines.push(`Base rate: ₹${p.price_per_sft_inr.toLocaleString("en-IN")}/sft`);
    if (p.price_note) lines.push(`Price note: ${p.price_note}`);
    if (p.total_land_acres) lines.push(`Land: ${p.total_land_acres} acres, ${p.total_units ?? "?"} units`);

    // Payment schedule / premiums from the pricing jsonb, kept terse.
    const pricing = (p.pricing ?? {}) as Record<string, unknown>;
    const sched = pricing.payment_schedule;
    if (Array.isArray(sched) && sched.length) {
      const terms = sched
        .map((s) => {
          const o = s as Record<string, unknown>;
          return `${o.percent ?? o.percent_on_sheet ?? "?"}% ${o.milestone ?? o.stage ?? ""}`.trim();
        })
        .join("; ");
      lines.push(`Payment: ${terms}`);
    }

    const mine = villaTypes.filter((t) => t.project_id === p.id);
    if (mine.length) {
      lines.push("Villa types:");
      for (const t of mine) {
        const bits = [
          t.plot_area_sqyd ? `${t.plot_area_sqyd} sq yd` : null,
          t.built_up_sft ? `${t.built_up_sft} sft` : null,
          t.bedrooms ? `${t.bedrooms} BHK` : null,
          t.facing ? `${t.facing} facing` : null,
          t.price_inr ? `₹${(t.price_inr / 10000000).toFixed(2)} Cr` : "price: sales team confirms",
        ].filter(Boolean);
        lines.push(`  • ${t.name}: ${bits.join(", ")}`);
      }
    }

    // Connectivity/distance — commonly asked, cheap to inline. Approximate
    // drive times to nearby landmarks let the agent give a range for "how far
    // is X" instead of deferring, per the sales playbook.
    const conn = (p as unknown as { connectivity?: unknown }).connectivity;
    if (Array.isArray(conn) && conn.length) {
      // All places with drive times, so the agent can answer "how far is X",
      // "nearby schools/hospitals/IT hubs/malls/areas" from one inline list.
      const near = conn
        .map((c) => {
          const o = c as Record<string, unknown>;
          return o.place && o.minutes ? `${o.place} ~${o.minutes} min` : null;
        })
        .filter(Boolean)
        .join(", ");
      if (near) lines.push(`Nearby, with approx drive times: ${near}`);
    }

    // Social infrastructure lists (schools, hospitals) — commonly asked and
    // cheap to inline, so the agent names real nearby schools and hospitals
    // instead of deferring.
    const si = (p as unknown as { social_infrastructure?: Record<string, unknown> })
      .social_infrastructure;
    if (si && typeof si === "object") {
      const listOf = (k: string) =>
        Array.isArray(si[k]) ? (si[k] as unknown[]).map(String).join(", ") : "";
      const schools = listOf("schools");
      const hospitals = listOf("hospitals");
      const growth = listOf("growth_drivers");
      if (schools) lines.push(`Schools nearby: ${schools}`);
      if (hospitals) lines.push(`Hospitals nearby: ${hospitals}`);
      if (growth) lines.push(`Area growth drivers: ${growth}`);
    }
  }

  // FAQs are deliberately NOT inlined — 36 of them is ~2,500 tokens, which
  // pushed each call over the per-minute budget. They stay reachable through
  // the search_knowledge_base tool for questions the inline facts don't cover.
  lines.push("\nFor exact distances from a specific area, or anything not above, offer a callback or call search_knowledge_base.");
  lines.push("\n# END OF APPROVED FACTS");
  return lines.join("\n");
}
