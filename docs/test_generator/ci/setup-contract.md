# Test Setup Contract: Dashboard Deep-Link Default Tab Resolution  (area: Dashboards)

> Read by the **Engineer** (implements setup), the **Healer** and the **Refiner** (consult this
> instead of blind-scanning when a data/setup failure appears). Every helper below already exists
> in the repo — do NOT invent new setup.

## Streams / data the spec must establish

Tab resolution operates on the dashboard's `tabs` array (NOT on stream data or panels), so **no
stream ingestion is strictly required** for the tab-resolution assertions. The standard
`ingestion(page)` beforeEach is harmless but not a precondition for tab behavior.

- **No shared stream data required.** The dashboard only needs ≥ 1 tab, which the default
  (`tabId: "default"`, name `"Default"`) already provides on creation.
- **`[per-test]` dashboard with 2 tabs** — every test creates its OWN uniquely-named dashboard
  (parallel mode) and adds one extra tab, so it can deep-link to a non-default tab and to a
  bogus tab id. Why: exercises valid-tab, missing-tab, and invalid-tab resolution.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Create the dashboard** (gives `tabId: "default"`):
  ```js
  const pm = new PageManager(page);
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.createDashboard(randomDashboardName);
  ```
  — see `tests/ui-testing/pages/dashboardPages/dashboard-create.js:77` (method `createDashboard`),
  used by every Dashboards spec, e.g. `tests/ui-testing/playwright-tests/Dashboards/dashboard-tabs-setting.spec.js:33`.

- **Add a second tab** (id is a random numeric string from `getTabId()`):
  ```js
  await pm.dashboardSetting.openSetting();
  await pm.dashboardSetting.addTabSetting(newTabName);   // fills the add-tab dialog name
  await pm.dashboardSetting.saveTabSetting();            // POST → tab added
  // optionally: await pm.dashboardSetting.closeSettingDashboard();
  ```
  — see `tests/ui-testing/pages/dashboardPages/dashboard-settings.js:170` (`addTabSetting`) and
  `:185` (`saveTabSetting`); usage at `tests/ui-testing/playwright-tests/Dashboards/dashboard-tabs-setting.spec.js:37-39`.

- **Capture the dashboard id + tab ids from the URL after the view page loads:**
  ```js
  const urlObj = new URL(page.url());
  const dashboardId = urlObj.searchParams.get("dashboard");
  const folderId   = urlObj.searchParams.get("folder");   // "default"
  const tabId      = urlObj.searchParams.get("tab");      // may be absent until normalized
  ```
  — same pattern as `tests/ui-testing/playwright-tests/Dashboards/dashboard-share-link.spec.js:74-78`.

- **Deep-link (navigate directly to the dashboard view):**
  ```js
  await page.goto(
    `${process.env["ZO_BASE_URL"]}/web/dashboards/view` +
    `?org_identifier=${process.env["ORGNAME"]}` +
    `&dashboard=${dashboardId}&folder=${folderId}&tab=${tabId}`,   // omit/change `tab` to test variants
    { waitUntil: "domcontentloaded" }
  );
  ```
  — this is EXACTLY what the existing helper does: `scheduledReportsDrawer.openDashboard(dashboardId,
  { folderId = 'default', tabId = 'default' })` at `tests/ui-testing/pages/dashboardPages/scheduledReportsDrawer.js:59-67`.
  For full control over the `tab` param (valid vs missing vs bogus) the spec should construct the
  `page.goto` URL itself (the helper hardcodes `tabId='default'`).

- **Auth/org:** `navigateToBase(page)` (from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:134`)
  establishes the SPA base URL + `org_identifier`; deep links carry `org_identifier=<ORGNAME>`
  explicitly.

- **Assert the active tab (THE key assertion):**
  ```js
  await page.locator(`[data-test="dashboard-tab-${expectedTabId}"][data-state="active"]`)
    .waitFor({ state: "visible", timeout: 15000 });
  ```
  Reka's `TabsTrigger` stamps `data-state="active"` on the selected trigger, and `data-test` is
  forwarded onto that same button (`web/src/lib/navigation/Tabs/OTab.vue:147-161`). For the
  default tab, `expectedTabId === "default"`.

- **Wait for the view to load before tab assertions:** the tab strip renders only after
  `selectedDate` + `selectedTabId` are resolved (`ViewDashboard.vue:236`, `RenderDashboardCharts.vue:49`).
  Gate on `[data-test="dashboard-back-btn"]` (or `[data-test="dashboard-tab-list"]`) first.

## Preconditions / toggles

- Ensure a **non-print, non-fullscreen** dashboard (default state).
- `selectedTabId` normalization writes `tab=<firstTabId>` back via `router.replace`
  (`ViewDashboard.vue:1470,1488`) — so after a missing/invalid-tab deep link, `page.url()` will
  gain `tab=default`; assert that to prove normalization, not just visual active state.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Tab ids for non-default tabs are random numeric strings** (`getTabId()` → 10-99999,
  `web/src/utils/commons.ts:758-760`). Never hardcode a second tab's id; capture it from the URL
  after creating it, or read it from the active tab's `data-test`.
- **The tab strip may not render immediately** — it is gated on `selectedDate` (set inside
  `loadDashboard`) and `selectedTabId !== null`. Wait for `[data-test="dashboard-back-btn"]` /
  `[data-test="dashboard-tab-list"]` before asserting `[data-state="active"]`.
- **Empty-tab `tab=` is a valid fallback input** — `route.query.tab` = `""` matches no tab and
  falls back to `default`; don't treat an empty-string tab as a navigation error.
- **Deep-link normalization is a `replace`, not a `push`** — browser history is not polluted; do
  not expect an extra history entry.
- **`addTabSetting` requires the first tab row to be present** before clicking "Add Tab"
  (TabsSettings loads async; see `dashboard-settings.js:171-179`). Missing this causes the add-tab
  API call to fire with `dashboardId` undefined.
- **`createDashboard` returns once the back button mounts**, but the empty-state add-panel button
  and the tab strip appear later; `waitForAddPanelIfEmptyVisible()` / `waitForDefaultDashboardTabVisible()`
  are the established waits (`dashboard-create.js:34-41`).
- **Cleanup:** delete the per-test dashboard via `pm.dashboardCreate.backToDashboardList()` +
  `deleteDashboard(page, name)` (`tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:63`),
  as in `dashboard-tabs-setting.spec.js:45-46`.
