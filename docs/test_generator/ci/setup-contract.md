# Test Setup Contract: RUM Trace Time Range (Indexed Trace Window)  (area: Traces)

Spec: `tests/ui-testing/playwright-tests/Traces/rumTraceTimeRange.spec.js`

This feature is only observable when **RUM events carry a trace_id** AND **a matching trace exists in a traces
stream**. The single hardest precondition is producing a `_rumdata` row whose `_o2_trace_id` (or `_oo_trace_id`)
equals a 32-char padded trace id that is ALSO ingested as an OTLP trace into a traces stream, with timestamps that
fall inside the indexed lookup window. The existing ingestion helpers below already do ~95% of this; the only
genuinely new bit is **reusing one trace id across both the RUM `_json` and the OTLP `/v1/traces` ingest**.

---

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### RUM events stream
- `_rumdata` **[shared/read-only]** — fields needed: `session_id` (string), `date` (ms, epoch),
  `type` (e.g. `"action"`), `action_id` (string), `view_id`/`view_url` (optional, for view-context columns),
  and **`_o2_trace_id`** (string, 32-char hex — use `_o2_`; it is the preferred spelling and is read first).
  Why: `PlayerTracesTab.fetchTraces` groups `_rumdata` by trace_id for the session
  (`PlayerTracesTab.vue:483-502`); `EventDetailDrawerContent.fetchRelatedResources` links action→related rows
  by `action_id` (`EventDetailDrawerContent.vue:558-588`).
  **A second action row is needed that shares the SAME `action_id` but carries the `_o2_trace_id`** — that is
  the row that renders the `view-trace-btn` (Workflow 2).

### Traces stream
- `default` (OTLP default) **[shared/read-only]** — the traces stream. Ingest one OTLP trace whose `traceId`
  equals the exact `_o2_trace_id` above. Why: `RUM_CORRELATION_TRACES_STREAM = "default"` (`fields.ts:134`);
  discovery resolves the trace to `default` and returns its indexed `range`.

### Session replay stream (to open the session viewer)
- `_sessionreplay` **[shared/read-only, optional]** — one row with `session_id` = the same id, plus
  `start_time`/`end_time` (ms). Why: `SessionViewer.getSession()` (`SessionViewer.vue:325-367`) derives
  `startTime`/`endTime` props for `PlayerTracesTab` from `_sessionreplay`. **Without it**, `startTime`/`endTime`
  are `0` and `fetchTraces` falls back to a 24h window (`PlayerTracesTab.vue:457-458`) — the traces tab still
  works, but the lookup window is "now - 24h", so the trace's timestamps MUST be within the last 24h either way.

> Simplest navigation: go DIRECTLY to `/web/rum/sessions/view/{session_id}?org_identifier=default` (see
> `rumSessionsPage.gotoSessionsList`/`expectSessionViewerFor`, `rumSessionsPage.js:19-53`) — this skips the
> Sessions-list `session_has_replay` filter entirely. Then click `[data-test="tab-traces"]`.

---

## How to create it (copy these EXACT patterns — do NOT invent setup)

### RUM `_rumdata` ingest (copy `rum-error-ingestion.js` endpoint, add `_o2_trace_id`)
Reference: `tests/ui-testing/playwright-tests/utils/rum-error-ingestion.js:196-203` — `POST
${baseUrl}/api/${orgId}/_rumdata/_json` with Basic auth. Build a record shaped like that file's
`generateRumErrors` output but with the trace field + session linkage:

```js
// ONE action row (the event clicked in the sidebar) + ONE related row sharing action_id + the trace id
const TRACE_ID = /* 32-char padded hex, e.g. '0'.repeat(?) — generate via crypto.randomBytes(16).toString('hex') */
const SESSION_ID = `e2e-rum-trace-${Date.now()}`;
const ACTION_ID = `e2e-action-${Date.now()}`;
const now = Date.now(); // ms
const records = [
  { date: now, type: 'action', action_id: ACTION_ID, action_type: 'click',
    session_id: SESSION_ID, service: 'e2e-rum-trace-test', version: '1.0.0-e2e' },
  { date: now, type: 'resource', action_id: ACTION_ID,
    resource_url: 'http://localhost/checkout', resource_method: 'GET',
    resource_duration: 100000000, resource_status_code: 200,
    session_id: SESSION_ID, service: 'e2e-rum-trace-test', version: '1.0.0-e2e',
    _o2_trace_id: TRACE_ID },   // ← the field that powers the whole feature
];
await page.request.post(`${BASE}/api/${ORG}/_rumdata/_json`, {
  headers: { Authorization: basicAuthHeader(email, password), 'Content-Type': 'application/json' },
  data: records,
});
```
- Auth/org context: reuse `rumTestContext()` + `basicAuthHeader()` from
  `tests/ui-testing/playwright-tests/utils/rum-env.js` (same as `rum-error-ingestion.js:21-22`); `ORG=default`.

### Traces ingest (copy `correlation-api-helpers.js` shape, but with a CONTROLLED traceId)
Reference: `tests/ui-testing/playwright-tests/utils/correlation-api-helpers.js:189-240` (`ingestTraces` posts to
`POST /api/{org}/v1/traces`). The existing helpers generate a RANDOM traceId
(`trace-ingestion.js:40`, `correlation-api-helpers.js:191-192`), so the Engineer must write a ~15-line variant
where `traceId = TRACE_ID` (the same id as `_o2_trace_id`) and the span `startTimeUnixNano`/`endTimeUnixNano` sit
within a few minutes of `now`. Base shape (single parent span is enough):

