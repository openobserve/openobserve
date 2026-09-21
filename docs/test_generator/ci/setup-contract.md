# Test Setup Contract: Dashboard Cell Explorer Log Detail  (area: Dashboards)

The new spec is `tests/ui-testing/playwright-tests/Dashboards/dashboard-cell-explorer-detail.spec.js`
(playwright group `Dashboards-Core`). It reuses the exact same data/stream setup as the existing
`interactive-dashboard-table.spec.js`, then drives the *detail* surface inside the drawer.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:

- **`e2e_automate` [shared/read-only]** — fields: `_timestamp` (server-assigned), plus the
  `tests/test-data/logs_data.json` keys (`log`, `message`, `kubernetes.namespace_name` →
  surfaced as `kubernetes_namespace_name`, `kubernetes.container_hash` → `kubernetes_container_hash`,
  `job`, `level`, `FloatValue`, …). 3848 records. **Why:** every detail-view behavior reads this —
  results list (`SELECT * WHERE <dim> = <value>`), field-anomaly profile, timeline histogram
  (`histogram(_timestamp, ...)`), log patterns (`patternsService.extractPatterns`), and surrounding
  events (search ±N min). The `log` field is the message column the results rows highlight; the
  `kubernetes_namespace_name` dimension is what makes the table cell drillable.

No `[per-test]` stream is required: no test mutates the stream, and every test only reads it.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** `await ingestion(page);` (defaults to stream `e2e_automate`) — see
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:28`. It POSTs
  `tests/test-data/logs_data.json` to `${INGESTION_URL}/api/<org>/e2e_automate/_json`, dedupes per
  `org:stream` across the worker process, and retries 401/403/5xx. Put it in `test.beforeEach`.
- **Build the drillable table panel:** `setupTablePanelWithDimension(page, pm, dashboardName)`
  (x = `kubernetes_namespace_name`, y = `kubernetes_container_hash`) — see
  `tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:213`, then
  `await pm.dashboardPanelActions.waitForChartToRender(); await pm.dashboardPanelActions.savePanel();`.
- **Land on the view page:** `await pm.dashboardCellExplorer.waitForTableOnViewPage();` — see
  `tests/ui-testing/pages/dashboardPages/dashboard-cell-explorer.js:46`.
- **Open the drawer with results:** `await pm.dashboardCellExplorer.openDrawerFromFirstDrillableCell();`
  — see `dashboard-cell-explorer.js:84` (reveals `dashboard-table-cell-drilldown-*`, clicks it,
  waits for `log-explorer-results-table`).
- **Cleanup:** `await cleanupTestDashboard(page, pm, dashboardName);` — see
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js` (`deleteDashboard`). Import
  path in the spec: `import { cleanupTestDashboard } from "./utils/dashCreation.js";`
- **Auth/org:** none special — use `navigateToBase(page)` from
  `../utils/enhanced-baseFixtures.js` (same as `interactive-dashboard-table.spec.js`); ingestion
  reads `ORGNAME`/`INGESTION_URL` and `getAuthHeaders()` from `utils/cloud-auth.js`.
- **Dashboard name:** `generateDashboardName()` from `configPanelHelpers.js:83`.

## NEW page-object work (the existing cell-explorer page object is list-only)

`tests/ui-testing/pages/dashboardPages/dashboard-cell-explorer.js` currently stops at the drawer
open / results table. The detail surface selectors are NOT yet in a page object. The Engineer
should extend it (or add a new helper) with at least:

- `detailBackBtn = [data-test="log-explorer-detail-back"]`
- `detailPrevBtn = [data-test="log-explorer-detail-prev"]`, `detailNextBtn = [data-test="log-explorer-detail-next"]`
- `insightsTab = [data-test="log-detail-insights-tab"]`, `jsonTab = [data-test="log-detail-json-tab"]`, `tableTab = [data-test="log-detail-table-tab"]`
- `rowOpen = [data-test="log-explorer-row-open"]` (first result row)
- `openDetailFromFirstRow()` — wait for `log-explorer-results-table`, click the first `log-explorer-row-open`, wait for `log-explorer-detail-back` visible.

## Preconditions / toggles

- **Non-SQL / quick-mode:** none. The drawer runs its own SQL; no logs-page toggles needed.
- **Time range:** the drawer inherits the panel's `startTime`/`endTime` (metadata or selected
  time). The `e2e_automate` fixture uses `_timestamp` auto-assigned at ingest time; the dashboard's
  default relative range (`15m`) must cover the ingested data — the existing
  `interactive-dashboard-table.spec.js` already relies on this and works, so no extra range setup.
- **Enterprise toggles:** NONE must be enabled. Correlation tabs and AI actions are
  `config.isEnterprise === "true"`-gated (`DetailTable.vue:797`) and are OUT OF SCOPE for this OSS
  spec — do not assert on `correlated-*` tabs, `logs-detail-ai-context-btn`, or AI/regex actions.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The detail view is NOT a drawer.** It replaces the results list in place. Do not look for the
  removed `log-explorer-event-detail-drawer` selector — it no longer exists (the current
  `dashboard-cell-explorer.js:39` still references it and is stale). Assert on
  `log-explorer-detail-back` for "detail is open".
- **Row chevron is `log-explorer-row-open`**, not `log-explorer-detail-search` (that selector was
  removed in this change).
- **Prev/next need ≥2 rows.** They're disabled at the bounds (`hasPrev`/`hasNext`). The
  `kubernetes_namespace_name` dimension has many rows per value, so the first drilled cell yields
  ≥2 events — but if a test wants to step, assert the "n / m" counter or the button enabled state,
  and don't step past the last event.
- **Insights sections load async after detail opens** (histogram + patterns + surrounding are
  fired by `loadInsights`). Assert on the section *content*, not on immediate presence of
  `timeline`/`insightPatterns`/`surroundEvents`. Patterns/surrounding may legitimately be empty —
  the empty-state text (`patternsEmpty`/`contextEmpty`) is a valid outcome, not a failure.
- **Field-anomaly profile is synchronous** — it renders immediately from `events` + `selectedEvent`;
  it's the most reliable "detail actually rendered" signal.
- **`cell_*` URL cleanup on drawer close** is already covered by
  `interactive-dashboard-table.spec.js`; this spec is the *detail* surface, so prefer asserting on
  `cell_event_ts` presence (written by `openEventDetail`) rather than re-testing the close cleanup.
- **Copy-link button has NO `data-test`** (`DashboardLogDrawer.vue:978`). Locate it by the i18n
  label `panel.logExplorer.detail.copyLink` (or flag `NEEDS SELECTOR`), and assert the clipboard
  (Playwright `context.grantPermissions(['clipboard-read'])`) only if the environment allows it.
- **Table-tab wrap toggle is `v-show`, not `v-if`** (`DetailTable.vue:74`) — it exists on every tab
  but is only visible when `tab === 'table'`; use `toBeVisible()` after switching to the table tab.
- **Flattened/Original JSON toggle may be absent** when the event lacks `_o2_id` or the panel is
  multi/aggregated (`JsonPreview.vue:727`). Don't assert it unconditionally.
