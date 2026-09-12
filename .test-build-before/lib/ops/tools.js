"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLS = exports.TOOL_SPECS = exports.escalate_to_human = exports.pause_followups = exports.create_followup = exports.record_document_received = exports.get_document_status = exports.get_missing_documents = exports.get_document_checklist = exports.get_assigned_loan_officer = exports.get_loan_case = exports.get_conversation_summary = exports.create_sales_task = exports.get_sentiment = exports.update_customer_profile = exports.get_lead_status = exports.get_customer_profile = void 0;
const db_1 = require("../db");
const config_1 = require("./config");
const customers_1 = require("./customers");
const followups_1 = require("./followups");
const loan_1 = require("./loan");
const sales_1 = require("./sales");
const intelligence_1 = require("./intelligence");
function ok(data) {
    return { ok: true, data };
}
function fail(error) {
    return { ok: false, error };
}
/** Wraps a tool so an exception becomes a failed result, never a false success. */
function guard(fn) {
    return (...args) => {
        try {
            return fn(...args);
        }
        catch (e) {
            return fail(e.message);
        }
    };
}
/* -------------------------------------------------------------------------- */
exports.get_customer_profile = guard((ctx) => {
    const c = (0, customers_1.getCustomer)(ctx.customerId);
    if (!c)
        return fail("Customer not found");
    return ok({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        leadStage: c.leadStage,
        leadScore: c.leadScore,
        intent: c.intent,
        sentiment: c.sentiment,
        loanRequired: c.loanRequired,
        preferences: c.preferences,
        tags: c.tags,
        salesControl: c.salesControl,
        loanControl: c.loanControl,
        optedOut: c.optedOut,
    });
});
exports.get_lead_status = guard((ctx) => {
    const c = (0, customers_1.getCustomer)(ctx.customerId);
    if (!c)
        return fail("Customer not found");
    const cfg = (0, config_1.getConfig)(ctx.orgId);
    return ok({
        stage: c.leadStage,
        status: c.leadStatus,
        score: c.leadScore,
        band: c.leadScore <= cfg.scoring.bands.cold ? "COLD" : c.leadScore <= cfg.scoring.bands.warm ? "WARM" : c.leadScore <= cfg.scoring.bands.hot ? "HOT" : "VERY_HOT",
        assignedSalesManagerId: c.assignedSalesManagerId,
        assignedLoanOfficerId: c.assignedLoanOfficerId,
    });
});
exports.update_customer_profile = guard((ctx, patch) => {
    const current = (0, customers_1.getCustomer)(ctx.customerId);
    if (!current)
        return fail("Customer not found");
    // Merge preferences rather than replacing: each extraction learns one fact.
    const merged = patch.preferences ? { ...current.preferences, ...patch.preferences } : undefined;
    const updated = (0, customers_1.updateCustomer)(ctx.customerId, { ...patch, ...(merged ? { preferences: merged } : {}) }, { id: ctx.actorId, type: ctx.actorType });
    return updated ? ok({ updated: true, customerId: updated.id }) : fail("Update failed");
});
exports.get_sentiment = guard((ctx) => {
    const c = (0, customers_1.getCustomer)(ctx.customerId);
    if (!c)
        return fail("Customer not found");
    return ok({
        sentiment: c.sentiment,
        confidence: c.sentimentConfidence,
        intent: c.intent,
        trend: (0, intelligence_1.sentimentTrend)(ctx.customerId),
        history: (0, intelligence_1.sentimentTimeline)(ctx.customerId).slice(-10).map((e) => ({
            sentiment: e.sentiment,
            intent: e.intent,
            at: e.createdAt,
            reason: e.reason,
        })),
    });
});
exports.create_sales_task = guard((ctx, args) => {
    const c = (0, customers_1.getCustomer)(ctx.customerId);
    if (!c)
        return fail("Customer not found");
    const task = (0, sales_1.maybeCreateSalesTask)({ customer: c, aiUncertain: true });
    if (!task)
        return fail(args.reason ? `No configured trigger matched: ${args.reason}` : "No configured trigger matched");
    return ok({ taskId: task.id, priority: task.priority, assignedToId: task.assignedToId, status: task.status });
});
exports.get_conversation_summary = guard((ctx) => {
    const briefing = (0, sales_1.buildBriefing)(ctx.customerId);
    return ok({ summary: briefing.text, fields: briefing.fields, recommendedAction: briefing.recommendedAction });
});
/* -------------------------------------------------------------------------- */
/* Loan & documents                                                            */
/* -------------------------------------------------------------------------- */
exports.get_loan_case = guard((ctx) => {
    const c = (0, loan_1.activeCase)(ctx.customerId);
    if (!c)
        return fail("No active loan case for this customer");
    return ok({
        id: c.id,
        status: c.status,
        loanType: c.loanType,
        requestedAmount: c.requestedAmount,
        assignedOfficerId: c.assignedOfficerId,
        readyForReviewAt: c.readyForReviewAt,
    });
});
exports.get_assigned_loan_officer = guard((ctx) => {
    const c = (0, customers_1.getCustomer)(ctx.customerId);
    if (!c?.assignedLoanOfficerId)
        return fail("No loan officer assigned");
    const m = (0, db_1.read)().teamMembers.find((x) => x.id === c.assignedLoanOfficerId);
    return m ? ok({ id: m.id, name: m.name }) : fail("Assigned officer not found");
});
/**
 * The assistant's only source of document requirements. There is deliberately
 * no tool to *add* a checklist item: requirements come from the loan department.
 */
