"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executiveSummary = executiveSummary;
exports.deterministicSummary = deterministicSummary;
exports.shortWhy = shortWhy;
const provider_1 = require("./provider");
async function executiveSummary(input) {
    const facts = buildFacts(input);
    const text = await (0, provider_1.complete)({
        system: "You write the opening paragraph of a marketing report for a business owner who is not a marketer. " +
            "Three to five sentences. Lead with the single most important movement. Use only the numbers given — " +
            "never invent, never round misleadingly. Say what to do next in plain words. No bullet points, no headings.",
        prompt: `Business: ${input.brand.name} (${input.brand.industry})\nPeriod: ${input.period}\n\nFacts:\n${facts}\n\nWrite the summary.`,
        maxTokens: 500,
        temperature: 0.5,
    });
    return text?.trim() ?? deterministicSummary(input);
}
function pct(now, before) {
    if (!before)
        return "n/a";
    const d = ((now - before) / before) * 100;
    return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}
function buildFacts(i) {
    return [
        `Impressions ${i.totals.impressions.toLocaleString()} (${pct(i.totals.impressions, i.previousTotals.impressions)})`,
        `Reach ${i.totals.reach.toLocaleString()} (${pct(i.totals.reach, i.previousTotals.reach)})`,
        `Engagements ${i.totals.engagements.toLocaleString()} (${pct(i.totals.engagements, i.previousTotals.engagements)})`,
        `Engagement rate ${i.totals.engagementRate.toFixed(2)}%`,
        `Net new followers ${i.totals.followerDelta.toLocaleString()}`,
        `Posts published ${i.totals.posts}`,
        `Ad spend $${i.ads.spend.toFixed(0)} (${pct(i.ads.spend, i.previousAds.spend)})`,
        `ROAS ${i.ads.roas.toFixed(2)}x (was ${i.previousAds.roas.toFixed(2)}x)`,
        `CPA $${i.ads.cpa.toFixed(2)}, CTR ${i.ads.ctr.toFixed(2)}%, CPM $${i.ads.cpm.toFixed(2)}`,
        `Conversions ${i.ads.conversions.toFixed(0)} worth $${i.ads.conversionValue.toFixed(0)}`,
        `Top recommendations: ${i.suggestions.slice(0, 3).map((s) => s.title).join(" | ") || "none"}`,
    ].join("\n");
}
/** Rule-based summary used when no API key is configured. */
function deterministicSummary(i) {
    const impressionsMove = ((i.totals.impressions - i.previousTotals.impressions) / (i.previousTotals.impressions || 1)) * 100;
    const roasMove = i.ads.roas - i.previousAds.roas;
    const lead = i.suggestions[0];
    const parts = [];
    parts.push(`Over ${i.period}, ${i.brand.name} reached ${i.totals.reach.toLocaleString()} people with ` +
        `${i.totals.impressions.toLocaleString()} impressions, ${impressionsMove >= 0 ? "up" : "down"} ` +
        `${Math.abs(impressionsMove).toFixed(1)}% on the previous period, and added ` +
        `${i.totals.followerDelta.toLocaleString()} followers across ${i.totals.posts} posts.`);
    parts.push(`Engagement rate held at ${i.totals.engagementRate.toFixed(2)}%. Paid spend of $${i.ads.spend.toFixed(0)} returned ` +
        `$${i.ads.conversionValue.toFixed(0)} at ${i.ads.roas.toFixed(2)}x ROAS ` +
        `(${roasMove >= 0 ? "up" : "down"} ${Math.abs(roasMove).toFixed(2)} on last period), with a $${i.ads.cpa.toFixed(2)} cost per conversion.`);
    if (lead)
        parts.push(`The priority right now: ${leadClause(lead)}`);
    return parts.join(" ");
}
/**
 * Phrase the lead recommendation's impact in the right register for its unit.
 * A blanket "worth roughly 1 posts" reads like a template failure, and one
 * clumsy sentence undermines the credibility of every number above it.
 */
function leadClause(lead) {
    const { value, unit, metric } = lead.projectedImpact;
    const title = lead.title.charAt(0).toLowerCase() + lead.title.slice(1);
    if (unit.startsWith("$")) {
        return `${title} — worth about $${Math.round(value).toLocaleString()}${unit === "$/30d" ? " over the next 30 days" : ""}.`;
    }
    if (unit === "%" || unit.startsWith("%"))
        return `${title} — around ${Math.round(value)}% on ${metric.toLowerCase()}.`;
    if (unit === "people")
        return `${title} — roughly ${Math.round(value).toLocaleString()} more people reached.`;
    return `${title}.`;
}
/** One-line "why this matters" used on suggestion cards when space is tight. */
function shortWhy(s) {
    return `${s.projectedImpact.metric}: ${s.projectedImpact.value.toLocaleString()} ${s.projectedImpact.unit} · ${Math.round(s.confidence * 100)}% confidence`;
}
