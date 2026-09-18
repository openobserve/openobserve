# Test Setup Contract: Dashboard Print Layout (area: Dashboards)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use the pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate`** **[shared/read-only]** — fields: `kubernetes_container_hash`, `kubernetes_host`,
  `kubernetes_pod_name`, `kubernetes_container_image`, `log`, `level`, etc. Why: every print-layout
  test needs a dashboard panel that renders data; all existing panel builders target `e2e_automate`
  as the stream with `kubernetes_container_hash` as the default Y field.

  ⚠️ No dedicated "multi-panel" fixture stream is needed — the print reflow operates on panel
  **layout** (gs-x/y/w/h), not on stream data. Use the standard `e2e_automate` stream and create
  2–3 panels to exercise page-break straddling.

- **Single table panel** **[per-test: single-table full-width case]** — a dashboard with exactly one
  panel whose `type === 'table'`. Why: exercises the `store.state.printMode && panels.length === 1 &&
  panels[0]?.type === 'table'` branch (grid is bypassed).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest base data (once per test):**
  `ingestion(page)` from `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:24`
  (POSTs `tests/test-data/logs_data.json` to `${INGESTION_URL}/api/${ORGNAME}/e2e_automate/_json`).
  Called in `test.beforeEach` exactly as in
  `tests/ui-testing/playwright-tests/Dashboards/dashboard-config-panel-time.spec.js:20-23`.

- **Create a dashboard + one panel:**
  `setupBarPanel(page, pm, dashboardName)` (bar) or `setupTablePanel(page, pm, dashboardName)`
  (table) from `tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:89-150`.
  These delegate to `setupTestDashboard(page, pm, dashboardName)` from
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:246` → creates the dashboard
  and leaves the browser on the add-panel screen, then adds a panel and clicks Apply.
  Use `generateDashboardName()` from `configPanelHelpers.js:40` for a unique name.

- **Add a 2nd/3rd panel (for multi-panel reflow tests):**
  After the first panel is applied, call `pm.dashboardPanelActions.addNextPanel()` then repeat the
  `pm.dashboardCreate.addPanel()` → `pm.chartTypeSelector.selectChartType(...)` →
  `pm.chartTypeSelector.selectStream("e2e_automate")` →
  `pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y")` →
  `pm.dashboardPanelActions.addPanelName(...)` → `pm.dashboardPanelActions.applyDashboardBtn()` flow.
  Reference: `addNextPanel()` in
  `tests/ui-testing/pages/dashboardPages/dashboard-panel-actions.js:104-108` and `buildPanel()` in
  `configPanelHelpers.js:61-79`.

- **Save/return to view page:** `pm.dashboardPanelActions.savePanel()` →
  `tests/ui-testing/pages/dashboardPages/dashboard-panel-actions.js:31-37`.

- **Auth/org:** Global setup writes `storageState` to
  `tests/ui-testing/playwright-tests/utils/auth/user.json`; `navigateToBase(page)` (from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:117`) opens
  `${ZO_BASE_URL}?org_identifier=${ORGNAME}` and asserts auth. No per-test login needed.

- **Cleanup:** `cleanupTestDashboard(page, pm, dashboardName)` from
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:271` (backs out to list and
  deletes the dashboard).

- **Deep-link into print mode (alternative to clicking):** navigate to
  `/dashboards/view?dashboard=<id>&folder=<folder>&print=true`. The `print` query param is read in
  `onMounted` — `ViewDashboard.vue:1351-1353`.

## Preconditions / toggles

- Ensure **not** in SQL mode / quick-mode is irrelevant here — the standard panel builders use the
  visual query builder against `e2e_automate`.
- Print mode is client-only; no server toggle. Enter via click on
  `[data-test="dashboard-print-btn"]` or `print=true` URL param.
- To exercise the `@media print` CSS rules, call `page.emulateMedia({ media: 'print' })` after
  entering print mode (these rules are inert under screen media).

## Timing / hydration gotchas (so the Healer/Engineer don't rediscover them)

- **Panels must render before entering print mode.** The grid items (`.grid-stack-item` with
  `gs-x/gs-y/gs-w/gs-h`) are created by GridStack on `refreshGridStack()`. Wait for
  `[data-test="dashboard-panel-container"]` to be visible before clicking print, otherwise
  `preparePrintLayout()` sees no `.grid-stack-item` rows and returns early (no `#o2-print-page`).
  Reuse the existing wait: `pm.dashboardPanelActions.waitForChartToRender()` or
  `verifyChartHasData(expect)` — `tests/ui-testing/pages/dashboardPages/dashboard-panel-actions.js:46,151`.
- **`#o2-print-page` is injected asynchronously** after the print-mode watcher fires a `nextTick()`.
  Poll for it rather than asserting immediately:
  `await page.locator('#o2-print-page').waitFor({ state: 'attached', timeout: 10000 })`.
- **`.hideOnPrintMode` uses `display:none` via a parent `.printMode` class.** Assert visibility with
  `toBeHidden()` on a specific header button (`[data-test="dashboard-panel-add"]` etc.), not on the
  class alone.
- **The print button icon reflects state** (`print` vs `close`). Prefer asserting URL `print=true/false`
  or `.print-mode-container` presence over the icon, which can be flaky to introspect.

## Gotchas

- The `#dashboardVariablesAndPanelsDataLoaded` span is `id`-based, not `data-test`; locate it with
  `page.locator('#dashboardVariablesAndPanelsDataLoaded')`.
- `.grid-stack` and `.grid-stack-item` have **no `data-test` attribute**. The Engineer must either
  use class selectors (`.grid-stack`, `.grid-stack-item[gs-y="..."]`) or add a `data-test` fallback.
  `#o2-print-page` is the most reliable signal that the print layout ran.
- A panel taller than one page (`r.h > pageH`) is deliberately NOT pushed to the next page; do not
  assert reflow for such a panel.
