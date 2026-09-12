"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_KIND_LABELS = exports.PLAN_KINDS = exports.UNIT_STATUS_DOT = exports.UNIT_STATUS_TILE = exports.UNIT_STATUS_LABELS = exports.UNIT_STATUSES = void 0;
exports.isUnitStatus = isUnitStatus;
exports.absorption = absorption;
exports.projectLocation = projectLocation;
exports.cssUrl = cssUrl;
exports.humanizeKey = humanizeKey;
exports.toJsonNode = toJsonNode;
exports.countJsonLeaves = countJsonLeaves;
exports.projectPortfolio = projectPortfolio;
exports.projectDossier = projectDossier;
exports.villaCatalog = villaCatalog;
exports.availabilityBoard = availabilityBoard;
exports.planAssets = planAssets;
exports.isImageAsset = isImageAsset;
exports.assetExtension = assetExtension;
exports.amenityShowcase = amenityShowcase;
exports.createUnit = createUnit;
exports.updateUnitStatus = updateUnitStatus;
const supabase_1 = require("./supabase");
/**
 * Read and write side of the Properties section — projects, villa types, live
 * units, and plan assets.
 *
 * The knowledge base is the only thing the AI agent may quote from, so the
 * shape of a NULL matters here: a missing price or bedroom count is not a gap
 * to be filled in by the UI, it is a fact that has not been approved for the
 * agent to state. Nothing in this file substitutes a default for one.
 */
// -----------------------------------------------------------------------------
// Unit status
// -----------------------------------------------------------------------------
exports.UNIT_STATUSES = ["available", "under_booking", "reserved", "sold", "blocked"];
const STATUS_SET = new Set(exports.UNIT_STATUSES);
function isUnitStatus(value) {
    return STATUS_SET.has(value);
}
exports.UNIT_STATUS_LABELS = {
    available: "Available",
    under_booking: "Under booking",
    reserved: "Reserved",
    sold: "Sold",
    blocked: "Blocked",
};
/**
 * Board tile styling. Available is the only state that gets a positive colour;
 * sold and blocked recede so a mostly-sold board reads as depleted at a glance
 * rather than as a wall of noise.
 */
exports.UNIT_STATUS_TILE = {
    available: "border-[rgba(94,201,141,0.35)] bg-[rgba(94,201,141,0.13)] text-[var(--color-success)]",
    under_booking: "border-[rgba(239,180,92,0.35)] bg-[rgba(239,180,92,0.13)] text-[var(--color-warm)]",
    reserved: "border-[rgba(109,168,232,0.35)] bg-[rgba(109,168,232,0.13)] text-[var(--color-info)]",
    sold: "border-[var(--color-line-strong)] bg-[var(--color-raised)] text-[var(--color-muted)]",
    blocked: "border-dashed border-[var(--color-line)] bg-transparent text-[var(--color-faint)]",
};
/** Solid swatch for the legend and the per-type count pills. */
exports.UNIT_STATUS_DOT = {
    available: "bg-[var(--color-success)]",
    under_booking: "bg-[var(--color-warm)]",
    reserved: "bg-[var(--color-info)]",
    sold: "bg-[var(--color-line-strong)]",
    blocked: "bg-[var(--color-line)]",
};
function emptyCounts() {
    return { available: 0, under_booking: 0, reserved: 0, sold: 0, blocked: 0 };
}
function addCounts(into, from) {
    for (const status of exports.UNIT_STATUSES)
        into[status] += from[status];
}
function sumCounts(counts) {
    return exports.UNIT_STATUSES.reduce((total, status) => total + counts[status], 0);
}
/**
 * Share of stock that has left the market.
 *
 * Blocked units are excluded from the numerator — a plot held back for the
 * developer has not been absorbed by a buyer. Returns null on an empty board so
 * callers render an em dash rather than 0%, which would read as "nothing is
 * selling" when the truth is "nothing is loaded".
 */
