"use strict";
/**
 * OPERATIONS DOMAIN — customer lifecycle, sales handoff, loan processing.
 *
 * Extends the existing CRM rather than replacing it. Relationships:
 *
 *   Customer (canonical profile, one per phone number)
 *     ├── Lead            (existing crm/types.ts — now carries customerId)
 *     ├── CrmContact      (existing — now carries customerId)
 *     ├── OpsMessage[]    (WhatsApp thread, both directions)
 *     ├── SentimentEvent[]
 *     ├── ScoreEvent[]
 *     ├── SalesTask[]
 *     ├── LoanCase        (0..1 active)
 *     │     └── ChecklistItem[] ── DocumentRecord[] ── DocumentEvent[]
 *     ├── FollowUp[]
 *     └── AuditEvent[]
 *
 * Workflow state lives in relational fields with explicit enums, never inside
 * JSON blobs — JSON is reserved for genuinely open-ended metadata. That is what
 * makes the state machine queryable and the audit trail trustworthy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_OPS = exports.CHECKLIST_ITEM_STATUSES = exports.LOAN_STATUSES = exports.ASSIGNMENT_STRATEGIES = exports.PERMISSIONS = exports.ROLES = exports.LEAD_STAGES = exports.SENTIMENT_VALUE = exports.BUYING_READINESS = exports.ENGAGEMENT = exports.URGENCY = exports.INTENTS = exports.SENTIMENTS = void 0;
/* -------------------------------------------------------------------------- */
/* Controlled vocabularies                                                     */
/* -------------------------------------------------------------------------- */
/**
 * Sentiment is a closed enum, not free-form model output. An LLM asked for "a
 * sentiment label" returns a different string every time, which makes trends,
 * filters and thresholds impossible to compute.
 */
exports.SENTIMENTS = [
    "VERY_POSITIVE",
    "POSITIVE",
    "NEUTRAL",
    "UNCERTAIN",
    "NEGATIVE",
    "VERY_NEGATIVE",
];
exports.INTENTS = [
    "INFORMATIONAL",
    "EXPLORING",
    "INTERESTED",
    "HIGH_INTENT",
    "READY_TO_PROCEED",
    "PRICE_CONCERN",
    "FINANCING_CONCERN",
    "DOCUMENT_DELAY",
    "HUMAN_HELP_REQUIRED",
    "NOT_INTERESTED",
];
exports.URGENCY = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
exports.ENGAGEMENT = ["NONE", "LOW", "MODERATE", "HIGH"];
exports.BUYING_READINESS = [
    "UNKNOWN",
    "RESEARCHING",
    "COMPARING",
    "DECIDING",
    "READY",
    "STALLED",
];
/** Ordinal value used for trend maths. Never persisted — derived on demand. */
exports.SENTIMENT_VALUE = {
    VERY_NEGATIVE: -2,
    NEGATIVE: -1,
    UNCERTAIN: -0.5,
    NEUTRAL: 0,
    POSITIVE: 1,
    VERY_POSITIVE: 2,
};
exports.LEAD_STAGES = [
    "NEW",
    "QUALIFYING",
    "QUALIFIED",
    "SALES_CALL",
    "FINANCING_REQUIRED",
    "LOAN_CASE",
    "DOCUMENT_COLLECTION",
    "DOCUMENT_REVIEW",
    "READY_FOR_ANALYSIS",
    "DECISION",
    "COMPLETED",
    "LOST",
];
/* -------------------------------------------------------------------------- */
/* Identity & access                                                           */
/* -------------------------------------------------------------------------- */
exports.ROLES = ["ADMIN", "SALES_MANAGER", "LOAN_OFFICER"];
/**
 * Permissions are coarse capabilities, checked server-side on every ops route.
 * Sales deliberately cannot read loan documents: those are financial records
 * belonging to a different department, and "everyone can see everything" is not
 * an acceptable default for a system holding PAN cards and bank statements.
 */
exports.PERMISSIONS = [
    "customer:read",
    "customer:write",
    "sales:read",
    "sales:write",
    "loan:read",
    "loan:write",
    "document:read",
    // `document:download` was removed rather than left listed: it translated to
    // the same database permission as `document:read`, so every check on it
    // passed automatically. A capability name that cannot deny anything invites
    // the next handler to "gate" on it too.
    "document:review",
    "admin:read",
    "admin:write",
    "config:write",
    "audit:read",
];
exports.ASSIGNMENT_STRATEGIES = ["ROUND_ROBIN", "LEAST_LOADED", "MANUAL", "TEAM_QUEUE"];
/* -------------------------------------------------------------------------- */
/* Loan                                                                        */
/* -------------------------------------------------------------------------- */
exports.LOAN_STATUSES = [
    "NOT_STARTED",
    "INFORMATION_REQUIRED",
    "DOCUMENT_COLLECTION",
    "UNDER_REVIEW",
    "DOCUMENTS_INCOMPLETE",
    "READY_FOR_ANALYSIS",
    "APPROVED",
    "CONDITIONALLY_APPROVED",
    "REJECTED",
    "COMPLETED",
    "ON_HOLD",
];
exports.CHECKLIST_ITEM_STATUSES = [
    "NOT_REQUESTED",
    "REQUESTED",
    "UPLOADED",
    "UNDER_REVIEW",
    "ACCEPTED",
    "REJECTED",
    "NOT_REQUIRED",
];
exports.EMPTY_OPS = {
    teamMembers: [],
    customers: [],
    opsMessages: [],
    sentimentEvents: [],
    conversationInsights: [],
    scoreEvents: [],
    salesTasks: [],
    assignments: [],
    loanCases: [],
    checklistItems: [],
    documents: [],
    documentEvents: [],
    followUps: [],
    escalations: [],
    opsNotifications: [],
    auditEvents: [],
    workflowConfigs: [],
    loanRules: [],
    kbEntries: [],
    kbGaps: [],
};
