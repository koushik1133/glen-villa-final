# Sales OS (`/os`) — the ported villa-os-f module

The second console (the "villa-os-f" app that lived at
`Agency/Villa/Whatsapp - Claude`) now runs inside this dashboard at **`/os`**.
It was merged **as-is, on its own database** — the deliberate choice, not an
accident — so this file records what that means and where the seams are.

## What it is

A complete second application: AI copilot and lead intelligence, CRM (leads,
pipeline, contacts, customers, tasks, follow-ups, **client rankings**), sales
(site visits, bookings, revenue, team performance), properties (projects,
villas, inventory, floor plans, amenities), marketing (content studio,
campaigns, broadcasts, WhatsApp analytics), communication (inbox, WhatsApp,
email), automation (workflows, routing, notifications), analytics (attribution,
funnel, sales, reports) and its own settings and agent simulator.

46 pages and 33 API routes.

## The seam: two databases

| | Villa-os | Sales OS (`/os`) |
|---|---|---|
| Ops data | `.data/db.json` file store | — |
| Supabase | `meaocrrtxkoylntzoxnu` (auth) | `dfesxxtghxckoplmoxof` (everything) |

**These are different Supabase projects.** A lead created by Villa-os's own
WhatsApp agent does **not** appear in `/os`, and vice versa. That is the
accepted trade-off of merging the two consoles quickly; unifying them is a
separate piece of work.

Because of this, the module's Supabase environment variables are **renamed**:

```
OSF_SUPABASE_URL
OSF_SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_OSF_SUPABASE_ANON_KEY
```

Do **not** rename these back to `NEXT_PUBLIC_SUPABASE_*`. Two apps in one
process cannot share those names, and the failure mode is silent: the module
would read Villa-os's project, find none of its tables, and render empty pages
that look like "no data" rather than "wrong database".

## How it is isolated

- **Routes** — pages under `src/app/(osf)/os/**`, API under `src/app/api/osf/**`.
  `(osf)` is its own route group with its own layout, so its chrome never
  renders over a Villa-os page.
- **Code** — `src/lib/osf/**` and `src/components/osf/**`. The module must not
  import Villa-os's `@/lib/*` or `@/components/*`, and Villa-os must not import
  `@/lib/osf/*`.
- **Styling** — the module's dark/gold palette is registered with Tailwind in
  `src/app/globals.css`, but its surface colours apply only under `.osf-root`
  (set by `src/app/(osf)/layout.tsx`). The source app painted `html, body`
  directly, which would have repainted every Villa-os screen.
- **Icons** — the source ran lucide-react 1.x, this repo runs 0.544. The port
  renamed the icons that changed name (`SquareKanban`→`KanbanSquare`,
  `House`→`Home`, `ChartColumn`→`BarChart3`, `Funnel`→`Filter`, and others).
  Upgrading lucide here would break Villa-os's own 80-plus icon usages.

## Access control

The module's own Supabase RBAC and its shared-password login are **not** in
force. Access is Villa-os's:

1. `src/middleware.ts` requires a Villa-os session.
2. `src/lib/auth/page-access.ts` requires a permission per area — `/os` needs
   `sales.read`, with tighter rules for its settings, marketing and analytics
   areas.

The module's second login surface (its `/login` page, `/api/auth/*` routes and
`DASHBOARD_PASSWORD`) was **removed** during the merge. A weaker parallel front
door onto a console holding customer data is a security problem, not a
convenience.

Its webhook endpoints stay open, because Meta and the Evolution server POST
them with no cookie and each authenticates its own caller, failing closed when
unconfigured:

```
/api/osf/whatsapp     Meta HMAC signature   (EXACT match — not the subtree)
/api/osf/instagram    Meta HMAC signature   (EXACT match)
/api/osf/evolution    shared token
/api/osf/cron/*       constant-time CRON_SECRET
```

`/api/osf/whatsapp/test-voice` is deliberately **not** public — it is an
operator tool that spends transcription credit.

## Client rankings

`/os/crm/rankings`, plus a preview block on `/os`.

Every active client in one ordered list, most likely to buy first. The position
is the lead score the WhatsApp agent maintains on each turn
(`src/lib/osf/agent/scoring.ts`) — deterministic and rule-based, never
model-judged, so "why is this one above that one" always has an answer. Ties
break on most recent contact.

- **Temperature** (hot / warm / cold) is a band over that score.
- **Sentiment** (positive / neutral / negative) is read separately from the
  customer's own words in `src/lib/osf/agent/finalize.ts`, so a warm lead who
  has turned unhappy shows as exactly that instead of averaging into the middle.
  `null` means they have not replied yet — shown as "no reply yet", which is a
  different statement from "neutral".

Booked, lost and opted-out contacts are excluded: the ranking is a work queue,
and ranking someone who asked not to be contacted is an invitation to contact
them.

## Still to do

- Connect the Meta API keys (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`) — they are unset,
  so the module's WhatsApp paths currently fail closed.
- Decide whether to unify the two databases. Until then, treat `/os` and the
  rest of this dashboard as two products sharing a sidebar.
