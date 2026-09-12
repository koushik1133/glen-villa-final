"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NEGLECT_DAYS = exports.HIGH_SCORE = exports.FACTORS = exports.FACTOR_KEYS = void 0;
exports.explainScore = explainScore;
exports.loadLeadIntelligence = loadLeadIntelligence;
const supabase_1 = require("../supabase");
/**
 * Why a lead scores what it scores.
 *
 * `scoreLead` in src/lib/agent/scoring.ts adds two kinds of points: profile
 * points, which are a pure function of columns still on the lead row, and
 * behavioural points, which come from signals observed during a single
 * conversation turn (a site-visit request, a booking question, a handoff) and
 * are never persisted anywhere.
 *
 * So the profile half is recomputed here exactly, and the behavioural half is
 * reported as the residual between the stored score and that subtotal. That
 * residual is a measurement, not an estimate — it is precisely the part of the
 * score the lead row cannot account for. Attributing it to individual signals
 * would be invention, so it stays a single labelled band.
 */
// These tables mirror scoring.ts, which does not export them. They must stay in
// sync with it — a drift here would misexplain a score that is otherwise right.
const TIMELINE_POINTS = {
    immediate: 30,
    within_1_month: 26,
    "1_3_months": 20,
    "3_6_months": 12,
    "6_12_months": 6,
    researching: 2,
    unknown: 0,
};
const PURPOSE_POINTS = {
    self_use: 12,
    family: 12,
    nri_purchase: 12,
    second_home: 10,
    investment: 10,
    rental_income: 8,
    vacation_home: 8,
    undecided: 2,
};
exports.FACTOR_KEYS = [
    "timeline",
    "purpose",
    "specificity",
    "budget",
    "contactability",
    "engagement",
];
/**
 * Maxima come from scoring.ts: timeline 30, purpose 12, specificity
 * 6+8+3, budget 8, contactability 4+3+4. Engagement's ceiling is what is left
 * of the 100-point cap once the profile is maxed, not the raw signal total —
 * the raw signals sum to 58 but the score is clamped at 100.
 */
exports.FACTORS = [
    {
        key: "timeline",
        label: "Purchase timeline",
        max: 30,
        basis: "How soon they said they want to buy. The single strongest predictor.",
    },
    {
        key: "purpose",
        label: "Buyer purpose",
        max: 12,
        basis: "Self-use, family and NRI purchase score highest; undecided scores almost nothing.",
    },
    {
        key: "specificity",
        label: "Requirement specificity",
        max: 17,
        basis: "Bedrooms (6), a named villa type (8), a facing preference (3).",
    },
    {
        key: "budget",
        label: "Budget disclosed",
        max: 8,
        basis: "Sharing any budget figure at all is a trust signal.",
    },
    {
        key: "contactability",
        label: "Contactability",
        max: 11,
        basis: "Name (4), email (3), a decided financing preference (4).",
    },
    {
        key: "engagement",
        label: "Conversation signals",
        max: 22,
        basis: "Site visit request (20), booking question (15), handoff request (12), asked for material (5), sustained back-and-forth (up to 6). Observed live during the chat and not stored on the lead, so this band is the part of the score the profile cannot account for.",
    },
];
/** The columns the profile half of the score is computed from. */
const SCORING_COLUMNS = "id, name, email, lead_score, lead_temperature, pipeline_stage, purchase_timeline, buyer_purpose, " +
    "bedrooms, villa_type_interest, facing_preference, budget_min_inr, budget_max_inr, " +
    "financing_preference, assigned_to, last_contact_at, created_at, source, campaign, opted_out";
