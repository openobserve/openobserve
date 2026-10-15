# Test Setup Contract: Service Graph Side Panel (non-modal drawer)  (area: Traces)

> Read by the **Engineer** (implements setup), the **Healer** and the **Refiner** (consult instead
> of blind-scanning when a data/setup failure appears). All patterns below are copied from existing
> specs/pages — do NOT invent new setup.

## Critical edition note (read first)
The **Service Graph** entry point is enterprise-gated: the topology endpoint
`/api/{org}/traces/service_graph/topology/current` is `#[cfg(feature = "enterprise")]`
(`src/api/http/src/handler/http/router/mod.rs:1549,1597`). In the OSS CI run it 404s and the graph
renders "No service graph data" (no nodes to click). **Drive the side panel via Services Catalog**,
which is OSS-reachable and reuses the pre-seeded `default` traces stream — the same non-modal drawer
(`ServiceGraphNodeSidePanel` + `ODrawer`) is exercised either way.

## Streams / data the spec must establish

- **`default` traces stream `[shared/read-only]`** — the CI environment is already pre-seeded with
  OTLP service spans (this is the same stream `service-catalog.spec.js` relies on with
  "no beforeAll ingestion"). Fields present must include `service_name`, `operation_name`,
  `span_status`, `duration`, and ideally `service_k8s_pod_name` / `service_k8s_node_name`
  (which generate the Pods/Nodes resource tabs). Why: Services Catalog rows + the side panel's
  RED charts, Operations table, resource tabs, and Metrics tab all query this stream.

- **If the environment is NOT pre-seeded (empty default stream), establish it with the existing
  trace generator** `[shared/read-only, one-time]`:
  `generateFullTopology({ tracesPerFlow: 3, errorRate: 0.2 })` → `ingestTraces(page, traces, { delayMs: 50 })`,
  then poll `waitForServiceGraphData(page, { maxWaitMs: 240000, pollIntervalMs: 10000, expectedMinEdges: 5 })`.
  These are exported from `tests/ui-testing/playwright-tests/utils/service-graph-ingestion.js`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Navigation (Services Catalog)**: `await pm.servicesCatalogPage.navigate('7d')` then
  `await pm.servicesCatalogPage.waitForLoad()` — see `tests/ui-testing/playwright-tests/Traces/service-catalog.spec.js:29-30`.
  `navigate` targets `${ZO_BASE_URL}/web/traces/services?org_identifier=${ORGNAME}&period=7d`
  (`servicesCatalogPage.js:160-172`).
- **Open the side panel**: click a service row — `pm.servicesCatalogPage.getServiceLink(name)` /
  `firstServiceLink` (row selector prefix `services-catalog-row-name-<name>`). Opening sets
  `selectedServiceRow` + `showSidePanel` (`ServicesCatalog.vue:1054-1062`). Assert with
  `pm.servicesCatalogPage.expectSidePanelVisible()` (waits on `[data-test="service-graph-side-panel"]`).
  If you need the Service Graph path (enterprise builds only), reuse
  `pm.serviceGraphPage.navigateToServiceGraphUrl()` + `clickNodeByName(name)` +
  `expectSidePanelVisible()` — see `Traces/service-graph.spec.js:153-160`.
- **Ingestion (only if default stream is empty)**:
  - Spec-level: `tests/ui-testing/playwright-tests/utils/ingest-service-graph.spec.js` (Playwright
    wrapper that resolves org+passcode from the live session and ingests).
  - Or standalone: `tests/ui-testing/scripts/ingest-service-graph.js` (Node, reads `.env`).
  - The canonical helper call: `ingestTraces(page, generateFullTopology(...), { delayMs: 50 })` —
    see `Traces/service-graph.spec.js:39`.
- **Auth/org**: `ORGNAME` (default `default`); the worker's auth state comes from
  `tests/ui-testing/playwright-tests/utils/auth/user.json` (the enhanced-baseFixtures context) and
  `navigateToBase(page)` (`enhanced-baseFixtures.js:161`). API auth headers via
  `getAuthHeaders()` in `utils/cloud-auth.js` (Basic `email:passcode` on cloud, `email:password`
  self-hosted).

## Preconditions / toggles

- A **concrete stream must be selected** — the panel's RED charts / tabs / tables are all
  `v-if="streamFilter !== 'all'"`. Services Catalog sets this from `resolveTraceStream(...)`
  (`ServicesCatalog.vue:1084`), so no explicit toggle is needed on that path.
- Non-SQL mode / other global toggles are not required by this panel.

## Timing / wait guidance (Healer + Engineer)

- The Services Catalog table arrives via streaming search — wait for the table/toolbar, not a fixed
  sleep: `pm.servicesCatalogPage.waitForLoad()`.
- The side panel fetches RED charts / operations / resource-tab data **after** it opens
  (`ServiceGraphNodeSidePanel.vue` watchers at 1483, 2146, 2320). Wait for the section content:
  `[data-test="service-graph-side-panel-red-charts"]` and
  `[data-test="service-graph-side-panel-operations-table"]`, then the table rows.
- Operations table empty-vs-loading: gate row assertions on the table, not a sleep.
  `pm.serviceGraphPage.getOperationsTableRowCount()` already waits for the loading indicator to hide.
- Resource tab ids are **dynamic** (derived from OTEL fields, e.g. `k8s-pod-name`, `k8s-node-name`).
  Discover them with `pm.serviceGraphPage.getResourceTabIds()` — never hardcode `pods`/`nodes`.
- Metrics tab: the panel wrapper's `data-test` is swallowed by `<Transition>` and the dashboard's is
  dropped by the fragment root — race the content hooks (`metrics-loading` / `metrics-error` /
  `metrics-empty` / `correlation-event-header-*`), exactly as `clickMetricsTabAndWait()` does
  (`serviceGraphPage.js:444-461`).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Do NOT assert "metric streams present"** — this env seeds only traces, so the Metrics tab
  commonly resolves to empty/zero-stream. The smoke check is "tab resolves without hanging".
- **Outside-click must NOT close the panel** (that's the point of the change) — so a test that
  clicks outside and expects dismissal is asserting the OLD modal behaviour and will fail by design.
- `data-test="service-graph-side-panel"` is on `DialogContent` (ODrawer forwards the consumer's
  `data-test`); the parent's `services-catalog-node-side-panel` data-test is **overridden** by Vue
  attribute inheritance. Use the panel's own `data-test`.
- The `default` stream may already exist with data from a prior shard — prefer the read-only path
  (no ingestion) and only fall back to ingestion if the catalog renders an empty state.
