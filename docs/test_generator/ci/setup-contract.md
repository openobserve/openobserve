# Test Setup Contract: AI Observability Monitor (LLM Insights + Sessions) in OSS
(area: Traces · spec: `tests/ui-testing/playwright-tests/Traces/aiObservabilityMonitor.spec.js`)

This contract is the single source of truth for the data/streams the spec must establish and the
EXACT existing helpers to establish them. Do NOT invent new setup patterns for anything covered here.

---

## 1. Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — set up ONCE and only read (or a pre-seeded stream).
- **`[per-test]`** — only one test needs it, or a test mutates it → set up inside that test, uniquely named.

### LLM Insights

- `llm_insights_<uuid>` **[per-test]** — fields the KPI/panels need (all auto-flattened from OTel dotted attrs):
  - `gen_ai_operation_name` ← `gen_ai.operation.name` (e.g. `"chat"`)
  - `gen_ai_response_model` ← `gen_ai.response.model` (e.g. `"gpt-4o"`)
  - `gen_ai_usage_cost` ← `gen_ai.usage.cost` (e.g. `"0.05"`)
  - `gen_ai_usage_total_tokens` ← `gen_ai.usage.total_tokens` (e.g. `"150"`)
  - `gen_ai_usage_input_tokens` / `gen_ai_usage_output_tokens` (optional, for sessions mainly)
  - `service_name` ← resource attribute `service.name` (the existing helper hardcodes `genai-test-service`)
  - `duration` (span `endTimeUnixNano - startTimeUnixNano`; helper sets 1ms)
  - Why: the LLM KPI strip + trend panels select `gen_ai_*` / `duration` / `trace_id` / `service_name`.
    Any span with `gen_ai.*` keys auto-marks the stream `is_llm_stream = true`
    (`src/core/src/traces/mod.rs:1309-1312` → `set_stream_is_llm` at `:1406`), which is what makes the
    stream appear in the LLM/Sessions picker (`useLlmTraceStreams.ts:47` filters `is_llm_stream !== false`).
- **`[shared/read-only]`** a fresh OSS org with **NO** gen_ai data → drives `llm-insights-empty`
  and `sessions-empty-no-streams` (no LLM streams). Do not ingest gen_ai spans for these negative tests.

### Sessions

- `sessions_<uuid>` **[per-test]** — fields:
  - `gen_ai_conversation_id` ← `gen_ai.conversation.id` (ONE value shared by ALL spans = ONE session)
  - `gen_ai_usage_input_tokens` / `gen_ai_usage_output_tokens` / `gen_ai_usage_total_tokens`
  - `gen_ai_usage_cost`
  - `user_id` ← `user.id` (shown in the User column; `user_ids[0]` in the API response)
  - `first_user_message` ← `gen_ai.input.messages` (first user message in the conversation)
  - per-turn: DISTINCT `traceId` per span (turns = distinct trace_ids)
  - error turn: a span with OTLP `status: { code: 2 }` (ERROR) → `span_status='ERROR'` → session `status="error"`
  - Why: the session list is server-side `GROUP BY gen_ai_conversation_id` (`GET /api/{org}/{stream}/traces/session`,
    `src/api/search/src/traces/session.rs`); a session needs ≥1 span, ≥2 spans (distinct trace_ids) for turns>1.

---

## 2. How to create it (copy these EXACT patterns — do NOT invent setup)

### 2.1 Ingest gen_ai spans (LLM Insights + Sessions both)

Use the existing page object `pm.genAiTracesIngestionPage` (`tests/ui-testing/pages/tracesPages/genAiTracesIngestionPage.js`),
already registered on PageManager (`tests/ui-testing/pages/page-manager.js:243`):

```js
await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
  name: spanName,              // unique per test (doubles as the poll marker)
  kind: 2,                     // SERVER
  attributes: {
    'gen_ai.operation.name': 'chat',
    'gen_ai.response.model': 'gpt-4o',
    'gen_ai.usage.cost': '0.05',            // string number is fine — extract_f64 parses it
    'gen_ai.usage.total_tokens': '150',     // extract_i64 parses string numbers
    'gen_ai.usage.input_tokens': '100',
    'gen_ai.usage.output_tokens': '50',
    // sessions additionally need:
    'gen_ai.conversation.id': conversationId,
    'user.id': 'user-123',
    'gen_ai.input.messages': JSON.stringify([{ role: 'user', content: 'hello' }]),
  },
});
await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);
```

Reference spec that already uses this exact pattern:
`tests/ui-testing/playwright-tests/Traces/traceGenAiParts.spec.js:59-76` (ingest) and `:76` (poll).

The helper POSTs OTLP to `/api/{org}/v1/traces` with a `stream-name` header
(`genAiTracesIngestionPage.js:41-118`). Auth/org come from
`tests/ui-testing/playwright-tests/utils/cloud-auth.js` → `getAuthHeaders()` / `getOrgIdentifier()`.
Base URL from `process.env.INGESTION_URL || process.env.ZO_BASE_URL`.

### 2.2 Auth / org

- No org creation needed. Use the existing worker auth + `navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141-187` (it drives
  `/web/?org_identifier=${ORGNAME}` and verifies auth). All other specs use it; copy the `beforeEach`.
- Navigation to the feature pages mirrors `tracesPage.navigateToTracesUrl` (`tracesPage.js:804-815`):
  build URLs as `${ZO_BASE_URL}/web/ai/llm-insights?org_identifier=${ORGNAME}` and
  `${ZO_BASE_URL}/web/ai/sessions?org_identifier=${ORGNAME}` (or click the nav item `aiObservability`, link `/ai`).

