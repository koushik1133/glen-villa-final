import { db } from "../supabase";

/**
 * Pricing and inventory observations, derived only.
 *
 * There is no pricing model here and there never will be one: nothing in this
 * database says what a villa is worth. What the data CAN show is where demand
 * and absorption disagree — one configuration selling out while another with
 * the same lead interest sits available, price objections concentrating on one
 * type, corner premiums that do or do not slow a unit down.
 *
 * So every recommendation is an observation plus the numbers behind it plus a
 * DIRECTION to review. None of them ever names a price. Each rule also carries
 * a minimum-evidence threshold — a "3x faster" claim off four units is noise
 * dressed as insight, and would be exactly the kind of invented fact this
 * product exists to avoid.
 */

export interface RecommendationEvidence {
  label: string;
  value: string;
}

export interface Recommendation {
  id: string;
  /** What the data shows. States numbers only. */
  observation: string;
  /** Why it might matter. Never asserts a cause it cannot see. */
  reading: string;
  /** What a human should do next. Never a price. */
  action: string;
  evidence: RecommendationEvidence[];
  tone: "gold" | "info" | "warning" | "success";
  category: "absorption" | "demand" | "objections" | "premium";
}

export interface TypeStat {
  villaTypeId: string;
  projectName: string;
  villaType: string;
  totalUnits: number;
  available: number;
  underBooking: number;
  reserved: number;
  sold: number;
  /** Sold + reserved + under booking, as a share of total units. */
  absorptionPct: number | null;
  /** Leads whose stated interest is this villa type. */
  leadInterest: number;
  /** Price/budget objections raised by leads interested in this type. */
  priceObjections: number;
}

export interface FacingStat {
  facing: string;
  units: number;
  taken: number;
  takenPct: number | null;
  /** Mean chargeable extra area across units of this facing that carry any. */
  avgExtraSqyd: number | null;
  unitsWithExtra: number;
}

export interface PricingEvidenceBase {
  types: TypeStat[];
  facings: FacingStat[];
  cornerUnits: number;
  cornerTaken: number;
  standardUnits: number;
  standardTaken: number;
  avgCornerExtraSqyd: number | null;
  totalUnits: number;
  totalObjections: number;
  /** Tables that could not be read, so the page can say so instead of showing nothing. */
  unavailable: string[];
}

export interface PricingReport {
  base: PricingEvidenceBase;
  recommendations: Recommendation[];
  /** Why there are no recommendations, when there are none. */
  blockers: string[];
}

/**
 * Minimum evidence before a rule may speak. These are the whole argument: a
 * ratio between two tiny numbers is arithmetic, not a finding.
 */
export const MIN = {
  /** Units in a villa type before its absorption rate means anything. */
  unitsPerType: 4,
  /** Villa types needed to compare absorption across configurations. */
  typesToCompare: 2,
  /** How much faster one type must absorb before it is worth flagging. */
  absorptionRatio: 1.75,
  /** Absolute gap in percentage points, so 8% vs 4% does not read as "2x". */
  absorptionGapPct: 15,
  /** Leads expressing a type preference before demand can be ranked. */
  leadInterestTotal: 10,
  /** Price objections recorded before their distribution means anything. */
  priceObjections: 5,
  /** Units carrying chargeable extra area before a premium can be discussed. */
  unitsWithExtra: 3,
  /** Units per facing before facings can be compared. */
  unitsPerFacing: 4,
} as const;

/** Objection categories that are about money rather than product or trust. */
const PRICE_OBJECTION_PATTERN = /price|budget|cost|expensive|afford|payment|emi|loan/i;

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((100 * part) / whole * 10) / 10;
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

interface InventoryRow {
  project_name: string;
  villa_type: string;
  villa_type_id: string;
  total_units: number;
  available: number;
  under_booking: number;
  reserved: number;
  sold: number;
}

interface UnitRow {
  villa_type_id: string | null;
  facing: string | null;
  is_corner: boolean;
  chargeable_extra_sqyd: number | null;
  status: string;
}

interface ObjectionRow {
  category: string;
  villa_leads: { villa_type_interest: string | null } | null;
}

/** A unit is "taken" once it has left general availability, however far along. */
const TAKEN_STATUSES = new Set(["sold", "reserved", "under_booking"]);

