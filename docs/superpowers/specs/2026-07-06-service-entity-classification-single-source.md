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

Verified by direct queries against a live `otel_demo` stream (30 entity groups)
AND a purpose-built topology-matrix stream (traces_tester) that exercises every
case: redundant rpc, genuine-uninstrumented rpc, collision, multi-system db,
kafka producer/consumer, genuine external, unknown type. See
`2026-07-06-traces-tester-topology-matrix.md`.

```
if is_real_service:              → "service"    // emits its own spans; any inferred type is a false positive (collision rule wins first)
else if inferType == "rpc":      → "rpc"        // KEEP as a dependency node (see RPC decision below); never dropped, never hidden
else if inferType == "database": → "datastore"
else if inferType == "queue":    → "queue"
else if inferType == "external": → "external"
else if inferType is non-empty:  → "external"   // UNKNOWN inferred type → safe default: it's a dependency, NOT our code
else:                            → "service"    // truly no inferred type → real service
```

### RPC decision (revised after matrix validation)

Earlier this spec dropped ALL non-real rpc as "redundant." **The topology-matrix
data disproved that as a general rule.** It produced two rpc entities that are
indistinguishable by `is_real_service` (both 0) but fundamentally different:
- `oteldemo.InventoryService` — a real `inventory-service` exists → the rpc node
  is a *redundant duplicate* of a real service.
- `legacy.BillingService` — NO real service exists → a *genuine uninstrumented
  dependency*. Dropping it would hide a real dependency.

We investigated non-heuristic ways to tell them apart and **both failed on real
data**: `peer.service` was absent on all rpc spans, and resolving via the
span-graph child link was noisy (the genuine `legacy.BillingService` falsely
"resolved" to 4 unrelated services). Name-normalization
(`oteldemo.InventoryService` → `inventory-service`) is the only remaining merge
signal and it is a fragile heuristic we reject.

**Final rule (principled, no guessing):**
- An rpc target is **merged into a real service ONLY when `peer.service` is set**
  and equals a real `service_name` (Datadog's authoritative signal; the merge is
  the collision path — `is_real_service` becomes true for that entity). Proper
  OTel instrumentations set `peer.service`.
- When `peer.service` is **absent** (otel_demo, this matrix), the rpc target is
  **kept as an `rpc` dependency node** — honest: the data cannot prove it is a
  real service, and it may be a genuine uninstrumented backend. No name-guessing,
  never hides a dependency, never mis-merges.

Consequence: on data without `peer.service`, `oteldemo.*Service` nodes appear as
rpc dependencies. This is *honest clutter* — they are distinct gRPC service
identities the data cannot dedupe. On data WITH `peer.service`, they merge
cleanly into the real services (matching Datadog).

**The unknown-type branch is a deliberate safety net.** OpenTelemetry semantic
conventions evolve; the backend may one day emit `cache`, `http`, `storage`,
`rpc.grpc`, etc. as `infer_service_type`. Such a value means "something was
inferred" — i.e. a dependency. Defaulting an unknown *non-empty* inferred type to
`"external"` (a dependency) is safe; defaulting it to `"service"` would wrongly
claim an external dependency is our instrumented code and inflate the service
count. The distinction between **unknown non-empty type → external** and **no
type at all → service** is essential. Note `is_real_service` is still checked
first, so a real service carrying an unknown inferred type stays a Service.

**Definitions:**
- **`is_real_service`** — the entity emits at least one span where it is the
  `service_name` (not an inferred name). Proven with:
  `MAX(CASE WHEN service_name IS NOT NULL AND (infer_service_name IS NULL OR infer_service_name = '') THEN 1 ELSE 0 END)`.
- **Collision** — a name that is BOTH a real service AND carries an inferred type
  (e.g. `email`/`quote`/`shipping`/`flagd`/`frontend-proxy`, inferred `external`
  because a caller reached them over HTTP). `is_real_service` wins → Service. The
  external inference is a false positive: the caller couldn't tell the HTTP target
  was an already-instrumented service.
- **RPC** — kept as a dependency node (see "RPC decision" above). Merged into a
  real service only when `peer.service` identifies it (then it is a collision →
  Service). Never dropped, so a genuine uninstrumented rpc backend is never
  hidden. No telemetry needed — nothing is silently removed.

