# Test Setup Contract: Traces Trace Details  (area: Traces)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:

- **`default` (traces stream)** **[shared/read-only]** — seeded ONCE by global setup with **20 traces** via OTLP.
  Fields per span (from `generateTrace`, `trace-ingestion.js`): `trace_id`, `span_id`, `reference_parent_span_id`,
  `operation_name` (`HTTP POST /<op>`, `HTTP POST <svc>/<op>`, `POST /<op>`), `service_name` (`api-gateway`,
  `<backend-service>`), `start_time`/`end_time` (ns), `duration` (ns), `http_status_code`, `span_status`
  (1=OK / 2=ERROR from OTLP `status.code`), `http.method`, `http.url`, `user.id`, `request.id`, `peer.service`.
  Scenarios include **error traces** (`database_error`, `not_found`, `auth_error` → spanStatus 2) so the
  error-span badge path is exercised. Why: every trace-details test just READS this stream (open trace → inspect tree/sidebar/search/copy/share).
- **`e2e_automate` (logs stream)** **[shared/read-only]** — seeded ONCE by global setup via `_json` (logs).
  Why: the OSS "View Logs" button needs ≥1 log stream to select (auto-selected when it is the only log stream).

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Trace ingest:** `const { ingestTraces } = require('../utils/trace-ingestion.js'); await ingestTraces(page, 20);`
  → POSTs to `${ZO_BASE_URL}/api/${org}/v1/traces` (OTLP). Already invoked by `global-setup.js:124`
  (`await ingestTraces(page, 20)`), so the suite does **not** need a `beforeAll` for the happy path.
  - For a **deterministic error trace** (if a test needs a guaranteed error span), call
    `ingestTraces(page, 1, { forceScenario: 'error' })` — see `trace-ingestion.js:38-113` and its use in
    `tests/ui-testing/playwright-tests/Traces/tracesAnalyzeDimensions.spec.js:8,35`.
- **Logs ingest (View Logs):** `ingestionPage.ingestion()` (`tests/ui-testing/pages/generalPages/ingestionPage.js:52`)
  posts `logs_data.json` to `/api/{org}/e2e_automate/_json`; already run in `global-setup.js:164` (`performGlobalIngestion`).
- **Auth/org:** `ORGNAME=default`; global setup logs in and saves `auth/user.json` storageState
  (`global-setup.js:22-104`). Tests use `navigateToBase(page)` from `enhanced-baseFixtures.js` (see `traceDetails.spec.js:17`).
- **Timing:** after `ingestTraces` the traces are indexed async. Existing specs wait for results by running a
  search and polling `hasTraceResults()` (`tracesPage.js:841`) rather than a fixed sleep. Before opening a trace,
  run the traces search (select `default` stream → set time range `15m` → run query) and require `hasTraceResults()===true`.

## Preconditions / toggles
- Navigate: `pm.tracesPage.navigateToTracesUrl()` → `selectTraceStream('default')` → `setTimeRange('15m')` →
  `runTraceSearch()` (mirror `traceDetails.spec.js:21-34`). Then `clickFirstTraceResult()` (or click
  `trace-row-operation-name`) to route to `traceDetails`.
- OSS build: `config.isEnterprise === "false"`, `config.isCloud === "false"` → the log-stream selector IS shown
  and the annotate/dataset/evaluate buttons are HIDDEN. Do NOT assert enterprise-only buttons.
- Non-SQL mode is irrelevant here; the details fetch is a GET, not a search query.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Span tree renders async** after `get_trace_details`; assert only after `trace-details-tree` is visible
  (or any of `trace-details-header/tree/sidebar`). The existing `openTraceDetailsIfAvailable` retry loop
  (`traceDetails.spec.js:47-92`) is the established wait pattern.
- **`trace-details-view-logs-btn` is disabled until a log stream is selected.** With exactly one log stream
  (`e2e_automate`), `loadLogStreams` auto-selects it; if `_json` ingestion produced multiple streams the button
  stays disabled until a stream is picked via `trace-details-log-streams-select`.
- **Error-span badge needs an error span.** Random seed draws scenarios; if a test asserts
  `trace-details-error-spans-count`, ingest `forceScenario: 'error'` first and open that specific trace, or
  assert the badge is present without asserting an exact count.
- **LLM tabs (dag/thread) and RUM session replay are absent** for this seed (no `gen_ai_*` / `rum_session_id`).
  Do not write green tests asserting them; park as `test.fixme`.
- **Enterprise buttons (annotate/dataset/evaluate) are absent in OSS.** Same parking rule.
- **Stale selectors:** `trace-details-timeline-chart` and `trace-details-toggle-timeline-btn` in
  `tracesPage.js` no longer exist in the component — the old "toggle timeline" test step is dead; rewrite it.
- **Search input** lives only on the waterfall tab (hidden on flame-graph/map/thread): use
  `trace-details-search-input-field` (inner native input) and fill + Enter, then read `trace-details-search-results`.
