# Test Setup Contract: Traces RED Metrics Charts  (area: Traces)

## Streams / data the spec must establish

- **`default` (traces stream)** **[shared/read-only]** — fields produced by OTLP ingestion:
  `duration`, `trace_id`, `span_id`, `span_status`, `span_kind`, `service_name`, `operation_name`,
  `http_method`, `http_status_code`, `http_url`, `http_target`, `environment`, `_timestamp`.
  Why: every chart behavior reads it — RED panels (Rate `approx_distinct(trace_id)`, Errors
  `span_status='ERROR'`, Duration `approx_percentile_cont(duration,…)`), the Insights dimension
  selector (OTel dimensions), and the error-only toggle.
  - Must include **≥1 error span** (`span_status=2`, i.e. OTEL status code `ERROR`) so the Errors
    panel and the error-count badge have data — this is the `forceScenario: 'error'` seed.
  - Must include **≥1 success span** (`span_status=1`) so Rate/Duration chart.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest traces:** `ingestTraces(page, 6, { forceScenario: 'error' })` then
  `ingestTraces(page, 10, { forceScenario: 'success' })` — helper:
  `tests/ui-testing/playwright-tests/utils/trace-ingestion.js` (module `ingestTraces`).
  Reference usage: `tests/ui-testing/playwright-tests/Traces/tracesCharts.spec.js:27-28` (inside
  `test.beforeAll`, with a fresh `browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' })`).
  - The helper POSTs OTLP JSON to `/api/{org}/v1/traces` using `getAuthHeaders()` /
    `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`; org default is
    `default` (env `ORGNAME`).
- **Auth/org:** reuse the worker auth state `playwright-tests/utils/auth/user.json` (see
  `navigateToBase` in `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`); org
  identifier `default`.
- **Navigation + stream selection + search:** `pm.tracesPage.navigateToTraces()` →
  `selectTraceStream('default')` → `setupTraceSearch()` → `waitForTraceSearchResults()` →
  `ensureMetricsDashboardVisible()` → `waitForMetricsPanels()`. All helpers are on
  `tests/ui-testing/pages/tracesPages/tracesPage.js` (`TracesPage`); page manager at
  `tests/ui-testing/pages/page-manager.js`.
- **Timing / hydration:** the stream schema + stream list arrive async. Wait for the stream option to
  exist before selecting (`selectTraceStream` already polls
  `[data-test="log-search-index-list-select-stream-option"][data-test-value="default"]`). Then wait for
  panel canvases to render (`waitForMetricsPanels` polls each `[data-test-panel-title] canvas`).
  For the error-only badge, use `waitForErrorBadgeAfterSearch()` (re-runs search up to 8×) because
  freshly-ingested error spans can lag backend indexing.

## Preconditions / toggles

- **Metrics toggle ON** — `searchObj.meta.showHistogram` defaults to `true`; `ensureMetricsDashboardVisible()`
  should be used to guarantee it (and re-enable if a prior test toggled it off). Do not leave the
  toggle off across tests.
- **Non-SQL mode** — charts render in the normal (visual) query mode; the RED SQL is generated
  internally regardless of the syntax-guide SQL toggle, but the query editor is read via Monaco
  (`getQueryEditorContent` targets `#traces-query-editor`).
- **Time range 15m** — `setupTraceSearch()` sets `15m`; seeded traces are timestamped "now" (ns), so
  any short relative window covers them.
- **Traces (not Spans) mode default** — the page opens in `traces` mode; the Spans-mode test must
  click `traces-search-mode-spans-btn` explicitly.

## Gotchas (so the Healer/Engineer don't rediscover them)

- The Errors panel and error-count badge are **empty/absent with zero error spans** — seed
  `forceScenario: 'error'` in `beforeAll` and use `waitForErrorBadgeAfterSearch()`; do not assert the
  badge synchronously after the first search.
- `getQueryEditorContent` reads the **Monaco model** (`window.monaco.editor.getEditors()`), not DOM
  text — `.view-lines` is unreliable. `typeTraceQuery` must use real keystrokes (Monaco `setValue()`
  never reaches app state).
- The duration filter is written **human-readable** (`duration >= '5.62s'`) into the editor; the
  Insights drawer decodes it back to µs. Assert on absence of cast errors, not on non-empty charts
  (a narrow zoom band can legitimately match nothing).
- `traces-error-count-badge` is the error-only toggle and is **not rendered when `errorCount==0`**.
- Two behaviors are deliberately parked (skip) in the spec — do not "fix" them into live tests:
  the zoom grey-out (#14533) and charts-return-after-clearing-a-rejected-query (o2-enterprise#2643).
- `forceRefreshPanel` is not implemented on `RenderDashboardCharts` — a `refreshDashboard()` call is a
  no-op; don't write a test that asserts on a manual refresh action.
