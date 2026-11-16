# Employee Portal & CRM — Step 1 Architecture Proposal

**Project:** Laurette Travel & Tourism — `laurette-platform`
**Scope:** rebuild the Employee Portal (قسم الموظفين) and the CRM (إدارة علاقات العملاء) on the existing live platform
**Status:** proposal for approval — no code, schema or UI has been changed
**Verified against:** commit `2a09e7c`, local DB `data/laurette.db`, 31 Oct 2026

---

## 0. Decisions in one page

1. **One platform, three apps.** `/portal` (employee), `/crm` (management), `/admin` (content CMS, kept as-is). Same session, same permissions, same design system.
2. **Additive build.** The public website, its URLs, its pages and `lib/views/public*.js` are not touched.
3. **Server-rendered pages + small interactive islands.** No framework, no build step, no new dependencies — consistent with the current stack.
4. **One shared record: the Request Workspace.** Employee and manager use the same record view; capabilities decide which actions and fields appear.
5. **Access = capability + scope + field redaction**, enforced in one module on the server, never only in the UI.
6. **The live schema is canonical.** The old draft in `docs/crm-schema-draft.sql` is retired; it duplicates tables that already exist in a different shape.
7. **Apple-inspired, brand-locked.** Navy/blue/gold stay; Apple supplies hierarchy, spacing, type discipline and motion — not a navy copy of macOS.
8. **Fix the red test baseline first** (36 of 72 tests fail today). A refactor on a broken suite cannot be verified.

---

## 1. Where the platform actually stands (verified, not assumed)

| Area | Current reality |
|---|---|
| Runtime | Node 22+, **zero external dependencies**, `node:sqlite`, hand-rolled HTTP router (`lib/http.js`) |
| Entry point | `server.js` — ~500 lines, 84 route registrations, admin shell HTML inline |
| API | `lib/api.js` — ~1,500 lines, 42 exported handlers mixing auth, validation, SQL and serialization |
| UI | `public/assets/js/admin.js` — ~1.2k lines of vanilla JS building HTML strings; 15 nav sections |
| CSS | `public/assets/css/app.css` — ~75 KB shared by the marketing site **and** the admin panel |
| Database | 36 tables; organisation (`branches`, `departments`, `role_definitions`), transfers, quotes, bookings, payments, follow-ups, owner history already exist |
| Auth | Session cookie + `role_definitions.permissions` JSON + `data_scope` (`organization`/`branch`/`department`/`assigned`) |
| Deployment | Railway / Render with persistent disk; `data/laurette.db` (WAL) |
| Tests | `node --test tests/api.test.js` — 54 test blocks / 72 reported tests |

### 1.1 Three findings that change the plan

**A. The test baseline is red — 36 pass, 36 fail.**
Root cause of most failures verified: the seeded admin has `must_change = 1`, and `requireUser()` blocks every authenticated action with `403` «غيّر كلمة المرور المؤقتة للمتابعة». The suite never completes the forced password change, so authenticated admin actions never reach the code under test. Some remaining failures may be genuine and need triage once the harness is fixed — but **we currently have no usable regression net**. Fixing this is task 0.1, before any module work.

**B. The schema drifted from its own plan.**
Three quote models coexist: `requests.quote_amount` (in use, shown to the customer), `request_quotes` (versioned table, **unused** by the API), and `docs/crm-schema-draft.sql` `quotations`/`quotation_items` (**never executed**). Same for payments (`booking_payments` vs draft `payments`) and audit (`audit_log` vs draft `audit_logs`). Building on the draft would create a second, parallel system. The live schema wins; the draft is amended, not implemented.

**C. The admin SPA cannot absorb two modules.**
Adding Portal + CRM to `admin.js` would produce a ~4,000-line file with shared global state and manual HTML escaping, on a stylesheet the public site also depends on. The new modules get their own shell, their own CSS layer and their own JS entry points — while reusing the existing API conventions and session.

---

## 2. Architecture

### 2.1 Three applications, one platform

