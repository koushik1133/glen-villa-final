import assert from "node:assert/strict";
import test, { after, before, beforeEach, describe } from "node:test";
import { cleanup, isolate } from "./helpers";

const dir = isolate("showcase-handover");
after(() => cleanup(dir));

/* Imports must follow isolate() so the store points at the temp directory. */
const { read, mutate, resetToBootstrap } = require("../src/lib/db") as typeof import("../src/lib/db");
const {
  ensureInventorySeed,
  getUnit,
  setUnitStatus,
  leadStatusForUnitStatus,
  unitId,
  InventoryError,
} = require("../src/lib/showcase/inventory") as typeof import("../src/lib/showcase/inventory");
const {
  paymentPosition,
  stageAllowedForStatus,
  HANDOVER_STAGES,
  HANDOVER_STAGE_DEPARTMENT,
} = require("../src/lib/showcase/handover") as typeof import("../src/lib/showcase/handover");
import type { LeadStatus, Transaction } from "../src/lib/crm/types";

let BRAND = "";
let UNIT = "";
let UNIT_NUMBER = "";

before(() => {
  resetToBootstrap();
  BRAND = read().brands[0].id;
  ensureInventorySeed(BRAND);
  const villa = read().inventoryUnits.find((u) => u.brandId === BRAND && u.project === "serenity");
  assert.ok(villa, "the serenity seed must produce at least one villa");
  UNIT = villa.id;
  UNIT_NUMBER = villa.unitNumber;
});

/**
 * Every case starts from a known unit. The suite deliberately rewrites the unit
 * in place rather than seeding a second one: the guard rails under test are all
 * about the relationship between a unit's own fields, so sharing one record is
 * the shortest way to be sure no test is passing on stale neighbouring data.
 */
function resetUnit(patch: Record<string, unknown> = {}): void {
  mutate((d) => {
    const u = d.inventoryUnits.find((x) => x.id === UNIT)!;
    u.status = "available";
    u.leadId = undefined;
    u.customerId = undefined;
    u.assignedTo = undefined;
    u.handoverStage = undefined;
    Object.assign(u, patch);
    d.leads = [];
    d.crmContacts = [];
  });
}

beforeEach(() => resetUnit());

function seedLead(id: string, status: LeadStatus, assignedTo = "Sales Manager 1"): void {
  const now = new Date().toISOString();
  mutate((d) => {
    d.leads.push({
      id,
      brandId: BRAND,
      name: "Test Buyer",
      phone: "+919000000000",
      city: "Hyderabad",
      status,
      budgetMin: 10000000,
      budgetMax: 30000000,
      source: "referral",
      projectInterest: "serenity",
      unitType: "villa",
      assignedTo,
      score: 50,
      isHNWI: false,
      kycStatus: "not_started",
      createdAt: now,
      updatedAt: now,
      tags: [],
    });
  });
}

function leadStatus(id: string): LeadStatus {
  return read().leads.find((l) => l.id === id)!.status;
}

function txn(patch: Partial<Transaction>): Transaction {
  return {
    id: `txn_${Math.random().toString(36).slice(2)}`,
    contactId: "cust_1",
    project: "serenity",
    unit: UNIT_NUMBER,
    type: "installment",
    amount: 100000,
    date: "2026-01-01",
    status: "pending",
    mode: "neft",
    reference: "REF",
    ...patch,
  };
}

function seedContact(transactions: Transaction[]): string {
  const id = "cust_1";
  mutate((d) => {
    d.crmContacts.push({
      id,
      brandId: BRAND,
      name: "Test Buyer",
      phone: "+919000000000",
      city: "Hyderabad",
      type: "customer",
      hnwiTier: "none",
      kycStatus: "verified",
      kycDocs: [],
      occupation: "Business",
      preferredLanguage: "English",
      relationshipManager: "Sales Manager 1",
      lifetimeValue: 0,
      tags: [],
      createdAt: new Date().toISOString(),
      transactions,
    });
  });
  return id;
}

/* -------------------------------------------------------------------------- */

