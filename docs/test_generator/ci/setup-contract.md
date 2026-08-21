# Test Setup Contract: Logs View Trace Action (area: Logs)

This contract tells the Engineer exactly what data/state the `viewTrace.spec.js` tests must
establish, and the exact existing helpers + reference spec lines to do it with. **Do NOT
invent new setup** — copy the patterns below.

## Streams / data the spec must establish

### 1. A logs stream whose records carry `trace_id` (REQUIRED — the gate depends on it)
- **`[per-test]`** — ingest inside the test (or `beforeAll`), uniquely named. No global
  stream carries `trace_id`, so the action will NOT appear against `e2e_automate`
  (global setup ingests `logs_data.json` which has no trace id field).
- **Stream name:** `<unique>` e.g. `e2e_view_trace` (or `e2e_view_trace_<runId>`).
- **Fields:** `trace_id` (string, matching a real trace), optional `span_id` (string),
  `message`, and any extra fields. The org's `trace_id_field_name`/`span_id_field_name`
  default to **`trace_id`**/**`span_id`** in OSS (backend default,
  `src/common/src/meta/organization.rs:394-400`).
- **Why:** the View Trace gate requires `record[trace_id_field_name]` to be truthy
  (`useViewTraceAction.ts:93-95`).

### 2. A traces stream containing the trace that the log's `trace_id` points at
- **`[per-test]`** — ingest a fresh trace and reuse its returned trace id.
- The **"default" traces stream already exists** (global setup ingests 20 traces via
  `ingestTraces(page, 20)` at `global-setup.js:124`), but those trace ids are random and
  not persisted, so the test must ingest its **own** trace and capture the id to make the
  log's `trace_id` match and the trace actually resolve.
- **Why:** the picker lists traces streams via `getStreams("traces", false)`; a
  non-empty list is required for the picker+button to render
  (`tracesStreams.length || isTracesStreamsLoading`), and the id must match for
  `TraceDetails` to render the tree.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest a trace and capture its id
```js
const { ingestTraces } = require('../utils/trace-ingestion.js');
// Ingest 1 trace; it returns { traceIds: [...] } (16-byte hex = 32 chars).
const { traceIds } = await ingestTraces(page, 1);
const traceId = traceIds[0];
```
- Reference: `tests/ui-testing/playwright-tests/Traces/tracesAnalyzeDimensions.spec.js:27`
  (`await ingestTraces(page, 8, { forceScenario: 'error' })`).
- Helper: `tests/ui-testing/playwright-tests/utils/trace-ingestion.js:255` (`ingestTraces`)
  → POSTs OTLP to `${baseUrl}/api/${orgId}/v1/traces` (the "default" traces stream).

### Ingest the log record whose `trace_id` matches
```js
const { ingestCustomData } = require('../utils/data-ingestion.js');
await ingestCustomData(page, "e2e_view_trace", [
  { trace_id: traceId, span_id: "<any-hex>", message: "view-trace test record" },
]);
```
- Reference: `tests/ui-testing/playwright-tests/Logs/searchPatterns.spec.js:110`
  (`ingestResponse = await ingestCustomData(page, PATTERNS_STREAM, freshData)`).
- Helper: `tests/ui-testing/playwright-tests/utils/data-ingestion.js:88` (`ingestCustomData`)
  → POSTs `${baseUrl}/api/${orgId}/${streamName}/_json`.
- `_timestamp` is auto-assigned by the backend at ingest time (microseconds), so it will
  fall inside the ±15-minute window `redirectToTraces` computes around the log timestamp
  (`SearchResult.vue:1933-1934`). **Do NOT omit the record or set a stale `_timestamp`.**

### Wait for data to be queryable (readiness gate — DO NOT skip)
```js
const { waitForFieldValueSearchable } = require('../utils/data-ingestion.js');
await waitForFieldValueSearchable(page, "e2e_view_trace", "trace_id", traceId);
```
- Reference: `tests/ui-testing/playwright-tests/utils/data-ingestion.js:243`.
- This polls `SELECT COUNT(*) ... WHERE trace_id = '<traceId>'` until the value is
  searchable, avoiding the WAL→index lag that makes a just-ingested record invisible.

### Auth / org
- Auth state is pre-created in global setup (`global-setup.js` writes
  `auth/user.json`); use `navigateToBase(page)` from the base fixture as every Logs spec
  does. `ORGNAME` resolves via `getOrgIdentifier()` in `utils/cloud-auth.js`.
- OpenObserve run is **OSS** — `service_streams_enabled` is `false` (gate passes).

### Driving the UI to the action (existing page objects)
- Navigate to Logs and run a search on the ingested stream:
  - `pm.logsPage` helpers exist (`navigateToLogsUrl`, stream selection, run query). See
    `tests/ui-testing/pages/logsPages/logsPage.js`.
  - Open the row-detail drawer: `pm.logsPage.openLogDetailSidebar()`
    (`logsPage.js:3465`) or `clickLogTableColumnSource()` (`logsPage.js:3429`).
  - Expand the first row: `[data-test="o2-table-expand-0"]` (used in
    `openFirstLogDetails`, `logsPage.js:5680`).
- The action selectors (both already have `data-test`):
  - Expanded row: `[data-test="trace-view-logs-btn"]` + `[data-test="log-search-index-list-select-stream"]`
  - Drawer: `[data-test="log-detail-view-trace-btn"]` + `[data-test="log-detail-view-trace-stream-select"]`

## Preconditions / toggles
- Ensure **non-SQL mode** and **no aggregation** and **single stream** selected before
  expanding/opening rows (the inline JsonPreview only shows View Trace for a plain log
  record; aggregation/multi-stream changes `filteredTabs` and the action context).
- **Do NOT toggle service streams** — OSS run already has it false.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Trace id MUST match an ingested trace**, or the trace-details page renders
  "no result" and the arrival assertion on the tree fails. Ingest your own trace and
  reuse `traceIds[0]` — don't reuse global-setup's random ids.
- **Field name MUST be `trace_id`** (OSS org default). If the org setting were ever
  customized, the log field name must match `organizationSettings.trace_id_field_name`
  exactly — the gate reads it dynamically.
- **Wait for the value to be searchable** (`waitForFieldValueSearchable`) before driving
  the UI; freshly ingested records are not immediately queryable.
- **Drawer vs expanded emit asymmetry:** `DetailTable` emits `view-trace` with no payload
  (SearchResult resolves `hits[currentRowIndex]`); `JsonPreview` emits with the record.
  Both resolve to the same navigation, so either entry point is a valid test.
- **No traces streams ⇒ button hidden.** If the picker/button don't render, check that
  `getStreams("traces", false)` returned a non-empty list (i.e. the default traces
  stream exists) — this is the `tracesStreams.length` half of the render gate.
- **Assert arrival, not just URL.** `trace-details-tree-container` or
  `trace-details-loading-spinner` confirm `TraceDetails` is actually fetching; a bare URL
  match can pass even when the trace is missing.
