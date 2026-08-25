# Test Setup Contract: Dashboard Table Virtual Scroll Row Windowing  (area: Dashboards)

> Read by the **Engineer** (implements setup), the **Healer** and the **Refiner** (consult on data/setup
> failures). Everything below is copied from existing, proven helpers — do NOT invent new setup.

## Streams / data the spec must establish

The single hard precondition for this feature is **more table rows than fit in the panel viewport**
(viewport + ~20 overscan ≈ 40–60 rows). The shared fixture already provides this.

- **`e2e_automate` [shared/read-only]** — 3848 log records (`tests/test-data/logs_data.json`) ingested
  once via the existing helper. Highest-cardinality flattened fields (post-ingestion schema):
  `log` (2554 distinct), `took` (156), `message` (25), `kubernetes_pod_name` (11), `kubernetes_container_name` (7).
  Why: every virtual-scroll behavior just READS this stream; grouping by `log` or `SELECT *` yields the
  large row set needed to exercise windowing.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest** (in `beforeEach`): `await ingestion(page);`
  — from `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js` (helper), invoked exactly
  as in `tests/ui-testing/playwright-tests/Dashboards/dashboard-table-chart.spec.js:60`.
- **Navigate + dashboard scaffold**:
  ```js
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);                       // from utils/dashCreation.js
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);
  ```
  — see `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:246` (`setupTestDashboard`).
- **Build a large-row table panel** (primary — most deterministic row count, ~3848 rows):
  ```js
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType("table");
  // Custom SQL path (copy from dashboard-table-pagination.spec.js:929–936):
  await page.locator('[data-test="dashboard-sql-query-type"]').click();
  await page.locator('[data-test="dashboard-custom-query-type"]').click();
  await page.locator('[data-test="dashboard-panel-query-editor"]').getByRole('code').click();
  await page.locator('[data-test="dashboard-panel-query-editor"]').locator('.inputarea').fill(
    'SELECT * FROM "e2e_automate"'
  );
  await pm.chartTypeSelector.searchAndAddField("log", "y");   // add a field so table column list is non-empty
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender();
  await pm.chartTypeSelector.waitForTableDataLoad();
  ```
  Alternative (builder, ~2554 rows, 2 columns): X = `log`, Y = `code` with `count` — see
  `dashboard-table-chart.spec.js:355–358` (`searchAndAddField("_timestamp","x")` + `configureYAxisFunction`).
- **Raise query limit if the server caps row count** (optional safety):
  `await pm.dashboardPanelConfigs.selectQueryLimit("5000");` — selector `[data-test="dashboard-config-limit"]`,
  method at `tests/ui-testing/pages/dashboardPages/dashboard-panel-configs.js:165`.
- **Auth/org**: reuse `navigateToBase(page)` + `ingestion(page)` as in the table specs; `ORGNAME`/`INGESTION_URL`
  env vars are set by the CI harness (same as every other Dashboards spec — no extra setup).
- **Timing**: after Apply, wait with `pm.chartTypeSelector.waitForTableDataLoad()` (used throughout
  `dashboard-table-chart.spec.js`). Then poll until `.dashboard-data-row` is populated before asserting
  row counts — the rows hydrate asynchronously after the search response.

## Preconditions / toggles

- **Virtual scroll is the DEFAULT** — do NOT enable pagination and do NOT enable wrap cells for the
  primary/scroll workflows. `dashVirtualEnabled = !useVirtualScroll && !showPagination && !wrap`
  (TenstackTable.vue:1306–1308); TableRenderer always passes `use-virtual-scroll=false`.
- **Wrap cells OFF**: default. Enable via `[data-test="dashboard-config-wrap-table-cells"]` ONLY for the
  fallback test.
- **Pagination OFF**: default. Enable via `[data-test="dashboard-config-show-pagination"]` + set
  `[data-test="dashboard-config-rows-per-page"]` ONLY for the fallback test.
- **Scroll container**: `.table-container` inside `[data-test="dashboard-panel-table"]` is the scrollable
  element. Drive scroll in-page, e.g.:
  `await page.locator('[data-test="dashboard-panel-table"] .table-container').evaluate(el => el.scrollTop = el.scrollHeight);`
  then poll until the minimum rendered `data-index` changes (window re-renders asynchronously via
  ResizeObserver/`virtualRows` watcher).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Small dataset → no windowing observable.** If the query returns ≤ ~40 rows, `dashWindowStart=0` /
  `dashWindowEnd=total` and `dashVirtualPaddingTop/Bottom=0`, so there are NO spacer rows and all rows
  are in the DOM. Always use the large-row query (`SELECT *` or X=`log`).
- **Spacer rows have no class/data-test** — only `aria-hidden="true"`. They are `tbody tr` without
  `.dashboard-data-row`, so `tr.dashboard-data-row` correctly excludes them; but to assert spacers, use
  `tbody tr[aria-hidden="true"]` (fragile) — consider asserting window size via `data-index` instead.
- **`data-index` is the full-dataset index**, not the window position. Assert the *window* by reading
  min/max `data-index` of rendered rows, not by counting 0..n.
- **`getTableRowCount()` (dashboard-panel-actions.js:115) counts DOM `tbody tr`**, so under virtual scroll
  it returns the windowed count, NOT the total. Do not use it to assert total dataset size — use it to
  assert the window is bounded.
- **Scroll re-render is async** — after setting `scrollTop`, the `virtualRows` watcher + ResizeObserver
  batch updates on the next tick(s). Poll with `expect.poll` / `waitForFunction` on `data-index`, don't
  assert immediately after scrolling.
- **Pivot mode** keeps the full row model (`dashWindowed=false`) but still virtualizes the DOM; don't
  assert "no windowing" for pivot — only "model not windowed" (unobservable in DOM) and "DOM virtualized".
