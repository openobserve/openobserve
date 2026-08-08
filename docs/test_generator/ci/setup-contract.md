# Test Setup Contract: Trace-to-Logs Navigation with Configurable ID Fields (area: Traces)

## Streams / data the spec must establish

### [shared/read-only] Pre-existing trace data (from global setup)
- **`default`** — OTLP traces stream with the standard fields: `span_id`, `trace_id`, `service_name`, `operation_name`, `duration`, `start_time`, `end_time`, `span_status`, `http_status_code`, etc.
- Why: Every test reads trace results from this stream; the global setup (`global-setup.js:124`) ingests 20 traces. The spec should **not** re-ingest — it reuses what's already there.
- Ingested fields include: `spanId`, `span_id`, `traceId`, `trace_id` — both camelCase (OTLP) and snake_case variants.

### [per-test: custom-field test] Log stream for verification
- **`e2e_log_nav_test`** (or similar) — a **logs** stream with matching `span_id` / `trace_id` fields. This stream needs at least one record with `span_id` and `trace_id` values that match a known ingested trace, so the navigation lands on results rather than an empty page.
- Why: Only the "custom ID fields" test needs a logs stream to verify the query contains the correct field names. All other tests only navigate and check the URL — they don't need actual log results.
- Scope: **[per-test]** — created inside the test, needs unique name (e.g., with a timestamp suffix) to avoid conflicts.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Trace data: already exists (global setup)
- Traces are ingested in `tests/ui-testing/playwright-tests/utils/global-setup.js:124`:
  ```js
  await ingestTraces(page, 20); // Ingest 20 test traces
  ```
- `ingestTraces` is defined at `tests/ui-testing/playwright-tests/utils/trace-ingestion.js:255`.
- Traces are ingested to `POST /api/{org}/v1/traces` (the `default` stream).
- **The spec does NOT call `ingestTraces` itself** — the global setup already provides 20 traces.

### Log stream (for custom-field verification test only):
- Ingestion endpoint: `POST /api/{org}/{streamName}/_json`
- Pattern from `global-setup.js:164`:
  ```js
  await page.request.post(`${baseUrl}/api/${orgId}/${streamName}/_json`, {
    headers: { Authorization: `Basic ${basicAuthCredentials}`, "Content-Type": "application/json" },
    data: [{ span_id: "abc123", trace_id: "def456", message: "test log" }]
  });
  ```
- Auth: Basic auth via `process.env.ZO_ROOT_USER_EMAIL` / `ZO_ROOT_USER_PASSWORD`, OR reuse the authenticated page from the test fixture.
- The ingest is fire-and-forget (no need to wait for indexing beyond a short `page.waitForTimeout(2000)`).

### Auth / org:
- `ORGNAME` = `default` (set by `getOrgIdentifier()` in `tests/ui-testing/playwright-tests/utils/cloud-auth.js`).
- Test uses the `enhanced-baseFixtures` pattern (already used by `traceDetails.spec.js`):
  ```js
  const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
  const PageManager = require('../../pages/page-manager.js');
  ```

### Navigation to trace details:
- Existing pattern from `traceDetails.spec.js:21-27`:
  ```js
  await pm.tracesPage.navigateToTracesUrl();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await pm.tracesPage.isStreamSelectVisible();
  await pm.tracesPage.selectTraceStream('default');
  await page.waitForTimeout(2000);
  await pm.tracesPage.setTimeRange('15m');
  await pm.tracesPage.runTraceSearch();
  await page.waitForTimeout(3000);
  ```
- To open trace details, use the helper pattern from `openTraceDetailsIfAvailable` (`traceDetails.spec.js:47-92`).
- To open the sidebar for a specific span, use `pm.tracesPage.clickFirstTraceResult()` then click a span in the trace tree.

### URL verification after navigation:
- Pattern from `traceDetails.spec.js:185-186`:
  ```js
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await pm.tracesPage.expectUrlContains(/logs/);
  ```

### Log stream selection in TraceDetails:
- Pattern from `traceDetails.spec.js:164-178`:
  ```js
  const selectionSuccess = await pm.tracesPage.selectFirstLogStreamInTraceDetails();
  // ... then
  const buttonEnabledAfterSelection = await pm.tracesPage.isViewLogsButtonEnabled();
  expect(buttonEnabledAfterSelection).toBeTruthy();
  await pm.tracesPage.viewRelatedLogs();
  ```

## Preconditions / toggles

- **Non-enterprise mode**: All OSS tests assume `config.isEnterprise !== "true"`. No enterprise setup needed.
- **Time range**: 15 minutes (last 15m) for traces to show — use `pm.tracesPage.setTimeRange('15m')`.
- **Stream**: `default` for traces; `e2e_log_nav_test` (or similar) for the optional log stream.
- **Org settings**: Default `span_id_field_name` = `"span_id"`, `trace_id_field_name` = `"trace_id"`. The custom-field test should update these via the org settings API before running.
- **Log stream selector**: Always shown in standalone mode (`showLogStreamSelector=true`).
- **Sidebar View Logs button**: Only visible when `parentMode === 'standalone'` (default in TraceDetails).

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Trace tree per-span button is CSS-hidden**: The `[data-test="trace-tree-span-view-logs-btn-{spanId}"]` button lives inside a `div` with class `view-logs-container` that has `visibility: hidden` / `invisible` by default and becomes visible on `.span-row:hover`. In Playwright, you must **hover the span row first** (use `[data-test="trace-tree-span-operation-name-container-{spanId}"]`) before the button is interactable. Use `page.locator(...).hover()` then wait for the button to become visible.

2. **Dynamic data-test with spanId**: The per-span button uses `data-test="trace-tree-span-view-logs-btn-{spanId}"` where `spanId` is the runtime span ID. You cannot hardcode this — use a partial match like `[data-test^="trace-tree-span-view-logs-btn-"]` to find the first available button, or extract the spanId from the first span row's data-test attribute.

3. **Stream selection must happen before clicking View Logs**: In OSS mode with `showLogStreamSelector=true`, the button is **disabled** until at least one log stream is selected. If the existing global setup created a `default` logs stream, it should appear in the selector. If not, the test must first create and select a logs stream.

4. **URL query is base64-encoded**: The `query` param in the `/logs` URL is base64-encoded. To verify the query content, you need to decode it. Use: `atob(decodeURIComponent(queryParam))` or equivalent.

5. **Timing**: After trace ingestion (global setup), traces may not be immediately searchable. The existing test uses `page.waitForTimeout(2000)` after selecting the stream and `page.waitForTimeout(3000)` after running the search. Respect these timeouts.

6. **Org settings API**: To test configurable ID fields, the test needs to update `span_id_field_name` / `trace_id_field_name` org settings. The API endpoint is `PUT /api/{org}/organization/settings`. After the test, restore default values to avoid affecting other tests.

7. **TraceDetails redirectToLogs only uses trace_id, NOT span_id**: Unlike `buildQueryDetails()` (used by TraceTree/Sidebar), the main TraceDetails `redirectToLogs()` function at `TraceDetails.vue:2682-2683` builds a query using ONLY `trace_id_field_name`. It does NOT include `span_id_field_name`. This is intentional — the TraceDetails button navigates for the whole trace, not a specific span.
