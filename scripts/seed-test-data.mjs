#!/usr/bin/env node
/**
 * TEST DATA SEEDER — demo fixtures for the JSON store.
 *
 *   node scripts/seed-test-data.mjs          # insert (replaces any previous run)
 *   node scripts/seed-test-data.mjs --clear  # remove every seeded record
 *
 * Everything written here is marked two ways:
 *   - the `TEST` tag (or a `[TEST]` prefix on records that have no tags field)
 *   - a `seedTag: "TEST_FIXTURE"` field on every record
 *
 * `--clear` deletes strictly on `seedTag`, so real records created through the
 * app are never touched, and re-running the seeder is idempotent rather than
 * cumulative.
 *
 * DELIBERATELY NOT SEEDED: reviews, rankGrid, competitors, adCampaigns and
 * adStats. Those screens report what third parties (Google, Meta, Yelp) say
 * about the business. Inventing entries there would not be a demo fixture, it
 * would be a fabricated public record — a star rating nobody left and ad spend
 * that never happened — and both are numbers someone would reasonably act on.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Load .env ourselves: this runs as a bare node script, so nothing else does.
for (const line of existsSync(join(process.cwd(), ".env"))
  ? readFileSync(join(process.cwd(), ".env"), "utf8").split("\n")
  : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const DB = join(process.cwd(), ".data", "db.json");
const TAG = "TEST_FIXTURE";
const DAY = 86400000;
const now = Date.now();
const iso = (msAgo = 0) => new Date(now - msAgo).toISOString();
const ahead = (ms) => new Date(now + ms).toISOString();

if (!existsSync(DB)) {
  console.error(`No database at ${DB} — start the app once so it is created.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB, "utf8"));
const brandId = db.brands?.[0]?.id;
if (!brandId) {
  console.error("Database has no brand yet — start the app once first.");
  process.exit(1);
}

/**
 * The ops screens do not agree on what an org id is: /ops/admin reads
 * `workspaces[0].id` from the JSON store, while /ops/sales and /ops/loans read
 * `session.orgId`, which is the Supabase `profiles.org_id` UUID. Seeding under
 * the wrong one makes the records real but invisible. Resolve the Supabase one
 * and use it, because that is what the queue pages filter on.
 */
async function resolveOrg() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const local = db.workspaces?.[0]?.id;
  if (!url || !key) return { orgId: local, staff: [] };
  try {
    const res = await fetch(
      `${url}/rest/v1/profiles?select=id,email,org_id,active,user_roles!user_roles_profile_id_fkey(roles(key))`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!rows.length) return { orgId: local, staff: [] };
    const staff = rows.map((r) => ({
      id: r.id,
      email: r.email,
      roles: (r.user_roles ?? []).map((x) => x?.roles?.key).filter(Boolean),
    }));
    return { orgId: rows[0].org_id ?? local, staff };
  } catch (e) {
    console.warn(`Could not reach Supabase (${e.message}); falling back to ${local}.`);
    return { orgId: local, staff: [] };
  }
}

const { orgId, staff } = await resolveOrg();
if (!orgId) {
  console.error("No org id available — start the app once, or set Supabase credentials.");
  process.exit(1);
}
const withRole = (r) => staff.find((s) => s.roles.includes(r))?.id;

/* -------------------------------------------------------------------------- */
/* Clear                                                                       */
/* -------------------------------------------------------------------------- */

const COLLECTIONS = [
  "brokers", "crmContacts", "leads", "crmTasks",
  "customers", "salesTasks", "assignments", "loanCases", "checklistItems",
  "ideas",
];

let removed = 0;
for (const key of COLLECTIONS) {
  if (!Array.isArray(db[key])) continue;
  const before = db[key].length;
  db[key] = db[key].filter((r) => r?.seedTag !== TAG);
  removed += before - db[key].length;
}

copyFileSync(DB, `${DB}.bak.${Date.now()}`);

if (process.argv.includes("--clear")) {
  writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`Removed ${removed} seeded records. Real data untouched.`);
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* Scoring — mirrors scoreLead() in src/lib/crm/rules.ts                        */
/* -------------------------------------------------------------------------- */

