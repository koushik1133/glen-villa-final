"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageHeader = PageHeader;
exports.Card = Card;
exports.Stat = Stat;
exports.TemperaturePill = TemperaturePill;
exports.Badge = Badge;
exports.Empty = Empty;
exports.SetupNotice = SetupNotice;
exports.Meter = Meter;
exports.formatCr = formatCr;
exports.formatInr = formatInr;
exports.formatNumber = formatNumber;
exports.formatPercent = formatPercent;
exports.timeAgo = timeAgo;
exports.formatDate = formatDate;
const jsx_runtime_1 = require("react/jsx-runtime");
const whitelabel_1 = require("@/lib/whitelabel");
/**
 * Shared UI primitives. Every page composes these rather than restyling from
 * scratch, so a palette change lands everywhere at once.
 */
function PageHeader({ title, sub, actions, }) {
    return ((0, jsx_runtime_1.jsxs)("header", { className: "mb-7 flex flex-wrap items-start justify-between gap-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("h1", { className: "font-[family-name:var(--font-display)] text-[28px] leading-tight tracking-tight text-[var(--color-ink)]", children: title }), sub && (0, jsx_runtime_1.jsx)("p", { className: "mt-1.5 max-w-2xl text-sm text-[var(--color-muted)]", children: sub })] }), actions && (0, jsx_runtime_1.jsx)("div", { className: "flex shrink-0 flex-wrap items-center gap-2", children: actions })] }));
}
function Card({ title, hint, actions, gold, children, className = "", }) {
    return ((0, jsx_runtime_1.jsxs)("section", { className: `card ${gold ? "card-gold" : ""} ${className}`, children: [(title || actions) && ((0, jsx_runtime_1.jsxs)("header", { className: "mb-4 flex items-start justify-between gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [title && (0, jsx_runtime_1.jsx)("h2", { className: "text-sm font-semibold text-[var(--color-ink)]", children: title }), hint && (0, jsx_runtime_1.jsx)("p", { className: "mt-1 text-xs leading-relaxed text-[var(--color-muted)]", children: hint })] }), actions && (0, jsx_runtime_1.jsx)("div", { className: "shrink-0", children: actions })] })), children] }));
}
function Stat({ label, value, sub, delta, gold, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: `card ${gold ? "card-gold" : ""}`, children: [(0, jsx_runtime_1.jsx)("p", { className: "label", children: label }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-2.5 flex items-baseline gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: `stat ${gold ? "text-[var(--color-gold-300)]" : ""}`, children: value }), delta !== undefined && delta !== null && ((0, jsx_runtime_1.jsxs)("span", { className: `text-xs font-semibold tabular-nums ${delta >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`, children: [delta >= 0 ? "▲" : "▼", " ", Math.abs(delta).toFixed(1), "%"] }))] }), sub && (0, jsx_runtime_1.jsx)("p", { className: "mt-1.5 text-xs text-[var(--color-muted)]", children: sub })] }));
}
const TEMP_STYLES = {
    hot: "bg-[color-mix(in_oklab,var(--c-bad)_14%,transparent)] text-[var(--color-hot)]",
    warm: "bg-[color-mix(in_oklab,var(--c-warn)_14%,transparent)] text-[var(--color-warm)]",
    cold: "bg-[color-mix(in_oklab,var(--t-muted)_14%,transparent)] text-[var(--color-cold)]",
};
function TemperaturePill({ value }) {
    return ((0, jsx_runtime_1.jsxs)("span", { className: `pill ${TEMP_STYLES[value] ?? TEMP_STYLES.cold}`, children: [(0, jsx_runtime_1.jsx)("span", { className: "h-1.5 w-1.5 rounded-full bg-current" }), value.toUpperCase()] }));
}
const TONE_STYLES = {
    neutral: "bg-[var(--color-raised)] text-[var(--color-muted)]",
    gold: "bg-[var(--color-gold-soft)] text-[var(--color-gold-300)]",
    success: "bg-[color-mix(in_oklab,var(--c-good)_14%,transparent)] text-[var(--color-success)]",
    warning: "bg-[color-mix(in_oklab,var(--c-warn)_14%,transparent)] text-[var(--color-warm)]",
    danger: "bg-[color-mix(in_oklab,var(--c-bad)_14%,transparent)] text-[var(--color-danger)]",
    info: "bg-[color-mix(in_oklab,var(--color-viz-2)_14%,transparent)] text-[var(--color-info)]",
};
function Badge({ children, tone = "neutral" }) {
    return (0, jsx_runtime_1.jsx)("span", { className: `pill ${TONE_STYLES[tone]}`, children: children });
}
function Empty({ children, action }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-dashed border-[var(--color-line)] px-6 py-12 text-center", children: [(0, jsx_runtime_1.jsx)("p", { className: "text-sm text-[var(--color-muted)]", children: children }), action && (0, jsx_runtime_1.jsx)("div", { className: "mt-4 flex justify-center", children: action })] }));
}
/**
 * Shown when credentials are missing or a migration hasn't been run.
 *
 * `missing` arrives as environment-variable names because that is what the
 * server checks. A client is shown what each one *is* ("the database address")
 * and no file path; only a vendor deployment with the diagnostics switch on
 * sees the raw names it would need to fix them.
 */
function SetupNotice({ missing, detail }) {
    if (missing.length === 0 && !detail)
        return null;
    const raw = (0, whitelabel_1.showOperatorDetail)();
    return ((0, jsx_runtime_1.jsxs)("div", { className: "mb-6 rounded-2xl border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] p-5", children: [(0, jsx_runtime_1.jsx)("h2", { className: "text-sm font-semibold text-[var(--color-gold-300)]", children: "Setup needed" }), missing.length > 0 && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("p", { className: "mt-1.5 text-sm text-[var(--color-ink)]", children: raw
                            ? "Set the following in the server configuration:"
                            : "An administrator still has to finish connecting:" }), (0, jsx_runtime_1.jsx)("ul", { className: "mt-2 space-y-1", children: missing.map((m) => ((0, jsx_runtime_1.jsx)("li", { children: raw ? ((0, jsx_runtime_1.jsx)("code", { className: "rounded bg-[var(--color-raised)] px-1.5 py-0.5 text-xs text-[var(--color-gold-100)]", children: m })) : ((0, jsx_runtime_1.jsx)("span", { className: "text-sm text-[var(--color-ink)]", children: (0, whitelabel_1.settingLabel)(m) })) }, m))) })] })), detail && ((0, jsx_runtime_1.jsx)("p", { className: `text-sm text-[var(--color-muted)] ${missing.length > 0 ? "mt-3" : "mt-1.5"}`, children: (0, whitelabel_1.operatorText)(detail) }))] }));
}
/** Horizontal meter used for share-of-total breakdowns. */
function Meter({ value, max, tone = "gold" }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return ((0, jsx_runtime_1.jsx)("div", { className: "h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]", children: (0, jsx_runtime_1.jsx)("div", { className: "h-full rounded-full transition-all", style: {
                width: `${pct}%`,
                background: tone === "gold"
                    ? "linear-gradient(90deg, var(--color-gold-600), var(--color-gold-300))"
                    : "var(--color-info)",
            } }) }));
}
// -----------------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------------
/** Rupees → crore. The unit Indian real estate actually quotes in. */
function formatCr(inr) {
    if (inr === null || inr === undefined)
        return "—";
    return `₹${(inr / 10000000).toFixed(2)} Cr`;
}
/** Compact rupees: ₹1.2 Cr, ₹45.0 L, ₹8,500. */
function formatInr(inr) {
    if (inr === null || inr === undefined)
        return "—";
    if (Math.abs(inr) >= 10000000)
        return `₹${(inr / 10000000).toFixed(2)} Cr`;
    if (Math.abs(inr) >= 100000)
        return `₹${(inr / 100000).toFixed(1)} L`;
    return `₹${inr.toLocaleString("en-IN")}`;
}
function formatNumber(n) {
    if (n === null || n === undefined)
        return "—";
    return n.toLocaleString("en-IN");
}
function formatPercent(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(n))
        return "—";
    return `${n.toFixed(digits)}%`;
}
function timeAgo(iso) {
    if (!iso)
        return "—";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)
        return "just now";
    if (mins < 60)
        return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30)
        return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function formatDate(iso) {
    if (!iso)
        return "—";
    return new Date(iso).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}
