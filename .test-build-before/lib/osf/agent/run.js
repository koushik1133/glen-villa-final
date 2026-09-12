"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgentAnthropic = runAgentAnthropic;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const env_1 = require("../env");
const supabase_1 = require("../supabase");
const kb_1 = require("./kb");
const prompt_1 = require("./prompt");
const tools_1 = require("./tools");
const execute_1 = require("./execute");
const finalize_1 = require("./finalize");
let anthropic = null;
function client() {
    if (!anthropic)
        anthropic = new sdk_1.default({ apiKey: env_1.env.anthropicApiKey });
    return anthropic;
}
/** Ceiling on tool round-trips per customer message. */
const MAX_TURNS = 8;
/** How much history to replay. Older context lives in the lead profile. */
const HISTORY_LIMIT = 40;
/**
 * Runs one customer message through the agent using Anthropic.
 *
 * The loop is manual rather than the SDK tool runner because we need to write
 * every tool call to the audit table, mutate the lead in place as facts arrive,
 * and stream media out mid-turn.
 */
async function runAgentAnthropic(params) {
    const { lead, conversation, customerMessage, deliver } = params;
    const supabase = (0, supabase_1.db)();
    const signals = {};
    const ctx = {
        lead,
        conversationId: conversation.id,
        deliver,
        signals,
    };
    // ---------------------------------------------------------------------------
    // Prompt assembly.
    //
    // Render order is tools → system → messages. The cache breakpoint sits on the
    // last system block, so tools + system prompt + knowledge base all cache
    // together. Nothing volatile may appear before it — the per-customer context
    // is attached to the user turn below instead.
    // ---------------------------------------------------------------------------
    const kb = await (0, kb_1.knowledgeBaseBlock)();
    const system = [
        { type: "text", text: prompt_1.SYSTEM_PROMPT },
        { type: "text", text: kb, cache_control: { type: "ephemeral" } },
    ];
    const messages = await buildHistory(conversation.id);
    messages.push({
        role: "user",
        content: [
            { type: "text", text: (0, prompt_1.buildLeadContext)({ lead, nowIso: new Date().toISOString() }) },
            { type: "text", text: customerMessage },
        ],
    });
    const replies = [];
    const toolsUsed = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await client().messages.create({
            model: env_1.env.model,
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            output_config: { effort: env_1.env.effort },
            system,
            tools: tools_1.TOOLS,
            messages,
        });
        usage.input += response.usage.input_tokens;
        usage.output += response.usage.output_tokens;
        usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
        messages.push({ role: "assistant", content: response.content });
        // A server-side tool paused mid-turn; re-send to let it continue.
        if (response.stop_reason === "pause_turn")
            continue;
        if (response.stop_reason === "refusal") {
            replies.push({
                text: "I'm not able to help with that one, but I'm happy to answer anything about the villas — sizes, pricing, location or arranging a visit.",
            });
            break;
        }
        const toolUses = response.content.filter((b) => b.type === "tool_use");
        // Text the model produced this turn goes out to the customer now, so a
        // reply that precedes a tool call isn't swallowed.
        for (const block of response.content) {
            if (block.type === "text" && block.text.trim()) {
                const text = block.text.trim();
                replies.push({ text });
                await deliver({ text });
                await supabase.from("villa_messages").insert({
                    conversation_id: conversation.id,
                    lead_id: lead.id,
                    role: "agent",
                    body: text,
                });
            }
        }
        if (toolUses.length === 0)
            break;
        const results = [];
        for (const use of toolUses) {
            toolsUsed.push(use.name);
            const output = await (0, execute_1.executeTool)(ctx, use.name, (use.input ?? {}));
            results.push({
                type: "tool_result",
                tool_use_id: use.id,
                content: JSON.stringify(output),
                is_error: output.ok === false,
            });
        }
        messages.push({ role: "user", content: results });
        // Opting out ends the conversation immediately — no further turns.
        if (lead.opted_out)
            break;
    }
    const { leadScore, temperature } = await (0, finalize_1.finalizeTurn)({
        lead,
        conversation,
        customerMessage,
        signals,
        repliesCount: replies.length,
    });
    return { replies, leadScore, temperature, toolsUsed, usage };
}
/**
 * Rebuilds the conversation for the model from stored messages.
 *
 * Only customer and agent text is replayed — tool traffic is not, since each
 * customer message starts a fresh tool loop and stale tool results would just
 * burn context.
 */
async function buildHistory(conversationId) {
    const { data } = await (0, supabase_1.db)()
        .from("villa_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(HISTORY_LIMIT);
    const rows = (data ?? []);
    const out = [];
    for (const m of rows) {
        const text = m.body?.trim() || (m.media_url ? `[sent ${m.media_kind ?? "file"}]` : "");
        if (!text)
            continue;
        const role = m.role === "customer" ? "user" : "assistant";
        // The API needs alternating turns; merge consecutive same-role messages.
        const last = out[out.length - 1];
        if (last && last.role === role && typeof last.content === "string") {
            last.content = `${last.content}\n${text}`;
        }
        else {
            out.push({ role, content: text });
        }
    }
    // History must start with a user turn.
    while (out.length && out[0].role === "assistant")
        out.shift();
    return out;
}
