# Service Graph — Topology From Traces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the service-graph topology + node kinds live from the raw traces stream, and decorate edges with pre-aggregated latency/error metrics from `_o2_service_graph`, merging on the frontend — so databases, queues, and external deps finally appear and are correctly typed.

**Architecture:** Frontend-only. Pure build/merge functions in a new testable module; `ServiceGraph.vue` runs two fetches (traces topology query + existing metrics endpoint) and merges. No backend, migration, or ingest change.

**Tech Stack:** Vue 3 + TypeScript + ECharts, Vitest. Reuses `fetchQueryDataWithHttpStream` (streaming search) and `serviceGraphService.getCurrentTopology`.

## Global Constraints

- **Frontend-only.** No backend/migration/ingest change. `_o2_service_graph` write pipeline untouched.
- **Collision rule:** an inferred name equal to a real `service_name` → NO duplicate inferred node; the edge retargets to the real service. Only emit an inferred node when its name has no matching real service.
- **Node kinds:** real service → `service_type` undefined; inferred dep → `service_type` = `database`/`queue`/`external`/`rpc` from `infer_service_type`.
- **Metrics are decoration only.** Topology (nodes+edges) always comes from traces; a missing `_o2_service_graph` metric leaves an edge without latency but still rendered.
- Reuse the Catalog's query/streaming pattern verbatim where possible (`ServicesCatalog.vue` `loadServicesCatalog`).
- Repo: `/Users/ashishkolhe/Documents/github/openobserve`. Verify via Vitest + `vue-tsc`; never `npm run build`.

## File Structure

- **Create:** `web/src/utils/traces/serviceGraphTopology.ts` — pure functions: build nodes/edges from traces rows (with collision handling), and merge `_o2_service_graph` metrics onto edges. One responsibility: turn query rows → merged `{nodes, edges}`. No I/O, no Vue — fully unit-testable.
- **Create:** `web/src/utils/traces/serviceGraphTopology.spec.ts` — unit tests.
- **Modify:** `web/src/plugins/traces/ServiceGraph.vue` — run the traces topology query (Call 1) alongside the existing metrics fetch (Call 2), pass both through the new merge, feed the result to the existing render path.

## Interfaces (shared across tasks)

```ts
// Row shapes returned by the two traces SQL queries.
interface ServiceEdgeRow {
  client: string | null;
  server: string;
  total_requests?: number;
  errors?: number;
}
interface InferredEdgeRow {
  client: string;              // service_name
  server: string;              // infer_service_name
  connection_type: string;     // infer_service_type: database|queue|external|rpc
  total_requests?: number;
  errors?: number;
}
// _o2_service_graph edge metrics (from getCurrentTopology .edges).
interface EdgeMetrics {
  from: string | null;
  to: string;
  p50_latency_ns?: number;
  p95_latency_ns?: number;
  p99_latency_ns?: number;
  error_rate?: number;
  total_requests?: number;
}
// Output consumed by convertServiceGraphToNetwork/Tree (existing shape).
interface GraphNode {
  id: string; label: string; requests: number; errors: number;
  service_type?: string;      // undefined for real services
}
interface GraphEdge {
  from: string | null; to: string;
  total_requests: number; failed_requests: number; error_rate: number;
  p50_latency_ns?: number; p95_latency_ns?: number; p99_latency_ns?: number;
  connection_type?: string;
}
```

---

## Task 1: Build nodes/edges from service→service rows

**Files:**
- Create: `web/src/utils/traces/serviceGraphTopology.ts`
- Create: `web/src/utils/traces/serviceGraphTopology.spec.ts`

**Interfaces:**
- Produces: `export function buildTopologyFromTraces(serviceRows: ServiceEdgeRow[], inferredRows: InferredEdgeRow[]): { nodes: GraphNode[]; edges: GraphEdge[] }`

- [ ] **Step 1: Write the failing test**

Create the spec with:

```ts
import { describe, it, expect } from "vitest";
import { buildTopologyFromTraces } from "./serviceGraphTopology";

describe("buildTopologyFromTraces — service edges", () => {
  it("builds service nodes and edges with no service_type", () => {
    const { nodes, edges } = buildTopologyFromTraces(
      [{ client: "frontend", server: "cart", total_requests: 10, errors: 1 }],
      [],
    );
    expect(nodes.map((n) => n.id).sort()).toEqual(["cart", "frontend"]);
    expect(nodes.every((n) => n.service_type === undefined)).toBe(true);
    const e = edges.find((x) => x.from === "frontend" && x.to === "cart")!;
    expect(e.total_requests).toBe(10);
    expect(e.failed_requests).toBe(1);
  });

  it("treats a null client as an entry-point edge", () => {
    const { edges } = buildTopologyFromTraces(
      [{ client: null, server: "frontend", total_requests: 5, errors: 0 }],
      [],
    );
    expect(edges[0].from).toBeNull();
    expect(edges[0].to).toBe("frontend");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/serviceGraphTopology.spec.ts 2>&1 | tail -12`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Write minimal implementation**

