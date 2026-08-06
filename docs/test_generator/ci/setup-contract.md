# Test Setup Contract: Traces Correlated Logs Navigation (area: Traces)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`default` (traces stream)** **[shared/read-only]** — fields: `trace_id`, `span_id`, `service_name`, `operation_name`, `span_status`, `duration`, `start_time`, `end_time`, `_timestamp`. Why: Trace details page + sidebar navigation both need span data to render, and the "View Logs" button requires trace results to exist to click into. This stream is ALREADY seeded by `global-setup.js` via `ingestTraces(page, 20)`.

- **Log streams for OSS "View Logs" navigation** **[shared/read-only]** — The Logs page needs at least one log stream to exist so log stream selector can populate and the navigation doesn't hit an empty page. The global setup already creates `e2e_automate` (logs stream) — no additional streams needed.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Trace data**: Already seeded in `global-setup.js:122-124` via `ingestTraces(page, 20)`.
  - Trace ingestion helper: `tests/ui-testing/playwright-tests/utils/trace-ingestion.js`
  - Call: `await ingestTraces(page, 20)` — ingests 20 distributed traces to the `default` stream with randomized service names (`api-gateway`, `order-service`, `payment-service`, `user-service`, `profile-service`, `auth-service`) and operation names (`get_orders`, `process_payment`, `database_query`, `get_user_profile`, `authenticate_user`).
  - If tests need specific trace data (e.g., guaranteed error spans), use the `forceScenario` option: `await ingestTraces(page, 1, { forceScenario: 'error' })`.

- **Auth / org**: The global setup (`global-setup.js`) handles login and stores auth state in `tests/ui-testing/playwright-tests/utils/auth/user.json`. All tests use `{ storageState: authFile }` via `enhanced-baseFixtures.js`. ORGNAME=default.

- **Navigation to Trace Details** (from existing tests):
  - Pattern from `tests/ui-testing/playwright-tests/Traces/traceDetails.spec.js:21-35`:
    ```
    await pm.tracesPage.navigateToTracesUrl();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(3000);
    ```
  - Then to open trace details: `await pm.tracesPage.clickFirstTraceResult();`

- **Timing**: After selecting a trace stream and running a search, wait `3s` for results to load. After clicking a trace result, wait `2-3s` for the trace details tree to render (see the retry loop in `traceDetails.spec.js:64-83`).

## Preconditions / toggles

- **OSS mode** (no enterprise): `config.isEnterprise !== "true"` is the default when running OSS. The correlated-logs/correlated-metrics tabs are gated behind `serviceStreamsEnabled && config.isEnterprise === 'true'` and will NOT appear in OSS. Tests should NOT attempt to click them.

- **Log stream selector**: Must have at least one log stream (`e2e_automate`) for the selector to populate. The selector appears in the trace details header `[data-test="trace-details-log-streams-select"]`.

- **Span sidebar "View Logs" button**: Only visible when `parentMode === 'standalone'` (line 169 of TraceDetailsSidebar.vue). TraceDetails.vue passes `:parent-mode="mode"` where mode is `"standalone"` in routed view. In the sidebar mode (opened from trace details tree), this is always `"standalone"` because TraceDetails opens in standalone mode. The sidebar's View Logs button appears at `[data-test="trace-details-sidebar-header-toolbar-view-logs-btn"]`.

- **View Logs button enabled state**: In OSS mode, the button is disabled when no log streams are selected (`props.showLogStreamSelector && props.selectedLogStreams.length === 0`). Tests must first select a log stream if needed.

## Gotchas (so the Healer/Engineer don't rediscover them)

- The trace details tree may take multiple attempts to render after clicking a trace result. The existing `traceDetails.spec.js` uses a 3-attempt retry loop with 2s waits. Copy this pattern.

- The "View Logs" button on the trace details page navigates to `/logs` with a trace_id-based SQL filter. The landing page needs existing log data to avoid an empty state (the `e2e_automate` logs stream seeded by global setup covers this).

- The TraceDetailsSidebar "View Logs" button is gated behind `v-if="parentMode === 'standalone'"`. When TraceDetails is used in embedded mode (e.g., from a correlation dialog), this button is hidden — only the standalone trace details view shows it. The E2E tests navigate via the routed view, so `parentMode` is `'standalone'`.

- Service graph node side panel: The `service-graph-node-panel-view-related-logs-btn` only works when the service graph has loaded AND a node is clicked. The service graph daemon needs time to process trace data — the existing `service-graph.spec.js` handles this with explicit waits.
