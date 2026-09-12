"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryError = exports.ONYX_TOTAL = exports.ONYX_UNITS_PER_FLOOR = exports.ONYX_FLOORS = exports.DEMO_NOTE = exports.UNIT_STATUSES = void 0;
exports.unitId = unitId;
exports.seededRandom = seededRandom;
exports.demoStatus = demoStatus;
exports.onyxUnitNumbers = onyxUnitNumbers;
exports.listUnits = listUnits;
exports.getUnit = getUnit;
exports.statusSummary = statusSummary;
exports.leadStatusForUnitStatus = leadStatusForUnitStatus;
exports.setUnitStatus = setUnitStatus;
exports.linkLead = linkLead;
exports.ensureInventorySeed = ensureInventorySeed;
const db_1 = require("../db");
const serenity_plots_1 = require("./serenity-plots");
const villa_types_1 = require("./villa-types");
const onyx_units_1 = require("./onyx-units");
const publisher_1 = require("../engine/publisher");
const handover_1 = require("./handover");
/**
 * Unit inventory for the two showcase projects.
 *
 * The public layout is only useful if every villa and every flat on it can be
 * clicked and answers "can I buy this one?". That answer has to come from the
 * same store the CRM writes to, otherwise the site and the sales desk disagree
 * within a day — so a unit is a first-class record here, not a colour baked
 * into an SVG.
 */
exports.UNIT_STATUSES = [
    "available",
    "no_leads",
    "enquiry",
    "deal_pending",
    "blocked",
    "sold",
];
/** Marker on every generated record; a human edit clears it. */
exports.DEMO_NOTE = "Demo inventory — real sales activity overwrites this.";
function unitId(brandId, project, unitNumber) {
    return `unit_${brandId}_${project}_${unitNumber}`;
}
/* ------------------------------------------------------------------ PRNG */
/**
 * Deterministic PRNG keyed by unit number.
 *
 * Restart-stable on purpose: a demo where villa 42 is "sold" today and
 * "available" after a redeploy makes the whole layout look fake.
 */
