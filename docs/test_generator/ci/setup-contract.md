# Test Setup Contract: Trace Span Name Truncation & Tooltips  (area: Traces)

> Read by the **Engineer** (implements setup), the **Healer** and **Refiner** (consult instead of
> blind-scanning when a data/setup failure appears). Every item below names an EXISTING helper +
> spec:line — do not invent a setup.

## Streams / data the spec must establish

The feature is presentational (CSS truncation + `title` attributes), so the only precondition is a
trace whose **root span operation name** (and ideally service name) is long enough to truncate.
A **single-span trace** is the deterministic, lowest-flake choice: `traceTree[0]` = that span, so
the header operation name and the single tree row's operation name are the same value, and the row
is guaranteed to be in the virtualized DOM (no scroll needed).

- **`trace_truncation_<uuid>`** **[per-test]** — one OTLP span with a **long `name`** (operation name).
  Ingested per test, uniquely named. This exercises: header operation-name truncation + tooltip,
  tree operation-name truncation + tooltip, and tree service-name tooltip (service name comes from
  `service.name` = `genai-test-service` on the resource).

  > Note: the existing `ingestGenAiSpan` helper hardcodes `service.name` to a short value
  > (`genai-test-service`). The service-name `title` assertion is still valid (assert `title` equals
  > that exact value) even though the name is too short to visibly ellipsis. If the spec wants to
  > prove *service-name* truncation visually, it must add a new helper (or extend `ingestGenAiSpan`
  > to accept a `serviceName` param) that sets `resource.attributes[service.name]` to a long string —
  > flagged below as an optional extension, not a required path.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest the long-named span** — use the GenAI ingestion page object (OTLP traces, one span per
  POST, target stream via `stream-name` header):
  ```js
  const suffix = generateUUID();
  const streamName = `trace_truncation_${suffix}`;
  const longName = `HTTP POST /api/v1/orders/${'x'.repeat(120)}`; // long enough to truncate
  await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
    name: longName,
    kind: 2,
    attributes: { 'http.method': 'POST', 'http.status_code': '200' },
  });
  await pm.genAiTracesIngestionPage.pollForSpan(streamName, longName);
  ```
  Helper: `web/../tests/ui-testing/pages/tracesPages/genAiTracesIngestionPage.js`
  (`ingestGenAiSpan` at line 41, `pollForSpan` at line 131). Reference usage:
  `tests/ui-testing/playwright-tests/Traces/traceGenAiParts.spec.js:59-76`.

- **Navigate & open the trace** (re-navigate with the `stream` query param so the freshly-ingested
  stream is auto-selected — the stream list is fetched once on mount):
  ```js
  await pm.tracesPage.navigateToTracesUrlWithStream(streamName); // tracesPage.js:823
  await pm.tracesPage.setTimeRange('15m');                       // tracesPage.js:534
  await pm.tracesPage.runTraceSearch();                          // tracesPage.js:345
  await pm.tracesPage.waitForTraceSearchResults();               // tracesPage.js:2302
  await pm.tracesPage.clickFirstTraceResult();                   // tracesPage.js:958
  ```
  Reference usage of the same sequence: `tests/ui-testing/playwright-tests/Traces/traceGenAiParts.spec.js:40-44`.

- **Auth/org**: `ORGNAME` default is `default` (worker auth state already provisioned).
  `navigateToTracesUrlWithStream` builds `/web/traces?org_identifier=default&stream=<name>`
  (tracesPage.js:804-834). `ingestGenAiSpan` uses `getAuthHeaders()` + `getOrgIdentifier()`
  (`tests/ui-testing/playwright-tests/utils/cloud-auth.js`) against `ZO_BASE_URL`.

- **Timing / load state**: the trace-details data arrives async after the trace row is clicked.
  Before asserting, wait for the ready state — the loading spinner (`trace-details-loading-spinner`)
  to be gone AND the tree to render:
  ```js
  await page.locator('[data-test="trace-details-operation-name"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-test^="trace-tree-span-container-"]').first().waitFor({ state: 'visible', timeout: 15000 });
  ```
  `pollForSpan` (already called above) additionally guarantees the span is searchable before the UI
  search runs, so the trace detail isn't opened on a half-hydrated schema.

## Preconditions / toggles

- **Non-SQL mode not required** — truncation is a view concern; the standard traces search (Quick
  mode default) is sufficient.
- **No enterprise gate** — the header/tree truncation renders in OSS. The embedded-mode `OTooltip`
  is the only enterprise-adjacent nuance and is out of scope for the primary spec (requires logs→trace
  correlation navigation).
- **Waterfall tab** — the trace tree only renders on the `waterfall` tab (default). Do not assume a
  persisted active tab: if needed, `await pm.tracesPage.openTraceDetailsTab('waterfall')`
  (tracesPage.js:1673).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Virtualized tree**: only ~a screenful of span rows exist in the DOM at once. Use a single-span
  trace so the one row is always rendered, and target `[data-test^="trace-tree-span-operation-name-"]`
  with the `:not([data-test*="container"])` guard (there is a `-container-` sibling data-test with a
  similar prefix — see `clickTraceTreeSpanByOperationName`, tracesPage.js:2677).
- **`title` vs `OTooltip`**: the tree spans and the standalone header use a **native `title`
  attribute** (assert via `getAttribute('title')`), NOT the OTooltip component. Only the *embedded*
  header adds an `OTooltip`. Do not wait for an OTooltip portal.
- **Service name is short with the standard helper** (`genai-test-service`). Assert the service-name
  `title` equals that exact value; if the spec must prove *visual* service-name truncation, extend
  the helper to accept a `serviceName` first (optional).
- **Stream list fetch is once-per-mount** — a stream ingested after page load is absent from the
  selector. Always use `navigateToTracesUrlWithStream(streamName)` after ingestion (this is the
  documented reason the GenAI spec re-navigates — `traceGenAiParts.spec.js:36-40`).
- **`title` can be empty string** if `operation_name` is absent → `getFormattedSpan` falls back to
  `t("traces.traceDetails.unknownOperation")`. Always ingest a span with a non-empty `name` so the
  `title` equals the known long value.
