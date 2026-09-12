"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireTable = exports.gate = void 0;
exports.gatedLoad = gatedLoad;
exports.funnel = funnel;
exports.recentLeads = recentLeads;
exports.leadById = leadById;
exports.messagesForLead = messagesForLead;
exports.recentConversations = recentConversations;
exports.objectionSummary = objectionSummary;
exports.unansweredQuestions = unansweredQuestions;
exports.sourceSummary = sourceSummary;
exports.pendingHandoffs = pendingHandoffs;
exports.upcomingSiteVisits = upcomingSiteVisits;
exports.projectsWithTypes = projectsWithTypes;
exports.contentDrafts = contentDrafts;
const react_1 = require("react");
const supabase_1 = require("./supabase");
const env_1 = require("./env");
/** Env vars the console cannot run without. Pure — deliberately no network. */
function missingConfig() {
    const status = (0, env_1.configStatus)();
    const missing = [];
    if (!status.supabase) {
        missing.push("OSF_SUPABASE_URL", "OSF_SUPABASE_SERVICE_ROLE_KEY");
    }
    if (!status.aiConfigured) {
        missing.push(status.llmProvider === "groq" ? "GROQ_API_KEY" : "ANTHROPIC_API_KEY");
    }
    return missing;
}
/**
 * Base-schema probe, memoised per request.
 *
 * `cache()` matters because the probe is now fired from both `gate()` and
 * `gatedLoad()`; without it a page using both would pay the round-trip twice.
 */
const probeSchema = (0, react_1.cache)(async function probeSchema() {
    const { error } = await (0, supabase_1.db)().from("villa_leads").select("id").limit(1);
    if (error) {
        return {
            ready: false,
            missing: [],
            error: `Database reachable but the schema is missing (${error.message}). Run supabase/migrations/0001_schema.sql and 0002_seed_glentree_serenity.sql in the Supabase SQL editor.`,
        };
    }
    return { ready: true, missing: [] };
});
exports.gate = (0, react_1.cache)(async function gate() {
    const missing = missingConfig();
    if (missing.length)
        return { ready: false, missing };
    return probeSchema();
});
/**
 * Checks a table added by a later migration actually exists.
 *
 * Without this a page whose table is missing renders an ordinary empty state,
 * which reads as "working, no data yet" when the real cause is an unapplied
 * migration. Pages call this to tell the two apart.
 */
exports.requireTable = (0, react_1.cache)(async function requireTable(table, migration) {
    // A HEAD request (head: true) would be cheaper, but PostgREST answers it with
    // a bodiless 404 for an unknown relation — supabase-js then has nothing to
    // parse and reports success, so a missing table would look like an empty one.
    // A normal GET returns the PGRST205 payload we need.
    const { error } = await (0, supabase_1.db)().from(table).select("*").limit(1);
    if (!error)
        return { ok: true };
    // PostgREST reports an unknown relation as PGRST205, or 42P01 from Postgres.
    const code = error.code;
    if (code === "PGRST205" || code === "42P01" || /schema cache|does not exist/i.test(error.message)) {
        return {
            ok: false,
            error: `This page needs the "${table}" table, which doesn't exist yet. Run supabase/migrations/${migration} in the Supabase SQL editor.`,
        };
    }
    return { ok: false, error: error.message };
});
/**
 * Runs a page's guards and its data load in one round-trip instead of three.
 *
 * The two guards (base schema reachable, this page's table exists) are
 * independent of each other and of the page's own queries, but every page
 * awaited them in sequence — three serial Supabase round-trips before anything
 * rendered. On a remote Supabase that was ~85ms each and dominated page time.
 *
 * Firing them together costs at most two wasted queries on the failure paths,
 * which only happen while the project is still being set up. `allSettled`
 * keeps the old semantics exactly: a guard failure still wins over a load
 * failure, and a genuine load rejection still propagates once the guards pass.
 */
async function gatedLoad(probe, load) {
    const missing = missingConfig();
    // Without credentials `db()` throws, so nothing may be dispatched here.
    if (missing.length)
        return { ok: false, missing };
    const [schema, table, loaded] = await Promise.allSettled([
        probeSchema(),
        probe ? (0, exports.requireTable)(probe.table, probe.migration) : Promise.resolve(null),
        load(),
    ]);
    if (schema.status === "rejected")
        throw schema.reason;
    if (!schema.value.ready) {
        return { ok: false, missing: schema.value.missing, error: schema.value.error };
    }
    if (table.status === "rejected")
        throw table.reason;
    if (table.value && !table.value.ok)
        return { ok: false, missing: [], error: table.value.error };
    if (loaded.status === "rejected")
        throw loaded.reason;
    return { ok: true, data: loaded.value };
}
async function funnel() {
    const { data } = await (0, supabase_1.db)().from("villa_funnel").select("*").single();
    return (data ?? {
        conversations: 0,
        leads: 0,
        qualified_leads: 0,
        hot_leads: 0,
        warm_leads: 0,
        cold_leads: 0,
        site_visits_requested: 0,
        site_visits_completed: 0,
        handoffs: 0,
    });
}
const LEAD_ROW_COLUMNS = "id, name, phone, lead_temperature, lead_score, budget_min_inr, budget_max_inr, purchase_timeline, source, campaign, last_contact_at";
async function recentLeads(limit = 50) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select(LEAD_ROW_COLUMNS)
        .order("last_contact_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
async function leadById(id) {
    const { data } = await (0, supabase_1.db)().from("villa_leads").select("*").eq("id", id).maybeSingle();
    return data ?? null;
}
async function messagesForLead(leadId) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true })
        .limit(200);
    return (data ?? []);
}
async function recentConversations(limit = 50) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_conversations")
        .select("*, villa_leads(id, name, phone, lead_temperature, lead_score)")
        .order("last_message_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
async function objectionSummary() {
    const { data } = await (0, supabase_1.db)().from("villa_objection_summary").select("*");
    return (data ?? []);
}
async function unansweredQuestions(limit = 50) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_questions")
        .select("*")
        .eq("unanswered", true)
        .order("created_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
async function sourceSummary() {
    const { data } = await (0, supabase_1.db)().from("villa_source_summary").select("*");
    return (data ?? []);
}
async function pendingHandoffs(limit = 20) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_handoffs")
        .select("*, villa_leads(name, phone)")
        .order("created_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
async function upcomingSiteVisits(limit = 20) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_site_visits")
        .select("*, villa_leads(name, phone)")
        .order("created_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
async function projectsWithTypes() {
    const [projects, villaTypes] = await Promise.all([
        (0, supabase_1.db)().from("villa_projects").select("*").eq("is_active", true).order("name"),
        (0, supabase_1.db)().from("villa_types").select("*").eq("is_active", true).order("name"),
    ]);
    return {
        projects: (projects.data ?? []),
        villaTypes: (villaTypes.data ?? []),
    };
}
async function contentDrafts(limit = 30) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_content_drafts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
    return (data ?? []);
}
