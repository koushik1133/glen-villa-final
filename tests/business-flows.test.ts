import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { cleanup, isolate, samplePdf, seedTeam } from "./helpers";

/**
 * THE BUSINESS FLOWS, END TO END
 *
 * The other suites each prove one module. This one walks the chains a customer
 * and a sales desk actually traverse — enquiry to owned lead, chat to booked
 * visit, "I need a loan" to a case an officer can review, draft to queue —
 * and asserts the joins between the modules, which is where the seams are.
 *
 * Everything runs on the isolated store with the stub WhatsApp transport and
 * the mock publish driver: no network, nothing sent, nothing published.
 */
const dir = isolate("business-flows");
after(() => cleanup(dir));

const { read, mutate, resetToBootstrap } = require("../src/lib/db") as typeof import("../src/lib/db");
const { ensureOpsSeed, defaultOrgId } = require("../src/lib/ops/seed") as typeof import("../src/lib/ops/seed");
const { handleInbound, runFollowUpTick } = require("../src/lib/ops/agent") as typeof import("../src/lib/ops/agent");
const { salesWorkspace } = require("../src/lib/ops/sales") as typeof import("../src/lib/ops/sales");
const { getCustomer } = require("../src/lib/ops/customers") as typeof import("../src/lib/ops/customers");
const { getConfig, updateConfig } = require("../src/lib/ops/config") as typeof import("../src/lib/ops/config");
const { activeCase, caseProgress, checklistFor, getCase } = require("../src/lib/ops/loan") as typeof import("../src/lib/ops/loan");
const { reviewDocument } = require("../src/lib/ops/documents") as typeof import("../src/lib/ops/documents");
const { notifyDocumentDecision } = require("../src/lib/ops/agent") as typeof import("../src/lib/ops/agent");
const { book, slots, transition } = require("../src/lib/appointments/engine") as typeof import("../src/lib/appointments/engine");
const { sendDueReminders } = require("../src/lib/notify/reminders") as typeof import("../src/lib/notify/reminders");
const inv = require("../src/lib/showcase/inventory") as typeof import("../src/lib/showcase/inventory");
const { runTick } = require("../src/lib/engine/publisher") as typeof import("../src/lib/engine/publisher");
const { adapterFor, isUsableConnection } = require("../src/lib/platforms/registry") as typeof import("../src/lib/platforms/registry");

let ORG = "";
let BRAND = "";
before(() => {
  resetToBootstrap();
  ORG = defaultOrgId();
  ensureOpsSeed(ORG);
  seedTeam(ORG);
  BRAND = read().brands[0].id;
  mutate((d) => { d.brands[0].offerings = ["3BHK garden villas", "4BHK lake-view villas"]; });
  // Quiet hours off: what is under test is the flow, not the hour the suite runs.
  updateConfig(ORG, { messaging: { ...getConfig(ORG).messaging, quietHoursStart: 0, quietHoursEnd: 0, maxAutomatedPerDay: 50 } });
});

let seq = 0;
const wamid = () => `wamid.FLOW${++seq}`;
const outbound = (customerId: string) =>
  read().opsMessages.filter((m) => m.customerId === customerId && m.direction === "outbound").sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** The engine notifies fire-and-forget; wait for the log to catch up. */
async function logged(entityId: string, event: string, tries = 50): Promise<number> {
  for (let i = 0; i < tries; i++) {
    const n = (read().notificationLog ?? []).filter((x) => x.entityId === entityId && x.event === event).length;
    if (n) return n;
    await new Promise((r) => setTimeout(r, 10));
  }
  return 0;
}