describe("handover vocabulary", () => {
  test("every stage has a department entry, including the ones owned by nobody", () => {
    for (const s of HANDOVER_STAGES) {
      assert.ok(s in HANDOVER_STAGE_DEPARTMENT);
    }
    assert.equal(HANDOVER_STAGE_DEPARTMENT.booking, "Sales");
    assert.equal(HANDOVER_STAGE_DEPARTMENT.home_loan, "Loan desk");
    assert.equal(HANDOVER_STAGE_DEPARTMENT.payments, "Accounts");
    assert.equal(HANDOVER_STAGE_DEPARTMENT.snagging, "Construction");
    assert.equal(HANDOVER_STAGE_DEPARTMENT.handover, "Customer care");
    assert.equal(HANDOVER_STAGE_DEPARTMENT.not_started, null);
    assert.equal(HANDOVER_STAGE_DEPARTMENT.cancelled, null);
  });

  test("stages past booking are refused for an uncommitted unit", () => {
    assert.equal(stageAllowedForStatus("booking", "available"), true);
    assert.equal(stageAllowedForStatus("on_hold", "available"), true);
    assert.equal(stageAllowedForStatus("registration", "available"), false);
    assert.equal(stageAllowedForStatus("registration", "deal_pending"), true);
    assert.equal(stageAllowedForStatus("handover", "sold"), true);
  });
});

describe("the stage guard rail", () => {
  test("a villa still marked available cannot enter registration", () => {
    assert.throws(
      () => setUnitStatus(UNIT, null, "tester", { handoverStage: "registration" }),
      (e: unknown) => e instanceof InventoryError,
    );
    assert.equal(getUnit(UNIT)!.handoverStage, undefined);
  });

  test("booking and on_hold are allowed at any sale status", () => {
    setUnitStatus(UNIT, null, "tester", { handoverStage: "booking" });
    assert.equal(getUnit(UNIT)!.handoverStage, "booking");
  });

  test("a sold unit may go all the way to handover", () => {
    resetUnit({ status: "sold", customerId: "cust_1" });
    setUnitStatus(UNIT, null, "tester", { handoverStage: "handover" });
    assert.equal(getUnit(UNIT)!.handoverStage, "handover");
  });

  test("override is the manager's escape hatch", () => {
    setUnitStatus(UNIT, null, "tester", { handoverStage: "snagging", override: true });
    assert.equal(getUnit(UNIT)!.handoverStage, "snagging");
  });

  test("an unknown stage is rejected", () => {
    assert.throws(
      () => setUnitStatus(UNIT, null, "tester", { handoverStage: "keys_posted" as never }),
      (e: unknown) => e instanceof InventoryError,
    );
  });

  test("the sold-needs-a-customer rule still holds", () => {
    assert.throws(
      () => setUnitStatus(UNIT, "sold", "tester"),
      (e: unknown) => e instanceof InventoryError,
    );
  });
});

describe("editing without restating the sale status", () => {
  test("an owner change leaves the status alone", () => {
    resetUnit({ status: "enquiry" });
    const u = setUnitStatus(UNIT, null, "tester", { assignedTo: "Sales Manager 2" });
    assert.equal(u.assignedTo, "Sales Manager 2");
    assert.equal(u.status, "enquiry");
  });

  test("a stage change leaves the status alone", () => {
    resetUnit({ status: "deal_pending", leadId: "lead_x" });
    seedLead("lead_x", "negotiation");
    const u = setUnitStatus(UNIT, null, "tester", { handoverStage: "agreement" });
    assert.equal(u.handoverStage, "agreement");
    assert.equal(u.status, "deal_pending");
  });

  test("clearing the owner sets it back to unassigned", () => {
    setUnitStatus(UNIT, null, "tester", { assignedTo: "Sales Manager 2" });
    const u = setUnitStatus(UNIT, null, "tester", { assignedTo: "" });
    assert.equal(u.assignedTo, undefined);
  });
});

