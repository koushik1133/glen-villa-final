"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageContext = pageContext;
exports.qs = qs;
const db_1 = require("./db");
const aggregate_1 = require("./metrics/aggregate");
/**
 * Every page resolves brand + date range the same way, from the query string, so
 * the brand switcher and the 7/30/90 toggle work identically everywhere without
 * each page reimplementing it.
 */
function pageContext(searchParams) {
    const db = (0, db_1.read)();
    const brandId = (0, db_1.resolveBrandId)(db, typeof searchParams.brand === "string" ? searchParams.brand : undefined);
    const days = Number(typeof searchParams.range === "string" ? searchParams.range : 30) || 30;
    // "Today" is today. This used to anchor to the newest day present in
    // `dailyStats` so the generated dataset never looked stale — with real data
    // that is a bug, because it silently freezes every range on the last day a
    // sync happened and reports a fortnight-old week as "the last 7 days".
    const range = (0, aggregate_1.lastNDays)(days, new Date());
    return {
        db,
        brandId,
        brand: db.brands.find((b) => b.id === brandId),
        range,
        prev: (0, aggregate_1.previousRange)(range),
        days,
    };
}
function qs(searchParams) {
    const p = new URLSearchParams();
    if (typeof searchParams.brand === "string")
        p.set("brand", searchParams.brand);
    if (typeof searchParams.range === "string")
        p.set("range", searchParams.range);
    const s = p.toString();
    return s ? `?${s}` : "";
}