```
Browser
  ├── /portal   Employee Portal      (agent, team leader)
  ├── /crm      CRM                  (branch/dept manager, GM, finance, auditor)
  └── /admin    Content CMS          (unchanged: programs, offers, articles, visa, settings)
                        │
                 Node HTTP server (composition root: server.js)
                        │
        routes (thin) → services (rules, transactions) → SQL (node:sqlite)
                        │
        access · audit · notifications · SLA clock · serializers
```

| App | Audience | Owns | Does not own |
|---|---|---|---|
| `/portal` | Employee, team leader | My day, my requests, transfer inbox, follow-ups, my quotes, my performance | Branch-wide reporting, pricing approval, org settings |
| `/crm` | Managers, GM, finance, auditor | Pipeline, all requests, customers 360, transfers center, quote approvals, payments, suppliers, reports, org & roles, audit | Content/CMS |
| `/admin` | Marketing/admin | Programs, offers, articles, visa rules, media, site settings | CRM records |

Both internal apps share one login (`/login` → redirect by capability) and one shell. `/admin` keeps its current session and is linked from the shell, so nothing breaks on day one.

### 2.2 Layering rules

| Layer | Responsibility | Hard rule |
|---|---|---|
| Route | Parse input, `authorize()`, call service, render page or return fragment/JSON | ≤ 30 lines; **no SQL, no business rules** |
| Service | Invariants, transactions, audit writes, notifications, stage guards | No HTML, no `req`/`res` |
| Data | Prepared statements, indexes, aggregates | No permission logic |
| Serializer | Shape + **redact** fields per capability | The only place cost/margin can be dropped |
| View | Templates (server) + islands (client) | No SQL |

### 2.3 Directory layout

```
lib/
  core/            http.js · auth.js · access.js · audit.js · errors.js · validation.js
  modules/
    portal/        today.service.js · routes.js · views/…
    crm/           pipeline.service.js · customers.service.js · transfers.service.js
                   quotes.service.js · finance.service.js · suppliers.service.js
                   reports.service.js · routes.js · views/…
    records/       request.service.js · request.serializer.js · routes.js   ← shared workspace
    org/           org.service.js · routes.js
  views/
    shell.js       shared app shell, nav from capabilities
    ui/            server-side component functions (button, table, badge, drawer…)
public/assets/
  css/ui/          tokens.css · base.css · components.css · portal.css · crm.css
  js/core/         dom.js · api.js · fmt.js · toast.js · dialog.js · icons.js · store.js
  js/portal/       today.js · requests.js · workspace.js · …
  js/crm/          pipeline.js · customers.js · …
  icons/sprite.svg 40 inline icons (replaces emoji glyphs)
```

`server.js` stays the composition root and only mounts modules:

```js
mountPortal(router, deps);
mountCrm(router, deps);
mountRecords(router, deps);
```

### 2.4 Rendering model: server-rendered pages + islands