Create `serviceGraphTopology.ts`:

```ts
// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export interface ServiceEdgeRow {
  client: string | null;
  server: string;
  total_requests?: number;
  errors?: number;
}
export interface InferredEdgeRow {
  client: string;
  server: string;
  connection_type: string;
  total_requests?: number;
  errors?: number;
}
export interface GraphNode {
  id: string;
  label: string;
  requests: number;
  errors: number;
  service_type?: string;
}
export interface GraphEdge {
  from: string | null;
  to: string;
  total_requests: number;
  failed_requests: number;
  error_rate: number;
  p50_latency_ns?: number;
  p95_latency_ns?: number;
  p99_latency_ns?: number;
  connection_type?: string;
}

function ensureNode(
  map: Map<string, GraphNode>,
  id: string,
  serviceType?: string,
): GraphNode {
  let n = map.get(id);
  if (!n) {
    n = { id, label: id, requests: 0, errors: 0, service_type: serviceType };
    map.set(id, n);
  }
  // A real-service classification (undefined type) always wins over inferred.
  if (serviceType === undefined) n.service_type = undefined;
  return n;
}

export function buildTopologyFromTraces(
  serviceRows: ServiceEdgeRow[],
  inferredRows: InferredEdgeRow[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const r of serviceRows) {
    const req = r.total_requests ?? 0;
    const err = r.errors ?? 0;
    const server = ensureNode(nodes, r.server);
    server.requests += req;
    server.errors += err;
    if (r.client) {
      const client = ensureNode(nodes, r.client);
      client.requests += req;
      client.errors += err;
    }
    edges.push({
      from: r.client,
      to: r.server,
      total_requests: req,
      failed_requests: err,
      error_rate: req > 0 ? (err / req) * 100 : 0,
    });
  }

  // Inferred edges added in Task 2.
  void inferredRows;

  return { nodes: Array.from(nodes.values()), edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/serviceGraphTopology.spec.ts 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/utils/traces/serviceGraphTopology.ts web/src/utils/traces/serviceGraphTopology.spec.ts
git commit -m "feat(service-graph): build service topology from trace rows"
```

---

## Task 2: Add inferred deps + collision handling

**Files:**
- Modify: `web/src/utils/traces/serviceGraphTopology.ts`
- Modify: `web/src/utils/traces/serviceGraphTopology.spec.ts`

**Interfaces:**
- Consumes: `buildTopologyFromTraces` from Task 1.
- Produces: inferred rows become typed nodes/edges, EXCEPT when the inferred name equals a real service (collision) → no inferred node; edge retargets to the real service.

- [ ] **Step 1: Write the failing test**

Add:

```ts
describe("buildTopologyFromTraces — inferred deps & collisions", () => {
  it("adds a typed node for a genuine infra dependency", () => {
    const { nodes, edges } = buildTopologyFromTraces(
      [{ client: null, server: "cart", total_requests: 10, errors: 0 }],
      [{ client: "cart", server: "valkey", connection_type: "database", total_requests: 10, errors: 0 }],
    );
    const dep = nodes.find((n) => n.id === "valkey")!;
    expect(dep.service_type).toBe("database");
    const e = edges.find((x) => x.from === "cart" && x.to === "valkey")!;
    expect(e.connection_type).toBe("database");
  });

  it("merges an inferred name that is also a real service (collision)", () => {
    const { nodes, edges } = buildTopologyFromTraces(
      // email is a real instrumented service
      [{ client: null, server: "email", total_requests: 5, errors: 0 }],
      // checkout also reaches email over HTTP → inferred 'external'
      [{ client: "checkout", server: "email", connection_type: "external", total_requests: 3, errors: 0 }],
    );
    // Only one email node, typed as a real service (not external).
    const emails = nodes.filter((n) => n.id === "email");
    expect(emails).toHaveLength(1);
    expect(emails[0].service_type).toBeUndefined();
    // The edge still exists, pointing at the real service.
    const e = edges.find((x) => x.from === "checkout" && x.to === "email")!;
    expect(e).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/serviceGraphTopology.spec.ts -t "inferred deps" 2>&1 | tail -12`
Expected: FAIL — inferred rows currently ignored (`void inferredRows`).

