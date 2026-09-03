# Test Setup Contract: Traces GenAI v5 Parts Rendering  (area: Traces)

This contract defines the data/streams the `traceGenAiParts.spec.js` tests must
establish, and the EXACT existing helpers to create each. It is read by the Engineer
(setup), the Healer and the Refiner (data/setup failure triage). Do **not** invent a
new ingestion pattern — copy the patterns cited below.

## Key fact: how a span attribute becomes the field the component reads

OpenObserve flattens OTLP span attributes to top-level fields at ingest
(`src/config/src/utils/flatten.rs::format_key` replaces every non `[a-z0-9_]` char —
including `.` — with `_`). So the OTel GenAI semconv v5 attributes map:

| OTLP attribute (dotted) | Flattened field the component reads |
|-------------------------|-------------------------------------|
| `gen_ai.operation.name` | `gen_ai_operation_name` |
| `gen_ai.input.messages` | `gen_ai_input_messages` |
| `gen_ai.output.messages` | `gen_ai_output_messages` |
| `gen_ai.system.instructions` | `gen_ai_system_instructions` |
| `gen_ai.response.model` | `gen_ai_response_model` |
| `gen_ai.tool.name` | `gen_ai_tool_name` |
| `gen_ai.tool.call.id` | `gen_ai_tool_call_id` |
| `gen_ai.tool.call.arguments` | `gen_ai_tool_call_arguments` |
| `gen_ai.tool.call.result` | `gen_ai_tool_call_result` |

The `messages`/`instructions` attribute values are **JSON-encoded strings** in the span
attribute (`{ value: { stringValue: JSON.stringify(messages) } }`), because that is what
`TraceDetailsSidebar` passes straight into `LLMContentRenderer` as `content` (which
`JSON.parse`s it). Each test field lands as an identical top-level string field, exactly
as documented for the SDR traces helper.

## Streams / data the spec must establish

- **`[per-test]`** `trace-genai-parts-<unique-suffix>` (traces stream, uniquely named per
  test, deleted by `cleanup.spec.js`): one span per scenario with `gen_ai.*` attributes.
  Why: every test both ingests and reads its own stream so assertions are never polluted
  by a prior test's rows, mirroring the SDR per-batch-marker approach.

### Scenario A — v5 `parts` conversation (primary, Workflow 1)
Span `kind: 2`, `name: "chat <suffix>"`, attributes:
- `gen_ai.operation.name` = `"chat"`
- `gen_ai.input.messages` = `JSON.stringify([
    { role: "user", parts: [{ type: "text", content: "What's the weather in Boston?" }] },
    { role: "assistant", parts: [
        { type: "reasoning", content: "I should check the weather." },
        { type: "tool_call", name: "get_weather", arguments: { city: "Boston" } } ] }
  ])`
- `gen_ai.output.messages` = `JSON.stringify([
    { role: "tool", parts: [{ type: "tool_call_response", result: "rainy, 57F" }] } ])`

Assert: Input pane message body contains `I should check the weather.` and `get_weather`;
Output pane shows `rainy, 57F`; no `"type":"tool_call"` JSON dump.

### Scenario B — system instructions via v5 parts (Workflow 2)
Add to the Scenario A span (or a second span):
- `gen_ai.system.instructions` = `JSON.stringify([{ type: "reasoning", content: "Always be concise." }])`

Assert: "System Instructions" collapsible appears; expanding shows `Always be concise.`.

### Scenario C — `thinking`/`result` real-world aliases (edge #2)
- `gen_ai.input.messages` = `JSON.stringify([{ role: "assistant", parts: [{ type: "thinking", content: "let me check" }] }])`
- `gen_ai.output.messages` = `JSON.stringify([{ role: "tool", parts: [{ type: "tool_call_response", result: "rainy, 57F" }] }])`

Assert: `let me check` renders (alias for reasoning), `rainy, 57F` renders (alias for response).

### Scenario D — blob/file/uri placeholders (Workflow 4)
- `gen_ai.input.messages` = `JSON.stringify([{ role: "assistant", parts: [
    { type: "blob", modality: "image", mime_type: "image/png", content: "aGVsbG8=" } ] }])`

Assert: body contains `[image: image/png]` placeholder and NOT `aGVsbG8=`.

### Scenario E — truncation + expand (Workflow 5)
- `gen_ai.input.messages` = `JSON.stringify([{ role: "assistant", parts: <20 text parts joined so the rendered body exceeds 15 lines> }])`

Assert: `traces-llm-content-renderer-expand-btn` visible; click expands; collapse returns.