const STAGE_WEIGHT = {
  new: 5, contacted: 15, site_visit_scheduled: 35, negotiation: 50,
  booking_token_paid: 75, won: 100, lost: 0,
};
const SOURCE_BONUS = {
  referral: 12, broker: 9, walk_in: 9, whatsapp: 6, website: 5,
  instagram: 3, facebook: 3, meta_ads: 3, google_ads: 4,
  portal_99acres: 2, portal_magicbricks: 2, portal_housing: 2,
};

function scoreLead(lead) {
  let s = STAGE_WEIGHT[lead.status];
  s += Math.min(15, (((lead.budgetMin + lead.budgetMax) / 2) / 2.5e8) * 15);
  s += SOURCE_BONUS[lead.source] ?? 0;
  if (lead.isHNWI) s += 6;
  if (lead.kycStatus === "verified") s += 5;
  const quiet = lead.lastContactedAt ? (now - new Date(lead.lastContactedAt).getTime()) / DAY : 14;
  s -= Math.min(20, quiet * 1.5);
  return Math.max(0, Math.min(100, Math.round(s)));
}

const mark = (r) => ({ ...r, seedTag: TAG });
const push = (key, rows) => { db[key] = [...(db[key] ?? []), ...rows.map(mark)]; return rows; };

/* -------------------------------------------------------------------------- */
/* Team — display-only                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Assign to the REAL provisioned staff rather than inventing a roster. The ops
 * pages sync `teamMembers` from Supabase `profiles` on every request, so a
 * fabricated member would either be ignored or fight that sync — and a fake
 * colleague showing up in a workload table is its own kind of lie.
 */
const SM1 = withRole("sales") ?? withRole("admin");
const SM2 = withRole("admin") ?? SM1;
const LO1 = withRole("loan") ?? SM1;
if (!SM1) console.warn("No Supabase staff resolved — records will be unassigned.");

/* -------------------------------------------------------------------------- */
/* Brokers                                                                     */
/* -------------------------------------------------------------------------- */

const brokers = push("brokers", [
  { id: "bkr_test_1", brandId, name: "[TEST] Rajesh Kumar", firm: "[TEST] Kumar Realty", phone: "+915550000101", reraId: "TEST/AGENT/0001", commissionPct: 2, leadsReferred: 6, dealsClosed: 2, rating: 4.4, active: true },
  { id: "bkr_test_2", brandId, name: "[TEST] Sunita Reddy", firm: "[TEST] Deccan Property Partners", phone: "+915550000102", reraId: "TEST/AGENT/0002", commissionPct: 2.5, leadsReferred: 4, dealsClosed: 1, rating: 4.1, active: true },
]);

/* -------------------------------------------------------------------------- */
/* Contacts (people) + their transactions                                      */
/* -------------------------------------------------------------------------- */