function seededRandom(key) {
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
const SPREAD = [
    ["available", 0.55],
    ["no_leads", 0.15],
    ["enquiry", 0.12],
    ["deal_pending", 0.08],
    ["blocked", 0.03],
    ["sold", 0.07],
];
function demoStatus(key) {
    const r = seededRandom(key)();
    let acc = 0;
    for (const [status, weight] of SPREAD) {
        acc += weight;
        if (r < acc)
            return status;
    }
    return "available";
}
function plotNumber(p) {
    return p.villaNo ?? p.number ?? "";
}
/** The plot table is generated into its own module and imported statically. */
function serenityPlots() {
    return serenity_plots_1.SERENITY_PLOTS.filter((p) => plotNumber(p));
}
exports.ONYX_FLOORS = 35;
exports.ONYX_UNITS_PER_FLOOR = 7;
exports.ONYX_TOTAL = 245;
/** "1204" = floor 12, unit 04. Floors 1..35, units 01..07 → 245 flats. */
function onyxUnitNumbers() {
    const out = [];
    for (let floor = 1; floor <= exports.ONYX_FLOORS; floor++) {
        for (let u = 1; u <= exports.ONYX_UNITS_PER_FLOOR; u++) {
            out.push(`${floor}${String(u).padStart(2, "0")}`);
        }
    }
    return out;
}
// Built-up area, facing and configuration per position come from the client's
// APARTMENT PLAN sheets (see onyx-units.ts) — the seven positions repeat on
// every floor, so a unit number determines its type.
function buildSerenityUnits(brandId, now) {
    return serenityPlots().map((p) => {
        const number = plotNumber(p);
        // Only an exactly published plot size (200 / 267 / 300) gets a built-up area
        // and a configuration; every other size stays unset so the UI says
        // "to be confirmed" rather than quoting a figure the sheets never printed.
        // The BHK count is the same for both facings at a given published size, so
        // it is safe on size alone; the built-up area differs between the East and
        // West sheets, so it is only set when the plan actually states a facing.
        const facing = p.facing;
        const match = (0, villa_types_1.villaTypeFor)(p.plotSqYds ?? null, facing ?? null);
        const published = match?.exact && (0, villa_types_1.isPublishedPlotSize)(p.plotSqYds ?? -1) ? match.type : undefined;
        return {
            id: unitId(brandId, "serenity", number),
            brandId,
            project: "serenity",
            unitNumber: number,
            kind: "villa",
            status: demoStatus(`serenity:${number}`),
            plotSqYds: p.plotSqYds ?? undefined,
            // Configuration per plot is not published; only set it when real data exists.
            bhk: p.bhk ?? published?.bhk,
            builtUpSqFt: facing ? published?.totalSqFt : undefined,
            facing,
            tower: p.cluster,
            updatedAt: now,
            notes: exports.DEMO_NOTE,
        };
    });
}
function buildOnyxUnits(brandId, now) {
    return onyxUnitNumbers().map((n) => {
        const type = (0, onyx_units_1.onyxUnitType)(n);
        return {
            id: unitId(brandId, "onyx", n),
            brandId,
            project: "onyx",
            unitNumber: n,
            kind: "flat",
            status: demoStatus(`onyx:${n}`),
            builtUpSqFt: type?.sqFt,
            facing: type?.facing,
            bhk: type?.bhk,
            floor: Number(n.slice(0, -2)),
            tower: "Onyx",
            updatedAt: now,
            notes: exports.DEMO_NOTE,
        };
    });
}
/* ------------------------------------------------------------------ reads */
function listUnits(brandId, project) {
    return (0, db_1.read)()
        .inventoryUnits.filter((u) => u.brandId === brandId && (!project || u.project === project))
        .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
}
function getUnit(id) {
    return (0, db_1.read)().inventoryUnits.find((u) => u.id === id);
}
function statusSummary(brandId, project) {
    const summary = Object.fromEntries(exports.UNIT_STATUSES.map((s) => [s, 0]));
    summary.total = 0;
    for (const u of listUnits(brandId, project)) {
        summary[u.status] += 1;
        summary.total += 1;
    }
    return summary;
}
class InventoryError extends Error {
}
exports.InventoryError = InventoryError;
/* ------------------------------------------------------- CRM synchronisation */
/**
 * How far along a lead is. Used only to refuse to move one backwards.
 * `lost` is deliberately absent: a lost lead is never rewritten by inventory.
 */
const LEAD_RANK = {
    new: 0,
    contacted: 1,
    site_visit_scheduled: 2,
    negotiation: 3,
    booking_token_paid: 4,
    won: 5,
};
/**
 * The single mapping from a unit's sale status to the lead's status.
 *
 * Exported and pure so the rule can be tested on its own — the whole point of
 * the synchronisation is that the master plan and the CRM can never disagree,
 * and a rule inlined inside a `mutate()` callback is a rule nobody can check.
 *
 * Returns the status the lead should move to, or `null` for "leave it alone".
 * Two things are never done: a lead is never moved backwards (a won deal is not
 * dragged back to "contacted" because somebody re-picked "enquiry" on the plan),
 * and a lead already marked `lost` is never touched at all — that is a human
 * judgement with a reason attached to it.
 */
function leadStatusForUnitStatus(unitStatus, current) {
    if (current === "lost")
        return null;
    let target = null;
    if (unitStatus === "sold")
        target = "won";
    else if (unitStatus === "deal_pending")
        target = "booking_token_paid";
    // An enquiry only tells us somebody has been in touch; it must not overwrite
    // a lead that has already progressed past that, so it applies to "new" only.
    else if (unitStatus === "enquiry" && current === "new")
        target = "contacted";
    if (!target)
        return null;
    if (LEAD_RANK[target] <= LEAD_RANK[current])
        return null;
    return target;
}
/**
 * Move a unit's status, recording who did it.
 *
 * The one hard rule is that "sold" needs a customer on the record (or an
 * explicit override): a unit marked sold with nobody attached is how a villa
 * disappears from the site with no way to find out who bought it.
 *
 * `status` may be `null` to edit the other fields (owner, handover stage)
 * without restating the sale status — changing who owns a villa should not
 * force the caller to re-assert whether it is sold.
 */
function setUnitStatus(unitId, status, actor, opts = {}) {
    if (status !== null && !exports.UNIT_STATUSES.includes(status)) {
        throw new InventoryError(`Unknown status "${status}".`);
    }
    if (opts.handoverStage !== undefined && !(0, handover_1.isHandoverStage)(opts.handoverStage)) {
        throw new InventoryError(`Unknown handover stage "${opts.handoverStage}".`);
    }
    const updated = (0, db_1.mutate)((db) => {
        const unit = db.inventoryUnits.find((u) => u.id === unitId);
        if (!unit)
            throw new InventoryError("Unit not found.");
        const next = status ?? unit.status;
        // These two rules police a TRANSITION, not the resting state. Re-checking
        // them on every edit meant an already-sold villa could not have its buyer
        // typed in or its handover stage moved — which is backwards, because
        // recording the buyer is exactly how that villa stops being anonymous.
        const entering = status !== null && status !== unit.status;
        const customerId = opts.customerId ?? unit.customerId;
        if (entering && next === "sold" && !customerId && !opts.override) {
            throw new InventoryError("A unit can only be marked sold with a linked customer.");
        }
        if (entering && next === "deal_pending" && !(opts.leadId ?? unit.leadId) && !opts.override) {
            throw new InventoryError("A deal in progress needs a linked lead.");
        }
        // A handover past the booking on a unit nobody has committed to buy is a
        // data bug that reaches the public layout — refuse it rather than paint it.
        if (opts.handoverStage !== undefined && !opts.override && !(0, handover_1.stageAllowedForStatus)(opts.handoverStage, next)) {
            throw new InventoryError(`Handover stage "${handover_1.HANDOVER_STAGE_LABEL[opts.handoverStage]}" needs the unit to be deal pending or sold.`);
        }
        const from = unit.status;
        const fromStage = unit.handoverStage;
        const fromOwner = unit.assignedTo;
        unit.status = next;
        if (opts.leadId !== undefined)
            unit.leadId = opts.leadId;
        if (opts.customerId !== undefined)
            unit.customerId = opts.customerId;
        if (opts.assignedTo !== undefined)
            unit.assignedTo = opts.assignedTo || undefined;
        if (opts.buyerName !== undefined)
            unit.buyerName = opts.buyerName.trim() || undefined;
        if (opts.blockedUntil !== undefined)
            unit.blockedUntil = opts.blockedUntil;
        if (opts.handoverStage !== undefined)
            unit.handoverStage = opts.handoverStage;
        // A human touched it: it is no longer demo data and re-seeding leaves it be.
        unit.notes = opts.notes ?? (unit.notes === exports.DEMO_NOTE ? undefined : unit.notes);
        unit.updatedAt = new Date().toISOString();
        // Same transaction as the unit write: the CRM lead and the master plan can
        // never end up describing different realities, not even for one request.
        const lead = unit.leadId ? db.leads.find((l) => l.id === unit.leadId) : undefined;
        if (lead) {
            const target = leadStatusForUnitStatus(unit.status, lead.status);
            if (target && target !== lead.status) {
                lead.status = target;
                if (target === "won")
                    lead.wonAt = lead.wonAt ?? unit.updatedAt;
                lead.updatedAt = unit.updatedAt;
            }
            if (opts.assignedTo !== undefined && unit.assignedTo && lead.assignedTo !== unit.assignedTo) {
                lead.assignedTo = unit.assignedTo;
                lead.updatedAt = unit.updatedAt;
            }
        }
        return { unit: { ...unit }, from, fromStage, fromOwner };
    });
    const noun = updated.unit.project === "onyx" ? "Flat" : "Villa";
    const parts = [];
    if (status !== null && updated.from !== status)
        parts.push(`${updated.from} → ${status}`);
    else if (status !== null)
        parts.push(status);
    if (opts.handoverStage !== undefined && opts.handoverStage !== updated.fromStage) {
        const dept = handover_1.HANDOVER_STAGE_DEPARTMENT[opts.handoverStage];
        parts.push(`handover ${handover_1.HANDOVER_STAGE_LABEL[updated.fromStage ?? "not_started"]} → ${handover_1.HANDOVER_STAGE_LABEL[opts.handoverStage]}${dept ? ` (${dept})` : ""}`);
    }
    if (opts.assignedTo !== undefined && (updated.unit.assignedTo ?? "") !== (updated.fromOwner ?? "")) {
        parts.push(`owner → ${updated.unit.assignedTo ?? "unassigned"}`);
    }
    (0, publisher_1.logActivity)(updated.unit.brandId, "inventory_status", `${noun} ${updated.unit.unitNumber}: ${parts.length ? parts.join(", ") : "updated"}`, actor);
    return updated.unit;
}
function linkLead(unitId, leadId, actor = "system") {
    const unit = getUnit(unitId);
    if (!unit)
        throw new InventoryError("Unit not found.");
    // Linking a lead to an untouched unit is itself an enquiry.
    const next = unit.status === "available" || unit.status === "no_leads" ? "enquiry" : unit.status;
    return setUnitStatus(unitId, next, actor, { leadId });
}
/* ----------------------------------------------------------------- seeding */
/**
 * Create any missing units for a brand. Idempotent: an existing unit is never
 * overwritten, so a status a person set survives every re-seed.
 */
function ensureInventorySeed(brandId) {
    const now = new Date().toISOString();
    const candidates = [...buildSerenityUnits(brandId, now), ...buildOnyxUnits(brandId, now)];
    return (0, db_1.mutate)((db) => {
        const existing = new Set(db.inventoryUnits.filter((u) => u.brandId === brandId).map((u) => u.id));
        const fresh = candidates.filter((u) => !existing.has(u.id));
        db.inventoryUnits.push(...fresh);
        // Backfill the printed specification onto units seeded before the client
        // supplied the plan sheets. Status, leads and notes are never touched, so a
        // human-set record keeps everything a person decided about it.
        for (const u of db.inventoryUnits) {
            if (u.brandId !== brandId || u.project !== "onyx")
                continue;
            const type = (0, onyx_units_1.onyxUnitType)(u.unitNumber);
            if (!type)
                continue;
            u.builtUpSqFt = type.sqFt;
            u.facing = type.facing;
            if (type.bhk)
                u.bhk = type.bhk;
        }
        return { created: fresh.length, kept: existing.size };
    });
}
