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
exports.activeCase = activeCase;
exports.getCase = getCase;
exports.createLoanCase = createLoanCase;
exports.defaultChecklist = defaultChecklist;
exports.setDefaultChecklist = setDefaultChecklist;
exports.ensureDefaultChecklist = ensureDefaultChecklist;
exports.setLoanStatus = setLoanStatus;
exports.checklistFor = checklistFor;
exports.addChecklistItems = addChecklistItems;
exports.applyChecklistTemplate = applyChecklistTemplate;
exports.updateChecklistItem = updateChecklistItem;
exports.removeChecklistItem = removeChecklistItem;
exports.caseProgress = caseProgress;
exports.caseLink = caseLink;
exports.refreshCaseProgress = refreshCaseProgress;
exports.loanWorkspace = loanWorkspace;
const db_1 = require("../db");
const ids_1 = require("../ids");
const assignment_1 = require("./assignment");
const audit_1 = require("./audit");
const config_1 = require("./config");
const customers_1 = require("./customers");
/**
 * LOAN WORKFLOW
 *
 * The checklist is owned by the loan department, never by the AI. The document
 * assistant reads it and nothing else — it cannot add a requirement, and it
 * cannot mark anything accepted. Those are the two failure modes that turn a
 * helpful assistant into a liability: inventing paperwork, and telling a
 * customer they are approved when nobody decided that.
 */
function activeCase(customerId) {
    return (0, db_1.read)().loanCases.find((l) => l.customerId === customerId && !["COMPLETED", "REJECTED"].includes(l.status));
}
function getCase(loanCaseId) {
    return (0, db_1.read)().loanCases.find((l) => l.id === loanCaseId);
}
/**
 * Create the loan case. Idempotent: a sales manager clicking "financing
 * required" twice must not open two cases against one customer.
 */