function daysSince(iso) {
    if (!iso)
        return null;
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
/**
 * Splits one stored score into its factors.
 *
 * When the profile subtotal exceeds the stored score the two are out of step —
 * the lead was edited after its last scored turn, or the 100-point clamp fired.
 * Rather than render a bar wider than the score it explains, the profile bands
 * are scaled down to fit and the lead is flagged `reconciled` so the UI can say
 * the split is approximate.
 */
function explainScore(row) {
    const timeline = TIMELINE_POINTS[row.purchase_timeline] ?? 0;
    const purpose = row.buyer_purpose ? (PURPOSE_POINTS[row.buyer_purpose] ?? 0) : 0;
    let specificity = 0;
    if (row.bedrooms !== null)
        specificity += 6;
    if (row.villa_type_interest !== null)
        specificity += 8;
    if (row.facing_preference)
        specificity += 3;
    const budget = row.budget_max_inr !== null || row.budget_min_inr !== null ? 8 : 0;
    let contactability = 0;
    if (row.name)
        contactability += 4;
    if (row.email)
        contactability += 3;
    if (row.financing_preference && row.financing_preference !== "undecided")
        contactability += 4;
    const profileSubtotal = timeline + purpose + specificity + budget + contactability;
    const score = row.lead_score;
    let factors;
    let reconciled = false;
    if (profileSubtotal <= score) {
        factors = {
            timeline,
            purpose,
            specificity,
            budget,
            contactability,
            engagement: score - profileSubtotal,
        };
    }
    else {
        reconciled = true;
        const ratio = profileSubtotal > 0 ? score / profileSubtotal : 0;
        factors = {
            timeline: timeline * ratio,
            purpose: purpose * ratio,
            specificity: specificity * ratio,
            budget: budget * ratio,
            contactability: contactability * ratio,
            engagement: 0,
        };
    }
    return {
        id: row.id,
        name: row.name ?? "(name not captured)",
        score,
        temperature: row.lead_temperature,
        pipelineStage: row.pipeline_stage,
        source: row.source,
        campaign: row.campaign,
        owner: row.villa_team_members?.name ?? null,
        lastContactAt: row.last_contact_at,
        daysSinceContact: daysSince(row.last_contact_at),
        optedOut: row.opted_out,
        factors,
        profileSubtotal,
        reconciled,
    };
}
/** Score at which a lead is worth a rep's attention today. `warm` starts at 50, `hot` at 80. */
exports.HIGH_SCORE = 70;
/** Days of silence after which a high-scoring lead counts as neglected. */
exports.NEGLECT_DAYS = 3;
/** Ceiling on rows scanned. Large enough for the histogram to be honest. */
const SCAN_LIMIT = 500;
async function loadLeadIntelligence() {
    // `assigned_to` is the only foreign key from villa_leads to villa_team_members,
    // so the unqualified embed resolves without a disambiguating hint.
    const { data } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select(`${SCORING_COLUMNS}, villa_team_members(name)`)
        .order("lead_score", { ascending: false })
        .limit(SCAN_LIMIT);
    const rows = (data ?? []);
    const leads = rows.map(explainScore);
    const buckets = Array.from({ length: 10 }, (_, i) => {
        const from = i * 10;
        const to = i === 9 ? 100 : from + 9;
        return { label: `${from}–${to}`, from, to, leads: 0 };
    });
    for (const lead of leads) {
        const index = Math.min(9, Math.max(0, Math.floor(lead.score / 10)));
        buckets[index].leads += 1;
    }
    const temperatureCounts = { hot: 0, warm: 0, cold: 0 };
    for (const lead of leads) {
        if (lead.temperature === "hot")
            temperatureCounts.hot += 1;
        else if (lead.temperature === "warm")
            temperatureCounts.warm += 1;
        else
            temperatureCounts.cold += 1;
    }
    // Only leads still worth working — a booked or opted-out lead is not neglected.
    const live = leads.filter((l) => !l.optedOut && l.pipelineStage !== "booked" && l.pipelineStage !== "lost");
    return {
        leads,
        scanned: leads.length,
        buckets,
        averageScore: leads.length > 0
            ? Math.round((leads.reduce((s, l) => s + l.score, 0) / leads.length) * 10) / 10
            : null,
        highScoreUnassigned: live.filter((l) => l.score >= exports.HIGH_SCORE && !l.owner).slice(0, 12),
        highScoreNeglected: live
            .filter((l) => l.score >= exports.HIGH_SCORE && l.daysSinceContact !== null && l.daysSinceContact >= exports.NEGLECT_DAYS)
            .sort((a, b) => (b.daysSinceContact ?? 0) - (a.daysSinceContact ?? 0))
            .slice(0, 12),
        temperatureCounts,
    };
}
