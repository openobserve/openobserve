# Test Setup Contract: Logs Search Bar Stream Not Found Error  (area: Logs)

Feature slug: `logs-stream-not-found` · Spec: `tests/ui-testing/playwright-tests/Logs/streamNotFound.spec.js` · Group: `Logs-Core`

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE (shared pre-seeded stream).
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate`** **[shared/read-only]** — a logs stream that already exists in the org.
  - Why: it makes `searchObj.data.stream.streamLists.length > 0` true (so the "no streams in
    org" branch does not fire) AND `streamResults.list` non-empty (so `updateQueryValue`'s
    `streamFound` loop has something to compare against). Also serves as the *existing-stream*
    control for the negative test (Workflow 2: `SELECT * FROM "e2e_automate"` selects it).
  - Do **NOT** create a stream named `e2e_automate` per-test; it is a shared baseline ingested
    by `ingestTestData(page)` in most Logs specs.

- **No new stream is required for the primary case.** The "missing" stream is produced purely
  by typing a *non-existent* name into the editor (e.g. `stream_does_not_exist_xyz`); it must
  NOT be ingested or created anywhere. Use a unique name so it cannot collide with any shared
  stream (append a run id/random suffix for isolation).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest the shared stream (once, beforeAll/global):**
  `const { ingestTestData } = require('../utils/data-ingestion.js');` then `await ingestTestData(page);`
  (defaults to `e2e_automate`).
  Reference: `tests/ui-testing/playwright-tests/Logs/logsqueries.spec.js:36` and
  `tests/ui-testing/playwright-tests/utils/data-ingestion.js:11-31`.

- **Wait for the shared stream to be listed (the picker/`streamResults.list` source):**
  `const { waitForStreamListed } = require('../utils/data-ingestion.js');`
  `await waitForStreamListed(page, 'e2e_automate', 'logs');`
  Reference: `tests/ui-testing/playwright-tests/utils/data-ingestion.js:302-334`.
  This is the correct readiness gate — `streamResults.list` (what the streamFound loop reads)
  is built from the `/streams` list, not from search. Do not use a bare `waitForTimeout`.

- **Auth/org:** `ORGNAME` from env; navigate via
  `await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${process.env["ORGNAME"]}`, { waitUntil: 'domcontentloaded' });`
  Auth headers via `getAuthHeaders()` / org via `getOrgIdentifier()` in
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (ingestion) and the
  `navigateToBase(page)` fixture (`tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`).

- **Type the SQL query (Monaco editor):**
  `await page.locator('[data-test="logs-search-bar-query-editor"] .inputarea').fill('SELECT * FROM "stream_does_not_exist_xyz"');`
  Reference: `tests/ui-testing/pages/logsPages/logsQueryPage.js:35-39` (`typeQuery`) and
  `tests/ui-testing/pages/logsPages/logsPage.js:1388-1391`.

- **Assert the error:**
  - `await expect(page.locator('[data-test="logs-search-filter-error-message"]')).toBeVisible();`
  - Message text: `await expect(page.locator('[data-test="error-detail-summary"]')).toContainText('Stream "stream_does_not_exist_xyz" does not exist');`

## Preconditions / toggles

- **Disable auto-run** if `auto_query_enabled` is on, so a prior query is not in flight when
  typing (the error branch is gated on `searchObj.loading == false`):
  `await pm.logsQueryPage.disableAutoRun();`
  Reference: `tests/ui-testing/pages/logsPages/logsQueryPage.js:234-236` (`_isAutoQueryEnabled`
  reads `/api/{org}/config`; skip is safe when `auto_query_enabled=false`).
- **No explicit SQL-mode toggle needed** — SQL mode auto-detects from `SELECT`+`FROM`
  (`SearchBar.vue:2945-2953`). The legacy `logs-search-bar-sql-mode-toggle-btn` selector does
  not exist in the current component (see design doc).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`streamResults.list` vs search:** a freshly-ingested stream is searchable before it is
  *listed*. The streamFound loop reads `streamResults.list` (built from `/streams`), so wait on
  `waitForStreamListed`, not `waitForStreamData`.
- **Branch ordering:** with a missing stream, `selectedStream` is cleared AND `filterErrMsg` is
  set. The "no stream selected" branch requires `filterErrMsg === ''`, so the filter-error
  branch wins. The *regression assertion* is that `logs-search-no-stream-selected-text` is
  NOT visible while `logs-search-filter-error-message` IS.
- **Do NOT conflate `filterErrMsg` with `errorMsg`:** `logs-search-filter-error-message` (this
  feature) is the pre-run client-side detection; `logs-search-error-state` is the post-run
  backend error (code 20002 path). Assert the former, not the latter.
- **Enterprise "Ask AI" absent in OSS:** `query-error-ask-ai-btn` will not render
  (`isAiEnabled` requires enterprise). Do not assert on it.
- **Code 0 renders no action cards:** `errorCode=0` is "informational" — the visible elements
  are `error-detail-summary` + `query-error-copy-btn`. `query-error-fix-query-card` only
  renders for codes 20001/20004/20005/20007/20008.
- **Loading gating:** after typing, if a search was in flight the error is deferred until
  `loading == false`. Since detection clears `selectedStream`, a follow-on auto-run
  early-returns, so loading settles quickly — but still prefer `disableAutoRun()`.
- **WITH/CTE and filter-mode queries are NOT detected** — only a plain `SELECT ... FROM
  "<table>"` (no `WITH`) triggers the message. Use a plain SELECT in the test.