exports.get_document_checklist = guard((ctx) => {
    const c = (0, loan_1.activeCase)(ctx.customerId);
    if (!c)
        return fail("No active loan case");
    const items = (0, loan_1.checklistFor)(c.id);
    if (!items.length)
        return fail("No checklist has been configured yet");
    return ok(items.map((i) => ({
        id: i.id,
        label: i.customerLabel,
        description: i.description,
        required: i.required,
        status: i.status,
        acceptedFormats: i.acceptedFormats,
        rejectionReason: i.rejectionReason,
    })));
});
exports.get_missing_documents = guard((ctx) => {
    const c = (0, loan_1.activeCase)(ctx.customerId);
    if (!c)
        return fail("No active loan case");
    const p = (0, loan_1.caseProgress)(c.id);
    return ok({
        completionPct: p.completionPct,
        requiredTotal: p.requiredTotal,
        requiredAccepted: p.requiredAccepted,
        missing: p.missing.map((i) => ({ id: i.id, label: i.customerLabel, description: i.description })),
        rejected: p.rejected.map((i) => ({ id: i.id, label: i.customerLabel, reason: i.rejectionReason })),
        awaitingReview: p.awaitingReview.map((i) => ({ id: i.id, label: i.customerLabel })),
        optionalOutstanding: p.optionalOutstanding.map((i) => ({ id: i.id, label: i.customerLabel })),
    });
});
exports.get_document_status = guard((ctx, args) => {
    const item = (0, db_1.read)().checklistItems.find((i) => i.id === args.checklistItemId);
    if (!item)
        return fail("Checklist item not found");
    return ok({
        label: item.customerLabel,
        status: item.status,
        rejectionReason: item.rejectionReason,
        // Explicit, so the agent cannot infer acceptance from "uploaded".
        acceptedByHuman: item.status === "ACCEPTED",
    });
});
/**
 * Records that a customer said they sent something. It does NOT create a
 * document — that only happens when a file actually arrives and is stored.
 */
