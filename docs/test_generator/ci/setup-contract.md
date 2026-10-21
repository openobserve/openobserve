# Test Setup Contract: Dashboard Refresh Button (Primary Variant & Label)  (area: Dashboards)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `e2e_automate` **[shared/read-only]** — fields: `kubernetes_namespace_name`, `kubernetes_container_name`
  (plus the standard `test-data/logs_data.json` schema). Why: every refresh-button variant/tooltip test opens a
  dashboard whose panel queries this stream, so panels actually load and `arePanelsLoading` settles. This is the
  same pre-seeded stream the auto-run spec uses; it is a shared fixture, not mutated by this feature.

- Dashboard (one per test) **[per-test]** — a dashboard with at least one simple panel (e.g. a table panel
  `SELECT kubernetes_namespace_name, count(*) FROM "e2e_automate" GROUP BY kubernetes_namespace_name`). Why: the
  Refresh button renders in the toolbar regardless of panels, but a panel is needed for `arePanelsLoading` to reach
  a settled state and for the pending/warning state to be observable. Two equivalent creation paths exist — pick one
  (see below).

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest the stream (shared fixture)
- `await ingestion(page);` — imported from `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js`
  (see `dashboard-variables-auto-run.spec.js:38` and `dashboard-refresh-without-cache.spec.js:69`). It POSTs
  `test-data/logs_data.json` to `/api/<org>/e2e_automate/_json`, is idempotent/deduped per worker, and requires
  `INGESTION_URL` to be set.

### Auth / org
- Org: `ORG()` from `tests/ui-testing/playwright-tests/utils/dashboard-auto-run-fixtures.js:22`
  (= `getOrgIdentifier() || process.env.ORGNAME || 'default'`).
- Auth headers come from `getAuthHeaders()` in `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (used by
  `createDashboard` and `ingestion`). No manual login is needed; the base fixture + `navigateToBase(page)` handle the
  session.

### Create the dashboard (pick ONE pattern)
- **Path A — API-created dashboard (fastest, recommended, mirrors auto-run):**
  ```js
  const { createDashboard, namespaceTablePanel, ORG } = require('../utils/dashboard-auto-run-fixtures.js');
  const id = await createDashboard(`refreshbtn_${Date.now()}_${Math.floor(Math.random()*1e4)}`, {
    panels: [namespaceTablePanel('p1', 'ns', '')],
  });
  await autoRun.openDashboard(ORG(), id, ['p1'], '1h');  // URL navigation
  ```
  Reference: `dashboard-auto-run.js:60-68` (`openDashboard`) and `dashboard-auto-run-fixtures.js:55-68`
  (`createDashboard`), `:30-54` (`namespaceTablePanel`). Cleanup via `deleteCreatedDashboards()` in `afterAll`
  (`dashboard-variables-auto-run.spec.js:41-43`).
- **Path B — UI-created dashboard (when the test must prove end-to-end creation):**
  ```js
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.createDashboard(dashboardName);
  await pm.dashboardVariablesScoped.waitForAddPanelBtn();
  await addSimplePanel(pm, "Panel1");
  await pm.dashboardVariablesScoped.waitForDashboardReady();
  ```
  Reference: `dashboard-refresh-without-cache.spec.js:31-48`; helpers `waitForDashboardPage`/`addSimplePanel`/
  `deleteDashboard` in `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js` (lines 7, 405, 63).

### Timing / load-state waits
- After opening a dashboard, wait for the panel to be visible and the dashboard to be idle before asserting variant:
  - `autoRun.openDashboard()` already waits for each panel container visible (`dashboard-auto-run.js:65-67`).
  - For pending/after-refresh assertions, wait for panel run counts to settle:
    `autoRun.settledRunCount(key)` / `autoRun.waitForRuns(key, n)` (`dashboard-auto-run.js:201-215, 196-198`).
- `arePanelsLoading` flips via `@panelsValues → handleEmittedData` (`ViewDashboard.vue:1142-1144`); the Refresh
  button is `disabled`+`loading` while true, so assert variant only after the dashboard reaches idle, else the
  click no-ops (`refreshData` guard `ViewDashboard.vue:1673`).

## Preconditions / toggles
- **Variant `primary` (idle):** no toggle needed — just open a dashboard and wait for idle.
- **Variant `warning` (pending):** Auto Run OFF (`pinAutoQuery(false)` + `setStoredAutoRun('false')` or
  `setStoredAutoRun('true')` with `pinAutoQuery(false)`), then change a variable value without clicking Refresh.
  Reference: `dashboard-variables-auto-run.spec.js:45-71` and `dashboard-auto-run.js:45-56, 107-116`.
- **Variant `outline` (edit mode):** click `[data-test="dashboard-edit-btn"]` to enter layout edit; assert Refresh
  outline + `dashboard-edit-save-btn` primary; exit via `dashboard-edit-discard-btn` (+ confirm dialog).
- **Auto Run icon/tooltip:** pin `auto_query_enabled` via `pinAutoQuery(page, true)`
  (`dashboard-auto-run-fixtures.js:74-84`) and set `oo_toggle_auto_run` via `setStoredAutoRun`
  (`dashboard-auto-run.js:107-112`). Tooltip text: `dashboard.viewDashboard.autoRunDescription`
  ("Runs queries on open and on filter/time changes").
- **Auto Run toggle item absence/presence:** `isAutoRunAvailable = zoConfig.auto_query_enabled === true`
  (`useAutoRunToggle.ts:41`); use `expectNoAutoRunToggle()` (`dashboard-auto-run.js:231-234`) when unpinned.

## Gotchas (so the Healer/Engineer don't rediscover them)
- The variant is asserted via the `data-o2-variant` attribute that `OButton` renders from its `variant` prop
  (`OButton.vue:441`). Use `toHaveAttribute("data-o2-variant", "primary")` — `expectRefreshVariant(variant)` in
  `dashboard-auto-run.js:236-238` does exactly this.
- The visible "Refresh" label is plain slot text inside `dashboard-refresh-btn` (no `data-test` of its own); assert
  `toContainText("Refresh")`. At mobile viewport the label is hidden (`v-if="!isMobile"`), so keep the spec desktop.
- The icon (`refresh` vs `autorenew`) has NO data-test (OIcon renders no name attribute). Don't assert it in E2E —
  use the tooltip text as the Auto-Run-on proxy; the icon swap is unit-tested in
  `web/src/views/Dashboards/viewDashboard.timeRange.spec.ts`.
- The tooltip is now in WRAPPER mode (`OTooltip` wraps the button). Hover `dashboard-refresh-btn` and expect
  `[data-test="o-tooltip-content"]` (`dashboard-auto-run.js:252-255`). The old child-tooltip lookup in the Vitest
  spec had to be rewritten to `findAllComponents({name:"OTooltip"}).find(tip => tip.find('[data-test="dashboard-refresh-btn"]').exists())`
  (`viewDashboard.timeRange.spec.ts` diff) — the same wrapper-mode reality applies to E2E locators.
- `dashboard-cancel-btn` (`outline-destructive`) only renders in enterprise during load; OSS always renders
  `dashboard-refresh-btn` (the `v-else` branch). Don't reference the cancel button in the OSS spec.
- Stream schema/ingestion is shared and deduped per worker (`dashIngestion.js` `ingestedStreams` set) — do not rely
  on re-ingestion per test; the rows are identical so re-posting is a no-op.
