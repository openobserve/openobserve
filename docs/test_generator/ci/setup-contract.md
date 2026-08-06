# Test Setup Contract: Telemetry Correlation & Service Streams (area: GeneralTests)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Logs stream [shared/read-only]
- **`e2e_correlation_logs`** — a logs stream with dimension-rich records:
  - Fields must include: `service.name` (or `service_name`), `k8s_namespace_name`, `k8s_cluster_name`, `_timestamp`
  - Values: `service.name=correlation-test-svc`, `k8s_namespace_name=production`
  - Why: The `_correlate` API uses these dimensions to match services; the correlation dashboard displays correlated logs.

### Metrics streams [shared/read-only]
- **`e2e_correlation_metrics_cpu`** — an OTLP/metrics stream with:
  - Labels: `service.name=correlation-test-svc`, `k8s_namespace_name=production`
  - Metric type: gauge or counter, with `value` field
  - Why: Metrics tab sidebar shows grouped metric streams; dashboard renders time-series panels.

- **`e2e_correlation_metrics_memory`** — another metrics stream with same labels:
  - Labels: `service.name=correlation-test-svc`, `k8s_namespace_name=production`
  - Why: Tests multi-stream selection and grouped tabs in the metrics panel.

### Traces stream [shared/read-only]
- **`e2e_correlation_traces`** — an OTLP/traces stream with:
  - Span attributes: `service.name=correlation-test-svc`, `k8s_namespace_name=production`
  - At least 3 spans forming a distributed trace
  - Why: The traces tab shows correlated traces either as direct span view or dimension-based list.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest logs
```js
// Pattern from tests/ui-testing/pages/generalPages/ingestionPage.js:52
const ingestionUrl = getIngestionUrl(orgId, 'e2e_correlation_logs');
const payload = [
  {
    _timestamp: Date.now() * 1000,
    severity: 'info',
    body: 'Correlation test log entry',
    'service.name': 'correlation-test-svc',
    k8s_namespace_name: 'production',
    k8s_cluster_name: 'e2e-cluster',
    'trace_id': '0000_correlation_e2e',
  },
];
await sendRequest(page, ingestionUrl, payload, headers);
```

### Ingest metrics
```js
// Pattern from tests/ui-testing/playwright-tests/utils/metrics-ingestion.js:138
// OTLP metrics export JSON via /api/{orgId}/{streamName}/_json
await sendRequest(page, getIngestionUrl(orgId, 'e2e_correlation_metrics_cpu'), metricsPayload, headers);
```

### Ingest traces
```js
// Pattern from tests/ui-testing/playwright-tests/utils/trace-ingestion.js:151
// OTLP trace export JSON via /api/{orgId}/{streamName}/_json
await sendRequest(page, getIngestionUrl(orgId, 'e2e_correlation_traces'), tracesPayload, headers);
```

### Configure semantic groups (REQUIRED for correlation to work)
```js
// Pattern from tests/ui-testing/pages/generalPages/correlationSettingsPage.js:74
// PUT /api/{orgId}/alerts/deduplication/semantic-groups
await pm.correlationSettingsPage.ensureSemanticGroupsExist(orgId);
```

### Configure service identity (REQUIRED for service discovery)
```js
// PUT /api/{orgId}/service_streams/config/identity
const identityConfig = {
  sets: [
    { id: 'k8s', label: 'Kubernetes', distinguish_by: ['k8s-cluster', 'k8s-namespace'] },
  ],
  tracked_alias_ids: ['k8s-cluster', 'k8s-namespace'],
};
await page.request.put(
  `${process.env.ZO_BASE_URL}/api/${orgId}/service_streams/config/identity`,
  { data: identityConfig, headers: authHeaders },
);
```

### Auth / org
- ORGNAME=default; use `navigateToBase(page)` + `pm = new PageManager(page)` pattern from correlationSettings.spec.js:34.
- Auth headers for raw API calls: `const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')`.

### Timing
- After ingesting data, wait for the `_correlate` API to return streams. The service_streams backend processes data asynchronously. Allow 5-10s for batch processing.
- The correlation dashboard loads data lazily when a correlation tab is clicked — do NOT expect data to be pre-fetched.

## Preconditions / toggles
- **Enterprise feature gate**: The correlation `_correlate` endpoint requires enterprise. In OSS runs, correlation tabs may appear but data won't load.
- **Service identity must be configured** before correlation works. Without `distinguish_by` fields and tracked alias IDs, the backend can't match streams to services.
- **Semantic groups must exist** for dimension resolution. Use `ensureSemanticGroupsExist()`.
- **Data must have been ingested at least once** in the last few minutes. The batch processor must have processed the data into the service_streams table.
- Non-SQL mode is NOT required — correlation uses SQL internally but the user just clicks a correlation tab.

## Gotchas (so the Healer/Engineer don't rediscover them)
- The correlation feature is gated behind enterprise config flag `service_streams.enabled`. In pure OSS mode, the correlation API returns 403, but the UI may still render tabs. Tests must account for this.
- The `_correlate` API response includes `additional_dimensions` and `matched_set_id` only on the enterprise backend.
- Metric streams in the sidebar are grouped by category (Infra, Network, Others) using `groupMetricsByCategory()`. A stream without matching patterns goes to "Others".
- The "Service Identity Setup" settings page requires dimension analytics to have been computed. Without ingested data, it shows empty states.
- Traces correlation mode is either `'direct'` (traceId extracted from log) or `'dimension-based'` (matched by dimensions). Direct mode requires a `trace_id` field in the source log.
- The correlation dashboard has two rendering modes: `dialog` (full ODrawer) and `embedded-tabs` (inside DetailTable). Selectors differ between modes.
- `logs-correlation-loading-indicator` appears only inside DetailTable embedded mode, not the dialog mode.
