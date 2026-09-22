# Test Setup Contract: Dashboard Refresh Without Cache  (area: Dashboards)

> Read by the **Engineer** (implement), the **Healer** and the **Refiner** (diagnose). Copy the
> exact patterns below — do **not** invent setup. All paths are relative to `tests/ui-testing/`.

## Streams / data the spec must establish

- **`e2e_automate`** **[shared/read-only]** — the standard logs stream the whole Dashboards suite
  reads from. Ingested once per worker by `ingestion(page)` (default stream name). Fields used by
  the closest analog specs: `kubernetes_pod_name`, `kubernetes_namespace_name`,
  `kubernetes_container_name`, `kubernetes_container_image`, `kubernetes_container_hash`.
  Why: every panel query in this feature needs a non-empty logs stream; a line chart over
  `kubernetes_pod_name` is the canonical query-backed panel.
- **No special/edge stream is required.** The feature is a cache flag, not a data-shape feature.
  Do **not** create a per-test custom stream — reuse `e2e_automate` (parallel-safe, read-only).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** `import { ingestion } from "./utils/dashIngestion.js";` then
  `await ingestion(page);` in `beforeEach` (defaults to stream `e2e_automate`, payload
  `../../test-data/logs_data.json`).
  See `playwright-tests/Dashboards/dashboard-variables-refresh.spec.js:7,32`.
- **Login / base navigation:** `const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");`
  then `await navigateToBase(page);` in `beforeEach` before ingestion.
  See `dashboard-variables-refresh.spec.js:6,30-33`.
- **Navigate to dashboard list:**
  `const pm = new PageManager(page);` → `await pm.dashboardList.menuItem("dashboards-item");` →
  `await waitForDashboardPage(page);` → `await pm.dashboardCreate.waitForDashboardUIStable();`.
  See `dashboard-variables-refresh.spec.js:41-43`.
- **Create dashboard:** `await pm.dashboardCreate.createDashboard(dashboardName);`
  (name must be unique per test, e.g. `` `Dashboard_NoCache_${Date.now()}` `` — tests run in
  `mode: "parallel"`). See `dashboard-variables-refresh.spec.js:44`.
- **Add one query-backed panel (the cache-flag probe):** use the consolidated helper
  `import { addSimplePanel } from "./utils/dashCreation.js";` →
  `await addSimplePanel(pm, "Panel1");` — it selects chart type `line`, stream `e2e_automate`,
  Y-axis `kubernetes_pod_name`, names + saves the panel.
  Definition: `playwright-tests/Dashboards/utils/dashCreation.js:405`.
  (Equivalent inline form: `pm.dashboardCreate.addPanel()` → `pm.chartTypeSelector.selectChartType("line")`
  → `selectStream("e2e_automate")` → `removeField("y_axis_1","y")` → `searchAndAddField("kubernetes_pod_name","y")`
  → `pm.dashboardPanelActions.addPanelName("Panel1")` → `savePanel()`;
  see `dashboard-variables-refresh.spec.js:220-226`.)
- **Wait for the panel to be ready before clicking refresh:**
  `await scopedVars.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });`
  then `await scopedVars.waitForDashboardReady();` (scopedVars = `new DashboardVariablesScoped(page)`).
  For a hard loaded-state wait use `waitForAllPanelsToLoad(page, 1)`
  (`playwright-tests/utils/variable-helpers.js:463` — polls
  `[data-test*="dashboard-panel-"][data-state="loaded"]`).

## Preconditions / toggles

- **No SQL-mode toggle needed** — the panel uses the default chart builder; do not enable SQL mode.
- **Not in print mode** — default is false; no action needed.
- **Ensure panels are NOT still loading before opening the dropdown.** The options caret is
  `:disabled="arePanelsLoading"` and `refreshData` early-returns while loading
  (`ViewDashboard.vue:1277`). Wait on panel loaded-state / `safeWaitForNetworkIdle(page, { timeout: 5000 })`
  (`playwright-tests/utils/wait-helpers.js`) before clicking.

## How to drive the two actions (copy these EXACT selector/click patterns)

- **Dashboard-level cache reload:**
  1. `await page.locator('[data-test="dashboard-refresh-options-btn"]').click();`
  2. `const item = page.locator('[data-test="dashboard-refresh-without-cache-btn"]');`
     `await item.waitFor({ state: "visible" });`
  3. Wrap the click with a request waiter that asserts the cache-bypass (see next block).
- **Panel-level cache reload:**
  1. `await page.locator('[data-test="dashboard-edit-panel-<title>-dropdown"]').click();`
     (`<title>` = the panel title you set, e.g. `Panel1`).
  2. `await page.locator('[data-test="dashboard-refresh-without-cache"]').click();`

## How to ASSERT the cache bypass (the whole point of the feature)

The flag becomes the `clear_cache=true` **URL query param** on the streaming search request for a
single-query panel. Assert it exactly like the existing Logs analog:

```js
const [request] = await Promise.all([
  page.waitForRequest(
    (req) => req.url().includes('_search_stream') && req.url().includes('clear_cache=true'),
    { timeout: 30000 }
  ),
  item.click(),
]);
expect(new URL(request.url()).searchParams.get('clear_cache')).toBe('true');
```
Pattern source: `playwright-tests/Logs/logsRefreshCacheDropdown.spec.js:60-64` and the helper
`pages/logsPages/logsPage.js:11618-11631` (same idea, `/_search` GET).

To also confirm a query actually re-fired (belt-and-braces), use `trackPanelReload`
(`playwright-tests/utils/variable-helpers.js:295`) — it matches `url.includes('_search')`, which
covers `_search_stream`/`_search_multi_stream` too. Expect `queryCount >= 1`.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **The dashboard search endpoint is `_search_stream` / `_search_multi_stream`, NOT `/_search`.**
   A waiter that only matches `/_search` (without the `_stream` suffix) will time out. Use
   `url.includes('_search_stream')` (substring `_search` also covers it in `trackPanelReload`).
2. **`clear_cache` is a URL param only for single-query panels.** Multi-query/time-shift panels
   carry `is_refresh_cache` inside the request body (`usePanelSQLExecutor.ts:480,1073`). Keep the
   test panel a simple single-query line/bar chart so the URL assertion is valid.
3. **Dropdown is disabled while panels load.** Do not click `dashboard-refresh-options-btn`
   immediately after creating the panel — wait for loaded-state first, or the click is a no-op and
   the `clear_cache=true` waiter times out.
4. **Parallel mode = unique names.** Every test creates/deletes its own dashboard; use
   `Date.now()` in the name (`dashboard-variables-refresh.spec.js` pattern) and clean up with
   `await pm.dashboardCreate.backToDashboardList(); await deleteDashboard(page, dashboardName);`.
5. **Stream schema is not required for this feature** — the query is a plain `*`/field-count over
   `e2e_automate`; the data is searchable after `ingestion(page)` + the standard
   `waitForDashboardReady` waits. No extra WAL/schema wait is needed beyond the existing helpers.
6. **Reka UI dropdown click timing:** if the item is attached but the click lands before the menu
   animation settles, re-open and click again (the Logs helper re-opens after an Escape; the
   dashboard analog may do the same). Prefer `.click()` after `waitFor({ state: "visible" })`.
