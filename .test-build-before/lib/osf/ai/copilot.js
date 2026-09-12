"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.STARTER_QUESTIONS = void 0;
exports.gatherContext = gatherContext;
exports.answerQuestion = answerQuestion;
const supabase_1 = require("../supabase");
const env_1 = require("../env");
/** Every stage in the villa_pipeline_stage enum, in funnel order. */
const PIPELINE_STAGES = [
    "new",
    "contacted",
    "qualifying",
    "qualified",
    "site_visit_scheduled",
    "site_visit_completed",
    "negotiation",
    "token_paid",
    "booked",
    "lost",
];
/** A lead this quiet is one nobody is actively working. */
const STALE_CONTACT_DAYS = 3;
/** Rows per list section. Keeps the prompt bounded whatever the data size. */
const SAMPLE_LIMIT = 8;
function daysAgoIso(days) {
    return new Date(Date.now() - days * 86_400_000).toISOString();
}
function daysSince(iso) {
    if (!iso)
        return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
function nullableNum(value) {
    if (value === null || value === undefined)
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
/**
 * Runs the whole fixed query set in one parallel batch.
 *
 * Every section degrades independently: a table that isn't there yet becomes a
 * null section plus an entry in `unavailable`, never a thrown page and never a
 * silent zero the model would read as a real measurement.
 */
async function gatherContext() {
    const supabase = (0, supabase_1.db)();
    const now = new Date();
    const d7 = daysAgoIso(7);
    const d14 = daysAgoIso(14);
    const stale = daysAgoIso(STALE_CONTACT_DAYS);
    const nowIso = now.toISOString();
    const [funnelRes, stageRes, last7Res, prev7Res, sourcesRes, hotRes, revenueRes, bookingTotalsRes, followUpsPendingRes, followUpsOverdueRes, overdueSampleRes, objectionsRes, questionsRes, campaignsRes, inventoryRes,] = await Promise.all([
        supabase.from("villa_funnel").select("*").maybeSingle(),
        Promise.all(PIPELINE_STAGES.map((stage) => supabase
            .from("villa_leads")
            .select("id", { count: "exact", head: true })
            .eq("pipeline_stage", stage))),
        supabase.from("villa_leads").select("id", { count: "exact", head: true }).gte("created_at", d7),
        supabase
            .from("villa_leads")
            .select("id", { count: "exact", head: true })
            .gte("created_at", d14)
            .lt("created_at", d7),
        supabase.from("villa_source_summary").select("*").limit(SAMPLE_LIMIT),
        supabase
            .from("villa_leads")
            .select("name, lead_score, pipeline_stage, assigned_to, last_contact_at")
            .eq("lead_temperature", "hot")
            .eq("opted_out", false)
            .or(`assigned_to.is.null,last_contact_at.lt.${stale}`)
            .order("lead_score", { ascending: false })
            .limit(SAMPLE_LIMIT),
        supabase.from("villa_revenue_monthly").select("*").limit(6),
        supabase.from("villa_bookings").select("value_inr, amount_paid_inr").neq("status", "cancelled").limit(1000),
        supabase.from("villa_follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase
            .from("villa_follow_ups")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending")
            .lt("scheduled_at", nowIso),
        supabase
            .from("villa_follow_ups")
            .select("scheduled_at, channel, villa_leads(name)")
            .eq("status", "pending")
            .lt("scheduled_at", nowIso)
            .order("scheduled_at", { ascending: true })
            .limit(SAMPLE_LIMIT),
        supabase.from("villa_objection_summary").select("*").limit(SAMPLE_LIMIT),
        supabase.from("villa_questions").select("topic").eq("unanswered", true).limit(500),
        supabase.from("villa_campaign_performance").select("*").limit(SAMPLE_LIMIT),
        supabase.from("villa_inventory_summary").select("*").limit(20),
    ]);
    const unavailable = [];
    const funnel = funnelRes.error
        ? null
        : (funnelRes.data ?? null);
    if (funnelRes.error)
        unavailable.push("funnel totals");
    const pipeline_by_stage = stageRes.every((r) => r.error)
        ? []
        : PIPELINE_STAGES.map((stage, i) => ({ stage, leads: stageRes[i].count ?? 0 })).filter((s) => s.leads > 0);
    if (stageRes.some((r) => r.error))
        unavailable.push("pipeline stage counts");
    const lead_volume = last7Res.error || prev7Res.error
        ? null
        : { last_7_days: last7Res.count ?? 0, previous_7_days: prev7Res.count ?? 0 };
    if (!lead_volume)
        unavailable.push("week-over-week lead volume");
    const top_sources = sourcesRes.error
        ? []
        : (sourcesRes.data ?? []).map((s) => ({
            source: String(s.source ?? "unknown"),
            campaign: s.campaign ?? null,
            leads: num(s.leads),
            hot: num(s.hot),
            qualified: num(s.qualified),
            avg_score: nullableNum(s.avg_score),
        }));
    if (sourcesRes.error)
        unavailable.push("lead sources");
    const hot_leads_needing_attention = hotRes.error
        ? []
        : (hotRes.data ?? []).map((l) => {
            const idle = daysSince(l.last_contact_at);
            const reasons = [];
            if (!l.assigned_to)
                reasons.push("no owner assigned");
            if (idle >= STALE_CONTACT_DAYS)
                reasons.push(`no contact for ${idle} days`);
            return {
                name: l.name ?? "(name not captured)",
                lead_score: l.lead_score,
                pipeline_stage: l.pipeline_stage,
                assigned: Boolean(l.assigned_to),
                days_since_contact: idle,
                reason: reasons.join(" and "),
            };
        });
    if (hotRes.error)
        unavailable.push("hot leads needing attention");
    const bookingRows = bookingTotalsRes.error
        ? []
        : (bookingTotalsRes.data ?? []);
    const revenue = bookingTotalsRes.error
        ? null
        : {
            total_booked_value_inr: bookingRows.reduce((s, b) => s + num(b.value_inr), 0),
            total_collected_inr: bookingRows.reduce((s, b) => s + num(b.amount_paid_inr), 0),
            recent_months: revenueRes.error
                ? []
                : (revenueRes.data ?? []).map((m) => ({
                    month: String(m.month ?? ""),
                    bookings: num(m.bookings),
                    booked_value_inr: num(m.booked_value_inr),
                    collected_inr: num(m.collected_inr),
                })),
        };
    if (!revenue)
        unavailable.push("revenue totals");
    const follow_ups = followUpsPendingRes.error || followUpsOverdueRes.error
        ? null
        : {
            pending: followUpsPendingRes.count ?? 0,
            overdue: followUpsOverdueRes.count ?? 0,
            oldest_overdue_at: (overdueSampleRes.data ?? [])[0]?.scheduled_at ?? null,
            overdue_sample: overdueSampleRes.error
                ? []
                : (overdueSampleRes.data ?? []).map((f) => ({
                    lead: f.villa_leads?.name ?? "(name not captured)",
                    scheduled_at: f.scheduled_at,
                    channel: f.channel,
                })),
        };
    if (!follow_ups)
        unavailable.push("follow-up queue");
    const objections = objectionsRes.error
        ? []
        : (objectionsRes.data ?? []).map((o) => ({
            category: String(o.category ?? "unknown"),
            total: num(o.total),
            pct: num(o.pct),
        }));
    if (objectionsRes.error)
        unavailable.push("objection breakdown");
    let unanswered_questions = null;
    if (questionsRes.error) {
        unavailable.push("unanswered buyer questions");
    }
    else {
        const rows = (questionsRes.data ?? []);
        const counts = new Map();
        for (const r of rows)
            counts.set(r.topic, (counts.get(r.topic) ?? 0) + 1);
        unanswered_questions = {
            total: rows.length,
            top_topics: [...counts.entries()]
                .map(([topic, count]) => ({ topic, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5),
        };
    }
    const campaigns = campaignsRes.error
        ? []
        : (campaignsRes.data ?? []).map((c) => ({
            name: String(c.name ?? ""),
            platform: String(c.platform ?? ""),
            status: String(c.status ?? ""),
            spent_inr: num(c.spent_inr),
            leads: num(c.leads),
            qualified_leads: num(c.qualified_leads),
            bookings: num(c.bookings),
            cpl_inr: nullableNum(c.cpl_inr),
            ctr: nullableNum(c.ctr),
            roas: nullableNum(c.roas),
        }));
    if (campaignsRes.error)
        unavailable.push("campaign performance");
    const inventory = inventoryRes.error
        ? []
        : (inventoryRes.data ?? []).map((i) => ({
            project_name: String(i.project_name ?? ""),
            villa_type: String(i.villa_type ?? ""),
            total_units: num(i.total_units),
            available: num(i.available),
            under_booking: num(i.under_booking),
            reserved: num(i.reserved),
            sold: num(i.sold),
        }));
    if (inventoryRes.error)
        unavailable.push("inventory summary");
    return {
        generated_at: nowIso,
        funnel,
        pipeline_by_stage,
        lead_volume,
        top_sources,
        hot_leads_needing_attention,
        revenue,
        follow_ups,
        objections,
        unanswered_questions,
        campaigns,
        inventory,
        unavailable,
    };
}
// -----------------------------------------------------------------------------
// The model call
// -----------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the analyst inside VillaOS, the business console of a luxury villa developer in India. You answer questions about THIS business using ONLY the DATA CONTEXT supplied with each question.

Absolute rules:
1. Every number you state must appear in the DATA CONTEXT. Never estimate, project, forecast, extrapolate, annualise, or compute a figure the context does not contain — except for a simple, clearly-labelled ratio between two numbers that are both in the context.
2. If the context does not contain what was asked, reply "I don't have that data" and name exactly which section or field would be needed. Do not substitute a related number and do not apologise at length.
3. Never invent facts about the property, the market, competitors, pricing, or anything outside the context. You have no knowledge of Indian real estate prices and must not offer any.
4. Never recommend a specific price or price change. You may point at a difference in the data and say the sales team should review it.
5. Money in the context is in rupees. Report large amounts in crore (1 crore = 10,000,000) or lakh (1 lakh = 100,000) and say which. Do not convert to any other currency.
6. When a section is listed in "unavailable", treat it as missing data, not as zero.
7. Empty arrays and zero counts are real answers — say "none recorded" rather than guessing why.

Style: direct, 2-6 sentences or a short "- " bullet list. Lead with the number that answers the question. Name the field or section each figure came from so it can be checked. No markdown headings, no tables, no preamble.`;
exports.STARTER_QUESTIONS = [
    "Which hot leads need attention right now, and why?",
    "Which lead source is producing the most qualified leads?",
    "What are buyers objecting to most often?",
    "How much value is booked, and how much has actually been collected?",
    "Which villa type has the least inventory left?",
    "Are follow-ups slipping? How far behind are we?",
    "Which campaign has the worst cost per lead?",
    "Where is the funnel leaking the most?",
];
/** Same LLM_PROVIDER switch the WhatsApp agent uses — see src/lib/agent/index.ts. */
async function answerQuestion(question, context) {
    const user = `DATA CONTEXT (JSON — the only facts you have about this business):
${JSON.stringify(context, null, 2)}

QUESTION: ${question}`;
    if (env_1.env.llmProvider === "groq") {
        const { default: Groq } = await Promise.resolve().then(() => __importStar(require("groq-sdk")));
        const client = new Groq({ apiKey: env_1.env.groqApiKey });
        const response = await client.chat.completions.create({
            model: env_1.env.groqModel,
            max_tokens: 1200,
            temperature: 0.2,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: user },
            ],
        });
        return {
            answer: response.choices[0]?.message?.content?.trim() ?? "",
            provider: "groq",
            model: env_1.env.groqModel,
        };
    }
    const { default: Anthropic } = await Promise.resolve().then(() => __importStar(require("@anthropic-ai/sdk")));
    const client = new Anthropic({ apiKey: env_1.env.anthropicApiKey });
    const response = await client.messages.create({
        model: env_1.env.model,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: user }],
    });
    const answer = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
    return { answer, provider: "anthropic", model: env_1.env.model };
}
