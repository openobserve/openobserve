# Test Setup Contract: Logs Saved View Apply on Build Tab (area: Logs)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `e2e_automate` **[shared/read-only]** — Logs stream with a rich schema (kubernetes fields + `log`
  text field + `_timestamp`). This is the default stream used by the existing helper `ingestTestData`.
  Why: the applied view's query needs a stream with data so `runQuery()` after restore returns results
  (avoids flaky "no data" states), and the builder needs non-empty field list to attach X/Y fields.
- Each test that CREATES a saved view should use a **unique view name** (e.g. `savedview_apply_<random>`)
  **[per-test]** — saved views are global (org-scoped), not per-stream. A unique name prevents
  cross-test collisions when the same org is reused across tests.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Ingest seed data: `const { ingestTestData } = require('../utils/data-ingestion.js'); await ingestTestData(page);`
  → ingests `tests/test-data/logs_data.json` into stream `e2e_automate`.
  Reference: `tests/ui-testing/playwright-tests/Logs/logsQueryBuilder.spec.js:86` (and many others in that file).
- Custom stream/data: `const { ingestCustomData, waitForStreamData } = require('../utils/data-ingestion.js');`
  → `await ingestCustomData(page, streamName, dataArray)` then `await waitForStreamData(page, streamName, 1)`.
  Reference: `tests/ui-testing/playwright-tests/utils/data-ingestion.js:88-121, 178-226`.
- Auth/org: uses `getOrgIdentifier()` / `getAuthHeaders()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`
  (already wired inside `ingestTestData`). No extra login step needed for the ingestion API.
- Navigate to Logs + select stream: `pm.logsPage` methods — `clickStreamsMenuItem()` /
  `fillSearchStreamInput(...)` / select the stream, then wait for the logs table
  (`[data-test="logs-search-result-logs-table"]`).
- **Create a saved view (build mode)** — the EXACT sequence the apply test depends on:
  1. `await pm.logsPage.clickBuildToggle()` (`[data-test="logs-build-toggle"]`).
     Reference: `tests/ui-testing/pages/logsPages/logsPage.js:6313`.
  2. Configure a builder field (e.g. add a field to X/Y) so `getBuildConfig` captures a non-empty
     `fields.x`/`fields.y`. Helpers: `pm.logsPage.searchFieldInBuilder(...)` +
     `[data-test="dashboard-add-x-data"]` / `dashboard-add-y-data`.
  3. Optionally change chart type via `[data-test="selected-chart-{type}-item"]`.
  4. Open save dialog: `pm.logsPage.clickSaveViewButton()` (left split button) →
     fill `[data-test="add-alert-name-input"]` → `pm.logsPage.clickSavedViewDialogSave()`.
     Reference: `tests/ui-testing/pages/logsPages/logsPage.js:1959-1989`.
  5. Confirm success notification `search.viewCreatedSuccessfully`.
- **Apply a saved view** — open the list and click the row by name:
  - `pm.logsPage.clickSavedViewsExpand()` (waits for the search to settle first, then opens dropdown) —
    Reference: `tests/ui-testing/pages/logsPages/logsPage.js:1915-1957`.
  - `await pm.logsPage.fillSavedViewSearchInput(viewName)` then click the row:
    `pm.logsPage.clickSavedViewByTitle(viewName)` (uses `getByTitle` = view name) —
    Reference: `tests/ui-testing/pages/logsPages/logsPage.js:2044-2048`.
  - Success assertion: `.q-notification__message` contains `view applied successfully.`
- Cleanup: `pm.apiCleanup.cleanupSavedViews()` deletes views matching `streamslog*` / `multistream_view_*`
  (Reference: `tests/ui-testing/pages/apiCleanup.js:2149`). Use a name prefix that matches a cleanup
  pattern, or delete the created view explicitly via `pm.apiCleanup.deleteSavedView(viewId)`.

## Preconditions / toggles

- Ensure SQL mode is ON before configuring/saving builder fields if you want a deterministic SQL
  restore (the apply flow sets `searchObj.meta.sqlMode = false` in `applySavedView`, then the saved
  view's own `meta.sqlMode` is restored via merge — so the saved view's SQL-mode state wins). Do not
  assume SQL mode after apply; assert on the builder UI state (query type button `.selected`), not on
  the SQL toggle.
- The build tab must be entered at least once before the apply test's "already on build tab" variant;
  otherwise the remount path (onMounted) is exercised instead of the watcher path. To exercise the
  watcher path: enter Build tab → switch back to Logs **without** leaving the page → apply the view.
  To exercise the onMounted path: apply the view while currently on Logs/Visualize tab.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Apply is async + settles after ~1s**: `applySavedView` runs `extractFields()` + `getQueryData()` inside
  a `setTimeout(..., 1000)`. After clicking a view, the build tab + restored fields appear but the query
  completes slightly later. Wait for the builder to be stable (e.g. `dashboard-x-item-*` / query-type
  `.selected`) before asserting, and wait for `.q-notification__message` for apply confirmation.
- **`clickSavedViewsExpand` is specifically hardened** against "element detached from DOM" after an
  apply-triggered re-render (logsPage.js:1915-1957). Prefer it over a raw `.click()` on the dropdown.
- **Field aliases are meaningful**: the default X field has alias `x_axis_1` and Y field `y_axis_1`
  (`BuildQueryPage.vue:86-114`). A saved view restores the *saved* aliases. Assert on
  `dashboard-x-item-{alias}` / `dashboard-y-item-{alias}` presence, not on text labels (labels show the
  field's display name and may differ).
- **Chart type restore vs auto-select**: on a *saved-view apply* the saved `type` is restored verbatim
  (`BuildQueryPage.vue:261-264`). If your saved view used a non-default chart, assert
  `[data-test="selected-chart-{type}-item"]` is present/selected; if you didn't change the chart, the
  default is `bar` (or `table` for custom-query). Don't assume `line`.
- **`savedBuildConfig` is one-shot** (`BuildQueryPage.vue:249`): after the first apply, toggling to
  Logs and back re-derives from the logs query. A test that toggles away and back should expect
  re-derivation, not a second restore.
- **Stream schema loads async** in the builder: `updateGroupedFields()` is awaited before
  `makeAutoSQLQuery()`, but the field list UI can lag. Wait for the field-list search
  (`[data-test="index-field-search-input"]`) to be visible before adding fields.
- **Saved views are org-global**: reuse of the same org across specs means leftover views from prior
  runs. Always use a unique view name and clean up in `afterAll`/`afterEach`.
