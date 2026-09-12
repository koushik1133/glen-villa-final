"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_NAMES = void 0;
exports.buildHeatmap = buildHeatmap;
exports.suggestSlots = suggestSlots;
const stats_1 = require("../metrics/stats");
const PRIOR_STRENGTH = 4; // posts needed before a cell is trusted over the mean
function buildHeatmap(db, brandId, channel) {
    const posts = db.posts.filter((p) => p.brandId === brandId &&
        p.status === "published" &&
        p.metrics &&
        p.publishedAt &&
        (!channel || p.targets.some((t) => t.channel === channel)));
    // No published post with metrics means there is no account mean to shrink
    // towards and no evidence in any cell. An empty grid is the honest answer:
    // filling 168 cells from a placeholder prior would paint a confident-looking
    // heatmap out of nothing, which is exactly the failure this engine exists to
    // avoid. Callers treat an empty result as "no signal yet".
    if (!posts.length)
        return [];
    const buckets = new Map();
    for (const p of posts) {
        const d = new Date(p.publishedAt);
        const key = `${d.getDay()}-${d.getHours()}`;
        buckets.set(key, [...(buckets.get(key) ?? []), p.metrics.engagementRate]);
    }
    const globalMean = (0, stats_1.mean)(posts.map((p) => p.metrics.engagementRate));
    const cells = [];
    for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
            const vals = buckets.get(`${day}-${hour}`) ?? [];
            const raw = vals.length ? (0, stats_1.mean)(vals) : globalMean;
            const n = vals.length;
            // Shrinkage: score = (n*raw + k*prior) / (n + k)
            const score = (n * raw + PRIOR_STRENGTH * globalMean) / (n + PRIOR_STRENGTH);
            cells.push({
                day,
                hour,
                raw,
                score,
                samples: n,
                confidence: n / (n + PRIOR_STRENGTH),
            });
        }
    }
    return cells;
}
/**
 * Propose the next N publishing slots.
 *
 * Constraints applied on top of the raw heatmap, because the statistically best
 * hour is not always the right answer:
 *  - never inside a quiet window (default 23:00–06:00),
 *  - at least `minGapHours` from anything already queued on the same channel,
 *    since two posts an hour apart cannibalise each other's distribution,
 *  - spread across distinct days so the queue does not clump.
 */
function suggestSlots(db, brandId, opts = {}) {
    const { count = 5, channel, from = new Date(), minGapHours = 6, quietStart = 23, quietEnd = 6 } = opts;
    const heat = buildHeatmap(db, brandId, channel);
    // Nothing published yet, so every hour is equally unproven. Ranking them anyway
    // would hand back arbitrary times carrying a "reason" line that implies history
    // we do not have; return nothing and let the UI say so.
    if (!heat.length)
        return [];
    const best = new Map();
    for (const c of heat)
        best.set(`${c.day}-${c.hour}`, c);
    const queued = db.posts
        .filter((p) => p.brandId === brandId && p.scheduledAt && ["scheduled", "approved"].includes(p.status))
        .map((p) => new Date(p.scheduledAt).getTime());
    const out = [];
    const usedDays = new Set();
    // Walk forward hour by hour for 21 days and score every candidate slot.
    const candidates = [];
    for (let h = 1; h <= 24 * 21; h++) {
        const t = new Date(from.getTime() + h * 3600_000);
        // Land on the hour: a recommendation of "13:33:47" reads as a bug, not a slot.
        t.setMinutes(0, 0, 0);
        const hour = t.getHours();
        if (quietStart > quietEnd ? hour >= quietStart || hour < quietEnd : hour >= quietStart && hour < quietEnd)
            continue;
        const cell = best.get(`${t.getDay()}-${hour}`);
        if (!cell)
            continue;
        candidates.push({ t, cell });
    }
    candidates.sort((a, b) => b.cell.score - a.cell.score || a.t.getTime() - b.t.getTime());
    for (const { t, cell } of candidates) {
        if (out.length >= count)
            break;
        const dayKey = t.toISOString().slice(0, 10);
        if (usedDays.has(dayKey))
            continue;
        const tooClose = queued.some((q) => Math.abs(q - t.getTime()) < minGapHours * 3600_000) ||
            out.some((s) => Math.abs(new Date(s.isoTime).getTime() - t.getTime()) < minGapHours * 3600_000);
        if (tooClose)
            continue;
        usedDays.add(dayKey);
        out.push({
            isoTime: t.toISOString(),
            day: t.getDay(),
            hour: t.getHours(),
            score: cell.score,
            confidence: cell.confidence,
            reason: cell.samples >= 2
                ? `${cell.samples} past posts in this slot averaged ${cell.raw.toFixed(1)}% engagement`
                : `Extrapolated from neighbouring slots — only ${cell.samples} past post here`,
        });
    }
    return out.sort((a, b) => a.isoTime.localeCompare(b.isoTime));
}
exports.DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
