# Test Setup Contract: Dashboard Relative Time Range Refresh  (area: Dashboards)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `e2e_automate` **[shared/read-only]** — a logs stream whose schema includes the kubernetes fields the
  panel queries need: `kubernetes_pod_name`, `kubernetes_namespace_name`, `kubernetes_container_name`,
  `kubernetes_host` (plus `_timestamp`, added by the ingest endpoint). Why: every dashboard panel in this
  feature queries it (a line/bar/table panel with `kubernetes_pod_name` as the measure); the relative-time
  refresh tests just READ it — they never mutate the stream.
  - Fixture: `tests/test-data/logs_data.json` (3848 rows).

- **No per-test stream is required.** The headline behavior (relative range re-resolves "now" on refresh)
  is exercised entirely through the dashboard's time picker + refresh button against `e2e_automate`. No
  test needs a special schema (e.g. an FTS-only field or a no-text stream) — the relative-time logic lives
  in the time picker, not the schema.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Ingest (in `beforeEach`): `import { ingestion } from "./utils/dashIngestion.js"; await ingestion(page);`
  — see `tests/ui-testing/playwright-tests/Dashboards/dashboard-variables-refresh.spec.js:31-33`.
  The helper POSTs `logs_data.json` to `${INGESTION_URL}/api/{org}/e2e_automate/_json` and memoizes per
  worker (`ingestedStreams` set), so repeats are free (`tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:28-107`).
- Auth/org: handled by `navigateToBase(page)` from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`
  (the `beforeEach` in `dashboard-variables-refresh.spec.js:30-33`). `ORGNAME` defaults to the root org;
  headers are resolved by `getAuthHeaders()` / `getOrgIdentifier()` in `dashIngestion.js` — no manual auth needed.
- Create dashboard + panel:
  - `const pm = new PageManager(page);` then `await pm.dashboardList.menuItem("dashboards-item");`
    `await waitForDashboardPage(page);` `await pm.dashboardCreate.createDashboard(dashboardName);`
    — see `dashboard-variables-refresh.spec.js:41-44`.
  - Add a simple line panel: `addSimplePanel(pm, "Panel1")` from
    `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:405-435` (defaults: line chart,
    stream `e2e_automate`, y-axis `kubernetes_pod_name`).
  - Or the longer explicit form: `pm.dashboardCreate.addPanel()` → `pm.chartTypeSelector.selectChartType("line")`
    → `pm.chartTypeSelector.selectStream("e2e_automate")` → `removeField("y_axis_1","y")` →
    `searchAndAddField("kubernetes_pod_name","y")` → `addPanelName` → `savePanel` — see
    `dashboard-variables-refresh.spec.js:220-226`.

## Preconditions / toggles

- **Relative global time is the DEFAULT** for a fresh dashboard (`ViewDashboard.vue:775-797`: absent
  `from`/`to`/`period` in URL + `defaultDatetimeDuration.type === "relative"` → `selectedDate.value =
  { valueType:"relative", relativeTimePeriod: "15m" }`). So NO explicit time setup is needed for the
  primary "relative refresh" path — a newly created dashboard is already relative at `15m`.
- To set a DIFFERENT relative range in the spec (optional, e.g. to assert `period=6h`):
  - `DashboardPanelTime.changeGlobalTime("6-h")` → `tests/ui-testing/pages/dashboardPages/dashboard-panel-time.js:521-539`.
  - Or `scopedVars.selectTimeRange6Hours()` → `tests/ui-testing/pages/dashboardPages/dashboard-variables-scoped.js:940-943`
    (uses `SELECTORS.DATE_TIME_RELATIVE_6H = '[data-test="date-time-relative-6-h-btn"]'`).
  - Or the raw `DateTimeHelper.setRelativeTimeRange("6-h")` → `tests/ui-testing/pages/dashboardPages/dashboard-time.js:17-34`.
- **Refresh click**: `scopedVars.clickDashboardRefresh()` (`dashboard-variables-scoped.js:334-336`) or
  `pm.dashboardTimeRefresh.refreshDashboard()` (`dashboard-refresh.js:161-163`) — both click
  `[data-test="dashboard-refresh-btn"]`.
- **Verify a panel actually re-queried** (the observable signal — the URL does NOT change for a pure
  relative refresh): use `trackPanelReload(page, null, () => scopedVars.clickDashboardRefresh(), 15000)`
  from `tests/ui-testing/playwright-tests/utils/variable-helpers.js:295-326` (counts `_search`/`_multi_search`
  responses), then assert `result.reloaded === true && result.queryCount >= 1`. Reference usage:
  `dashboard-variables-refresh.spec.js:247-260`.
- **Wait for panels to settle** before and after refresh: `waitForAllPanelsToLoad(page, 1, 10000)`
  (`variable-helpers.js:463-482`) — polls `[data-test*="dashboard-panel-"][data-state="loaded"]`.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Click refresh only after the panel is loaded.** The refresh button is `:disabled`/`:loading` while
  `arePanelsLoading` is true (`ViewDashboard.vue:124-126`), and `refreshData()` early-outs
  (`ViewDashboard.vue:1244`). A click landing before `data-state="loaded"` is a swallowed no-op.
- **The picker trigger can swallow the first click** (panel re-render / `:disable` toggling). The existing
  helpers retry: `DateTimeHelper.setRelativeTimeRange` wraps the open-then-click in
  `expect(...).toPass({ timeout: 45000 })` (`dashboard-time.js:23-29`); `DashboardTimeRefresh.setRelative`
  re-clicks if the menu didn't open (`dashboard-refresh.js:39-45`). Copy that retry, don't write a bare
  `click()`.
- **URL-stability is NOT a signal here.** For a pure relative refresh the `period` param is unchanged
  (`getQueryParamsForDuration` returns `{ period: "15m" }`), and `updateUrlWithCurrentState` only
  `router.replace`s when the query actually changed (`ViewDashboard.vue:1486-1498`). Assert on network
  queries / panel `data-state`, never on a URL diff.
- **µs timestamps are a deliberate convention.** The picker returns µs (`getTime() * 1000`), and `Date`
  objects are built *from* µs so `getTime()` returns µs (`PanelSchemaRenderer.vue:1701-1706`). Don't
  "fix" a `new Date(µs)` you see — it is intentional; the relative-span comparison (`spanOf`) depends on it.
- **The relative range should NOT advance on a non-forced recompute** — this is the point of the fix, so a
  test that waits for "the label to change" will never pass. The label stays "Past 15 Minutes"; only the
  *resolved* `start_time`/`end_time` advance, which is observable only via the re-issued query.
- **Cleanup**: end each test with `await pm.dashboardCreate.backToDashboardList(); await deleteDashboard(page, dashboardName);`
  (`dashCreation.js:63-212`), mirroring `dashboard-variables-refresh.spec.js:89-91`.
