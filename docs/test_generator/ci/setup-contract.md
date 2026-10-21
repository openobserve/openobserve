# Test Setup Contract: Labelled Refresh & Cancel Query Buttons (area: Dashboards)

Spec under plan: `tests/ui-testing/playwright-tests/Dashboards/refreshCancelButtons.spec.js`

OSS run (`config.isEnterprise === "false"`). The only reachable behaviors are the **labelled
Refresh / Run-query** buttons and the **refresh-options dropdown**; all **Cancel** buttons are
enterprise-gated and must be parked as `test.fixme` (see the Feature Design Document's reachability
table). Do not write a test that asserts a Cancel button in OSS.

## Streams / data the spec must establish

- `e2e_automate` **[shared/read-only]** — the standard pre-seeded logs stream every dashboard spec
  uses. Fields include `kubernetes_pod_name`, `kubernetes_container_hash`,
  `kubernetes_container_image`, plus a timestamp field. Why: the Refresh tests only need a panel that
  can load + re-query; the default `addSimplePanel` recipe (`kubernetes_pod_name` on the y-axis over
  `e2e_automate`) is sufficient. No FTS/edge-case schema is required — this feature is about button
  labelling/behavior, not query semantics.

No per-test or edge-case streams are needed for this feature. Every test case mutates only its own
freshly created dashboard (deleted in teardown), not the shared stream.

## How to create it (copy these EXACT patterns — do NOT invent setup)

Reference implementation: `tests/ui-testing/playwright-tests/Dashboards/dashboard-refresh-without-cache.spec.js`
(exact `beforeEach` + dashboard/panel creation recipe, lines 31-48, 66-72).

```js
// imports
const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard, addSimplePanel } from "./utils/dashCreation.js";
const { safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
```

- **Ingest (shared stream):** `await ingestion(page);` — `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js`
  (defaults to stream `e2e_automate`, POSTs `test-data/logs_data.json`; idempotent per worker via
  an in-memory `ingestedStreams` Set).
- **Auth/org:** `await navigateToBase(page);` (logs in as `ZO_ROOT_USER_EMAIL` /
  `ZO_ROOT_USER_PASSWORD`, default org). `ORGNAME`/org identifier resolved inside the fixtures.
- **Create dashboard + panel (per-test, uniquely named):**
  ```js
  pm = new PageManager(page);
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);     // dashboardName = `RefreshCancel_<suffix>_${Date.now()}`
  await pm.dashboardVariablesScoped.waitForAddPanelBtn();
  await addSimplePanel(pm, "Panel1");                           // line-chart, e2e_automate, kubernetes_pod_name on y
  await pm.dashboardVariablesScoped.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });
  await pm.dashboardVariablesScoped.waitForDashboardReady();
  await safeWaitForNetworkIdle(page, { timeout: 5000 });
  await pm.dashboardVariablesScoped.waitForPanelIdle("Panel1");
  ```
- **Cleanup (per-test):**
  ```js
  await pm.dashboardCreate.backToDashboardList();
  await deleteDashboard(page, dashboardName);
  ```

### Ready-made refresh interaction helpers (reuse; do not re-derive)
All live on `pm.dashboardVariablesScoped`
(`tests/ui-testing/pages/dashboardPages/dashboard-variables-scoped.js`):
- `clickDashboardRefreshAndWaitForSearch()` (line 2863) — clicks `dashboard-refresh-btn` and returns
  the `_search_stream` request URL (assert `clear_cache` absent).
- `openDashboardRefreshOptions()` (line 2693) — opens the `dashboard-refresh-options-btn` caret.
- `getRefreshWithoutCacheMenuItem()` (line 2705) — `dashboard-refresh-without-cache-btn` locator.
- `clickRefreshWithoutCacheAndWaitForClearCache()` (line 2715) — asserts `clear_cache=true`.
- `getDashboardRefreshBtnLocator()` (line 570) / `SELECTORS.REFRESH_BTN`
  (`pages/dashboardPages/dashboard-selectors.js:51`) — the labelled Refresh button.