/* ========================================================================== */
describe("flow 1 — lead lifecycle", () => {
  const PHONE = "+91 9811 20001";
  let customerId = "";

  test("one WhatsApp message becomes an owned, scored, queued lead", async () => {
    const out = await handleInbound({
      orgId: ORG,
      phone: PHONE,
      name: "Ravi Menon",
      body: "Please have someone call me about the 3BHK — we are ready to move this month",
      externalId: wamid(),
    });
    customerId = out.customerId;
    assert.equal(out.created, true, "an unknown number creates the customer");

    const customer = getCustomer(customerId)!;
    assert.equal(customer.source, "whatsapp");
    assert.equal(customer.orgId, ORG);

    // Scored, and every point traceable to a named signal.
    const scored = read().scoreEvents.filter((e) => e.customerId === customerId);
    assert.ok(scored.length >= 1, "the lead is scored");
    assert.ok(customer.leadScore > 0, `score is ${customer.leadScore}`);
    assert.ok(scored[0].contributions.every((c) => c.signal && c.reason), "every contribution names its signal");

    // Handed to sales, and the stage moved with it.
    const task = read().salesTasks.find((t) => t.customerId === customerId);
    assert.ok(task, "a sales task is opened");
    assert.equal(customer.leadStage, "QUALIFIED");

    // Assigned to a real sales manager from the roster, recorded as an assignment.
    const owner = customer.assignedSalesManagerId;
    assert.ok(owner, "the lead has an owner");
    const member = read().teamMembers.find((m) => m.id === owner)!;
    assert.equal(member.role, "SALES_MANAGER", "sales work goes to a sales manager, not any member");
    assert.ok(
      read().assignments.some((a) => a.customerId === customerId && a.queue === "SALES" && a.assigneeId === owner),
      "the assignment is recorded so 'why this owner?' is answerable",
    );
    assert.equal(task!.assignedToId, owner, "the open task follows the owner");
    assert.ok(
      read().opsNotifications.some((n) => n.recipientId === owner && n.event === "lead.assigned"),
      "the owner is told",
    );
  });

  test("the sales queue shows the lead to its owner and to nobody else", () => {
    const owner = getCustomer(customerId)!.assignedSalesManagerId!;
    const mine = salesWorkspace(ORG, owner);
    assert.ok(mine.myLeads.some((c) => c.id === customerId));
    assert.ok(mine.callsPending.some((t) => t.customerId === customerId), "the call is in the owner's queue");

    const colleague = read().teamMembers.find((m) => m.role === "SALES_MANAGER" && m.id !== owner)!;
    const theirs = salesWorkspace(ORG, colleague.id);
    assert.ok(!theirs.myLeads.some((c) => c.id === customerId), "a colleague does not see another manager's lead");
    assert.ok(!theirs.callsPending.some((t) => t.customerId === customerId));

    // An admin passes no member id and sees the whole org.
    assert.ok(salesWorkspace(ORG).myLeads.some((c) => c.id === customerId));
  });

  test("a second message extends the lead instead of forking or rebouncing it", async () => {
    const before = getCustomer(customerId)!.assignedSalesManagerId;
    const out = await handleInbound({ orgId: ORG, phone: "919811 20001", body: "Any update on that call?", externalId: wamid() });
    assert.equal(out.customerId, customerId, "the same number in another format is the same person");
    assert.equal(out.created, false);
    assert.equal(read().customers.filter((c) => c.orgId === ORG && c.id === customerId).length, 1);
    assert.equal(read().salesTasks.filter((t) => t.customerId === customerId).length, 1, "one open task, not one per message");
    assert.equal(getCustomer(customerId)!.assignedSalesManagerId, before, "an active lead is not bounced to another manager");
  });
});

