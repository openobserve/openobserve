# Test Setup Contract: Traces Service Graph & Services as Standalone Routes
(area: Traces)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### For Service Graph tests (enterprise-only)

- **`default`** [shared/read-only] — traces stream with 17+ services forming an e-commerce topology.
  Fields: `service_name`, `operation_name`, `trace_id`, `span_id`, `parent_span_id`, `duration`,
  `span_status`, `span_kind`, `start_time`, `end_time`, `service_k8s_node_name`,
  `service_k8s_pod_name`, `infer_service_name`.
  Why: every graph test reads the topology API to verify nodes/edges, clicks nodes for side-panels
  with RED charts / operations / PODs, exercises search filter, view switching, and
  telemetry correlation.

  **EXACT SETUP — do not invent:**

  ```js
  const {
    generateFullTopology,
    generateAllEdgeCases,
    ingestTraces,
    waitForServiceGraphData,
    getTopology,
  } = require('../utils/service-graph-ingestion.js');

  // In beforeAll (long timeout — 240s daemon wait):
  const fullTraces = generateFullTopology({ tracesPerFlow: 3, errorRate: 0.2 });
  const edgeCaseTraces = generateAllEdgeCases();
  const allTraces = [...fullTraces, ...edgeCaseTraces];
  await ingestTraces(page, allTraces, { delayMs: 50 });
  await waitForServiceGraphData(page, { maxWaitMs: 240000, pollIntervalMs: 10000, expectedMinEdges: 10 });
  // verify: await getTopology(page);
  ```

  Reference: `tests/ui-testing/playwright-tests/Traces/service-graph.spec.js:21-68`

### For Services Catalog tests (OSS + enterprise)

- **`default`** [shared/read-only] — same traces stream as above. The catalog reads from
  `service_streams/_search` and/or `service_streams/_grouped` to build the service list.
  Why: catalog tests verify table rendering, status pills, filtering, sorting, pagination,
  side panel, and row-click navigation.

  **EXACT SETUP — same ingestion as above:**

  Reference: `tests/ui-testing/playwright-tests/Traces/service-catalog.spec.js` (uses the
  same ingestion helpers, or the pre-seeded stream from the service-graph beforeAll).

  Additionally, the catalog daemon endpoint is `service_streams/_grouped` — poll it:
  ```js
  const { waitForServiceRegistry } = require('../utils/service-graph-ingestion.js');
  await waitForServiceRegistry(page, { serviceName: 'api-gateway', maxWaitMs: 120000 });
  ```

  Reference: the explorer found `waitForServiceRegistry` in `service-graph-ingestion.js` (line ~2180).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** `ingestTraces(page, allTraces, { delayMs: 50 })` — see
  `tests/ui-testing/playwright-tests/Traces/service-graph.spec.js:39`.
  The helper POSTs to `/api/{org_id}/v1/traces` using the standard auth headers from `getHeaders()`.

- **Auth/org:** `ORGNAME=default`; the worker auth state uses
  `playwright-tests/utils/auth/user.json`. Tests get storageState via the enhanced base fixtures
  (`browser.newContext({ storageState: '...' })`). Org identifier is extracted from the auth
  state — the ingestion helpers call `getOrgId()` which reads it.

- **Timing:** After ingestion, poll `waitForServiceGraphData(page, { maxWaitMs: 240000 })` for the
  service-graph daemon to process. For catalog, poll `waitForServiceRegistry(page, ...)` for the
  `service_streams/_grouped` endpoint. 240s is the established ceiling.

## Preconditions / toggles

- Service Graph route: **enterprise-only** (`config.isEnterprise === "true"`). OSS builds redirect
  `/traces/service-graph` → `/traces`. Tests MUST be tagged `@enterprise`.
- Services Catalog route: **available in OSS and enterprise** (no enterprise gate on route guard).
  Tests do NOT need an enterprise tag.
- Both routes read `searchObj.organizationIdentifier` from `store.state.selectedOrganization.identifier`.
  This is set on mount (constructor assignment + watch). The org must be loaded before navigating
  to either route.
- Stream filter localStorage key: `serviceGraph_streamFilter`. Tests should set it in
  `beforeEach` to `'default'` to avoid picking up a stale stream name from previous runs
  (see `service-graph.spec.js:78`).

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Service Graph daemon latency:** `waitForServiceGraphData` already polls the topology API
   (`/api/{org}/service_graph/topology`) with a 240s max wait. If tests added later need
   specific edge-case services (circular deps), they may need _additional_ polling — see the
   `service-a/service-b/service-c` test at `service-graph.spec.js:476` which does its own
   up-to-120s poll.

2. **Catalog daemon endpoint:** The catalog reads from a different backend path
   (`service_streams/_grouped`) than the topology graph. After ingestion, both daemons
   must finish before catalog assertions pass. Use `waitForServiceRegistry` (same polling pattern).

3. **Keep-alive route interference:** The Traces page (`/traces`) is `keepAlive: true`. When a test
   navigates from a standalone route BACK to Traces, the old Traces instance re-activates instead
   of remounting. The Traces page's `onActivated` hook checks for `filter` query params and
   re-applies the handoff. Tests that hand off TO Traces must ensure the filter param is present
   (both view wrappers do this via `viewTracesQuery`).

4. **OSelect model-value:** The stream selector in ServiceGraphView uses `:model-value` (not
   `v-model`), so Playwright must interact with the underlying select element. The existing
   page-manager already handles this.

5. **organizationIdentifier must not be empty:** Both wrappers set it on construction, but if the
   store is not yet hydrated, it falls back to `""`. The watch on
   `store.state.selectedOrganization.identifier` catches late hydration. Tests that navigate
   before the org loads may see requests to `/api//_search` (empty org segment).
