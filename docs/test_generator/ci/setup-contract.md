# Test Setup Contract: Logs Search History Re-apply Query  (area: Logs)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `e2e_automate` **[shared/read-only]** — logs stream, fields include `log`, `stream`, `code`,
  `level`, `message`, `kubernetes.*`, etc. (3848 records). Why: both tests run `SELECT * FROM
  "e2e_automate" WHERE <always-true>` to populate the results grid and the Vuex logs cache — the
  queries must return rows so `waitForResultsLoaded()` sees pagination.
- No additional edge-case stream is required for this feature. The re-applied query is **not run**,
  so no stream with a specific schema/field is needed beyond `e2e_automate`.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Stream + data**: `e2e_automate` is ingested once in global setup, NOT per-spec.
  `POST /api/{ORGNAME}/e2e_automate/_json` with body `logsdata` (from
  `tests/test-data/logs_data.json`, 3848 records) —
  see `tests/ui-testing/playwright-tests/utils/global-setup.js:149-167`
  (`performGlobalIngestion`). Do NOT re-create or re-ingest in the spec.
- **Select the stream in-test**: `await pm.logsPage.selectIndexStream('e2e_automate')` —
  `tests/ui-testing/pages/logsPages/logsPage.js:867`.
- **Auth/org**: worker auth state already established by global setup; the spec navigates with
  `await navigateToBase(page)` then `page.goto(\`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}\`)`.
  `logData` is `tests/ui-testing/fixtures/log.json` (`logsUrl: "/web/logs"`).

## Preconditions / toggles
- **Usage reporting MUST be enabled** (`store.state.zoConfig.usage_enabled === true`). If false,
  SearchHistory.vue renders the "enable usage reporting" message instead of the table and the
  `search-history-go-to-logs-btn` never appears. This is environment config (zoConfig from the
  config API), not set by the test.
- **Non-SQL-mode not required** — both queries are SQL mode (`SELECT * FROM ...`), which the search
  bar auto-detects. No `disableSqlModeIfNeeded()` call is used by this spec.

## Per-test setup sequence (from the existing spec)
The cache-poisoning setup (the whole point of #14283) is done in `beforeEach` and repeated per test
(serial mode):
```js
await navigateToBase(page);
pm = new PageManager(page);
await page.goto(`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}`);
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2000);
await pm.logsPage.selectIndexStream('e2e_automate');
await page.waitForTimeout(1000);
for (const query of [EARLIER_QUERY, LATEST_QUERY]) {
  await pm.logsPage.typeQuery(query);          // logsPage.js:1384
  await page.waitForTimeout(500);
  await pm.logsPage.selectRunQuery();          // logsPage.js:1196
  await pm.logsPage.waitForResultsLoaded();    // logsPage.js:11224
}
```
- `EARLIER_QUERY = SELECT * FROM "e2e_automate" WHERE 200 = 200` (marker `200`)
- `LATEST_QUERY  = SELECT * FROM "e2e_automate" WHERE 404 = 404` (marker `404`)

## The action under test (copy EXACT helpers)
- Open history: `await pm.searchHistoryPage.openFromLogs()` —
  `tests/ui-testing/pages/logsPages/searchHistoryPage.js:30` (clicks hamburger
  `logs-search-bar-more-options-btn` → `search-history-item-btn`, waits for `/logs/search-history`).
- Re-apply: `const reAppliedSql = await pm.searchHistoryPage.reApplyQuery(marker)` —
  `searchHistoryPage.js:67` (polls `waitForQueryRow`, expands row, clicks `search-history-go-to-logs-btn`,
  waits for `/logs`). Returns the colorized SQL text (`search-history-sql-colorized`).
- Assert editor: `await pm.logsPage.getQueryEditorTextWhenReady(EARLIER_MARKER, 30000)` (fallback
  `pm.logsPage.getQueryEditorText()`) — `logsPage.js:3450` / `:3423` (reads Monaco via
  `window.monaco.editor.getEditors()`).
- Assert URL: `new URL(page.url()).searchParams.get('query')` then undo URL-safe base64
  (`-`→`+`, `_`→`/`, `.`→`=`) before `Buffer.from(..., 'base64')`; also assert `sql_mode === 'true'`.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **The re-applied query is NOT run.** After re-apply, `searchApplied=false` and no `getQueryData`
  fires — so `waitForResultsLoaded()` will NOT succeed and must not be called. Assert only on the
  editor text and the URL. (Index.vue `applyReAppliedQuery` :1131; `setupLogsTab` :984.)
- **Usage rows publish asynchronously.** Never assume the history row is present on first paint —
  `waitForQueryRow` polls the refresh button up to `attempts=12 × intervalMs=5000`. If it never
  appears, usage reporting is likely disabled / not publishing on the environment (the error message
  says so explicitly).
- **Query editor is Monaco and lazy-loads**; it can prefill asynchronously and even fire a transient
  empty `""` change before the restored value lands (`pendingUrlQueryRestore` flag). Read via
  `getQueryEditorTextWhenReady(marker, timeout)` (polls), not a one-shot `getQueryEditorText()`.
- **Recorded SQL may differ in spacing/casing** from what was typed. Match a discriminating literal
  (`200` vs `404`), never the full typed string, against editor/URL text only.
- **Row expansion is single + on-row-click.** `reApplyQuery` clicks the row first (which expands it
  via `expand-on-row-click`), then `.first()` on `search-history-go-to-logs-btn` inside the expansion.
- **`restoreUrlQueryParams` deletes the `type` param** after restoring (useLogs.ts:428-430), so the
  logs URL after re-apply carries `query`/`sql_mode` but not `type=search_history_re_apply`.
- **Multiple `data-test` matches exist** for some selectors (e.g. colorized SQL and OTable rows across
  body + expansion) — use `.first()` and scope (the page object already does).
