import { mutate, read } from "../db";
import { SERENITY_PLOTS } from "./serenity-plots";
import { isPublishedPlotSize, villaTypeFor } from "./villa-types";
import { onyxUnitType } from "./onyx-units";
import { logActivity } from "../engine/publisher";
import type { InventoryUnit, UnitStatus } from "../types";

/**
 * Unit inventory for the two showcase projects.
 *
 * The public layout is only useful if every villa and every flat on it can be
 * clicked and answers "can I buy this one?". That answer has to come from the
 * same store the CRM writes to, otherwise the site and the sales desk disagree
 * within a day — so a unit is a first-class record here, not a colour baked
 * into an SVG.
 */

export const UNIT_STATUSES: UnitStatus[] = [
  "available",
  "no_leads",
  "enquiry",
  "deal_pending",
  "blocked",
  "sold",
];

export type Project = "serenity" | "onyx";

/** Marker on every generated record; a human edit clears it. */
export const DEMO_NOTE = "Demo inventory — real sales activity overwrites this.";

export function unitId(brandId: string, project: Project, unitNumber: string): string {
  return `unit_${brandId}_${project}_${unitNumber}`;
}

/* ------------------------------------------------------------------ PRNG */

/**
 * Deterministic PRNG keyed by unit number.
 *
 * Restart-stable on purpose: a demo where villa 42 is "sold" today and
 * "available" after a redeploy makes the whole layout look fake.
 */
