# Test Setup Contract: Logs Build Query — Apply Saved View  (area: Logs)

Spec: `tests/ui-testing/playwright-tests/Logs/logsBuildQuerySavedView.spec.js`
Group: `Logs-Features`

## Streams / data the spec must establish

- **`e2e_automate`** **[shared/read-only]** — fields include text fields `log`, `message`,
  `stream`, `kubernetes.*`, and numeric `FloatValue` (plus OpenObserve's auto-added `_timestamp`).
  Why: every test just READS it — the builder derives `histogram(_timestamp)`/`count(_timestamp)`
  and the field list from this schema; saved views are created/applied against it. It is never
  mutated by the test.

  > The build-mode saved view needs a stream whose schema is non-trivial (a text field to filter
  > on, e.g. `log` / `message`) so the saved view's `filter`/`x`/`y` fields are meaningful. The
  > seed below already provides this.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest** (beforeAll, `request` fixture — no page needed):
  ```js
  await ingestForQueryBuilderTest(request); // default streamName = "e2e_automate"
  ```
  `ingestForQueryBuilderTest` POSTs `tests/test-data/logs_data.json` to
  `${INGESTION_URL}/api/${orgId}/e2e_automate/_json` with `getAuthHeaders()`.
  Reference: `tests/ui-testing/playwright-tests/utils/queryBuilder-helpers.js:9-24`.
  Identical pattern already used by `tests/ui-testing/playwright-tests/Logs/logsQueryBuilder-chart.spec.js:27-29`
  and `logsQueryBuilder-filters-basic.spec.js` / `logsQueryBuilder-editor.spec.js`.

- **Init (beforeEach)** — select stream + absorb the auto-search so it doesn't land mid-test:
  ```js
  await navigateToBase(page);
  pm = new PageManager(page);
  await initQueryBuilderTest(page, pm); // selectStream("e2e_automate") + applyQueryButton
  ```
  Reference: `tests/ui-testing/playwright-tests/utils/queryBuilder-helpers.js:77-81`.

- **Enter build mode from a query** (for "restore fields" assertions):
  ```js
  await setupQueryAndSwitchToBuild(pm, page, query);
  // = enableSqlModeIfNeeded() + setQueryEditorContent() + runQueryAndWaitForResults()
  //   + clickBuildToggle() + waitForBuildTabLoaded()
  ```
  Reference: `tests/ui-testing/playwright-tests/utils/queryBuilder-helpers.js:56-63`.

- **Create a saved view in build mode** (precondition for apply tests) — copy the create flow from
  `tests/ui-testing/playwright-tests/Logs/monaco-query-prefill.spec.js:156-171`:
  `clickSavedViewsExpand()` → `clickSaveViewButton()` → `fillSavedViewName(name)` →
  `clickSavedViewDialogSave()`.
  The build-mode capture path is `SearchBar.vue:4060-4065` (writes `payload.data.buildData`).

- **Apply a saved view** — copy from `monaco-query-prefill.spec.js:184-193`:
  `clickSavedViewsExpand()` → `fillSavedViewSearchInput(name)` → `clickSavedViewByName(name)`
  (selector `[data-test="logs-search-bar-apply-${name}-saved-view-btn"]`).
  To apply while **already on the build tab** (headline), open saved views from the utilities menu
  WITHOUT leaving the build tab first.

- **Auth/org**: use `navigateToBase(page)`, `getOrgIdentifier()`, `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (same as queryBuilder-helpers).

## Preconditions / toggles

- SQL mode ON for "restore from parsed query / custom mode" cases: `pm.logsPage.enableSqlModeIfNeeded()`.
- SQL mode OFF for "non-SQL → builder defaults" case: `pm.logsPage.disableSqlModeIfNeeded()`.
- Build tab readiness gate: `pm.logsPage.waitForBuildTabLoaded()` / `expectBuildQueryPageVisible()`
  — the build `PanelEditor` renders `chart-renderer` OR `dashboard-panel-table` OR `no-data`
  (`logsPage.js:336` `buildInitIndicator`).

## Timing / async hydration gotchas (so the Healer/Engineer don't rediscover them)

- **Stream fields hydrate async.** `initializeFromQuery` → `updateGroupedFields()` must finish
  before `makeAutoSQLQuery()` produces the generated SQL. Assert chart/field state only AFTER the
  build tab's initial render is confirmed (see `buildInitIndicator`), never immediately after
  `clickBuildToggle()`.
- **Saved-view apply is async and closes the dialog immediately.** After `clickSavedViewByName`,
  the `getViewDetail` call + `mergeDeep` + BuildQueryPage re-init happen asynchronously. Wait for a
  deterministic end-state (the `/_search` response, or the chart repainting), not a fixed timeout.
  Existing guidance: `logsPage.js:3128-3164` ("Wait for the search triggered by applySavedView").
- **`savedBuildConfig` is one-shot and nulled on consume.** Re-applying the SAME view works because
  `applySavedView` sets it fresh each time; do not assert on the raw `searchObj.meta.savedBuildConfig`
  value (it is nulled immediately).
- **`index-dropdown-stream` / `o-field-list-search` are duplicated** between the build `PanelEditor`
  and the hidden logs sidebar `IndexList`. Always scope under `[data-test="logs-build-query-page"]`
  (see `logsPage.js:289-314`) or Playwright strict-mode will fail.

## Cleanup

- Saved views created by the test should be deleted at the end (copy the cleanup from
  `monaco-query-prefill.spec.js:207-219`: `clickDeleteSavedViewButton(name)` → `clickConfirmButton()`).