### Scenario F — tool observation `execute_tool` (Workflow 3, edge #3)
Span `kind: 2`, attributes:
- `gen_ai.operation.name` = `"execute_tool"`
- `gen_ai.tool.name` = `"calculator"`
- `gen_ai.tool.call.id` = `"call-123"`
- `gen_ai.tool.call.arguments` = `'{"operation":"add","numbers":[1,2]}'`
- `gen_ai.tool.call.result` = `'{"result":3}'`
- **AND** `gen_ai.input.messages` = `'{"operation":"add","numbers":[1,2]}'` (a non-empty string,
  or `attributes_prompt`) and `gen_ai.output.messages` = `'{"result":3}'`
  — REQUIRED, otherwise the renderer is never mounted and the test shows "No data available".

Assert: `.tool-content` renders with `Tool: calculator` and `Call ID: call-123`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingestion (OTLP traces, `stream-name` header):** copy the shape from
  `tests/ui-testing/pages/sdrPages/sdrTracesIngestionPage.js:47-142`
  (`ingestMultipleFields` → `page.request.post(`${baseUrl}/api/${orgId}/v1/traces`,
  { headers: { ...getAuthHeaders(), 'stream-name': streamName }, data: traceData })`).
  Build the same `resourceSpans → scopeSpans → spans` OTLP envelope; set each span's
  `attributes` to the `gen_ai.*` dotted keys above. Verify with the SDR page's
  retry/readiness loop (200/206 accepted; retry on "being deleted"; poll the traces
  search API for a unique marker before asserting).
- **Existing OTLP envelope reference:** `tests/ui-testing/playwright-tests/utils/trace-ingestion.js:146-237`
  (`generateTrace`) shows the exact `resourceSpans`/`scopeSpans`/`spans` structure and
  `startTimeUnixNano`/`endTimeUnixNano`/`kind`/`status` fields — but it does NOT emit
  `gen_ai.*`; extend it or, simpler, add a `gen_ai.*` span to the SDR-style envelope.
- **Auth/org:** `getOrgIdentifier()` (default `"default"`) and `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js:23-66`; base URL from
  `process.env.INGESTION_URL || process.env.ZO_BASE_URL`.
- **Navigate & open the preview:** `tests/ui-testing/pages/tracesPages/tracesPage.js` —
  `navigateToTracesUrl()` → `selectTraceStream('<stream>')` (lines 237-289) →
  `setTimeRange('15m')` → `runTraceSearch()` → click the trace result and then the LLM
  span in the trace tree (the sidebar then defaults to the Preview tab — see
  `TraceDetails.vue:2150`).
- **Timing/readiness:** after ingest, poll the traces search API for the unique marker
  (or `page.waitForTimeout` a few seconds as the SDR helper does) before navigating;
  the Preview renderer is synchronous once the span is loaded — assert on
  `.messages-view .message-content` / `.tool-content` text only after the sidebar has
  rendered (wait for `[data-test="trace-details-sidebar-tabs-preview"]`).

## Preconditions / toggles

- OSS run: `config.isEnterprise !== 'true'` (default) — no enterprise gating on the
  Preview tab. Do NOT depend on correlation tabs.
- `config.showLLMUI !== 'false'` only gates the **Thread** tab, not the Preview pane.
- No SQL-mode / quick-mode toggles involved for the Preview pane.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Tool span MUST also carry input/output messages** — the Preview renderer is
   `v-if="hasContent(previewInput/previewOutput)"` (`TraceDetailsSidebar.vue:476-538`), so
   `gen_ai.tool.call.*` alone shows "No data available". Always include
   `gen_ai.input.messages`/`gen_ai.output.messages` (or `attributes_prompt`/`attributes_response`).
2. **Flattened field names use underscores, not dots** — send OTLP attributes as
   `gen_ai.input.messages` (dotted) and the component reads `gen_ai_input_messages`
   (underscored). Do not send the underscored form as an attribute key.
3. **Messages/instructions attribute values must be JSON strings** — the sidebar passes
   the raw field straight to `LLMContentRenderer`, which `JSON.parse`s string content.
   An already-object value would skip parse and break `isMessagesArray` detection.
4. **Collapse button and copy/fullscreen buttons have NO `data-test`** — assert expand via
   `traces-llm-content-renderer-expand-btn`; for collapse target the button by its
   `traces.lLMContentRenderer.collapse` label text (or request a selector).
5. **Stream schema arrives async** — poll/verify a query returns the ingested span before
   opening trace details, otherwise the stream selector/search may see nothing.
6. **Truncation counts joined lines** — a message body must exceed 15 lines for the
   expand button to appear; a single short v5 message will not truncate.
