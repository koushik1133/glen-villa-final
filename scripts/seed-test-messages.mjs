#!/usr/bin/env node
/**
 * TEST DATA — internal staff messaging (Supabase `messages` table).
 *
 *   node scripts/seed-test-messages.mjs          # insert
 *   node scripts/seed-test-messages.mjs --clear  # remove
 *
 * Unlike the CRM fixtures this writes to Supabase, because staff messaging is
 * a real Postgres table with RLS rather than part of the local JSON store.
 *
 * Every row is marked with a `[TEST]` prefix inside the rendered text, and
 * `--clear` deletes exactly the ids this script writes — deterministic UUIDs
 * built from a fixed namespace — so it can never remove a real conversation.
 *
 * Messages are sent BETWEEN the real provisioned staff accounts. No fake
 * senders: `messages.sender_id` is a foreign key to `profiles`, and inventing a
 * colleague would put a person who does not exist into a real inbox.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

for (const line of existsSync(join(process.cwd(), ".env"))
  ? readFileSync(join(process.cwd(), ".env"), "utf8").split("\n")
  : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Fixed ids so re-running replaces rather than duplicates, and --clear is exact. */
const ID = (n) => `7e57da7a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IDS = Array.from({ length: 24 }, (_, i) => ID(i + 1));

// Delete first — this doubles as the --clear path.
await rest(`messages?id=in.(${IDS.join(",")})`, { method: "DELETE" });
if (process.argv.includes("--clear")) {
  console.log(`Cleared up to ${IDS.length} seeded messages. Real conversations untouched.`);
  process.exit(0);
}

const profiles = await rest(
  "profiles?select=id,email,full_name,org_id,user_roles!user_roles_profile_id_fkey(roles(key))",
);
const by = (email) => profiles.find((p) => p.email.startsWith(email));
const admin = by("admin@");
const sales = by("sales@");
const loan = by("loan@");
const marketing = by("marketing@");
const frontdesk = by("frontdesk@");
if (!admin || !sales) {
  console.error("Expected at least admin@ and sales@ profiles. Run provision-users first.");
  process.exit(1);
}
const orgId = admin.org_id;
const nameOf = (p) => p?.full_name || p?.email;

const MIN = 60_000;
const at = (minsAgo) => new Date(Date.now() - minsAgo * MIN).toISOString();

/** Wire format: plain text unless the message carries a reply or reactions. */
const STRUCTURED = "[MSG_PAYLOAD]:";
const text = (t, replyTo, reactions) =>
  replyTo || reactions
    ? `${STRUCTURED}${JSON.stringify({ text: t, replyTo, reactions })}`
    : t;

const quote = (idx, sender, snippet) => ({
  id: IDS[idx],
  senderName: nameOf(sender),
  snippet,
});

/* -------------------------------------------------------------------------- */
/* The threads                                                                 */
/* -------------------------------------------------------------------------- */

const rows = [];
let i = 0;
const add = (sender, recipient, body, minsAgo) => {
  rows.push({
    id: IDS[i++],
    org_id: orgId,
    sender_id: sender.id,
    recipient_type: recipient ? "user" : "everyone",
    recipient_id: recipient ? recipient.id : null,
    body,
    created_at: at(minsAgo),
  });
};

// --- Broadcast channel: everyone ---
add(admin, null, "[TEST] Morning all ☀️ Standup in 10 minutes in the meeting room.", 600);
add(sales, null, "[TEST] On my way 🏃‍♂️ Two site visits booked for Saturday already.", 594);
add(marketing ?? admin, null, "[TEST] Reel for the Serenity villas is rendering now 🎬 Should be up by noon.", 588);
add(
  admin,
  null,
  text("[TEST] Nice 🔥 Let's push that one on Instagram and LinkedIn together.", undefined, {
    "🔥": [sales.id, (loan ?? sales).id],
    "👍": [(marketing ?? admin).id],
  }),
  580,
);
add(
  loan ?? sales,
  null,
  text(
    "[TEST] Heads up — two loan files are waiting on bank statements 📄 I'll chase them today.",
    quote(0, admin, "Morning all ☀️ Standup in 10 minutes…"),
  ),
  540,
);
add(frontdesk ?? admin, null, "[TEST] Reception: walk-in couple asking about 4 BHK, sending them across 🙋", 120);
add(sales, null, "[TEST] Got it, coming down now 👍", 118);

// --- DM: admin ↔ sales ---
add(admin, sales, "[TEST] Can you review the pipeline before the 4pm call? 📊", 300);
add(sales, admin, "[TEST] Yes — 12 active leads, 2 at token stage 🎉", 295);
add(
  admin,
  sales,
  text("[TEST] Brilliant. What's blocking the negotiation ones?", quote(8, sales, "Yes — 12 active leads…")),
  290,
);
add(sales, admin, "[TEST] Mostly floor-rise pricing 😬 I'm preparing a comparison sheet.", 286);
add(admin, sales, text("[TEST] Perfect, send it over when ready 🙏", undefined, { "🙏": [sales.id] }), 280);

// --- DM: sales ↔ loan ---
if (loan) {
  add(sales, loan, "[TEST] Farhan's file is ready for analysis ✅ All four required docs accepted.", 200);
  add(loan, sales, "[TEST] Seen it 👀 Running the rules now, should have an answer this evening.", 195);
  add(loan, sales, "[TEST] One flag: the ITR is still under review, everything else is clean 📑", 190);
  add(sales, loan, "[TEST] Thanks! Customer is keen to close this week 🤞", 186);
}

// --- DM: admin ↔ marketing ---
if (marketing) {
  add(marketing, admin, "[TEST] Instagram reach is up this week 📈 Reels are doing the work.", 150);
  add(admin, marketing, "[TEST] Great 🎯 Can we get a construction update post for Onyx floor 21?", 145);
  add(marketing, admin, "[TEST] Already shot the drone footage 🚁 Editing tomorrow.", 140);
}

await rest("messages", {
  method: "POST",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify(rows),
});

const dm = rows.filter((r) => r.recipient_type === "user").length;
console.log(`Inserted ${rows.length} test messages (${rows.length - dm} broadcast, ${dm} direct).`);
console.log("Participants:", [admin, sales, loan, marketing, frontdesk].filter(Boolean).map(nameOf).join(", "));
console.log("Remove with:  node scripts/seed-test-messages.mjs --clear");
