# Test Setup Contract: Dashboard Variable Select All  (area: Dashboards)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `e2e_automate` **[shared/read-only]** — logs stream, fields include
  `kubernetes_namespace_name`, `kubernetes_container_name`, `kubernetes_pod_name`, `_timestamp`
  (multiple distinct values each). Why: every "Select All" behavior needs a populated
  query_values variable; the values query maps `fieldHit.values` → `variableItem.options`, and
  without options `hasVisibleFilteredOptions` is false so the "Select All" row never renders.
- Per-test dashboards + variables **[per-test]** — each test creates its own uniquely-named
  dashboard (`Dashboard_SelectAll_${Date.now()}`) and variable (`sel_all_${Date.now()}`) and
  deletes the dashboard in cleanup. No cross-test mutation.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Ingest the shared stream:
  ```js
  import { ingestion } from "./utils/dashIngestion.js";
  test.beforeEach(async ({ page }) => { await navigateToBase(page); await ingestion(page); });
  ```
  See `tests/ui-testing/playwright-tests/Dashboards/dashboard-variables-default-values-chain.spec.js:9,27`
  (`ingestion` posts `test-data/logs_data.json` to `/api/{org}/e2e_automate/_json` via
  `dashIngestion.js:22-56`).

- Create a dashboard + a multi-select query_values variable:
  ```js
  const pm = new PageManager(page);
  const scopedVars = new DashboardVariablesScoped(page);
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.createDashboard(dashboardName);
  await pm.dashboardSetting.openSetting();
  await pm.dashboardSetting.openVariables();
  await scopedVars.addScopedVariable(
    varName, "logs", "e2e_automate", "kubernetes_namespace_name",
    { scope: "global", showMultipleValues: true }
  );
  await pm.dashboardSetting.closeSettingWindow();
  ```
  Pattern: `dashboard-variables-default-values-chain.spec.js:42-54` and
  `pages/dashboardPages/dashboard-variables-scoped.js:1007` (`addScopedVariable`).
  `showMultipleValues: true` clicks `dashboard-query_values-show_multiple_values` (multi-select).

- Open the dropdown and read the selected value:
  ```js
  await scopedVars.getVariableTriggerLocator(varName).click();          // or clickVariableTrigger(varName)
  await scopedVars.waitForVariablePopoverVisible(varName);              // popover up
  const valueText = await scopedVars.getVariableInnerValueLocator(varName).textContent();
  ```
  Helpers: `dashboard-variables-scoped.js` (`getVariableTriggerLocator` L640,
  `getVariableInnerValueLocator` L603, `waitForVariablePopoverVisible` L104);
  `dashboard-variables.js` (`clickVariableTrigger` L274, `variableOptionByValue` L18).

- Interact with the "Select All" master row (NO data-test — see Gotchas):
  ```js
  const popover = scopedVars.getVariablePopoverLocator(varName);
  // Anchor: the row is immediately above the separator:
  await popover.locator('[data-test="dashboard-variable-all-separator"]').locator('xpath=..').first() ...
  // OR by text / role:
  await popover.getByText("Select All").click();                       // multi
  await popover.getByText("All", { exact: true }).click();             // single
  // OR the master checkbox (first [role="checkbox"] in the popover):
  await popover.locator('[role="checkbox"]').first().click();
  ```

- Configure "all" as the variable's default (Workflow 3):
  ```js
  await scopedVars.addScopedVariable(varName, "logs", "e2e_automate", "kubernetes_namespace_name",
    { scope: "global", showMultipleValues: true, defaultValueType: "all" });
  ```
  `defaultValueType: "all"` clicks `dashboard-multi-select-default-value-toggle-all-values`
  (`dashboard-variables-scoped.js:1160-1165`); assert `<ALL>` on load via
  `getVariableInnerValueLocator(varName).textContent()`.

- Auth/org: no special setup — the worker login/auth state (see
  `tests/ui-testing/playwright-tests/login` and `pages/dashboardPages/dashLogin.js`); org = default
  (`getOrgIdentifier()` from `playwright-tests/utils/cloud-auth.js`).

- Timing: wait for the values query to settle before asserting/interacting. Use
  `scopedVars.waitForVariableValueSettled(varName)` (`dashboard-variables-scoped.js:371`) or wait
  until the loading spinner (`[role="status"]` inside the selector) is gone and the option list is
  populated. Querying before options hydrate returns the empty state and the "Select All" row is absent.

## Preconditions / toggles

- Ensure the variable type is `query_values` (not `custom`/`constant`/`textbox`/`dynamic_filters`).
- Ensure non-SQL / normal dashboard mode (not relevant to SQL mode; but the "all" default and
  select-all only apply to query_values variables).
- For the "all default" workflow, do NOT also set a URL initial value — the "all" default only
  applies when the initial value is empty (`VariablesValueSelector.vue:809-814`).

## Gotchas (so the Healer/Engineer don't rediscover them)

- The "Select All" row has **no `data-test`**. The OSelect built-in `data-test="o-select-all"`
  is NOT present here — `VariableQueryValueSelector` never passes the `selectAll` prop to OSelect.
  Target the master row via `dashboard-variable-all-separator` (row sits immediately above it),
  `getByText("Select All")` / `getByText("All")`, or the first `[role="checkbox"]` in the popover.
- Stream schema/values arrive async via the `/_values_stream` streaming query. Assert only after
  the spinner is gone and the option list is populated, else the resolver sees `[]` and the
  "Select All" row never renders.
- Multi-select "Select All" does NOT close the popover (`toggleSelectAll` skips
  `closePopUpWhenValueIsSet`); single-select closes immediately. Don't assert the popover closed
  for the multi-select case.
- After "Select All", the closed-trigger display value is `<ALL>` (i18n `allSelected`), and the
  model value is `["_o2_all_"]` — assert on `<ALL>` text rather than an option label.
- Toggling "Select All" off clears to `[]`, which the trigger shows as `(No Data Found)`
  (not a literal empty string).
- Values are only queryable after ingestion is indexed — reuse the existing "close/reopen dropdown
  until the option shows" retry pattern from `selectVariableOption`
  (`dashboard-variables.js:328-348`) rather than assuming immediate index visibility.