function createLoanCase(opts) {
    const existing = activeCase(opts.customerId);
    if (existing)
        return { loanCase: existing, created: false };
    const now = new Date().toISOString();
    const loanCase = {
        id: (0, ids_1.uid)("lcs"),
        orgId: opts.orgId,
        customerId: opts.customerId,
        status: "NOT_STARTED",
        loanType: opts.loanType ?? "standard",
        requestedAmount: opts.requestedAmount,
        officerNotes: [],
        createdAt: now,
        updatedAt: now,
    };
    (0, db_1.mutate)((db) => void db.loanCases.push(loanCase));
    (0, customers_1.updateCustomer)(opts.customerId, { loanRequired: "YES" }, { id: opts.actorId, type: opts.actorType ?? "system" });
    (0, customers_1.setStage)(opts.customerId, "LOAN_CASE", { id: opts.actorId, type: opts.actorType ?? "system" }, "Financing required");
    (0, audit_1.audit)({
        orgId: opts.orgId,
        actorId: opts.actorId,
        actorType: opts.actorType ?? "system",
        action: "loan_case.created",
        entity: "loan_case",
        entityId: loanCase.id,
        customerId: opts.customerId,
        metadata: { loanType: loanCase.loanType, requestedAmount: opts.requestedAmount },
    });
    (0, assignment_1.assign)({
        orgId: opts.orgId,
        customerId: opts.customerId,
        queue: "LOAN",
        assigneeId: opts.assigneeId,
        reason: "Financing required",
        actorId: opts.actorId,
        actorType: opts.actorType ?? "system",
    });
    // A new case starts with the org's standard document set so the assistant
    // can ask for paperwork immediately; the officer edits from there.
    ensureDefaultChecklist(loanCase.id, { id: opts.actorId, type: opts.actorType === "human" ? "human" : "system" });
    return { loanCase: activeCase(opts.customerId) ?? loanCase, created: true };
}
/** The org's default document set (the template a new case starts with). */
function defaultChecklist(orgId) {
    const cfg = (0, config_1.getConfig)(orgId);
    const template = cfg.checklistTemplates.find((t) => t.id === (cfg.defaultChecklistTemplateId ?? "standard_home_loan")) ??
        cfg.checklistTemplates[0];
    return { templateId: template?.id ?? "standard_home_loan", items: template?.items ?? [] };
}
/** Replace the org's default document set. Existing cases are untouched. */
function setDefaultChecklist(orgId, items) {
    const cfg = (0, config_1.getConfig)(orgId);
    const templateId = cfg.defaultChecklistTemplateId ?? "standard_home_loan";
    const clean = items
        .map((i) => ({
        documentType: (i.documentType || i.customerLabel).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        customerLabel: i.customerLabel.trim(),
        description: (i.description ?? "").trim(),
        required: Boolean(i.required),
        acceptedFormats: (i.acceptedFormats?.length ? i.acceptedFormats : ["jpg", "png", "pdf"]).map((f) => f.toLowerCase()),
    }))
        .filter((i, idx, all) => i.customerLabel && all.findIndex((x) => x.documentType === i.documentType) === idx);
    const templates = cfg.checklistTemplates.some((t) => t.id === templateId)
        ? cfg.checklistTemplates.map((t) => (t.id === templateId ? { ...t, items: clean } : t))
        : [{ id: templateId, name: "Standard home loan", items: clean }, ...cfg.checklistTemplates];
    (0, config_1.updateConfig)(orgId, { checklistTemplates: templates, defaultChecklistTemplateId: templateId });
    return clean;
}
/** Apply the default set once — only to a case that has no checklist at all. */
function ensureDefaultChecklist(loanCaseId, actor) {
    const loanCase = getCase(loanCaseId);
    if (!loanCase)
        return [];
    if (checklistFor(loanCaseId).length)
        return [];
    const { items } = defaultChecklist(loanCase.orgId);
    if (!items.length)
        return [];
    return addChecklistItems(loanCaseId, items, actor);
}
function setLoanStatus(loanCaseId, status, actor, note) {
    const before = getCase(loanCaseId);
    if (!before || before.status === status)
        return before ?? null;
    const updated = (0, db_1.mutate)((db) => {
        const l = db.loanCases.find((x) => x.id === loanCaseId);
        if (!l)
            return null;
        l.status = status;
        l.updatedAt = new Date().toISOString();
        if (note)
            l.officerNotes.push(note);
        if (["APPROVED", "REJECTED", "COMPLETED"].includes(status))
            l.closedAt = l.updatedAt;
        return { ...l };
    });
    if (!updated)
        return null;
    (0, audit_1.audit)({
        orgId: updated.orgId,
        actorId: actor.id,
        actorType: actor.type,
        action: "loan_case.status_changed",
        entity: "loan_case",
        entityId: loanCaseId,
        customerId: updated.customerId,
        metadata: { from: before.status, to: status, note },
    });
    const stageFor = {
        DOCUMENT_COLLECTION: "DOCUMENT_COLLECTION",
        UNDER_REVIEW: "DOCUMENT_REVIEW",
        DOCUMENTS_INCOMPLETE: "DOCUMENT_COLLECTION",
        READY_FOR_ANALYSIS: "READY_FOR_ANALYSIS",
        APPROVED: "DECISION",
        REJECTED: "DECISION",
        COMPLETED: "COMPLETED",
    };
    const stage = stageFor[status];
    if (stage)
        (0, customers_1.setStage)(updated.customerId, stage, actor, `Loan status ${status}`);
    return updated;
}
/* -------------------------------------------------------------------------- */
/* Checklist                                                                   */
/* -------------------------------------------------------------------------- */
function checklistFor(loanCaseId) {
    return (0, db_1.read)()
        .checklistItems.filter((i) => i.loanCaseId === loanCaseId)
        .sort((a, b) => a.order - b.order);
}
function addChecklistItems(loanCaseId, items, actor) {
    const loanCase = getCase(loanCaseId);
    if (!loanCase)
        return [];
    const existing = checklistFor(loanCaseId);
    const now = new Date().toISOString();
    let order = existing.length;
    const created = items
        // Adding the same document type twice is a mistake, not a requirement.
        .filter((i) => !existing.some((e) => e.documentType === i.documentType))
        .map((i) => ({
        id: (0, ids_1.uid)("chk"),
        orgId: loanCase.orgId,
        loanCaseId,
        documentType: i.documentType,
        customerLabel: i.customerLabel,
        description: i.description,
        required: i.required,
        status: "NOT_REQUESTED",
        acceptedFormats: i.acceptedFormats,
        dueAt: i.dueAt,
        order: order++,
        createdAt: now,
        updatedAt: now,
    }));
    if (!created.length)
        return [];
    (0, db_1.mutate)((db) => void db.checklistItems.push(...created));
    (0, audit_1.audit)({
        orgId: loanCase.orgId,
        actorId: actor.id,
        actorType: actor.type,
        action: "checklist.items_added",
        entity: "loan_case",
        entityId: loanCaseId,
        customerId: loanCase.customerId,
        metadata: { count: created.length, types: created.map((c) => c.documentType) },
    });
    if (loanCase.status === "NOT_STARTED" || loanCase.status === "INFORMATION_REQUIRED") {
        setLoanStatus(loanCaseId, "DOCUMENT_COLLECTION", actor, "Checklist created");
    }
    return created;
}
/** Apply a configured preset. The officer can then edit individual items. */
function applyChecklistTemplate(loanCaseId, templateId, actor) {
    const loanCase = getCase(loanCaseId);
    if (!loanCase)
        return [];
    const template = (0, config_1.getConfig)(loanCase.orgId).checklistTemplates.find((t) => t.id === templateId);
    if (!template)
        return [];
    return addChecklistItems(loanCaseId, template.items, actor);
}
function updateChecklistItem(itemId, patch, actor) {
    const before = (0, db_1.read)().checklistItems.find((i) => i.id === itemId);
    if (!before)
        return null;
    const updated = (0, db_1.mutate)((db) => {
        const i = db.checklistItems.find((x) => x.id === itemId);
        if (!i)
            return null;
        Object.assign(i, patch, { updatedAt: new Date().toISOString() });
        return { ...i };
    });
    if (!updated)
        return null;
    (0, audit_1.audit)({
        orgId: updated.orgId,
        actorId: actor.id,
        actorType: actor.type,
        action: "checklist.item_updated",
        entity: "checklist_item",
        entityId: itemId,
        customerId: getCase(updated.loanCaseId)?.customerId,
        metadata: { from: before.status, to: updated.status, patch },
    });
    refreshCaseProgress(updated.loanCaseId, actor);
    return updated;
}
function removeChecklistItem(itemId, actor) {
    const item = (0, db_1.read)().checklistItems.find((i) => i.id === itemId);
    if (!item)
        return false;
    (0, db_1.mutate)((db) => void (db.checklistItems = db.checklistItems.filter((i) => i.id !== itemId)));
    (0, audit_1.audit)({
        orgId: item.orgId,
        actorId: actor.id,
        actorType: "human",
        action: "checklist.item_removed",
        entity: "checklist_item",
        entityId: itemId,
        metadata: { documentType: item.documentType },
    });
    refreshCaseProgress(item.loanCaseId, actor);
    return true;
}
/** Completion counts only *required* items — optional extras must not gate. */
function caseProgress(loanCaseId) {
    const items = checklistFor(loanCaseId);
    const required = items.filter((i) => i.required && i.status !== "NOT_REQUIRED");
    const accepted = required.filter((i) => i.status === "ACCEPTED");
    return {
        requiredTotal: required.length,
        requiredAccepted: accepted.length,
        completionPct: required.length ? Math.round((accepted.length / required.length) * 100) : 0,
        missing: required.filter((i) => ["NOT_REQUESTED", "REQUESTED"].includes(i.status)),
        rejected: items.filter((i) => i.status === "REJECTED"),
        awaitingReview: items.filter((i) => ["UPLOADED", "UNDER_REVIEW"].includes(i.status)),
        optionalOutstanding: items.filter((i) => !i.required && ["NOT_REQUESTED", "REQUESTED"].includes(i.status)),
        allReceived: required.length > 0 && required.every((i) => ["UPLOADED", "UNDER_REVIEW", "ACCEPTED"].includes(i.status)),
    };
}
/** Absolute link to the case for e-mail; relative when no public URL is set. */
function caseLink(loanCaseId) {
    const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
    return `${base}/ops/loans/${loanCaseId}`;
}
/**
 * Tell the assigned officer (or every officer) the case needs them: in-app
 * always, e-mail when configured. E-mail is fire-and-forget — the case state
 * never waits on a mail provider.
 */