export function seededRandom(key: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let s = h || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const SPREAD: Array<[UnitStatus, number]> = [
  ["available", 0.55],
  ["no_leads", 0.15],
  ["enquiry", 0.12],
  ["deal_pending", 0.08],
  ["blocked", 0.03],
  ["sold", 0.07],
];

export function demoStatus(key: string): UnitStatus {
  const r = seededRandom(key)();
  let acc = 0;
  for (const [status, weight] of SPREAD) {
    acc += weight;
    if (r < acc) return status;
  }
  return "available";
}

/* ------------------------------------------------------------- generators */

export interface SerenityPlot {
  /** The plan module names it `villaNo`; `number` is the documented alias. */
  villaNo?: string;
  number?: string;
  plotSqYds: number | null;
  cluster?: string;
  bhk?: string;
}

function plotNumber(p: SerenityPlot): string {
  return p.villaNo ?? p.number ?? "";
}

/** The plot table is generated into its own module and imported statically. */
function serenityPlots(): SerenityPlot[] {
  return SERENITY_PLOTS.filter((p) => plotNumber(p));
}

export const ONYX_FLOORS = 35;
export const ONYX_UNITS_PER_FLOOR = 7;
export const ONYX_TOTAL = 245;

/** "1204" = floor 12, unit 04. Floors 1..35, units 01..07 → 245 flats. */
export function onyxUnitNumbers(): string[] {
  const out: string[] = [];
  for (let floor = 1; floor <= ONYX_FLOORS; floor++) {
    for (let u = 1; u <= ONYX_UNITS_PER_FLOOR; u++) {
      out.push(`${floor}${String(u).padStart(2, "0")}`);
    }
  }
  return out;
}

// Built-up area, facing and configuration per position come from the client's
// APARTMENT PLAN sheets (see onyx-units.ts) — the seven positions repeat on
// every floor, so a unit number determines its type.

function buildSerenityUnits(brandId: string, now: string): InventoryUnit[] {
  return serenityPlots().map((p) => {
    const number = plotNumber(p);
    // Only an exactly published plot size (200 / 267 / 300) gets a built-up area
    // and a configuration; every other size stays unset so the UI says
    // "to be confirmed" rather than quoting a figure the sheets never printed.
    // The BHK count is the same for both facings at a given published size, so
    // it is safe on size alone; the built-up area differs between the East and
    // West sheets, so it is only set when the plan actually states a facing.
    const facing = (p as { facing?: string }).facing;
    const match = villaTypeFor(p.plotSqYds ?? null, facing ?? null);
    const published = match?.exact && isPublishedPlotSize(p.plotSqYds ?? -1) ? match.type : undefined;
    return {
      id: unitId(brandId, "serenity", number),
      brandId,
      project: "serenity" as const,
      unitNumber: number,
      kind: "villa" as const,
      status: demoStatus(`serenity:${number}`),
      plotSqYds: p.plotSqYds ?? undefined,
      // Configuration per plot is not published; only set it when real data exists.
      bhk: p.bhk ?? published?.bhk,
      builtUpSqFt: facing ? published?.totalSqFt : undefined,
      facing,
      tower: p.cluster,
      updatedAt: now,
      notes: DEMO_NOTE,
    };
  });
}

function buildOnyxUnits(brandId: string, now: string): InventoryUnit[] {
  return onyxUnitNumbers().map((n) => {
    const type = onyxUnitType(n);
    return {
      id: unitId(brandId, "onyx", n),
      brandId,
      project: "onyx" as const,
      unitNumber: n,
      kind: "flat" as const,
      status: demoStatus(`onyx:${n}`),
      builtUpSqFt: type?.sqFt,
      facing: type?.facing,
      bhk: type?.bhk,
      floor: Number(n.slice(0, -2)),
      tower: "Onyx",
      updatedAt: now,
      notes: DEMO_NOTE,
    };
  });
}

/* ------------------------------------------------------------------ reads */

export function listUnits(brandId: string, project?: Project): InventoryUnit[] {
  return read()
    .inventoryUnits.filter((u) => u.brandId === brandId && (!project || u.project === project))
    .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
}

export function getUnit(id: string): InventoryUnit | undefined {
  return read().inventoryUnits.find((u) => u.id === id);
}

export type StatusSummary = Record<UnitStatus, number> & { total: number };

export function statusSummary(brandId: string, project?: Project): StatusSummary {
  const summary = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as StatusSummary;
  summary.total = 0;
  for (const u of listUnits(brandId, project)) {
    summary[u.status] += 1;
    summary.total += 1;
  }
  return summary;
}

/* ----------------------------------------------------------------- writes */

export interface SetStatusOptions {
  leadId?: string;
  customerId?: string;
  notes?: string;
  assignedTo?: string;
  blockedUntil?: string;
  /** Bypass the transition guard for a manager correction. */
  override?: boolean;
}

export class InventoryError extends Error {}

/**
 * Move a unit's status, recording who did it.
 *
 * The one hard rule is that "sold" needs a customer on the record (or an
 * explicit override): a unit marked sold with nobody attached is how a villa
 * disappears from the site with no way to find out who bought it.
 */
export function setUnitStatus(
  unitId: string,
  status: UnitStatus,
  actor: string,
  opts: SetStatusOptions = {},
): InventoryUnit {
  if (!UNIT_STATUSES.includes(status)) throw new InventoryError(`Unknown status "${status}".`);

  const updated = mutate((db) => {
    const unit = db.inventoryUnits.find((u) => u.id === unitId);
    if (!unit) throw new InventoryError("Unit not found.");

    const customerId = opts.customerId ?? unit.customerId;
    if (status === "sold" && !customerId && !opts.override) {
      throw new InventoryError("A unit can only be marked sold with a linked customer.");
    }
    if (status === "deal_pending" && !(opts.leadId ?? unit.leadId) && !opts.override) {
      throw new InventoryError("A deal in progress needs a linked lead.");
    }

    const from = unit.status;
    unit.status = status;
    if (opts.leadId !== undefined) unit.leadId = opts.leadId;
    if (opts.customerId !== undefined) unit.customerId = opts.customerId;
    if (opts.assignedTo !== undefined) unit.assignedTo = opts.assignedTo;
    if (opts.blockedUntil !== undefined) unit.blockedUntil = opts.blockedUntil;
    // A human touched it: it is no longer demo data and re-seeding leaves it be.
    unit.notes = opts.notes ?? (unit.notes === DEMO_NOTE ? undefined : unit.notes);
    unit.updatedAt = new Date().toISOString();
    return { unit: { ...unit }, from };
  });

  logActivity(
    updated.unit.brandId,
    "inventory_status",
    `${updated.unit.project === "onyx" ? "Flat" : "Villa"} ${updated.unit.unitNumber}: ${updated.from} → ${status}`,
    actor,
  );
  return updated.unit;
}

export function linkLead(unitId: string, leadId: string, actor = "system"): InventoryUnit {
  const unit = getUnit(unitId);
  if (!unit) throw new InventoryError("Unit not found.");
  // Linking a lead to an untouched unit is itself an enquiry.
  const next: UnitStatus = unit.status === "available" || unit.status === "no_leads" ? "enquiry" : unit.status;
  return setUnitStatus(unitId, next, actor, { leadId });
}

/* ----------------------------------------------------------------- seeding */

/**
 * Create any missing units for a brand. Idempotent: an existing unit is never
 * overwritten, so a status a person set survives every re-seed.
 */
export function ensureInventorySeed(brandId: string): { created: number; kept: number } {
  const now = new Date().toISOString();
  const candidates = [...buildSerenityUnits(brandId, now), ...buildOnyxUnits(brandId, now)];
  return mutate((db) => {
    const existing = new Set(db.inventoryUnits.filter((u) => u.brandId === brandId).map((u) => u.id));
    const fresh = candidates.filter((u) => !existing.has(u.id));
    db.inventoryUnits.push(...fresh);
    // Backfill the printed specification onto units seeded before the client
    // supplied the plan sheets. Status, leads and notes are never touched, so a
    // human-set record keeps everything a person decided about it.
    for (const u of db.inventoryUnits) {
      if (u.brandId !== brandId || u.project !== "onyx") continue;
      const type = onyxUnitType(u.unitNumber);
      if (!type) continue;
      u.builtUpSqFt = type.sqFt;
      u.facing = type.facing;
      if (type.bhk) u.bhk = type.bhk;
    }
    return { created: fresh.length, kept: existing.size };
  });
}
