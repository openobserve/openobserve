# Test Setup Contract: Dashboard Custom Variable Default Value Resolution  (area: Dashboards)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Data streams
- **`e2e_automate`** **[shared/read-only]** — fields: `kubernetes_namespace_name`, `kubernetes_container_name`, `kubernetes_host`, `log`, `stream`, `namespace`, etc.
  - Why: This is the standard test data stream. Custom variables don't query backends so no specific field is required, but any dependent query_values variables in the same dashboard will use this stream. All behaviors under test (creating custom variables, setting per-option defaults, verifying display) work without any stream data.
  - **Important:** Custom type variables are STATIC — they do NOT make API calls. The only data needed is the dashboard itself.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest test data
```js
// In spec's test.beforeEach:
import { ingestion } from "./utils/dashIngestion.js";
await ingestion(page);  // Ingests logsdata to stream "e2e_automate"
```
Reference: `tests/ui-testing/playwright-tests/Dashboards/dashboard-variables-default-values-chain.spec.js:25`

### Auth / organization
- ORGNAME = default; the worker auth state / login pattern from enhanced-baseFixtures
- Use `navigateToBase(page)` in `test.beforeEach` (standard for all dashboard specs)

### Create dashboard
```js
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

const pm = new PageManager(page);
const scopedVars = new DashboardVariablesScoped(page);
await pm.dashboardList.menuItem("dashboards-item");
await waitForDashboardPage(page);
await pm.dashboardCreate.createDashboard(dashboardName);
```
Reference: `tests/ui-testing/playwright-tests/Dashboards/dashboard-variables-default-values-chain.spec.js:35-38`

### Create a custom variable with per-option default (single-select)
**CONFIRMED: `addCustomVariable` supports the `selected` flag on option objects.** See `tests/ui-testing/pages/dashboardPages/dashboard-variables-scoped.js:1332-1352`.

```js
// Open settings and create a custom variable with a per-option default:
await pm.dashboardSetting.openSetting();
await pm.dashboardSetting.openVariables();

await scopedVars.addCustomVariable(varName, [
  { label: "Option One", value: "opt_one" },
  { label: "Option Two", value: "opt_two", selected: true }, // ← THIS is the default
  { label: "Option Three", value: "opt_three" }
], { scope: "global" });

await pm.dashboardSetting.closeSettingWindow();
```
Reference: `tests/ui-testing/pages/dashboardPages/dashboard-variables-scoped.js:1224-1381`

### Create a custom variable with per-option defaults (multi-select)
```js
await scopedVars.addCustomVariable(varName, [
  { label: "Option One", value: "opt_one", selected: true },
  { label: "Option Two", value: "opt_two", selected: true },
  { label: "Option Three", value: "opt_three" }
], { scope: "global", multiSelect: true });
```

### Edit an existing custom variable to change default option
```js
// Click edit button in the variable list
await page.locator(`[data-test="dashboard-edit-variable-${varName}"]`).click();
// Uncheck the current default, check a different one
await page.locator('[data-test="dashboard-custom-variable-0-checkbox"]').click(); // uncheck
await page.locator('[data-test="dashboard-custom-variable-1-checkbox"]').click(); // new default
await page.locator('[data-test="dashboard-variable-save-btn"]').click();
```

### Verify variable value on dashboard
```js
const { getVariableSelector } = require("../../pages/dashboardPages/dashboard-selectors.js");
const varEl = page.locator(getVariableSelector(varName));
await varEl.waitFor({ state: "visible", timeout: 10000 });
// For custom variable, check the displayed text in the q-select native field:
const displayedValue = await varEl.locator('.q-field__native').textContent();
expect(displayedValue).toContain("Option Two");  // the expected default label
```

### Verify validation error (no default selected)
```js
// Quasar notify renders a notification div. The text can be asserted:
await expect(page.locator('.q-notification').filter({ hasText: "Select at least one default option" })).toBeVisible();
// OR simpler:
await expect(page.getByText("Select at least one default option")).toBeVisible();
```

## Preconditions / toggles
- Ensure dashboard settings dialog is open and Variables tab is active before adding variables.
- Custom variables do NOT need any API calls — they resolve immediately (loading state not applicable).
- No SQL mode toggle needed — custom variables are not query-backed.

## Gotchas (so the Healer/Engineer don't rediscover them)
1. **Custom variables are static** — no API calls, no network monitoring needed. The variable resolves immediately upon dashboard load. Do not set up API monitors.
2. **The `selected` flag IS serialized** with the dashboard JSON — saving and reloading preserves it.
3. **Validation blocks save** if no option is marked default — tests that verify this must check for a Quasar notification. No dedicated `data-test` on the notification; use `.q-notification` class or `getByText("Select at least one default option")`. **NEEDS SELECTOR** for robust assertion — recommend adding `data-test` to the notification if tests need to assert it reliably.
4. **Multi-select to single-select transition** automatically marks the first option as default — if editing a multi-select variable and toggling multi-select OFF, expect `option[0].selected = true` without user action.
5. **The `addCustomVariable` helper in scoped page object** fully supports the `selected` flag (confirmed at `dashboard-variables-scoped.js:1332-1352`). Each option object with `selected: true` will click the corresponding default checkbox.
6. **Dashboard variable display selector** — the custom value selector uses `data-test="dashboard-variable-custom-value-selector"` (on the q-select), wrapped inside `data-test="dashboard-variable-{name}-container"`. Use `getVariableSelector(name)` from selectors.
7. **Settings dialog persistence** — the Variables tab stays active after saving a variable; no need to re-click it between consecutive `addCustomVariable` calls within the same settings session.
