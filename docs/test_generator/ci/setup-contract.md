# Test Setup Contract: Trace Details Sidebar Scores Block (Enterprise/Cloud Gate)  (area: Traces)

> Read by the Engineer (implements setup), the Healer and the Refiner (consult instead of
> blind-scanning when a data/setup failure appears). Every helper below already exists in the repo —
> copy these EXACT patterns, do NOT invent setup.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — set up ONCE / reused by every test that only READS it.
- **`[per-test]`** — one test needs it, or the test MUTATES it → unique name, created inside the test.

- **`trace_genai_scores_<uuid>`** **[per-test]** — a traces stream containing ONE OTLP LLM span.
  Required flattened fields (via the `.` → `_` flatten at ingest):
  - `gen_ai_operation_name` (e.g. `chat`) — makes `isLLMTrace()` true.
  - `gen_ai_response_model` (e.g. `gpt-4`) — REQUIRED to render the LLM metrics row (`:247`).
  - `gen_ai_input_messages` / `gen_ai_output_messages` (JSON-encoded strings) — required for the
    Preview tab (`hasTracePreview`) and for the span to be selectable.
  - Optional: `gen_ai_usage_input_tokens` / `gen_ai_usage_output_tokens` / `gen_ai_usage_cost`
    (tokens/cost chips show `0` if absent — still render the row).
  - Why: the ENTIRE scores block lives inside the LLM metrics row
    (`isLLMSpan && llmMetrics && span.gen_ai_response_model`); without `gen_ai_response_model`
    the row never renders, so the OSS "Scores absent" assertion would trivially pass and prove
    nothing.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest**: `pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, { name, kind: 2, attributes })`
  with dotted `gen_ai.*` keys. See the live pattern at
  `tests/ui-testing/playwright-tests/Traces/traceGenAiParts.spec.js:59-75` and the helper at
  `tests/ui-testing/pages/tracesPages/genAiTracesIngestionPage.js:41-118`.
  Exact attribute shape (JSON-string the message values):
  ```js
  await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
    name: spanName,
    kind: 2,
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.response.model': 'gpt-4',                       // → gen_ai_response_model (REQUIRED)
      'gen_ai.input.messages':  JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'hello' }] }]),
      'gen_ai.output.messages': JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'hi' }] }]),
    },
  });
  ```
- **Wait for hydration**: `await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);`
  (`genAiTracesIngestionPage.js:131-174`). The search must not run before the span is indexable —
  the helper polls `/api/{org}/_search?type=traces` until `hits.length >= 1`.
- **Open the sidebar** (copy the `openGenAiPreview` flow from `traceGenAiParts.spec.js:35-48`):
  1. `await pm.tracesPage.navigateToTracesUrlWithStream(streamName)` — full goto re-fetches the
     stream list so a freshly-ingested stream is selectable (`tracesPage.js:823-834`).
  2. `await pm.tracesPage.setTimeRange('15m')` (`tracesPage.js:534`).
  3. `await pm.tracesPage.runTraceSearch()` (`tracesPage.js:345`).
  4. `await pm.tracesPage.waitForTraceSearchResults()` (`tracesPage.js:2302`).
  5. `await pm.tracesPage.clickFirstTraceResult()` (`tracesPage.js:958`).
  6. `await pm.tracesPage.clickTraceTreeSpanByOperationName(spanName)` (`tracesPage.js:2677`).
  7. `await pm.tracesPage.expectPreviewTabVisible()` (`tracesPage.js:2708`) — proves LLM span + sidebar open.
- **Auth/org**: `getAuthHeaders()` + `getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (already wired into the ingestion helper);
  navigation uses `process.env["ORGNAME"] || 'default'` (`tracesPage.js:804-834`). No extra login
  step — the base fixture `navigateToBase(page)` already established auth state.
- **PageManager**: `pm = new PageManager(page)`; `pm.genAiTracesIngestionPage` is registered at
  `tests/ui-testing/pages/page-manager.js:243`.

## Preconditions / toggles

- **OSS build is the default** — do NOT set `VITE_OPENOBSERVE_ENTERPRISE` / `VITE_OPENOBSERVE_CLOUD`.
  `config.isEnterprise` and `config.isCloud` resolve to `"false"`
  (`web/src/aws-exports.ts:36-40`), which is exactly the gate under test.
- No other toggles needed: the LLM metrics row, observation badge, and Preview tab are all
  OSS-reachable; only the Scores block (and enterprise buttons) are gated off.

## Assertions the spec must make (the feature is the GATE)

Positive controls (prove the LLM span + metrics row actually rendered, so the negative is meaningful):
- `await expect(page.locator('[data-test="trace-details-sidebar-observation-badge"]')).toBeVisible()`
- `await expect(page.locator('[data-test="trace-details-sidebar"]')).toContainText('Input Tokens')`
- `await expect(page.locator('[data-test="trace-details-sidebar"]')).toContainText('Total Cost')`

Negative gate (the actual feature):
- `await expect(page.locator('[data-test="trace-details-sidebar"]').getByText('Scores', { exact: true })).toHaveCount(0)`
- `await expect(page.locator('[data-test="trace-details-sidebar-scores-empty"]')).toHaveCount(0)`
- (Optional) `await expect(page.locator('[data-test^="trace-score-chip-"]')).toHaveCount(0)`

## Gotchas (so the Healer/Engineer don't rediscover them)

- **"Scores" has no `data-test`** — the label is a bare `<span>` (`TraceDetailsSidebar.vue:314`).
  Use a text locator scoped to `[data-test="trace-details-sidebar"]`. "Scores" is unique to this
  block (no tab/row is labelled "Scores"), so an exact text match is safe. If you prefer a selector,
  add `data-test="trace-details-sidebar-scores-label"` in the Vue source first.
- **The model chip / token / cost chips also have no `data-test`** — use the observation badge
  (`trace-details-sidebar-observation-badge`) as the LLM-span positive control; do not fabricate a
  `data-test` that does not exist.
- **`gen_ai.response.model` is mandatory** — omit it and `:247`'s row gate fails, so the metrics row
  (and the would-be scores block) never renders; the negative assertion becomes vacuously true.
- **Messages must be JSON strings** — `TraceDetailsSidebar` passes them straight to
  `LLMContentRenderer`, which `JSON.parse`s string content; raw objects break the preview.
- **Stream must be re-navigated to, not selected in place** — the stream list is fetched once on
  page load; a stream ingested afterward is absent from the selector, so use
  `navigateToTracesUrlWithStream` (full goto with `stream=` param), exactly as `traceGenAiParts.spec.js` does.
- **Enterprise-positive path is NOT an OSS E2E target** — score chips / "Not scored yet" / evaluate /
  annotate buttons can never render on OSS; those behaviors are unit-covered at
  `web/src/plugins/traces/TraceDetailsSidebar.spec.ts:2149-2194`. Writing an OSS E2E assertion for
  them would fail by design.
