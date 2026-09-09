# Test Setup Contract: Dashboard Chart Print SVG Scaling  (area: Dashboards)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `e2e_automate` **[shared/read-only]** — fields include `kubernetes_container_name`,
  `kubernetes.namespace_name`, `message`, `level`, `took`, `FloatValue`, `log`, `stream`, etc.
  (3848 records in `tests/test-data/logs_data.json`). Why: the metric panel's Y-axis
  field (e.g. `kubernetes_container_name` with `count`/`Distinct` aggregate, or custom
  SQL `SELECT count(*) AS alias FROM "e2e_automate"`) pulls from this stream; every
  print test just READS it.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- Ingest: `import { ingestion } from "./utils/dashIngestion.js"; await ingestion(page);`
  (ingests `logs_data.json` → `e2e_automate`).
  Reference: `tests/ui-testing/playwright-tests/Dashboards/dashboard-metric-camelcase.spec.js:20`
  and the shared helper `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:28`.
  (Ingestion is memoized per worker via `ingestedStreams`; repeated `beforeEach` calls no-op.)
- Auth/org: reuse the standard worker auth state / `navigateToBase(page)` from the
  enhanced base fixture — see `tests/ui-testing/playwright-tests/Dashboards/dashboard-metric-camelcase.spec.js:19`.
- Create dashboard + metric panel (the canonical recipe, all from
  `dashboard-metric-camelcase.spec.js`):
  1. `await pm.dashboardList.menuItem("dashboards-item");` then
     `await waitForDashboardPage(page);` (import from `./utils/dashCreation.js`).
  2. `await pm.dashboardCreate.createDashboard(dashboardName);` (unique name).
  3. `await pm.dashboardCreate.addPanel();`
  4. `await pm.dashboardPanelActions.addPanelName(panelName);`
  5. `await pm.chartTypeSelector.selectChartType("metric");`  ← **this is what makes it SVG**
  6. Builder mode: `await pm.chartTypeSelector.selectStream(STREAM_NAME);` then
     `await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");`
     (drop the auto-seeded `y_axis_1` first via `removeField("y_axis_1","y")`).
     OR custom SQL: `await pm.chartTypeSelector.switchToCustomQueryMode();` +
     `await pm.chartTypeSelector.enterCustomSQL('SELECT count(*) AS countRecords FROM "e2e_automate"');`
     + `ensureSingleYField(page, "countRecords")`.
  7. `await pm.dashboardPanelActions.applyDashboardBtn();` then
     `await pm.dashboardPanelActions.waitForChartToRender();`
  8. Save: `await pm.dashboardPanelActions.savePanel();`
- Reference for the exact metric recipe (incl. the `ensureSingleYField` reconciliation
  and the "re-apply if No Data" retry loop): `dashboard-metric-camelcase.spec.js:46-125`.

## Preconditions / toggles
- Print mode is entered by clicking `[data-test="dashboard-print-btn"]`
  (`ViewDashboard.vue:166`). This flips `store.state.printMode` → `true` and re-queries
  every panel via `forceLoad`. **Do not** set `store.printMode` directly from the test —
  use the button (or load with `?print=true`) so the full re-render chain runs.
- The metric panel must render data (not "No Data") before asserting the `viewBox`,
  because `applySvgPrintViewBox` guards `w > 0 && h > 0`. Re-apply the query if the
  panel shows "No Data" (see the retry loop in `dashboard-metric-camelcase.spec.js:116-121`).

## The assertion (what the spec should check)
- Before print: `page.locator('[data-test="chart-renderer"] svg')` present, with
  `getAttribute("viewBox")` → `null` (or empty).
- After clicking print + waiting for re-render:
  `page.locator('[data-test="chart-renderer"] svg').getAttribute("viewBox")` matches
  `/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/`.
- Negative case: a non-metric (line/bar) panel keeps `[data-test="chart-renderer"] canvas`
  and never gains an `<svg>`/`viewBox`.

## Timing (name the wait to use)
- Wait for the metric chart to render: `pm.dashboardPanelActions.waitForChartToRender()`
  (polls `dashboard-apply` not disabled) + `getChartRendererCanvas().toBeVisible()`.
- After clicking print, wait for the re-query to settle before reading `viewBox`:
  poll the `viewBox` attribute (or wait for the panel's loading state to clear), because
  `applySvgPrintViewBox` runs only after `forceLoad` re-runs `loadData()` and the new
  options reach `ChartRenderer`. A fixed `waitForTimeout` is unreliable — poll the attribute.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`viewBox` is added but never removed.** Toggling print mode off does not strip the
  attribute (see `ChartRenderer.vue:213-219`). Do not assert absence after toggling off;
  assert absence only on a fresh, non-print page load.
- **Metric panels are the ONLY SVG charts.** `render-type` is `"svg"` iff
  `panelSchema.type === 'metric'` (`PanelSchemaRenderer.vue:97`); every other chart is
  `canvas` and never gets a `viewBox`. If you assert on a bar/line panel you will not
  find an `<svg>`.
- **Stale "No Data" is a FINISHED render.** A panel left showing "No Data" does not
  re-query on its own; only a fresh Apply changes it (see comment block
  `dashboard-metric-camelcase.spec.js:85-102`). Ensure the metric renders data first.
- **ECharts mounts its canvas/svg asynchronously** inside `[data-test="chart-renderer"]`;
  scope `svg`/`canvas` queries under that container.
- **Multiple metric panels ⇒ multiple `viewBox`s** — use `.first()`/`.nth()` to avoid
  strict-mode violations.
- The `@media print` CSS (wrapper clip + `object-fit: contain`) is only observable under
  `page.emulateMedia({ media: "print" })`; the deterministic, media-independent artifact
  is the `viewBox` attribute — prefer asserting that.
