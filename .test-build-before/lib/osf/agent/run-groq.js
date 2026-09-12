"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgentGroq = runAgentGroq;
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const env_1 = require("../env");
const supabase_1 = require("../supabase");
const prompt_1 = require("./prompt");
const kb_1 = require("./kb");
const tools_groq_1 = require("./tools-groq");
const execute_1 = require("./execute");
const finalize_1 = require("./finalize");
const safe_url_1 = require("../net/safe-url");
// One client per key, built lazily and reused. The active index advances when
// a key hits its rate limit, so a key that is out of daily quota is skipped
// for the rest of the process rather than retried every message.
const groqClients = [];
let activeKey = 0;
function keys() {
    return env_1.env.groqApiKeys;
}
function clientFor(index) {
    if (!groqClients[index]) {
        groqClients[index] = new groq_sdk_1.default({ apiKey: keys()[index] });
    }
    return groqClients[index];
}
/** Ceiling on tool round-trips per customer message. */
const MAX_TURNS = 8;
/**
 * Tools whose RESULT the model needs before it can answer — a call to one of
 * these justifies a second Groq round-trip. Everything else (update_lead,
 * log_*, schedule_site_visit, request_human_handoff, send_media, opt_out) is a
 * side-effect the model does NOT need to see the result of, so once the model
 * has already produced a reply we run those in the background and stop, instead
 * of paying for a redundant second call. This roughly halves latency on the
 * common "answer + record the lead" message.
 */
const DATA_TOOLS = new Set([
    "search_knowledge_base",
    "get_villa_types",
    "check_availability",
    "get_assets",
]);
/**
 * Last time we sent a customer a "hang on" acknowledgement (rate-limit holding
 * or empty-turn fallback), per lead. Three rapid questions we can't answer yet
 * get one acknowledgement, not three — while a single unanswered question still
 * gets its one reply. Shared by both paths so they never double up.
 */
const lastAckAt = new Map();
const ACK_COOLDOWN_MS = 3 * 60_000;
/**
 * How much history to replay. Kept short on Groq: the whole transcript is
 * resent on every tool round-trip, so 40 messages × several round-trips is
 * what pushed a single reply past the free tier's 8K-tokens/minute budget.
 * 10 covers the working context; the lead profile carries the rest.
 */
const HISTORY_LIMIT = 6;
/**
 * Output ceiling. Critically, Groq counts max_tokens toward the per-minute
 * rate-limit RESERVATION, not just actual usage — so a high ceiling plus the
 * inlined KB pushed a single call past the free tier's 8K/min budget and it
 * 429'd instantly. 2048 keeps input+output reservation comfortably under 8K.
 * The reasoning model still gets room; the empty-completion retry below covers
 * the rare case it needs a second pass.
 */
const MAX_TOKENS = 700;
/**
 * Runs a Groq completion, rotating across keys on a rate limit.
 *
 * The free tier caps each key at 200K tokens/day and 8K tokens/minute. When
 * the active key hits either limit we move to the next key immediately — a
 * fresh key answers in seconds instead of the customer waiting out a 23-minute
 * daily reset. Only when every key is rate-limited do we fall back to waiting
 * out the shortest advertised delay, so a message is never simply dropped.
 */