function absorption(counts) {
    const total = sumCounts(counts);
    if (total === 0)
        return null;
    return ((counts.sold + counts.reserved + counts.under_booking) / total) * 100;
}
// Unit numbers mix letters and digits ("A-9", "A-10"), which sort wrong
// lexically — A-10 would land before A-9 and the board would look shuffled.
const naturally = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const PROJECT_CARD_COLUMNS = "id, slug, name, developer, status, phase, expected_delivery, village, mandal, district, state, " +
    "rera_number, rera_status, hmda_permit_no, total_land_acres, total_units, configurations, " +
    "starting_price_inr, max_price_inr, price_note, cover_image, positioning";
const VILLA_TYPE_COLUMNS = "id, project_id, name, plot_area_sqyd, built_up_sft, carpet_area_sft, facing, bedrooms, bathrooms, " +
    "floors, has_home_theatre, has_maid_room, private_pool, price_inr, floor_plan_url, verification_note";
/** Village → state, deduplicated. Enough to place a project without a map. */
function projectLocation(project) {
    const parts = [project.village, project.mandal, project.district, project.state]
        .map((p) => p?.trim())
        .filter((p) => Boolean(p));
    const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
    return unique.length ? unique.join(", ") : null;
}
/**
 * Escapes a URL for interpolation into a CSS `url("...")` token.
 *
 * Only the characters that could terminate the token are encoded — running the
 * whole string through encodeURI would double-encode the `%20` already present
 * in the seeded asset paths.
 */
function cssUrl(url) {
    return `url("${url.replace(/["'\\\s<>]/g, encodeURIComponent)}")`;
}
const ACRONYMS = {
    sft: "SFT",
    sqft: "sq ft",
    sqyd: "sq yd",
    km: "km",
    hmda: "HMDA",
    rera: "RERA",
    igbc: "IGBC",
    stp: "STP",
    wtp: "WTP",
    ev: "EV",
    iot: "IoT",
    dg: "DG",
    orr: "ORR",
    bhk: "BHK",
    ac: "AC",
    vrv: "VRV",
    cctv: "CCTV",
    dth: "DTH",
    rcc: "RCC",
    upvc: "UPVC",
    uvpc: "UPVC",
    url: "URL",
    no: "No.",
};
function humanizeKey(key) {
    const words = key.split(/[_\-\s]+/).filter(Boolean);
    return words
        .map((word, i) => {
        const acronym = ACRONYMS[word.toLowerCase()];
        if (acronym)
            return acronym;
        if (i === 0)
            return word.charAt(0).toUpperCase() + word.slice(1);
        return word;
    })
        .join(" ");
}
/** Keys an array element uses to name itself, in preference order. */
const NAME_KEYS = ["name", "title", "place", "label", "category", "stage"];
function scalarText(value) {
    if (typeof value === "string")
        return value.trim() || null;
    if (typeof value === "number")
        return Number.isFinite(value) ? value.toLocaleString("en-IN") : null;
    if (typeof value === "boolean")
        return value ? "Yes" : "No";
    return null;
}
function isScalar(value) {
    return value === null || ["string", "number", "boolean"].includes(typeof value);
}
function toJsonNode(value) {
    const scalar = scalarText(value);
    if (scalar !== null)
        return { kind: "text", value: scalar };
    if (value === null || value === undefined || typeof value !== "object")
        return null;
    if (Array.isArray(value)) {
        if (value.every(isScalar)) {
            const items = value.map(scalarText).filter((v) => v !== null);
            return items.length ? { kind: "list", items } : null;
        }
        const entries = [];
        value.forEach((item, index) => {
            if (item && typeof item === "object" && !Array.isArray(item)) {
                const record = { ...item };
                const nameKey = NAME_KEYS.find((k) => typeof record[k] === "string" && record[k]);
                const label = nameKey ? String(record[nameKey]) : `Item ${index + 1}`;
                if (nameKey)
                    delete record[nameKey];
                // Unlike the object branch below, a null node is kept: "Sahavas" with no
                // further detail is still worth listing.
                entries.push({ key: String(index), label, node: toJsonNode(record) });
                return;
            }
            const node = toJsonNode(item);
            if (node)
                entries.push({ key: String(index), label: `Item ${index + 1}`, node });
        });
        return entries.length ? { kind: "group", entries } : null;
    }
    const entries = [];
    for (const [key, child] of Object.entries(value)) {
        const node = toJsonNode(child);
        // An empty array or blank string under a key is absence, not content —
        // rendering the heading alone would imply data that isn't there.
        if (node)
            entries.push({ key, label: humanizeKey(key), node });
    }
    return entries.length ? { kind: "group", entries } : null;
}
/** How many individual facts a node renders. Used for "N listed" counts. */
function countJsonLeaves(node) {
    if (!node)
        return 0;
    if (node.kind === "text")
        return 1;
    if (node.kind === "list")
        return node.items.length;
    return node.entries.reduce((total, entry) => total + Math.max(1, countJsonLeaves(entry.node)), 0);
}
/** PostgREST/Postgres codes for "that column / relation isn't there". */
function isMissingSchema(error) {
    const code = error.code;
    return (code === "42703" || // undefined_column
        code === "42P01" || // undefined_table
        code === "PGRST205" || // unknown relation, PostgREST schema cache
        /does not exist|schema cache/i.test(error.message));
}
/**
 * The first read that failed, phrased for the person who has to fix it.
 *
 * Anything that isn't schema drift is passed through verbatim rather than
 * dressed up as a migration problem — a timeout is not a missing column.
 */
