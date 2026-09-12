"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGE_LABELS = exports.PIPELINE_STAGES = void 0;
exports.isPipelineStage = isPipelineStage;
exports.requirePipelineStage = requirePipelineStage;
exports.leadsByStage = leadsByStage;
exports.moveLeadStage = moveLeadStage;
const supabase_1 = require("./supabase");
const activities_1 = require("./activities");
/**
 * Reads and writes for the /production Kanban board.
 *
 * Column order here is the funnel order, not alphabetical or DB-enum order —
 * it's what the board renders left to right, so it lives here rather than
 * being re-declared in the page.
 */
exports.PIPELINE_STAGES = [
    "new",
    "qualifying",
    "qualified",
    "site_visit_scheduled",
    "negotiation",
    "booked",
    "lost",
];
const STAGE_SET = new Set(exports.PIPELINE_STAGES);
function isPipelineStage(value) {
    return STAGE_SET.has(value);
}
exports.STAGE_LABELS = {
    new: "New",
    qualifying: "Qualifying",
    qualified: "Qualified",
    site_visit_scheduled: "Site Visit Scheduled",
    negotiation: "Negotiation",
    booked: "Booked",
    lost: "Lost",
};
/**
 * The board depends on a column rather than a table, so requireTable cannot
 * tell an unapplied 0003 from an empty board — villa_leads exists either way.
 * Selecting the column directly is what distinguishes them.
 */
async function requirePipelineStage() {
    const { error } = await (0, supabase_1.db)().from("villa_leads").select("pipeline_stage").limit(1);
    if (!error)
        return { ok: true };
    if (/pipeline_stage/i.test(error.message)) {
        return {
            ok: false,
            error: 'This page needs the "pipeline_stage" column on villa_leads, which doesn\'t exist yet. Run supabase/migrations/0003_production_kanban.sql in the Supabase SQL editor.',
        };
    }
    return { ok: false, error: error.message };
}
async function leadsByStage() {
    const grouped = exports.PIPELINE_STAGES.reduce((acc, s) => {
        acc[s] = [];
        return acc;
    }, {});
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("*")
        .order("last_contact_at", { ascending: false });
    for (const lead of (data ?? [])) {
        // Defensive: a row could carry a stage value that predates a future enum
        // change. Drop it rather than let one bad row blank the whole board.
        if (isPipelineStage(lead.pipeline_stage))
            grouped[lead.pipeline_stage].push(lead);
    }
    return grouped;
}
async function moveLeadStage(leadId, stage) {
    if (!isPipelineStage(stage)) {
        return { ok: false, error: `invalid pipeline stage: ${stage}` };
    }
    const { error } = await (0, supabase_1.db)().from("villa_leads").update({ pipeline_stage: stage }).eq("id", leadId);
    if (error)
        return { ok: false, error: error.message };
    await (0, activities_1.logActivity)({
        leadId,
        type: "stage_changed",
        description: `Pipeline stage moved to ${exports.STAGE_LABELS[stage]}`,
        actorName: "Console",
    });
    return { ok: true };
}
