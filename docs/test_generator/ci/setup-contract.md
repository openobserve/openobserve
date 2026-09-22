# Test Setup Contract: Folder Switch Pagination Reset (area: Dashboards)

Spec under test: `tests/ui-testing/playwright-tests/Dashboards/dashboardPagination.spec.js`
Playwright group: `Dashboards-Core`. Edition: OSS.

The feature is **client-side only** — the reset depends on the list's `data` array and the
`currentPage` ref, not on any special backend contract. The only thing the spec must establish is
**enough items in folders for a page-2 → switch → page-1 round trip to be observable** (page size
20 for Dashboards). Dashboards are the primary surface; the SLO/Alerts/Workflows variants share
the mechanism but are not the target of this spec.

## Streams / data the spec must establish
> Note: unlike a logs/charts feature, this needs **no stream ingestion**. It needs **dashboards**
> in folders. The `ingestion(page)` / `log.json` stream used by other dashboard specs is
> irrelevant here and can be omitted.

- **`<folderA>`** **[shared/read-only]** — a dashboard folder containing **> 20 dashboards**
  (e.g. 25) so the list paginates to 2+ pages. Why: Workflow 1 (navigate to page 2) and
  Workflow 2 (return preserves page 2) both read it.
- **`<folderB>`** **[shared/read-only]** — a second folder containing **> 20 dashboards**
  (e.g. 22) OR `default` if it already holds enough. Why: the folder-switch target. To make the
  "reset" assert crisp, B should have a *different* total than A so the pagination info text
  ("Showing 1 - 20 of M") is unambiguously B's count.
- Optional, per-test: a **`<folderSmall>`** **[per-test: TC-09/Workflow 3]** with **< 20
  dashboards** (e.g. 5) to exercise the stale-page clamp — or reuse a deep-link `?page=5` against
  a 1-page folder.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Dashboards (the bulk — create via API, not the heavyweight UI wizard)
The UI `pm.dashboardCreate.createDashboard()` opens dialogs and waits for navigation per
dashboard; creating 25 that way is far too slow. Use the existing API helper:

- **Exact helper:** `createDashboardViaApi(api, dashboardName, folderId)` —
  `tests/ui-testing/pages/dashboardPages/dashCreation.js:197` (POSTs a minimal v8 dashboard to
  `/api/${org}/dashboards?folder=…`).
- **The `api` instance:** `pm.apiCleanup` — constructed in
  `tests/ui-testing/pages/page-manager.js:180` (`new APICleanup(page)`), auth handled via
  `getAuthHeaders()` / `getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (see `apiCleanup.js:16-26`).
- **Loop pattern:** call `createDashboardViaApi(pm.apiCleanup, `e2e_pag_${Date.now()}_${i}`,
  folderId)` for `i` in 0..24. Return values are `{ success, dashboard }`; assert `success`.
- **Equivalent alternative:** `pm.apiCleanup.createMinimalDashboard(title, folderId)` —
  `tests/ui-testing/pages/apiCleanup.js:283` (no version field; still accepted).

### Folders
- **UI (preferred, already proven):** `pm.dashboardFolder.createFolder(folderName)` —
  `tests/ui-testing/pages/dashboardPages/dashboard-folder.js:80` (opens the folder dialog, fills
  `[data-test="dashboard-folder-add-name-field"]`, saves). Also `deleteFolder(folderName)` at
  `:99` for cleanup.
- **API (if the spec wants folders created without UI):** `POST /api/v2/{org}/folders/dashboards`
  with body `{ name, description, icon }` — confirmed by `web/src/services/dashboards.ts:77-81`
  (`new_Folder`) and `web/src/components/dashboards/AddFolder.vue:130-134`. There is **no**
  existing `apiCleanup` helper for folder create; a spec may add a small one modeled on
  `apiCleanup.createMinimalDashboard` — but the UI helper above already covers it, prefer it.
- **Folder id vs name:** the rail keys rows by `folderId` (`dashboard-folder-tab-{folderId}`),
  but resolve by **name** via `dashboard-folder-tab-name-{name}` (used by
  `pm.dashboardFolder.openFolderByName`) — folder names are unique in the test, ids are derived
  and not worth predicting.

### Navigation + auth
- **Login/base:** `await navigateToBase(page)` (from `enhanced-baseFixtures`), then
  `await pm.dashboardList.menuItem("dashboards-item")` —
  `tests/ui-testing/pages/dashboardPages/dashboard-list.js:75` — and
  `await waitForDashboardPage(page)` — `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:7`
  (waits for `[data-test="dashboard-table"]` or the dashboards API 200).
- **Org:** `ORGNAME` env var / `pm.apiCleanup.org` (`getOrgIdentifier()`). Do not hardcode an
  org id; reuse `process.env["ORGNAME"]`.

### Timing / load-state waits
- The reset and page numbers are observable only after the list has rendered. Gate assertions on
  the **pagination info** element, not on raw time:
  - `[data-test="o2-table-pagination-info"]` renders "Showing X - Y of Z". Wait for it to match
    `/Showing 1 - 20 of/` (page 1) before asserting the reset.
  - After clicking next-page, wait for `/Showing 21 -/` before switching folders.
- `waitForDashboardPage` already waits for the dashboards API; do **not** assert against rows
  before the skeleton clears (`data-test="o2-table"` has `data-test-loading="true/false"`).

## Preconditions / toggles
- Non-SQL/quick-mode is irrelevant (this is a CRUD list, not a query). No toggles.
- Ensure the test is on `/web/dashboards` with a `?folder=` query param (the list expects it —
  see the note in `dashboard-list.js:101-104`).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`restorePage` fires only on the FIRST load** (the `watch(loading, …, { once: true })` →
  `setTimeout(0)` → `restorePage` pattern). A later folder switch resets via the reactive
  `currentPage → table.setPageIndex` bridge, **not** via `restorePage`. Don't write a test that
  assumes `restorePage` re-runs on every switch.
- **Dashboards list is NOT sorted newest-first** (see `dashboard-list.js:24-25`), so a
  freshly-created dashboard can land anywhere; for bulk-created rows this doesn't matter (you
  assert counts/info text, not a specific row's page position).
- **Same-folder click re-emits** `update:activeFolderId` (FolderList `onTabClick`), and Dashboards
  ignores pre-landing emissions via `landingDecided` — don't click the already-active folder and
  expect a reset.
- **`?page=` is dropped on switch but kept on landing.** Assert the URL shape: after a switch the
  URL should be `?…&folder=<B>` with **no** `page`; after a Back it should still carry `page=2`.
- **Favorites pseudo-folder** (`__favorites__`) short-circuits the folder watch (Dashboards
  961-979); if any favorite exists the landing defaults to Favorites-first. A clean OSS org with
  no favorites lands on `default`. Don't assume the rail starts on `default` if a prior test
  favorited something.
- **Bulk cleanup is a shared-org concern.** Dashboards created in `default`/shared folders can
  collide across parallel tests. Use unique name prefixes (`e2e_pag_<Date.now()>_`) and unique
  folder names (`pm.dashboardFolder.generateUniqueFolderName`) per test; clean up in `afterEach`
  via `apiCleanup.deleteDashboard` / `pm.dashboardFolder.deleteFolder` to avoid leaking rows that
  would change another test's page counts.
