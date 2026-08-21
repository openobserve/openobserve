# Test Setup Contract: Dashboard Add-Panel Chart Selection Icons (SVG + Dark Mode)
(area: Dashboards · slug: `dashboard-chart-selection` · spec: `dashboard-chart-selection.spec.js`)

This contract tells the Engineer EXACTLY what data/state each test needs and the EXISTING
helper to establish it. Do not invent setup — copy the referenced patterns.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — set up ONCE per file (beforeAll/beforeEach), every test just reads it.
- **`[per-test]`** — one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate`** (logs stream) **[shared/read-only]** — fields include
  `kubernetes_container_hash`, `kubernetes_pod_name`, `_timestamp` (plus many more; see
  `tests/ui-testing/test-data/logs_data.json`). Why: needed only for the one test that actually
  **applies** a selected chart and expects a rendered chart. The icon-render / selection /
  tooltip / dark-mode tests do NOT need this stream (ChartSelection renders before any stream
  is chosen).

- **`default`** (metrics stream) **[per-test: PromQL-disable TC]** — a metrics stream created by
  the one-time metrics ingestion. Why: the PromQL query-type toggle
  (`[data-test="dashboard-promql-query-type"]`) only renders when `stream_type == "metrics"`
  (`QueryTypeSelector.vue:30-41`); selecting it is what flips `queryType` → `promqlMode` and
  disables the `sankey` chart tile.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth / base navigation:**
  `await navigateToBase(page);` from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`
  (every Dashboard spec starts with it, e.g. `dashboard-pie-donut.spec.js:52`). ORG =
  `process.env.ORGNAME ?? "default"`; root-user login is handled by the base fixture.

- **Logs data ingest (only for the render-a-chart test):**
  ```js
  import { ingestion } from "./utils/dashIngestion.js";
  await ingestion(page); // streamName defaults to "e2e_automate"
  ```
  Reference: `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:25` (export),
  and usage in `dashboard-pie-donut.spec.js:58` (called in `beforeEach`).
  Posts `logs_data.json` to `/api/{org}/e2e_automate/_json`.

- **Metrics data ingest (only for the PromQL-disable test):**
  ```js
  import { ensureMetricsIngested } from '../utils/shared-metrics-setup.js';
  // in test.beforeAll (not beforeEach) — one-time across the file:
  await ensureMetricsIngested();
  ```
  Reference: `tests/ui-testing/playwright-tests/Dashboards/dashboard-config-promql.spec.js:28-30`;
  helper in `tests/ui-testing/playwright-tests/utils/shared-metrics-setup.js:12`.
  Creates the metrics stream named **`default`** (`metrics-ingestion.js:39`).

- **Dashboard + add-panel (every test):**
  ```js
  const pm = new PageManager(page);
  const dashboardName = generateDashboardName();      // from ./utils/configPanelHelpers.js:83
  await setupTestDashboard(page, pm, dashboardName);  // ./utils/dashCreation.js:356
  await pm.dashboardCreate.addPanel();                // dashboard-create.js:388 (empty dashboard)
  ```
  `setupTestDashboard` = menuItem("dashboards-item") → `createDashboard(name)` → lands on view.
  `addPanel()` clicks `[data-test="dashboard-if-no-panel-add-panel-btn"]` and waits for the
  panel editor (waits for `[data-test="dashboard-apply"]` OR any `[data-test^="selected-chart-"]`).

- **Select a chart type (every test that changes selection):**
  `await pm.chartTypeSelector.selectChartType("pie");`
  Reference: `tests/ui-testing/pages/dashboardPages/dashboard-chart.js:117`
  (registered as `pm.chartTypeSelector` in `page-manager.js:139`).
  It waits for the panel editor, then clicks `[data-test="selected-chart-{type}-item"]`.