### 2.3 Timing / hydration

- **Wait for the stream to be searchable** via `pollForSpan` before navigating/asserting — the LLM
  page reads `availableStreams` from `getStreams("traces")` and the KPI query hits the search API;
  querying before the schema/index hydrates returns empty (→ false `llm-insights-empty`).
- **KPI/panel fetch is async streaming** (`useLLMInsights.fetchAll`): assert the KPI strip only after
  `loading` flips false. There is no dedicated "loading done" selector — poll for `kpi-card-row` (or
  the last-refreshed label) with a timeout, or add a page-object wait that polls `networkidle` + a
  selector presence. Same for the sessions table (`sessions-list-table` rows).
- **`is_llm_stream` auto-mark is async** (written after ingestion completes): `pollForSpan` only proves
  the span is searchable; the LLM picker may still miss the stream for a short window. Re-navigate with
  a full `page.goto` (like `navigateToTracesUrlWithStream`) if the picker is empty after ingest, and/or
  add a brief retry on the stream-selector option appearing.

---

## 3. GAPS — the existing helper does NOT cover these (Engineer must extend or add)

1. **`ingestGenAiSpan` cannot build multi-turn sessions.** It generates a fresh random `traceId`/`spanId`
   per call (`genAiTracesIngestionPage.js:53-54`) and has no `conversationId`/`traceId` parameter. To
   produce one session with `turns > 1` you need MULTIPLE spans with the SAME `gen_ai.conversation.id`
   but DIFFERENT traceIds. **Add an optional `traceId` (and `resourceAttributes`/`statusCode`) option to
   `ingestGenAiSpan`, or add a sibling `ingestGenAiSession(streamName, conversationId, turns, opts)`
   helper** that loops N spans sharing the conversation id. This is the single biggest setup gap.
2. **`ingestGenAiSpan` hardcodes `status: { code: 1 }` (OK).** There is no way to ingest an ERROR span
   (needed for the error-rate KPI, the recent-errors table, and the session `status="error"` badge).
   OTLP `status: { code: 2 }` = ERROR. **Extend the helper with a `statusCode` option.**
3. **No existing helper polls for a *session*** (only `pollForSpan`). After ingesting a conversation,
   poll the search API for `SELECT * FROM "<stream>" WHERE gen_ai_conversation_id = '<id>'` (same shape
   as `pollForSpan`'s SQL) before asserting `sessions-list-table` rows — the sessions endpoint
   (`/traces/session`) aggregates the same ingested data and needs the index to have hydrated.
4. If any of these can't be added cleanly, the Architect should park the affected cases (multi-turn,
   error badge) — do not assert against data the helper cannot produce.

---

## 4. Preconditions / toggles

- **OSS only.** Do not enable/assert Agent mode, Version Compare, or non-Monitor rail items. `config.isEnterprise`
  and `config.isCloud` are `false` in the OSS E2E build; the feature pins `filterMode="stream"` and hides
  the Agent toggle (`AiScopeBar.vue:198-203,219`).
- SQL mode / quick-mode toggles are **irrelevant** here — this module uses its own streaming SQL, not the
  logs query editor. No toggle teardown needed.
- The default relative window is "last 15m" (`useAiDateController` `DEFAULT_RELATIVE`); ingested spans use
  `Date.now()*1000000` so they land inside the default window. Keep span `startTimeUnixNano` near "now".

---

## 5. Gotchas (so the Healer/Engineer don't rediscover them)

- **"no gen_ai fields" empty state is nearly unconstructable via ingestion.** `streamHasNoLLMFields`
  (`LLMInsightsDashboard.vue:732-736`) needs a stream with `is_llm_stream` true/undefined but NO `gen_ai_*`
  columns. The auto-detect path (`detect_llm_stream`, `src/core/src/traces/mod.rs:1698-1724`) only marks a
  stream LLM *when* gen_ai keys are present, so normal ingestion never produces this. If the spec wants it,
  it must manually set `is_llm_stream` (via the streams settings API) on a non-gen_ai traces stream. Prefer
  to SKIP this edge case or mark it low-priority.
- **`llm-insights-stream-count` / `sessions-stream-count` / `*-filter-mode` are NOT rendered on OSS**
  (they are inside the Agent-toggle gate). Don't assert them.
- **Numeric gen_ai values must be sent as strings** (the helper uses `stringValue: String(value)`);
  `extract_i64`/`extract_f64` (`src/core/src/traces/otel/extractors/utils.rs:21-32`) parse string numbers, so
  token/cost values WILL populate — but a non-numeric string silently yields no value (KPI shows 0/empty).
- **`first_user_message`** is derived from `gen_ai.input.messages`; send it as a JSON-stringified array of
  `{role, content}` (the extractor/`threadView.utils` parse it). A bare string may still be accepted but use
  the array shape to match the session endpoint's parsing.
- **Stream schema arrives async** — always `pollForSpan` (and optionally re-`page.goto`) before the first
  assertion, else the LLM resolver sees `[]` and the test asserts the wrong (empty) state.
- The sessions table is **server-paginated** (default page size 20). Assert row presence by session id or
  status badge selector (`sessions-list-status-<sessionId>`), not by a fixed row index, unless >20 rows are
  ingested deliberately for a pagination test.