async function completionWithFailover(params) {
    const total = keys().length;
    let shortestWaitMs = 30_000;
    // First pass: try each key once, starting from the currently active one.
    for (let i = 0; i < total; i++) {
        const idx = (activeKey + i) % total;
        try {
            const result = (await clientFor(idx).chat.completions.create({ ...params, stream: false }));
            activeKey = idx; // Stick with whichever key just worked.
            return result;
        }
        catch (e) {
            const status = e?.status;
            const msg = e instanceof Error ? e.message : "";
            // The model tried to call a tool Groq doesn't have registered (or emitted
            // malformed tool JSON). Don't crash the customer's reply — surface it as a
            // soft signal so the caller can nudge the model to answer in plain text.
            if (status === 400 && /tool_use_failed|tool call validation/i.test(msg)) {
                const err = new Error("TOOL_USE_FAILED");
                err.toolUseFailed = true;
                throw err;
            }
            if (status !== 429)
                throw e; // A real error (auth, bad request) — surface it.
            const secs = Number(/try again in ([\d.]+)/.exec(msg)?.[1]);
            if (Number.isFinite(secs) && secs > 0)
                shortestWaitMs = Math.min(shortestWaitMs, secs * 1000 + 500);
            console.warn(`[groq] key ${idx + 1}/${total} rate-limited, trying next key`);
        }
    }
    // Every key is limited right now. Wait out the shortest window, then retry
    // the whole rotation once more so the message still gets answered.
    console.warn(`[groq] all ${total} keys limited, waiting ${Math.round(shortestWaitMs / 1000)}s then retrying`);
    await new Promise((r) => setTimeout(r, Math.min(shortestWaitMs, 30_000)));
    for (let i = 0; i < total; i++) {
        const idx = (activeKey + i) % total;
        try {
            const result = (await clientFor(idx).chat.completions.create({ ...params, stream: false }));
            activeKey = idx;
            return result;
        }
        catch (e) {
            if (e?.status !== 429)
                throw e;
        }
    }
    throw new Error("All Groq keys are rate-limited. Add another GROQ_API_KEY_FALLBACK or upgrade to a paid tier.");
}
/**
 * Maps a customer message to the asset kind they're asking for, or null.
 * The lean model sometimes CLAIMS it sent a file without calling send_media,
 * so we detect the request ourselves and guarantee delivery (see below).
 */
function requestedAssetKind(text) {
    const t = text.toLowerCase();
    if (/floor\s?plan|floorplan|layout plan/.test(t))
        return "floor_plan";
    if (/site plan|master plan|site layout|layout/.test(t))
        return "master_plan";
    if (/price sheet|cost sheet|pricing sheet/.test(t))
        return "price_sheet";
    if (/picture|photo|image|render|gallery/.test(t))
        return "image";
    if (/brochure|catalog|catalogue|pdf|details doc/.test(t))
        return "brochure";
    return null;
}
/**
 * Sends the first shareable asset of `kind` for the lead's project directly,
 * bypassing the model. This is the guarantee: when a customer asks for a file,
 * they get the file, even if the model only talked about it.
 */