const contacts = push("crmContacts", [
  {
    id: "cnt_test_1", brandId, name: "[TEST] Arjun Mehta", phone: "+915550000201", email: "test.arjun@example.invalid",
    city: "Hyderabad", type: "customer", hnwiTier: "hnwi", netWorthBand: "₹25 – 50 Cr", kycStatus: "verified",
    kycDocs: ["PAN", "Aadhaar", "Bank statement"], kycUpdatedAt: iso(40 * DAY), occupation: "Founder",
    company: "[TEST] Mehta Logistics", preferredLanguage: "English", relationshipManager: "Sales",
    lifetimeValue: 8.4e7, tags: ["TEST"], createdAt: iso(180 * DAY),
    transactions: [
      { id: "txn_test_1", contactId: "cnt_test_1", project: "Serenity", unit: "Villa 18", type: "booking_token", amount: 2.5e6, date: iso(150 * DAY), status: "paid", mode: "rtgs", reference: "TEST-RTGS-0001" },
      { id: "txn_test_2", contactId: "cnt_test_1", project: "Serenity", unit: "Villa 18", type: "agreement", amount: 1.6e7, date: iso(120 * DAY), status: "paid", mode: "neft", reference: "TEST-NEFT-0002" },
      { id: "txn_test_3", contactId: "cnt_test_1", project: "Serenity", unit: "Villa 18", type: "installment", amount: 2.4e7, date: iso(60 * DAY), status: "paid", mode: "loan_disbursement", reference: "TEST-DISB-0003" },
      { id: "txn_test_4", contactId: "cnt_test_1", project: "Serenity", unit: "Villa 18", type: "installment", amount: 2.4e7, date: ahead(20 * DAY), status: "pending", mode: "neft", reference: "TEST-NEFT-0004" },
    ],
  },
  {
    id: "cnt_test_2", brandId, name: "[TEST] Priya Sharma", phone: "+915550000202", email: "test.priya@example.invalid",
    city: "Bengaluru", type: "customer", hnwiTier: "uhnwi", netWorthBand: "₹100 Cr+", kycStatus: "verified",
    kycDocs: ["PAN", "Passport", "Bank statement", "ITR"], kycUpdatedAt: iso(25 * DAY), occupation: "Managing Director",
    company: "[TEST] Sharma Pharma", preferredLanguage: "English", relationshipManager: "Sales",
    lifetimeValue: 2.1e8, tags: ["TEST", "repeat-buyer"], createdAt: iso(400 * DAY),
    transactions: [
      { id: "txn_test_5", contactId: "cnt_test_2", project: "Onyx", unit: "A-2104", type: "registration", amount: 9.5e7, date: iso(300 * DAY), status: "paid", mode: "rtgs", reference: "TEST-RTGS-0005" },
      { id: "txn_test_6", contactId: "cnt_test_2", project: "Serenity", unit: "Villa 42", type: "booking_token", amount: 5e6, date: iso(30 * DAY), status: "paid", mode: "rtgs", reference: "TEST-RTGS-0006" },
      { id: "txn_test_7", contactId: "cnt_test_2", project: "Serenity", unit: "Villa 42", type: "agreement", amount: 4.2e7, date: iso(5 * DAY), status: "overdue", mode: "rtgs", reference: "TEST-RTGS-0007" },
    ],
  },
  {
    id: "cnt_test_3", brandId, name: "[TEST] Farhan Qureshi", phone: "+915550000203", email: "test.farhan@example.invalid",
    city: "Hyderabad", type: "investor", hnwiTier: "hnwi", netWorthBand: "₹50 – 100 Cr", kycStatus: "pending",
    kycDocs: ["PAN"], kycUpdatedAt: iso(9 * DAY), occupation: "Portfolio investor",
    preferredLanguage: "Hindi", relationshipManager: "Sales",
    lifetimeValue: 3.6e7, tags: ["TEST"], createdAt: iso(220 * DAY),
    transactions: [
      { id: "txn_test_8", contactId: "cnt_test_3", project: "Onyx", unit: "B-1807", type: "booking_token", amount: 3e6, date: iso(70 * DAY), status: "paid", mode: "upi", reference: "TEST-UPI-0008" },
      { id: "txn_test_9", contactId: "cnt_test_3", project: "Onyx", unit: "B-1807", type: "installment", amount: 3.3e7, date: ahead(10 * DAY), status: "pending", mode: "neft", reference: "TEST-NEFT-0009" },
    ],
  },
  { id: "cnt_test_4", brandId, name: "[TEST] Kavya Iyer", phone: "+915550000204", email: "test.kavya@example.invalid", city: "Chennai", type: "lead", hnwiTier: "affluent", netWorthBand: "₹5 – 25 Cr", kycStatus: "not_started", kycDocs: [], occupation: "Surgeon", preferredLanguage: "English", relationshipManager: "Sales", lifetimeValue: 0, tags: ["TEST"], createdAt: iso(12 * DAY), transactions: [] },
  { id: "cnt_test_5", brandId, name: "[TEST] Devansh Gupta", phone: "+915550000205", email: "test.devansh@example.invalid", city: "Hyderabad", type: "lead", hnwiTier: "none", kycStatus: "not_started", kycDocs: [], occupation: "Senior engineer", company: "[TEST] Northwind Tech", preferredLanguage: "English", relationshipManager: "Sales", lifetimeValue: 0, tags: ["TEST"], createdAt: iso(4 * DAY), transactions: [] },
  { id: "cnt_test_6", brandId, name: "[TEST] Lakshmi Prasad", phone: "+915550000206", email: "test.lakshmi@example.invalid", city: "Vijayawada", type: "broker", hnwiTier: "none", kycStatus: "verified", kycDocs: ["PAN", "RERA certificate"], kycUpdatedAt: iso(200 * DAY), occupation: "Channel partner", company: "[TEST] Kumar Realty", preferredLanguage: "Telugu", relationshipManager: "Sales", lifetimeValue: 0, tags: ["TEST"], createdAt: iso(300 * DAY), transactions: [] },
]);

