# Test Setup Contract: Alerts Anomaly Detection  (area: Alerts)

> **Edition reality (read first):** the feature is enterprise-gated. In OSS the backend returns
> `anomaly_detection_enabled = false` (`src/api/management/src/request/status/mod.rs:474`) and the
> list tab / alert-type option never render, so the spec's `beforeEach` skips every test
> (`alerts-anomaly-detection.spec.js:76`). The setup below is only actually exercised on an
> enterprise build (the spec is registered in `o2-enterprise/tests/ui-testing/ci-matrix/ci_matrix.ent.json`).
> The Engineer must NOT invent a way to force the feature on in OSS — the honest OSS outcome is skip.

## Streams / data the spec must establish

All helpers live in `tests/ui-testing/playwright-tests/utils/api-helper.js`. Reference them by
exact name — do not re-implement ingestion/setup.

- **`e2e_automate`** **[shared/read-only]** — the pre-seeded stream used by every UI-only test
  (form validation, sensitivity, builder mode, data preview, alerting config). Fields include
  `log`, `level`, `job`, `kubernetes_namespace_name` (the builder filter test selects
  `kubernetes_namespace_name`). Why: most tests only READ it; none mutate it.
- **`<unique>` seeded anomaly stream** (`anomaly_e2e_<randomValue>`) **[per-test: End-to-end detection]** —
  fields: `_timestamp`, `level`, `job`, `log`. Why: training needs history; the shared
  `e2e_automate` stream is all stamped "now" and cannot train a model.
- **`_anomalies`** **[system stream, read-only]** — the reserved stream detection runs write one
  row per scored bucket to; the detection charts + `searchSql` verification read it. No test creates
  it. The chart component probes its schema for the opt-in kind columns (`is_absence`,
  `is_partial_drop`, `expected_value`).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Destination (required before the Add button enables):**
  `createMockDestination(page, prerequisiteDestinationName, prerequisiteTemplateName)` —
  `api-helper.js:78`. The template must exist first:
  `pm.alertTemplatesPage.ensureTemplateExists(prerequisiteTemplateName)` (driven in `beforeEach`,
  `alerts-anomaly-detection.spec.js:51`). Default webhook URL is `https://example.com/webhook`
  (IANA-reserved, public IP so the SSRF guard accepts it). For the delivery assertion, point it at
  the in-test loopback receiver: `createMockDestination(page, sinkName, templateName, { url: 'http://127.0.0.1:<port>/anomaly' })` (requires `ZO_SSRF_ALLOW_LOOPBACK`; only CI).
  Assert existence, not a status code — re-creates return 400 "already exists":
  `expect(await destinationExists(page, name)).toBe(true)` (`api-helper.js:121`).
- **Seeded anomaly stream (end-to-end only):**
  `seedAnomalyStream(page, seededStream, { hours: 4, bucketSeconds: 60, baseline: 10, spikeValue: 120, spikeBuckets: 4, spikeOffset: 70 })`
  → then `waitForStream(page, seededStream)` (`api-helper.js:135` and `:174`).
  Notes baked into the helper: keep the seed inside `ZO_INGEST_ALLOWED_UPTO` (~5h in CI) and the
  bucket width at 60s so 4h yields ~240 points (> the ~100 the model needs); `spikeOffset: 70`
  keeps the spike clear of the held-out calibration tail (`compute_threshold_held_out`).
- **Anomaly config via API (lifecycle / chart tests — the "own record" pattern):**
  `createAnomalyViaApi(page, name, { streamName: 'e2e_automate', destinations: [], threshold: 97, histogramInterval: '5m' })`
  → `waitForAnomalyListed(page, name)` → `page.reload()` → re-navigate to the anomaly tab →
  `searchAnomaly(name)` (`api-helper.js:194` and `:239`; the reload is required because the list is
  fetched once on tab mount).
- **Training / detection via API (no UI completion signal):**
  `triggerAnomalyTraining(page, id)` (`POST /api/{org}/anomaly_detection/{id}/train`) →
  `waitForAnomalyTrained(page, id)` polls until `res.data.is_trained` (`api-helper.js:250`, `:256`);
  `triggerAnomalyDetection(page, id)` (`api-helper.js:308`); `getAnomalyHistory(page, id)` returns a
  bare array (the handler's `DetectionHistoryResponse` utoipa annotation does NOT match reality).
- **Chart SQL verification:** `searchSql(page, sql, sinceSeconds)` →
  `POST /api/{org}/_search?type=logs` (`api-helper.js:110`).
- **Auth/org:** helpers read `ORGNAME` / `ZO_BASE_URL` / `ZO_ROOT_USER_EMAIL` /
  `ZO_ROOT_USER_PASSWORD` env vars via `getOrgName()` and the shared `apiCall`; the page-level flow
  uses the worker auth state via `navigateToBase(page)`.

## Preconditions / toggles

- **Feature flag:** the anomaly tab must be visible (`pm.anomalyDetectionPage.isAnomalyDetectionAvailable()`)
  before any test proceeds; `beforeEach` already gates on it and skips otherwise.
- **Destination count:** the list Add button is disabled while the org has zero destinations — the
  `beforeEach` must create the prerequisite destination BEFORE any wizard test opens.
- **Stream-list cache:** the wizard caches streams at page load; a stream seeded after page load is
  absent from the picker until `page.reload()` (see the end-to-end test's reload before opening the
  wizard).

## Gotchas (so the Healer/Engineer don't rediscover them)

- The anomaly tab presence check must NOT read `?tab=` — `AlertList` coerces `activeTab` back to
  "all" on fallback but leaves the query param, so the URL always lies. The rendered tab
  (`[data-test="alert-list-tab-anomalyDetection"]`) is the only honest signal.
- OSelect options are virtualized: type into the search (`-search` input) to surface an option; an
  option outside the rendered window is absent from the DOM entirely.
- `OFormInput` renders the real `<input>` behind a `-field` suffix; fill that inner input.
- The name field is `OFormInlineEdit`: click `-trigger`, fill `-input`, then **blur** (Enter also
  submits the owning form and runs a premature save).
- Custom-SQL (Monaco) requires focus before select-all; the helper clears until verifiably empty,
  because a missed clear types the new SQL in FRONT of the seeded default and the save dies on a
  parser error. The mode switch seeds a default query, so the "empty SQL" test must explicitly clear.
- The sensitivity tier control is revamp-only; `selectSensitivityTier` falls back gracefully on
  builds without it — do not hard-fail when the tier items are absent.
- Destinations is a searchable multi-select whose popover stays open between picks; filter each name
  in turn, then Escape.
- Error toasts live 30s and stack over the wizard footer (intercepting Cancel clicks) — dismiss them
  before cancelling (`pm.anomalyDetectionPage.dismissToasts()`).
- Cleanup must scope to the worker's `randomValue` suffix (not the shared `E2E_Anomaly` prefix), or a
  worker finishing early wipes another worker's fixtures. Destination is deleted LAST (it cannot be
  removed while an anomaly still points at it).
