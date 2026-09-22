# Test Setup Contract: RUM Session Replay — gated Play button and no-replay empty state (area: Traces)

This contract tells the Engineer exactly what data/streams each behavior needs and the
EXACT existing helper to establish it. Do NOT invent new setup — copy these patterns.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE in `beforeAll`.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### `_rumdata` (logs stream) — replayable RUM row `[shared/read-only]`
Fields (flat JSON, as the RUM SDK produces after flattening):
- `_oo_trace_id` (or `_o2_trace_id`) — the 32-hex trace id of the companion trace. Both
  spellings are read (`web/src/utils/rum/fields.ts:36-47`); the current browser SDK still
  emits `_oo_*`, so use `_oo_trace_id` to match the schema the trace-id predicate keys on.
- `_oo_span_id` — the browser-request span id = the trace root's dangling `parentSpanId`.
- `type: "resource"` — required so the row is treated as the traced browser request.
- `resource_url`, `resource_method`, `resource_type: "fetch"`, `resource_duration` (µs int).
- `session_id` — the RUM session id (becomes `rum_session_id` on the bridge span).
- `session_has_replay: true` — **JSON boolean `true`, not the string `"true"`** (strict `=== true`
  at `useRumSpanBuilder.ts:178`).
- `view_id` — links the resource to its view.
- `date` — epoch **milliseconds** (read as `dateMs` at `useRumSpanBuilder.ts:238`).
- Why: exercises the **Play button visible** path (Workflow 1).

### `_rumdata` (logs stream) — non-replayable RUM row `[per-test: Play-button-hidden]`
Same fields as above but `session_has_replay` omitted (or `false`). Shares the SAME trace id
and a distinct `session_id`, ingested inside the "hidden" test with a unique `service`/`session_id`.
- Why: exercises the **Play button hidden** path (Workflow 2) — RUM bridge spans exist, button absent.

### Trace (traces stream `default`) — dangling parent `[shared/read-only]`
- One OTLP trace whose **root span has a `parentSpanId` that is NOT any span in the trace**
  (the "dangling" browser-request parent). This is what `hasDanglingParent`
  (`useRumSpanBuilder.ts:155-165`) detects and is the trigger for the whole RUM leg.
- The dangling `parentSpanId` MUST equal `_oo_span_id` of the `_rumdata` resource row.
- Ingest into stream `default` (RUM correlation assumes `default`, `web/src/utils/rum/fields.ts:134`).
- Why: without a dangling parent, `fetchRumEventsForTrace` returns empty and the button can
  never appear — this is the single most load-bearing precondition.

### `_sessionreplay` (logs stream) — MUST EXIST (can be empty) `[shared/read-only]`
- The no-replay empty state only renders if `_sessionreplay` **exists**, because
  `RealUserMonitoring.vue:391-409` populates `performanceState.data.streams["_sessionreplay"].schema`
  via `getStream("_sessionreplay","logs",true)` (which rejects if the stream is absent), and
  `SessionViewer.vue:335/339` dereferences that schema before its search.
- Simplest guarantee: ingest ONE `_sessionreplay` row for a **different** session id (creates
  the stream + schema), then point the empty-state test at a **never-recorded** session id.
- `_sessionreplay` row fields: `session_id`, `start`, `end`, `segment` (JSON string, parsed at
  `SessionViewer.vue:429`), `source`, `ip`, `user_agent_user_agent_family`,
  `user_agent_os_family` (optionally `geo_info_city`, `geo_info_country`).
- Why: exercises the **no-replay empty state** (Workflow 3) without tripping the missing-stream trap.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest `_rumdata` rows
- `page.request.post(\`${BASE}/api/${ORG}/_rumdata/_json\`, { headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' }, data: [row, ...] })`
  — see `tests/ui-testing/playwright-tests/RUM/sourcemap-upload-pretty.spec.js:127` (function
  `ingestFixtureErrors`) and `tests/ui-testing/playwright-tests/utils/rum-error-ingestion.js:197`.

### Ingest `_sessionreplay` rows
- Same `_json` bulk endpoint, `POST /api/{org}/_sessionreplay/_json`.
- **No existing direct-`_sessionreplay` ingest example exists in the repo** (the dataflow specs
  write it via the real SDK). It is the same generic logs bulk route as `_rumdata`; the Engineer
  should treat it as `page.request.post(\`${BASE}/api/${ORG}/_sessionreplay/_json\`, …)` with the
  fields above. If direct `_sessionreplay` ingestion proves unsupported in the environment, park
  the no-replay test as a `test.fixme` and rely on the real-SDK dataflow
  (`tests/ui-testing/playwright-tests/RUM/rum-page-dataflow.spec.js`) — but still navigate to a
  never-recorded session id.

