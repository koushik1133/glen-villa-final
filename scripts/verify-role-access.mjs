/**
 * PER-ROLE ACCESS VERIFICATION, AGAINST THE RUNNING APP
 *
 * Signs in as each staff account and asks the live server for every page the
 * application ships, recording what it actually answers. This is the end-to-end
 * version of tests/role-access-matrix.test.ts: that file proves the rules are
 * right, this one proves the running app obeys them.
 *
 * You type the password; it is read from a hidden prompt, held in memory for
 * the run, and never written to disk, logged, or passed on a command line where
 * it would land in your shell history.
 *
 *   node scripts/verify-role-access.mjs
 *
 * Optional: BASE_URL (default http://localhost:4321)
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const BASE = process.env.BASE_URL ?? "http://localhost:4321";

/* ---------- env ---------- */

function readEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) throw new Error("No .env found — run this from the project root.");
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const env = readEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON) throw new Error("Supabase URL/anon key missing from .env");
const REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/* ---------- accounts ---------- */

const ACCOUNTS = [
  ["admin", "admin@glentree.com"],
  ["audit", "audit@glentree.com"],
  ["sales", "sales@glentree.com"],
  ["loan", "loan@glentree.com"],
  ["marketing", "marketing@glentree.com"],
  ["front_desk", "frontdesk@glentree.com"],
  ["construction", "construction@glentree.com"],
];

/** What the access matrix says each role should be able to open. */
const EXPECTED = {
  admin: 85, audit: 71, sales: 54, loan: 33, marketing: 32, front_desk: 11, construction: 1,
};

/* ---------- routes ---------- */

function appRoutes() {
  const base = path.join(process.cwd(), "src/app/(app)");
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "page.tsx") {
        const rel = path.relative(base, dir).replaceAll("\\", "/");
        const url = "/" + rel.split("/").filter((s) => !s.startsWith("(")).join("/");
        found.push(url.replace(/\[[^\]]+\]/g, "1").replace(/\/+$/, "") || "/");
      }
    }
  };
  walk(base);
  return [...new Set(found)].sort();
}

/* ---------- password prompt (no echo) ---------- */

function askPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      // Re-render the prompt without the typed characters.
      if (["\n", "\r", ""].includes(char.toString())) return;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(prompt);
    };
    process.stdin.on("data", onData);
    rl.question(prompt, (answer) => {
      process.stdin.removeListener("data", onData);
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/* ---------- session → cookie ---------- */

/**
 * @supabase/ssr 0.12 stores the session as `base64-<base64 of the JSON>`, split
 * across `.0`, `.1` … cookies when it exceeds the browser's per-cookie limit.
 * We reproduce that here so the server reads our session exactly as it would a
 * browser's.
 */
function sessionCookies(session) {
  const payload = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64");
  const name = `sb-${REF}-auth-token`;
  const CHUNK = 3180;
  if (payload.length <= CHUNK) return [`${name}=${payload}`];
  const parts = [];
  for (let i = 0; i * CHUNK < payload.length; i++) {
    parts.push(`${name}.${i}=${payload.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
  return parts;
}

/* ---------- probe ---------- */

/** Ask the server for one page as this session. Returns "open" | "denied" | a fault. */
async function probe(route, cookie) {
  const res = await fetch(BASE + route, {
    headers: { cookie, "user-agent": "role-verify" },
    redirect: "manual",
  });
  if (res.status === 200) return { verdict: "open", status: 200 };
  if (res.status === 307 || res.status === 302 || res.status === 303) {
    const loc = res.headers.get("location") ?? "";
    if (/\/signin/.test(loc)) return { verdict: "signed-out", status: res.status, loc };
    return { verdict: "denied", status: res.status, loc };
  }
  return { verdict: `HTTP ${res.status}`, status: res.status };
}

/* ---------- run ---------- */

const ROUTES = appRoutes();
console.log(`\nVerifying ${ROUTES.length} pages against ${BASE}\n`);

const password = await askPassword("Password for the glentree.com test accounts (hidden): ");
if (!password) {
  console.error("No password entered — nothing to do.");
  process.exit(1);
}

const results = {};
let hardFailures = 0;

for (const [role, email] of ACCOUNTS) {
  const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.log(`${role.padEnd(13)} SIGN-IN FAILED — ${error?.message ?? "no session"}`);
    results[role] = null;
    hardFailures++;
    continue;
  }

  const cookie = sessionCookies(data.session).join("; ");
  let open = 0;
  const opened = [];
  const faults = [];

  for (const route of ROUTES) {
    try {
      const r = await probe(route, cookie);
      if (r.verdict === "open") { open++; opened.push(route); }
      else if (r.verdict === "signed-out") faults.push(`${route} → bounced to sign-in (session not read)`);
      else if (r.verdict.startsWith("HTTP")) faults.push(`${route} → ${r.verdict}`);
    } catch (e) {
      faults.push(`${route} → ${e.message}`);
    }
  }

  const expected = EXPECTED[role];
  const ok = open === expected;
  if (!ok) hardFailures++;
  console.log(
    `${role.padEnd(13)} opened ${String(open).padStart(3)} / ${ROUTES.length}` +
    `   expected ${String(expected).padStart(3)}   ${ok ? "MATCH" : "*** MISMATCH ***"}`,
  );
  if (faults.length) {
    console.log(`  ${faults.length} route(s) answered unexpectedly:`);
    for (const f of faults.slice(0, 8)) console.log(`    ${f}`);
    if (faults.length > 8) console.log(`    … and ${faults.length - 8} more`);
    hardFailures++;
  }
  results[role] = { open, opened, faults };
  await sb.auth.signOut().catch(() => {});
}

/* ---------- the checks that matter most ---------- */

console.log("\nTargeted checks");

function check(label, condition) {
  console.log(`  ${condition ? "pass" : "FAIL"}  ${label}`);
  if (!condition) hardFailures++;
}

const canOpen = (role, route) => Boolean(results[role]?.opened.includes(route));

check("only admin opens /settings/users",
  canOpen("admin", "/settings/users") &&
  !["sales", "marketing", "loan", "front_desk", "construction", "audit"].some((r) => canOpen(r, "/settings/users")));
check("front desk cannot open /dashboard", !canOpen("front_desk", "/dashboard"));
check("front desk cannot open /reports", !canOpen("front_desk", "/reports"));
check("front desk cannot open /ops/loans", !canOpen("front_desk", "/ops/loans"));
check("front desk CAN open its own inbox", canOpen("front_desk", "/inbox/whatsapp"));
check("marketing cannot open /crm/leads", !canOpen("marketing", "/crm/leads"));
check("marketing CAN open /studio", canOpen("marketing", "/studio"));
check("sales cannot open /settings", !canOpen("sales", "/settings"));
check("sales CAN open /crm/pipeline", canOpen("sales", "/crm/pipeline"));
check("loan CAN open /ops/loans", canOpen("loan", "/ops/loans"));
check("construction opens nothing but the landing page",
  results.construction && results.construction.open <= 1);
check("audit reads broadly but cannot manage users",
  canOpen("audit", "/reports") && !canOpen("audit", "/settings/users"));

console.log(
  hardFailures === 0
    ? "\nAll roles behave exactly as the access matrix says.\n"
    : `\n${hardFailures} problem(s) above — the running app disagrees with the matrix.\n`,
);
process.exit(hardFailures === 0 ? 0 : 1);
