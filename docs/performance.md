# Performance

How this app spends time on the server, what has been optimised, and how to
measure it yourself so a regression is a number rather than a feeling.

## Dev vs production — read this first

`npm run dev` runs Turbopack. **The first visit to any route compiles that route
on demand.** That compile is the 3–6 second stall you see when clicking into a
page you have not opened yet this session; the second visit to the same route is
an order of magnitude faster. It is a development-mode cost only.

```
npm run build && npm start     # production, port 4321 — no per-route compile
```

Always compare like for like. A "slow page" measured on its first dev hit is
measuring the compiler, not the page. The harness below discards a warmup
request per route for exactly this reason.

## The harness

`scripts/perf-check.mjs` hits a running server N times per route and prints
min / median / p95 for time-to-first-byte and for the full response.

```bash
COOKIE='sb-xxxx-auth-token=...; sb-xxxx-auth-token.1=...' \
  node scripts/perf-check.mjs /dashboard /analytics /ops/sales /ops/loans /voice /settings
```

| env      | default                 | meaning                                          |
| -------- | ----------------------- | ------------------------------------------------ |
| `COOKIE` | *(none)*                | raw `Cookie:` header value — see below           |
| `BASE`   | `http://localhost:4321` | server origin                                    |
| `N`      | `10`                    | measured samples per route                       |
| `WARMUP` | `1`                     | discarded requests per route (dev compile, JIT)  |

### Getting `COOKIE`

The harness does not sign in. Doing so would put a password into a script or a
shell history, and the session cookies are `HttpOnly` for good reason. Supply
your own browser's cookie:

1. Sign in at `http://localhost:4321` as normal.
2. DevTools → Network → click any document request to the app.
3. Under **Request Headers**, copy the entire `Cookie:` value.
4. Paste it into the `COOKIE` env var (single quotes — it contains `;` and `=`).

If a route reports a `3xx` the harness flags it: that means the cookie is
missing or expired and you measured the redirect to `/signin`, not the page.
Cookies expire — re-copy before a measurement run you intend to keep.

## Measured baseline (dev, this machine, warm route)

| cost                                                       | time             |
| ---------------------------------------------------------- | ---------------- |
| Supabase auth round trip                                    | ~200–250 ms each |
| Per-render session resolve (`getUser` + `profiles` + `user_roles`) | ~450 ms   |
| `ensureFreshStats` on dashboard / analytics / channels      | up to 4000 ms (`REFRESH_DEADLINE_MS`) |
| First dev visit to an uncompiled route (Turbopack)          | 3000–6000 ms     |

## What was optimised

- **`src/lib/db.ts`** — `read()` parses `.data/db.json` from disk. It now serves
  an in-process cache, invalidated on `mutate()` / `replaceAll()` and on a
  change to the file's mtime, so a request that calls `read()` twenty times
  parses the document at most once. The on-disk format is unchanged, and the
  atomic write (temp file + `rename`) and its `0600` mode are untouched. The
  remaining per-call cost is one `fs.statSync` (microseconds).
- **`src/lib/ops/auth.ts`** — `authorize()` no longer awaits
  `syncTeamMembers()`. That mirror of the Supabase staff roster is throttled to
  once a minute per org, but when the throttle expired the *request* paid for
  the Supabase query. It is now kicked off without awaiting, with a per-org
  in-flight guard so a burst of requests collapses to one query instead of many.
  Two things are deliberately preserved: `requirePermission()` is still awaited
  on every ops route, so authorisation is unchanged; and when the roster is
  *cold* (no members mirrored for the org yet) the sync is still awaited,
  because `assign()` with an empty roster would silently leave work unassigned.
- **`src/app/(app)/ops/customers/[id]/page.tsx`** and
  **`src/app/(app)/ops/loans/[caseId]/page.tsx`** — `params` and
  `sessionFromCookies()` are independent; they now resolve in one `Promise.all`.

## Remaining known costs

- **The session round trip is the floor.** Every page render resolves the
  session against Supabase (~450 ms including the profile and role lookups).
  `resolveSession` is `React.cache`d, so it happens once per request rather than
  once per component — but it is once per request, and it is remote. Cutting it
  further means caching the resolved session across requests (a signed, short-
  lived cookie or a server-side store), which is an authorisation change and was
  deliberately out of scope here.
- **`ensureFreshStats`** still blocks dashboard, analytics and channels for up
  to `REFRESH_DEADLINE_MS = 4000`. Moving it behind `<Suspense>` so the shell
  streams first is the single largest remaining win.
- **Inline external calls during server render** — `/voice` (Bolna),
  `/settings` (Meta Graph), and the analytics YouTube section all call out to
  third-party APIs inside the render path. Their latency is not ours to control;
  they belong in streamed Suspense boundaries or client-side fetches.
- **Only one of 39 app pages uses `<Suspense>`**, and every page is
  `force-dynamic`, so nothing streams: the browser waits for the slowest data
  dependency before it sees any HTML.
- **Session-cache revocation is per instance.** `src/lib/auth/session-cache.ts`
  holds resolved sessions in an in-process map for `TTL_MS = 30s`. Its two
  invalidators — `clearSessionCache()` on sign-out and `clearAllSessions()` on
  the users PATCH — only clear the map of the Node worker that served that
  request. On a single instance (today's deployment) revocation, disabling an
  account and narrowing a role take effect immediately. On multiple instances
  every other warm instance keeps the old `SessionResult` for up to 30s. Making
  it immediate everywhere needs a shared signal, e.g. a per-user
  `sessions_invalidated_at` checked as part of the cache hit.
- `.data/db.json` is 132 KB. It is not a bottleneck and does not need to become
  one to justify Postgres; the `read()` / `mutate()` seam is where that swap
  would happen.

## Re-measuring after a change

```bash
npm run build && npm start                    # measure production, not the compiler
COOKIE='...' N=20 node scripts/perf-check.mjs /dashboard /analytics /ops/sales
```

Run the same route list before and after, in the same mode, on an otherwise
idle machine, and compare the **median** — p95 in dev is dominated by compiles
and garbage collection, not by your change.
