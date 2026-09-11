import { db } from "./supabase";

/**
 * Per-unit inventory (villa_units).
 *
 * This table is the only thing that lets the agent answer "what's available?".
 * When it is empty, check_availability deliberately reports
 * live_inventory_connected: false and the agent tells the customer the sales
 * team will confirm — so anything written here is treated downstream as
 * verified fact the agent may quote. Nothing in this file invents a row.
 */

export type UnitStatus = "available" | "blocked" | "sold";

export const UNIT_STATUSES: UnitStatus[] = ["available", "blocked", "sold"];

const STATUS_SET = new Set<string>(UNIT_STATUSES);

export function isUnitStatus(value: string): value is UnitStatus {
  return STATUS_SET.has(value);
}

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  available: "Available",
  blocked: "Blocked",
  sold: "Sold",
};

/** Board colours. Available reads as the positive state, sold as spent. */
export const UNIT_STATUS_STYLES: Record<UnitStatus, string> = {
  available: "border-[--color-gold-500]/40 bg-[--color-raised] text-[--color-gold-300]",
  blocked: "border-[--color-gold-500]/40 bg-[--color-gold-soft] text-[--color-gold-300]",
  sold: "border-[--color-line] bg-[--color-canvas] text-[--color-muted]",
};

export interface Unit {
  id: string;
  project_id: string;
  villa_type_id: string | null;
  unit_number: string;
  facing: string | null;
  is_corner: boolean;
  price_inr: number | null;
  status: string;
  updated_at: string;
}

export type StatusCounts = Record<UnitStatus, number>;

export interface TypeInventory {
  villaTypeId: string | null;
  typeName: string;
  projectName: string | null;
  priceInr: number | null;
  units: Unit[];
  counts: StatusCounts;
  total: number;
}

export interface InventorySummary {
  groups: TypeInventory[];
  totals: StatusCounts;
  total: number;
}

function emptyCounts(): StatusCounts {
  return { available: 0, blocked: 0, sold: 0 };
}

export async function listUnits(projectId?: string): Promise<Unit[]> {
  let query = db().from("villa_units").select("*").order("unit_number");
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query;
  return (data ?? []) as Unit[];
}

export async function unitsByStatus(projectId?: string): Promise<Record<UnitStatus, Unit[]>> {
  const grouped: Record<UnitStatus, Unit[]> = { available: [], blocked: [], sold: [] };
  for (const unit of await listUnits(projectId)) {
    if (isUnitStatus(unit.status)) grouped[unit.status].push(unit);
  }
  return grouped;
}

/**
 * Counts by status per villa type.
 *
 * Villa types with zero units are still returned: "we sell this configuration
 * and have loaded no stock for it" is real information, and hiding the row
 * would make an empty board look like a complete one.
 */