**Verified counts for otel_demo (no `peer.service`):** 30 raw groups → 17
services, 2 datastores (`otel`, `valkey-cart`), 1 queue (`kafka`/topic), 2
external (`kubernetes.default.svc`, `metadata.google.internal.`), and 8 rpc
dependency nodes (`oteldemo.*Service`, `flagd.evaluation.v1.Service`) shown as
honest rpc nodes. Total = 30 entities. With `peer.service` present, the 8 rpc
would merge into their real services → 22.

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
  | "rpc"; // kept as a dependency node; never dropped

/** The inferred types we branch on explicitly. */
export type KnownInferType = "database" | "queue" | "external" | "rpc";

export interface ClassifyInput {
  /** True when the entity emits its own spans (a real instrumented service). */
  isRealService: boolean;
  /**
   * infer_service_type from the backend. Typed as the known union for the
   * values we handle, but accepts an arbitrary string at the boundary (the SQL
   * returns whatever the ingest wrote). Unknown non-empty strings are handled
   * defensively (→ external), NOT ignored.
   */
  inferServiceType?: KnownInferType | (string & {}) | null;
}

export function classifyEntity(input: ClassifyInput): EntityKind;
```

`classifyEntity` encodes the rule above, once. The function never guesses from
names — it takes the two facts (`isRealService`, `inferServiceType`) and returns
a kind. Unknown non-empty `inferServiceType` values fall through to `"external"`
(see the rule), so new OTel semconv types are treated as dependencies, never as
instrumented services. Nothing is dropped — rpc targets are kept as `rpc` nodes.

### Consumer 1 — Service Catalog (`ServicesCatalog.vue`)

- Keep the `_is_real_service` SQL flag (already added).
- Replace `categoryOf` + `isPhantomRpc` with calls to `classifyEntity`:
  - map the returned kind to the catalog's existing `EntityCategory`
    (`service`/`datastore`/`queue`/`external`/`rpc`).
- Remove the now-dead `isPhantomRpc` filter (rpc is no longer dropped) and the
  type-specific switch in `categoryOf`.
- The RPC tab shows the rpc dependency count (no longer forced to 0). Existing
  `visibleTypeFilters` already hides empty categories.

### Consumer 2 — Service Graph (`serviceGraphTopology.ts`)

- `buildTopologyFromTraces` computes, per inferred target, `isRealService`
  (already has the `realServices` set) and calls `classifyEntity`:
  - `"service"` → merge into the real service (collision via `peer.service`), no
    separate node.
  - `datastore`/`external`/`rpc` → typed dependency node from the classified kind.
  - Remove the inline `if (connection_type === 'rpc') continue` — rpc is kept.
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

## User-visible change & communication

The unified rule changes what users see. Exact before/after (verified on
otel_demo):

| | Before | After (no peer.service) | Δ |
|---|---|---|---|
| **Services** | 12 | **17** | **+5** |
| Datastores | 2 | 2 | — |
| Queues | 1 | 1 | — |
| External | 5 | 2 | −3 |
| RPC | 8 | 8 (kept as rpc deps) | — |

The headline change is **Services go UP (12 → 17)** because 5 real services were
previously mislabeled as External. RPC entities are **kept** (not dropped) —
so both screens agree on all five buckets. With `peer.service` present the 8 rpc
merge into their real services; without it (otel_demo) they stay as honest rpc
dependency nodes on BOTH screens (still consistent).

**Communication needed (low effort):**
- Both screens now agree and External drops (real services reclassified). Optional
  one-line release note: *"Service Catalog and Graph now consistently classify
  entities; services that are also called over HTTP are no longer double-counted
  as external."* No in-app banner or tooltip changes required.

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
  real-service with UNKNOWN inferred type → service (collision wins);
  non-real database/queue/external → their kind; **non-real rpc → rpc (kept)**;
  non-real UNKNOWN non-empty type (e.g. `"cache"`, `"http"`) → external (the
  safety net, NOT service); no-infer (null/empty) → service. Table-driven, one
  case per row of the verified otel_demo + topology-matrix tables (both
  redundant and genuine rpc kept as rpc when `peer.service` absent).
- **Catalog:** collision reclassify (email → service), genuine external kept
  (metadata.google.internal → external), rpc kept as rpc (oteldemo.* present).
- **Graph:** same via `buildTopologyFromTraces`.
- **Regression:** existing `ServicesCatalog.spec.ts`, `ServiceGraph.spec.ts`,
  `serviceGraphTopology.spec.ts`, `convertTraceData.spec.ts` stay green.
- **Cross-check:** a test asserting graph `kindCounts` and catalog `categoryCounts`
  produce identical numbers for the same entity set.
