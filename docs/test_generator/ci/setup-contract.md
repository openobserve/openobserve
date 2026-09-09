# Test Setup Contract: Traces Streaming Pagination  (area: Traces)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `<default>` stream **[shared/read-only, but MUST be topped up in `beforeAll`]** — the OTLP
  ingestion endpoint auto-creates a `default` trace stream. Fields include the standard OTEL trace
  fields: `trace_id`, `span_id`, `start_time`, `end_time`, `service_name`, `operation_name`,
  `duration`, `span_status`, `http_status_code`, plus `_timestamp`. Why: pagination counts distinct
  `trace_id`s via `approx_distinct(trace_id)`; every pagination behavior (page swap, empty-page
  clear, stale-request ignore) just READS this stream.
- **Total distinct traces in the query window must be `> 25`** (default `rowsPerPage`) so the
  pagination renders a page `2`. The global setup ingests only **20** traces
  (`tests/ui-testing/playwright-tests/utils/global-setup.js:124`), which is **below** the 25-row
  threshold — so the spec must ingest its own batch in `beforeAll`.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- Ingest traces: `const { ingestTraces } = require('../utils/trace-ingestion.js'); await ingestTraces(page, 60);`
  — see `tests/ui-testing/playwright-tests/utils/global-setup.js:124` and the helper itself
  (`tests/ui-testing/playwright-tests/utils/trace-ingestion.js:255`). Each call generates unique
  `trace_id`s with `Date.now()`-based timestamps (within the last minute), so freshly ingested
  traces fall inside the default `15m` relative window. 60 traces ⇒ 60 distinct `trace_id`s ⇒
  `ceil(60/25)=3` pages (plus any already-present traces ⇒ more pages — assert behaviorally, not on
  an exact total).
- Ingestion endpoint: `POST {baseUrl}/api/{org}/v1/traces` (Basic auth) — already handled by
  `ingestTraces`, which reads `getOrgIdentifier()`/`getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (self-hosted: `ORGNAME` + `ZO_ROOT_USER_EMAIL`/`PASSWORD`).
- Auth/org: `<orgId = process.env.ORGNAME || "default">`. Login via
  `pageManager.loginPage.gotoLoginPage(); loginPage.loginAsInternalUser(); loginPage.login();`
  (see `tests/ui-testing/playwright-tests/Logs/pagination.spec.js:30-33`).
- Navigate + select stream: `pm.tracesPage.navigateToTraces(); pm.tracesPage.selectTraceStream('default');`
  (see `tests/ui-testing/playwright-tests/Traces/tracesSearch.spec.js:26-31`). Run query:
  `pm.tracesPage.runTraceSearch()` (clicks `logs-search-bar-refresh-btn` and waits for a terminal
  state — `tests/ui-testing/pages/tracesPages/tracesPage.js:339-352`).

## Preconditions / toggles
- **Search mode = Traces** (not Spans/Service Graph/Services Catalog). Default is Traces; do not
  toggle `traces-search-mode-spans-btn`.
- **Non-SQL mode.** Traces does not use SQL mode; the query editor holds a WHERE clause.
- **Live/auto-run off** (or leave default). `getMoreData` only re-queries when
  `meta.refreshInterval === 0` (default), so pagination clicks always fire a fresh page query.
- **Time range `15m`** — default; `pm.tracesPage.setTimeRange('15m')` if needed.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **The `default` stream accumulates traces across runs** (global setup + prior specs + this spec).
  Do NOT assert an exact total count / exact "N Traces Found" number. Assert: (a) pagination
  controls become visible, (b) clicking page 2 swaps the row set (page-1 rows disappear), (c) a
  `total > rowsPerPage` count badge is present.
- **`showPagination` is async** — it flips to `true` only after the *count* query resolves
  (`fetchTracesCount` runs in the main query's `complete` callback). Wait for
  `[data-test="traces-search-result-pagination"]` (or the records-per-page select) to become visible
  before clicking pages; a bare `waitForTimeout` may race.
- **Row selectors** — rows are `[data-test^="o2-table-row-"]` inside
  `[data-test="traces-search-result-list"]`; exclude the drag-handle row. There is no
  bottom-of-table pagination — it lives only in the section header.
- **Empty-opening-batch behavior** is the point of the fix: after clicking page 2, the first
  streamed event may be an empty metadata/hits chunk; the grid must still swap to page-2 rows. Do not
  treat a transient empty batch as "no results."
- **Pagination buttons forward data-test** as `<parent>-page-N` / `-prev` / `-next` (see
  `OPagination.vue:76/98/117`); the rows-per-page options use `<parent>-option` + `data-test-value`
  (see `OSelectItem.vue:47-49`). These selectors are NOT yet declared in `tracesPage.js` — the
  Engineer should add them (or use raw selectors) mirroring `logsPage.js` (`recordsPerPageDropdown`,
  `recordsPerPageOption`, `resultPaginationPageBtn` at `logsPages/logsPage.js:204-207`).