function firstGap(...errors) {
    for (const error of errors) {
        if (!error)
            continue;
        if (isMissingSchema(error)) {
            return `${error.message}. This database is behind supabase/migrations/001_schema.sql — run it in the Supabase SQL editor, then reload.`;
        }
        return error.message;
    }
    return null;
}
async function projectPortfolio() {
    const [projectsResult, typesResult, unitsResult] = await Promise.all([
        (0, supabase_1.db)().from("villa_projects").select(PROJECT_CARD_COLUMNS).eq("is_active", true).order("name"),
        (0, supabase_1.db)().from("villa_types").select("id, project_id").eq("is_active", true),
        (0, supabase_1.db)().from("villa_units").select("project_id, status"),
    ]);
    const projects = (projectsResult.data ?? []);
    const stats = {};
    for (const project of projects) {
        stats[project.id] = { villaTypes: 0, counts: emptyCounts(), total: 0 };
    }
    for (const type of (typesResult.data ?? [])) {
        const stat = stats[type.project_id];
        if (stat)
            stat.villaTypes += 1;
    }
    for (const unit of (unitsResult.data ?? [])) {
        const stat = stats[unit.project_id];
        if (!stat)
            continue;
        stat.total += 1;
        if (isUnitStatus(unit.status))
            stat.counts[unit.status] += 1;
    }
    return {
        projects,
        stats,
        schemaError: firstGap(projectsResult.error, typesResult.error, unitsResult.error),
    };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A project by id or slug.
 *
 * Both are accepted because `id` is what the portfolio links with while the
 * slug is what a human would type. Querying `id` with a non-UUID makes Postgres
 * raise 22P02 rather than return nothing, so the column is chosen by shape.
 */
async function projectDossier(idOrSlug) {
    const column = UUID.test(idOrSlug) ? "id" : "slug";
    const { data } = await (0, supabase_1.db)()
        .from("villa_projects")
        .select("*")
        .eq(column, idOrSlug)
        .maybeSingle();
    const project = data;
    if (!project)
        return null;
    const [typesResult, unitsResult, assetsResult] = await Promise.all([
        (0, supabase_1.db)()
            .from("villa_types")
            .select(VILLA_TYPE_COLUMNS)
            .eq("project_id", project.id)
            .eq("is_active", true)
            .order("plot_area_sqyd", { ascending: true, nullsFirst: false })
            .order("name"),
        (0, supabase_1.db)().from("villa_units").select("villa_type_id, status").eq("project_id", project.id),
        (0, supabase_1.db)()
            .from("villa_assets")
            .select("id, project_id, villa_type_id, kind, title, description, url, mime_type, is_ai_generated, shareable_by_ai, version, created_at")
            .eq("project_id", project.id)
            .eq("is_current", true)
            .order("kind"),
    ]);
    const villaTypes = (typesResult.data ?? []);
    const inventory = villaTypes.map((type) => ({
        villaTypeId: type.id,
        name: type.name,
        priceInr: type.price_inr,
        counts: emptyCounts(),
        total: 0,
    }));
    const byTypeId = new Map(inventory.map((row) => [row.villaTypeId, row]));
    const counts = emptyCounts();
    let total = 0;
    for (const unit of (unitsResult.data ?? [])) {
        total += 1;
        if (isUnitStatus(unit.status))
            counts[unit.status] += 1;
        let row = unit.villa_type_id ? byTypeId.get(unit.villa_type_id) : undefined;
        if (!row) {
            row = byTypeId.get(null);
            if (!row) {
                row = { villaTypeId: null, name: "Unassigned", priceInr: null, counts: emptyCounts(), total: 0 };
                inventory.push(row);
                byTypeId.set(null, row);
            }
        }
        row.total += 1;
        if (isUnitStatus(unit.status))
            row.counts[unit.status] += 1;
    }
    return {
        project,
        villaTypes,
        inventory,
        counts,
        total,
        assets: (assetsResult.data ?? []),
        schemaError: firstGap(typesResult.error, unitsResult.error, assetsResult.error),
    };
}
/** Every villa type across every project, with its live stock attached. */
async function villaCatalog() {
    const [projectsResult, typesResult, unitsResult] = await Promise.all([
        (0, supabase_1.db)().from("villa_projects").select("id, name, slug, status").eq("is_active", true),
        (0, supabase_1.db)().from("villa_types").select(VILLA_TYPE_COLUMNS).eq("is_active", true).order("name"),
        (0, supabase_1.db)().from("villa_units").select("villa_type_id, status"),
    ]);
    const projects = new Map((projectsResult.data ?? []).map((p) => [p.id, p]));
    const entries = (typesResult.data ?? []).map((type) => {
        const project = projects.get(type.project_id);
        return {
            type,
            projectName: project?.name ?? "Unknown project",
            projectSlug: project?.slug ?? type.project_id,
            projectStatus: project?.status ?? null,
            units: emptyCounts(),
            unitTotal: 0,
        };
    });
    const byTypeId = new Map(entries.map((entry) => [entry.type.id, entry]));
    for (const unit of (unitsResult.data ?? [])) {
        if (!unit.villa_type_id)
            continue;
        const entry = byTypeId.get(unit.villa_type_id);
        if (!entry)
            continue;
        entry.unitTotal += 1;
        if (isUnitStatus(unit.status))
            entry.units[unit.status] += 1;
    }
    entries.sort((a, b) => a.projectName.localeCompare(b.projectName) ||
        (a.type.plot_area_sqyd ?? Infinity) - (b.type.plot_area_sqyd ?? Infinity) ||
        naturally.compare(a.type.name, b.type.name));
    return {
        entries,
        schemaError: firstGap(projectsResult.error, typesResult.error, unitsResult.error),
    };
}
/**
 * The visual availability board: project → villa type → units.
 *
 * Per-type counts come from `villa_inventory_summary` where the view has a row,
 * because that view is what the rest of the product (and the agent) reads. The
 * view predates the `blocked` status and has no column for it, so blocked is
 * recovered as the residual — the enum has exactly five values, so a unit the
 * view counted in none of its four buckets is blocked by elimination.
 */
async function availabilityBoard() {
    const [projectsResult, typesResult, unitsResult, summaryResult] = await Promise.all([
        (0, supabase_1.db)().from("villa_projects").select("id, name, slug").eq("is_active", true).order("name"),
        (0, supabase_1.db)().from("villa_types").select(VILLA_TYPE_COLUMNS).eq("is_active", true),
        (0, supabase_1.db)().from("villa_units").select("*"),
        (0, supabase_1.db)().from("villa_inventory_summary").select("villa_type_id, total_units, available, under_booking, reserved, sold"),
    ]);
    const projectRows = (projectsResult.data ?? []);
    const typeRows = (typesResult.data ?? []);
    const unitRows = (unitsResult.data ?? []);
    const summaries = new Map((summaryResult.data ?? []).map((row) => [row.villa_type_id, row]));
    const boards = projectRows.map((project) => ({
        projectId: project.id,
        projectName: project.name,
        slug: project.slug,
        types: [],
        counts: emptyCounts(),
        total: 0,
    }));
    const byProjectId = new Map(boards.map((board) => [board.projectId, board]));
    const typeBoards = new Map();
    for (const type of typeRows) {
        const board = byProjectId.get(type.project_id);
        if (!board)
            continue;
        const typeBoard = {
            villaTypeId: type.id,
            name: type.name,
            priceInr: type.price_inr,
            plotAreaSqyd: type.plot_area_sqyd,
            builtUpSft: type.built_up_sft,
            verificationNote: type.verification_note,
            units: [],
            counts: emptyCounts(),
            total: 0,
        };
        board.types.push(typeBoard);
        typeBoards.set(type.id, typeBoard);
    }
    // Units whose villa type was cleared still exist and are still sellable, so
    // they get a bucket rather than vanishing from the board.
    const unassigned = new Map();
    for (const unit of unitRows) {
        const board = byProjectId.get(unit.project_id);
        if (!board)
            continue;
        let typeBoard = unit.villa_type_id ? typeBoards.get(unit.villa_type_id) : undefined;
        if (!typeBoard || !board.types.includes(typeBoard)) {
            typeBoard = unassigned.get(unit.project_id);
            if (!typeBoard) {
                typeBoard = {
                    villaTypeId: null,
                    name: "Unassigned",
                    priceInr: null,
                    plotAreaSqyd: null,
                    builtUpSft: null,
                    verificationNote: null,
                    units: [],
                    counts: emptyCounts(),
                    total: 0,
                };
                board.types.push(typeBoard);
                unassigned.set(unit.project_id, typeBoard);
            }
        }
        typeBoard.units.push(unit);
    }
    const counts = emptyCounts();
    let total = 0;
    for (const board of boards) {
        for (const typeBoard of board.types) {
            typeBoard.units.sort((a, b) => naturally.compare(a.unit_number, b.unit_number));
            const summary = typeBoard.villaTypeId ? summaries.get(typeBoard.villaTypeId) : undefined;
            if (summary) {
                typeBoard.counts = {
                    available: summary.available,
                    under_booking: summary.under_booking,
                    reserved: summary.reserved,
                    sold: summary.sold,
                    blocked: Math.max(0, summary.total_units - summary.available - summary.under_booking - summary.reserved - summary.sold),
                };
                typeBoard.total = summary.total_units;
            }
            else {
                for (const unit of typeBoard.units) {
                    if (isUnitStatus(unit.status))
                        typeBoard.counts[unit.status] += 1;
                }
                typeBoard.total = typeBoard.units.length;
            }
            addCounts(board.counts, typeBoard.counts);
            board.total += typeBoard.total;
        }
        board.types.sort((a, b) => (a.plotAreaSqyd ?? Infinity) - (b.plotAreaSqyd ?? Infinity) || naturally.compare(a.name, b.name));
        addCounts(counts, board.counts);
        total += board.total;
    }
    return {
        projects: boards,
        counts,
        total,
        projectOptions: projectRows.map((p) => ({ id: p.id, name: p.name })),
        typeOptions: typeRows
            .map((type) => ({
            id: type.id,
            name: type.name,
            projectId: type.project_id,
            projectName: byProjectId.get(type.project_id)?.projectName ?? "",
        }))
            .sort((a, b) => a.projectName.localeCompare(b.projectName) || naturally.compare(a.name, b.name)),
        // The summary view is included: when it is absent the counts above are
        // recomputed from the unit rows and stay correct, but the board would
        // otherwise claim to be reading a view that isn't there.
        schemaError: firstGap(projectsResult.error, typesResult.error, unitsResult.error, summaryResult.error),
    };
}
// -----------------------------------------------------------------------------
// Plan assets
// -----------------------------------------------------------------------------
exports.PLAN_KINDS = ["floor_plan", "site_plan", "master_plan"];
exports.PLAN_KIND_LABELS = {
    floor_plan: "Floor plan",
    site_plan: "Site plan",
    master_plan: "Master plan",
};
async function planAssets() {
    const [projectsResult, typesResult, assetsResult] = await Promise.all([
        (0, supabase_1.db)().from("villa_projects").select("id, name, slug").eq("is_active", true).order("name"),
        (0, supabase_1.db)().from("villa_types").select("id, name"),
        (0, supabase_1.db)()
            .from("villa_assets")
            .select("id, project_id, villa_type_id, kind, title, description, url, mime_type, is_ai_generated, shareable_by_ai, version, created_at")
            .in("kind", exports.PLAN_KINDS)
            .eq("is_current", true)
            .order("kind")
            .order("title"),
    ]);
    const projectRows = (projectsResult.data ?? []);
    const typeNames = new Map((typesResult.data ?? []).map((t) => [t.id, t.name]));
    const assets = (assetsResult.data ?? []);
    const groups = projectRows.map((project) => ({
        projectId: project.id,
        projectName: project.name,
        slug: project.slug,
        sections: [],
        total: 0,
    }));
    const byProjectId = new Map(groups.map((group) => [group.projectId, group]));
    for (const asset of assets) {
        const group = asset.project_id ? byProjectId.get(asset.project_id) : undefined;
        if (!group)
            continue;
        const key = asset.villa_type_id ?? "__project";
        const label = asset.villa_type_id
            ? (typeNames.get(asset.villa_type_id) ?? "Villa type")
            : "Community-wide";
        let section = group.sections.find((s) => s.key === key);
        if (!section) {
            section = { key, label, assets: [] };
            group.sections.push(section);
        }
        section.assets.push(asset);
        group.total += 1;
    }
    // Community-wide drawings last: a buyer looks for their own villa first.
    for (const group of groups) {
        group.sections.sort((a, b) => {
            if (a.key === "__project")
                return 1;
            if (b.key === "__project")
                return -1;
            return naturally.compare(a.label, b.label);
        });
    }
    return {
        groups: groups.filter((g) => g.total > 0),
        total: assets.length,
        schemaError: firstGap(projectsResult.error, typesResult.error, assetsResult.error),
    };
}
function isImageAsset(asset) {
    if (asset.mime_type)
        return asset.mime_type.startsWith("image/");
    return /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(asset.url);
}
/** "PDF", "JPG" — the badge on a document card. */
function assetExtension(asset) {
    const fromUrl = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(asset.url)?.[1];
    if (fromUrl)
        return fromUrl.toUpperCase();
    const subtype = asset.mime_type?.split("/")[1];
    return subtype ? subtype.toUpperCase() : "FILE";
}
async function amenityShowcase() {
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_projects")
        .select("id, name, slug, village, mandal, district, state, amenities")
        .eq("is_active", true)
        .order("name");
    const rows = (data ?? []);
    const projects = rows.map((row) => {
        const node = toJsonNode(row.amenities);
        // A top-level list ("pool, gym, park") is as valid as a categorised map, so
        // it gets wrapped into a single unnamed category rather than dropped.
        const categories = node?.kind === "group"
            ? node.entries
            : node
                ? [{ key: "amenities", label: "Amenities", node }]
                : [];
        return {
            projectId: row.id,
            projectName: row.name,
            slug: row.slug,
            location: projectLocation(row),
            categories,
            total: countJsonLeaves(node),
        };
    });
    return { projects, schemaError: firstGap(error) };
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
        plot_area_sqyd: input.plotAreaSqyd ?? null,
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
    if (!unitId)
        return { ok: false, error: "a unit is required" };
    if (!isUnitStatus(status))
        return { ok: false, error: `invalid status: ${status}` };
    // villa_units carries no updated_at trigger, so the timestamp is set here or
    // the board's "changed 3m ago" would never move.
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_units")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", unitId)
        .select("*")
        .maybeSingle();
    if (error)
        return { ok: false, error: error.message };
    if (!data)
        return { ok: false, error: "unit not found" };
    return { ok: true, unit: data };
}