/* -------------------------------------------------------------------------- */
/* Leads — one per pipeline stage so every column renders                      */
/* -------------------------------------------------------------------------- */

const leadSeed = [
  { n: "Arjun Mehta",     st: "won",                 src: "referral",           bmin: 6e7,   bmax: 9e7,   proj: "Serenity", ut: "4 BHK Villa", to: "Sales", hn: true,  kyc: "verified",    c: "cnt_test_1", lc: 30,  won: 120, city: "Hyderabad" },
  { n: "Priya Sharma",    st: "booking_token_paid",  src: "referral",           bmin: 1.8e8, bmax: 2.4e8, proj: "Serenity", ut: "5 BHK Villa", to: "Sales", hn: true,  kyc: "verified",    c: "cnt_test_2", lc: 2,   tok: 30, city: "Bengaluru" },
  { n: "Farhan Qureshi",  st: "negotiation",         src: "broker",             bmin: 3e7,   bmax: 4.5e7, proj: "Onyx",     ut: "3 BHK",       to: "Sales", hn: true,  kyc: "pending",     c: "cnt_test_3", lc: 3,   bkr: "bkr_test_1", city: "Hyderabad" },
  { n: "Kavya Iyer",      st: "site_visit_scheduled",src: "instagram",          bmin: 2.5e7, bmax: 3.5e7, proj: "Serenity", ut: "4 BHK Villa", to: "Sales", hn: false, kyc: "not_started", c: "cnt_test_4", lc: 5,   sv: -3, city: "Chennai" },
  { n: "Devansh Gupta",   st: "contacted",           src: "whatsapp",           bmin: 1.5e7, bmax: 2.2e7, proj: "Onyx",     ut: "3 BHK",       to: "Sales", hn: false, kyc: "not_started", c: "cnt_test_5", lc: 2,   city: "Hyderabad" },
  { n: "Neha Bansal",     st: "new",                 src: "meta_ads",           bmin: 1.2e7, bmax: 1.8e7, proj: "Onyx",     ut: "2 BHK",       to: "Sales", hn: false, kyc: "not_started", city: "Hyderabad" },
  { n: "Sanjay Verma",    st: "new",                 src: "portal_99acres",     bmin: 2e7,   bmax: 3e7,   proj: "Serenity", ut: "4 BHK Villa", to: "Sales", hn: false, kyc: "not_started", city: "Pune" },
  { n: "Ritu Malhotra",   st: "contacted",           src: "portal_magicbricks", bmin: 4e7,   bmax: 5.5e7, proj: "Serenity", ut: "5 BHK Villa", to: "Sales", hn: true,  kyc: "not_started", lc: 8, city: "Delhi" },
  { n: "Imran Ali",       st: "site_visit_scheduled",src: "walk_in",            bmin: 3e7,   bmax: 4e7,   proj: "Onyx",     ut: "4 BHK",       to: "Sales", hn: false, kyc: "pending",     lc: 1, sv: -1, city: "Hyderabad" },
  { n: "Ananya Bose",     st: "negotiation",         src: "website",            bmin: 5e7,   bmax: 7e7,   proj: "Serenity", ut: "5 BHK Villa", to: "Sales", hn: true,  kyc: "pending",     lc: 6, city: "Kolkata" },
  { n: "Rohit Shetty",    st: "lost",                src: "google_ads",         bmin: 1.2e7, bmax: 1.6e7, proj: "Onyx",     ut: "2 BHK",       to: "Sales", hn: false, kyc: "not_started", lc: 45, lost: "Bought a competing project closer to their office.", city: "Hyderabad" },
  { n: "Sneha Kulkarni",  st: "booking_token_paid",  src: "broker",             bmin: 3.5e7, bmax: 4.5e7, proj: "Onyx",     ut: "4 BHK",       to: "Sales", hn: false, kyc: "verified",    lc: 4, tok: 12, bkr: "bkr_test_2", city: "Mumbai" },
];

