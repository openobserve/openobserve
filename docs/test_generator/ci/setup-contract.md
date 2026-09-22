# Test Setup Contract: Dashboard Chart Zoom Brush & Panel Drag  (area: Dashboards)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate`** **[shared/read-only]** — logs stream with a timestamp field + numeric/string fields.
  Fields the spec relies on:
  - `kubernetes_container_hash` (used as the **y-axis measure** for the "line" and "pie" panels)
  - `kubernetes_pod_name`, `kubernetes_container_name`, `kubernetes_namespace_name` (available for the multi-panel drag helper, which uses `kubernetes_container_name` y + `kubernetes_namespace_name` breakdown)
  - a timestamp field (the SQL `histogram(...)` x-axis; ECharts x-axis = timestamp, which is what the `dataZoom` brush converts into the absolute `from=`/`to=` range)
  Why: every test reads the same stream to build a saved panel (`buildSavedPanel` → line/pie) or two panels (`createDashboardWithMultiplePanels` → drag tests).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** `await ingestion(page)` — see `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:28`.
  Posts `logs_data.json` to `${INGESTION_URL}/api/${ORGNAME}/e2e_automate/_json`. It is already
  deduped per worker (`ingestedStreams` set), so calling it in `beforeEach` is cheap and idempotent.
  The spec already calls it in `test.beforeEach` (`dashboard-zoom-brush.spec.js:25-32`).
- **Create empty dashboard:** `await setupTestDashboard(page, pm, dashboardName)` —
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:356`.
- **Build a single saved panel (line/pie):** mirror `buildSavedPanel` in
  `dashboard-zoom-brush.spec.js:35-49`:
  `pm.dashboardCreate.addPanel()` → `pm.chartTypeSelector.selectChartType(chartType)` →
  `pm.chartTypeSelector.selectStreamType("logs")` → `pm.chartTypeSelector.selectStream("e2e_automate")`
  → `pm.chartTypeSelector.removeField("y_axis_1","y")` → `pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash","y")`
  → `pm.dashboardPanelActions.addPanelName(panelName)` → `applyDashboardBtn()` →
  `waitForChartToRender()` → `savePanel()`.
  (page objects: `tests/ui-testing/pages/dashboardPages/dashboard-chart.js` and `dashboard-panel-actions.js`.)
- **Build two panels (drag tests):** `await createDashboardWithMultiplePanels(page, pm, { dashboardName, panels: [{panelName:"Drag Panel A", panelTimeEnabled:false}, {panelName:"Drag Panel B", panelTimeEnabled:false}] })` —
  `tests/ui-testing/playwright-tests/Dashboards/utils/panelTimeSetup.js:239`. Returns `{ dashboardName, panelIds }`.
- **Auth/org:** `ORGNAME=default` (worker auth state / login is handled by the base fixtures +
  `navigateToBase(page)` from `../utils/enhanced-baseFixtures.js`). Do not re-login per test.
- **Cleanup:** `await cleanupTestDashboard(page, pm, dashboardName)` —
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:381`.

## Preconditions / toggles

- **Non-view-only mode:** grid drag + fullscreen are enabled only when `!viewOnly && !simplifiedPanelView`.
  A freshly created dashboard is already in edit mode; do not open a share/read-only link.
- **Chart type for zoom:** use `line` (brush + tint tests) or `pie` (negative test). `pie/donut/metric/gauge`
  disable the toolbox dataZoom (`contextBuilder.ts:745`).
- **Expanded panel:** for tint/stacking tests, open the fullscreen view first —
  `pm.dashboardZoomDrag.openExpandedPanel()` (hover the panel container, click
  `[data-test="dashboard-panel-fullscreen-btn"]`, wait for `[data-test="dashboard-viewpanel-close-btn"]`).

## Timing / state waits (do these BEFORE asserting, in this order)

1. `await pm.dashboardZoomDrag.waitForChartMounted()` — waits for `_echarts_instance_` + a **stable**
   canvas rect (≥200×80, geometry unchanged for 4 polls). The dashboard reflows after load, so a
   brush path resolved before this is offset by hundreds of pixels.
2. `await pm.dashboardPanelActions.verifyChartHasData(expect)` — asserts the "no data" placeholder is
   hidden and the canvas has non-background pixels (`dashboard-panel-actions.js:443`).
3. Brush/drag helpers already call `settleFrames()` (two rAFs) so the zrender selection cover is
   painted before sampling.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The zoom-brush → absolute-range assertion (TC-ZOOM-001) is expected to FAIL against current
  `main`** — the ChartRenderer emits `updated:dataZoom` (camelCase) but PanelSchemaRenderer listens
  `@updated:data-zoom` (kebab). Vue 3 does not normalize event-name case, so `onDataZoom` never fires
  and the URL stays `period=`. Plan this as a parked `test.fixme` (feature-incomplete) — do NOT spend
  Healer iterations "fixing" the test; the product wiring is the gap. (Evidence:
  `ChartRenderer.vue:153/472` vs `PanelSchemaRenderer.vue:98`.)
- **Canvas brush is not a DOM node** — always drive it with `page.mouse` drags on
  `[data-test="chart-renderer"] canvas`, never `locator.click`/`locator.dragTo`.
- **Brush path must be resolved fresh each time** — `resolveBrushPath()` reads the canvas bounding
  box; the expanded view swaps the host selector (`.grid-stack-item` → expanded selector), so call
  `waitForChartMounted()` again after `openExpandedPanel()`.
- **`readPanelLayout` reads `gs-x`/`gs-y` off the `.grid-stack-item[gs-id]` tile** — a panel's tile is
  only mounted when it is on-screen; use `waitForPanelTile(panelId)` first (off-screen panels render a
  placeholder, not the header bar).
- **Header drag vs body drag:** the header is `drag-allow`, the body `drag-cancel`. `dragPanelHeader`
  drags `[data-test="dashboard-panel-bar"]`; the body must NOT start a GridStack drag.
- **Tint thresholds are empirical** (`MIN_SELECTION_TINT=20`, `MAX_SELECTION_TINT=60`): the fill
  `rgba(0,191,255,0.15)` lifts (blue−red) ~38; ECharts' default near-grey ~5; a stacked cover past ~60.
  Keep these constants if the brush style is ever changed.
