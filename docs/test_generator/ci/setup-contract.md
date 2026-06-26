# Test Setup Contract: FTS Default Column in Logs  (area: Logs)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate`** **[shared/read-only]** — fields: `log` (TEXT — the raw log message, populated), `message` (TEXT — hostname value, populated), `stream` (TEXT, "stderr"), `kubernetes_container_name` (TEXT, "prometheus"), `kubernetes_namespace_name` (TEXT, "monitoring"), `code` (nullable numeric), `level` (nullable), plus ~40 more kubernetes.* nested fields. Why: all FTS behaviors need a stream with at least two FTS candidates (`message`, `log`) that both have non-empty values in hits, plus a non-FTS user field (`kubernetes_container_name`) for additive toggle tests.

- **`e2e_automate_no_fts`** **[per-test: TC-EDGE-NO-CANDIDATE]** — fields: only non-text/non-FTS fields (e.g., `code` INT, `took` FLOAT, `_timestamp`). No field marked `ftsKey: true`. Why: exercises the "no FTS candidates → fallback to _timestamp + source only" edge case (Edge Case 1 in the design doc). **NOTE**: This stream does NOT exist in the current repo test-data fixtures. If needed for new edge-case tests, it must be created via API (see below for `ingestCustomData` pattern).

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Standard stream (`e2e_automate`) with FTS candidates

**Ingest:** `ingestTestData(page)` from `tests/ui-testing/playwright-tests/utils/data-ingestion.js:11-31`
  - See existing usage at: `tests/ui-testing/playwright-tests/Logs/ftsDefaultColumn.spec.js:35`
  - This ingests `tests/test-data/logs_data.json` (150k records, each with `log`, `message`, plus kubernetes fields) to the `e2e_automate` stream.
  - The `log` field contains full log messages (e.g. `"ts=2022-12-27T14:09:59.212Z caller=klog.go:108..."`).
  - The `message` field contains hostnames (e.g. `"ip-10-2-15-197.us-east-2.compute.internal"`).
  - Both are populated in every record → the fill-rate heuristic sees both as equally populated → `message` wins on FTS_PRIORITY tiebreak (`message` index 2 < `log` index 3).

**Wait for data:** `waitForStreamData(page, "e2e_automate", 1, 30000)` from `tests/ui-testing/playwright-tests/utils/data-ingestion.js:178-226`
  - See existing usage at: `tests/ui-testing/playwright-tests/Logs/ftsDefaultColumn.spec.js:42`
  - Polls the search API (`SELECT COUNT(*) as count FROM "e2e_automate"`) until >=1 record is found.