```js
const nowNs = BigInt(Date.now()) * 1_000_000n;
const data = {
  resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'checkout-svc' } }] },
    scopeSpans: [{ scope: { name: 'e2e' }, spans: [{
      traceId: TRACE_ID, spanId: /* 16 hex */, name: 'checkout-op', kind: 2,
      startTimeUnixNano: String(nowNs - 5_000_000n), endTimeUnixNano: String(nowNs),
      attributes: [], status: {} }] }] }],
};
await page.request.post(`${BASE}/api/${ORG}/v1/traces`, { headers, data }); // 200 or 206 = ok
```
- OTLP returns **200 on full success and 206 on partial** (`sdrTracesIngestionPage.js:114`).

### Verify data is searchable BEFORE asserting UI (copy `rum-stream-verify.js`)
Reference: `tests/ui-testing/playwright-tests/utils/rum-stream-verify.js:53-66` — `waitForStreamRows`:
```js
await waitForStreamRows(page, {
  sql: `SELECT * FROM "_rumdata" WHERE session_id = '${SESSION_ID}' AND _o2_trace_id = '${TRACE_ID}'`,
  minRows: 1, timeoutMs: 45000,
});
```
- **Timing / gotcha (critical):** the trace time index stream (`trace_time_index_default`) is seeded async on
  ingestion, and the `traces/time_range` lookup is anchored by `hint_ts = <RUM date> × 1000` µs
  (`useCorrelatedTracesStream.ts:136`). If the lookup fires before the index (or before the WAL flush moves the
  spans into the index), the response is `partial_coverage`/`not_found` and the frontend falls back to the probe
  (stream without range). **Wait for BOTH** the `_rumdata` row AND a `traces/time_range` hit that returns
  `status: "found"` with a `range` before asserting the indexed-window behavior:
  ```js
  // poll GET /api/{org}/traces/time_range?trace_id={TRACE_ID}&start_time=..&end_time=..&hint_ts=..
  // until data.results[0]?.status === 'found' && data.results[0]?.range
  ```

---

## Preconditions / toggles

- `ZO_TRACE_TIME_INDEX_ENABLED` must be **true** (it is the default; do NOT set it false). If the environment
  disables it, every lookup returns `partial_coverage` with no range and the feature degrades to the pre-existing
  guess-window — the indexed-window assertions would fail for an environment reason, not a product reason.
- No SQL-mode / quick-mode concerns here: the RUM surfaces build raw SQL directly and are not affected by the
  logs quick-mode toggle.
- The session viewer's `startTime`/`endTime` come from `_sessionreplay` (`SessionViewer.vue:325-367`); if you
  don't seed `_sessionreplay`, the 24h fallback window applies and trace timestamps must be within the last 24h.

---

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Units are NOT uniform** — this is the #1 cause of a silent "no range / trace not found":
  - RUM `_rumdata.date` = **milliseconds** (the feature multiplies by 1000 to µs).
  - OTLP span `startTimeUnixNano`/`endTimeUnixNano` = **nanoseconds**.
  - `traces/time_range` query params + `TraceTimeRange.start_time/end_time` = **microseconds**.
  So the trace's span (ns) must land inside the µs window derived from the RUM `date` (ms × 1000) ± the probe
  buffer. Keep the RUM `date` and the OTLP span timestamps within a few minutes of each other.
- **The trace id must be the padded 32-char hex form.** `normalizeTraceId` zero-pads short ids, and the traces
  stream stores the padded form (`fields.ts:146-152`). Generate with `crypto.randomBytes(16).toString('hex')`
  (always 32 chars) and reuse the exact string in both the RUM `_o2_trace_id` and the OTLP `traceId`.
- **The `view-trace-btn` only appears on a RELATED resource with a trace_id** (`EventDetailDrawerContent.vue:322-334`),
  and related resources are fetched only for `action` events (`:594`). To exercise Workflow 2 you need an `action`
  event (clicked in the sidebar) whose `action_id` matches a second `_rumdata` row carrying `_o2_trace_id`.
- **The Traces tab empty state is legitimate** when `_rumdata` has no trace_id column — the query is schema-guarded
  (`PlayerTracesTab.vue:466-471`). If `_o2_trace_id` isn't in the `_rumdata` schema yet (first-ever ingest), the
  schema may take a moment to hydrate; wait for the field to be searchable (gotcha above) before asserting the list.
- **Trace metadata fetch filters out traces with no backend rows** (`PlayerTracesTab.vue:590-591`): a trace_id that
  exists in `_rumdata` but not in the traces stream will NOT appear in the table. Seed the trace first.

---

## Reference file:line index (for the Engineer/Healer)

- RUM `_json` ingest endpoint + auth: `tests/ui-testing/playwright-tests/utils/rum-error-ingestion.js:196-203`
  (+ `rum-env.js` `rumTestContext`/`basicAuthHeader`).
- OTLP `/v1/traces` ingest shape: `tests/ui-testing/playwright-tests/utils/correlation-api-helpers.js:189-240`;
  random-id generator to REPLACE with a controlled id: `trace-ingestion.js:38-46`.
- Search/poll for rows: `tests/ui-testing/playwright-tests/utils/rum-stream-verify.js:53-66`.
- Session viewer navigation: `tests/ui-testing/pages/rumPages/rumSessionsPage.js:19-53`.
- Indexed-range endpoint contract (frontend): `web/src/ts/interfaces/traces/traceTimeRange.types.ts:35-66`.
