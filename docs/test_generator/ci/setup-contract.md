# Test Setup Contract: Trace Span Event Markers  (area: Traces)

## Streams / data the spec must establish

The feature renders markers only when a span's raw record carries a non-empty `events` payload
(array or JSON string) whose events have a numeric `_timestamp` (ns) inside the relevant window.
The existing OTLP trace ingest helper **already produces spans with events**, but **only exception
(error-severity) events** and **only on error traces**. Plan test data around that.

- **`default` stream — OpenObserve self-tracing traces** **[shared/read-only]**
  - Fields: standard OTel span fields (`trace_id`, `span_id`, `start_time`, `end_time`,
    `duration`, `operation_name`, `service_name`, `span_status`) plus `events`.
  - `events` in the self-tracing `default` stream carry a `level` field (Rust `tracing`
    instrumentation), i.e. **info/warning/error tiers** exist there — but the exact mix and
    presence of events on any given span are **non-deterministic** for a fresh CI run. Do NOT
    assert specific severity tiers against `default`.
  - Why: read-only smoke (markers/badge appear when events present) — but prefer the deterministic
    path below for severity assertions.

- **Deterministic OTLP trace(s) — ingest via `ingestTraces(page, N, { forceScenario: 'error' })`** **[per-test]**
  - Produces error traces whose **server span** carries an `events` array with a single
    `{ name: "exception", attributes: [{key:"exception.type"…}, {key:"exception.message"…}] }` event
    at `timeUnixNano` = server span start + 1ms (inside the span window).
  - `timeUnixNano` → backend `_timestamp` (ns) → frontend `tsUs` (µs). Severity = **error**
    (exception-first), `data-event-severity="error"`, tree badge error tally = 1.
  - Why: the ONLY deterministic severity tier the existing helper produces. Drives: waterfall
    `span-event-marker` (error), tree `span-event-count-badge` (error-outline + error tally),
    sidebar mini-timeline error tick, marker-click → Events-tab handoff.
  - Caveat: `ingestTraces` traces have **3 spans** (root, client, server); **only the server span**
    has events. Use the helper's returned `traceIds` (or a `span_id`-targeted search) to open the
    right trace; the server span is the 3rd (`POST /{operationName}`, kind SERVER).

- **Info/warning tiers** **[per-test, if asserted]**
  - No existing helper produces `level`/`severity_text` events. To assert info/warning, extend
    `generateTrace`/a local payload to add events carrying `attributes: [{key:"severity_text",
    value:{stringValue:"INFO"|"WARN"}}]` (or `level`) WITHOUT `name:"exception"`/`exception.*`.
  - If no payload is added, **do not write info/warning-severity assertions** — park them as
    `fixme` or assert only `data-event-severity="error"`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **OTLP trace ingestion** — `const { ingestTraces } = require('../utils/trace-ingestion.js');`
  then `const res = await ingestTraces(page, 5, { forceScenario: 'error' });`
  — reference implementation: `tests/ui-testing/playwright-tests/utils/trace-ingestion.js:255`
  (posts to `${baseUrl}/api/${orgId}/v1/traces` with `getAuthHeaders()`; returns `{ traceIds }`).
  - The helper already exists and is used by traces tests — do **not** hand-roll OTLP HTTP calls.
- **Auth/org** — `getOrgIdentifier()` (defaults `"default"`) + `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`; ingestion base URL =
  `process.env.ZO_BASE_URL || process.env.INGESTION_URL` (see `trace-ingestion.js:260`).
- **Navigate to a specific trace (deterministic)** — either:
  1. `await pm.tracesPage.navigateToTracesUrl()` → `setupTraceSearch('default')` →
     `clickFirstTraceResult()` (non-deterministic which trace; existing pattern in
     `tests/ui-testing/playwright-tests/Traces/traceDetails.spec.js:21-37,57`), or
  2. **Direct route** using a returned `traceId`:
     `${baseUrl}/web/traces/trace-details?org_identifier=default&stream=<stream>&trace_id=<id>&from=<µs>&to=<µs>`
     (route `traceDetails`, path `traces/trace-details`, `web/src/composables/shared/router.ts:485-495`).
     Prefer this for a deterministic span event trace.
- **Timing** — after ingestion, the trace may take a moment to be queryable; follow the existing
  `setupTraceSearch` + `runTraceSearch` + `waitForSearchCompletion(20000)` pattern
  (`tracesPage.js:797-811`), then wait for `trace-details-tree` / `span-block` to be visible
  before asserting markers (the trace view hydrates `spanList` → `spanMap` → `events` asynchronously).

## Preconditions / toggles

- Default active tab is **waterfall** (unless persisted in `localStorage` key `o2_trace_active_tab`).
  If asserting waterfall markers, ensure the waterfall tab is active and the sidebar is **closed**
  (`span-event-marker` only renders when `!isSidebarOpen` — `TraceTree.vue:323`).
- The sidebar Events tab is opened by clicking a marker (auto) or a span then the Events tab. The
  mini-timeline (`span-event-timeline-marker`) only renders inside the Events tab panel once it is
  mounted (the panel is `v-if`-gated; the track width is measured via a watcher on the template ref —
  allow a tick after opening).
- Stream selector: OSS mode shows a log-stream selector; View Logs is disabled until a log stream is
  selected — irrelevant to markers, but don't confuse it with span selection.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Only error-tier events come from `ingestTraces`.** Asserting `data-event-severity="info"` or
   `"warning"` against `ingestTraces` output will fail — it never emits them.
2. **Only the server span has events.** The root and client spans in `ingestTraces` output have no
   `events`; a marker/badge assertion on the wrong span is a false negative.
3. **Waterfall markers disappear when the sidebar opens.** Selecting a span sets `isSidebarOpen`
   and `TraceTree.vue:323` unmounts the `SpanBlock` subtree (and its markers). Assert markers first,
   then the sidebar mini-timeline, not both simultaneously.
4. **Marker clustering** — one exception event renders as a single tick; `data-event-count` is 1 for
   the ingest-helper trace. Multi-event cluster assertions need a payload with ≥2 events within 6px.
5. **Flame-graph markers are canvas-only** (no DOM selector). Do not assert them via Playwright DOM
   selectors; the component exposes `buildSpanEventMarkers`/`severityColor` for unit tests only.
6. **Trace data is async** — the events payload arrives with `get_trace_details`; if you query
   markers before `spanList`/`spanMap` hydrate the row, the resolver sees `undefined` and renders
   nothing. Wait for `[data-test="trace-details-tree"]`/`[data-test="span-block"]` visibility.
7. **`data-test="span-event-marker"` is also used in unit tests via `markers()` helpers** — the DOM
   attribute is stable; the `data-test-span="trace-tree-span-event-count-{spanId}"` is dynamic.
