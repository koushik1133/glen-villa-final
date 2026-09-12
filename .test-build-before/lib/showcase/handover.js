"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSACTION_LABEL = exports.HANDOVER_STAGE_DESCRIPTION = exports.HANDOVER_STAGE_DEPARTMENT = exports.HANDOVER_STAGE_LABEL = exports.HANDOVER_STAGES = void 0;
exports.isHandoverStage = isHandoverStage;
exports.stageAllowedForStatus = stageAllowedForStatus;
exports.paymentPosition = paymentPosition;
/** Display order — also the rough chronological order of a clean sale. */
exports.HANDOVER_STAGES = [
    "not_started",
    "booking",
    "agreement",
    "home_loan",
    "payments",
    "registration",
    "snagging",
    "handover",
    "closed",
    "on_hold",
    "cancelled",
];
exports.HANDOVER_STAGE_LABEL = {
    not_started: "Not started",
    booking: "Booking",
    agreement: "Agreement",
    home_loan: "Home loan",
    payments: "Payments",
    registration: "Registration",
    snagging: "Snagging",
    handover: "Handover",
    closed: "Closed",
    on_hold: "On hold",
    cancelled: "Cancelled",
};
/**
 * Which desk owns the unit at this stage. `null` means nobody does — that is
 * information too, and it is why this is a map and not a lookup that throws.
 */
exports.HANDOVER_STAGE_DEPARTMENT = {
    not_started: null,
    booking: "Sales",
    agreement: "Legal & documentation",
    home_loan: "Loan desk",
    payments: "Accounts",
    registration: "Legal & documentation",
    snagging: "Construction",
    handover: "Customer care",
    closed: null,
    on_hold: null,
    cancelled: null,
};
exports.HANDOVER_STAGE_DESCRIPTION = {
    not_started: "Not sold yet",
    booking: "Token received, unit blocked",
    agreement: "Agreement of Sale drafted, stamped, signed",
    home_loan: "Application, sanction and disbursement",
    payments: "Construction-linked instalments running",
    registration: "Sale deed registered at the Sub-Registrar",
    snagging: "Punch list and rectification",
    handover: "Possession, keys and documents",
    closed: "Handed over, with the owners' association",
    on_hold: "Paused",
    cancelled: "Booking cancelled or refunded",
};
function isHandoverStage(value) {
    return typeof value === "string" && exports.HANDOVER_STAGES.includes(value);
}
/**
 * Stages that may only be set on a unit that is actually committed.
 *
 * A villa sitting in "registration" while its sale status still reads
 * "available" is not a harmless inconsistency: the public master plan paints
 * that villa green and a walk-in customer is told they can buy a villa that has
 * already been registered to somebody else.
 */
const NEEDS_COMMITTED_SALE = [
    "agreement",
    "home_loan",
    "payments",
    "registration",
    "snagging",
    "handover",
    "closed",
];
/** `true` when this stage is legal for a unit whose sale status is `status`. */
function stageAllowedForStatus(stage, status) {
    if (!NEEDS_COMMITTED_SALE.includes(stage))
        return true;
    return status === "deal_pending" || status === "sold";
}
/* ------------------------------------------------------------- payment state */
/** One line of the ladder, in the order money is normally collected. */
const MILESTONE_ORDER = [
    "booking_token",
    "agreement",
    "installment",
    "registration",
    "final_payment",
];
exports.TRANSACTION_LABEL = {
    booking_token: "Booking token",
    agreement: "Agreement payment",
    installment: "Instalment",
    registration: "Registration",
    final_payment: "Final payment",
};
function normalise(value) {
    return value.trim().toLowerCase();
}
/**
 * READ-ONLY BY DESIGN.
 *
 * Every figure here is summed from the `Transaction[]` on the linked contact —
 * the receipts accounts actually recorded. There is deliberately no setter and
 * no dropdown for "payment state": money that was never receipted must never be
 * displayable as collected, because that number is what a salesperson quotes to
 * a customer and what a manager reports upward. If the position looks wrong, the
 * fix is a transaction in the ledger, not an edit on the villa panel.
 *
 * Returns `null` when there is nothing to report, so the caller can say "no
 * payment record linked yet" instead of printing zeros — zeros read as
 * "nothing owed", which is a different and much more dangerous claim.
 */
function paymentPosition(transactions, project, unitNumber) {
    if (!transactions?.length)
        return null;
    const mine = transactions.filter((t) => normalise(t.project) === normalise(project) && normalise(t.unit) === normalise(unitNumber));
    if (!mine.length)
        return null;
    let paid = 0;
    let pending = 0;
    let overdue = 0;
    for (const t of mine) {
        if (t.status === "paid")
            paid += t.amount;
        else if (t.status === "overdue")
            overdue += t.amount;
        else
            pending += t.amount;
    }
    const unpaid = mine
        .filter((t) => t.status !== "paid")
        .sort((a, b) => {
        const byDate = a.date.localeCompare(b.date);
        if (byDate !== 0)
            return byDate;
        return MILESTONE_ORDER.indexOf(a.type) - MILESTONE_ORDER.indexOf(b.type);
    });
    const head = unpaid[0];
    return {
        count: mine.length,
        paid,
        pending,
        overdue,
        next: head
            ? {
                type: head.type,
                label: exports.TRANSACTION_LABEL[head.type] ?? head.type,
                amount: head.amount,
                date: head.date,
                status: head.status === "overdue" ? "overdue" : "pending",
            }
            : null,
    };
}