export async function loadPricingReport(): Promise<PricingReport> {
  const supabase = db();

  const [inventoryRes, unitsRes, objectionsRes, typesRes] = await Promise.all([
    supabase.from("villa_inventory_summary").select("*").limit(50),
    supabase
      .from("villa_units")
      .select("villa_type_id, facing, is_corner, chargeable_extra_sqyd, status")
      .limit(2000),
    supabase
      .from("villa_objections")
      .select("category, villa_leads(villa_type_interest)")
      .limit(2000),
    supabase
      .from("villa_leads")
      .select("villa_type_interest")
      .not("villa_type_interest", "is", null)
      .limit(5000),
  ]);

  const unavailable: string[] = [];
  if (inventoryRes.error) unavailable.push("inventory summary");
  if (unitsRes.error) unavailable.push("unit-level detail");
  if (objectionsRes.error) unavailable.push("objections");
  if (typesRes.error) unavailable.push("lead villa-type interest");

  const inventory = (inventoryRes.data ?? []) as InventoryRow[];
  const units = (unitsRes.data ?? []) as UnitRow[];
  const objections = (objectionsRes.data ?? []) as unknown as ObjectionRow[];
  const interests = (typesRes.data ?? []) as Array<{ villa_type_interest: string }>;

  const interestByType = new Map<string, number>();
  for (const row of interests) {
    interestByType.set(row.villa_type_interest, (interestByType.get(row.villa_type_interest) ?? 0) + 1);
  }

  const priceObjectionsByType = new Map<string, number>();
  let totalObjections = 0;
  for (const o of objections) {
    totalObjections += 1;
    if (!PRICE_OBJECTION_PATTERN.test(o.category)) continue;
    const typeId = o.villa_leads?.villa_type_interest;
    if (!typeId) continue;
    priceObjectionsByType.set(typeId, (priceObjectionsByType.get(typeId) ?? 0) + 1);
  }

  const types: TypeStat[] = inventory.map((row) => {
    const taken = Number(row.sold) + Number(row.reserved) + Number(row.under_booking);
    return {
      villaTypeId: row.villa_type_id,
      projectName: row.project_name,
      villaType: row.villa_type,
      totalUnits: Number(row.total_units),
      available: Number(row.available),
      underBooking: Number(row.under_booking),
      reserved: Number(row.reserved),
      sold: Number(row.sold),
      absorptionPct: pct(taken, Number(row.total_units)),
      leadInterest: interestByType.get(row.villa_type_id) ?? 0,
      priceObjections: priceObjectionsByType.get(row.villa_type_id) ?? 0,
    };
  });

  // Facing and corner analysis works off units, not the type view: facing is a
  // per-plot attribute and two units of the same type face differently.
  const facingMap = new Map<string, { units: number; taken: number; extraSum: number; withExtra: number }>();
  let cornerUnits = 0;
  let cornerTaken = 0;
  let standardUnits = 0;
  let standardTaken = 0;
  let cornerExtraSum = 0;
  let cornerWithExtra = 0;

  for (const u of units) {
    const taken = TAKEN_STATUSES.has(u.status) ? 1 : 0;
    const extra = Number(u.chargeable_extra_sqyd ?? 0);

    if (u.facing) {
      const key = u.facing.trim();
      const entry = facingMap.get(key) ?? { units: 0, taken: 0, extraSum: 0, withExtra: 0 };
      entry.units += 1;
      entry.taken += taken;
      if (extra > 0) {
        entry.extraSum += extra;
        entry.withExtra += 1;
      }
      facingMap.set(key, entry);
    }

    if (u.is_corner) {
      cornerUnits += 1;
      cornerTaken += taken;
      if (extra > 0) {
        cornerExtraSum += extra;
        cornerWithExtra += 1;
      }
    } else {
      standardUnits += 1;
      standardTaken += taken;
    }
  }

  const facings: FacingStat[] = [...facingMap.entries()]
    .map(([facing, v]) => ({
      facing,
      units: v.units,
      taken: v.taken,
      takenPct: pct(v.taken, v.units),
      avgExtraSqyd: v.withExtra > 0 ? round(v.extraSum / v.withExtra) : null,
      unitsWithExtra: v.withExtra,
    }))
    .sort((a, b) => (b.takenPct ?? -1) - (a.takenPct ?? -1));

  const base: PricingEvidenceBase = {
    types: [...types].sort((a, b) => (b.absorptionPct ?? -1) - (a.absorptionPct ?? -1)),
    facings,
    cornerUnits,
    cornerTaken,
    standardUnits,
    standardTaken,
    avgCornerExtraSqyd: cornerWithExtra > 0 ? round(cornerExtraSum / cornerWithExtra) : null,
    totalUnits: units.length,
    totalObjections,
    unavailable,
  };

  const { recommendations, blockers } = derive(base);
  return { base, recommendations, blockers };
}

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------