function notifyOfficer(loanCase, opts) {
    (0, audit_1.notify)({
        orgId: loanCase.orgId,
        recipientId: loanCase.assignedOfficerId,
        recipientRole: loanCase.assignedOfficerId ? undefined : "LOAN_OFFICER",
        category: "LOAN",
        event: opts.event,
        title: opts.title,
        body: `${opts.body} ${caseLink(loanCase.id)}`,
        customerId: loanCase.customerId,
        severity: "INFO",
    });
    const db = (0, db_1.read)();
    const officer = db.teamMembers.find((m) => m.id === loanCase.assignedOfficerId);
    const customer = db.customers.find((c) => c.id === loanCase.customerId);
    void Promise.resolve().then(() => __importStar(require("../notify"))).then(({ emailConfigured, configuredRecipients, sendEmail }) => {
        if (!emailConfigured())
            return;
        const to = [...(officer?.email ? [officer.email] : []), ...configuredRecipients()];
        if (!to.length)
            return;
        return sendEmail({
            to,
            subject: `${opts.title} — ${customer?.name ?? "customer"}`,
            text: `${opts.body}\n\nCustomer: ${customer?.name ?? "Unknown"} ${customer?.phone ?? ""}\nOpen the case: ${caseLink(loanCase.id)}`,
        });
    })
        .catch((e) => console.warn(`[loan] officer e-mail failed: ${e.message}`));
}
/**
 * Recompute derived case state after any checklist change.
 *
 * Reaching 100% flips the case to READY_FOR_ANALYSIS and notifies the officer.
 * The AI is allowed to tell the customer their documents are all *received*; it
 * is never allowed to imply approval, which is a human decision.
 */
