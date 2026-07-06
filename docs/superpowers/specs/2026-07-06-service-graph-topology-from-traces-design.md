# Service Graph — Topology From Traces, Metrics From `_o2_service_graph`

**Date:** 2026-07-06
**Branch:** `service_graph_fixes`
**Status:** Approved design, pending implementation plan
**Supersedes the "grouping in build_topology" spec for the categorization problem** — that spec assumed `_o2_service_graph` carried the inferred deps. It doesn't (see Problem). This spec fixes the source.

## Problem

The Service Graph shows only services — zero databases, queues, or external
dependencies. The Service Catalog, over the **same `otel_demo` stream and same
15-minute window**, shows `Datastores 2 · Queues 1 · External 5 · RPC 8` (16
inferred entities).

**Why they differ:** the two screens read different sources.
- **Catalog** queries the **raw traces stream live** (`infer_service_type` per
  span) → sees every inferred dependency.
- **Graph** reads the **pre-aggregated `_o2_service_graph` stream**, written by a
  background job that runs **once per hour** — and that stream is missing the
  inferred deps for this data.

**Evidence the loss is real, not expected:** cross-referenced against the
canonical `open-telemetry/opentelemetry-demo` topology:
- Real datastores: **PostgreSQL** (accounting, product-reviews), **Valkey/cache**
  (cart). Real queue: **Kafka** (checkout→accounting, checkout→fraud-detection).
- These names (`postgresql`, `valkey`, `kafka`) are **NOT service names**, so the
  processor's anti-join (which drops inferred names equal to a real
  `service_name`) should **not** remove them. They should appear in the graph.
  They don't → a genuine defect in the hourly `_o2_service_graph` pipeline.
- The `External`/`RPC` collisions (`email`, `quote`, `shipping`, the 8 gRPC
  peers) ARE real services reached over HTTP/gRPC — the anti-join dropping those
  is arguably correct.

**Decision:** rather than debug the hourly job, get topology + categorization
**live from the raw traces stream** (which the Catalog already proves works), and
use `_o2_service_graph` only for the thing it is good at — pre-aggregated edge
**latency/error metrics**. This is both a fix and a better architecture (live,
no hourly lag).

## Decisions (locked)

| Decision | Choice |
|---|---|
| Topology source (nodes + edges + kinds) | **Raw traces stream, queried live from the frontend** (same pattern the Catalog uses). |
| Metrics source (p50/p95/p99, error rate, requests per edge) | **`_o2_service_graph`** via the existing `/topology/current` endpoint. |
| Where the merge happens | **Frontend** (`ServiceGraph.vue`). No backend change. |
| Collision rule (inferred name == a real service) | **Merge into the real service.** `checkout → email` (Ruby email service reached over HTTP) is ONE service edge, not a phantom "external email." Only show an inferred node when its name has **no** matching real `service_name`. |
| Kind on a node | From the traces query's `infer_service_type` (database/queue/external/rpc), or `service` when the node is a real instrumented service. |

## Design

**Layer:** frontend only — `web/src/plugins/traces/ServiceGraph.vue`, reusing the
Catalog's `fetchQueryDataWithHttpStream` streaming-search pattern.

### Call 1 — Topology + kinds (raw traces stream, live)

Two SQL queries against the selected trace stream, mirroring the OSS processor's
proven logic but run client-side:

**1a. Service→service edges** (instrumented topology):
```sql
SELECT client.service_name AS client, server.service_name AS server,
       COUNT(*) AS total_requests,
       SUM(CASE WHEN server.span_status = 'ERROR' THEN 1 ELSE 0 END) AS errors
FROM "<stream>" AS server
LEFT JOIN "<stream>" AS client
  ON server.reference_parent_span_id = client.span_id
  AND server.trace_id = client.trace_id
WHERE CAST(server.span_kind AS VARCHAR) IN ('1','2')
  AND (client.service_name IS NULL OR client.service_name != server.service_name)
GROUP BY client.service_name, server.service_name
```

