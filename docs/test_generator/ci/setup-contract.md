# Test Setup Contract: Interactive Dashboard Table — Cell Drilldown (Log Explorer)

(area: Dashboards — feature_slug: `dashboard-table-cell-drilldown`, spec: `tests/ui-testing/playwright-tests/Dashboards/interactive-dashboard-table.spec.js`)

## Streams / data the spec must establish

- **`e2e_automate`** **[shared/read-only]** — logs stream, ingested once per test in `beforeEach`.
  - Fields used by the feature: `kubernetes_namespace_name` (text dimension → drillable), `kubernetes_container_hash` (measure), `kubernetes_host`, `kubernetes.pod_name`, `log`, plus ~35 others (see `tests/test-data/logs_data.json`).
  - Why: the table panel groups by `kubernetes_namespace_name` (dimension column, drillable) and measures on `kubernetes_container_hash` (aggregate, NOT drillable). The drawer queries `WHERE kubernetes_namespace_name = '<value>'`, so that field must have real, non-null values.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** call `ingestion(page)` from `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:25`.
  - It POSTs `tests/test-data/logs_data.json` (3848 records) to `${INGESTION_URL}/api/${org}/${streamName}/_json` with `streamName = "e2e_automate"`.
  - Reference usage: `tests/ui-testing/playwright-tests/Dashboards/interactive-dashboard-table.spec.js:39-40` (inside `beforeEach`).
- **Auth/org:** handled by `navigateToBase(page)` (`tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`) + the `cloud-auth` helpers (`getOrgIdentifier()`, `getAuthHeaders()`); org id defaults to `process.env.ORGNAME`. No extra setup needed.
- **Build the drillable table panel:** `setupTablePanelWithDimension(page, pm, dashboardName)` from `tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:213`.
  - Creates dashboard → add panel → chart type `table` → stream type `logs` → stream `e2e_automate` → x field `kubernetes_namespace_name`, y field `kubernetes_container_hash` → apply.
  - This produces the executed SQL `SELECT ... GROUP BY kubernetes_namespace_name` that makes the dimension column drillable (unit-proven at `web/src/composables/dashboard/usePanelDrilldown.spec.ts:230`).
- **Save + land on view page:** `buildTableAndView(page, pm, dashboardName)` at `tests/ui-testing/playwright-tests/Dashboards/interactive-dashboard-table.spec.js:30-35`:
  - `pm.dashboardPanelActions.waitForChartToRender()` (`tests/ui-testing/pages/dashboardPages/dashboard-panel-actions.js:268`)
  - `pm.dashboardPanelActions.savePanel()` (`:183`)
  - `pm.dashboardCellExplorer.waitForTableOnViewPage()` (`tests/ui-testing/pages/dashboardPages/dashboard-cell-explorer.js:44`)
- **Cleanup:** `cleanupTestDashboard(page, pm, dashboardName)` from `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:381` (→ `backToDashboardList` → `deleteDashboard`).
- **Page object for assertions:** `pm.dashboardCellExplorer` (`tests/ui-testing/pages/dashboardPages/dashboard-cell-explorer.js`) — `hasDrillableCell()`, `expectDrillableCellVisible()`, `openDrawerFromFirstDrillableCell()`, `expectDrawerOpen/Closed`, `closeDrawer()`, `toggleSql()`, `runQuery()`, `expectCellParamsInUrl()`, `expectNoCellParamsInUrl()`, plus locators `resultsTable`, `sqlToggle`, `sqlEditor`, `runButton`, `openInLogsButton`, `dateTime`, `eventDetailDrawer`.

## Preconditions / toggles

- **Stream type = logs, query type = sql (builder mode), NOT PromQL** — enforced by `setupTablePanelWithDimension` (PromQL would render `PromQLTableChart` with no drilldown).
- **NOT print mode** — drilldown icons are suppressed when `store.state.printMode` is set (`PanelSchemaRenderer.vue:58-59`).
- **No cross-linking config requirement** — the drawer opens regardless; `baseWhere` from `result_schema` only applies when `enable_cross_linking` is on (OSS default may be off → `baseWhere=""`, cell predicate alone still runs). Do **not** assert on `baseWhere` content.

## Timing / wait requirements (assert only AFTER the state hydrates)

1. **Drillable columns compute AFTER the panel query completes.** `computeCellDrilldownFields()` watches `metadata.value.queries` (the executed SQL) — before the query finishes, the icons don't exist. Always wait for the table rows first (`waitForTableOnViewPage` → `firstRow` visible), then assert the icon (`expectDrillableCellVisible`).
2. **The search icon is `opacity-0` until cell hover.** To *click* it, hover the row first: `openDrawerFromFirstDrillableCell()` does `firstRow.hover()` then `button.click()`. Presence checks (`count()`, `toBeAttached`) work without hover because the button is in the DOM.
3. **Drawer results are async.** After opening, wait for `log-explorer-results-table` to be visible (the drawer fires `searchService.search` on mount) — `expectDrawerOpen()` already does this with a 30s timeout.
4. **URL sync is a `router.replace`** (async) — use `expect.poll` on `searchParams` (already implemented in `expectCellParamsInUrl`), not an immediate `expect`.
5. **Schema/fields hydrate asynchronously** — do not query `field = value` before the drawer mounts; the drawer's own `onMounted → loadEvents` is the single source of truth.

## Gotchas (so the Healer/Engineer don't rediscover them)

- The dimension value clicked is the **first row's** `kubernetes_namespace_name`; it must be non-null in the ingested data (it is, in `logs_data.json`). The drawer's `cellWhere()` maps empty → `IS NULL`, so a null first cell would still open but return a different result set.
- The measure column (`kubernetes_container_hash`) **must not** show a drilldown icon — this is the negative assertion that proves "aggregates are not drillable" (only if a test asserts it; the current 7 tests don't).
- `o-drawer-close-btn` is the generic ODrawer close control — there may be more than one drawer in the DOM (cell drawer + optional event-detail drawer); scope to `cellDrawer.locator(...)`.
- Ingestion is idempotent-ish but accumulates: `ingestion()` re-POSTs the same 3848 records each test; the dashboard query window (last ~15m) still returns rows, so no per-test stream cleanup is needed. Streams are shared; do **not** delete `e2e_automate`.
- Cloud passcode can rotate mid-run → `ingestion()` already retries 401/403 with a config refresh; do not add extra auth handling.