### Ingest the dangling-parent trace
- `page.request.post(\`${baseUrl}/api/${orgId}/v1/traces\`, { headers: { ...getAuthHeaders(), 'stream-name': 'default' }, data: traceData })`
  — see `tests/ui-testing/pages/tracesPages/genAiTracesIngestionPage.js:85` and
  `tests/ui-testing/playwright-tests/utils/trace-ingestion.js:270`.
- Build the OTLP payload with the root span's `parentSpanId` set to the `_oo_span_id` value
  (a `generateHexId(8)` you also write into the `_rumdata` row). Import
  `generateHexId`/`getTimestampNs` from `trace-ingestion.js`.

### Verify data is searchable before asserting (schema/index hydration)
- `waitForStreamRows(page, { sql: \`SELECT * FROM "_rumdata" WHERE session_id = '<id>'\`, minRows: 1, timeoutMs: 45000 })`
  — from `tests/ui-testing/playwright-tests/utils/rum-stream-verify.js:53`.
- For traces: `pollForSpan(streamName, operationName)` — see
  `tests/ui-testing/pages/tracesPages/genAiTracesIngestionPage.js:131`.

### Auth / org
- Use `getAuthHeaders()` + `getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js:29/64`. ORG = `process.env.ORGNAME || 'default'`.
- Self-hosted basic auth uses `ZO_ROOT_USER_EMAIL` / `ZO_ROOT_USER_PASSWORD`
  (`cloud-auth.js:49-56`).

### Navigation (no page-object helper exists for these exact routes yet)
- Trace details: `page.goto(\`${BASE}/web/traces/trace-details?trace_id=<id>&stream=default&from=<µs>&to=<µs>&org_identifier=${ORG}\`)`
  (route `traceDetails`, path `traces/trace-details`, `web/src/composables/shared/router.ts:531`).
  `from`/`to` are **microseconds** (`traceDetails.utils.ts:64-69`).
- Session viewer: `page.goto(\`${BASE}/web/rum/sessions/view/<sessionId>?start_time=<µs>&end_time=<µs>&org_identifier=${ORG}\`)`
  (route `SessionViewer`, path `sessions/view/:id`, `web/src/composables/shared/router.ts:1012`).
- Existing trace-details flow (list → click result) is in
  `tests/ui-testing/playwright-tests/Traces/traceDetails.spec.js:47-92` (`openTraceDetailsIfAvailable`);
  the direct-URL approach is preferred here because the test needs a SPECIFIC ingested trace id.

## Preconditions / toggles
- `hideSessionReplayButton` must stay `false` (default) — it is only set `true` in
  `PlayerTracesTab.vue:134`, which the standalone trace-details flow never mounts.
- Non-SQL mode / quick-mode are irrelevant to this spec (the trace-details and session-viewer
  routes are not gated on SQL mode).
- `session_has_replay` must be a JSON boolean literal. `session_has_replay: "true"` (string) will
  NOT satisfy `=== true`.

## Gotchas (so the Healer/Engineer don't rediscover them)
1. **`_sessionreplay` must exist for the empty state.** If it does not, `SessionViewer.vue:335`
   throws on `streams["_sessionreplay"].schema` and `sessionNotFound` never becomes true → the
   player (or a spinner) renders instead of `session-viewer-no-replay`.
2. **Dangling parent is mandatory** for the Play button. A well-formed trace (every parent
   owned) never triggers `fetchRumEventsForTrace` → no RUM spans → button always hidden. Set the
   root span's `parentSpanId` to the `_oo_span_id`.
3. **`_oo_trace_id` must be the FULL 32-hex trace id** (or its zero-stripped form) matching the
   OTLP trace id; `traceIdLookupVariants` (`fields.ts:160-165`) pads/strips, but a mismatch
   returns no traced resources.
4. **Trace ids normalize to 32 lowercase hex.** Generate the trace id and write the SAME id into
   `_oo_trace_id` (don't mix padding variants).
5. **Schema hydration is async** — assert the trace/`_rumdata` rows are searchable
   (`pollForSpan` / `waitForStreamRows`) BEFORE navigating, else the trace-details resolver sees
   an empty span list and the button never appears (empty `_rumdata` schema also makes
   `rumFieldEqualsAnySql` return `null`).
6. **`event_time` auto-seek is dead** (`rum_date` never set) — do not assert that the player
   seeks; only assert navigation URL + player mount.
7. **RUM spans override trace spans with the same `span_id`** (`TraceDetails.vue:2231-2238`), and
   RUM spans sort by their `date` — keep the `_rumdata` `date` inside the trace window so the
   bridge spans stay visible near the trace.