function refreshCaseProgress(loanCaseId, actor) {
    const progress = caseProgress(loanCaseId);
    const loanCase = getCase(loanCaseId);
    if (!loanCase)
        return progress;
    const terminal = ["APPROVED", "CONDITIONALLY_APPROVED", "REJECTED", "COMPLETED", "ON_HOLD"];
    if (terminal.includes(loanCase.status))
        return progress;
    const allAccepted = progress.requiredTotal > 0 && progress.requiredAccepted === progress.requiredTotal;
    if (allAccepted && !loanCase.allDocumentsAcceptedAt) {
        (0, db_1.mutate)((db) => {
            const l = db.loanCases.find((x) => x.id === loanCaseId);
            if (l) {
                l.allDocumentsAcceptedAt = new Date().toISOString();
                if (!l.readyForReviewAt)
                    l.readyForReviewAt = l.allDocumentsAcceptedAt;
            }
        });
        if (loanCase.status !== "READY_FOR_ANALYSIS")
            setLoanStatus(loanCaseId, "READY_FOR_ANALYSIS", actor, "All required documents accepted");
        notifyOfficer(getCase(loanCaseId) ?? loanCase, {
            event: "loan_case.documents_accepted",
            title: "All required documents accepted",
            body: `Case is complete (${progress.requiredAccepted}/${progress.requiredTotal}) and ready for analysis.`,
        });
    }
    else if (progress.allReceived) {
        // Every required file is in hand: the officer can start the analysis now.
        // "Received" is not "accepted" — the customer is told the former only.
        if (loanCase.status !== "READY_FOR_ANALYSIS") {
            setLoanStatus(loanCaseId, "READY_FOR_ANALYSIS", actor, "All required documents received");
            (0, db_1.mutate)((db) => {
                const l = db.loanCases.find((x) => x.id === loanCaseId);
                if (l && !l.readyForReviewAt)
                    l.readyForReviewAt = new Date().toISOString();
            });
            notifyOfficer(getCase(loanCaseId) ?? loanCase, {
                event: "loan_case.ready_for_analysis",
                title: "All documents received — ready for review",
                body: `Every required document (${progress.requiredTotal}) has been received; ${progress.awaitingReview.length} awaiting your review.`,
            });
        }
    }
    else if (progress.rejected.length > 0 && loanCase.status !== "DOCUMENTS_INCOMPLETE") {
        setLoanStatus(loanCaseId, "DOCUMENTS_INCOMPLETE", actor, "Documents rejected — replacements required");
    }
    else if (progress.awaitingReview.length > 0 && progress.missing.length === 0 && loanCase.status !== "UNDER_REVIEW") {
        setLoanStatus(loanCaseId, "UNDER_REVIEW", actor, "Documents awaiting officer review");
    }
    else if (progress.missing.length > 0 && loanCase.status !== "DOCUMENT_COLLECTION") {
        setLoanStatus(loanCaseId, "DOCUMENT_COLLECTION", actor, "Awaiting customer documents");
    }
    return progress;
}
/** Loan-officer dashboard aggregation. */
function loanWorkspace(orgId, officerId) {
    const db = (0, db_1.read)();
    const cases = db.loanCases.filter((l) => l.orgId === orgId && (!officerId || l.assignedOfficerId === officerId));
    const now = Date.now();
    const cfg = (0, config_1.getConfig)(orgId);
    const enriched = cases.map((l) => {
        const progress = caseProgress(l.id);
        const customer = db.customers.find((c) => c.id === l.customerId);
        const lastFollowUp = db.followUps
            .filter((f) => f.loanCaseId === l.id && f.lastSentAt)
            .sort((a, b) => (b.lastSentAt ?? "").localeCompare(a.lastSentAt ?? ""))[0];
        const nextFollowUp = db.followUps
            .filter((f) => f.loanCaseId === l.id && f.status === "SCHEDULED")
            .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
        const overdue = progress.awaitingReview.length > 0 &&
            now - new Date(l.updatedAt).getTime() > cfg.sla.documentReviewHours * 3600_000;
        return { loanCase: l, customer, progress, lastFollowUp, nextFollowUp, overdue, checklist: checklistFor(l.id) };
    });
    return {
        all: enriched,
        active: enriched.filter((e) => !["COMPLETED", "REJECTED"].includes(e.loanCase.status)),
        newCases: enriched.filter((e) => e.loanCase.status === "NOT_STARTED"),
        waitingForCustomer: enriched.filter((e) => e.progress.missing.length > 0 || e.progress.rejected.length > 0),
        awaitingReview: enriched.filter((e) => e.progress.awaitingReview.length > 0),
        readyForAnalysis: enriched.filter((e) => e.loanCase.status === "READY_FOR_ANALYSIS"),
        overdue: enriched.filter((e) => e.overdue),
    };
}