describe("lead synchronisation", () => {
  test("the mapping moves a lead forward only", () => {
    assert.equal(leadStatusForUnitStatus("sold", "negotiation"), "won");
    assert.equal(leadStatusForUnitStatus("deal_pending", "contacted"), "booking_token_paid");
    assert.equal(leadStatusForUnitStatus("enquiry", "new"), "contacted");
  });

  test("the mapping never moves a lead backwards", () => {
    assert.equal(leadStatusForUnitStatus("enquiry", "won"), null);
    assert.equal(leadStatusForUnitStatus("enquiry", "negotiation"), null);
    assert.equal(leadStatusForUnitStatus("deal_pending", "won"), null);
    assert.equal(leadStatusForUnitStatus("deal_pending", "booking_token_paid"), null);
  });

  test("the mapping never touches a lost lead", () => {
    for (const s of ["sold", "deal_pending", "enquiry"] as const) {
      assert.equal(leadStatusForUnitStatus(s, "lost"), null);
    }
  });

  test("statuses with no CRM meaning leave the lead alone", () => {
    assert.equal(leadStatusForUnitStatus("available", "new"), null);
    assert.equal(leadStatusForUnitStatus("blocked", "new"), null);
    assert.equal(leadStatusForUnitStatus("no_leads", "new"), null);
  });

  test("selling a unit wins its linked lead in the same write", () => {
    resetUnit({ leadId: "lead_a", customerId: "cust_1" });
    seedLead("lead_a", "negotiation");
    setUnitStatus(UNIT, "sold", "tester");
    assert.equal(leadStatus("lead_a"), "won");
    assert.ok(read().leads[0].wonAt);
  });

  test("a won lead is not dragged back by a later enquiry", () => {
    resetUnit({ leadId: "lead_b" });
    seedLead("lead_b", "won");
    setUnitStatus(UNIT, "enquiry", "tester");
    assert.equal(leadStatus("lead_b"), "won");
  });

  test("a lost lead is left exactly as it is", () => {
    resetUnit({ leadId: "lead_c", customerId: "cust_1" });
    seedLead("lead_c", "lost");
    setUnitStatus(UNIT, "sold", "tester");
    assert.equal(leadStatus("lead_c"), "lost");
  });

  test("a unit with no lead simply does not sync", () => {
    seedLead("lead_d", "new");
    setUnitStatus(UNIT, "enquiry", "tester");
    assert.equal(leadStatus("lead_d"), "new");
  });

  test("the owner is mirrored onto the linked lead", () => {
    resetUnit({ leadId: "lead_e" });
    seedLead("lead_e", "new", "Sales Manager 1");
    setUnitStatus(UNIT, null, "tester", { assignedTo: "Sales Manager 3" });
    assert.equal(read().leads.find((l) => l.id === "lead_e")!.assignedTo, "Sales Manager 3");
  });
});

describe("payment position is derived, never stored", () => {
  test("no linked customer means no figures at all", () => {
    assert.equal(paymentPosition(undefined, "serenity", UNIT_NUMBER), null);
    assert.equal(paymentPosition([], "serenity", UNIT_NUMBER), null);
  });

  test("a contact with transactions for other units reports nothing for this one", () => {
    const t = [txn({ unit: "999", status: "paid" })];
    assert.equal(paymentPosition(t, "serenity", UNIT_NUMBER), null);
    assert.equal(paymentPosition(t, "onyx", "999"), null);
  });

  test("totals are summed from the transactions, not read off the unit", () => {
    const rows = [
      txn({ type: "booking_token", amount: 500000, status: "paid", date: "2025-01-10" }),
      txn({ type: "agreement", amount: 2000000, status: "paid", date: "2025-02-10" }),
      txn({ type: "installment", amount: 1500000, status: "overdue", date: "2025-06-10" }),
      txn({ type: "registration", amount: 900000, status: "pending", date: "2025-09-10" }),
    ];
    seedContact(rows);
    const pos = paymentPosition(read().crmContacts[0].transactions, "serenity", UNIT_NUMBER)!;
    assert.equal(pos.count, 4);
    assert.equal(pos.paid, 2500000);
    assert.equal(pos.overdue, 1500000);
    assert.equal(pos.pending, 900000);
    // The next unpaid milestone is the earliest one, with its own label.
    assert.equal(pos.next!.type, "installment");
    assert.equal(pos.next!.label, "Instalment");
    assert.equal(pos.next!.status, "overdue");
    assert.equal(pos.next!.date, "2025-06-10");

    // Nothing about the money is persisted on the unit — a later read derives
    // the same answer from the ledger, and the unit record stays free of it.
    const stored = getUnit(UNIT)! as unknown as Record<string, unknown>;
    assert.equal(stored.paid, undefined);
    assert.equal(stored.payments, undefined);
    assert.equal(stored.paymentStatus, undefined);
  });

  test("a fully paid ladder has no next milestone", () => {
    const rows = [txn({ type: "final_payment", amount: 100, status: "paid" })];
    const pos = paymentPosition(rows, "SERENITY", UNIT_NUMBER)!;
    assert.equal(pos.next, null);
    assert.equal(pos.paid, 100);
  });

  test("changing the handover stage does not change any figure", () => {
    const rows = [txn({ amount: 777, status: "pending" })];
    seedContact(rows);
    const before = paymentPosition(rows, "serenity", UNIT_NUMBER)!;
    mutate((d) => {
      const u = d.inventoryUnits.find((x) => x.id === UNIT)!;
      u.status = "sold";
      u.customerId = "cust_1";
    });
    setUnitStatus(UNIT, null, "tester", { handoverStage: "registration" });
    const after_ = paymentPosition(read().crmContacts[0].transactions, "serenity", UNIT_NUMBER)!;
    assert.deepEqual(after_, before);
  });
});