const leads = leadSeed.map((s, i) => {
  const created = iso((60 - i * 3) * DAY);
  const lead = {
    id: `led_test_${i + 1}`, brandId, name: `[TEST] ${s.n}`,
    phone: `+9155500003${String(i + 10).padStart(2, "0")}`,
    email: `test.${s.n.split(" ")[0].toLowerCase()}@example.invalid`,
    city: s.city, status: s.st, budgetMin: s.bmin, budgetMax: s.bmax, source: s.src,
    brokerId: s.bkr, projectInterest: s.proj, unitType: s.ut, assignedTo: s.to,
    score: 0, isHNWI: s.hn, kycStatus: s.kyc, contactId: s.c,
    notes: "Seeded test record — safe to delete.",
    createdAt: created, updatedAt: iso((s.lc ?? 14) * DAY),
    lastContactedAt: s.lc != null ? iso(s.lc * DAY) : undefined,
    siteVisitAt: s.sv != null ? ahead(Math.abs(s.sv) * DAY) : undefined,
    tokenPaidAt: s.tok != null ? iso(s.tok * DAY) : undefined,
    wonAt: s.won != null ? iso(s.won * DAY) : undefined,
    lostReason: s.lost,
    tags: ["TEST"],
  };
  lead.score = scoreLead(lead);
  return lead;
});
push("leads", leads);

/* -------------------------------------------------------------------------- */
/* Ops customers — the WhatsApp/loan side of the house                         */
/* -------------------------------------------------------------------------- */

const custSeed = [
  { n: "Arjun Mehta",    ph: "+915550000201", stage: "COMPLETED",           st: "Won",         sent: "VERY_POSITIVE", intent: "READY_TO_PROCEED", score: 92, loan: "YES", sm: SM1, lo: LO1, bmin: 6e7, bmax: 9e7 },
  { n: "Priya Sharma",   ph: "+915550000202", stage: "DECISION",            st: "Token paid",  sent: "POSITIVE",      intent: "READY_TO_PROCEED", score: 88, loan: "NO",  sm: SM2, bmin: 1.8e8, bmax: 2.4e8 },
  { n: "Farhan Qureshi", ph: "+915550000203", stage: "DOCUMENT_REVIEW",     st: "Negotiating", sent: "POSITIVE",      intent: "HIGH_INTENT",      score: 78, loan: "YES", sm: SM1, lo: LO1, bmin: 3e7, bmax: 4.5e7 },
  { n: "Kavya Iyer",     ph: "+915550000204", stage: "DOCUMENT_COLLECTION", st: "Site visit",  sent: "NEUTRAL",       intent: "INTERESTED",       score: 64, loan: "YES", sm: SM2, lo: LO1, bmin: 2.5e7, bmax: 3.5e7 },
  { n: "Devansh Gupta",  ph: "+915550000205", stage: "QUALIFIED",           st: "Contacted",   sent: "POSITIVE",      intent: "EXPLORING",        score: 55, loan: "YES", sm: SM1, bmin: 1.5e7, bmax: 2.2e7 },
  { n: "Neha Bansal",    ph: "+915550000206", stage: "NEW",                 st: "New enquiry", sent: "NEUTRAL",       intent: "INFORMATIONAL",    score: 22, loan: "UNKNOWN", bmin: 1.2e7, bmax: 1.8e7 },
  { n: "Ritu Malhotra",  ph: "+915550000207", stage: "QUALIFYING",          st: "Contacted",   sent: "UNCERTAIN",     intent: "PRICE_CONCERN",    score: 41, loan: "NO",  sm: SM2, bmin: 4e7, bmax: 5.5e7 },
  { n: "Imran Ali",      ph: "+915550000208", stage: "FINANCING_REQUIRED",  st: "Site visit",  sent: "POSITIVE",      intent: "FINANCING_CONCERN",score: 69, loan: "YES", sm: SM1, lo: LO1, bmin: 3e7, bmax: 4e7 },
];