- **PromQL mode (only the PromQL-disable test):** copy `buildPromQLPanel` —
  `tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:287-337`:
  ```
  addPanel → selectChartType(...) → selectStreamType("metrics")
  → click [data-test="dashboard-promql-query-type"]   (only visible after metrics stream-type)
  ```
  For the disable assertion you do NOT need to enter a query / apply — after selecting the
  metrics stream and clicking the PromQL toggle, `promqlMode` is true and `sankey` disables.
  (Reuse `buildPromQLPanel` itself is acceptable, but it also applies a query + waits for
  render — overkill for a pure "sankey is disabled" assertion.)

- **Dark mode (only the dark-mode test):**
  `await pm.themePage.switchToDarkMode();` (and `switchToLightMode()` to restore) —
  `tests/ui-testing/pages/generalPages/themePage.js:156-166`. The toggle button is
  `[data-test="navbar-theme-toggle-btn"]`; `isDarkMode()` checks `.dark` on `<html>`.

- **Teardown (every test):**
  `await cleanupTestDashboard(page, pm, dashboardName);` — `dashCreation.js:381`
  (back to list → search → delete).

## Preconditions / toggles

- **Default selected chart = `bar`.** A fresh add-panel seeds `data.type = "bar"`
  (`useDashboardPanelDefaults.ts:20`). So on open, `[data-test="selected-chart-bar-item"]`
  carries `data-selected="true"` and its `<li>` has `data-test-selected="bar"`. Do NOT assume
  `line` (the `CHART_LINE_ITEM` selector in `dashboard-selectors.js:98` is for the LOGS
  visualize flow, not the dashboard add-panel).
- **Non-SQL/PromQL default:** a fresh panel is SQL+builder mode (`stream_type: "logs"`,
  `queryType: "sql"`), so NO chart type is disabled by default — the PromQL disable path must
  be explicitly entered via the metrics stream.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **The selected-state signal is async.** `addPanel()` only waits for the FIRST
   `[data-test^="selected-chart-"]` to be visible, not for `data-test-selected` to be assigned.
   `initializePanel()` assigns `data.type` after mount. Before asserting the default/selected
   highlight, wait for the source-side signal:
   `[data-test="dashboard-addpanel-chart-selection-item"][data-test-selected]`
   (exactly what `logsPage.js:10414-10417` waits on). Same wait applies after clicking a chart.
2. **`custom_chart` id uses an underscore** → selector is `selected-chart-custom_chart-item`
   (not `custom-chart`). `selected-chart-{id}` is a literal template string in the component
   (`ChartSelection.vue:36`), so id casing/underscores are preserved verbatim.
3. **20 items, not fewer.** `chartsArray` has exactly 20 entries; `sankey` is the ONLY id
   absent from `promqlAllowedCharts`. Assert `count == 20` for the icon list.
4. **Tooltip has a shared selector.** Every tooltip bubble is `[data-test="o-tooltip-content"]`
   (component-owned, `OTooltip.vue:217`). Assert tooltip TEXT (localized title) via that
   selector's textContent, not a per-chart `data-test`. Hover the chart tile to open it.
5. **`maps` icon is wider.** `maps` uses `h-6 w-8`; others `h-6 w-6` (`ChartSelection.vue:44`).
   Don't assert uniform icon dimensions.
6. **Icon `src` is environment-dependent** (`getPath()` returns `/web/...` or ``), so assert
   the `<img>` exists + its `alt` (localized title), not the raw `src` URL.
7. **PromQL toggle is hidden until metrics stream-type is selected.** Clicking it without
   `selectStreamType("metrics")` first fails with a hidden-element actionability error.
   Selecting a metrics stream is itself async — reuse `selectStreamType("metrics")` which
   waits for networkidle before proceeding (`dashboard-chart.js:142-154`).
8. **Dark-mode test must restore light mode** (parallel files share the org; a leaked dark
   theme bleeds into other specs). Use `switchToLightMode()` in a `finally`/afterEach.
9. **Icon rendering needs NO data** — do not make the icon-list / selection / tooltip tests
   depend on `ingestion()`; it only adds runtime and coupling. Only the "selected chart
   renders" test needs `e2e_automate`.