- `waitForPanelIdle(title)` (line 2815) — wait until the panel has no in-flight query.

### ViewPanel (full-screen) opening
- Open via hover-revealed `[data-test="dashboard-panel-fullscreen-btn"]` (PanelContainer.vue line 207).
  The ViewPanel dialog root is `[data-test="view-panel-screen"]`; its labelled Refresh is
  `[data-test="dashboard-viewpanel-refresh-data-btn"]`; Close is
  `[data-test="dashboard-viewpanel-close-btn"]`.
- There is **no existing page-object helper** for ViewPanel's own refresh button yet; the Engineer
  will use the raw `data-test` selectors above. Selectors are stable and already in the source.

## Preconditions / toggles

- **Enterprise OFF (the critical toggle):** `VITE_OPENOBSERVE_ENTERPRISE` is unset in the OSS build
  → `config.isEnterprise === "false"`. Assert the **Refresh** label, never the **Cancel** label.
- **`zoConfig.auto_query_enabled`** (server config) controls `isAutoRunAvailable`:
  - The refresh-options caret (`dashboard-refresh-options-btn`) is always present.
  - The auto-run toggle item (`dashboard-auto-run-toggle-btn`) and the ViewPanel refresh-options
    caret (`dashboard-viewpanel-refresh-options-btn`) are `v-if="isAutoRunAvailable"` — do NOT
    hard-assert them without first checking `auto_query_enabled`.
  - When auto-run is ON, the Refresh icon is `autorenew`; otherwise `refresh`. The "Refresh" text
    label is present in both cases.
- **Non-mobile required for labels:** labels render only under `!isMobile`; the chromium project is
  `1500×1024`, so labels render. Do not run a mobile-viewport variant expecting labels.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Refresh is disabled while panels load.** `dashboard-refresh-btn` is `:disabled`+`:loading` when
   `arePanelsLoading`; the ViewPanel refresh is `:disabled="disable"`. Always
   `waitForPanelIdle("Panel1")` before clicking; otherwise the click is swallowed and no
   `_search_stream` fires (the existing helpers already encode `toBeEnabled` waits).
2. **The label lives inside the OButton, not on the button's `textContent` edge.** Assert with
   `await expect(refreshBtn).toContainText("Refresh")` (Playwright normalizes whitespace). The
   button's `aria-label` is also "Refresh"; do not rely on `getByRole("button", { name: "Refresh" })`
   being unique — there may be a panel-level refresh button too. Use `data-test` + `.first()`.
3. **Panel fullscreen button is hover-revealed** (`hoverRevealClass`). Hover the panel container
   (`[data-test="dashboard-panel-container"]`) before clicking `dashboard-panel-fullscreen-btn`.
4. **ViewPanel mounts inside a dialog** (`render-dashboard-charts-view-panel-dialog`); the dialog
   animates in. Wait for `view-panel-screen` to be `visible` before interacting with its buttons.
5. **Auto Run mutates global localStorage** (`oo_toggle_auto_run`). If a test toggles it, reset it
   (or reload the page) in teardown to avoid cross-test leakage within the same worker.
6. **`deleteDashboard` requires the dashboard list to be visible** and re-fills the search filter
   defensively (the helper already does this); call it only after `backToDashboardList()`.

## Out-of-scope surfaces (same labelled pattern, different fixtures)

If the Engineer/Architect extends coverage to the other labelled surfaces, note their setup differs:
- **Pinned tab (`pinned-dashboard-refresh-btn`)** needs an org-wide home dashboard pinned (Home view)
  — separate fixture; not needed for the primary Dashboards spec.
- **RUM (`rum-performance-refresh`)** needs RUM data (`_rumdata` stream + RUM onboarding) — separate
  fixture, out of the Dashboards group.
- **Metrics (`metrics-apply` "Run query")** needs `/metrics` editor hydration — separate fixture.

None are required for `refreshCancelButtons.spec.js`; keep the primary spec scoped to the dashboard
header + ViewPanel.
