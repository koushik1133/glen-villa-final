"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATES = exports.DEFAULT_FIELDS = exports.ALL_FIELDS = exports.COLUMN_COLORS = void 0;
exports.nextColor = nextColor;
exports.templateColumns = templateColumns;
exports.makeBoard = makeBoard;
exports.orphanCards = orphanCards;
const ids_1 = require("../ids");
/**
 * Board templates.
 *
 * Applying a template rewrites the column set but never deletes cards: cards
 * whose column disappears become "orphans" and are surfaced in a banner so a
 * person decides where they go. Silently deleting someone's work to apply a
 * layout is the fastest way to lose their trust in the tool.
 */
/** Clicking a column's colour dot cycles through this ramp. */
exports.COLUMN_COLORS = [
    "#f59e0b", // amber
    "#8b8b95", // graphite
    "#22c55e", // green
    "#f43f5e", // rose
    "#22d3ee", // cyan
    "#a78bfa", // violet
    "#f472b6", // pink
    "#a8a29e", // stone
];
function nextColor(current) {
    const i = exports.COLUMN_COLORS.indexOf(current);
    return exports.COLUMN_COLORS[(i + 1) % exports.COLUMN_COLORS.length];
}
exports.ALL_FIELDS = [
    { key: "description", label: "Description", icon: "text" },
    { key: "priority", label: "Priority", icon: "chevron" },
    { key: "dueDate", label: "Due Date", icon: "calendar" },
    { key: "tags", label: "Tags", icon: "tag" },
    { key: "assignee", label: "Assignee", icon: "user" },
    { key: "automationLabel", label: "Automation Label", icon: "zap" },
    { key: "linkedPost", label: "Linked Post", icon: "link" },
];
exports.DEFAULT_FIELDS = {
    description: true,
    priority: true,
    dueDate: true,
    tags: true,
    assignee: true,
    automationLabel: false,
    linkedPost: false,
};
exports.TEMPLATES = [
    {
        id: "default",
        name: "Default",
        columns: [
            { name: "Pending Approval", color: exports.COLUMN_COLORS[0], hitl: true },
            { name: "To Do", color: exports.COLUMN_COLORS[1], hitl: false },
            { name: "Done", color: exports.COLUMN_COLORS[2], hitl: false },
        ],
    },
    {
        id: "content",
        name: "Content Calendar",
        columns: [
            { name: "Ideas", color: exports.COLUMN_COLORS[7], hitl: false },
            { name: "Drafting", color: exports.COLUMN_COLORS[4], hitl: false },
            { name: "Needs Approval", color: exports.COLUMN_COLORS[0], hitl: true },
            { name: "Scheduled", color: exports.COLUMN_COLORS[1], hitl: false },
            { name: "Published", color: exports.COLUMN_COLORS[2], hitl: false },
        ],
        fields: { automationLabel: true, linkedPost: true },
    },
    {
        id: "software",
        name: "Software Dev",
        columns: [
            { name: "Backlog", color: exports.COLUMN_COLORS[7], hitl: false },
            { name: "To Do", color: exports.COLUMN_COLORS[1], hitl: false },
            { name: "In Progress", color: exports.COLUMN_COLORS[4], hitl: false, wipLimit: 3 },
            { name: "In Review", color: exports.COLUMN_COLORS[0], hitl: true },
            { name: "Done", color: exports.COLUMN_COLORS[2], hitl: false },
        ],
    },
    {
        id: "sales",
        name: "Sales Pipeline",
        columns: [
            { name: "Lead In", color: exports.COLUMN_COLORS[7], hitl: false },
            { name: "Qualified", color: exports.COLUMN_COLORS[4], hitl: false },
            { name: "Proposal Sent", color: exports.COLUMN_COLORS[1], hitl: false },
            { name: "Negotiation", color: exports.COLUMN_COLORS[0], hitl: true },
            { name: "Won", color: exports.COLUMN_COLORS[2], hitl: false },
        ],
    },
    {
        id: "agency",
        name: "Agency",
        columns: [
            { name: "Client Request", color: exports.COLUMN_COLORS[7], hitl: false },
            { name: "In Production", color: exports.COLUMN_COLORS[4], hitl: false },
            { name: "Internal Review", color: exports.COLUMN_COLORS[5], hitl: true },
            { name: "Client Approval", color: exports.COLUMN_COLORS[0], hitl: true },
            { name: "Delivered", color: exports.COLUMN_COLORS[2], hitl: false },
        ],
    },
    {
        id: "support",
        name: "Support",
        columns: [
            { name: "New", color: exports.COLUMN_COLORS[3], hitl: false },
            { name: "Triaged", color: exports.COLUMN_COLORS[0], hitl: false },
            { name: "Waiting on Customer", color: exports.COLUMN_COLORS[7], hitl: false },
            { name: "Escalated", color: exports.COLUMN_COLORS[5], hitl: true },
            { name: "Resolved", color: exports.COLUMN_COLORS[2], hitl: false },
        ],
    },
];
function templateColumns(templateId) {
    const t = exports.TEMPLATES.find((x) => x.id === templateId) ?? exports.TEMPLATES[0];
    return t.columns.map((c) => ({ ...c, id: (0, ids_1.uid)("col") }));
}
function makeBoard(brandId, name, templateId = "default") {
    const t = exports.TEMPLATES.find((x) => x.id === templateId) ?? exports.TEMPLATES[0];
    const now = new Date().toISOString();
    return {
        id: (0, ids_1.uid)("board"),
        brandId,
        name,
        columns: templateColumns(templateId),
        fields: { ...exports.DEFAULT_FIELDS, ...(t.fields ?? {}) },
        templateId,
        createdAt: now,
        updatedAt: now,
    };
}
/** Cards pointing at a column that no longer exists. */
function orphanCards(cards, columns) {
    const live = new Set(columns.map((c) => c.id));
    return cards.filter((c) => !live.has(c.columnId));
}
