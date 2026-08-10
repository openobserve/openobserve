# Test Setup Contract: Service Correlation  (area: Correlation)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Log stream with service + dimension fields **[shared/read-only]**
- `corr_logs_svc` (or similar unique name) — fields: `service`, `k8s_cluster`, `environment`, `message`
- Why: All drawer/embedded-tab tests read this to trigger correlation from a log row. The `service` field is used for service-name matching; `k8s_cluster` and `environment` are matched dimensions.
- Ingest at least 2 rows with different cluster values (e.g. `C1-East`, `C2-West`) so the dimension-filter OSelect has options to switch between.

### Second log stream with alias-divergent field names **[shared/read-only]**
- `corr_logs_alias` — fields: `service`, `cluster` (NOT `k8s_cluster`), `message`
- Why: Exercises F35 — the backend returns per-stream field-name aliases; the UI must query each stream with its own spelling.

### Metrics stream for service **[shared/read-only]**
- `corr_metrics_cpu` — labels: `service`=esvc, `k8s_cluster`=C1-East, `__name__`=cpu_usage
- Why: Metrics tab renders when the correlated service has a metrics stream; sidebar metric-stream selection drives dashboard panel generation.

### Trace stream for service (optional, for traces tab) **[per-test: TC-traces]**
- OTLP trace ingest with `service.name`=esvc and `k8s_cluster`=C1-East
- Why: Traces tab renders when the correlated service has a traces stream; direct trace-correlation extracts `trace_id` from log records.

### No-service-empty-fallback stream **[per-test: TC-empty]**
- `corr_empty` — fields WITHOUT `service` and WITHOUT any semantic-group dimension
- Why: Exercises the "no matching service" empty state (200-null from API).

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest helper (API-level pattern)
Use `CorrApi` from the existing test utility:
```js
const { CorrApi } = require("./utils/correlationApi");
```
See `tests/ui-testing/playwright-tests/Correlation/ui-E-drawer.ui.spec.js:7`.

Example ingest pattern:
```js
api = await CorrApi.create("corr_ui_svc");
await api.ingestLogs("corr_logs_svc", [
  { service: "esvc", k8s_cluster: "C1-East", environment: "Prod-EU", message: "log-1" },
  { service: "esvc", k8s_cluster: "C2-West", environment: "Prod-EU", message: "log-2" },
]);
await api.ingestMetrics([
  { __name__: "cpu_usage", service: "esvc", k8s_cluster: "C1-East" },
]);
await api.ingestTraces("esvc", { k8s_cluster: "C1-East" });
```
See `tests/ui-testing/playwright-tests/Correlation/ui-E-drawer.ui.spec.js:46-78`.

### Identity config pattern
```js
await api.saveIdentity({
  sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster", "environment"] }],
  tracked_alias_ids: ["k8s-cluster", "environment"],
  service_optional: false,
});
```
See `tests/ui-testing/playwright-tests/Correlation/ui-E-drawer.ui.spec.js:28-42`.

### Discovery polling (wait for backend to discover services)
```js
await api.waitForServices(
  (r) => r.some((row) => row.service_name === "esvc"),
  "esvc discovered",
);
```
See `tests/ui-testing/playwright-tests/Correlation/ui-E-drawer.ui.spec.js:79-89`.

### Auth / login (browser-side)
```js
const { login } = require("./utils/corrUi");
await login(page);
```
See `tests/ui-testing/playwright-tests/Correlation/ui-E-drawer.ui.spec.js:8,97`.

### Navigate to logs and open correlation
```js
const { openLogsAndQuery, openFirstRowDialog } = require("./utils/corrUi");
await openLogsAndQuery(page, api.org, "corr_logs_svc");
await openFirstRowDialog(page);
// Then click correlated-logs-tab or correlated-metrics-tab
```
See `tests/ui-testing/playwright-tests/Correlation/ui-E-drawer.ui.spec.js:98-100`.

### Sniff correlation traffic
```js
const { sniff, waitFor } = require("./utils/corrUi");
const traffic = sniff(page);
```
See `tests/ui-testing/playwright-tests/Correlation/ui-E-drawer.ui.spec.js:12,96`.

### Org/stream naming
- Org: unique per spec (e.g. `corr_svc_` + Date.now + random) — `CorrApi.create()` handles this.
- Streams: descriptive, underscore-only, lowercase.

## Preconditions / toggles

- **Quick mode MUST be OFF** — `ensureQuickModeOff(page)` in `corrUi.js:70-133`. Quick mode starves dimension extraction; correlation sees no dimensions at all. Assert `select *` queries (not `select _timestamp`) before clicking rows.
- **Non-SQL mode** — Not applicable for correlation; it uses its own query generation.
- **Semantic groups** — Must exist on the org before correlation works. The backend ships with built-in groups (service, k8s-cluster, etc.). The `CorrApi.create()` helper creates a fresh org which inherits default built-in groups.
- **Identity config** — Must be saved before correlation can match services. See pattern above.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Discovery latency**: After ingestion, services take time to be discovered (WAL flush cadence). Always poll with `api.waitForServices()` with the full deadline.
- **Dimension-filter editing is UNREACHABLE from the logs detail drawer**: `DetailTable.vue` always passes `hide-dimension-filters="true"`. The editable filter bar only exists in the FULL correlation dashboard dialog (opened by `[data-test="log-correlation-btn"]` from inline-expanded row → JsonPreview), which is a separate code path.
- **Stream schema arrives async**: After ingestion, metric stream schemas may not be immediately available. The `generateDashboard()` call waits for schemas via `fetchMetricSchemas()`. Tests should allow time for dashboard panels to render.
- **F1 wire contract**: SQL queries must carry RAW case values from the log record. Never lowercased predicates on the wire. Verify with `traffic.searchBodies`.
- **F35 alias-divergent streams**: When two log streams use different field names for the same semantic group (e.g. `k8s_cluster` vs `cluster`), updating a dimension filter must update BOTH streams' queries using each stream's own field-name alias.