const customers = custSeed.map((s, i) => ({
  id: `cus_test_${i + 1}`, orgId, name: `[TEST] ${s.n}`, phone: s.ph,
  email: `test.${s.n.split(" ")[0].toLowerCase()}@example.invalid`,
  source: "whatsapp", leadStatus: s.st, leadStage: s.stage,
  assignedSalesManagerId: s.sm, assignedLoanOfficerId: s.lo,
  loanRequired: s.loan, intent: s.intent, sentiment: s.sent, sentimentConfidence: 0.8,
  leadScore: s.score, lastInteractionAt: iso((i + 1) * DAY),
  nextFollowUpAt: ahead((i + 1) * DAY), preferredChannel: "whatsapp",
  preferences: { project: i % 2 ? "Onyx" : "Serenity" },
  budgetMin: s.bmin, budgetMax: s.bmax,
  notes: "Seeded test record — safe to delete.", tags: ["TEST"],
  salesControl: "AI_ACTIVE", loanControl: "AI_ACTIVE", optedOut: false,
  createdAt: iso((40 - i * 4) * DAY), updatedAt: iso((i + 1) * DAY),
  leadId: `led_test_${i + 1}`,
}));
push("customers", customers);

/* -------------------------------------------------------------------------- */
/* Sales queue                                                                 */
/* -------------------------------------------------------------------------- */

push("salesTasks", [
  { id: "stk_test_1", orgId, customerId: "cus_test_3", assignedToId: SM1, priority: "URGENT", reason: "High-intent lead asked for a call back", triggerId: "high_intent", aiSummary: "Wants a 3 BHK in Onyx, ready to close if the floor rise is waived.", sentiment: "POSITIVE", leadScore: 78, objections: ["Floor-rise charges"], requirements: ["Higher floor", "East facing"], conversationSummary: "Seeded test record — safe to delete.", status: "OPEN", dueAt: ahead(0.2 * DAY), createdAt: iso(1 * DAY), notes: [] },
  { id: "stk_test_2", orgId, customerId: "cus_test_8", assignedToId: SM1, priority: "HIGH", reason: "Financing question the AI could not answer", triggerId: "financing_concern", aiSummary: "Asked whether the project is approved by SBI for home loans.", sentiment: "POSITIVE", leadScore: 69, objections: ["Loan approval uncertainty"], requirements: ["Bank tie-up list"], conversationSummary: "Seeded test record — safe to delete.", status: "OPEN", dueAt: ahead(-0.5 * DAY), createdAt: iso(2 * DAY), notes: [] },
  { id: "stk_test_3", orgId, customerId: "cus_test_7", assignedToId: SM2, priority: "NORMAL", reason: "Price objection raised twice", triggerId: "price_concern", aiSummary: "Thinks ₹4 Cr is above market for the plot size.", sentiment: "UNCERTAIN", leadScore: 41, objections: ["Price vs plot size"], requirements: ["Comparable pricing sheet"], conversationSummary: "Seeded test record — safe to delete.", status: "IN_PROGRESS", dueAt: ahead(1 * DAY), createdAt: iso(3 * DAY), notes: ["[TEST] Sending the comparison sheet."] },
  { id: "stk_test_4", orgId, customerId: "cus_test_4", assignedToId: SM2, priority: "NORMAL", reason: "Site visit follow-up", triggerId: "post_visit", aiSummary: "Visited Serenity on the weekend, liked Villa 27.", sentiment: "NEUTRAL", leadScore: 64, objections: [], requirements: ["Villa 27 pricing"], conversationSummary: "Seeded test record — safe to delete.", status: "OPEN", dueAt: ahead(2 * DAY), createdAt: iso(1 * DAY), notes: [] },
  { id: "stk_test_5", orgId, customerId: "cus_test_5", assignedToId: SM1, priority: "LOW", reason: "Re-engage quiet lead", triggerId: "reengage", aiSummary: "No reply for six days after the brochure was sent.", sentiment: "NEUTRAL", leadScore: 55, objections: [], requirements: [], conversationSummary: "Seeded test record — safe to delete.", status: "COMPLETED", dueAt: iso(1 * DAY), createdAt: iso(7 * DAY), completedAt: iso(0.5 * DAY), notes: ["[TEST] Replied, moving to qualified."] },
]);