**Auth/org:** ORGNAME=default; the worker auth state / login pattern from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` (`navigateToBase` + `getOrgIdentifier`).
  - See: `tests/ui-testing/playwright-tests/Logs/ftsDefaultColumn.spec.js:30-32`

**Page navigation:** `page.goto(\`\${logData.logsUrl}?org_identifier=\${getOrgIdentifier()}\`)` then `pm.logsPage.selectStream("e2e_automate")`.
  - See: `tests/ui-testing/playwright-tests/Logs/ftsDefaultColumn.spec.js:45-48`
  - `logData.logsUrl` is `/web/logs` from `tests/ui-testing/fixtures/log.json:4`

**Time range:** `pm.logsPage.clickDateTimeButton()` → `pm.logsPage.clickRelative15MinButton()` (sets "Last 15 minutes").
  - See: `tests/ui-testing/playwright-tests/Logs/ftsDefaultColumn.spec.js:51-52`

**Quick Mode OFF:** `pm.logsPage.ensureQuickModeState(false)`.
  - See: `tests/ui-testing/playwright-tests/Logs/ftsDefaultColumn.spec.js:53`

**Initial search with retry:**
  ```
  for (let attempt = 1; attempt <= 3 && !resultsReady; attempt++) {
    await pm.logsPage.clickSearchBarRefreshButton();
    resultsReady = await pm.logsPage.waitForSearchResults(20000)
      .then(() => true).catch(() => false);
  }
  ```
  - See: `tests/ui-testing/playwright-tests/Logs/ftsDefaultColumn.spec.js:59-68`

**Timing:** The FTS default column appears only AFTER the search response arrives and the `searchObj.loading` watcher fires (`SearchResult.vue:1773-1813`). Always call `waitForSearchResults(timeout)` before asserting column visibility. Wait for `<table>` to exist + `<td>` children to render.

### Custom stream WITHOUT FTS candidates (edge case)

**Ingest:** `ingestCustomData(page, "e2e_automate_no_fts", customPayload)` from `tests/ui-testing/playwright-tests/utils/data-ingestion.js:88-121`
  - The payload must contain records with ONLY non-text/FTS-keyed fields.
  - Example payload: `[{ "code": 200, "took": 1.5 }, { "code": 404, "took": 0.3 }]`
  - This stream has no `ftsKey: true` fields → `resolveDefaultColumns()` returns `[]`.

**Set stream FTS keys to empty:** Configure the stream via API (PUT `/api/{orgId}/streams/{streamName}/settings?type=logs`) with `{ "full_text_search_keys": [] }`.
  - This ensures no schema field is marked as `ftsKey: true`.
  - See existing pattern: `enableLogPatternsExtraction` at `tests/ui-testing/playwright-tests/utils/data-ingestion.js:129-166`

## Preconditions / toggles

- **SQL Mode OFF** is the default (`searchObj.meta.sqlMode = false`). All FTS auto-pick tests rely on this. Use `pm.logsPage.isSqlModeEnabled()` to verify — see `tests/ui-testing/pages/logsPages/logsPage.js:7196`.
- **Non-Quick Mode** ensures the field sidebar shows all fields (not just "interesting" ones). Used by tests that toggle fields from the sidebar.
- **Histogram visible by default** — tests don't need to toggle it, but the combined scroll area works with or without the histogram.
- **No saved views applied** at start — ensures default behavior (no prior column selection).

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Close button is CSS-hidden (`invisible` class).** The close (X) button on column headers has `class="tw:invisible"` and only appears on column-header hover. Use `force: true` in `click()` to bypass the visibility check. See `logsPage.js:5265-5276` (`clickCloseColumnButton`).
2. **Stream schema arrives async.** The FTS resolver depends on `selectedStreamFields` (populated by `extractFields()`), which loads schema asynchronously. If you query before schema loads, `resolveDefaultColumns` receives empty `streamFields` and returns `[]`. Always `waitForSearchResults` before asserting.
3. **Worker contention / slow search in parallel mode.** The CI runs all 7 FTS tests in `parallel` mode (`test.describe.configure({ mode: 'parallel' })`). Under load, the first search may time out. The existing spec retries the refresh up to 3 times (lines 59-68). New tests should follow this retry pattern.
4. **`message` wins over `log` in the test data.** The `e2e_automate` stream has both `message` and `log` populated in every record, so the fill-rate heuristic sees a tie → breaks by FTS_PRIORITY where `message` (index 2) beats `log` (index 3). Tests that assert `message` specifically are safe; tests that resolve via `resolveFtsDefaultField()` (line 5244-5249 in logsPage.js) handle either.
5. **`isFtsDefaultColumn` prevents localStorage persistence.** The FTS auto-pick is deliberately transient: `updatedLocalLogFilterField()` (logsUtils.ts:730-731) returns early when `isFtsDefaultColumn` is true. This means the auto-pick does NOT survive a full page reload — tests that reload the page must re-run a search to re-trigger the watcher.
6. **SQL mode watcher only fires on `loading` transition.** If SQL mode is toggled ON but no search is run, the FTS default columns remain in the table from the previous non-SQL search. Only when a SQL-mode search completes does `updateGridColumns` (useStreamFields.ts:1094-1096) clear them. Tests verifying SQL-mode behavior MUST run a search after toggling.
