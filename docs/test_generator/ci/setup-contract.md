# Test Setup Contract: Dashboard Settings Redesign  (area: Dashboards)

> Read this before writing `dashboardSettings.spec.js` (group `Dashboards-Settings`). Every item
> names the EXACT existing helper + `file:line` to copy — do NOT invent new setup.

## Streams / data the spec must establish

- **`e2e_automate`** **[shared/read-only]** — a logs stream seeded from
  `tests/test-data/logs_data.json`, fields include `kubernetes_namespace_name`,
  `kubernetes_container_name`, `kubernetes_pod_name`.
  Why: query-value variables and any panel need a real stream + field to save; the variable
  dependency chip test needs two query-value variables (`A` referenced by `B`'s filter).
  Created via `ingestion(page)` — see **How to create it** below.

- **Dashboard (no variables)** **[per-test]** — fresh dashboard (default `default` tab, zero panels).
  Why: exercises the `no-variables` empty state (VariableSettings `#empty` slot) and the
  `dashboard-tab-<tabId>-panel-count` = `0` badge. Create via
  `pm.dashboardCreate.createDashboard(dashboardName)`.

- **Dashboard with 1+ panels** **[per-test: TC-tab-badge]** — a dashboard with N panels on a tab.
  Why: exercises `dashboard-tab-<tabId>-panel-count` = N. Create via
  `addSimplePanel(pm, panelName, { streamName: "e2e_automate", ... })`.

- **Dashboard with 2 dependent variables** **[per-test: TC-dependency-chip]** — variable `A`
  (query_values) + variable `B` (query_values) whose filter value references `$A`.
  Why: exercises the dependency chip `dashboard-variable-<B>-dependencies` (count `1`) and its
  tooltip "Depends on: A"; also confirms `A` shows NO chip.
  Create via `scopedVars.addScopedVariable(B, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global", dependsOn: A, dependsOnField: "kubernetes_namespace_name" })`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest the stream:** `await ingestion(page);` (defaults to stream `e2e_automate`) —
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:25`. Call once in
  `beforeEach` after `navigateToBase(page)`, mirroring `dashboard-general-setting.spec.js:15-17`.

- **Navigate to dashboards:** `await pm.dashboardList.menuItem("dashboards-item");` then
  `await waitForDashboardPage(page);` — `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:7`.

- **Create a dashboard:** `await pm.dashboardCreate.createDashboard(dashboardName);` then
  `await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();` (or
  `setupTestDashboard(page, pm, name)` at `dashCreation.js:266`, which wraps both and waits for the
  add-panel button).
  Ref: `tests/ui-testing/pages/dashboardPages/dashboard-create.js:77`;
  `tests/ui-testing/playwright-tests/Dashboards/dashboard-general-setting.spec.js:37-38`.

- **Open settings drawer:** `await pm.dashboardSetting.openSetting();` (idempotent, waits for
  General + Variables tabs) — `tests/ui-testing/pages/dashboardPages/dashboard-settings.js:79`.
  Variables tab: `await pm.dashboardSetting.openVariables();` — `dashboard-settings.js:238`.

- **Add a panel:** `await addSimplePanel(pm, panelName, { streamName: "e2e_automate", yAxisField: "kubernetes_pod_name" });`
  — `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:321`.

- **Add a query-value variable (plain):**
  `await pm.dashboardSetting.addVariable("Query Values", varName, "Logs", "e2e_automate", "kubernetes_namespace_name");`
  then `await pm.dashboardSetting.saveVariable();` — `dashboard-settings.js:319,442`.

- **Add a dependent variable (chip test):**
  `await scopedVars.addScopedVariable(name, "logs", "e2e_automate", field, { scope: "global", dependsOn: parentName, dependsOnField: parentField });`
  — `tests/ui-testing/pages/dashboardPages/dashboard-variables-scoped.js:960` (adds a filter whose
  value is `$parentName` via `addDependency` at `:1202`). Working reference:
  `tests/ui-testing/playwright-tests/Dashboards/dashboard-variables-dependency.spec.js:51-77`.

- **Scheduled reports empty state:** open `view-dashboard-scheduled-reports` and wait for the
  `GET /api/{org}/reports` response; assert `expectEmptyState()` —
  `tests/ui-testing/pages/dashboardPages/scheduledReportsDrawer.js:79,140`.

- **Auth/org:** `ORGNAME` env (default org); worker auth state is established by the base fixture
  (`tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` `navigateToBase`). No per-test
  login needed.

- **Cleanup:** `await pm.dashboardCreate.backToDashboardList(); await deleteDashboard(page, dashboardName);`
  — `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:63`.

## Preconditions / toggles

- **Non-print mode:** settings gear + scheduled-reports button are hidden in print mode
  (`v-show="store.state.printMode !== true"`). E2E runs non-print by default; no action needed.
- **Variables list empty state** requires the dashboard to have no `variables.list` AND not be in
  the Add-variable sub-view (`isAddVariable` starts `false`). Assert only after the Variables panel
  mounts and `getDashboardData()` resolves.
- **Dependency chip** only appears for `query_values` variables (`constant`/`textbox`/`custom` never
  show it). Use `dependsOn` (query-value filter referencing `$parent`), not custom values.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Selector suffix audit pattern:** `OFormInput`/`OFormTextarea`/`OInput` append `-field` to the
  inner control. Assert `[data-test="dashboard-general-setting-name-field"]` (input) and
  `[data-test="dashboard-general-setting-description-field"]` (**`<textarea>`**, not `input`).
  (`web/src/lib/forms/Input/OInput.vue:304`, `OTextarea.vue:151`).
- **Description was `input` → is now `textarea`:** any selector like
  `[data-test="dashboard-general-setting-description"] input` (pre-redesign) is stale; target the
  `textarea` via the `-field` attribute.
- **Save button label changed** "Save" → "Save changes" — don't assert the old string; use the
  stable `[data-test="dashboard-general-setting-save-btn"]`.
- **Dashboard data arrives async** after mount (GeneralSettings `onMounted` → `getDashboardData` →
  `formRef.reset`). Assert field values only after the form re-baselines, else you read the empty
  default (`GeneralSettings.vue:151-176`).
- **Variable dependency chip data-test is name-derived** — interpolate the (unique, timestamped)
  variable name into `[data-test="dashboard-variable-<name>-dependencies"]`.
- **Tab badge is on the view header, not the settings drawer** — `TabList` lives in the dashboard
  view (rendered by ViewDashboard), NOT inside `dashboard-settings-drawer`. Assert
  `[data-test="dashboard-tab-<tabId>-panel-count"]` on the view page.
- **Section headers** have no E2E helper to create (only in RUM JSON templates). The badge-excludes-
  section-headers rule is covered by Vitest (`TabList.spec.ts:180-204`) — do NOT try to build a
  section header in E2E; assert the count against real panels only.
- **Scheduled reports empty state** must be scoped through the table:
  `[data-test="o2-table-empty"] [data-test="o2-empty-state"]` (already done in
  `scheduledReportsDrawer.js:36-38`); an unscoped `[data-test="o2-empty-state"]` can match other
  empty states on the page.
- **No setup pattern exists for** the grid drag/resize backdrop (`.grid-stack.grid-interacting`),
  and it is cosmetic (no `data-test`). If the Engineer wants to assert it, add a `data-test` to the
  grid host in `RenderDashboardCharts.vue` or target the class directly — else park it as a
  `test.fixme`/skip.
