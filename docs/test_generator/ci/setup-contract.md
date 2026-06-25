# Test Setup Contract: FTS Default Column Selection  (area: Logs)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:

- **e2e_automate** **[shared/read-only]** — fields include `log` (TEXT, FTS-keyed), `message`, `kubernetes.pod_name`, `kubernetes.namespace_name`, `stream`, `code`, `level`, `_timestamp`. Why: used by TC-01 (auto-pick FTS default when no column selected), TC-04 (user override persists), TC-05 (user column not overwritten by system pick).

- **fts_body_only** **[per-test: TC-02]** — a stream with a single TEXT field `body` that has high fill rate in search results, plus `severity`, `_timestamp`. Why: exercises the `FTS_PRIORITY` tiebreaker where `body` outranks `message`/`log` by priority, AND the single-field scenario (no ambiguity = the only FTS candidate is the default).

- **fts_no_candidates** **[per-test: TC-03]** — a stream whose schema has ONLY non-text fields like `code` (int64), `count` (float64), `_timestamp`. No `ftsKey` fields and no `default_fts_keys` matching. Why: no FTS candidate exists → `resolveDefaultColumns` returns `[]` → falls back to the generic `source` column. Tests the empty/default-`source` path.

- **sql_mode_stream** **[per-test: TC-06]** — same schema as e2e_automate, ingested with data. Why: tests that SQL mode skips FTS auto-pick entirely (even with a valid FTS candidate present).

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Shared stream: e2e_automate — already pre-seeded by global setup
- Global setup (alpha1) already ingests `tests/test-data/logs_data.json` into `e2e_automate`. No additional creation needed. Reference: `tests/ui-testing/playwright-tests/utils/global-setup-alpha1.js:502`.

### Per-test streams (fts_body_only, fts_no_candidates, sql_mode_stream)
- **Ingest custom data** via page.request API (secure, keeps credentials in Node.js context):
  ```js
  const { ingestCustomData } = require('../utils/data-ingestion.js');
  await ingestCustomData(page, 'fts_body_only', [
    { body: '200 OK GET /api/users', severity: 'info', _timestamp: Date.now() * 1000 },
    { body: '500 ERR POST /api/login', severity: 'error', _timestamp: Date.now() * 1000 },
    { body: '', severity: 'debug', _timestamp: Date.now() * 1000 },
    // ... enough records that body has >0 fill rate
  ]);
  ```
- Reference: `tests/ui-testing/playwright-tests/utils/data-ingestion.js:88` (ingestCustomData).
- **Wait for indexing** before navigating to logs page:
  ```js
  const { waitForStreamData } = require('../utils/data-ingestion.js');
  await waitForStreamData(page, 'fts_body_only', 3, 30000, 2000);
  ```
- Reference: `tests/ui-testing/playwright-tests/utils/data-ingestion.js:178`.

### Auth/org
- ORGNAME = `process.env["ORGNAME"]` (set by global setup; usually "default").
- Login/auth state handled by `navigateToBase(page)` in `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`.
- Reference for pattern: `tests/ui-testing/playwright-tests/Logs/logsqueries.spec.js:24-36` (beforeEach block).

### Page object
```js
const PageManager = require('../../pages/page-manager.js');
const pm = new PageManager(page);
```
The logs page object (`pm.logsPage`) includes:
- `pm.logsPage.selectStream(streamName)` — selects a stream via dropdown
- `pm.logsPage.expectRefreshButtonVisible()` — waits for run button to be ready
- `pm.logsPage.runQueryAndWaitForResults()` — clicks Run and waits for results table
- `pm.logsPage.expectLogTableColumnSourceVisible()` — checks "source" column (default fallback)
- Locators for individual log table column headers: `[data-test="log-search-result-table-th-<fieldName>"]`

Reference for page object methods: `tests/ui-testing/pages/logsPages/logsPage.js`.

## Preconditions / toggles

- **Non-SQL mode**: The feature ONLY activates when `searchObj.meta.sqlMode === false`. The default state when navigating to `/logs` with a stream is non-SQL mode, so tests must NOT toggle SQL mode unless explicitly testing the SQL-skip path (TC-06).
- **No pre-selected columns**: The auto-pick fires when `selectedFields` is empty (first visit, or after reset). To force this in a test: after stream selection, navigate fresh or use the "Reset" button (`[data-test="logs-search-bar-reset-filters-btn"]`).
- **Schema hydration**: The stream schema (including `ftsKey` flags) loads async after stream selection. The FTS default-column watcher fires on `loading` transition (`true → false`), which happens only AFTER the schema has arrived and `extractFields()` has populated `selectedStreamFields`. So: select stream → run query → wait for results table → **then** inspect columns. Do NOT inspect columns immediately after stream selection before the search completes.
- **`default_fts_keys` config**: Server sends this as part of zoConfig (usually `["log", "message", "msg", "content", "data"]`). Confirmed present in test helpers: `web/src/test/unit/helpers/store.ts:82`.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Schema loads async** — the feature's `resolveDefaultColumns` reads `selectedStreamFields` which is populated by `extractFields()`. If you query before the schema arrives, `selectedStreamFields` is `[]` and the resolver always returns `[]` → falls to `source`. Always wait for the search result table to render before asserting column headers.
2. **Existing e2e_automate data** has `log` as a TEXT field (it's the full log message), which is an FTS candidate. The `e2e_automate` stream schema marks `log` with `ftsKey: true`. The `default_fts_keys` includes `log` and `message`. So the auto-pick on e2e_automate will typically resolve to `log` (it's both stream-ftsKey'd and high fill-rate in the log data).
3. **e2e_automate is shared state** — other parallel tests also use it. To test a "no prior selection, auto-pick fires" scenario, the test must either use a unique per-test stream OR explicitly reset the column selection before asserting.
4. **The `source` column** (raw JSON dump) renders when NO FTS candidate is found and `selectedFields` is `[]`. This is the pre-feature behavior and serves as the fallback when `resolveDefaultColumns` returns `[]`.
5. **Stream schema cache** — the `selectedStreamFields` array persists across navigations for the same stream. If a test ingests custom data into a new stream, the schema arrives fresh. If reusing a shared stream, the schema may already be cached. Use `waitForStreamData` to ensure ingested data is indexed before navigating.
