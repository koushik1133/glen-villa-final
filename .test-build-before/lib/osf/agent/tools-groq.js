"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROQ_TOOLS = void 0;
const tools_1 = require("./tools");
/**
 * Groq's models commonly emit an explicit `null` for an optional field it has
 * no value for, rather than omitting the key. Groq's server validates tool
 * arguments against the schema before the call reaches us, and both a bare
 * `type: "string"` AND an `enum` list reject `null` on their own even when
 * the field isn't required — each needs `null` added separately. Anthropic
 * never hit this because it omits unfilled optional fields instead.
 */
function allowNullOnOptionalFields(schema) {
    if (schema.type !== "object" || !schema.properties)
        return schema;
    const required = new Set(schema.required ?? []);
    const properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
        if (required.has(key)) {
            properties[key] = prop;
            continue;
        }
        const patched = { ...prop };
        if (typeof patched.type === "string") {
            patched.type = [patched.type, "null"];
        }
        if (Array.isArray(patched.enum) && !patched.enum.includes(null)) {
            patched.enum = [...patched.enum, null];
        }
        properties[key] = patched;
    }
    return { ...schema, properties };
}
/**
 * Groq's chat completions API is OpenAI-compatible — same function-calling
 * shape, different field names than Anthropic's tool format. TOOLS in
 * ./tools.ts stays the single source of truth; this just reshapes it.
 */
/**
 * The lean tool set Groq gets.
 *
 * Free-tier Groq caps a call at ~8,000 tokens, and all tool schemas are resent
 * on every round-trip, so each unused tool is dead weight paid on every turn.
 * Dropped for Groq:
 *   send_options   — Evolution/Baileys renders buttons unreliably; the reply
 *                    already degrades to text, so the tool never earns its cost.
 *   check_availability, log_objection, log_unanswered_question — analytics and
 *                    edge tools that add round-trips without changing the answer
 *                    the customer sees. Anthropic (paid) keeps the full set.
 * This roughly halves the schema tokens per call, which is what lets a full
 * multi-tool answer fit inside one key's per-minute budget.
 */
// Must include EVERY tool the system prompt tells the model to call. Groq
// validates each tool call against this list server-side and returns a hard
// 400 if the model calls one that is missing — which silently killed replies.
// Only send_options is excluded: buttons don't render on Evolution, and the
// prompt now writes numbered options as plain text instead of calling a tool.
const GROQ_TOOL_ALLOWLIST = new Set([
    "search_knowledge_base",
    "get_villa_types",
    "check_availability",
    "get_assets",
    "send_media",
    "update_lead",
    "schedule_site_visit",
    "request_human_handoff",
    "log_objection",
    "log_unanswered_question",
    "opt_out",
]);
/**
 * Strips per-property "description" text from a tool schema.
 *
 * On Groq's free tier every tool schema is resent on every round-trip, and the
 * verbose field descriptions (update_lead alone was ~500 tokens) are the single
 * biggest avoidable chunk of each request. The field NAMES — budget_max_inr,
 * purchase_timeline, facing_preference — are self-documenting, and the model
 * fills them correctly from the name plus the top-level tool description alone.
 * Dropping the nested prose cuts the toolset from ~2,450 to ~1,500 tokens per
 * call, which speeds every request and eases the rate limit. Enums and types
 * are kept — those change what the model may emit.
 */
function stripPropertyDescriptions(schema) {
    if (schema.type !== "object" || !schema.properties)
        return schema;
    const properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
        const { description: _drop, ...rest } = prop;
        properties[key] = rest;
    }
    return { ...schema, properties };
}
exports.GROQ_TOOLS = tools_1.TOOLS.filter((t) => GROQ_TOOL_ALLOWLIST.has(t.name)).map((t) => ({
    type: "function",
    function: {
        name: t.name,
        description: t.description ?? "",
        parameters: stripPropertyDescriptions(allowNullOnOptionalFields(t.input_schema)),
    },
}));