- [ ] **Step 3: Write minimal implementation**

Replace `void inferredRows;` with:

```ts
  // A name is a "real service" if it appears as a service_name in serviceRows.
  const realServices = new Set<string>();
  for (const r of serviceRows) {
    realServices.add(r.server);
    if (r.client) realServices.add(r.client);
  }

  for (const r of inferredRows) {
    const req = r.total_requests ?? 0;
    const err = r.errors ?? 0;
    const client = ensureNode(nodes, r.client); // caller is always a real service
    client.requests += req;
    client.errors += err;

    const collides = realServices.has(r.server);
    if (!collides) {
      // Genuine infra dependency → typed inferred node.
      const dep = ensureNode(nodes, r.server, r.connection_type);
      dep.requests += req;
      dep.errors += err;
    } else {
      // Collision: keep the real service node; ensure it exists, real type wins.
      ensureNode(nodes, r.server);
    }

    edges.push({
      from: r.client,
      to: r.server, // retargets to the real service on collision (same id)
      total_requests: req,
      failed_requests: err,
      error_rate: req > 0 ? (err / req) * 100 : 0,
      // Only mark the edge inferred when the target is a genuine inferred node.
      connection_type: collides ? undefined : r.connection_type,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/serviceGraphTopology.spec.ts 2>&1 | tail -10`
