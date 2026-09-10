# Test Setup Contract: Logs Search Result Scroll Reset  (area: Logs)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_scroll_reset_<runId>`** **[per-test-worker / read-only]** — a logs stream with **>10 records**
  (use the standard `logs_data.json` fixture, 3,848 records, so every page size 10/25/50/100 yields
  multiple pages). Why: pagination page-change + rows-per-page change must have a non-empty page 2
  and enough rows that the shared pane actually scrolls.

  Note: the existing scroll-retention regression (`logs-9044-7354.spec.js`) reuses the pre-seeded
  `e2e_automate` stream. The new spec may either follow that pattern (shared, read-only) or ingest
  its own unique stream per worker (matches `pagination.spec.js`, which avoids cross-run deletion
  races). Prefer the **unique-per-worker ingest** pattern below for isolation.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest (unique stream):**
  ```js
  // pagination.spec.js:34-40
  if (!streamReady) {
    streamName = generateRandomStreamName();
    await pageManager.ingestionPage.ingestionMultiOrgStream(orgId, streamName);
    await pageManager.logsPage.waitForStreamAvailable(streamName, 120000, 1000);
    streamReady = true;
  }
  ```
  `ingestionMultiOrgStream(orgId, streamName)` POSTs the `logs_data.json` fixture (3,848 records)
  to `${INGESTION_URL}/api/${orgId}/${streamName}/_json` — see
  `tests/ui-testing/pages/generalPages/ingestionPage.js:140-164`.

- **Alternative — pre-seeded stream (read-only):** reuse `e2e_automate`, as in
  `tests/ui-testing/playwright-tests/RegressionSet/Logs/logs-9044-7354.spec.js:18-24`:
  ```js
  await pm.logsPage.selectIndexStream('e2e_automate');
  await pm.logsPage.typeQuery('SELECT * FROM "e2e_automate"');
  await pm.logsPage.selectRunQuery();
  await pm.logsPage.waitForResultsLoaded();
  ```

- **Auth/org:** `orgId = process.env.ORGNAME || "default"`. Navigate to
  `${logData.logsUrl}?org_identifier=${orgId}` (or use `navigateToBase(page)` from
  `enhanced-baseFixtures.js`, then `page.goto(...)`). `logData` = `tests/ui-testing/fixtures/log.json`
  (`logsUrl` = `/web/logs`).

- **Timing / load state:** run the query, then `await pm.logsPage.waitForResultsLoaded()` which waits
  for `[data-test="logs-search-result-pagination"]` visible + 500 ms settle. Do NOT assert scroll
  until this resolves — the virtualized table only reports a real `scrollHeight` once rows exist.

## Preconditions / toggles

- **Ensure non-SQL mode** so `logsVisualizeToggle === 'logs'` and pagination/rows-per-page render:
  `await pm.logsPage.disableSqlModeIfNeeded()` (helper at `logsPage.js:8936`) before running the query.
- **Histogram does not matter** for scroll assertions: `_scrollContainerFinder()` finds the shared
  pane whether or not the histogram strip is present.

## Exact scroll helpers to reuse (do NOT reinvent)

These already exist and are purpose-built for this feature — see
`tests/ui-testing/pages/logsPages/logsPage.js:11238-11332`:
- `await pm.logsPage.scrollToResultsBottom()` — sets the shared pane `scrollTop = scrollHeight`.
- `await pm.logsPage.getScrollContainerPosition()` — returns the pane `scrollTop` (number).
- `await pm.logsPage.clickPageNumber('2')` — clicks page-number button and waits.
- `await pm.logsPage.clickNextPage()` — clicks Next and waits.
- Rows-per-page: `await pm.logsPage.clickResultsPerPage()` then
  `await pm.logsPage.selectResultsPerPageAndVerify(value, expectedText)` — see `pagination.spec.js:54-57`.

The shared scroll container has **no `data-test` attribute**; it is located in-page by walking up from
`[data-test="logs-search-result-logs-table"]` to the nearest `overflow-y: auto|scroll` ancestor
(`LogsPage._scrollContainerFinder()`, `logsPage.js:11264-11290`).

## Gotchas (so the Healer/Engineer don't rediscover them)

- The results table delegates scroll to an ancestor pane shared with the pinned histogram — never
  assert on `document.body.scrollTop` or the table element itself; always use
  `getScrollContainerPosition()`.
- Pagination is **disabled while loading/streaming** (`:disable="searchObj.loading"`); wait for
  `waitForResultsLoaded()` before clicking.
- In **SQL mode** the pagination/rows-per-page controls are hidden — the scroll-reset assertions for
  Workflow 1/2 require non-SQL mode.
- The **patterns-view** scroll reset (Workflow 3) is unreachable in OSS: the `logs-patterns-toggle`
  button renders only when `config.isEnterprise == 'true'` (`SearchBar.vue:105`). Park that case as
  `test.fixme` / skip rather than asserting it.
- A fresh **re-run of the same query** does NOT reset scroll (no `scrollTableToTop` in the
  `searchObj.loading` watcher). Do not write a "new search resets scroll" assertion — it will fail.
