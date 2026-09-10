# Test Setup Contract: Logs Index Stream Change Resets Pagination  (area: Logs)

## Streams / data the spec must establish

The field-list pagination (and therefore the reset) is only observable when the
field list has **more than one page** — i.e. the stream schema must have **> 25
fields** (`pageSize = 25` in `IndexList.vue:440`; pagination only renders when
`pagesNumber > 1` in `FieldListPagination.vue:125`). A stream with ≤ 25 fields
shows no pagination controls, so the reset is unobservable — do **not** use a
low-cardinality stream for the headline case.

- `e2e_pag_reset_a_<token>` **[per-test]** — fields: the full `70_fields.json`
  schema (**111 distinct fields** → 5 pages). Why: this is the stream the test
  first selects and paginates to page 2.
- `e2e_pag_reset_b_<token>` **[per-test]** — fields: also `70_fields.json`
  (111 fields → 5 pages). Why: switching to it keeps pagination visible so the
  test can assert page 1 became `primary` again (if B had ≤ 25 fields, pagination
  would vanish, making the "reset to page 1" assertion implicit and weaker).

> Token (`<token>`) = `Date.now()` + random, mirroring the existing
> `generateRandomStreamName()` in `pagination.spec.js:7-14` and the
> `e2e_qp_more_stream_<token>_` prefix in `logsQuickPick.spec.js:148-149`, so
> parallel/repeat runs never collide with a still-deleting stream (deletion is
> async in OpenObserve). Names carry the `e2e_pag_reset_` prefix so
> `cleanup.spec.js` can sweep them.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest 111-field data into a named stream.** The exact existing pattern is
  `SanityPage.ingest70FieldsData()` at
  `tests/ui-testing/pages/generalPages/sanityPage.js:746-791` (reads
  `tests/test-data/70_fields.json`, POSTs to
  `${INGESTION_URL}/api/${orgId}/${streamName}/_json` with `getAuthHeaders()` +
  `Content-Type: application/json`). It hardcodes `streamName = "e2e_automate"`;
  the Engineer should parametrize the stream name to
  `e2e_pag_reset_a_<token>` / `e2e_pag_reset_b_<token>`.
  - Alternative for a named stream with a JSON array payload: `pm.logsPage.ingestData(streamName, data)`
    at `tests/ui-testing/pages/logsPages/logsPage.js:6777-6836` (sends records
    one-by-one with retry). `seedLogStreams` (`logsPage.js:11947-11960`) is the
    closest "ingest a record into a named stream" reference but only seeds
    3-field records — not enough fields for pagination.
  - `pm.ingestionPage.ingestionMultiOrgStream(orgId, streamName)` at
    `tests/ui-testing/pages/generalPages/ingestionPage.js:140-164` ingests
    `logs_data.json` (**40 fields** → 2 pages) — usable as a lighter alternative
    (still > 25 fields) if the 111-field fixture is undesirable.
- **Wait for the stream to be indexed/listed before selection:**
  `pm.logsPage.waitForStreamAvailable(streamName, 120000, 1000)` at
  `tests/ui-testing/pages/logsPages/logsPage.js:896-941` (API poll), or
  `pm.logsPage.waitForStreamsListed([...])` at `logsPage.js:11969-11990`.
  See usage in `pagination.spec.js:38`.
- **Select a stream via the OSelect popover (NOT the legacy `selectIndexStream`):**
  `pm.logsPage.selectStream(streamName)` at `logsPage.js:943-1076` uses the
  `-trigger` + `-popover` + `-option[data-test-value=...]` contract.
  ⚠️ `selectIndexStream` (`logsPage.js:871-887`) references the retired
  `log-search-index-list-stream-toggle-default` selector and will fall back to
  `selectIndexStreamOld` — prefer `selectStream`.
- **Auth / org / navigation:** use the newer enhanced-fixtures pattern from
  `logsQuickPick.spec.js:28-38`:
  `const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js')`,
  then `await navigateToBase(page); pm = new PageManager(page); await page.goto(\`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}\`)`.
  (`logData` = `tests/ui-testing/fixtures/log.json`, `logsUrl = "/web/logs"`.)
  Org defaults to `default` (`getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`).
- **Timing / hydration:** the schema arrives async after selection. Before
  asserting anything about the field list, wait for field rows or the empty
  marker using `pm.logsPage.waitForFieldListAfterStreamSelection()` at
  `logsPage.js:12160-12182` (waits for `[data-test^="logs-field-list-item-"]`
  OR `[data-test="logs-search-no-field-found-text"]`).

## Preconditions / toggles

- Non-SQL mode is sufficient; the field list renders regardless of SQL mode.
  No histogram / query toggle is needed — the reset under test is in the field
  list footer, not the results grid.
- Each test must **select** the target stream and then **change** to the other
  stream. Assert page state via the page-1 button's `data-o2-variant`:
  - active page → `data-o2-variant="primary"`
  - inactive page → `data-o2-variant="ghost"`
  (`OButton.vue:358`). The page-2 button
  `[data-test="logs-page-fields-list-pagination-page-2-button"]` is the clearest
  "before" signal; `...-page-1-button` is the "after" signal.
- Cleanup: name streams with the `e2e_pag_reset_` prefix so the existing
  `cleanup.spec.js` stream sweep removes them (same convention as
  `e2e_qp_more_stream_`).

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Pagination only exists with > 25 fields.** If the test ingests a small
   fixture, `logs-page-fields-list-pagination-*` never renders and the whole
   test times out. Always use `70_fields.json` (or at minimum a > 25-field
   fixture).
2. **Schema hydrates async.** Assert only after `waitForFieldListAfterStreamSelection()`
   resolves; querying the pagination buttons immediately after stream selection
   races the async `onStreamChange` fetch.
3. **Use `selectStream`, not `selectIndexStream`.** The latter's first attempt
   targets `[data-test="log-search-index-list-stream-toggle-default"]`, which no
   longer exists post-OSelect-migration, so it always falls into the legacy
   path.
4. **Active-page detection is via `data-o2-variant`.** There is no dedicated
   `aria-current`/`active` data-test on the page buttons; the `primary` vs
   `ghost` variant attribute is the reliable signal.
5. **`prepareScrollReset` is a no-op.** `IndexList.vue:637` calls it defensively,
   but neither `GroupedFieldList` nor `OFieldList` exposes it — the scroll reset
   is done by `scrollToTop()`. Do not assert on `prepareScrollReset` behavior.
6. **`onPaginationUpdate` is dead code** (`IndexList.vue:1789-1802`, never bound
   in the template). Do not rely on its "ignore auto-reset while loading" guard.
