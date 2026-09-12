"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.receiveDocument = receiveDocument;
exports.reviewDocument = reviewDocument;
exports.documentsFor = documentsFor;
exports.documentTimeline = documentTimeline;
exports.recordDownload = recordDownload;
const db_1 = require("../db");
const ids_1 = require("../ids");
const audit_1 = require("./audit");
const loan_1 = require("./loan");
const storage_1 = require("./storage");
/**
 * DOCUMENT LIFECYCLE
 *
 * received → under review → accepted | rejected → (replacement) → …
 *
 * The hard rule this module enforces: **only a human review sets ACCEPTED.**
 * Receiving a file marks it UPLOADED and nothing more. The assistant may say
 * "received"; it may not say "accepted", because until an officer looks at it,
 * nobody knows whether the photo is legible or the statement is the right month.
 */
function event(e) {
    const ev = { ...e, id: (0, ids_1.uid)("dev"), createdAt: new Date().toISOString() };
    (0, db_1.mutate)((db) => void db.documentEvents.push(ev));
    return ev;
}
/**
 * Store an inbound document and link it to a checklist item.
 *
 * Deduplicates by content hash within a customer: WhatsApp redelivers media on
 * webhook retries, and a duplicate must not appear as a second submission or
 * reset a review that already happened.
 */
async function receiveDocument(input) {
    const db = (0, db_1.read)();
    const item = input.checklistItemId ? db.checklistItems.find((i) => i.id === input.checklistItemId) : undefined;
    const invalid = (0, storage_1.validateUpload)(input.mimeType, input.data.byteLength, item?.acceptedFormats);
    if (invalid)
        return { ok: false, error: invalid };
    const hash = (0, storage_1.sha256)(input.data);
    const duplicate = db.documents.find((d) => d.customerId === input.customerId && d.sha256 === hash);
    if (duplicate) {
        event({
            orgId: input.orgId,
            documentId: duplicate.id,
            event: "RECEIVED",
            actorType: input.uploadedBy === "customer" ? "customer" : "human",
            actorId: input.uploadedById,
            detail: "Duplicate of an already-received file — ignored",
        });
        return { ok: true, document: duplicate, duplicate: true, checklistItemId: duplicate.checklistItemId };
    }
    const documentId = (0, ids_1.uid)("doc");
    const storageKey = (0, storage_1.buildStorageKey)(input.customerId, documentId, input.filename);
    let stored;
    try {
        stored = await (0, storage_1.documentStore)().put(storageKey, input.data);
    }
    catch (e) {
        // Never record a document row for a file that is not actually stored.
        return { ok: false, error: `Storage failed: ${e.message}` };
    }
    const loanCaseId = input.loanCaseId ?? item?.loanCaseId;
    const record = {
        id: documentId,
        orgId: input.orgId,
        customerId: input.customerId,
        loanCaseId,
        checklistItemId: input.checklistItemId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.key,
        sha256: stored.sha256,
        uploadedBy: input.uploadedBy,
        uploadedById: input.uploadedById,
        status: "RECEIVED",
        createdAt: new Date().toISOString(),
    };
    (0, db_1.mutate)((db2) => void db2.documents.push(record));
    event({
        orgId: input.orgId,
        documentId,
        event: "RECEIVED",
        actorType: input.uploadedBy === "customer" ? "customer" : "human",
        actorId: input.uploadedById,
        detail: `${input.filename} (${Math.round(stored.sizeBytes / 1024)}KB)`,
    });
    (0, audit_1.audit)({
        orgId: input.orgId,
        actorId: input.uploadedById,
        actorType: input.uploadedBy === "customer" ? "customer" : "human",
        action: "document.received",
        entity: "document",
        entityId: documentId,
        customerId: input.customerId,
        metadata: { filename: input.filename, checklistItemId: input.checklistItemId, loanCaseId },
    });
    if (item) {
        // UPLOADED, not ACCEPTED. A human decides acceptance.
        (0, db_1.mutate)((db2) => {
            const i = db2.checklistItems.find((x) => x.id === item.id);
            if (i) {
                i.currentDocumentId = documentId;
                i.status = "UPLOADED";
                i.rejectionReason = undefined;
                i.updatedAt = new Date().toISOString();
            }
        });
        event({ orgId: input.orgId, documentId, event: "LINKED", actorType: "system", detail: item.documentType });
        const loanCase = loanCaseId ? (0, loan_1.getCase)(loanCaseId) : undefined;
        (0, audit_1.notify)({
            orgId: input.orgId,
            recipientId: loanCase?.assignedOfficerId,
            recipientRole: loanCase?.assignedOfficerId ? undefined : "LOAN_OFFICER",
            category: "LOAN",
            event: "document.uploaded",
            title: `Document received: ${item.customerLabel}`,
            body: "Waiting for review.",
            customerId: input.customerId,
            severity: "INFO",
        });
        if (loanCaseId)
            (0, loan_1.refreshCaseProgress)(loanCaseId, { type: "system" });
    }
    return { ok: true, document: record, duplicate: false, checklistItemId: input.checklistItemId };
}
/** Human review. This is the only path to ACCEPTED. */
function reviewDocument(documentId, decision, reviewer, rejectionReason) {
    const doc = (0, db_1.read)().documents.find((d) => d.id === documentId);
    if (!doc)
        return { ok: false, error: "Document not found" };
    if (decision === "REJECTED" && !rejectionReason?.trim()) {
        // A rejection without a reason is unactionable for the customer, and the
        // assistant would have nothing to tell them.
        return { ok: false, error: "A rejection reason is required" };
    }
    const now = new Date().toISOString();
    const updated = (0, db_1.mutate)((db) => {
        const d = db.documents.find((x) => x.id === documentId);
        if (!d)
            return null;
        d.status = decision;
        d.reviewedById = reviewer.id;
        d.reviewedAt = now;
        d.rejectionReason = decision === "REJECTED" ? rejectionReason : undefined;
        return { ...d };
    });
    if (!updated)
        return { ok: false, error: "Document not found" };
    event({
        orgId: updated.orgId,
        documentId,
        event: decision,
        actorType: "human",
        actorId: reviewer.id,
        detail: rejectionReason,
    });
    (0, audit_1.audit)({
        orgId: updated.orgId,
        actorId: reviewer.id,
        actorType: "human",
        action: decision === "ACCEPTED" ? "document.accepted" : "document.rejected",
        entity: "document",
        entityId: documentId,
        customerId: updated.customerId,
        metadata: { rejectionReason, checklistItemId: updated.checklistItemId },
    });
    if (updated.checklistItemId) {
        (0, loan_1.updateChecklistItem)(updated.checklistItemId, decision === "ACCEPTED"
            ? { status: "ACCEPTED", rejectionReason: undefined }
            : { status: "REJECTED", rejectionReason }, { id: reviewer.id, type: "human" });
    }
    return { ok: true, document: updated };
}
function documentsFor(customerId) {
    return (0, db_1.read)()
        .documents.filter((d) => d.customerId === customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function documentTimeline(documentId) {
    return (0, db_1.read)()
        .documentEvents.filter((e) => e.documentId === documentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function recordDownload(documentId, memberId, orgId) {
    event({ orgId, documentId, event: "DOWNLOADED", actorType: "human", actorId: memberId });
    (0, audit_1.audit)({
        orgId,
        actorId: memberId,
        actorType: "human",
        action: "document.downloaded",
        entity: "document",
        entityId: documentId,
        metadata: {},
    });
}
