# Phase 2 — Fix `_o2_service_graph` Backend Deduction

**Date:** 2026-07-07
**Repos:** OSS `openobserve` (processor) + `o2-enterprise` (`build_topology`)
**Status:** Design, pending plan
**Depends on:** `2026-07-06-service-entity-classification-single-source.md` (the
classification rule) and `2026-07-06-traces-tester-topology-matrix.md` (test data).

## Context

Phase 1 made the **UI** (Service Graph + Catalog) read topology live from the raw
traces stream, routing around `_o2_service_graph`. But `_o2_service_graph` is
still produced by the hourly processor and still consumed by:

- **`/traces/service_graph/topology/current`** (`api.rs` → `build_topology`) —
  the UI now uses this ONLY for edge latency metrics, so its node classification
  no longer reaches users. Not user-critical, but should be correct.
- **Incident enrichment** (`src/service/alerts/incidents.rs:1426-1441`) — calls
  `query_edges_from_stream_internal` + `build_topology` and USES the resulting
  topology. This is a live consumer getting the broken/old shape.

So the pre-aggregated stream and its deduction must be made honest so every
consumer (incidents today, anything future) is correct.

## The two backend bugs (found via live-instance queries)

**Bug 1 — `has_infer` gate is cache-only** (`processor.rs:197-204`).
`get_stream_schema_from_cache` returns `None` on a cache miss (no DB fallback),
so if the trace stream's schema is not warm in memory when the hourly job runs,
the ENTIRE inferred-edge block is skipped → zero datastores/queues/external
written. This is the original "0 datastores" symptom.

**Bug 2 — the anti-join over-drops** (`processor.rs:222-226`):
```sql
AND infer_service_name NOT IN (
    SELECT DISTINCT service_name FROM "{stream}" WHERE ... )
```
- It uses `IN (subquery)`, which the query engine does not universally support
  (observed to error on the live instance in a related query).
- Semantically it is the OLD, too-aggressive rule: drop EVERY inferred name that
  matches a real service. Phase 1 replaced this with: keep rpc as a dependency
  node; merge into a real service only via `peer.service`. The anti-join drops
  genuine collisions AND cannot distinguish redundant-rpc from
  genuine-uninstrumented-rpc.

## Design

Bring `processor.rs` + enterprise `build_topology` in line with the Phase 1
classification rule. The rule itself lives in TS (`serviceClassification.ts`) for
the frontend; the backend is Rust, so the rule is **replicated in Rust**, not
shared as code. Keep them in sync via a shared test vector (below).

### 1. Fix the schema gate (`processor.rs`)

Replace `get_stream_schema_from_cache` (cache-only) with a DB-backed lookup
(`infra::schema::get` / `get_cache`) so a cold cache does not silently disable
inferred edges. Fall back to running the inferred query and tolerating a
missing-column error, rather than pre-gating on a possibly-empty cache.

### 2. Remove the anti-join; classify in `build_topology` instead

- The inferred SQL keeps producing ALL inferred edges (drop the `NOT IN`
  subquery — it is both unsupported and semantically wrong).
- Move classification into enterprise `build_topology`: for each edge, compute
  `is_real_service` (does the target appear as a real `service_name` in the same
  window — derivable from the instrumented edge set already in hand) and apply
  the Rust port of `classifyEntity`:
  - real service (collision) → merge into the real node.
  - database/queue/external → typed dependency node.
  - rpc → kept as an rpc dependency node; merged into a real service ONLY when
    `peer.service` is present and matches a real service_name.
  - unknown non-empty inferred type → external (safety net).

### 3. Rust classification function (mirror of `classifyEntity`)

New `o2_enterprise/.../service_graph/classification.rs`:
```rust
pub enum EntityKind { Service, Datastore, Queue, External, Rpc }
pub fn classify_entity(is_real_service: bool, infer_type: Option<&str>) -> EntityKind
```
Same branch order as the TS version. Unit-tested with the SAME table of cases.

### 4. Shared test vector (keep TS and Rust in sync)

A small JSON table of `{ is_real_service, infer_type, expected_kind }` rows
(checked into both repos or a shared fixtures path) drives BOTH
`serviceClassification.spec.ts` and `classification.rs` tests. If the rule changes
in one language, the other's test fails. This is how "single source of truth" is
enforced across the language boundary.

## Validation

Use the traces_tester topology-matrix stream (Phase-1b work): run the hourly
processor against it, then query `_o2_service_graph` and assert it contains the
correctly-typed edges (datastore/queue/external/rpc), that genuine deps survive
(no cache-gate drop, no anti-join over-drop), and that incident enrichment
`build_topology` returns the same node kinds the UI shows for the same stream.

## Out of scope

- The UI (Phase 1, done).
- Changing ingestion-side `infer_service_*` derivation.
- The queue topic-vs-system naming difference (tracked separately).

## Open question

Should incident enrichment eventually move to the live-traces query too (like the
UI), making `_o2_service_graph` purely a metrics/history store? Deferred — this
spec makes the stream correct so incidents work either way.