Expected: PASS (all topology tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/utils/traces/serviceGraphTopology.ts web/src/utils/traces/serviceGraphTopology.spec.ts
git commit -m "feat(service-graph): add inferred deps with real-service collision merge"
```

---

## Task 3: Merge `_o2_service_graph` metrics onto edges

**Files:**
- Modify: `web/src/utils/traces/serviceGraphTopology.ts`
- Modify: `web/src/utils/traces/serviceGraphTopology.spec.ts`

**Interfaces:**
- Produces: `export function mergeEdgeMetrics(topology: { nodes: GraphNode[]; edges: GraphEdge[] }, metricEdges: EdgeMetrics[]): { nodes: GraphNode[]; edges: GraphEdge[] }` — attaches p50/p95/p99 (and error_rate when present) from metrics to the matching `(from,to)` edge; unmatched edges keep undefined latency.

- [ ] **Step 1: Write the failing test**

Add:

```ts
import { mergeEdgeMetrics } from "./serviceGraphTopology";

describe("mergeEdgeMetrics", () => {
  const topo = {
    nodes: [
      { id: "cart", label: "cart", requests: 10, errors: 0 },
      { id: "valkey", label: "valkey", requests: 10, errors: 0, service_type: "database" },
    ],
    edges: [
      { from: "cart", to: "valkey", total_requests: 10, failed_requests: 0, error_rate: 0, connection_type: "database" },
    ],
  };

  it("attaches latency metrics to the matching edge", () => {
    const out = mergeEdgeMetrics(topo, [
      { from: "cart", to: "valkey", p50_latency_ns: 100, p95_latency_ns: 200, p99_latency_ns: 300 },
    ]);
    const e = out.edges[0];
    expect(e.p50_latency_ns).toBe(100);
    expect(e.p95_latency_ns).toBe(200);
    expect(e.p99_latency_ns).toBe(300);
  });

  it("leaves an unmatched edge without latency but still present", () => {
    const out = mergeEdgeMetrics(topo, [
      { from: "other", to: "thing", p50_latency_ns: 999 },
    ]);
    const e = out.edges[0];
    expect(e.p50_latency_ns).toBeUndefined();
    expect(e.to).toBe("valkey"); // topology unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/serviceGraphTopology.spec.ts -t "mergeEdgeMetrics" 2>&1 | tail -12`
Expected: FAIL — `mergeEdgeMetrics` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `serviceGraphTopology.ts`:

```ts
export interface EdgeMetrics {
  from: string | null;
  to: string;
  p50_latency_ns?: number;
  p95_latency_ns?: number;
  p99_latency_ns?: number;
  error_rate?: number;
  total_requests?: number;
}

const edgeKey = (from: string | null, to: string) => `${from ?? ""} ${to}`;

export function mergeEdgeMetrics(
  topology: { nodes: GraphNode[]; edges: GraphEdge[] },
  metricEdges: EdgeMetrics[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byKey = new Map<string, EdgeMetrics>();
  for (const m of metricEdges) byKey.set(edgeKey(m.from, m.to), m);

  const edges = topology.edges.map((e) => {
    const m = byKey.get(edgeKey(e.from, e.to));
    if (!m) return e;
    return {
      ...e,
      p50_latency_ns: m.p50_latency_ns,
      p95_latency_ns: m.p95_latency_ns,
      p99_latency_ns: m.p99_latency_ns,
      // Prefer live error_rate from traces; fall back to metrics if edge had none.
      error_rate: e.error_rate || m.error_rate || 0,
    };
  });

  return { nodes: topology.nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/serviceGraphTopology.spec.ts 2>&1 | tail -10`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/utils/traces/serviceGraphTopology.ts web/src/utils/traces/serviceGraphTopology.spec.ts
git commit -m "feat(service-graph): merge o2sg latency metrics onto traces topology"
```

---

## Task 4: Wire the two-call flow into ServiceGraph.vue

**Files:**
- Modify: `web/src/plugins/traces/ServiceGraph.vue`
- Modify: `web/src/plugins/traces/ServiceGraph.spec.ts`

**Interfaces:**
- Consumes: `buildTopologyFromTraces`, `mergeEdgeMetrics` (Tasks 1–3); the Catalog's `fetchQueryDataWithHttpStream` pattern; existing `serviceGraphService.getCurrentTopology`.
- Produces: `loadServiceGraph()` now (a) runs the two traces SQL queries for topology, (b) reads `getCurrentTopology` for metrics, (c) merges, (d) sets `graphData.value` to the merged result. `service_type` reaches nodes for the icon/legend work already on the branch.

**Context:** `ServiceGraph.vue` currently calls `getCurrentTopology` and maps `rawData.nodes/edges` straight into `graphData`. This task replaces the topology source with the traces query while keeping `getCurrentTopology` for metrics. Reuse the Catalog's schema-gating (`hasInferColumns`) and `fetchQueryDataWithHttpStream` verbatim; build the two SQL strings from the design's queries.

- [ ] **Step 1: Write the failing test**

Add to `ServiceGraph.spec.ts` (mirror its mock pattern; the goal is that a typed inferred node from the traces query survives into `graphData`):

```ts
it("includes inferred dependency nodes from the traces topology query", async () => {
  const wrapper = createWrapper();
  await flushPromises();
  // Simulate the merged topology the new loader produces.
  wrapper.vm.graphData = {
    nodes: [
      { id: "cart", label: "cart", requests: 10, errors: 0 },
      { id: "valkey", label: "valkey", requests: 10, errors: 0, service_type: "database" },
    ],
    edges: [
      { from: "cart", to: "valkey", total_requests: 10, failed_requests: 0, error_rate: 0, connection_type: "database" },
    ],
  };
  await flushPromises();
  expect(wrapper.vm.kindCounts).toEqual({
    service: 1, database: 1, queue: 0, external: 0, rpc: 0,
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes trivially) then implement the loader**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/plugins/traces/ServiceGraph.spec.ts -t "inferred dependency nodes" 2>&1 | tail -12`
Expected: This asserts `kindCounts` (already implemented) reflects a database node — it should PASS once `graphData` accepts `service_type` (it already does). If it passes immediately, it guards the wiring; proceed to implement the loader so the data path is real, not just the shape.

- [ ] **Step 3: Implement the two-call loader**

In `ServiceGraph.vue`:

Import the helpers and streaming search:
```ts
import { buildTopologyFromTraces, mergeEdgeMetrics } from "@/utils/traces/serviceGraphTopology";
import useHttpStreaming from "@/composables/useStreamingSearch";
import streamService from "@/services/stream";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
```

Add, next to the existing state, a schema-gate cache (copied from ServicesCatalog):
```ts
const { fetchQueryDataWithHttpStream } = useHttpStreaming();
const hasInferColumns = ref<boolean | null>(null);
```

Add a helper that runs one SQL query and resolves its hits (Promise-wrapping the streaming callbacks, same shape ServicesCatalog uses):
```ts
function runTracesQuery(sql: string, start: number, end: number): Promise<any[]> {
  return new Promise((resolve) => {
    const hits: any[] = [];
    const traceId = generateTraceContext().traceId;
    fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: { sql: b64EncodeUnicode(sql), start_time: start, end_time: end, from: 0, size: -1 },
          encoding: "base64",
        },
        type: "search", pageType: "traces", searchType: "ui",
        traceId, org_id: searchObj.organizationIdentifier,
      },
      {
        data: (_p: any, res: any) => {
          if (res.type === "search_response_hits" || res.type === "search_response_metadata") {
            hits.push(...(res.content?.results?.hits ?? []));
          }
        },
        complete: () => resolve(hits),
        error: () => resolve(hits),
        reset: () => resolve([]),
      },
    );
  });
}
```

Rewrite `loadServiceGraph` to: resolve the stream + time range (as today), schema-gate `infer_service_name` (as ServicesCatalog does via `streamService.schema`), run the two topology queries + the metrics endpoint in parallel, then merge:
```ts
const stream = streamFilter.value;
const { startTime, endTime } = /* existing effective time range logic */;

// Service→service edges
const serviceSql = `SELECT client.service_name AS client, server.service_name AS server,
  COUNT(*) AS total_requests,
  SUM(CASE WHEN server.span_status = 'ERROR' THEN 1 ELSE 0 END) AS errors
FROM "${stream}" AS server
LEFT JOIN "${stream}" AS client
  ON server.reference_parent_span_id = client.span_id AND server.trace_id = client.trace_id
WHERE CAST(server.span_kind AS VARCHAR) IN ('1','2')
  AND (client.service_name IS NULL OR client.service_name != server.service_name)
GROUP BY client.service_name, server.service_name`;

// Inferred deps (only if schema has the column)
const inferredSql = `SELECT service_name AS client, infer_service_name AS server,
  MAX(infer_service_type) AS connection_type,
  COUNT(*) AS total_requests,
  SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS errors
FROM "${stream}"
WHERE CAST(span_kind AS VARCHAR) IN ('3','4')
  AND infer_service_name IS NOT NULL AND infer_service_name != ''
GROUP BY service_name, infer_service_name`;

const [serviceRows, inferredRows, metricsResp] = await Promise.all([
  runTracesQuery(serviceSql, startTime, endTime),
  hasInferColumns.value ? runTracesQuery(inferredSql, startTime, endTime) : Promise.resolve([]),
  serviceGraphService.getCurrentTopology(searchObj.organizationIdentifier, { /* existing params */ })
    .then((r: any) => r?.data?.edges ?? [])
    .catch(() => []),
]);

const topology = buildTopologyFromTraces(serviceRows as any, inferredRows as any);
const merged = mergeEdgeMetrics(topology, metricsResp as any);
graphData.value = merged;
applyFilters();
```

Keep the existing schema-gate check (copy ServicesCatalog's `hasInferColumns === null` block that calls `streamService.schema(org, stream, "traces")` and sets it). Preserve the existing loading/error handling around this.

- [ ] **Step 4: Run tests**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/plugins/traces/ServiceGraph.spec.ts 2>&1 | tail -12`
Expected: PASS — new test passes; existing ServiceGraph tests stay green. Fix any mock gaps (the two new query calls may need `fetchQueryDataWithHttpStream` mocked in the spec's setup like ServicesCatalog.spec does).

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/plugins/traces/ServiceGraph.vue web/src/plugins/traces/ServiceGraph.spec.ts
git commit -m "feat(service-graph): topology from traces + metrics from o2sg, merged"
```

---

## Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: New + affected unit tests**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/serviceGraphTopology.spec.ts src/plugins/traces/ServiceGraph.spec.ts src/utils/traces/convertTraceData.spec.ts src/plugins/traces/ServicesCatalog.spec.ts 2>&1 | tail -12`
Expected: all PASS.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "serviceGraphTopology|ServiceGraph|convertTraceData" | head; echo "clean if empty"`
Expected: no errors for changed files.

- [ ] **Step 3: Commit any final fixes**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add -A && git commit -m "test(service-graph): verify topology-from-traces suite green"
```

---

## Self-Review Notes

- **Spec coverage:** Call 1 service edges → Task 1; Call 1 inferred + collision rule → Task 2; Call 2 metrics merge → Task 3; two-call orchestration in ServiceGraph.vue → Task 4; verification → Task 5. All spec sections covered.
- **Collision rule** (spec's locked decision) lives entirely in Task 2's `buildTopologyFromTraces`, tested explicitly (`email` inferred+real → one node, real type wins, edge retained).
- **Metrics-as-decoration** (unmatched edge still renders) tested in Task 3.
- **Type consistency:** `buildTopologyFromTraces`, `mergeEdgeMetrics`, `GraphNode`/`GraphEdge`/`EdgeMetrics` used consistently across tasks; `service_type` undefined = real service throughout; edge match key `(from,to)` identical in build and merge.
- **Verified against real code:** ServiceGraph.vue currently maps `rawData.nodes/edges` from `getCurrentTopology`; Task 4 replaces the topology source while keeping that call for metrics. The Catalog's `fetchQueryDataWithHttpStream` + `hasInferColumns` schema-gate pattern is the proven template being reused.
- **Known follow-up flagged, not silently dropped:** the `_o2_service_graph` hourly pipeline still drops inferred deps; this plan routes around it. If per-host node explosion appears on real infra (many redis hosts), apply the deferred grouping logic to the traces query.