exports.record_document_received = guard((ctx, args) => {
    const item = (0, db_1.read)().checklistItems.find((i) => i.id === args.checklistItemId);
    if (!item)
        return fail("Checklist item not found");
    if (item.status !== "UPLOADED") {
        return fail(`No file has been stored for ${item.customerLabel}; its status is ${item.status}`);
    }
    return ok({ label: item.customerLabel, status: item.status, note: args.note });
});
/* -------------------------------------------------------------------------- */
/* Follow-ups & escalation                                                     */
/* -------------------------------------------------------------------------- */
exports.create_followup = guard((ctx, args) => {
    const c = (0, customers_1.getCustomer)(ctx.customerId);
    if (!c)
        return fail("Customer not found");
    const allowed = (0, customers_1.automationAllowed)(c, args.lane);
    if (!allowed.allowed)
        return fail(allowed.reason);
    const f = (0, followups_1.createFollowUp)({
        orgId: ctx.orgId,
        customerId: ctx.customerId,
        kind: args.kind,
        lane: args.lane,
        reason: args.reason,
        scheduledAt: args.scheduledAt,
        checklistItemId: args.checklistItemId,
        loanCaseId: (0, loan_1.activeCase)(ctx.customerId)?.id,
    });
    return f ? ok({ followUpId: f.id, scheduledAt: f.scheduledAt }) : fail("Could not create follow-up");
});
exports.pause_followups = guard((ctx, args) => {
    const n = (0, followups_1.cancelFollowUps)({ customerId: ctx.customerId }, args.reason);
    (0, customers_1.setControl)(ctx.customerId, args.lane, "HUMAN_CONTROL", { id: ctx.actorId, type: ctx.actorType });
    return ok({ cancelled: n, lane: args.lane });
});
exports.escalate_to_human = guard((ctx, args) => {
    const e = (0, followups_1.escalate)({
        orgId: ctx.orgId,
        customerId: ctx.customerId,
        ruleId: args.ruleId,
        lane: args.lane,
        severity: args.severity ?? "MEDIUM",
        reason: args.reason,
        detail: args.detail,
    });
    return e ? ok({ escalationId: e.id, status: e.status, assignedToId: e.assignedToId }) : fail("Could not escalate");
});
exports.TOOL_SPECS = [
    { name: "get_customer_profile", description: "Read the canonical customer profile", mutating: false },
    { name: "get_lead_status", description: "Read lead stage, score and owners", mutating: false },
    { name: "update_customer_profile", description: "Merge newly-learned facts into the profile", mutating: true },
    { name: "get_sentiment", description: "Read current sentiment, trend and history", mutating: false },
    { name: "create_sales_task", description: "Hand the customer to a sales manager", mutating: true },
    { name: "get_conversation_summary", description: "Read the AI briefing for this customer", mutating: false },
    { name: "get_loan_case", description: "Read the active loan case", mutating: false },
    { name: "get_assigned_loan_officer", description: "Read the assigned loan officer", mutating: false },
    { name: "get_document_checklist", description: "Read the loan department's configured checklist", mutating: false },
    { name: "get_missing_documents", description: "Read outstanding, rejected and pending documents", mutating: false },
    { name: "get_document_status", description: "Read the status of one checklist item", mutating: false },
    { name: "record_document_received", description: "Confirm a file was actually stored for an item", mutating: false },
    { name: "create_followup", description: "Schedule a follow-up", mutating: true },
    { name: "pause_followups", description: "Stop automation and hand to a human", mutating: true },
    { name: "escalate_to_human", description: "Raise an escalation for a human to handle", mutating: true },
];
exports.TOOLS = {
    get_customer_profile: exports.get_customer_profile,
    get_lead_status: exports.get_lead_status,
    update_customer_profile: exports.update_customer_profile,
    get_sentiment: exports.get_sentiment,
    create_sales_task: exports.create_sales_task,
    get_conversation_summary: exports.get_conversation_summary,
    get_loan_case: exports.get_loan_case,
    get_assigned_loan_officer: exports.get_assigned_loan_officer,
    get_document_checklist: exports.get_document_checklist,
    get_missing_documents: exports.get_missing_documents,
    get_document_status: exports.get_document_status,
    record_document_received: exports.record_document_received,
    create_followup: exports.create_followup,
    pause_followups: exports.pause_followups,
    escalate_to_human: exports.escalate_to_human,
};
