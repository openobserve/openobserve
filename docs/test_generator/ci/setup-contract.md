# Test Setup Contract: Dashboard Time Range Apply & Auto Run  (area: Dashboards)

The spec this backs: `tests/ui-testing/playwright-tests/Dashboards/dashboard-time-range-apply.spec.js`
(playwright group `Dashboards-Panel-Level-DateTime-Config`). Every setup item below cites the
**existing** helper + file:line — do NOT invent a new ingest/dashboard path.

## Streams / data the spec must establish

Tag by SCOPE:
- **`[shared/read-only]`** — every test reads it the same way → set up once / reuse a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate` [shared/read-only]** — logs stream with `kubernetes_namespace_name`, `kubernetes_container_name`, and `kubernetes_container_image` fields. Why: every panel under test is a SQL `SELECT ... FROM "e2e_automate" GROUP BY ...` table; the fresh-on-open and apply behaviors are asserted by counting `/_search` re-queries, which only fire if the stream resolves rows.
  - Ingest once via the existing helper: `ingestion(page)` (import from `./utils/dashIngestion.js`) — see `tests/ui-testing/playwright-tests/Dashboards/dashboard-panel-time-apply-behavior.spec.js:30` (`await ingestion(page);` in `beforeEach`).
  - The helper is idempotent per worker (`ingestedStreams` set, `dashIngestion.js:33-39`) and posts `test-data/logs_data.json` to `/api/<org>/e2e_automate/_json` (`dashIngestion.js:28-50`).

## How to create the dashboard + panels (copy these EXACT patterns)

### Pattern A — API-created SQL table panels (for fresh-on-open / re-query-count assertions)
This is the **only** pattern that gives deterministic per-panel run counting, because each panel's
SQL carries a unique `<key>_cnt` alias that `trackPanelRuns` can grep for.

- **Create dashboard + panels**: `createDashboard(title, { panels })` where panels come from `namespaceTablePanel(id, key)` — `tests/ui-testing/playwright-tests/utils/dashboard-auto-run-fixtures.js:66` and `:37`.
  - Each panel is a relative-time SQL table: `SELECT kubernetes_namespace_name as "<key>_ns", count(*) as "<key>_cnt" FROM "e2e_automate" GROUP BY "<key>_ns"` (`dashboard-auto-run-fixtures.js:49`). No `panel_time_range`, so panels follow the global (relative) range — exactly what fresh-on-open needs.
- **Track panel runs**: `trackPanelRuns(page)` captures `/_search(_stream)` POST bodies and exposes `.of(key)` filtered by `"<key>_cnt"` — `dashboard-auto-run-fixtures.js:118-132`.
  - Assert a re-query: `settledRunCount(key)` / `expectNoNewRun(key, count)` / `waitForRuns(key, count)` — `tests/ui-testing/pages/dashboardPages/dashboard-auto-run.js:196-221`.
- **Open with a relative range**: `openDashboard(org, dashboardId, panelIds, period)` navigates to `/web/dashboards/view?...&period=<period>` — `dashboard-auto-run.js:60-68`.
- **Pin Auto Run availability**: `pinAutoQuery(page, true)` intercepts `/api/<org>/config` and injects `auto_query_enabled: true` — `dashboard-auto-run-fixtures.js:99-106`. **Required**: the "applies immediately" half of the feature is gated on `auto_query_enabled` (`useAutoRunToggle.ts:38`); without pinning, a config response of `false` silently degrades every "Auto Run ON" case to deferred-apply and the tests will fail.
- **Toggle / read Auto Run storage**: `setStoredAutoRun(value)` / `getStoredAutoRun()` / `toggleAutoRun()` — `dashboard-auto-run.js:107-132` (key `oo_toggle_auto_run`, default true when unset).
- **Cleanup**: `deleteCreatedDashboards()` at teardown — `dashboard-auto-run-fixtures.js:94-96`.

### Pattern B — UI-created panel with `panel_time_enabled` (for panel-level / view-panel apply)
For the panel-level picker and ViewPanel flows, use the existing panel-time UI helpers.

- `createDashboardWithPanelTime(page, pm, { dashboardName, panelName, panelTimeEnabled: true, panelTimeRange: "1-h" })` — `tests/ui-testing/playwright-tests/Dashboards/utils/panelTimeSetup.js:105`. Returns `{ dashboardName, panelId }`.
- Panel-level picker interactions: `pm.dashboardPanelTime.changePanelTimeInView(panelId, timeRange)` / `clickPanelTimePicker(panelId)` / `isPanelTimePickerVisible(panelId)` — `tests/ui-testing/pages/dashboardPages/dashboard-panel-time.js:330-433`.
- View-panel flow: `pm.dashboardPanelTime.openViewPanelModal(panelId)` → `changeViewPanelDateTime(timeRange)` → `closeViewPanelModal()` — `dashboard-panel-time.js:548-712`.
- Global time change (no Apply button): `pm.dashboardPanelTime.changeGlobalTime(timeRange)` — `dashboard-panel-time.js:500-517`.
- **Deferred-apply helper**: `selectGlobalTimeWithoutApply(timeRange)` + `dismissDateTimePicker()` to pick WITHOUT applying — `dashboard-panel-time.js:616-630`.
- **The "apply a picked range" helper** (already handles no-Apply pickers): `applyPickedDateTime(page)` — `tests/ui-testing/pages/dashboardPages/dashboard-time.js:21-43`. It clicks `date-time-apply-btn` if present, else closes + clicks `dashboard-apply`, else clicks the yellow Refresh.
- Cleanup: `cleanupDashboard(page, pm, dashboardName)` — `panelTimeSetup.js:523`.

## Preconditions / toggles

- **`auto_query_enabled`**: pin `true` with `pinAutoQuery(page, true)` (Pattern A) for any test asserting immediate apply / fresh-on-open. The UI toggle item (`dashboard-auto-run-toggle-btn`) only renders when `isAutoRunAvailable` (`ViewDashboard.vue:162`), so do not attempt to toggle Auto Run from the UI without pinning first.
- **Auto Run default state**: `readStoredAutoRun()` returns `true` when `localStorage.oo_toggle_auto_run` is unset (`useAutoRunToggle.ts:22-29`). Use `setStoredAutoRun(null)` (removes the key) to restore the default-on state, or set `"false"` to force off.
- **Non-SQL / quick-mode**: not relevant to this feature; the panels are plain SQL tables.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The picker has NO Apply button** — `date-time-apply-btn` is never rendered for dashboard pickers (`auto-apply-dashboard="true"` → `DateTime.vue:305` `v-if="!autoApply"`). Do NOT assert on `date-time-apply-btn`; assert on the request firing + URL change (Auto Run on) or the yellow Refresh variant (Auto Run off).
- **"Applied" ≠ "picked"**: the picker's `v-model` value is the *picked* range; the *applied* range is what panels/URL use. A pick with Auto Run off changes nothing until `refresh()`/`apply()` runs. Assert the URL or the request, not the picker text, to detect "did it actually apply".
- **Yellow = waiting**: `data-o2-variant="warning"` (global `dashboard-refresh-btn`) and `data-o2-variant="ghost-warning"` (panel `dashboard-panel-refresh-panel-btn`, view-panel `dashboard-viewpanel-refresh-data-btn`) are the observable "waiting to apply" signal. The tooltip copy is `Refresh to apply the time range` / `...time range and variable changes`.
- **Absolute edits debounce 2.5 s** (`ABSOLUTE_APPLY_DEBOUNCE_MS`) and flush on menu close — a test that picks an absolute range must either wait >2.5 s or close the picker before asserting the request.
- **Fresh-on-open is one-shot per visit**: `dashboardFreshOnOpen` keeps a `refreshed` Set keyed by `dashboardId/panelId`; a revisited tab won't re-query again. Assert "exactly one re-query after the settle", not "a re-query on every reload" — reload the page (new visit → `freshOnOpen.reset()` on dashboard change) or use a fresh visit.
- **Cache restore is async & window-sensitive**: `acceptsCachedWindow` (`usePanelRefreshAfterRestore.ts:73-75`) rejects an absolute cache entry from a different window; a relative panel restores then re-queries. The panel data loader debounces 50 ms and waits for panel visibility + variables before the actual request — wait for the loading indicator (`[data-test$="-loading"]`) to settle, not just `networkidle` (which can be a false idle during the debounce).
- **`panelIdToBeRefreshed` scoping**: a panel-level apply sets `panelIdToBeRefreshed` so other panels skip (`usePanelDataLoader.ts:558`); a global refresh clears it. When asserting "only the target panel re-queried", track per-panel run counts (Pattern A) rather than a single global counter.