export async function inventorySummary(projectId?: string): Promise<InventorySummary> {
  const [units, typesResult, projectsResult] = await Promise.all([
    listUnits(projectId),
    db().from("villa_types").select("id, project_id, name, price_inr").order("name"),
    db().from("villa_projects").select("id, name"),
  ]);

  const types = (typesResult.data ?? []) as Array<{
    id: string;
    project_id: string;
    name: string;
    price_inr: number | null;
  }>;
  const projectNames = new Map(
    ((projectsResult.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );

  const scopedTypes = projectId ? types.filter((t) => t.project_id === projectId) : types;

  const groups: TypeInventory[] = scopedTypes.map((t) => ({
    villaTypeId: t.id,
    typeName: t.name,
    projectName: projectNames.get(t.project_id) ?? null,
    priceInr: t.price_inr,
    units: [],
    counts: emptyCounts(),
    total: 0,
  }));

  const byTypeId = new Map(groups.map((g) => [g.villaTypeId, g]));
  const totals = emptyCounts();

  for (const unit of units) {
    let group = unit.villa_type_id ? byTypeId.get(unit.villa_type_id) : undefined;
    if (!group) {
      // A unit whose villa type was deleted, or that was loaded without one.
      group = byTypeId.get(null);
      if (!group) {
        group = {
          villaTypeId: null,
          typeName: "Unassigned",
          projectName: projectNames.get(unit.project_id) ?? null,
          priceInr: null,
          units: [],
          counts: emptyCounts(),
          total: 0,
        };
        groups.push(group);
        byTypeId.set(null, group);
      }
    }

    group.units.push(unit);
    group.total += 1;
    if (isUnitStatus(unit.status)) {
      group.counts[unit.status] += 1;
      totals[unit.status] += 1;
    }
  }

  return { groups, totals, total: units.length };
}

export interface NewUnit {
  projectId: string;
  unitNumber: string;
  villaTypeId?: string | null;
  facing?: string | null;
  isCorner?: boolean;
  priceInr?: number | null;
  status?: UnitStatus;
}

export async function createUnit(input: NewUnit): Promise<{ ok: true; unit: Unit } | { ok: false; error: string }> {
  const unitNumber = input.unitNumber.trim();
  if (!input.projectId) return { ok: false, error: "a project is required" };
  if (!unitNumber) return { ok: false, error: "a unit number is required" };

  const status = input.status ?? "available";
  if (!isUnitStatus(status)) return { ok: false, error: `invalid status: ${status}` };

  if (input.villaTypeId) {
    const { data: type } = await db()
      .from("villa_types")
      .select("id, project_id")
      .eq("id", input.villaTypeId)
      .maybeSingle();
    if (!type) return { ok: false, error: "villa type not found" };
    if (type.project_id !== input.projectId) {
      return { ok: false, error: "that villa type belongs to a different project" };
    }
  }

  const { data, error } = await db()
    .from("villa_units")
    .insert({
      project_id: input.projectId,
      villa_type_id: input.villaTypeId || null,
      unit_number: unitNumber,
      facing: input.facing?.trim() || null,
      is_corner: input.isCorner ?? false,
      price_inr: input.priceInr ?? null,
      status,
    })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, unit: data as Unit };
}

export async function updateUnitStatus(
  unitId: string,
  status: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUnitStatus(status)) return { ok: false, error: `invalid status: ${status}` };

  // villa_units has no updated_at trigger (0001 only installs one on leads and
  // projects), so the timestamp has to be set here or the board goes stale.
  const { error } = await db()
    .from("villa_units")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", unitId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface UnitDraft {
  unitNumber: string;
  villaTypeName?: string | null;
  facing?: string | null;
  isCorner?: boolean;
  priceInr?: number | null;
  status?: UnitStatus;
}

/**
 * Bulk-loads units a human has supplied, resolving villa types by name.
 *
 * Deliberately takes an explicit list. The tempting version of this helper
 * reads villa_projects.total_units and generates that many unit numbers per
 * villa type — but the DB knows how many units a project has, not what they
 * are called, which way they face, or which are sold. Those generated rows
 * would then be handed to the customer under check_availability's "this is
 * verified live inventory" note. So: no list, no units.
 */
export async function importUnitsFromTypes(
  projectId: string,
  units: UnitDraft[],
): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  if (!projectId) return { ok: false, error: "a project is required" };
  if (!units.length) {
    return {
      ok: false,
      error:
        "no units supplied — inventory is only ever created from an explicit list, never generated from villa type or project counts",
    };
  }

  const { data: typeRows } = await db()
    .from("villa_types")
    .select("id, name")
    .eq("project_id", projectId);
  const typeIdByName = new Map(
    ((typeRows ?? []) as Array<{ id: string; name: string }>).map((t) => [t.name.toLowerCase(), t.id]),
  );

  const rows = [];
  for (const draft of units) {
    const unitNumber = draft.unitNumber?.trim();
    if (!unitNumber) return { ok: false, error: "every unit needs a unit_number" };

    let villaTypeId: string | null = null;
    if (draft.villaTypeName) {
      villaTypeId = typeIdByName.get(draft.villaTypeName.trim().toLowerCase()) ?? null;
      if (!villaTypeId) {
        return { ok: false, error: `unknown villa type "${draft.villaTypeName}" for this project` };
      }
    }

    const status = draft.status ?? "available";
    if (!isUnitStatus(status)) return { ok: false, error: `invalid status: ${status}` };

    rows.push({
      project_id: projectId,
      villa_type_id: villaTypeId,
      unit_number: unitNumber,
      facing: draft.facing?.trim() || null,
      is_corner: draft.isCorner ?? false,
      price_inr: draft.priceInr ?? null,
      status,
      updated_at: new Date().toISOString(),
    });
  }

  // Re-importing a corrected sheet should update the existing rows rather than
  // fail on the (project_id, unit_number) unique constraint.
  const { error } = await db().from("villa_units").upsert(rows, { onConflict: "project_id,unit_number" });
  if (error) return { ok: false, error: error.message };

  return { ok: true, imported: rows.length };
}
