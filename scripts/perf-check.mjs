#!/usr/bin/env node
/**
 * Route latency harness.
 *
 * Hits a running server N times per route with a real session cookie and prints
 * min / median / p95 for time-to-first-byte and for the full response.
 *
 * It deliberately does NOT create sessions. Signing in from a script would mean
 * a password in a shell history or a script file; paste the cookie your own
 * browser already holds instead. See docs/performance.md.
 *
 *   COOKIE="$(paste from devtools)" node scripts/perf-check.mjs /dashboard /analytics
 *
 * Env:
 *   COOKIE   required for authenticated routes — the raw `Cookie:` header value
 *   BASE     server origin, default http://localhost:4321
 *   N        samples per route after warmup, default 10
 *   WARMUP   discarded requests per route, default 1 (absorbs the dev-mode
 *            Turbopack compile, which is a one-off of several seconds)
 */

const BASE = (process.env.BASE ?? "http://localhost:4321").replace(/\/$/, "");
const N = Number(process.env.N ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 1);
const COOKIE = process.env.COOKIE ?? "";

const routes = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (routes.length === 0) {
  console.error("usage: COOKIE=... node scripts/perf-check.mjs /dashboard /analytics /ops/sales");
  process.exit(2);
}
if (!COOKIE) {
  console.error("warning: COOKIE is empty — authenticated routes will measure the redirect to /signin, not the page.\n");
}

/** One request. Returns { ttfb, total, status, bytes } in ms. */
async function hit(url) {
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: COOKIE ? { cookie: COOKIE } : {},
    redirect: "manual",
    cache: "no-store",
  });
  const ttfb = performance.now() - t0;
  const body = await res.arrayBuffer();
  return { ttfb, total: performance.now() - t0, status: res.status, bytes: body.byteLength };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const ms = (n) => `${n.toFixed(0)}`.padStart(6);

const rows = [];
for (const route of routes) {
  const url = `${BASE}${route.startsWith("/") ? route : `/${route}`}`;
  let status = 0;
  let bytes = 0;
  try {
    for (let i = 0; i < WARMUP; i++) await hit(url);
    const ttfbs = [];
    const totals = [];
    for (let i = 0; i < N; i++) {
      const r = await hit(url);
      ttfbs.push(r.ttfb);
      totals.push(r.total);
      status = r.status;
      bytes = r.bytes;
    }
    ttfbs.sort((a, b) => a - b);
    totals.sort((a, b) => a - b);
    rows.push({
      route, status, bytes,
      tMin: ttfbs[0], tMed: pct(ttfbs, 50), tP95: pct(ttfbs, 95),
      fMed: pct(totals, 50), fP95: pct(totals, 95),
    });
  } catch (e) {
    rows.push({ route, error: String(e?.message ?? e) });
  }
}

const w = Math.max(24, ...rows.map((r) => r.route.length));
console.log(`${BASE} · N=${N} per route (warmup ${WARMUP} discarded)\n`);
console.log(`${"route".padEnd(w)}  code  ttfb:min    med    p95  full:med    p95     kb`);
console.log("-".repeat(w + 60));
for (const r of rows) {
  if (r.error) {
    console.log(`${r.route.padEnd(w)}  ERROR ${r.error}`);
    continue;
  }
  const flag = r.status >= 300 && r.status < 400 ? "  <- redirect, check COOKIE" : "";
  console.log(
    `${r.route.padEnd(w)}  ${String(r.status).padStart(3)} ` +
      ` ${ms(r.tMin)} ${ms(r.tMed)} ${ms(r.tP95)}     ${ms(r.fMed)} ${ms(r.fP95)} ` +
      ` ${(r.bytes / 1024).toFixed(0).padStart(6)}${flag}`,
  );
}