push("assignments", [
  { id: "asg_test_1", orgId, customerId: "cus_test_3", queue: "SALES", assigneeId: SM1, strategy: "LEAST_LOADED", reason: "Seeded test record", createdAt: iso(5 * DAY) },
  { id: "asg_test_2", orgId, customerId: "cus_test_4", queue: "SALES", assigneeId: SM2, strategy: "ROUND_ROBIN", reason: "Seeded test record", createdAt: iso(4 * DAY) },
  { id: "asg_test_3", orgId, customerId: "cus_test_3", queue: "LOAN", assigneeId: LO1, strategy: "MANUAL", reason: "Seeded test record", createdAt: iso(4 * DAY) },
  { id: "asg_test_4", orgId, customerId: "cus_test_8", queue: "LOAN", assigneeId: LO1, strategy: "LEAST_LOADED", reason: "Seeded test record", createdAt: iso(2 * DAY) },
]);

/* -------------------------------------------------------------------------- */
/* Loan cases + checklists                                                     */
/* -------------------------------------------------------------------------- */

const caseSeed = [
  { id: "loc_test_1", cust: "cus_test_1", status: "COMPLETED",          amt: 5.5e7, inc: 2.4e7, emp: "[TEST] Founder, 11 years", closed: 100 },
  { id: "loc_test_2", cust: "cus_test_3", status: "READY_FOR_ANALYSIS", amt: 3.2e7, inc: 1.1e7, emp: "[TEST] Self-employed, 8 years" },
  { id: "loc_test_3", cust: "cus_test_4", status: "DOCUMENT_COLLECTION",amt: 2.4e7, inc: 6.5e6, emp: "[TEST] Salaried consultant, 6 years" },
  { id: "loc_test_4", cust: "cus_test_8", status: "DOCUMENTS_INCOMPLETE",amt: 2.8e7, inc: 7.2e6, emp: "[TEST] Salaried, 4 years" },
];

push("loanCases", caseSeed.map((c, i) => ({
  id: c.id, orgId, customerId: c.cust, assignedOfficerId: LO1, status: c.status,
  loanType: "HOME_LOAN", requestedAmount: c.amt, customerIncome: c.inc,
  employmentInfo: c.emp, financialInfo: "Seeded test record — safe to delete.",
  propertyInfo: i % 2 ? "[TEST] Onyx apartment" : "[TEST] Serenity villa",
  officerNotes: ["[TEST] Seeded case — not a real application."],
  readyForReviewAt: c.status === "READY_FOR_ANALYSIS" || c.status === "COMPLETED" ? iso(6 * DAY) : undefined,
  allDocumentsAcceptedAt: c.status === "COMPLETED" ? iso(80 * DAY) : undefined,
  createdAt: iso((30 - i * 5) * DAY), updatedAt: iso((i + 1) * DAY),
  closedAt: c.closed ? iso(c.closed * DAY) : undefined,
})));

