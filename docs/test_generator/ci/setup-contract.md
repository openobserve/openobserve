# Test Setup Contract: Dashboard Chart Zoom Brush & Panel Drag  (area: Dashboards)

> Read by the Engineer (implements setup), the Healer and the Refiner (consult instead of
> blind-scanning on data/setup failures). Concrete names + file:line, no prose.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:

- **`e2e_automate` [shared/read-only]** — logs stream, ingested once per worker process.
  Fields (from `tests/test-data/logs_data.json`, 3848 records): `_timestamp`, `log`, `message`,
  `level`, `took`, `stream`, `kubernetes_container_hash`, `kubernetes_host`,
  `kubernetes_namespace_name`, `kubernetes_pod_name`, `method`, `code`, plus many
  `kubernetes.*` dotted fields (flattened to `kubernetes_*` at ingest).
  Why: the only stream every existing dashboard chart spec reads; the timestamp axis gives a
  time-series chart, and the high-cardinality string fields give a count-over-time line/bar.

  No per-test stream is required for this feature (no "no-data"/"non-text-field" edge case in the
  acceptance set). If a test needs an isolated stream, name it uniquely (see "How to create it").

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest the shared stream:** `ingestion(page)` (defaults to stream `e2e_automate`) —
  see `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:28-107`. It is
  deduped per process via the `ingestedStreams` Set, so calling it in `beforeEach` is cheap and safe.
  Typical call site: `tests/ui-testing/playwright-tests/Dashboards/dashboard-config-axis.spec.js:22-25`.
- **Create the dashboard:** `setupTestDashboard(page, pm, dashboardName)` —
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:356-371`.
- **Build a time-series chart panel (the exact shape the brush needs):**
  `pm.dashboardCreate.addPanel()` → `pm.chartTypeSelector.selectChartType("line")` (or `"bar"`) →
  `pm.chartTypeSelector.selectStreamType("logs")` → `pm.chartTypeSelector.selectStream("e2e_automate")`
  → `pm.chartTypeSelector.removeField("y_axis_1", "y")` → `pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y")`
  → `pm.dashboardPanelActions.addPanelName(panelName)` → `pm.dashboardPanelActions.applyDashboardBtn()`
  → `pm.dashboardPanelActions.savePanel()`.
  This is exactly `buildPanel` in `tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:104-128`
  (reused via `setupLinePanelWithConfig` / `setupBarPanel`). No explicit x-field means the builder
  groups by `_timestamp`, producing a true time-series chart (the brush's x-axis).
- **Add a second panel for the drag test:** `pm.dashboardPanelActions.addNextPanel()` then repeat the
  build-panel steps, or call `addSimplePanel` twice —
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:405-435`.
- **Auth/org:** `ORGNAME=default`; login via the standard auth state / `navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`. Ingestion auth via
  `getAuthHeaders()`/`getOrgIdentifier()` in `tests/ui-testing/playwright-tests/utils/cloud-auth.js`.
- **Cleanup:** `cleanupTestDashboard(page, pm, dashboardName)` —
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:381-389`.

## Preconditions / toggles

- **Non view-only / non simplified view:** createDashboard lands in normal edit view (drag enabled).
  Do NOT open the dashboard in report/share/print view, which sets `viewOnly` and disables the grid.
- **Non-SQL vs SQL mode:** the SQL builder is the default and configures the brush toolbox
  (`contextBuilder.ts:743-764`). No toggling needed; keep the default builder mode.
- **Annotation mode OFF:** the brush must zoom, not annotate. The Add-Annotation button only appears
  on hover for time-series panels; do not click it in the zoom test
  (`PanelContainer.vue:127-143`, `PanelSchemaRenderer.vue:1434-1437`).
- **Panel must be mounted:** panels are lazily mounted near the viewport
  (`RenderDashboardCharts.vue:445-513`). The first panel is mounted by default; if a test targets a
  lower panel, scroll it into view and wait for `[data-test="dashboard-panel-container"]` before acting.

## Waiting / timing (name the exact helpers to use)

- **Chart rendered:** `pm.dashboardPanelActions.waitForChartToRender()` then
  `pm.dashboardPanelActions.verifyChartHasData(expect)` —
  `tests/ui-testing/pages/dashboardPages/dashboard-panel-actions.js:270-280, 443-474`.
- **ECharts instance proof:** assert the host carries `_echarts_instance_`
  (pattern in `expectCustomChartRendered`, `dashboard-panel-actions.js:392-407`).
- **After brushing / dragging:** the observable state is the time range (zoom) or `gs-x`/`gs-y` (drag);
  poll those rather than canvas pixels (the chart `restoreChart()`s back to full range after zoom).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The brush is canvas-drawn, not a DOM button.** The toolbox `dataZoom` tool is auto-selected via
  `takeGlobalCursor dataZoomSelectActive:true` (`ChartRenderer.vue:499-504`), so a direct mouse drag on
  `[data-test="chart-renderer"] canvas` brushes. Do NOT hunt for a clickable toolbox node.
- **Drag only on the header, never the body.** The body is `drag-cancel` (`PanelContainer.vue:342-347`),
  and GridStack `draggable.cancel = ".drag-cancel"` (`RenderDashboardCharts.vue:858`). Dragging the chart
  body will brush-zoom or do nothing, not move the panel.
- **Assert the zoom via the time-range side effect, not the chart.** After a brush,
  `restoreChart()` resets the chart to full range (`ChartRenderer.vue:478`), so the chart looks unchanged.
  The real effect is `ViewDashboard.onDataZoom` → `setCustomDate("absolute", …)` + `refresh()`
  (`ViewDashboard.vue:1280-1300`): the global picker / URL flips from relative (`period=…`) to absolute
  (`from=`/`to=`). Assert the URL or `[data-test="dashboard-global-date-time-picker"]` label.
- **Equal-time guard:** brushing a degenerate range advances the end by 1 minute
  (`ViewDashboard.vue:1290-1293`), so a too-small drag still yields a valid absolute range.
- **Schema arrives async:** `verifyChartHasData` already waits for painted pixels; do not assert before
  it, or the resolver may see an empty series list and report "no data".
- **GridStack is 192 columns, cellHeight 17px, margin 4** (`RenderDashboardCharts.vue:849-855`). A
  single panel defaults to `w=96,h=18` (half width), so a drag has plenty of cells to move into; two
  stacked panels make an order-swap assertion unambiguous.
