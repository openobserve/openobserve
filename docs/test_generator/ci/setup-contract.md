# Test Setup Contract: Traces GenAI v5 Parts Rendering  (area: Traces)

## Streams / data the spec must establish

All data is established **per-test** via OTLP ingest (one span per test). There is
no pre-seeded/shared stream requirement — every test creates a uniquely-named
stream and span so parallel mode never collides.

- **`trace_genai_parts_<uuid>` [per-test]** — a traces stream created implicitly by
  the first span POST (stream-name header). Carries one LLM span per test. Fields
  after OTLP flatten (`.`→`_`): `operation_name`, `gen_ai_operation_name`,
  `gen_ai_input_messages`, `gen_ai_output_messages`, `gen_ai_system_instructions`,
  `gen_ai_tool_name`, `gen_ai_tool_call_id`, `gen_ai_tool_call_arguments`,
  `gen_ai_tool_call_result`, `service_name`, `span_kind`, `span_status`.
  Why: every workflow (Preview pane, Thread tab, system instructions, tool
  observation, suppression, truncation) reads these flattened fields.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest one GenAI span:**
  `pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, { name, kind, attributes })`
  — defined at `tests/ui-testing/pages/tracesPages/genAiTracesIngestionPage.js:41-118`.
  It POSTs `POST /api/{org}/v1/traces` with the `stream-name` header; each attribute
  value must already be a JSON-encoded string (the caller `JSON.stringify`s
  messages/instructions). Reference usage:
  `tests/ui-testing/playwright-tests/Traces/traceGenAiParts.spec.js:59-76`.
- **Poll until the span is searchable (do NOT search blind):**
  `pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName)` —
  `genAiTracesIngestionPage.js:131-174`. Polls the search API by `operation_name`
  until `hits >= 1` (index/schema hydration). Reference:
  `traceGenAiParts.spec.js:76`.
- **Auth/org:** `getOrgIdentifier()` + `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (used inside the ingestion
  page); org defaults to `default` via `process.env.ORGNAME` in `navigateToTracesUrl`
  (`tracesPage.js:798-803`).
- **Navigate with a freshly-ingested stream:** the stream list is fetched once on
  page load, so a stream ingested *after* load is absent from the selector. Use
  `pm.tracesPage.navigateToTracesUrlWithStream(streamName)` (adds `&stream=…` which
  `Index.vue` auto-selects) — `tracesPage.js:817-828`. Reference:
  `traceGenAiParts.spec.js:40`.
- **Open the Preview pane:** select stream → `setTimeRange('15m')` →
  `runTraceSearch()` → `waitForTraceSearchResults()` → `clickFirstTraceResult()` →
  `clickTraceTreeSpanByOperationName(spanName)` → `expectPreviewTabVisible()`.
  All on `tracesPage.js`; see `traceGenAiParts.spec.js:35-48` (the `openGenAiPreview`
  helper).
- **Open the Thread tab:** `pm.tracesPage.openTraceDetailsTab('thread')` —
  `tracesPage.js:1667-1677` (targets `[data-test="trace-details-thread-tab"]`).
  Reference: `traceGenAiParts.spec.js:303`.

## Preconditions / toggles

- **LLM UI flag:** `VITE_OPENOBSERVE_LLM_UI` must not be `"false"` (defaults to
  visible). CI does not set it, so the Thread tab is present. The Preview pane is
  unaffected by this flag.
- **SQL mode:** not required — the tests use the default (non-SQL) query bar with
  stream + time-range selection. No `disableSqlModeIfNeeded` call needed.
- **Span `kind`:** ingest uses `kind: 2` (OTLP SERVER) so `classify()` in
  `threadView.utils.ts:125` can mark a root span and `isLLMTrace` passes via
  `gen_ai_operation_name`.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`execute_tool` span MUST carry non-empty `gen_ai.input.messages` AND
  `gen_ai.output.messages`** — the Preview panes render
  `v-if="hasContent(previewInput/previewOutput)"`
  (`TraceDetailsSidebar.vue:476-484,530-538`), so a tool span without them shows
  "No data" instead of the tool-observation view. See
  `traceGenAiParts.spec.js:174-177`.
- **Reasoning/`thinking` parts in INPUT do not appear in the Thread tab** — the
  Thread projects only OUTPUT messages to the assistant turn
  (`threadView.utils.ts` `buildTraceGroup`); assert on the `tool_call_response`
  in OUTPUT. See `traceGenAiParts.spec.js:305-309`.
- **Schema/field hydration is async** — always `pollForSpan` (search-API hit) before
  running the UI search, else the freshly-ingested span isn't searchable and the
  tree renders empty.
- **The collapse button has no data-test** — target by role+name `/collapse/i`
  (`tracesPage.js:2797-2799`); the expand button does have
  `data-test="traces-llm-content-renderer-expand-btn"`.
- **`.tool-content` / `.io-section` / `.thread-view` carry no data-test** — the page
  object scopes them under `[data-test="trace-details-sidebar"]` / `.thread-view`
  (`tracesPage.js:87-95`). Do not rely on the bare class name outside those scopes.
- **Truncation threshold is 15 lines** (`INITIAL_LINE_LIMIT`,
  `LLMContentRenderer.vue:257`). Use 20 `text` parts to reliably exceed it; a single
  long part joined into >15 lines also works, but the parts array is the reliable
  approach in the existing spec.
