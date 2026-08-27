# Test Setup Contract: Logs Saved View Build Mode Restore  (area: Logs)

Spec: `tests/ui-testing/playwright-tests/Logs/savedViewBuildMode.spec.js`
Group: `Logs-Features`

## Streams / data the spec must establish

- `e2e_automate` **[shared/read-only]** — the standard pre-seeded logs test stream. Fields are
  whatever `test-data/logs_data.json` (ingest fixture) provides; at minimum `_timestamp` plus log
  body fields are required for the builder's `histogram(_timestamp)`/`count(_timestamp)` defaults
  and for any `SELECT … GROUP BY` chart queries.
  - Why: every workflow starts by selecting this stream and running a query; the builder's default
    fields reference `_timestamp`, and chart queries need data to render (a chart on an empty stream
    shows `no-data`, which some positive end-state assertions treat as acceptable but not "restored").

No additional streams are required. The feature mutates only in-memory search state + a saved-view
record; it does not require a second stream or a special schema. (If a test asserts the
"stream missing" error path, it must reference a non-existent stream name in the saved view — see
Gotchas.)

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** use the existing helper — `ingestForQueryBuilderTest(request)` in `beforeAll`, or
  `ingestTestData(page)` (from `tests/ui-testing/playwright-tests/utils/data-ingestion.js`) in
  `beforeEach`. Both POST to `${INGESTION_URL}/api/{org}/e2e_automate/_json` with the
  `test-data/logs_data.json` payload. Reference:
  - `tests/ui-testing/playwright-tests/Logs/logsQueryBuilder-chart.spec.js:27-37` (`beforeAll` + `ingestForQueryBuilderTest`).
  - `tests/ui-testing/playwright-tests/Logs/logsVisualizePersistence.spec.js:16-40` (`beforeEach` + `ingestTestData`).
- **Stream select + initial query:** `initQueryBuilderTest(page, pm)` →
  `pm.logsPage.selectStream("e2e_automate")` + `applyQueryButton(pm)` (absorbs the auto-search the
  stream pick fires). See `tests/ui-testing/playwright-tests/utils/queryBuilder-helpers.js:77-81`.
- **SQL-mode build entry + chart query:** `setupQueryAndSwitchToBuild(pm, page, query)` (enables SQL
  mode, sets editor content, runs query, clicks Build toggle, waits for load). See
  `queryBuilder-helpers.js:56-63` and usage at `logsQueryBuilder-chart.spec.js:53-95`.
- **Create a Saved View (UI):** `pm.logsPage.clickSavedViewsButton()` → `fillSavedViewName(name)` →
  `clickSavedViewDialogSave()`. See `logsPage.js:3097-3206` and usage at
  `logsqueries.spec.js:76-78`.
- **Apply a Saved View (UI):** `pm.logsPage.clickSavedViewByName(name)` or
  `clickSavedViewByTitle(title)`. See `logsPage.js:8487` and usage at
  `monaco-query-prefill.spec.js:193`, `logsqueries.spec.js:84`.
- **Auth/org:** `getOrgIdentifier()` + `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (handles cloud cookie vs self-hosted Basic).
  Navigation via `navigateToBase(page)` from `utils/enhanced-baseFixtures.js` and
  `page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`)`.

## Preconditions / toggles

- Build-tab save must happen while `logsVisualizeToggle === 'build'` — otherwise `getSearchObj()`
  does not capture `data.buildData` (`SearchBar.vue:4130`), and the "restore" test silently has
  nothing to restore. Sequence: enter Build tab → configure chart → then save the view.
- Ensure a deterministic **non-default chart type** is selected before saving (e.g. `selectChartType('area')`
  or `'table'`), so the restore assertion is distinguishable from the default `bar`.
- To exercise the **headline regression** (restore works when `isFirstToggle` is already false),
  the test must visit the Build tab once (or apply another view) *before* applying the build-mode
  view — `onBuildInitialized` flips `isFirstBuildToggle` to `false` (`Index.vue:2525-2530`).

## Assertion helpers already available (do NOT write new ones)

- `pm.logsPage.clickBuildToggle()` / `expectBuildQueryPageVisible()` / `expectBuildQueryPageNotVisible()` — `logsPage.js:9492,9672,9680`.
- `pm.logsPage.verifyChartTypeSelected(chartId)` — asserts `[data-test-selected="{chartId}"]` — `logsPage.js:10198`.
- `pm.logsPage.expectBuilderModeActive()` / `expectCustomModeActive()` — `logsPage.js:10021,10037`.
- `pm.logsPage.expectXAxisLayoutVisible()` / `expectYAxisLayoutVisible()` / `expectBreakdownLayoutVisible()` — `logsPage.js:10080-10098`.
- `pm.logsPage.expectBuildStreamSelected(name)` — `logsPage.js:9533`.

## Gotchas (so the Healer/Engineer don't rediscover them)

- `test-data/logs_data.json` (referenced by the ingestion helpers) may not be present in a bare
  checkout — it is produced by the CI data-seeding step. The ingestion helpers above are the
  canonical consumers; do NOT hardcode a local payload unless the helper pattern is unavailable.
- The builder's stream fields load **asynchronously** (`updateGroupedFields()` →
  `getStream(...)`); assert chart/field state only after `waitForBuildTabLoaded()` /
  `expectBuildQueryPageVisible()` (the model settles a tick late — `logsPage.js:10392`).
- `savedBuildConfig` is **consumed once** and nulled on mount (`BuildQueryPage.vue:236-237`). A test
  that toggles away and back to Build will NOT re-apply the saved chart (by design) — it re-derives
  from the logs query. Assert restore on the *first* build-tab mount after applying the view.
- Applying a saved view triggers an async detail fetch + a new search (1000 ms `setTimeout` before
  `getQueryData`, `SearchBar.vue:3966-3982`). Reuse `pm.logsPage.clickSavedViewsExpand()`'s
  settle-and-wait pattern (`logsPage.js:3105-3145`) before re-opening the saved-views dialog.
- Applying a saved view whose stream no longer exists throws `search.streamNotExist` (error toast) —
  only relevant if you intentionally test the missing-stream edge case; the main path uses
  `e2e_automate`, which always exists.
- Build-tab stream select must be scoped `[data-test="logs-build-query-page"] …` because PanelEditor
  also renders on the Visualize tab (v-show, hidden) — see `logsPage.js:290-292`.
