"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNIT_STATUS_STYLES = exports.UNIT_STATUS_LABELS = exports.UNIT_STATUSES = void 0;
exports.isUnitStatus = isUnitStatus;
exports.listUnits = listUnits;
exports.unitsByStatus = unitsByStatus;
exports.inventorySummary = inventorySummary;
exports.createUnit = createUnit;
exports.updateUnitStatus = updateUnitStatus;
exports.importUnitsFromTypes = importUnitsFromTypes;
const supabase_1 = require("./supabase");
exports.UNIT_STATUSES = ["available", "blocked", "sold"];
const STATUS_SET = new Set(exports.UNIT_STATUSES);
function isUnitStatus(value) {
    return STATUS_SET.has(value);
}
exports.UNIT_STATUS_LABELS = {
    available: "Available",
    blocked: "Blocked",
    sold: "Sold",
};
/** Board colours. Available reads as the positive state, sold as spent. */
exports.UNIT_STATUS_STYLES = {
    available: "border-[var(--color-gold-500)]/40 bg-[var(--color-raised)] text-[var(--color-gold-300)]",
    blocked: "border-[var(--color-gold-500)]/40 bg-[var(--color-gold-soft)] text-[var(--color-gold-300)]",
    sold: "border-[var(--color-line)] bg-[var(--color-canvas)] text-[var(--color-muted)]",
};
function emptyCounts() {
    return { available: 0, blocked: 0, sold: 0 };
}
async function listUnits(projectId) {
    let query = (0, supabase_1.db)().from("villa_units").select("*").order("unit_number");
    if (projectId)
        query = query.eq("project_id", projectId);
    const { data } = await query;
    return (data ?? []);
}
async function unitsByStatus(projectId) {
    const grouped = { available: [], blocked: [], sold: [] };
    for (const unit of await listUnits(projectId)) {
        if (isUnitStatus(unit.status))
            grouped[unit.status].push(unit);
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
async function inventorySummary(projectId) {
    const [units, typesResult, projectsResult] = await Promise.all([
        listUnits(projectId),
        (0, supabase_1.db)().from("villa_types").select("id, project_id, name, price_inr").order("name"),
        (0, supabase_1.db)().from("villa_projects").select("id, name"),
    ]);
    const types = (typesResult.data ?? []);
    const projectNames = new Map((projectsResult.data ?? []).map((p) => [p.id, p.name]));
    const scopedTypes = projectId ? types.filter((t) => t.project_id === projectId) : types;
    const groups = scopedTypes.map((t) => ({
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
async function createUnit(input) {
    const unitNumber = input.unitNumber.trim();
    if (!input.projectId)
        return { ok: false, error: "a project is required" };
    if (!unitNumber)
        return { ok: false, error: "a unit number is required" };
    const status = input.status ?? "available";
    if (!isUnitStatus(status))
        return { ok: false, error: `invalid status: ${status}` };
    if (input.villaTypeId) {
        const { data: type } = await (0, supabase_1.db)()
            .from("villa_types")
            .select("id, project_id")
            .eq("id", input.villaTypeId)
            .maybeSingle();
        if (!type)
            return { ok: false, error: "villa type not found" };
        if (type.project_id !== input.projectId) {
            return { ok: false, error: "that villa type belongs to a different project" };
        }
    }
    const { data, error } = await (0, supabase_1.db)()
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
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, unit: data };
}
async function updateUnitStatus(unitId, status) {
    if (!isUnitStatus(status))
        return { ok: false, error: `invalid status: ${status}` };
    // villa_units has no updated_at trigger (0001 only installs one on leads and
    // projects), so the timestamp has to be set here or the board goes stale.
    const { error } = await (0, supabase_1.db)()
        .from("villa_units")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", unitId);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
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
async function importUnitsFromTypes(projectId, units) {
    if (!projectId)
        return { ok: false, error: "a project is required" };
    if (!units.length) {
        return {
            ok: false,
            error: "no units supplied — inventory is only ever created from an explicit list, never generated from villa type or project counts",
        };
    }
    const { data: typeRows } = await (0, supabase_1.db)()
        .from("villa_types")
        .select("id, name")
        .eq("project_id", projectId);
    const typeIdByName = new Map((typeRows ?? []).map((t) => [t.name.toLowerCase(), t.id]));
    const rows = [];
    for (const draft of units) {
        const unitNumber = draft.unitNumber?.trim();
        if (!unitNumber)
            return { ok: false, error: "every unit needs a unit_number" };
        let villaTypeId = null;
        if (draft.villaTypeName) {
            villaTypeId = typeIdByName.get(draft.villaTypeName.trim().toLowerCase()) ?? null;
            if (!villaTypeId) {
                return { ok: false, error: `unknown villa type "${draft.villaTypeName}" for this project` };
            }
        }
        const status = draft.status ?? "available";
        if (!isUnitStatus(status))
            return { ok: false, error: `invalid status: ${status}` };
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
    const { error } = await (0, supabase_1.db)().from("villa_units").upsert(rows, { onConflict: "project_id,unit_number" });
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, imported: rows.length };
}