| Page type | Rendering | Interaction |
|---|---|---|
| Lists, record pages, dashboards | Server-rendered HTML (same template functions as today's `public.js`) | Filters via query string; partial refresh fetches the same view with `?partial=1` |
| Forms | Server-rendered `<form>`, client validation, fetch submit | Drawer and full page reuse **one** template |
| Pipeline board | Server-rendered first paint | Client island: pointer drag, optimistic move, revert on 409 |
| Command palette, notifications, charts | Client island | Small JSON endpoints only |

Why not extend the SPA: deep links (`/crm/requests/184`), back button, instant first paint, one template source instead of HTML duplicated in JS, and a fraction of the client code. Why not React/Next: it would add a build chain and a dependency tree to a platform that currently deploys with `node server.js`, and rewrite working auth for no user-visible gain.

Mutations follow **POST → redirect → GET**; errors return `422` with field-level messages. Successful fragment responses let drawers update in place.

### 2.5 URL map

```
/login                     shared entry, redirects by capability
/portal                    يومي
/portal/requests           طلباتي
/portal/requests/:id       مساحة الطلب
/portal/transfers          التحويلات
/portal/follow-ups         المتابعات
/portal/quotes             العروض
/portal/performance        أدائي
/portal/profile            ملفي

/crm                       نظرة عامة
/crm/pipeline              مسار المبيعات
/crm/requests              الطلبات والفرص
/crm/requests/:id          مساحة الطلب (same component)
/crm/customers             العملاء
/crm/customers/:id         ملف العميل 360
/crm/transfers             مركز التحويل
/crm/quotes                العروض والاعتمادات
/crm/finance               المالية
/crm/suppliers             الموردون
/crm/reports               التقارير
/crm/org                   الهيكل والصلاحيات
/crm/audit                 سجل التدقيق
```

Legacy `/admin` keeps working. Its CRM-ish sections (requests, customers, organization, reports, audit) get a banner linking to the new module during the transition, then are removed in a later step.

### 2.6 API contract

New endpoints live under the module they serve; the shared record is its own namespace:

```
/api/portal/today
/api/portal/requests
/api/portal/performance
/api/crm/pipeline
/api/crm/customers/:id
/api/crm/reports/:key
/api/records/requests/:id              aggregate: request + customer + owners + quote + tasks + timeline
/api/records/requests/:id/transition   guarded stage change
/api/records/requests/:id/quotes
/api/records/requests/:id/payments
/api/records/requests/:id/follow-ups
```

Conventions: `{ ok, data, meta }` for new JSON; `{ ok:false, error:{ code, message, fields } }` for errors; stable codes (`VALIDATION_FAILED`, `FORBIDDEN_SCOPE`, `INVALID_TRANSITION`, `CONFLICT`). Legacy `/api/admin/*` responses stay untouched for `admin.js`.

Two safety additions:
- **Optimistic concurrency:** every mutation sends the record's `updated_at`; mismatch → `409 CONFLICT` with a "reload / compare" dialog. Two agents editing one request is a today-problem, not a future one.
- **Idempotency:** payment and transfer creation accept a client token, unique per request, so a double-click cannot book money twice.

---

## 3. Access control

Current model (keep): `role_definitions.permissions` JSON + `data_scope`, resolved per session.

Add one module — `lib/core/access.js` — and make every route call it:

```js
authorize(user, 'requests:transfer', { record });   // throws 403 FORBIDDEN_SCOPE
scopeSql(user, 'r');                                // SQL fragment for lists
redact(user, 'quote', row);                         // drops cost/margin
capabilities(user);                                 // nav + button rendering
```

| Concern | Rule |
|---|---|
| Capability | Exact permission code; `*` = all (admin only) |
| Scope | `organization` › `branch` › `department` › `assigned`; record must fall inside the actor's scope |
| Field redaction | `quotes:cost` gates `cost_amount`, margin and supplier cost **server-side**; absent from JSON, not hidden by CSS |
| Denials | Logged to `audit_log` with route, record and reason |
| UI | Nav and actions rendered from `capabilities()`; server re-checks every time |
| Meta-test | A test enumerates every registered route and fails if its handler has no `authorize()` call |

Roles: keep the five built-ins (`admin`, `branch_manager`, `department_manager`, `sales_agent`, `service_agent`) and add `finance` and `auditor`. The audit's 8-role matrix is achievable with this model; multi-role-per-user is deliberately **out of scope** — two branches and nine departments do not need it, and `user_roles` scoping would complicate every query.

New capabilities: `quotes:cost`, `quotes:approve`, `payments:write`, `payments:approve`, `reports:export`, `audit:read`, `org:write`.

---

## 4. Data model

### 4.1 Canonical choice

`requests` remains the spine. Sales, execution and money are three **independent** facts about it — not one 17-value status:

| Field | Values | Meaning |
|---|---|---|
| `status` (existing) | 7 current values | Customer-facing progress shown in `/track` |
| `opportunity_stage` (new) | `new · contacted · qualified · quoted · negotiation · won · lost` | Sales pipeline (CRM board) |
| `execution_stage` (new) | `not_started · in_progress · booked · completed · cancelled` | Operations |
| `payment_status` (new) | `unpaid · partial · paid · refunded` | Money |

`deal_status` stays in sync (derived) for existing reports. This keeps the CRM board honest without a 17-state machine nobody can operate.

### 4.2 Changes

**Extend `requests`:** `opportunity_stage`, `execution_stage`, `payment_status`, `priority`, `due_at`, `lost_reason_id`, `closed_at`, `reopened_at`, `parent_request_id`.

**Reuse as-is:** `branches`, `departments`, `role_definitions`, `request_transfers` (one pending per request already enforced), `request_owner_history`, `request_events`, `request_follow_ups`, `clients`, `customers`, `bookings`.

**Add:**

| Table | Purpose | Key constraints |
|---|---|---|
| `request_quote_items` | Quote lines with supplier cost and sell price | `quote_id`, `qty > 0`, `cost/price ≥ 0` |
| `suppliers` | Airline/hotel/visa suppliers | `code UNIQUE`, `active` |
| `payments` | Receipts/refunds per request, optional `booking_id` | `amount > 0`, idempotency token `UNIQUE` |
| `request_tasks` | Execution checklist inside a request | `status`, `due_at` |
| `notifications` | In-app notifications | `user_id, read_at` index |
| `sla_policies` | First response / quote / resolve minutes per dept + priority | `UNIQUE(department_id, priority)` |
| `business_hours` | Per-branch working hours for SLA math | `UNIQUE(branch_id, weekday)` |
| `lost_reasons` | Controlled loss reasons | `code UNIQUE` |
| `saved_views` | Per-user filter presets ("عروضي المنتهية") | `UNIQUE(user_id, module, name)` |

**Extend `audit_log`:** `before_json`, `after_json`, `reason` + append-only triggers. One audit concept, not two.

`booking_payments` stays for existing rows; new money writes go to `payments` and reports read `payments` (with a one-time backfill). `request_quotes` becomes the real quote header; `requests.quote_amount` remains the denormalized "current quote" so `/track` and the client dashboard keep working unchanged.

### 4.3 Invariants

1. One responsible owner at all times; a pending transfer does **not** move ownership.
2. One pending transfer per request (existing partial unique index).
3. Quote version unique per request; only one `sent`/`accepted` version active at a time.
4. `lost` requires a reason; `won` requires an accepted quote; `completed` requires paid (or a recorded settlement).
5. Every stage change writes `request_events` + `audit_log` with actor and reason.
6. Money is append-only: corrections are refunds/adjustments, never edits.

### 4.4 Migration

The current `ensureColumn()` approach is reaching its limit. Introduce a numbered runner (`PRAGMA user_version`), each migration idempotent and additive:

1. Copy `data/laurette.db` + `-wal` to a timestamped backup **before** boot applies anything.
2. Apply DDL (tables, nullable columns, indexes).
3. Seed reference data: lost reasons, SLA defaults, business hours, finance/auditor roles, capabilities.
4. Backfill: stage from `status`/`deal_status`, quote header from `quote_amount`, payments from `booking_payments`.
5. Verify row counts before/after; abort and restore on mismatch.

Local DB is empty (0 requests), so rehearsal is cheap — **production volume must be measured before cutover**, not assumed.

---

## 5. Design system — Apple-inspired, Laurette-branded

### 5.1 Principles

1. **Chrome recedes, content leads.** The workspace is light; navy and gold appear where they carry meaning.
2. **One accent per view.** Blue for interaction, navy for structure, gold for brand and "won" — never three accents competing.
3. **Hierarchy through type and space**, not boxes, colours or dividers.
4. **Space is a feature.** 24/32/48 rhythm; dense data gets a density toggle, not smaller padding everywhere.
5. **Motion explains.** 120–320 ms, one easing curve; it shows where something came from and where it went.
6. **Every state is designed:** empty, loading, partial, error, permission-denied.
7. **Brand at the edges.** Navy lockup, navy primary buttons, gold hairlines and the "won" state; the daily work area stays neutral so 40 rows are readable at 18:00.

Explicitly **not** doing: frosted glass everywhere, oversized iOS-style titles inside tables, SF Symbols, dark-mode-only aesthetics, animated gradients.

### 5.2 Tokens

```css
@layer tokens {
  :root {
    /* brand — unchanged */
    --navy:#0B2A43; --blue:#17638F; --gold:#D9A34A; --sand:#F7F4EE;

    /* neutrals — Apple-like cool greys, warmed 1% for Arabic text */
    --n-0:#FFFFFF; --n-25:#FCFCFD; --n-50:#F5F5F7; --n-100:#EDEDF0;
    --n-200:#E3E3E8; --n-400:#AEAEB2; --n-600:#6E6E73; --n-800:#3A3A3C; --n-900:#1D1D1F;

    --bg:var(--n-50); --surface:var(--n-0); --surface-2:var(--n-25);
    --text:var(--navy); --text-2:#5C6B7A; --text-3:#8A97A3;
    --separator:rgba(11,42,67,.10);
    --accent:var(--blue); --brand:var(--navy);

    --ok:#1E7A5F; --warn:#B7791F; --danger:#B42318;
    --ok-bg:#EAF5F0; --warn-bg:#FDF4E5; --danger-bg:#FCEDEC;

    --font-ui:"Cairo","Segoe UI",system-ui,sans-serif;
    --fs-12:12px; --fs-13:13px; --fs-15:15px; --fs-17:17px;
    --fs-20:20px; --fs-24:24px; --fs-30:30px;

    --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px;
    --s-6:24px; --s-8:32px; --s-10:40px; --s-14:56px;

    --r-control:10px; --r-card:14px; --r-sheet:20px; --r-pill:999px;
    --hairline:1px solid var(--separator);
    --e-1:0 1px 2px rgba(11,42,67,.04);
    --e-2:0 1px 2px rgba(11,42,67,.05), 0 10px 28px rgba(11,42,67,.07);
    --e-3:0 24px 64px rgba(11,42,67,.16);

    --t-press:120ms; --t-quick:200ms; --t-sheet:320ms;
    --ease:cubic-bezier(.32,.72,0,1);
  }
}
```

Gold rule: `#D9A34A` on white is ≈2.2:1 — decorative only. Gold text appears **only** on navy surfaces. Never for status.

### 5.3 Typography

Cairo stays (self-hosted, OFL, one Arabic subset + Latin). Apple's contribution is the scale and restraint, not a new typeface.

| Role | Size / weight | Notes |
|---|---|---|
| Page title | 24 / 600 | One per page, sentence case |
| Section title | 17 / 600 | |
| Body | 15 / 400 | line-height 1.65 for Arabic |
| UI label / button | 13 / 600 | |
| Metadata | 12 / 400 | `--text-3` |
| KPI number | 30 / 600 | `font-variant-numeric: tabular-nums` |

Rules: no 800 weight in product chrome; numbers tabular in tables; references/phones wrapped in `<bdi dir="ltr">`; truncate with tooltip, never wrap table cells to three lines.

### 5.4 Layout, shape, elevation

- Sidebar **248 px**, light `--n-50`, active item = white pill + hairline + 3 px navy leading bar.
- Top bar **56 px**, `backdrop-filter: blur(24px) saturate(180%)`, hairline bottom, page title inline.
- Content max **1240 px**, gutters 32 px desktop / 20 px tablet / 16 px mobile.
- Rows 44 px comfortable, 36 px compact. Inputs 40 px. Buttons 36 px (30/44 variants).
- Radii 10/14/20; shadows only on floating layers and hover-lift cards.
- Sidebar is light **on purpose**: a full-height navy panel dominates the screen and fights the content; navy stays in the lockup, headings and primary actions.

### 5.5 Motion and materials

| Event | Duration | Behaviour |
|---|---|---|
| Press | 120 ms | scale .98, no bounce |
| Hover / expand | 200 ms | background + shadow only |
| Drawer / sheet | 320 ms | translate from inline-end + 12 px scrim fade |
| Page transition | 220 ms | View Transitions API where supported; instant fallback |
| Toast | 180 ms in, 2.5 s hold | bottom-centre, blurred surface |

All motion behind `prefers-reduced-motion: reduce`. Blur only on top bar, drawer scrim and command palette — not on cards, not on tables.

### 5.6 Iconography

Replace the emoji glyphs (`✈ ✎ ⚿ ⌂`) with a self-hosted SVG sprite: 40 icons, 24 px grid, 1.5 px stroke, `currentColor`, `<use href="/assets/icons/sprite.svg#i-request">`. Directional icons mirror in RTL; clocks, checks and logos do not.

### 5.7 Components

| Group | Components |
|---|---|
| Shell | App shell, sidebar, top bar, page header, breadcrumb, command palette, notification center |
| Inputs | Button (5 variants × 3 sizes), icon button, segmented control, tabs, field wrapper, input, textarea, select/combobox, date field, currency field, search, toggle, checkbox |
| Data | Table (sort, sticky head, selection, bulk bar, density), list row, status pill, priority dot, avatar, badge, pagination, saved views, empty state, skeleton, KPI tile, sparkline, progress ring |
| Overlay | Drawer (480/640), modal, confirm dialog, toast, popover menu, tooltip |
| Domain | Stage stepper, SLA chip, Kanban board, timeline, quote builder, payment row, customer card, file drop zone |

Every component ships four states: default, hover/focus, disabled, loading. Every collection ships empty and error states.

### 5.8 Patterns

- **List → drawer → full page.** Clicking a row opens a 640 px drawer; "open full" navigates to the deep-linkable page. Same template.
- **Filters are URL state.** Every filter, sort and page is in the query string; views are shareable and bookmarkable.
- **Destructive actions** require typing a reason (loss, cancellation, refund) — never a bare "Are you sure?".
- **Optimistic only where reversible** (assign, snooze, stage move); money and deletion wait for the server.
- **Keyboard:** `⌘K` palette, `/` search, `g p` pipeline, `Esc` closes, arrows move in lists, board cards movable via menu.
- **Notifications** live in the top bar, grouped by day, each linking to the record; never toast-only.

### 5.9 RTL and Arabic specifics

Logical properties only (`margin-inline`, `inset-inline`, `border-inline-start`). Drawers slide from the inline-end (right in RTL). Progress fills from inline-start. Chevrons mirror; play/clock icons do not. Mixed Arabic/Latin strings (references, phone numbers, emails) get `<bdi>` isolation. Dates and money use **one** formatter module (`ar-JO`, Latin digits in tables, Arabic-Indic only in prose if approved).

### 5.10 Accessibility

4.5:1 body text, 3:1 large text and controls; 44 px touch targets; visible 3 px focus ring; semantic tables with `<th scope>`; `aria-live` for toasts and async counts; no colour-only status (pill + label); full keyboard path for board and drawers.

### 5.11 CSS architecture

```
@layer reset, tokens, base, layout, components, modules, utilities;
```

`ui/tokens.css` → `ui/base.css` → `ui/components.css` → `portal.css` / `crm.css`. The new apps **do not load `app.css`**; the public site and legacy admin do not load the new layer. Nothing in the existing stylesheet is edited during this build, so the live site cannot regress visually.

---

## 6. Employee Portal (قسم الموظفين)

### 6.1 Navigation

`يومي · طلباتي · التحويلات · المتابعات · العروض · أدائي · ملفي`

The portal answers one question first: **"what needs me now?"**

### 6.2 Screens

| Screen | Route | Content | Primary actions |
|---|---|---|---|
| يومي | `/portal` | Greeting + date, 4 KPIs (open, due today, overdue, quotes awaiting reply), "يحتاج إجراءك" queue with a reason chip per row, today's follow-ups, recent activity | Open record, complete follow-up, accept transfer |
| طلباتي | `/portal/requests` | Saved views (active / awaiting reply / quoted / overdue / closed), table ↔ board toggle, filters | Open, log activity, request transfer |
| مساحة الطلب | `/portal/requests/:id` | Shared Request Workspace (see 7.3) | Quote, follow-up, transfer, close |
| التحويلات | `/portal/transfers` | Incoming / outgoing, age vs SLA, accept or reject with reason | Accept, reject, return |
| المتابعات | `/portal/follow-ups` | Today / overdue / upcoming; channel and note | Done, snooze, open |
| العروض | `/portal/quotes` | My drafts and sent quotes, validity countdown, version history | Edit draft, send, duplicate as v2 |
| أدائي | `/portal/performance` | Response time, conversion, win rate, revenue (only with `quotes:cost`) vs team median | Period switch |
| ملفي | `/portal/profile` | Password, notification preferences, signature | Save |

**Scope:** `assigned` by default — a sales agent sees requests where they are owner, sales, service or execution owner. No branch-wide totals leak into the portal.

### 6.3 "يومي" layout

```
┌ greeting + date ─────────────────────────── ⌘K  🔔  avatar ┐
│ 4 KPI tiles                                                  │
│ ┌ يحتاج إجراءك (queue) ──────────────┐ ┌ اليوم ────────────┐ │
│ │ row · reason chip · age · action   │ │ follow-ups         │ │
│ │ …                                  │ │ activity           │ │
│ └────────────────────────────────────┘ └────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

This is the screen that sets the product's perceived quality; it ships first.

---

## 7. CRM (إدارة علاقات العملاء)

### 7.1 Navigation

`نظرة عامة · مسار المبيعات · الطلبات · العملاء · التحويلات · العروض · المالية · الموردون · التقارير · الهيكل والصلاحيات · سجل التدقيق`

### 7.2 Screens

| Screen | Route | Content | Key interaction |
|---|---|---|---|
| نظرة عامة | `/crm` | Pipeline value by stage, wins/losses this period, conversion, avg first response, SLA breaches, team load, recent activity | Every tile links to the filtered list |
| مسار المبيعات | `/crm/pipeline` | Columns by `opportunity_stage`; card = ref, customer, value, owner, age, next due | Drag with guard rules; keyboard move via menu |
| الطلبات | `/crm/requests` | Advanced table, saved views, bulk assign, export | Bulk assign, open drawer |
| العملاء | `/crm/customers` | Search by name/phone/email, consent state, last activity, lifetime value (permission) | Create request for customer, merge duplicates later |
| ملف العميل | `/crm/customers/:id` | 360: requests, quotes, payments, notes, files, consent | New request, note, WhatsApp |
| التحويلات | `/crm/transfers` | Pending queue with age vs SLA, branch/department routing, history, rejection reasons | Approve, reject, reassign |
| العروض | `/crm/quotes` | Drafts, sent, expiring, accepted; margin column only with `quotes:cost` | Approve discount, send, duplicate |
| المالية | `/crm/finance` | Receipts, refunds, receivables, per-request reconciliation, booking margin | Record payment (idempotent), approve |
| الموردون | `/crm/suppliers` | Directory, linked quote lines, spend | Add/edit supplier |
| التقارير | `/crm/reports` | 9 reports + CSV/XLSX/PDF export, date/branch/dept/owner filters | Export, save view |
| الهيكل والصلاحيات | `/crm/org` | Branches, departments, employees, roles matrix, scope | Edit role capabilities |
| سجل التدقيق | `/crm/audit` | Filter by entity/actor/date; before/after diff in a drawer | Read-only |

### 7.3 The shared Request Workspace

One template used by `/portal/requests/:id` and `/crm/requests/:id`.

```
┌ ref · customer · stage stepper · SLA chip ───── primary action · ⋯ ┐
│ ┌ main ───────────────────────────────┐ ┌ rail 320 ──────────────┐ │
│ │ summary                             │ │ customer card          │ │
│ │ tabs: overview · quote · tasks ·    │ │ owners (sales/service/ │ │
│ │       timeline · files              │ │ execution)             │ │
│ │                                     │ │ dates · next action    │ │
│ │                                     │ │ attachments            │ │
│ └─────────────────────────────────────┘ └────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

- Capabilities decide which tabs and buttons render; the server re-checks on every mutation.
- Stage changes go through one guard function and always write a timeline event with a reason.
- The quote tab is a line-item builder: description, supplier, cost, sell, qty → totals, margin (permission), validity.
- The rail is the "who/what/when" answer; it never scrolls away from the conversation.

### 7.4 Pipeline rules

- Columns: new, contacted, qualified, quoted, negotiation, won, lost. Lost is a drop target **only** with a reason dialog.
- Moving to `quoted` requires a sent quote; `won` requires an accepted quote; `lost` requires a reason. Server rejects violations with `422 INVALID_TRANSITION`; the card reverts.
- Column header shows count and total value; WIP is visible at a glance.
- Filters (branch, department, owner, period) live in the URL and survive refresh.

---

## 8. Performance and quality gates

| Gate | Target |
|---|---|
| Test baseline | Green before module work — any test still failing after the harness fix is triaged as a real defect with a written cause; every new route has 200 / 403 / 404 tests |
| Permission matrix | Generated test per role × capability; agent payload asserted to contain **no** cost fields |
| Query budget | One aggregate round per screen; no N+1; `EXPLAIN QUERY PLAN` checked for every report |
| CSS | ≤ 45 KB total for both modules (unminified) |
| JS | ≤ 60 KB total, per-screen lazy-loaded ES modules |
| Paint | LCP ≤ 1.8 s on 4G for list pages; CLS ≤ 0.02 (font preload + fixed heights) |
| Accessibility | Keyboard-only walkthrough of every screen; contrast checked; focus never lost in drawers |
| Safety | Backup + restore drill before cutover; migration idempotent on a second run |
| Rollback | Restore DB copy + previous release; new tables are additive so old code keeps working |

---

## 9. Delivery sequence

| Step | Work | Acceptance | Days |
|---|---|---|---|
| 0 | Fix test harness (forced password change in setup), tag baseline, backup script | 72/72 green, nothing else changed | 0.5 |
| 1 | **This document**: architecture, tokens, screen inventory, schema delta | Approval + open decisions answered | — |
| 2 | Design system, app shell, login/redirect, icon sprite, portal navigation, "يومي" + "طلباتي" read-only, Request Workspace read-only | A real agent sees only their requests; drawer/full page; keyboard + RTL pass | 5 |
| 3 | Portal complete: stage changes, quote drafts, follow-ups, transfer accept/reject, performance | Agent completes a request end-to-end; every action audited | 7 |
| 4 | CRM core: pipeline board, requests table, customers 360, transfers center, quote approvals | Drag persists with guards; cost hidden from agents; transfers cannot double-assign | 9 |
| 5 | Finance, suppliers, reports, audit viewer, org/roles UI, exports | Payment idempotent; every report reconciles to SQL fixtures; audit diff readable | 6 |
| 6 | Hardening: role matrix tests, migration rehearsal on a production copy, a11y pass, deploy + rollback drill | Green suite, rehearsal report, signed-off cutover | 4 |

≈ **31.5 working days**. Steps 2–3 deliver a usable portal before the CRM is finished, so the team can start working in it early.

---

## 10. Risks and controls

| Risk | Control |
|---|---|
| Production data volume unknown | Measure before cutover; backup + restore drill; additive-only DDL |
| Schema drift (three quote models) | One canonical model (4.1); backfill; old columns read-only |
| Regression in the live site | New CSS layer and new routes; `app.css` untouched; public pages have no shared state |
| Apple aesthetic vs Arabic density | Density toggle; table-first design; no oversized titles inside data views |
| Two shells during transition | Same session, cross-links, banner on legacy sections, no double data entry |
| Scope creep into HR (attendance, payroll) | Explicit decision in §11; if added, it is a separate module with its own schema |
| SQLite contention with reports | WAL already on; indexes; paginated aggregates; export generation off the request path |
| Gold overuse | Gold ≤ 5% of surface; never text on white; status uses semantic colours only |

---

## 11. Decisions I need before Step 2

1. **Employee Portal scope.** Workspace only (requests, quotes, follow-ups, performance), or also staff administration (directory, contracts, attendance, leave, payroll)? The second is an HR module with its own data model and roughly doubles this phase.
2. **Bilingual?** The public site is AR/EN; the current admin is Arabic-only. Arabic-first with English later, or both from the start (adds RTL/LTR QA to every screen)?
3. **Legacy `/admin`.** Keep it as the content CMS (recommended) or fold content into the new shell and retire it entirely?

**Assumption if unanswered:** workspace only, Arabic-first, keep `/admin` as CMS.

---

## 12. What Step 1 explicitly does not do

No database changes, no route changes, no CSS changes, no screen changes, no data added to production. The only artifact is this document.