**1b. Inferred-dependency edges** (schema-gated on `infer_service_name`):
```sql
SELECT service_name AS client, infer_service_name AS server,
       MAX(infer_service_type) AS connection_type,
       COUNT(*) AS total_requests,
       SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS errors
FROM "<stream>"
WHERE CAST(span_kind AS VARCHAR) IN ('3','4')
  AND infer_service_name IS NOT NULL AND infer_service_name != ''
GROUP BY service_name, infer_service_name
```

Note: **no anti-join here.** The collision rule is applied during the merge
(below), where we already have the full real-service set — cleaner and it keeps
the honest-topology behavior in one place.

From these, build:
- **Node set:** every `service_name` (from 1a, both sides) is a real service
  (`service_type = null`). Every `infer_service_name` from 1b is a candidate
  inferred node with `service_type = connection_type` — **unless** that name is
  already a real service (collision → drop the inferred node, keep the edge
  pointing at the real service).
- **Edge set:** 1a service→service edges + 1b inferred edges (retargeted to the
  real service on collision).

### Call 2 — Metrics (`_o2_service_graph`, existing endpoint)

Keep calling `serviceGraphService.getCurrentTopology(orgId, ...)`. Use its
response **only** to read per-edge metrics: `p50_latency_ns`, `p95_latency_ns`,
`p99_latency_ns`, `error_rate`, `total_requests`. Ignore its node set.

### Merge (client-side)

- Nodes, edges, and kinds come from Call 1 (authoritative topology).
- Build a lookup from Call 2 keyed on `(client_service, server_service)` →
  metrics.
- For each Call-1 edge, attach latency/error metrics from the Call-2 lookup on
  matching `(from, to)`. **No match → edge renders without latency** (topology is
  still shown; no hourly-lag gap).
- Node request/error counts come from summing Call-1 edge counts (as the current
  `convertServiceGraphToNetwork` already does).

### Rendering (unchanged)

The merged `{ nodes, edges }` feeds the existing
`convertServiceGraphToNetwork` / `convertServiceGraphToTree` and the
icon/layout/legend work already on this branch. Result: the legend shows real
`Datastores / Queues / External / RPC` counts, and postgres/valkey/kafka finally
appear as correctly-typed downstream leaves.

## Summary

| Concern | Source |
|---|---|
| Which nodes exist, their kind | Raw traces query (Call 1) — live |
| Who calls whom (edges) | Raw traces query (Call 1) — live |
| p50/p95/p99, error rate per edge | `_o2_service_graph` (Call 2) — pre-aggregated |
| Merge & collision handling | Frontend, in ServiceGraph.vue |

## Architecture boundaries

- **Frontend-only change.** No backend, no migration, no ingest change. The
  `_o2_service_graph` write pipeline and its hourly job are untouched (its bug is
  now routed around, not fixed here — a separate future concern).
- Reuses the Catalog's existing `fetchQueryDataWithHttpStream` streaming-search
  infrastructure and the `serviceGraphService.getCurrentTopology` service.

## Testing

- **Unit (pure merge/build functions, extracted from ServiceGraph.vue so they are
  testable in isolation):**
  - service→service rows → nodes+edges, kinds = service.
  - inferred rows → typed nodes (`database`/`queue`/`external`/`rpc`).
  - **collision:** an inferred name equal to a real service → no duplicate node;
    the edge retargets to the real service.
  - metrics merge: Call-2 `(from,to)` metrics attach to the matching Call-1 edge;
    unmatched Call-1 edge keeps zero/undefined latency and still renders.
  - genuine infra (postgres/valkey/kafka) → survives (no collision) and is typed.
- **Regression:** existing `ServiceGraph.spec.ts`, `convertTraceData.spec.ts`,
  and `ServicesCatalog.spec.ts` stay green.

## Out of scope

- Fixing the `_o2_service_graph` hourly pipeline (routed around, not fixed).
- Backend grouping (`build_topology` logical-service collapse) — deferred; can be
  applied to the traces query later if per-host explosion returns on real infra.
- Node expansion, focus view, incident highlighting (deferred per earlier spec).
