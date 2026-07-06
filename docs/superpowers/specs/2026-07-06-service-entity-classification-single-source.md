# Service Entity Classification — Single Source of Truth

**Date:** 2026-07-06
**Branch:** `service_graph_fixes`
**Status:** Approved design, pending implementation plan

## Problem

The Service Graph and the Service Catalog must classify the same trace entities
into the same taxonomy (Service / Datastore / Queue / External), but they do it
with **two independent, divergent implementations**:

| Concern | Service Graph | Service Catalog |
|---|---|---|
| Builds from | `buildTopologyFromTraces` (edge rows) | SQL `GROUP BY COALESCE(...)` + `categoryOf` |
| "Real service" test | name appears in service-edge rows | `_is_real_service` SQL flag |
| Collision reclassify | inline in the builder | `is_real_service` in `categoryOf` |
| RPC suppression | `if (connection_type==='rpc') continue` | `isPhantomRpc` filter |

**This duplication is the root cause of the recurring count mismatches** (12 vs
17 services, 8 vs 0 rpc). Two codebases computing one taxonomy inevitably drift;
each one-sided fix opens a gap on the other side. The correct fix is a **single
shared classification function** both screens consume.

## The classification rule (data-verified)

Verified by direct queries against a live `otel_demo` stream (30 entity groups):

```
if is_real_service:            → "service"    // emits its own spans; any inferred type is a false positive
else if inferType == "rpc":    → "drop"       // phantom: redundant with the real service→service edge
else if inferType == "database": → "datastore"
else if inferType == "queue":  → "queue"
else if inferType == "external": → "external"
else:                          → "service"    // no inferred type and not flagged → treat as service
```

**Definitions:**
- **`is_real_service`** — the entity emits at least one span where it is the
  `service_name` (not an inferred name). Proven with:
  `MAX(CASE WHEN service_name IS NOT NULL AND (infer_service_name IS NULL OR infer_service_name = '') THEN 1 ELSE 0 END)`.
- **Collision** — a name that is BOTH a real service AND carries an inferred type
  (e.g. `email`/`quote`/`shipping`/`flagd`/`frontend-proxy`, inferred `external`
  because a caller reached them over HTTP). `is_real_service` wins → Service. The
  external inference is a false positive: the caller couldn't tell the HTTP target
  was an already-instrumented service.
- **Phantom RPC** — every rpc inferred target in the data (`oteldemo.*Service`,
  `flagd.evaluation.v1.Service`) has a matching real service→service edge (proven
  by cross-referencing the rpc client spans against the parent/child service-edge
  join). The rpc node duplicates a service already in the graph, so it is dropped.
  Non-real rpc → `"drop"`. (A hypothetical genuinely-uninstrumented rpc backend
  does not occur in the data; if one ever appears it would also be `drop`, since
  it too would be redundant with… nothing — acceptable, revisit only if observed.)

**Verified counts for otel_demo:** 30 raw groups → 17 services, 2 datastores
(`otel`, `valkey-cart`), 1 queue (`kafka`), 2 external (`kubernetes.default.svc`,
`metadata.google.internal.`), 8 dropped rpc. Total shown = 22.

The rule is **general** — nothing is hardcoded to otel-demo.

## Design

### New module: `web/src/utils/traces/serviceClassification.ts`

Pure, dependency-free, unit-tested. Single export:

```ts
export type EntityKind =
  | "service"
  | "datastore"
  | "queue"
  | "external"
  | "rpc"
  | "drop";

export interface ClassifyInput {
  /** True when the entity emits its own spans (a real instrumented service). */
  isRealService: boolean;
  /** infer_service_type: "database" | "queue" | "external" | "rpc" | undefined. */
  inferServiceType?: string | null;
}

export function classifyEntity(input: ClassifyInput): EntityKind;
```

`classifyEntity` encodes the rule above, once. `"drop"` means "remove from both
screens" (phantom rpc). The function never guesses from names — it takes the two
facts (`isRealService`, `inferServiceType`) and returns a kind.

### Consumer 1 — Service Catalog (`ServicesCatalog.vue`)

- Keep the `_is_real_service` SQL flag (already added).
- Replace `categoryOf` + `isPhantomRpc` with calls to `classifyEntity`:
  - map the returned kind to the catalog's existing `EntityCategory`
    (`service`/`datastore`/`queue`/`external`/`rpc`); `"drop"` rows are filtered
    out of `services.value`.
- Remove the now-dead `isPhantomRpc` and the type-specific switch in `categoryOf`.
- The RPC tab naturally disappears (count is always 0 after drops) — handled by
  the existing `visibleTypeFilters` (only shows categories with entities), so no
  extra work; verify it hides.

### Consumer 2 — Service Graph (`serviceGraphTopology.ts`)

- `buildTopologyFromTraces` computes, per inferred target, `isRealService`
  (already has the `realServices` set) and calls `classifyEntity`:
  - `"drop"` → skip the row (replaces the inline `if (connection_type === 'rpc')
    continue` at the top of the inferred loop).
  - `"service"` → merge into the real service (collision), no separate node.
  - `datastore`/`external` → typed dependency node from the classified kind.
- **The existing `if (connection_type === 'queue') continue` STAYS as-is.** Queue
  topology is owned entirely by the separate messaging query (producer→topic→
  consumer via `messagingRows`), which already types those nodes `"queue"`.
  `classifyEntity` is NOT used to build graph queue nodes — the inferred-queue
  row is still dropped so it does not duplicate the topic node. `classifyEntity`
  governs the graph's database/external/rpc inferred rows and the catalog's full
  taxonomy (including queue, since the catalog has no separate messaging query).
- The node's `service_type` is set from the classified kind (not the raw
  `connection_type`), so graph `kindCounts` and catalog counts derive from the
  same rule.

### Result

Both screens call `classifyEntity`. The taxonomy lives in one tested place; the
two screens cannot drift. otel_demo shows identically on both:
**17 Services · 2 Datastores · 1 Queue · 2 External · (0 RPC)**.

## Out of scope

- **Queue node label** (graph shows topic `orders`; catalog shows system `kafka`).
  This is a naming difference, not a classification difference — both count as
  1 Queue. Deferred; can be unified later by aligning the catalog's queue query
  to group by topic.
- The messaging/async-consumer topology (already shipped).
- Any backend/ingest change — `infer_service_*` and `_o2_service_graph` untouched.

## Testing

- **Unit (`serviceClassification.spec.ts`):** every branch of the rule —
  real-service-with-external-inference → service; real-service plain → service;
  non-real database/queue/external → their kind; non-real rpc → drop; no-infer →
  service. Table-driven, one case per row of the verified otel_demo table.
- **Catalog:** collision reclassify (email → service), genuine external kept
  (metadata.google.internal → external), phantom rpc dropped (oteldemo.* absent).
- **Graph:** same three via `buildTopologyFromTraces`.
- **Regression:** existing `ServicesCatalog.spec.ts`, `ServiceGraph.spec.ts`,
  `serviceGraphTopology.spec.ts`, `convertTraceData.spec.ts` stay green.
- **Cross-check:** a test asserting graph `kindCounts` and catalog `categoryCounts`
  produce identical numbers for the same entity set.
