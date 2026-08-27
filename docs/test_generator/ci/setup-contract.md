# Test Setup Contract: Dashboard Table Cell Copy & Drilldown Actions  (area: Dashboards)

## Streams / data the spec must establish

- **`e2e_automate` [shared/read-only]** — logs stream ingested once per test via `ingestion(page)`.
  Fields (from `tests/test-data/logs_data.json`): `_timestamp`, `code`, `kubernetes_container_name`,
  `kubernetes_host`, `kubernetes_namespace_name`, `log`, `level`, `message`, `method`, `took`, and
  many `kubernetes.*` labels. Why: every test in this spec just READS it — copy tests use
  `_timestamp` (X) + `code` (Y=count) and `kubernetes_container_name`/`kubernetes_host` (pivot); a
  drilldown test uses a **plain** X column (`_timestamp` or `kubernetes_container_name`) so the
  drilldown icon renders.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** `await ingestion(page);` — `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:25`.
  It POSTs `logs_data.json` to `/api/<org>/e2e_automate/_json`. Existing call site:
  `tests/ui-testing/playwright-tests/Dashboards/dashboard-table-copy-cell.spec.js:45` (in `beforeEach`).
- **Dashboard lifecycle:** `setupTestDashboard(page, pm, dashboardName)` →
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:356`; cleanup →
  `cleanupTestDashboard(page, pm, dashboardName)` → `dashCreation.js:381`.
- **Panel creation sequence** (copy the existing spec verbatim — `dashboard-table-copy-cell.spec.js:57-73`):
  1. `await pm.dashboardCreate.addPanel();`
  2. `await pm.dashboardPanelActions.addPanelName("<unique name>");`
  3. `await pm.chartTypeSelector.selectChartType("table");`
  4. `await pm.chartTypeSelector.selectStreamType("logs");`
  5. `await pm.chartTypeSelector.selectStream("e2e_automate");`
  6. Configure fields:
     - Regular table: `searchAndAddField("_timestamp", "x")`, `removeField("y_axis_1", "y")`,
       `searchAndAddField("code", "y")`, `configureYAxisFunction("y_axis_1", "count")`.
     - Pivot table: `searchAndAddField("kubernetes_container_name", "x")`,
       `searchAndAddField("kubernetes_host", "p")`, `configureYAxisFunction("y_axis_1", "count")`.
     - **Drilldown test (new):** keep the X axis a plain field (e.g. `_timestamp` or
       `kubernetes_container_name`) — do NOT aggregate it; the Y axis may be `count`.
  7. `const streamPromise = waitForStreamComplete(page); await pm.dashboardPanelActions.applyDashboardBtn(); await streamPromise;`
  8. `await pm.chartTypeSelector.waitForTableDataLoad();`
- **Cell interaction pattern** (copy the existing spec — `dashboard-table-copy-cell.spec.js:114-122`):
  ```js
  const firstRow = pm.dashboardPanelActions.getTableDataRows().first();
  const firstCell = firstRow.locator("td").first();
  await firstCell.hover();
  const copyBtn = page.locator("[data-test^='dashboard-table-cell-copy-']").first();
  await copyBtn.waitFor({ state: "visible", timeout: 5000 });
  await copyBtn.click({ force: true });
  ```
  For **drilldown**, use `page.locator("[data-test^='dashboard-table-cell-drilldown-']").first()` on a
  **plain** column's cell, then assert the drawer:
  `page.locator('[data-test="dashboard-cell-explorer-drawer"]')` visible and
  `page.locator('[data-test="log-explorer-results-table"]')` present.
- **Auth/org:** `navigateToBase(page)` (from `enhanced-baseFixtures.js`); org id via
  `getOrgIdentifier()`, auth via `getAuthHeaders()` (see `dashIngestion.js:26-83`). No extra login step
  — the base fixture already authenticates.

## Preconditions / toggles
- Non-SQL build mode (SQL mode toggle is irrelevant here; table panels use the field-picker UI).
- Clipboard permission granted (already configured in `playwright.config.js`); tests read
  `navigator.clipboard.readText()`.
- Print mode must be OFF — `drilldownColumns`/`drilldownAllColumns` are suppressed in print mode
  (`PanelSchemaRenderer.vue:58-59`). Dashboard view defaults are fine.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Drilldown icon is column-dependent**: it appears only on **plain (non-aggregated) columns**. Hover
  the X-axis `_timestamp`/`kubernetes_container_name` cell to see `dashboard-table-cell-drilldown-*`;
  hovering the aggregated Y-axis `count(code)` column shows only the copy button. A negative assertion
  "no drilldown button on the count column" is valid.
- **Apply is async** — `applyDashboardBtn()` returns while the query is in flight. Always
  `waitForStreamComplete` + `waitForTableDataLoad()` before reading/hovering cells (see
  `dashboard-table-helpers.js` `waitForPanelTableSettled` for the same rationale).
- **The hover toolbar is teleported to `<body>`** and positioned from the pointer; a `hover()` must
  land on the real `<td>` and the button locator must `waitFor({state:"visible"})` after hover. Use
  `.first()` — only one cell is hovered at a time.
- **Copy feedback is transient**: the `check` icon / `data-copied="true"` clears after 2000 ms; assert
  the clipboard value (stable) rather than racing the icon state.
- **`getTableCellText`** (`dashboard-table-helpers.js:148`) already strips the copy buttons from cell
  text — use it to read the displayed value for the "clipboard equals display" assertion.
- **The two `source_files` `MetricsExplorer.vue` / `useStreams.ts` are NOT on this path** — do not
  import or target them; they were included for the enclosing commit's metrics-explorer change.
