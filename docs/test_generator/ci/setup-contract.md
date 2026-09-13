# Test Setup Contract: Composite Alerts  (area: Alerts)

This is the single source of truth for the data/state each composite-alert behavior needs, and the
**exact existing helper** that establishes it. Engineer: implement setup by calling these; Healer /
Refiner: consult this before scanning when a setup/data failure appears. Do **not** invent new setup.

## Streams / data the spec must establish

Tag each item by SCOPE — `[shared/read-only]` = establish once, only READ; `[per-test]` = create
inside the test (uniquely named) because the test mutates it or needs a special shape.

### Shared fixtures (seeded once per worker — do NOT re-create per test)
- **Destination `auto_p0_dest` + template `auto_p0_tmpl` + stream `alerts_p0_stream`** `[shared/read-only]`
  - Why: every child alert payload (`simpleAlert`) points at `destinations: [auto_p0_dest]` and
    `stream_name: alerts_p0_stream`. Without these the child create is rejected (unknown destination/stream).
  - How: `await seedAlertFixturesOnce(page)` — `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:209`
    (module-level once-per-worker; idempotent; delegates to `seedAlertFixtures` at `:276`, which creates
    the template + dogfood destination + ingests 3 rows into `alerts_p0_stream`).

### Child alerts (the composite's operands)
- **Plain scheduled alerts** `[per-test]` — 2–3 children for builder/list/detail, 11 for the cap test.
  - Why: the composite expression references child `alert_id`s; children must be non-anomaly
    (`alert_type !== "anomaly_detection"`).
  - How: `await createChildAlerts(page, prefix, count)` → returns `[{id, name}]` —
    `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:139` (creates concurrently, then
    resolves ids against a single `listAlerts` read; throws loudly if any create fails or an id is missing).
  - Payload: `simpleAlert(name)` — `:39` (scheduled logs alert on `alerts_p0_stream`).
- **Disabled child** (for preview `D3` "child_disabled") `[per-test]`
  - How: `await createAlert(page, { ...simpleAlert(name), enabled: false })`, then
    `findAlertId(page, name)` — see `alerts-composite-preview.spec.js:66-72` (the `disabledChild` helper).

### Composite alerts (the parent under test)
- **Composite over child ids** `[per-test]`
  - How: `await createCompositeAlert(page, name, [a.id, b.id])` → `{response, id, name}` —
    `alerts-api-helpers.js:175` (wraps `compositeAlert` payload at `:97`, then resolves id via list read).
  - Payload shape (`compositeAlert`): `alert_type: "composite"`, `enabled: false` (created paused),
    `composite_condition: { expression: "{a} && {b}", warning_counts_as_firing: true,
    stale_child_policy: "use_last_state" }`, `destinations: [auto_p0_dest]`.
  - Overrides: pass `overrides` (merged into `composite_condition`) for e.g. `stale_child_policy:
    "treat_as_false"` (detail `G4`) — see `alerts-composite-detail.spec.js:64-75`.

### Cleanup (afterEach)
- **Cascade delete** — `await deleteAlertsCascade(page, ids)` — `alerts-api-helpers.js:235`.
  - Why: children referenced by a still-alive parent return 409 on delete; this drains parents in
    passes before children so fixtures don't leak. Surfaces (not asserts) leaked ids via
    `testLogger.error(...)` — see `alerts-composite-list.spec.js:51-55`.

## Mock / state-injection (for states a live fixture cannot hold on demand)

These are `page.route` interceptions, NOT data fixtures. The exact patterns already exist:

- **Patch detail response** (stale reason, `accessible: false`, missing job, long name, disabled+no-job):
  - `patchDetail(page, id, mutate)` — `alerts-composite-detail.spec.js:85-96`. Matches
    `/api/v2/[^/]+/alerts/${id}(\?|$)` **by regex** (not glob — the `?folder=` query makes globs miss),
    GET-only, `route.fetch()` → mutate body → `route.fulfill({ response, json })`. Returns a `patched`
    counter so tests can assert the route actually fired.
  - Used by G5/G5b (`enabled` + `scheduler_job_present:false`), G6 (`children[0].stale_reason`,
    `policy_decision`, `truth`, `level`), G8 (`children[0] = { alert_id, accessible:false }`), G9 (long name).
- **Timeline response** (`**/composite-timeline*`):
  - 500 → empty state (H3): `alerts-composite-detail.spec.js:255-261`.
  - Custom lanes (H4): fulfill `{from, to, children:[{alert_id,name,accessible,slot,current_level,transitions}], result:{…}}` — `:272-297`.
