# Test Setup Contract: Anomaly Detection Sensitivity Labeling  (area: Alerts)

This is the data/state contract for `tests/ui-testing/playwright-tests/Alerts/alerts-anomaly-detection.spec.js`
(the anomaly-detection sensitivity suite). The spec already exists and is comprehensive; this
contract pins the EXACT helpers and reference lines so the Engineer/Healer never invent setup.

## Feature gate (do this first, every test)
- `anomaly_detection_enabled` must be true. The rendered `alert-list-tab-anomalyDetection` tab is
  the ONLY honest signal (AlertList coerces `activeTab` without rewriting `?tab=`).
  Check + skip: `pm.anomalyDetectionPage.isAnomalyDetectionAvailable()` → `test.skip(!available, ...)`.
  See `tests/ui-testing/playwright-tests/Alerts/alerts-anomaly-detection.spec.js:75-76`.

## Streams / data the spec must establish
Tag by SCOPE: `[shared/read-only]` = every test just READS it → set up once / pre-seeded.
`[per-test]` = only one test needs it, or it MUTATES the record → set up inside that test.

- **`e2e_automate`** **[shared/read-only]** — the pre-existing logs stream every percentile-mode /
  builder-mode / SQL-mode wizard test selects as its stream. Why: the wizard needs a selectable
  logs stream to reach the Detection Config step; no test in the Sensitivity/Builder/Form-validation
  describes mutates its data. Source: `const testStreamName = 'e2e_automate'`
  (`alerts-anomaly-detection.spec.js:33`). It is assumed already present in the org.

- **Budget-mode config records** **[per-test]** — the only way to reach budget mode is to EDIT a
  config that already carries `alert_budget_per_day` (no UI toggle exists). Each budget test creates
  its own via the API, e.g. `createAnomalyViaApi(page, name, { alert_budget_per_day: 4 })` (or
  `0.5` for sub-daily/week tests, `1` for the day-unit boundary, or omitted for the no-budget
  regression guard). See `api-helper.js:197` (payload: `anomaly_config` carries either
  `alert_budget_per_day` or `threshold`, never both) and the `ownConfig` helper at
  `alerts-anomaly-detection.spec.js:943-956`.

- **`<seeded stream>`** **[per-test: end-to-end only]** — backdated stream for training/detection.
  Only the "End to end detection" test (and the parked history `fixme`) needs it. Use
  `seedAnomalyStream(page, seededStream, { hours: 4, bucketSeconds: 60, baseline: 10, spikeValue: 120,
  spikeBuckets: 4, spikeOffset: 70 })` then `waitForStream(page, seededStream)`.
  See `api-helper.js:135` and `alerts-anomaly-detection.spec.js:777-786`. Not required by the
  sensitivity/budget tests (they never run detection).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Prerequisite template** (unlocks the Add button): `pm.alertTemplatesPage.ensureTemplateExists(prerequisiteTemplateName)`
  — `tests/ui-testing/pages/alertsPages/alertTemplatesPage.js:433`; called in `beforeEach`
  (`alerts-anomaly-detection.spec.js:51`).
- **Prerequisite destination** (second unlock for the Add button): `createMockDestination(page, name, templateName)`
  — `api-helper.js:78` (POST `/api/{org}/alerts/destinations`, webhook URL `example.com/webhook`
  or `MOCK_WEBHOOK_URL`). Assert existence, not status (create 400s on "already exists"):
  `destinationExists(page, name)` (`api-helper.js:121`); called at `alerts-anomaly-detection.spec.js:57-71`.
- **Auth/org**: helpers read `ORGNAME` via `getOrgName()`; the worker auth state comes from the
  standard `navigateToBase(page)` + `enhanced-baseFixtures` pattern. No manual login in tests.
- **Budget config seeding**: `await createAnomalyViaApi(page, name, { alert_budget_per_day: N })`
  → `await waitForAnomalyListed(page, name)` → `await page.reload()` → `navigateToAnomalyTab()` →
  `searchAnomaly(name)` → `openEdit(name)`. The reload is REQUIRED: the list is fetched once on tab
  mount, so a config created afterwards is absent until refetch. See `ownConfig`
  (`alerts-anomaly-detection.spec.js:943-956`) and `createAnomalyViaApi` (`api-helper.js:197`).
- **Timing / hydration**: after `searchAnomaly(name)`, await the row
  (`getRow(name)` visible, 20s) before row actions — the search is debounced. Stream fields hydrate
  asynchronously; the SQL preview and field selects read `props.config`/schema, so a query before
  load returns empty. For the preview chart, `waitForDataPreview()` (`anomalyDetectionPage.js:714`)
  already accounts for the 600 ms debounce + query.
- **Save assertion**: use `saveAndExpectSuccess()` (`anomalyDetectionPage.js:611`), which races the
  error-toast vs the Save button hiding — never assume a bare `save()` succeeded.

## Preconditions / toggles
- Non-SQL (builder/filters) mode is the default `query_mode`; `selectQueryMode('custom_sql')`
  switches to SQL mode and seeds a default query (`anomalyDetectionPage.js:296`).
- Budget mode requires `sensitivity_mode === "budget"`, which is DERIVED from `alert_budget_per_day`
  at form init — do not try to toggle it. A config without `alert_budget_per_day` renders the
  percentile tier (`getPercentileTierLocator()`), never the budget tiers.
- Notifications toggle (`toggleNotifications`) gates the destination requirement; keep it `false`
  for the sensitivity/budget read-only tests to avoid the destination-required validation.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Anomaly detection is enterprise-gated**: on OSS CI the tab is absent and EVERY test must skip —
  the `beforeEach` already does (`alerts-anomaly-detection.spec.js:75-76`). The spec is registered
  in the o2-enterprise `ci_matrix.ent.json`, not the OSS matrix.
- **Add button disabled race**: it is disabled until destinations AND templates load; `openAddAnomalyWizard()`
  awaits `toBeEnabled` before clicking.
- **Budget mode = edit-only**: there is NO UI control that enters budget mode. Any test that tries to
  "switch to budget" from a fresh wizard will fail. Seed via API + edit.
- **Budget write-back never clobbers on invalid input**: setting `budget_count` to `0` blocks save and
  must NOT write `undefined` back (that would flip the config to percentile mode). The save-persist
  test seeds at `1` so a no-op save is detectable.
- **Per-week display rounds float noise**: `budgetFieldsFromPerDay` rounds display decimals
  (1/7*7 → 0.9999…) but never the magnitude; assert `getBudgetCount()`/`getBudgetPeriod()` as the
  spec already does (e.g. `0.5/day` → `'3.5'` + `'week'`).
- **Monaco (SQL) editing is racy**: clear until verifiably empty before typing (`setCustomSql`
  does this); the seeded default query must be cleared to reach the required-SQL error state.
- **Virtualized selects**: destination/stream/field pickers are virtual lists — type the filter
  (`_filterOpenSelect`) and match `[data-test-value=...]`, never scroll-hunt an option.
- **Error toasts stack & live 30s**: `cancel()`/`dismissToasts()` clear them best-effort so a stale
  toast can't intercept the footer clicks.
