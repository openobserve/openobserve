# Test Setup Contract: Dashboard Chart Context Menu (Scatter)  (area: Dashboards)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate` [shared/read-only]** — a pre-seeded logs stream used across every dashboard spec. Fields (numeric, for scatter X/Y): `took` (int), `FloatValue` (float), `code` (int); string fields: `kubernetes_container_name`, `kubernetes.namespace_name`, `level`, `method`, `stream`. Why: the scatter panel needs numeric X and Y axes to render and to yield a numeric y-value for the alert threshold; every context-menu test just reads it.
  - **Scatter panel field choices:** X = `took`, Y = `FloatValue` (both numeric, present in the fixture — verified in `tests/test-data/logs_data.json`).

## How to create it (copy these EXACT patterns — do NOT invent setup)
- Ingest: call `ingestion(page)` from `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:28` (defaults to `e2e_automate`). It is idempotent (memoized per org:stream via `ingestedStreams` Set) — safe to call in `beforeEach`.
  - Reference usage: `tests/ui-testing/playwright-tests/Dashboards/dashboard-create-alert.spec.js:50-62`.
- Auth/org: after `navigateToBase(page)` force the correct org with
  `await page.goto(`${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=default`);`
  (`dashboard-create-alert.spec.js:58-61`). This avoids landing on the wrong org's dashboards on cloud.
- Build the scatter panel exactly like the bar/line alert tests (`dashboard-create-alert.spec.js:150-181`), substituting the chart type and fields:
  1. `await pm.dashboardList.menuItem("dashboards-item"); await waitForDashboardPage(page);`
  2. `await pm.dashboardCreate.createDashboard(dashName);`
  3. `await pm.dashboardCreate.addPanel();`
  4. `await pm.dashboardPanelActions.addPanelName(panelName);`
  5. `await pm.chartTypeSelector.selectChartType("scatter");`  ← supported (`ChartSelection.vue` id `scatter`)
  6. `await pm.chartTypeSelector.selectStreamType("logs");`
  7. `await pm.chartTypeSelector.selectStream("e2e_automate");`
  8. `await pm.chartTypeSelector.searchAndAddField("took", "x");`
  9. `await pm.chartTypeSelector.searchAndAddField("FloatValue", "y");`
  10. `const streamPromise = waitForStreamComplete(page); await pm.dashboardPanelActions.applyDashboardBtn(); await streamPromise; await pm.dashboardPanelActions.waitForChartToRender();`
  11. `const dashboardStreamPromise = waitForStreamComplete(page, 30000); await pm.dashboardPanelActions.savePanel(); await dashboardStreamPromise;`
- Right-click + assert menu (existing helpers, no new ones needed):
  - `await pm.dashboardPanelEdit.rightClickChartForAlert();` (`dashboard-panel-edit.js:221-253`) — waits for chart visible, waits for `[data-test="no-data"]` hidden, right-clicks chart center with retries.
  - `await pm.dashboardPanelEdit.expectAlertContextMenuVisible();`
  - `pm.dashboardPanelEdit.getAlertContextMenuAbove()` / `getAlertContextMenuBelow()` for item assertions.
  - `pm.dashboardPanelEdit.selectAlertAboveThreshold()` / `selectAlertBelowThreshold()` — **use `dispatchEvent("click")`**, not `click({force:true})` (menu is `<teleport to="body">` under overlays; see `dashboard-panel-edit.js:265-281`).
  - `pm.dashboardPanelEdit.clickOutsideContextMenu()` + `expectAlertContextMenuHidden()` for the dismiss case.
- Alert-navigation assertion (same as `dashboard-create-alert.spec.js:200-205, 283-289`):
  `await Promise.all([page.waitForURL(/.*alerts\/add.*prefill=panel.*/, { timeout: 15000 }), pm.dashboardPanelEdit.selectAlertAboveThreshold()]);`
  then assert `page.url()` contains `prefill=panel` and does **not** contain `panelData=`.

## Preconditions / toggles
- The menu only opens when `allowAlertCreation` is truthy — the dashboard **view** (`ViewDashboard.vue:284`) sets it `true`, so tests must be on the saved dashboard view (after `savePanel()`), not the panel editor.
- Non-SQL mode is irrelevant here (SQL vs PromQL only changes y-axis-column extraction, not menu visibility). Use the default SQL builder path.
- The scatter chart is `type: "scatter"` in the ECharts series (`sqlChartSeriesProps.ts:47-52`), which is exactly what the `ChartRenderer` whitelist (`CONTEXT_MENU_SERIES_TYPES = ["bar","line","scatter"]`, `ChartRenderer.vue:149`) matches — no extra toggle needed.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **No-data overlay intercepts the right-click.** After `savePanel()`, a same-sized `[data-test="no-data"]` overlay covers the chart until the re-query resolves. `rightClickChartForAlert()` already waits for it to be `hidden`, but if you hand-roll the right-click, wait for `[data-test="no-data"]` hidden first or the click lands on the overlay.
- **Menu items need `dispatchEvent("click")`.** The menu teleports to `body` under overlays; `click({force:true})` can be intercepted. The page object already wraps this (`selectAlertAboveThreshold`/`Below`).
- **Scatter needs numeric X AND Y.** The bar/line tests used string `kubernetes_container_name` for Y (grouped/count); scatter renders a real cartesian numeric Y axis. Use `took` (X) + `FloatValue` (Y) — both numeric in `e2e_automate`. A non-numeric y-axis would make `handleNativeContextMenu` skip the emit (`!isNaN(Number(yAxisValue))` check, `ChartRenderer.vue:412`).
- **Wait for the real stream completion, not the first response.** `_search_stream` is SSE/chunked; use `waitForStreamComplete(page)` (from `tests/ui-testing/playwright-tests/utils/streaming-helpers.js`) after Apply and after Save (see `dashboard-create-alert.spec.js:166-181`), then `getChartRendererCanvasElement().first().waitFor({ state: "visible" })`.
- **Cleanup order:** after a test lands on the alert form, use `returnToDashboardFolder(page, pm)` (`dashboard-create-alert.spec.js:26-45`) before `deleteDashboard(...)`, because the sidebar can land on the wrong org after visiting Alerts.
- **Chart renderer is a `div`, not a `canvas`.** `[data-test="chart-renderer"]` is the container div; `getChartRendererCanvasElement()` resolves to the inner `<canvas>` (`dashboard-panel-actions.js:117-119`). Right-click the container (`rightClickChartForAlert()` already does).