- **Validate response** (`**/alerts/composites/validate`):
  - Warnings/errors/result injection (D2/D4/D7/D8): `validationBody(expression, kids, extra)` helper +
    `page.route(VALIDATE_ROUTE, …)` — `alerts-composite-preview.spec.js:81-90` and `:117-136` etc.
  - Validate-request capture (E5): `page.route('**/alerts/composites/validate', …)` push `postDataJSON()` — `alerts-composite-builder.spec.js:296-299`.
- **Save-request capture** (F4): `page.route(\`**/api/v2/*/alerts/${parent.id}*\`, …)` intercept PUT — `alerts-composite-builder.spec.js:329-333`.

## Preconditions / toggles

- **Org + auth**: use `getOrgIdentifier()` / `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (worker auth state already handled). Page
  object nav helpers embed `org_identifier` + `folder=default` — e.g. `compositeAlertsPage.openCreate()`.
- **`composite_alerts_available`**: true in OSS by default — no toggle needed. If a run hits an
  enterprise/super-cluster env where the flag is false, the create-wizard Composite tab is absent and
  B/C/E/F + D + G/H (detail of an API-created composite) tests break; the flag lives at
  `src/api/management/src/request/status/mod.rs:476-477`.
- **Navigation base**: `await navigateToBase(page)` before driving the UI (from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141`); then use the page object's
  `openList/openCreate/openEdit/openDetail`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Seed**: `await seedAlertFixturesOnce(page)` — `alerts-api-helpers.js:209` (also called in every
  `beforeEach` of the existing specs; it is idempotent and once-per-worker).
- **Children**: `createChildAlerts(page, prefix, count)` → `[{id, name}]` — `alerts-api-helpers.js:139`.
- **Composite**: `createCompositeAlert(page, name, childIds, overrides?)` → `{response, id, name}` — `alerts-api-helpers.js:175`.
- **Page object**: `pm.compositeAlertsPage` (from `tests/ui-testing/pages/page-manager.js:166`), plus
  `pm.alertsPage.searchAlert(name)` (`tests/ui-testing/pages/alertsPages/alertsPage.js:827`) for
  locating a child row by name.
- **Timing**: the create wizard's "Add alert" is a no-op until the `GET /alerts?alert_type=all`
  fetch lands — use `compositeAlertsPage.chooseCompositeType()` (waits on that response) and
  `waitForChildOptions()` rather than a fixed sleep (`compositeAlertsPage.js:248-266`). Tab switch in
  the list waits on the list refetch (`openListTab`, `:137-150`). No other hydration wait is needed:
  the timeline/preview/detail read their own state and render empty/error states rather than stalling.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **"Add alert" auto-picks the FIRST free option** — you cannot choose which child lands. Pin a
  specific child with `addChildById(child)` (adds, then replaces whatever landed) — `compositeAlertsPage.js:364-377`.
- **OSelect option windows are virtualized** — a searchable select (child picker) may not render an
  option until the search box narrows it. `selectOption(base, value, searchText)` handles this —
  `compositeAlertsPage.js:321-336`. `replaceChild(currentId, next)` requires a `{id, name}` object
  (name is what's typed into search) — `:345-353`.
- **Reka keeps the popover mounted through its close animation** and it intercepts pointer events —
  always wait for the popover to hide before opening the next select (`selectOption` does).
- **Tab active-state**: the list type tabs use reka-ui `ToggleGroupItem`, which reports `data-state`
  `on/off`, NOT `active` — assert `toHaveAttribute('data-state', 'on')` (`compositeAlertsPage.js:147-149`).
- **Edit save PUT strips `id` for composites** (`services/alerts.ts:125-128`) — the F4 assertion on the
  submitted body must not expect an `id` field.
- **Delete-conflict toast never arrives** for a refused child delete — `attemptRowDelete` deliberately
  returns WITHOUT asserting the "deleted" toast (`compositeAlertsPage.js:204-223`); the caller asserts
  the 409 + drawer instead.
- **`referenced_by_composite_count` is only copied by the composite-row mapping**, not the
  scheduled/real-time mapping — that's the known UNWIRED gap behind `test.fixme A5` (o2-enterprise#2619).
  Similarly the list expression cell (`test.fixme A4`) and drawer focus (`test.fixme A6b`) are UNWIRED —
  keep them parked as `fixme`, do not try to force them green.
