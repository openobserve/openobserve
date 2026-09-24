# Test Setup Contract: Dashboard Print Mode Clear on Leave  (area: Dashboards)

Spec to generate: `tests/ui-testing/playwright-tests/Dashboards/dashboardPrintMode.spec.js`
Feature slug: `dashboard-print-mode-leave`

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:

- **`e2e_automate`** **[shared/read-only]** — logs stream with `_timestamp` (used as the
  x-axis) and count-able rows. Why: `createDashboardWithStackedPanels` builds 4 bar panels that
  each `SELECT histogram(_timestamp), count(_timestamp) FROM "e2e_automate"`. The leave assertion
  itself never inspects panel *data*, but the panels must mount (no placeholders) for the
  existing `enterPrintMode()`/`waitForPrintLayout()` helper to resolve. Ingestion is idempotent
  and deduplicated by the helper's `ingestedStreams` set, so it is safe to call every test.

- **`<dashboard title>`** **[per-test]** — a dashboard with 4 stacked bar panels, created via
  API. Why: deterministic multi-panel geometry satisfies `waitForPrintLayout()`
  (`@page` style + non-empty grid + 0 placeholders). Create **inside** the test, delete in
  `afterEach`. Title must be unique: `` `PrintModeLeave_${Date.now()}_${crypto.randomBytes(3).toString("hex")}` ``.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest**: `await ingestion(page);` in `beforeEach`.
  Import: `import { ingestion } from "./utils/dashIngestion.js";`
  Reference: `tests/ui-testing/playwright-tests/Dashboards/dashboard-print-layout.spec.js:24`.

- **Create dashboard (API)**:
  `const { dashboardId, folderId } = await pm.apiCleanup.createDashboardWithStackedPanels(title, 4);`
  Reference: `tests/ui-testing/playwright-tests/Dashboards/dashboard-print-layout.spec.js:54`
  (helper at `tests/ui-testing/pages/apiCleanup.js:715-771`; returns `{ dashboardId, folderId: 'default' }`).

- **Delete dashboard (afterEach)**:
  `await pm.apiCleanup.deleteDashboard(apiDashboard.dashboardId, apiDashboard.folderId).catch(() => {});`
  Reference: `tests/ui-testing/playwright-tests/Dashboards/dashboard-print-layout.spec.js:29-34`.

- **Auth / org**: `await navigateToBase(page);` in `beforeEach` (navigates to
  `/web/?org_identifier=<ORGNAME>` and verifies auth against `[data-test="navbar-main-nav"]`).
  Import from `../utils/enhanced-baseFixtures.js` (same as every Dashboards spec). `ORGNAME` env
  supplies the org. Reference: `dashboard-print-layout.spec.js:22` and `enhanced-baseFixtures.js:141`.

- **PageManager**: `pm = new PageManager(page)`; `pm.dashboardPrint` is the print page object
  (registered at `tests/ui-testing/pages/page-manager.js:163`).

## The single most important setup/flow rule (leave must be IN-APP)

`onBeforeRouteLeave` is a Vue Router **in-component** guard — it only fires on an SPA route
transition. If the test opens the dashboard with `pm.dashboardPrint.navigateToDashboardView(...)`
(a `page.goto` = full document load) and then calls `page.goBack()`, that is a **cross-document**
traversal (the dashboard document is unloaded / the destination restored from bfcache or
reloaded), so the guard never runs and the "shell restored" assertion would pass for the wrong
reason (a fresh store defaults to `printMode=false`).

**Therefore:** reach the dashboard view **in-app**, e.g.:
1. `await navigateToBase(page);` (creates the SPA session).
2. `await pm.dashboardList.menuItem("dashboards-item");` (in-app → list).
3. `await pm.dashboardList.clickOnDashboard(title);` (in-app → view).
   (Search-assisted name-cell click; see `dashboard-list.js:122-138`.)
4. `await pm.dashboardPrint.clickPrintButton();` then assert print active.
5. `await page.goBack();` (now a popstate → in-app back to the list → guard fires).

Then assert the shell is restored on the list: `[data-test="navbar-main-nav"]` visible
(`expect(page.locator('[data-test="navbar-main-nav"]')).toBeVisible()`), and/or
`header.o2-app-header` is not `hidden`.

## Preconditions / toggles
- Ensure **not** already in print mode before the test (fresh `navigateToBase` + in-app entry
  yields `printMode=false`).
- No SQL-mode / quick-mode / enterprise toggles are relevant to this feature.

## Assertion helpers already available (do NOT re-implement)
In `tests/ui-testing/pages/dashboardPages/dashboard-print.js`:
- `enterPrintMode()` — click print button + `waitForPrintLayout()`.
- `expectPrintChromeApplied()` — `.print-mode-container` count 1, back/refresh hidden.
- `expectPrintChromeCleared()` — `.print-mode-container` count 0, back/refresh visible.
- `expectPrintPageStyleInjected()` / `expectPrintPageStyleRemoved()` — `#o2-print-page` present/absent.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`page.goBack()` after `page.goto()` does not exercise the guard.** Always arrive at the view
  in-app (menu → list → click) so Back is a popstate. This is the #1 failure mode for this spec.
- **Print button lives in the `#actions-overflow` slot**, but on desktop it is rendered
  clickable at `[data-test="dashboard-print-btn"]` (the sibling spec clicks it directly and
  works). Do not hunt for it under a kebab.
- **`#o2-print-page` and grid height require mounted panels**; the empty-dashboard branch does
  NOT inject the `@page` style — so don't assert `#o2-print-page` if using an empty dashboard.
  Use `createDashboardWithStackedPanels(..., 4)` to keep `enterPrintMode()` valid.
- **The guard clears `printMode` but not the URL** — after leaving, the *dashboard route* entry
  may still carry `print=true`. Do not assert the URL after `goBack()`; assert the shell
  (`navbar-main-nav` visible) instead.
- **`navbar-main-nav` is removed via `v-if`, not hidden** — assert `toBeVisible()` (or
  `toHaveCount(1)`) rather than checking a `hidden` attribute on it.