function derive(base: PricingEvidenceBase): { recommendations: Recommendation[]; blockers: string[] } {
  const recommendations: Recommendation[] = [];
  const blockers: string[] = [];

  const comparable = base.types.filter(
    (t) => t.totalUnits >= MIN.unitsPerType && t.absorptionPct !== null,
  );

  // --- Absorption spread between configurations -------------------------------
  if (comparable.length < MIN.typesToCompare) {
    blockers.push(
      `Absorption comparison needs at least ${MIN.typesToCompare} villa types with ${MIN.unitsPerType}+ units each. ` +
        `Currently ${comparable.length} qualif${comparable.length === 1 ? "ies" : "y"}. Add the remaining units in Inventory.`,
    );
  } else {
    const fastest = comparable[0];
    const slowest = comparable[comparable.length - 1];
    const fast = fastest.absorptionPct ?? 0;
    const slow = slowest.absorptionPct ?? 0;
    const gap = fast - slow;
    const ratio = slow > 0 ? fast / slow : Infinity;

    if (gap >= MIN.absorptionGapPct && ratio >= MIN.absorptionRatio) {
      const multiple = Number.isFinite(ratio) ? `${round(ratio)}x` : "with no comparable movement";
      recommendations.push({
        id: "absorption-spread",
        category: "absorption",
        tone: "gold",
        observation:
          `${fastest.villaType} has absorbed ${fast}% of its ${fastest.totalUnits} units. ` +
          `${slowest.villaType} has absorbed ${slow}% of its ${slowest.totalUnits}. ` +
          `That is ${multiple} the rate, a ${round(gap)} point gap.`,
        reading:
          "Two configurations in the same project are moving at very different speeds. The cause could be relative price, plot position, or the mix that was released first — the data here cannot tell which.",
        action: `Review ${fastest.villaType} and ${slowest.villaType} side by side and decide whether their relative positioning still reflects demand. The sales team sets any number; nothing in this database prices a villa.`,
        evidence: [
          { label: `${fastest.villaType} absorbed`, value: `${fastest.sold + fastest.reserved + fastest.underBooking} of ${fastest.totalUnits} (${fast}%)` },
          { label: `${slowest.villaType} absorbed`, value: `${slowest.sold + slowest.reserved + slowest.underBooking} of ${slowest.totalUnits} (${slow}%)` },
          { label: `${fastest.villaType} still available`, value: String(fastest.available) },
          { label: `${slowest.villaType} still available`, value: String(slowest.available) },
        ],
      });
    }

    // --- Scarcity on the fastest-moving type ----------------------------------
    const scarce = comparable.filter((t) => t.available > 0 && (t.absorptionPct ?? 0) >= 80);
    for (const t of scarce.slice(0, 2)) {
      recommendations.push({
        id: `scarcity-${t.villaTypeId}`,
        category: "absorption",
        tone: "warning",
        observation: `${t.villaType} is ${t.absorptionPct}% absorbed with ${t.available} unit${t.available === 1 ? "" : "s"} still available.`,
        reading:
          "The last few units of a configuration are the ones with the least competition for the buyer's attention and the most for the developer's.",
        action:
          "Decide deliberately how the remaining units are released and positioned, rather than letting them go at the same terms as the first ones. Any figure is a sales-team call.",
        evidence: [
          { label: "Total units", value: String(t.totalUnits) },
          { label: "Sold", value: String(t.sold) },
          { label: "Reserved / under booking", value: String(t.reserved + t.underBooking) },
          { label: "Available", value: String(t.available) },
          ...(t.leadInterest > 0
            ? [{ label: "Leads naming this type", value: String(t.leadInterest) }]
            : []),
        ],
      });
    }
  }

  // --- Demand vs absorption mismatch -----------------------------------------
  const totalInterest = base.types.reduce((s, t) => s + t.leadInterest, 0);
  if (totalInterest < MIN.leadInterestTotal) {
    blockers.push(
      `Demand ranking needs at least ${MIN.leadInterestTotal} leads with a villa type recorded against them. ` +
        `Currently ${totalInterest}. The agent sets villa_type_interest when a buyer names a configuration.`,
    );
  } else {
    const byInterest = [...base.types].sort((a, b) => b.leadInterest - a.leadInterest);
    const mostWanted = byInterest[0];
    const share = pct(mostWanted.leadInterest, totalInterest);

    if (mostWanted.leadInterest > 0 && share !== null) {
      const stalled =
        mostWanted.totalUnits >= MIN.unitsPerType &&
        (mostWanted.absorptionPct ?? 0) < 40 &&
        share >= 40;

      recommendations.push({
        id: "demand-concentration",
        category: "demand",
        tone: stalled ? "warning" : "info",
        observation:
          `${mostWanted.leadInterest} of ${totalInterest} leads with a stated preference (${share}%) name ${mostWanted.villaType}` +
          (mostWanted.absorptionPct !== null
            ? `, which is ${mostWanted.absorptionPct}% absorbed.`
            : ", which has no units recorded yet."),
        reading: stalled
          ? "The most-requested configuration is not converting into units taken. Interest is arriving but stopping somewhere between the enquiry and the booking."
          : "Interest is concentrated on one configuration. That is useful for creative targeting and for deciding what to release next.",
        action: stalled
          ? `Read the objections logged against ${mostWanted.villaType} leads before changing anything, and check whether these buyers are reaching a site visit at all.`
          : `Point ad creative and the first WhatsApp reply at ${mostWanted.villaType}, and make sure its floor plan and collateral are complete.`,
        evidence: [
          { label: `Leads naming ${mostWanted.villaType}`, value: String(mostWanted.leadInterest) },
          { label: "Leads with any type preference", value: String(totalInterest) },
          { label: "Share of stated preferences", value: `${share}%` },
          ...(mostWanted.absorptionPct !== null
            ? [
                {
                  label: "Units taken",
                  value: `${mostWanted.sold + mostWanted.reserved + mostWanted.underBooking} of ${mostWanted.totalUnits} (${mostWanted.absorptionPct}%)`,
                },
              ]
            : []),
        ],
      });
    }
  }

  // --- Price objections by configuration -------------------------------------
  const typedPriceObjections = base.types.reduce((s, t) => s + t.priceObjections, 0);
  if (typedPriceObjections < MIN.priceObjections) {
    blockers.push(
      `Price-objection analysis needs at least ${MIN.priceObjections} price objections from leads with a villa type recorded. ` +
        `Currently ${typedPriceObjections} of ${base.totalObjections} logged objection${base.totalObjections === 1 ? "" : "s"} qualify.`,
    );
  } else {
    const ranked = [...base.types]
      .filter((t) => t.priceObjections > 0)
      .sort((a, b) => b.priceObjections - a.priceObjections);
    const top = ranked[0];
    const share = pct(top.priceObjections, typedPriceObjections);

    recommendations.push({
      id: "price-objection-concentration",
      category: "objections",
      tone: "warning",
      observation:
        `${top.priceObjections} of ${typedPriceObjections} price objections (${share}%) come from leads interested in ${top.villaType}` +
        (top.absorptionPct !== null ? `, which is ${top.absorptionPct}% absorbed.` : "."),
      reading:
        "Price resistance is not spread evenly across the range. It concentrates on one configuration, which is either a positioning problem or a value-communication problem — the objection text says which, this count does not.",
      action: `Read the verbatim objections for ${top.villaType} on the Objections page, then decide whether the answer is different creative, a different first reply, or a commercial review. Any price change is the sales team's to make.`,
      evidence: [
        { label: `Price objections on ${top.villaType}`, value: String(top.priceObjections) },
        { label: "Price objections with a type recorded", value: String(typedPriceObjections) },
        { label: "All objections logged", value: String(base.totalObjections) },
        ...ranked.slice(1, 3).map((t) => ({
          label: `Next: ${t.villaType}`,
          value: String(t.priceObjections),
        })),
      ],
    });
  }

  // --- Corner / chargeable extra area ----------------------------------------
  const unitsWithExtra = base.facings.reduce((s, f) => s + f.unitsWithExtra, 0);
  if (base.cornerUnits === 0 && unitsWithExtra === 0) {
    blockers.push(
      "Premium analysis needs units carrying chargeable extra area or flagged as corner plots. None are recorded — set is_corner and chargeable_extra_sqyd in Inventory.",
    );
  } else if (base.cornerUnits >= MIN.unitsWithExtra && base.standardUnits >= MIN.unitsWithExtra) {
    const cornerPct = pct(base.cornerTaken, base.cornerUnits);
    const standardPct = pct(base.standardTaken, base.standardUnits);

    if (cornerPct !== null && standardPct !== null) {
      const slower = cornerPct < standardPct;
      recommendations.push({
        id: "corner-premium",
        category: "premium",
        tone: slower ? "warning" : "success",
        observation:
          `Corner units are ${cornerPct}% taken (${base.cornerTaken} of ${base.cornerUnits}) against ${standardPct}% for standard units (${base.standardTaken} of ${base.standardUnits})` +
          (base.avgCornerExtraSqyd !== null
            ? `, and carry ${base.avgCornerExtraSqyd} sq yd of chargeable extra area on average.`
            : "."),
        reading: slower
          ? "The corner premium is being charged and those units are moving more slowly than standard ones. That is a signal about the premium, not proof — corner plots may also simply have been released later."
          : "The corner premium is being charged and those units are still moving at least as fast as standard ones, so the extra chargeable area is not deterring buyers.",
        action: slower
          ? "Check the release dates of the corner units before concluding anything, then review whether the extra chargeable area is being justified to buyers. The sales team decides the number."
          : "Nothing to change. Keep the current positioning and make sure reps can explain what the extra area buys.",
        evidence: [
          { label: "Corner units", value: String(base.cornerUnits) },
          { label: "Corner units taken", value: `${base.cornerTaken} (${cornerPct}%)` },
          { label: "Standard units", value: String(base.standardUnits) },
          { label: "Standard units taken", value: `${base.standardTaken} (${standardPct}%)` },
          ...(base.avgCornerExtraSqyd !== null
            ? [{ label: "Average chargeable extra", value: `${base.avgCornerExtraSqyd} sq yd` }]
            : []),
        ],
      });
    }
  }

  // --- Facing spread ---------------------------------------------------------
  const comparableFacings = base.facings.filter(
    (f) => f.units >= MIN.unitsPerFacing && f.takenPct !== null,
  );
  if (comparableFacings.length >= 2) {
    const best = comparableFacings[0];
    const worst = comparableFacings[comparableFacings.length - 1];
    const gap = (best.takenPct ?? 0) - (worst.takenPct ?? 0);
    const ratio = (worst.takenPct ?? 0) > 0 ? (best.takenPct ?? 0) / (worst.takenPct ?? 1) : Infinity;

    if (gap >= MIN.absorptionGapPct && ratio >= MIN.absorptionRatio) {
      const multiple = Number.isFinite(ratio) ? `${round(ratio)}x faster than` : "while nothing has moved on";
      recommendations.push({
        id: "facing-spread",
        category: "premium",
        tone: "gold",
        observation: `${best.facing}-facing units are absorbing ${multiple} ${worst.facing}-facing ones — ${best.takenPct}% of ${best.units} against ${worst.takenPct}% of ${worst.units}.`,
        reading:
          "Facing is priced the same across most plots here unless chargeable extra area says otherwise, but buyers are clearly not treating the orientations as equivalent.",
        action: `Review the relative positioning of ${best.facing} and ${worst.facing} plots. Direction only — this database contains no basis for a specific figure, and the sales team sets it.`,
        evidence: [
          { label: `${best.facing} taken`, value: `${best.taken} of ${best.units} (${best.takenPct}%)` },
          { label: `${worst.facing} taken`, value: `${worst.taken} of ${worst.units} (${worst.takenPct}%)` },
          ...(best.avgExtraSqyd !== null
            ? [{ label: `${best.facing} avg chargeable extra`, value: `${best.avgExtraSqyd} sq yd` }]
            : []),
          ...(worst.avgExtraSqyd !== null
            ? [{ label: `${worst.facing} avg chargeable extra`, value: `${worst.avgExtraSqyd} sq yd` }]
            : []),
        ],
      });
    }
  } else if (base.totalUnits > 0) {
    blockers.push(
      `Facing comparison needs at least two facings with ${MIN.unitsPerFacing}+ units each. Set the facing on each unit in Inventory.`,
    );
  }

  if (base.totalUnits === 0) {
    blockers.length = 0;
    blockers.push(
      "No units are recorded yet. Every recommendation on this page is derived from unit-level inventory — add units in Inventory and they will appear.",
    );
  }

  return { recommendations, blockers };
}