async function forceSendAsset(lead, kind, deliver, conversationId) {
    const supabase = (0, supabase_1.db)();
    const projectId = lead.project_interest;
    let q = supabase
        .from("villa_assets")
        .select("url, title, kind")
        .eq("kind", kind)
        .eq("is_current", true)
        .eq("shareable_by_ai", true)
        .limit(kind === "image" ? 3 : 1);
    if (projectId)
        q = q.eq("project_id", projectId);
    const { data } = await q;
    if (!data || data.length === 0)
        return false;
    let sentAny = false;
    for (const a of data) {
        try {
            const { href } = await (0, safe_url_1.assertSendableMediaUrl)(a.url);
            await deliver({ mediaUrl: href, mediaKind: kind, caption: a.title });
            await supabase.from("villa_messages").insert({
                conversation_id: conversationId,
                lead_id: lead.id,
                role: "agent",
                body: a.title,
                media_url: href,
                media_kind: kind,
            });
            sentAny = true;
        }
        catch {
            /* one bad asset shouldn't block the rest */
        }
    }
    return sentAny;
}
async function runAgentGroq(params) {
    const { lead, conversation, customerMessage, deliver } = params;
    const supabase = (0, supabase_1.db)();
    const signals = {};
    const ctx = { lead, conversationId: conversation.id, deliver, signals };
    const history = await buildHistory(conversation.id);
    // Free-tier Groq has an 8K-token-per-minute cap on this model — the full
    // knowledge base text alone can burn most of that. Anthropic gets it
    // inlined and cached; Groq relies entirely on the search_knowledge_base
    // tool call instead, which the system prompt already instructs it to use
    // before answering anything factual.
    // Inline a compact KB so the agent answers in ONE call instead of a
    // search_knowledge_base round-trip. On the free tier that round-trip cost
    // more than the KB it fetched, because every turn resends the whole context.
    const kb = await (0, kb_1.compactKnowledgeBase)();
    const messages = [
        { role: "system", content: `${prompt_1.GROQ_SYSTEM_PROMPT}

${kb}` },
        ...history,
        {
            role: "user",
            content: `${(0, prompt_1.buildLeadContext)({ lead, nowIso: new Date().toISOString() })}\n\n${customerMessage}`,
        },
    ];
    const replies = [];
    const toolsUsed = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    try {
        let toolFailNudges = 0;
        /**
         * A delivery that fails is final for this turn.
         *
         * Without this the model treats "Delivery failed" as something to try again,
         * and with eight turns available it will: measured at 80-115 seconds of
         * retrying before the customer got an answer. One failure is enough to know
         * the send is not going to work; the model should say so and move on, which
         * is what the tool error already tells it to do.
         */
        let deliveryFailures = 0;
        /**
         * Tool calls already made this run, as name+arguments.
         *
         * A model that asks the same question twice gets the same answer twice and
         * learns nothing, but it still costs a full round-trip each time — and with
         * eight turns available a repeat loop spent 36 seconds before the customer
         * saw anything. The second identical call is served from the first result
         * instead, and the loop stops.
         */
        const seenCalls = new Map();
        for (let turn = 0; turn < MAX_TURNS; turn++) {
            let response;
            try {
                response = await completionWithFailover({
                    model: env_1.env.groqModel,
                    max_tokens: MAX_TOKENS,
                    messages,
                    tools: tools_groq_1.GROQ_TOOLS,
                    tool_choice: "auto",
                    // gpt-oss is a reasoning model; "low" cuts the thinking it does before
                    // it answers from many seconds to under one, and slashes token use —
                    // which also keeps it under the free-tier per-minute limit. Grounded KB
                    // answers don't need deep reasoning; the facts are already in the prompt.
                    reasoning_effort: "low",
                });
            }
            catch (e) {
                // A bad tool call from the model: nudge it to answer directly, up to twice,
                // instead of dropping the reply. Anything else propagates.
                if (e?.toolUseFailed && toolFailNudges < 2) {
                    toolFailNudges += 1;
                    messages.push({
                        role: "user",
                        content: "Answer the customer directly in plain text now — do not call any tool.",
                    });
                    continue;
                }
                throw e;
            }
            const message = response.choices[0]?.message;
            if (!message)
                break;
            usage.input += response.usage?.prompt_tokens ?? 0;
            usage.output += response.usage?.completion_tokens ?? 0;
            // Reconstruct rather than push the response object directly — the
            // response type carries fields the request param type doesn't accept.
            messages.push({
                role: "assistant",
                content: message.content,
                tool_calls: message.tool_calls,
            });
            let deliveredThisTurn = false;
            if (message.content && message.content.trim()) {
                const text = message.content.trim();
                replies.push({ text });
                await deliver({ text });
                deliveredThisTurn = true;
                await supabase.from("villa_messages").insert({
                    conversation_id: conversation.id,
                    lead_id: lead.id,
                    role: "agent",
                    body: text,
                });
            }
            const toolCalls = message.tool_calls ?? [];
            // Set when the model re-asked something it had already been told.
            let repeatedCall = false;
            // Empty content AND no tool call means the model produced nothing usable —
            // usually reasoning that ran into the token ceiling (finish_reason
            // "length"). Retrying the same turn with a fresh call almost always
            // resolves it; without this the customer gets total silence.
            const finish = response.choices[0]?.finish_reason;
            const producedNothing = !(message.content && message.content.trim()) && toolCalls.length === 0;
            if (producedNothing) {
                if (finish === "length" && turn < MAX_TURNS - 1) {
                    // Nudge it to answer directly and give it another turn.
                    messages.push({
                        role: "user",
                        content: "Please give your answer to the customer now, in plain text.",
                    });
                    continue;
                }
                break;
            }
            if (toolCalls.length === 0)
                break;
            // Does any tool call return data the model still needs to see?
            const needsFollowup = toolCalls.some((c) => c.type === "function" && DATA_TOOLS.has(c.function.name));
            for (const call of toolCalls) {
                if (call.type !== "function")
                    continue;
                toolsUsed.push(call.function.name);
                let input = {};
                try {
                    input = JSON.parse(call.function.arguments || "{}");
                }
                catch {
                    // Malformed tool arguments — fall through with an empty object so
                    // the handler reports a clean error instead of throwing here.
                }
                // An identical call already answered this run is not asked again.
                const signature = `${call.function.name}:${JSON.stringify(input ?? {})}`;
                const cached = seenCalls.get(signature);
                if (cached !== undefined) {
                    repeatedCall = true;
                    messages.push({ role: "tool", tool_call_id: call.id, content: cached });
                    continue;
                }
                const output = await (0, execute_1.executeTool)(ctx, call.function.name, input);
                seenCalls.set(signature, JSON.stringify(output));
                // One failed send is final. See the note on `deliveryFailures`.
                if (call.function.name === "send_media" &&
                    output &&
                    typeof output === "object" &&
                    output.ok === false) {
                    deliveryFailures += 1;
                }
                messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: JSON.stringify(output),
                });
            }
            if (lead.opted_out)
                break;
            // Stop looping once a send has failed. The tool error already tells the
            // model to say the sales team will follow up; letting it retry only spends
            // the customer's time on an outcome that will not change.
            if (deliveryFailures > 0)
                break;
            // The model is going in circles: it re-issued a call whose answer it already
            // holds. Another turn produces the same result, so stop and let it answer.
            if (repeatedCall)
                break;
            // SPEED: the model already gave the customer a reply this turn, and the only
            // tools it called were side-effects (recording the lead, logging, handoff).
            // It has nothing more to say, so skip the redundant second Groq call. We
            // only continue the loop when a data tool was called and the model genuinely
            // needs that result to compose its answer.
            if (deliveredThisTurn && !needsFollowup)
                break;
        }
    }
    catch (e) {
        // Every key is rate-limited and the retry waits were exhausted. Rather than
        // drop the customer's message, send one honest holding line — the inbound
        // is already stored, so a later message or a human still has the context.
        const rateLimited = e instanceof Error && /rate.?limit/i.test(e.message);
        if (!rateLimited)
            throw e;
        if (replies.length === 0) {
            await acknowledge("Thanks for reaching out! I'm handling a lot of enquiries right now — I'll be back to you in a couple of minutes with the details.");
        }
    }
    // Ultimate safety net: if the turn produced no reply for ANY reason (empty
    // model output, a swallowed edge case), acknowledge rather than ghost the
    // customer. Shares the cooldown with the rate-limit path so rapid repeats
    // aren't spammed.
    if (replies.length === 0) {
        await acknowledge("Thanks for your message! Let me get the exact details from our sales team and come right back to you.");
    }
    async function acknowledge(text) {
        const recent = lastAckAt.get(lead.id) ?? 0;
        if (Date.now() - recent < ACK_COOLDOWN_MS)
            return; // acknowledged recently
        lastAckAt.set(lead.id, Date.now());
        if (lastAckAt.size > 2000) {
            const cutoff = Date.now() - ACK_COOLDOWN_MS;
            for (const [k, t] of lastAckAt)
                if (t < cutoff)
                    lastAckAt.delete(k);
        }
        try {
            await deliver({ text });
            replies.push({ text });
            await supabase.from("villa_messages").insert({
                conversation_id: conversation.id,
                lead_id: lead.id,
                role: "agent",
                body: text,
            });
        }
        catch {
            /* delivery failed — the stored inbound is the backstop */
        }
    }
    // GUARANTEE: if the customer asked for a file and the model did not actually
    // send one this turn, send it ourselves. This is why "send me the brochure"
    // now always delivers, instead of the model just claiming it did.
    const wantedKind = requestedAssetKind(customerMessage);
    const alreadySentMedia = toolsUsed.includes("send_media");
    if (wantedKind && !alreadySentMedia) {
        await forceSendAsset(lead, wantedKind, deliver, conversation.id).catch(() => { });
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
/** Same replay logic as the Anthropic path — see run.ts for the rationale. */
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
        const last = out[out.length - 1];
        if (last && last.role === role && typeof last.content === "string") {
            last.content = `${last.content}\n${text}`;
        }
        else {
            out.push({ role, content: text });
        }
    }
    while (out.length && out[0].role === "assistant")
        out.shift();
    return out;
}