const DOCS = [
  { t: "PAN_CARD", l: "PAN card", d: "A clear photo of your PAN card." },
  { t: "AADHAAR", l: "Aadhaar", d: "Front and back." },
  { t: "SALARY_SLIP", l: "Last 3 salary slips", d: "Most recent three months." },
  { t: "BANK_STATEMENT", l: "6-month bank statement", d: "PDF from net banking." },
  { t: "ITR", l: "Latest ITR", d: "Acknowledgement page included." },
];
const CASE_STATE = {
  loc_test_1: ["ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED"],
  loc_test_2: ["ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "UNDER_REVIEW"],
  loc_test_3: ["ACCEPTED", "UPLOADED", "REQUESTED", "REQUESTED", "NOT_REQUESTED"],
  loc_test_4: ["ACCEPTED", "REJECTED", "UPLOADED", "REQUESTED", "NOT_REQUESTED"],
};

const checklist = [];
for (const [caseId, states] of Object.entries(CASE_STATE)) {
  states.forEach((status, i) => {
    checklist.push({
      id: `chk_${caseId}_${i}`, orgId, loanCaseId: caseId,
      documentType: DOCS[i].t, customerLabel: `[TEST] ${DOCS[i].l}`, description: DOCS[i].d,
      required: i < 4, status, acceptedFormats: ["pdf", "jpg", "png"],
      rejectionReason: status === "REJECTED" ? "[TEST] Page 2 was unreadable." : undefined,
      dueAt: ahead(7 * DAY), order: i,
      createdAt: iso(20 * DAY), updatedAt: iso(2 * DAY),
    });
  });
}
push("checklistItems", checklist);

/* -------------------------------------------------------------------------- */
/* Post ideas                                                                  */
/* -------------------------------------------------------------------------- */

push("ideas", [
  { id: "idea_test_1", brandId, title: "[TEST] Inside a 5 BHK Serenity villa — the 20-second walk-through", angle: "Product tour", format: "reel", hook: "This staircase took nine months to get right.", outline: ["Open on the double-height foyer", "Pan to the courtyard", "End on the terrace at dusk", "Card: 12 villas left"], reason: "Serenity villas are the largest share of unsold inventory (182 units).", score: 88, createdAt: iso(2 * DAY), used: false },
  { id: "idea_test_2", brandId, title: "[TEST] What ₹3 Cr actually buys you in west Hyderabad", angle: "Price transparency", format: "carousel", hook: "Nobody publishes this. We will.", outline: ["Slide 1: the number", "Slides 2–5: what it includes", "Slide 6: what it does not", "Slide 7: book a visit"], reason: "Price objections are the most common blocker in the sales queue.", score: 84, createdAt: iso(3 * DAY), used: false },
  { id: "idea_test_3", brandId, title: "[TEST] Onyx construction update — floor 21", angle: "Build progress", format: "short", hook: "Twenty-one floors up, and the view changed everything.", outline: ["Drone approach", "Slab pour timelapse", "Cut to the show flat"], reason: "Buyers in DOCUMENT_COLLECTION ask about handover dates most often.", score: 79, createdAt: iso(5 * DAY), used: false },
  { id: "idea_test_4", brandId, title: "[TEST] Home loan in 6 documents", angle: "Education", format: "carousel", hook: "Most people get stuck on number four.", outline: ["PAN", "Aadhaar", "Salary slips", "Bank statement", "ITR", "Property papers"], reason: "Document collection is where loan cases stall longest.", score: 76, createdAt: iso(6 * DAY), used: false },
  { id: "idea_test_5", brandId, title: "[TEST] Why our villas face north-east", angle: "Design rationale", format: "feed", hook: "It is not superstition. It is 4pm in May.", outline: ["Sun path diagram", "Room-by-room light", "Resident quote"], reason: "North-East Grid units are the most viewed in the showcase.", score: 71, createdAt: iso(8 * DAY), used: false },
  { id: "idea_test_6", brandId, title: "[TEST] The handover-day checklist we give every buyer", angle: "Trust", format: "story", hook: "47 things we check before you get the keys.", outline: ["Show the printed checklist", "Three items in detail", "Swipe up for the PDF"], reason: "Completed buyers rate handover clarity highest in feedback.", score: 68, createdAt: iso(10 * DAY), used: true },
]);

/* -------------------------------------------------------------------------- */

writeFileSync(DB, JSON.stringify(db, null, 2));

const counts = COLLECTIONS.map((k) => [k, (db[k] ?? []).filter((r) => r?.seedTag === TAG).length]);
console.log(removed ? `Replaced ${removed} previously seeded records.\n` : "");
for (const [k, n] of counts) if (n) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log(`\nSeeded into brand ${brandId} / org ${orgId}.`);
console.log("Remove with:  node scripts/seed-test-data.mjs --clear");
