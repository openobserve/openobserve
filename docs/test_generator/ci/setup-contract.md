# Test Setup Contract: Alerts SQL Multi Alert  (area: Alerts)

Target spec: `tests/ui-testing/playwright-tests/Alerts/alerts-sql-multi-alert.spec.js`

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE (beforeEach).
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `alerts_p0_stream` **[shared/read-only]** — a logs stream already seeded with 3 rows by
  `seedAlertFixtures`. Fields: `city` (text), `latency` (numeric), `status` (numeric).
  Why: the SQL query the tests write resolves its output columns via `/result_schema`; a numeric
  projection (e.g. `SELECT latency FROM "alerts_p0_stream"`) is exactly what populates the SQL
  multi-alert value-column dropdown (`alert-sql-agg-column-select`). Reuse this stream — do NOT
  create a new one.

No `[per-test]` stream is strictly required: the same 3-row stream serves the happy path, the
column-invalidation edge case, and the HAVING-warning edge case (a query with its own HAVING
returns `having: true` from `/result_schema`). A per-test *uniquely-named alert* is created and
deleted each test (see below), but the underlying stream is shared.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Seed stream + destination + template:
  `await seedAlertFixtures(page)` — from `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js`
  (exports `BASE`, `STREAM`, `DEST`, `uniq`, `api`, `createAlert`, `findAlertId`, `deleteAlerts`,
  `seedAlertFixtures`, `ingest`, …). This is the canonical Alerts-4.0 fixture seed; it POSTs the 3
  rows to `${v1}/alerts_p0_stream/_json` and creates the `auto_p0_dest` dogfood destination.
  Reference usage: `tests/ui-testing/playwright-tests/Alerts/alerts-multialert-ui.spec.js:45`.

- Auth/org: use `getOrgIdentifier()` and Basic-auth headers from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (already wired into the helpers). Base URL
  `BASE = process.env.ZO_BASE_URL || 'http://localhost:5080'`.
  Reference: `alerts-multialert-ui.spec.js:6,56`.

- Unique alert names + cleanup: `const name = uniq('p0ui_sqlmulti')`; afterEach
  `await deleteAlerts(page, created)` with `created.push(await findAlertId(page, name))`.
  Reference: `alerts-multialert-ui.spec.js:49-72`.

- UI creation path (mirror the existing SQL wizard, NOT the API-only multiAlert builder — this
  feature's assertions are about the SQL tab form):
  `tests/ui-testing/pages/alertsPages/alertCreationWizard.js:419-538`
  (`createScheduledAlertWithSQL`): add-alert button → fill name → `selectStreamType('logs')` →
  `selectStreamByName(STREAM)` → `_selectAlertType('Scheduled')` → click `[data-test="query-mode-sql"]`
  → `step2-view-editor-btn` → type SQL in Monaco (`typeSqlInEditor` / `.monaco-editor` `.last()`) →
  run + close dialog.
  Also available on the page object: `pm.alertsPage.clickAddAlertButton()`, `fillAlertName()`,
  `selectStreamType()`, `selectStreamByName()`, `submitAlertForm()`, `expectMultiAlertSelected()`
  (`tests/ui-testing/pages/alertsPages/alertsPage.js:1205-1210`), and `runSqlAndCloseEditor(sqlQuery)`
  (`alertsPage.js:3362-3368`).

- SQL query to write (resolves a numeric projection): `SELECT latency FROM "alerts_p0_stream"`
  (or `SELECT status, count(*) AS cnt FROM "alerts_p0_stream" GROUP BY status` to also cover a
  grouped projection). Any non-empty SQL that `/result_schema` can resolve populates the dropdown.

## Preconditions / toggles

- Alert must be **Scheduled** (default) — the SQL tab (`query-mode-sql`) and the Simple/Multi
  toggle only render when `is_real_time === "false"`.
- Toggle **Multi** via `[data-test="alerts-alertmultitoggle-choice"] [role="radio"][data-test-value="true"]`
  (Reka-ui radio; assert `aria-checked="true"`, NOT `input.checked` — see `expectMultiAlertSelected`
  at `alertsPage.js:1205-1210`).
- The value-column dropdown (`alert-sql-agg-column-select`) uses an `OFormSelect`; open it via the
  `-trigger` sub-element (see `openOSelectDropdown` pattern in `alertsPage.js:521` /
  `alertCreationWizard.js:521`). Do not raw-click the wrapper.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Async schema hydration** — the value-column dropdown options arrive from `/result_schema`
   only after the preview query fires (writing/validating the SQL). Assert dropdown options with a
   generous `waitFor` (or `expect(...).toBeVisible({ timeout })`) AFTER the editor is closed and the
   preview refresh completes; querying immediately returns an empty list.
2. **Monaco editor** — the SQL text must be set via the Monaco API / keyboard in
   `.monaco-editor` `.last()`; there are two editors (SQL + VRL), so target by id
   `#alert-editor-sql` (see `alertsPage.js:3318-3341`).
3. **Portal overlay cleanup** — after closing the SQL editor `ODrawer`, lingering
   `div[data-reka-dialog-overlay]` / `div[data-reka-portalled]` can intercept clicks. The wizard
   helper already runs a cleanup `page.evaluate` (`alertCreationWizard.js:503-506`); reuse it.
4. **Save blocked on empty column** — a SQL multi-alert with no value column selected cannot save
   (schema `aggregationColumnRequired`). Assert the inline error / that no POST fires rather than
   expecting a success.
5. **HAVING-warning banner** — to exercise `alert-sql-having-clause-warning`, write a query with its
   own `HAVING` (e.g. `SELECT city, count(*) AS cnt FROM "alerts_p0_stream" GROUP BY city HAVING count(*) > 0`);
   `result_schema` then reports `having: true`.
6. **Multi toggle hidden with VRL** — do not open the VRL editor (`fx` toggle) in a multi-alert test;
   `showVrl` true removes the Simple/Multi toggle and the condition rows.
