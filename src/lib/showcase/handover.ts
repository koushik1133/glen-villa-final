import type { Transaction } from "../crm/types";

/**
 * POST-BOOKING LIFECYCLE OF AN INDIAN RESIDENTIAL VILLA SALE
 *
 * A unit's `UnitStatus` answers "can I still buy this one?". It deliberately
 * stops at "sold" — but for the buyer and for the developer, "sold" is where the
 * real work starts. Between the booking token and the day the keys change hands
 * a villa passes through the agreement of sale, the buyer's home loan, the
 * construction-linked instalment plan, registration at the Sub-Registrar, the
 * snag list and finally possession. Each of those sits with a *different desk*,
 * and the question the sales floor actually gets asked is "which department has
 * villa 42 right now?".
 *
 * So every stage below carries the department that owns it. The department
 * names deliberately mirror the app's own roles (sales, the loan desk, accounts,
 * construction, customer care) rather than inventing a parallel vocabulary — if
 * the panel says "Loan desk" the reader already knows whose queue to look in.
 *
 * `on_hold` and `cancelled` are terminal-ish states owned by nobody: they are
 * the honest answer when a booking stalls, instead of leaving a stage that
 * implies someone is working on it.
 *
 * Money is NOT part of this vocabulary. See `paymentPosition()` at the bottom of
 * this file for why the payment state is derived, never chosen.
 */
export type HandoverStage =
  | "not_started"
  | "booking"
  | "agreement"
  | "home_loan"
  | "payments"
  | "registration"
  | "snagging"
  | "handover"
  | "closed"
  | "on_hold"
  | "cancelled";

/** Display order — also the rough chronological order of a clean sale. */
export const HANDOVER_STAGES: HandoverStage[] = [
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

export const HANDOVER_STAGE_LABEL: Record<HandoverStage, string> = {
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
export const HANDOVER_STAGE_DEPARTMENT: Record<HandoverStage, string | null> = {
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

export const HANDOVER_STAGE_DESCRIPTION: Record<HandoverStage, string> = {
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

export function isHandoverStage(value: unknown): value is HandoverStage {
  return typeof value === "string" && (HANDOVER_STAGES as string[]).includes(value);
}

/**
 * Stages that may only be set on a unit that is actually committed.
 *
 * A villa sitting in "registration" while its sale status still reads
 * "available" is not a harmless inconsistency: the public master plan paints
 * that villa green and a walk-in customer is told they can buy a villa that has
 * already been registered to somebody else.
 */
const NEEDS_COMMITTED_SALE: HandoverStage[] = [
  "agreement",
  "home_loan",
  "payments",
  "registration",
  "snagging",
  "handover",
  "closed",
];

/** `true` when this stage is legal for a unit whose sale status is `status`. */
export function stageAllowedForStatus(stage: HandoverStage, status: string): boolean {
  if (!NEEDS_COMMITTED_SALE.includes(stage)) return true;
  return status === "deal_pending" || status === "sold";
}

/* ------------------------------------------------------------- payment state */

/** One line of the ladder, in the order money is normally collected. */
const MILESTONE_ORDER: Transaction["type"][] = [
  "booking_token",
  "agreement",
  "installment",
  "registration",
  "final_payment",
];

export const TRANSACTION_LABEL: Record<Transaction["type"], string> = {
  booking_token: "Booking token",
  agreement: "Agreement payment",
  installment: "Instalment",
  registration: "Registration",
  final_payment: "Final payment",
};

export interface PaymentPosition {
  /** How many transactions were actually found for this project + unit. */
  count: number;
  paid: number;
  pending: number;
  overdue: number;
  /** Earliest unpaid line — what the buyer owes next. */
  next: { type: Transaction["type"]; label: string; amount: number; date: string; status: "pending" | "overdue" } | null;
}

function normalise(value: string): string {
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
export function paymentPosition(
  transactions: Transaction[] | undefined,
  project: string,
  unitNumber: string,
): PaymentPosition | null {
  if (!transactions?.length) return null;
  const mine = transactions.filter(
    (t) => normalise(t.project) === normalise(project) && normalise(t.unit) === normalise(unitNumber),
  );
  if (!mine.length) return null;

  let paid = 0;
  let pending = 0;
  let overdue = 0;
  for (const t of mine) {
    if (t.status === "paid") paid += t.amount;
    else if (t.status === "overdue") overdue += t.amount;
    else pending += t.amount;
  }

  const unpaid = mine
    .filter((t) => t.status !== "paid")
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
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
          label: TRANSACTION_LABEL[head.type] ?? head.type,
          amount: head.amount,
          date: head.date,
          status: head.status === "overdue" ? "overdue" : "pending",
        }
      : null,
  };
}