/* ========================================================================== */
describe("flow 2 — site visit", () => {
  test("a visit the assistant books is announced exactly once", async () => {
    const phone = "+91 9811 20002";
    const offer = await handleInbound({ orgId: ORG, phone, name: "Nina", body: "Can I book a site visit?", externalId: wamid() });
    assert.equal(offer.replyTag, "visit_slots", "the assistant offers real slots");

    const picked = await handleInbound({ orgId: ORG, phone, body: "1", externalId: wamid() });
    assert.equal(picked.replyTag, "visit_booked");
    const id = picked.appointmentId!;
    assert.ok(id, "the pick produced an appointment");

    assert.ok(await logged(id, "appointment.booked"), "the desk is told");
    // book() is the single place that announces a booking. The agent used to
    // announce it a second time, so every assistant-booked visit reached the
    // sales manager twice — and, with Resend configured, sent two e-mails.
    const rows = (read().notificationLog ?? []).filter((n) => n.entityId === id && n.event === "appointment.booked");
    assert.equal(rows.filter((n) => n.channel === "in_app").length, 1, "one booking, one in-app alert");
    assert.equal(rows.filter((n) => n.channel === "email").length, 1, "one booking, one e-mail attempt");
    assert.equal(
      read().opsNotifications.filter((n) => n.event === "appointment.booked" && n.body.includes(id.slice(0, 0) + "Nina")).length,
      1,
      "the sales manager sees it once",
    );
    // The customer's confirmation is the assistant's own reply, not a second message.
    assert.ok(rows.some((n) => n.channel === "whatsapp" && !n.ok && /assistant's reply/.test(n.detail)));
    assert.match(outbound(picked.customerId).at(-1)!.body, /booked for/i);
  });

  test("slot availability, the confirmation, cancellation and the fan-out from the desk", async () => {
    const open = slots(BRAND, new Date().toISOString(), 7);
    assert.ok(open.length > 0, "the calendar offers bookable slots");
    assert.ok(open.every((s) => s.remaining > 0 && new Date(s.startsAt).getTime() > Date.now()));

    const startsAt = open.at(-1)!.startsAt;
    const first = book({ brandId: BRAND, startsAt, customerName: "Desk Buyer", customerPhone: "+91 98112 0003", channel: "staff", createdBy: "desk" });
    assert.equal(first.ok, true, first.error);
    const id = first.appointment!.id;

    // A double-submitted form is one visit, not two.
    const again = book({ brandId: BRAND, startsAt, customerName: "Desk Buyer", customerPhone: "919811 20003", channel: "staff", createdBy: "desk" });
    assert.equal(again.appointment!.id, id, "a resubmit folds onto the booking that exists");

    assert.ok(await logged(id, "appointment.booked"));
    const booked = (read().notificationLog ?? []).filter((n) => n.entityId === id && n.event === "appointment.booked");
    assert.ok(booked.some((n) => n.channel === "in_app" && n.ok), "in-app always works");
    assert.ok(
      booked.some((n) => n.channel === "email" && !n.ok && /not configured/.test(n.detail)),
      "an unconfigured mailer is an outcome, not a crash",
    );

    transition({ id, to: "cancelled", by: "desk", reason: "buyer is travelling" });
    assert.ok(await logged(id, "appointment.cancelled"), "a cancellation is announced too");
    assert.equal(read().appointments!.find((a) => a.id === id)!.status, "cancelled");
    // The slot is released.
    assert.ok(slots(BRAND, startsAt, 1).some((s) => s.startsAt === startsAt), "a cancelled visit gives its place back");
  });

  test("the 24h reminder fires exactly once, and respects the WhatsApp window", async () => {
    const phone = "+91 9811 20004";
    // A live conversation: this buyer wrote just now, so the window is open.
    const chat = await handleInbound({ orgId: ORG, phone, name: "Window Open", body: "Hello", externalId: wamid() });
    const openSlot = slots(BRAND, new Date().toISOString(), 7).at(-2)!.startsAt;
    const live = book({ brandId: BRAND, startsAt: openSlot, customerName: "Window Open", customerPhone: phone, channel: "staff", createdBy: "desk" }).appointment!;

    // A buyer who last wrote 30 hours ago: free text cannot be delivered.
    const quietPhone = "+91 9811 20005";
    const quiet = await handleInbound({ orgId: ORG, phone: quietPhone, name: "Window Shut", body: "Hello", externalId: wamid() });
    mutate((d) => {
      const stale = new Date(Date.now() - 30 * 3600_000).toISOString();
      for (const m of d.opsMessages) if (m.customerId === quiet.customerId) m.createdAt = stale;
    });
    const shutSlot = slots(BRAND, new Date().toISOString(), 7).at(-3)!.startsAt;
    const shut = book({ brandId: BRAND, startsAt: shutSlot, customerName: "Window Shut", customerPhone: quietPhone, channel: "staff", createdBy: "desk" }).appointment!;

    // Pull both inside the reminder window without going through the slot rules.
    const inTwoHours = new Date(Date.now() + 2 * 3600_000).toISOString();
    mutate((d) => {
      for (const a of d.appointments ?? []) if (a.id === live.id || a.id === shut.id) a.startsAt = inTwoHours;
    });

    const first = await sendDueReminders();
    assert.ok(first.considered >= 2, `both visits are due (${first.considered})`);
    assert.ok(read().appointments!.find((a) => a.id === live.id)!.reminderSentAt, "the reminder is stamped");

    const liveRows = (read().notificationLog ?? []).filter((n) => n.entityId === live.id && n.event === "appointment.reminder");
    assert.ok(liveRows.some((n) => n.channel === "whatsapp" && n.ok), "an open window delivers the reminder");
    const shutRows = (read().notificationLog ?? []).filter((n) => n.entityId === shut.id && n.event === "appointment.reminder");
    assert.ok(
      shutRows.some((n) => n.channel === "whatsapp" && !n.ok && /24h window/.test(n.detail)),
      "a closed window is reported, never silently claimed as sent",
    );
    assert.ok(shutRows.some((n) => n.channel === "in_app" && n.ok), "the desk still hears about it");

    // Exactly once: a second tick must not remind again.
    const second = await sendDueReminders();
    assert.equal(second.considered, 0, "a repeated cron tick reminds nobody twice");
    assert.equal(
      (read().notificationLog ?? []).filter((n) => n.entityId === live.id && n.event === "appointment.reminder" && n.channel === "in_app").length,
      1,
    );
    assert.ok(chat.customerId);
  });
});

/* ========================================================================== */
describe("flow 3 — loan case", () => {
  const PHONE = "+91 9811 20006";
  let customerId = "";
  let caseId = "";

  test("'I need a home loan' opens one case with one standard checklist", async () => {
    const out = await handleInbound({ orgId: ORG, phone: PHONE, name: "Kiran", body: "I need a home loan for the villa", externalId: wamid() });
    customerId = out.customerId;
    const lc = activeCase(customerId)!;
    caseId = lc.id;
    assert.ok(lc, "the case is opened from the conversation");
    assert.equal(lc.status, "DOCUMENT_COLLECTION");
    assert.ok(lc.assignedOfficerId, "and routed to a loan officer");
    assert.equal(read().teamMembers.find((m) => m.id === lc.assignedOfficerId)!.role, "LOAN_OFFICER");

    const items = checklistFor(caseId);
    assert.ok(items.length >= 8, `the standard set is applied (${items.length})`);
    assert.ok(items.every((i) => i.status === "REQUESTED"), "every item is marked as asked for");

    // Saying it again must not open a second case or a second checklist.
    await handleInbound({ orgId: ORG, phone: PHONE, body: "I need a loan please", externalId: wamid() });
    assert.equal(read().loanCases.filter((l) => l.customerId === customerId).length, 1);
    assert.equal(checklistFor(caseId).length, items.length, "the checklist is applied exactly once");
  });

  test("each upload attributes to an item, names the next gap, and completion notifies the officer", async () => {
    const required = checklistFor(caseId).filter((i) => i.required);
    let lastReply = "";
    for (const item of required) {
      const out = await handleInbound({
        orgId: ORG, phone: PHONE, body: "", externalId: wamid(), type: "document",
        media: { data: samplePdf(item.documentType), mimeType: "application/pdf", filename: `${item.documentType}.pdf` },
      });
      lastReply = out.reply ?? "";
      const stored = read().documents.find((d) => d.id === out.documentId);
      assert.ok(stored, "the file is stored before anything is said about it");
      assert.equal(stored!.checklistItemId, item.id, `${item.documentType} attributed to the item it was chased for`);
      assert.equal(read().checklistItems.find((i) => i.id === item.id)!.status, "UPLOADED", "received, not accepted");
    }

    const progress = caseProgress(caseId);
    assert.equal(progress.allReceived, true);
    assert.equal(getCase(caseId)!.status, "READY_FOR_ANALYSIS", "a complete case is ready for analysis");
    assert.ok(getCase(caseId)!.readyForReviewAt);
    assert.match(lastReply, /all documents received/i);
    assert.doesNotMatch(lastReply, /accepted|approved/i, "the assistant never says accepted or approved");

    const officerId = getCase(caseId)!.assignedOfficerId;
    assert.ok(
      read().opsNotifications.some((n) => n.recipientId === officerId && n.event === "loan_case.ready_for_analysis"),
      "the assigned officer is told, by name",
    );
  });

  test("a rejection re-chases with the officer's reason", async () => {
    const doc = read().documents.filter((d) => d.customerId === customerId)[0];
    const reviewed = reviewDocument(doc.id, "REJECTED", { id: "officer-1", type: "human" }, "The scan is unreadable");
    assert.equal(reviewed.ok, true);
    assert.equal(getCase(caseId)!.status, "DOCUMENTS_INCOMPLETE", "the case reopens for collection");

    await notifyDocumentDecision(caseId, doc.checklistItemId!);
    const chase = read().followUps.find((f) => f.customerId === customerId && f.kind === "DOCUMENT_REJECTED");
    assert.ok(chase, "a replacement chase is scheduled");
    const said = outbound(customerId).at(-1)!.body;
    assert.match(said, /scan is unreadable/i, "the customer is told why, in the officer's words");
  });
});

/* ========================================================================== */
describe("flow 4 — showcase inventory", () => {
  test("the summary reconciles with the unit list for both projects", () => {
    inv.ensureInventorySeed(BRAND);
    const all = inv.statusSummary(BRAND);
    const serenity = inv.statusSummary(BRAND, "serenity");
    const onyx = inv.statusSummary(BRAND, "onyx");

    assert.equal(onyx.total, inv.ONYX_TOTAL);
    assert.equal(serenity.total, inv.listUnits(BRAND, "serenity").length);
    assert.equal(all.total, inv.listUnits(BRAND).length, "the headline count is the unit list");
    assert.equal(serenity.total + onyx.total, all.total, "the two projects account for every unit");
    for (const status of inv.UNIT_STATUSES) {
      assert.equal(all[status], serenity[status] + onyx[status], `${status} does not reconcile across projects`);
      assert.equal(onyx[status], inv.listUnits(BRAND, "onyx").filter((u) => u.status === status).length, `${status} count disagrees with the onyx list`);
    }
  });

  test("a status change persists, is guarded, and survives a re-seed", () => {
    const unit = inv.listUnits(BRAND, "onyx").find((u) => u.status === "available")!;
    assert.throws(() => inv.setUnitStatus(unit.id, "sold", "desk"), /linked customer/);

    const customer = read().customers[0];
    inv.setUnitStatus(unit.id, "sold", "desk", { customerId: customer.id });
    inv.ensureInventorySeed(BRAND);
    const after = inv.getUnit(unit.id)!;
    assert.equal(after.status, "sold");
    assert.equal(after.customerId, customer.id);
    assert.notEqual(after.notes, inv.DEMO_NOTE, "a human-touched unit is no longer demo data");
    assert.equal(
      inv.statusSummary(BRAND, "onyx").sold,
      inv.listUnits(BRAND, "onyx").filter((u) => u.status === "sold").length,
      "the summary follows the change",
    );
  });
});

/* ========================================================================== */
describe("flow 5 — publishing", () => {
  const at = (mins: number) => new Date(Date.now() + mins * 60_000);

  function stagePost(id: string, channel: "instagram" = "instagram"): void {
    const scheduledAt = new Date(Date.now() - 60_000).toISOString();
    mutate((d) => {
      if (!d.connections.some((c) => c.id === `con_${id}`)) {
        d.connections.push({
          id: `con_${id}`, brandId: BRAND, channel, handle: "@flow", externalId: "1784",
          status: "connected", accessToken: "tok", scopes: [], avatarColor: "#000", followers: 0, connectedAt: scheduledAt,
        });
      }
      if (!d.media.some((m) => m.id === `med_${id}`)) {
        d.media.push({ id: `med_${id}`, brandId: BRAND, kind: "video", src: "https://cdn.example.test/a.mp4", width: 1080, height: 1920, renders: {}, createdAt: scheduledAt, tags: [] });
      }
      d.posts.push({
        id, brandId: BRAND, status: "scheduled", caption: "flow", hashtags: [], mediaIds: [`med_${id}`],
        targets: [{ connectionId: `con_${id}`, channel, format: "reel", status: "scheduled", attempts: 0 }],
        scheduledAt, autoScheduled: false, approvals: [], createdBy: "test", createdAt: scheduledAt, updatedAt: scheduledAt,
      });
    });
  }
  const targetOf = (postId: string) => read().posts.find((p) => p.id === postId)!.targets[0];

  test("each channel refuses what it cannot carry, before anything is stored", () => {
    for (const channel of ["instagram", "x", "linkedin", "tiktok", "youtube", "google_business"] as const) {
      const adapter = adapterFor(channel)!;
      const limit = adapter.capabilities.captionLimit;
      const errors = adapter.validate({
        format: adapter.capabilities.formats[0],
        caption: "a".repeat(limit + 1),
        hashtags: [],
        mediaUrls: ["https://cdn.example.test/a.mp4"],
      });
      assert.ok(errors.some((e) => e.includes(String(limit))), `${channel} must name its own limit`);
      assert.equal(
        adapter.validate({ format: adapter.capabilities.formats[0], caption: "a".repeat(limit), hashtags: [], mediaUrls: ["https://cdn.example.test/a.mp4"] })
          .filter((e) => /caption/.test(e)).length,
        0,
        `${channel} must accept a caption exactly at the limit`,
      );
    }
    const ig = adapterFor("instagram")!;
    assert.ok(ig.validate({ format: "carousel", caption: "x", hashtags: [], mediaUrls: ["https://cdn.example.test/1.jpg"] }).length, "a one-image carousel is refused");
    assert.ok(ig.validate({ format: "reel", caption: "x", hashtags: [], mediaUrls: [] }).length, "a reel with no media is refused");
  });

  test("an exhausted quota defers the post instead of burning an attempt", async () => {
    process.env.PUBLIC_BASE_URL = "https://example.test";
    stagePost("post_quota");
    const adapter = adapterFor("instagram")! as unknown as { rateLimit: unknown };
    const original = adapter.rateLimit;
    adapter.rateLimit = async () => ({ used: 25, quota: 25, windowHours: 24 });
    try {
      const res = await runTick();
      assert.ok(res.deferred >= 1, "the tick defers");
      assert.equal(res.published, 0);
      const t = targetOf("post_quota");
      assert.equal(t.attempts, 0, "a deferral is not an attempt — the retry budget is untouched");
      assert.notEqual(t.status, "failed");
      assert.match(t.error ?? "", /quota/i);
    } finally {
      adapter.rateLimit = original;
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  test("a permanent failure is attempted once; a retryable one backs off and then gives up", async () => {
    process.env.PUBLIC_BASE_URL = "https://example.test";
    try {
      // Permanent: the mock driver cannot publish and never will, whatever we do.
      stagePost("post_permanent");
      await runTick(at(0));
      assert.equal(targetOf("post_permanent").status, "failed");
      assert.equal(targetOf("post_permanent").attempts, 1);
      // Repeated cron ticks must not spend the retry budget on an error that
      // cannot succeed — this is what `retryable: false` is for.
      await runTick(at(5));
      await runTick(at(60));
      await runTick(at(24 * 60));
      assert.equal(targetOf("post_permanent").attempts, 1, "a permanent failure is never retried");

      // Retryable: attempted again with backoff, and abandoned at the cap.
      stagePost("post_retryable");
      const adapter = adapterFor("instagram")! as unknown as { publish: unknown };
      const original = adapter.publish;
      adapter.publish = async () => ({ ok: false, error: "upstream is unavailable", retryable: true });
      try {
        for (const mins of [0, 3, 15, 60, 180]) await runTick(at(mins));
      } finally {
        adapter.publish = original;
      }
      const t = targetOf("post_retryable");
      assert.equal(t.attempts, 4, "a retryable failure uses the whole retry budget and no more");
      assert.equal(t.status, "failed", "and is abandoned at the cap rather than retried forever");
      assert.equal(read().posts.find((p) => p.id === "post_retryable")!.status, "failed");
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  test("a connector-backed channel is usable only when the connector key exists", () => {
    const row = { status: "connected", channel: "instagram", externalId: "uploadpost:acct" };
    const saved = process.env.UPLOAD_POST_API_KEY;
    delete process.env.UPLOAD_POST_API_KEY;
    assert.equal(isUsableConnection(row), false, "no native token and no connector key is not a live channel");
    process.env.UPLOAD_POST_API_KEY = "key";
    assert.equal(isUsableConnection(row), true, "the connector key is the credential that acts");
    assert.equal(isUsableConnection({ status: "connected", channel: "instagram" }), true);
    assert.equal(isUsableConnection({ status: "expired", channel: "instagram", accessToken: "t" }), false);
    if (saved === undefined) delete process.env.UPLOAD_POST_API_KEY;
    else process.env.UPLOAD_POST_API_KEY = saved;
  });
});

/* ========================================================================== */
describe("flow 6 — repetition creates nothing twice", () => {
  test("a redelivered WhatsApp webhook is answered once", async () => {
    const id = wamid();
    const phone = "+91 9811 20007";
    const first = await handleInbound({ orgId: ORG, phone, name: "Redeliver", body: "What is available?", externalId: id });
    const outboundBefore = outbound(first.customerId).length;

    const replay = await handleInbound({ orgId: ORG, phone, name: "Redeliver", body: "What is available?", externalId: id });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.customerId, first.customerId);
    assert.equal(replay.reply, null, "a replay never sends a second answer");
    assert.equal(read().opsMessages.filter((m) => m.externalId === id).length, 1, "one inbound row");
    assert.equal(outbound(first.customerId).length, outboundBefore, "one outbound");

    // Two deliveries racing each other resolve to one conversation too.
    const racing = wamid();
    const [a, b] = await Promise.all([
      handleInbound({ orgId: ORG, phone, body: "and the 4BHK?", externalId: racing }),
      handleInbound({ orgId: ORG, phone, body: "and the 4BHK?", externalId: racing }),
    ]);
    assert.equal(read().opsMessages.filter((m) => m.externalId === racing).length, 1);
    assert.equal([a.duplicate, b.duplicate].filter(Boolean).length, 1, "exactly one of the pair is the duplicate");
  });

  test("repeated cron ticks send nothing twice", async () => {
    const customerId = read().customers.find((c) => c.phone.includes("20006"))!.id;
    mutate((d) => {
      // Everything owed to this customer is due right now, cooldown long past.
      for (const f of d.followUps) {
        if (f.customerId === customerId && f.status === "SCHEDULED") f.scheduledAt = new Date(Date.now() - 1000).toISOString();
      }
      for (const m of d.opsMessages) {
        if (m.customerId === customerId && m.direction === "outbound") m.createdAt = new Date(Date.now() - 40 * 3600_000).toISOString();
      }
    });
    const before = outbound(customerId).length;
    const first = await runFollowUpTick(ORG);
    const afterFirst = outbound(customerId).length;
    const second = await runFollowUpTick(ORG);
    const afterSecond = outbound(customerId).length;

    assert.ok(first.sent >= 1, "there was something to send");
    assert.ok(afterFirst > before);
    assert.equal(second.sent, 0, "the second tick sends nothing");
    assert.equal(afterSecond, afterFirst, "and writes no second message");
  });

  test("a double-submitted booking form holds one place, not two", () => {
    const slot = slots(BRAND, new Date().toISOString(), 7).find((s) => s.remaining === 2)!;
    const args = { brandId: BRAND, startsAt: slot.startsAt, customerName: "Double Tap", channel: "website" as const, createdBy: "site" };
    const a = book({ ...args, customerPhone: "+91 90000 77777" });
    const b = book({ ...args, customerPhone: "919000077777" });
    assert.equal(b.appointment!.id, a.appointment!.id, "the same buyer typed two ways is one booking");
    assert.equal(
      read().appointments!.filter((x) => x.startsAt === slot.startsAt && x.customerPhone === "919000077777" && x.status !== "cancelled").length,
      1,
      "one person must not consume two places",
    );
    // The place they did not take is still there for someone else.
    assert.equal(book({ ...args, customerPhone: "+91 90000 88888" }).ok, true);
  });
});
