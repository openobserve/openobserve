# Test Setup Contract: Dashboard Print Layout  (area: Dashboards)

This contract tells the Engineer exactly what data/state to establish before exercising print-layout
behaviors, and the **exact existing helpers** to do it. Do **not** invent new setup — every item
below copies an in-repo pattern with a file:line reference.

## Streams / data the spec must establish

- **`e2e_automate`** **[shared/read-only]** — logs stream with fields `_timestamp`,
  `kubernetes_container_hash`, `kubernetes_pod_name`, `kubernetes_namespace_name`, `kubernetes_host`.
  Why: every dashboard panel created for this feature queries this stream; it provides the rows that
  make panels render (and the readiness flag flip). It is read-only by all tests → establish once per
  worker, reuse.

No per-test unique streams are needed: print layout is a view-state reflow, not a data transformation.
The *dashboard* (not the stream) is the per-test artifact.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Data: ingest the shared stream
- **Ingest:** `await ingestion(page);` — see `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:28`.
  Used as the `beforeEach` in `tests/ui-testing/playwright-tests/Dashboards/dashboard-table-chart.spec.js:57-59`.
  It posts `test-data/logs_data.json` to `/api/<org>/e2e_automate/_json` and is memoized per worker
  (`ingestedStreams` Set), so it is safe to call every test.

### Dashboards with panels — pick ONE strategy per test

**Strategy A — UI (use for the "toggle via toolbar button" workflow, matches existing specs):**
- `const dashboardName = generateDashboardName();`
  — `tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:83`.
- `await setupTestDashboard(page, pm, dashboardName);`
  — `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:356`.
- Add panels with `addSimplePanel(pm, panelName, { chartType, streamName, yAxisField, save })`
  — `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:405` (defaults
  `streamName="e2e_automate"`, `yAxisField="kubernetes_pod_name"`; it removes the auto-seeded
  y-axis then adds the measure). Call once per panel to build a multi-panel grid.
- Single **table** panel: `await setupTablePanel(page, pm, dashboardName, panelName);`
  — `tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:187`
  (used in `dashboard-table-chart.spec.js:70`).

**Strategy B — API (preferred for the multi-panel page-break test; fast + deterministic layout):**
- `const { dashboardId, folderId } = await pm.apiCleanup.createDashboardWithPanel(title, panelTitle, streamName);`
  — `tests/ui-testing/pages/apiCleanup.js:318`. This posts a v5 dashboard with **one** bar panel
  (`layout: { x:0, y:0, w:24, h:9 }`).
- For **multiple stacked panels**, post the same payload shape with N entries in
  `tabs[0].panels`, each with an explicit `layout` (e.g. `y: 0, 9, 18, 27, …` at `w:24, h:8`) so the
  grid is tall enough to exceed one print page — copy the payload literal at
  `tests/ui-testing/pages/apiCleanup.js:319-360` and repeat the `panels[]` object. This guarantees a
  deterministic grid geometry for the page-break assertion (no UI drag-and-drop needed).
- Navigate to it with
  `${process.env.ZO_BASE_URL}/web/dashboards/view?org_identifier=${process.env.ORGNAME}&dashboard=${dashboardId}&folder=${folderId}`.

### Auth / org
- Standard session from `navigateToBase(page)` (see `dashboard-table-chart.spec.js:57`); org is the
  default `ORGNAME` env. No special enterprise gating.

### Timing / load-state to wait for BEFORE asserting print layout
- Wait for panels to be mounted: `page.locator('[data-test="dashboard-panel-container"]').first()` visible.
- Wait for the grid to have real geometry before `preparePrintLayout()` reads it — after entering print
  mode, poll until `document.querySelector("#o2-print-page")` exists AND the `.grid-stack` inline
  `height` is non-empty. `preparePrintLayout` reads `grid.clientWidth`, so it must run after layout,
  not at first paint.
- The print readiness span `#dashboardVariablesAndPanelsDataLoaded` appears only after all panels/vars
  report not-loading (`RenderDashboardCharts.vue:663-753`) — wait on it when asserting the
  capture-readiness behavior, but it is not required for the `#o2-print-page` assertion.

### Cleanup
- UI-created: `await cleanupTestDashboard(page, pm, dashboardName);`
  — `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:381`.
- API-created: `await pm.apiCleanup.deleteDashboard(dashboardId, folderId);`
  — `tests/ui-testing/pages/apiCleanup.js:386`.

## Preconditions / toggles
- Ensure **not** in SQL/quick mode — irrelevant here; panels use the standard SQL builder or PromQL.
- Print mode is entered **by the test** via `[data-test="dashboard-print-btn"]` click, or by navigating
  with `?print=true`. No pre-existing store state is assumed (`printMode` defaults `false`).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`beforeprint`/`afterprint` never fire in headless Chromium.** The print layout is driven by the
  `watch([store.state.printMode, panels.length, selectedTabId])` at `RenderDashboardCharts.vue:1199-1209`.
  Assert via `#o2-print-page` / grid height, never by expecting a print event.
- **Empty dashboard → no `#o2-print-page`.** `preparePrintLayout` returns early on `rows.length === 0`
  (`:1065`). The single-table and multi-panel cases must each have ≥1 panel.
- **Single table panel swaps grid for full-width.** With exactly one `table` panel in print mode the
  `.grid-stack` is replaced by a full-width `PanelContainer` (`:74`). Assert `.grid-stack` absence +
  `[data-panel-type="table"]` presence; do not expect grid items.
- **Panels are lazy-mounted** until print mode (`mountAllPanels`, `:447`). Placeholders
  (`dashboard-panel-placeholder-*`) vanish only after the batch mounter (`:600-624`) runs — wait, don't
  assert immediately after click.
- **Grid width must be real.** `preparePrintLayout` uses `grid.clientWidth` and the `--gs-cell-height`
  CSS var; a zero-width (hidden/collapsed) grid produces no meaningful page size. Assert only after the
  dashboard body is laid out.
- **URL carries `print=` state.** After toggling, the URL query includes `print=true`/`false`; reloading
  with `?print=true` re-enters print mode (`ViewDashboard.vue:1321-1333`) — a useful alternative entry
  point, and a reason to clean the URL state between tests if reuse matters.
