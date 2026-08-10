# Test Setup Contract: View Trace from Log Rows — Null Guard  (area: Logs)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:

### `[per-test]` custom stream with trace_id data
- **`e2e_view_trace`** — fields: `_timestamp`, `trace_id` (string), `span_id` (string), `message` (string), `level` (string, e.g. "error"), plus any other standard log fields. **Why**: View Trace button in JsonPreview only appears when the log record contains the configured `trace_id_field_name` (default: `trace_id`) with a truthy value. The standard `e2e_automate` / `logs_data.json` test data does NOT include `trace_id` or `span_id` fields, so this feature needs its own stream with logs that do.
- Data shape (JS array of 3+ records):
  ```js
  [
    {
      _timestamp: Date.now() * 1000, // microseconds
      trace_id: "vt-a1b2c3d4e5f67890",
      span_id: "vt-1234567890abcdef",
      message: "GET /api/v1/users 200",
      level: "info"
    },
    // ... 2 more records with unique trace_ids, same field shape
  ]
  ```
- **Why per-test**: ingestion is fast (~3 records), and the test owns the stream name to avoid collisions.

### `[shared/read-only]` traces stream
- **The test does NOT create this** — it must already exist in the deployment so `redirectToTraces` has a trace stream to target. The `getTracesStreams()` call in JsonPreview fetches all streams of type `traces`. If none exist, the stream picker stays in loading state and the View Trace button never renders.
- The E2E deployment already has a `default` traces stream populated by other tests (or at least the stream exists). If the deployment has NO traces streams, the test cannot proceed.
- **Mitigation**: The test should `await pm.ingestionPage.ingestion()` initially to ensure the standard `e2e_automate` and `default` streams exist, then create the custom `e2e_view_trace` logs stream.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest custom data**: Use `ingestCustomData(page, streamName, data)` from `tests/ui-testing/playwright-tests/utils/data-ingestion.js:88`. Example pattern from `logsqueries.spec.js:35-36`: 
  ```js
  const { ingestTestData, ingestCustomData, waitForStreamData } = require('../utils/data-ingestion.js');
  // ...
  await ingestCustomData(page, 'e2e_view_trace', customLogData);
  await waitForStreamData(page, 'e2e_view_trace', 3, 30000);
  ```
- **Auth/org**: Use `ORGNAME` env (default org) with credentials from `getAuthHeaders()`.
- **Timing**: After ingest, call `waitForStreamData(page, 'e2e_view_trace', 3, 30000)` to poll the search API until records are queryable. Then `page.waitForTimeout(2000)` for schema hydration.

## Preconditions / toggles

- **`service_streams_enabled`**: In OSS, the backend default is `false` (`enterprise_value!(false, ...)` in Rust), so the View Trace button path (gated by `!serviceStreamsEnabled`) is OPEN. If this deployment sets it to `true`, the button will NOT appear — the test should detect this and skip or fall back to verifying the CORRELATED path instead.
- **`hiddenMenus`**: Must NOT include `"traces"` (default). If the traces menu is hidden via `/config`, the View Trace button won't appear.
- **Navigation**: Navigate to the logs page for the custom stream:
  ```js
  await pm.logsPage.navigateToLogs('default');                       // logs page, default org
  await pm.logsPage.selectStream('e2e_view_trace');                  // pick the custom stream
  await pm.logsPage.applyQueryButton();                               // run the default `*` search
  await pm.logsPage.waitForResultsLoaded();                           // wait for table
  ```
  Reference: `logsPage.js:521` (navigateToLogs), `logsPage.js:896` (selectStream), `logsPage.js:1253` (applyQueryButton).

- **Log row expansion**: Click the expand button on the first data row: `[data-test="o2-table-expand-0"]`. Reference: `logsPageEP.js:172-174` and `unflattened.js:27`.
- **View Trace button**: After expansion, look for `[data-test="trace-view-logs-btn"]` inside the expanded row area. The stream picker is `[data-test="log-search-index-list-select-stream"]` (an OSelect bound to `searchObj.meta.selectedTraceStream`).
- **Trace stream selection**: If the stream picker value is empty, `getTracesStreams()` auto-selects the first traces stream. The test can also explicitly select a traces stream via the OSelect.
- **Click View Trace**: Click `[data-test="trace-view-logs-btn"]` and verify `page.url()` includes `name=traceDetails` and `trace_id=<expected>`.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Schema hydration lag**: After ingestion, the stream schema (field list) arrives async. The View Trace button's visibility depends on `props.value[trace_id_field_name]` being present. If you open the log row before the schema hydrates with the `trace_id` field, the resolver may return an empty schema and the button won't show. Wait for at least one data row to be visible before expanding.
- **service_streams_enabled default**: In OSS, this is `false` → View Trace button shows. But if the CI deployment accidentally enables it, the button will be hidden and the test will fail. Catch this early: after expanding a row, check `await page.locator('[data-test="trace-view-logs-btn"]').isVisible()`.
- **Traces stream must exist**: `getTracesStreams()` calls the `GET /api/{org}/streams?type=traces` endpoint. If no traces streams exist, the picker stays in loading state and the button block (`v-if="showViewTraceBtn && (tracesStreams.length || isTracesStreamsLoading)"`) never renders the button. Ensure at least one traces stream exists (standard `default` traces stream should; if not, create one first).
- **No existing reference pattern for "view trace" E2E**: There is NO existing E2E test that exercises the view-trace flow. The closest patterns are: expanding log rows (logsPageEP.js, unflattened.js, jobScheduler.js) and navigating via `router.push` (which changes `page.url()`). The Engineer will need to compose a new test from these building blocks.
- **Unflattened view**: JsonPreview has two tabs (Flattened / Unflattened). On mount, `activeTab` is `"flattened"`. The View Trace button is in the toolbar above the tabs, so it's always visible regardless of tab — no tab-switch needed.
- **hideFieldOptions / hideSearchTermActions**: In the expanded row context, these props default to `false`, so the View Trace button block renders. In the DetailTable drawer (ODrawer), the same holds.
