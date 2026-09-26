# Test Setup Contract: Prometheus Exemplars  (area: Dashboards)

> Concrete data/state requirements for the exemplars E2E suite, with the EXACT existing helpers to
> establish each. The fixture module below already exists and is the single source of truth — do
> NOT invent a new ingest path.

## Streams / data the spec must establish

All fixtures are **self-ingested per spec run** so request-count assertions see only that suite. A
fresh `PREFIX` per run keeps marker counts exact even when a data dir is reused.

- **`<PREFIX>_latency_seconds`** (histogram, unit `s`) **[shared/read-only]** — fields: cumulative
  histogram buckets (`le` 0.1/0.25/0.5, `+Inf`) with an `exemplars[]` array per datapoint carrying
  `traceId`/`spanId` and `filteredAttributes` (`http_route=/pay`). Why: drives the `histogram_quantile`
  p99/p50 queries that render markers (`P99`/`P50`).
- **`<PREFIX>_requests_total`** (sum, monotonic counter) **[shared/read-only]** — carries exemplars with
  `pod=api-0`. Why: the distinct/independent second query for the two-query panel tests.
- **`<PREFIX>_empty_seconds`** (histogram, same shape but `exemplars: []`) **[shared/read-only]** — Why:
  exercises the `empty` badge (no in-window exemplars).
- **Traces** — every OTHER exemplar's trace is ingested as a real OTLP span (`ingestTrace = i % 2 === 0`),
  so half resolve to `found` and half to `not_available`. **[shared/read-only]** Why: hover/click/nav and
  the not-available card tests.

> Tag each item by SCOPE so the Engineer puts it in the right place:
> - `[shared/read-only]` — every test just READS it → set up ONCE in `beforeAll`.
> - `[per-test]` — one test mutates/needs a unique variant → build inside that test with a fresh id.
> All four streams above are `[shared/read-only]` and created once per spec in `beforeAll`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest metrics + traces:** `await ingestExemplarFixtures(RUN, 32)` from
  `tests/ui-testing/playwright-tests/utils/exemplar-fixtures.js:108` — POSTs `/v1/metrics` and
  `/v1/traces` with OTLP payloads (`histogramPayload`, `tracesPayload`).
- **Wait for exemplar queryability (async ingest):** `await waitForExemplars(RUN)` from
  `exemplar-fixtures.js:118` — polls `query_exemplars` until data returns (60 s deadline). The feature's
  resolver reads the ingested exemplars; querying before they hydrate returns empty.
- **Build a dashboard:** `panel(id, {type, queries, showExemplars, unit, unitCustom})` +
  `createExemplarDashboard(title, panels)` from `exemplar-fixtures.js:135,154` — POSTs
  `/dashboards?folder=default` (v8). Set `showExemplars: true` for always-on panels, or omit it to
  test the header-toggle path.
- **Query strings (fixture-derived):**
  - `P99 = histogram_quantile(0.99, sum by (le) (rate(${HIST}_bucket[5m])))`
  - `P50 = histogram_quantile(0.5, sum by (le) (rate(${HIST}_bucket[5m])))`
  - `COUNTER_RATE = sum(rate(${COUNTER}[5m]))`
  - `COUNT_RATE = sum(rate(${HIST}_count[5m]))` (line-mode placement)
  - `SPARSE = histogram_quantile(0.99, sum by (le) (rate(${SPARSE}_bucket[5m])))` (empty)
- **Auth/org:** `ORG = process.env.ORGNAME || 'default'`; auth headers via
  `getAuthHeaders()`/`getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`.
  Dashboard URL: `/web/dashboards/view?org_identifier=${ORG}&dashboard=${id}&folder=default&period=30m`.
- **Open the dashboard / wait for chart:** `openDashboard(page, id)` + `waitForChart(page, panelId)`
  from `dashboard-exemplars.spec.js:39-47` (waits for `[_echarts_instance_]` inside the panel container).
- **Marker pixel read:** `markerPoint(page, panelId, index)` from `dashboard-exemplars.spec.js:56` —
  reads `data-x-px`/`data-y-px` from the hidden marker list, polls until two reads agree (positions are
  recomputed each paint), then adds the chart's `boundingBox()` offset.
- **Request counting:** `requestLog(page)` from `exemplar-fixtures.js:187` — records `query_exemplars`,
  `query_range`, and `traces/time_range` URLs; `.exemplars()`, `.traceLookups()`, `.ranges()`.
- **Cleanup:** `deleteDashboard(id)` + `deleteRunStreams(RUN)` in `afterAll`
  (`exemplar-fixtures.js:171,181`).

## Preconditions / toggles

- **Non-SQL mode / PromQL panels** — panels are built with `queryType: 'promql'` and a `range` query
  (the fixture `panel()` helper already sets `query_type: 'range'`). Do not use `instant` queries for
  marker rendering (they are excluded by `exemplarEligibility`).
- **Override persistence** — header toggles write
  `sessionStorage` key `o2.exemplars.${org}.${dashboardId}.${panelId}` (`1`/`0`). Assert it via
  `page.evaluate(([org,d]) => sessionStorage.getItem(...))`.
- **Explorer only** — `pm.metricsExplorerPage.gotoExplorer()`, then
  `[data-test="metrics-explorer-search"] input` filled with `PREFIX`; the histogram card name is
  `${HIST}_bucket` (`CARD = ${HIST}_bucket`). Clear `sessionStorage` in `beforeEach` for explorer tests
  (override keys are scoped `o2.exemplars.${org}.metrics-explorer.${name}`).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Async ingest** — always `waitForExemplars(RUN)` after `ingestExemplarFixtures` before any assertion;
  the marker count is otherwise 0.
- **Marker positions recompute every chart paint** — poll until two `data-x-px,data-y-px` reads agree
  before hovering/clicking (`markerPoint`).
- **Hover dwell is 200 ms** — moving onto a marker does NOT immediately run the trace lookup; wait for
  `data-trace-state` to leave `checking` (poll with timeout ≥ the 8 s lookup cap).
- **Not-available card is viewport-clamped and self-scrolling** — assert `scrollWidth <= clientWidth` and
  the box stays within the viewport, don't assert exact coordinates.
- **Only the toggled card/explicit on-panels fetch** — off panels must send zero `query_exemplars`
  (`requestLog().exemplars()` length 0); the two-query panel sends one request per range query (2).
- **`dashboard-panel-exemplar-series-labels` and `dashboard-panel-exemplar-label-span_id` never render**
  — these are asserted at `toHaveCount(0)` by design (series labels are not shown; `span_id`/`trace_id`
  are excluded from label rows).
- **Editor path** — an API-built panel's query fields are normalized on editor open, so the preview starts
  "not up to date"; click `dashboard-apply` first, then toggle `dashboard-config-show-exemplars` and save.
- **500 simulation** — `page.route('**/prometheus/api/v1/query_exemplars**', route => route.fulfill({status:500,...}))`
  and `page.unroute(...)` after; the series must still render (`no-data` absent, no toast).
