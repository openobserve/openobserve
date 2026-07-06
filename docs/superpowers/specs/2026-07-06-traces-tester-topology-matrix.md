# Enhance traces_tester to Emit the Full Topology Matrix

**Date:** 2026-07-06
**Repo:** `/Users/ashishkolhe/Documents/github/traces_tester` (separate repo, Rust)
**Status:** Design, pending plan
**Purpose:** Produce realistic OTLP traces exercising EVERY dependency-classification
case, so the shared `classifyEntity` rule (see
`2026-07-06-service-entity-classification-single-source.md`) can be validated
end-to-end — not just against otel_demo, which is missing several cases.

## Why traces_tester (verified)

Assessed thoroughly. traces_tester is a Rust, config-driven OTLP generator that:
- **Builds real cross-service parent/child traces** (NOT flat load-test spans):
  `trace_generator.rs` finds SERVER spans whose parent is in a different service
  and synthesizes a wrapping CLIENT span in the caller service, then re-parents
  (lines ~420-545). This produces the `client(A) → server(B)` linkage our
  service-edge self-join needs.
- Emits OTLP with correct `SpanKind` (Client=3, Producer=4, Consumer=5), and some
  semconv (`db.system=postgresql`, `peer.service`, external `base_url`s to real
  third-party hosts: stripe/sendgrid/twilio/sagemaker).
- Topology is config-driven: `dependencies.toml` (`[dependencies.graph]` = edges,
  `call_patterns` = flows, `[dependencies.external]` = third-party).

## Gaps to close (what it does NOT do today)

| Classification case | Status | Fix |
|---|---|---|
| Cross-service call type variety | ❌ hardcodes `rpc.service`+`peer.service` on EVERY inter-service client span (`trace_generator.rs:460-461`) | Make the call type per-edge: http / grpc(rpc) / plain-service, driven by config |
| db `redis` | ⚠️ uses non-standard `cache.system=redis` (OTel inference reads `db.system`) | Emit `db.system=redis` |
| db `mysql`/`mongodb` | ❌ | Add span templates |
| Messaging (kafka) producer/consumer | ❌ no `messaging.system`/`messaging.destination.name` spans | Add producer (kind 4) + consumer (kind 5) span templates on a topic |
| Genuine uninstrumented RPC backend | ❌ (every rpc target is also a real service) | Add an rpc call to a peer that has NO server spans of its own |
| Collision (real service also reached via HTTP) | ❌ not modeled by design | Add an HTTP client call whose `peer.service`/host equals a real instrumented service name |
| Unknown `infer_service_type` (semconv drift) | ❌ | Emit a client span with e.g. `db.system=cache` or a novel peer that inference types as something new — OR document that this case is unit-tested at the classify layer only |

## Design

### Config model extension (`dependencies.toml`)

Add a per-dependency **type** so the generator knows what kind of call each edge
is, instead of always tagging rpc:

```toml
[dependencies.edge_types]
# service -> [{ target, type, system, destination? }]
"order-service" = [
  { target = "inventory-service", type = "rpc",   system = "grpc" },
  { target = "orders-db",         type = "database", system = "postgresql" },
  { target = "cache",             type = "database", system = "redis" },
  { target = "orders-topic",      type = "queue",  system = "kafka", destination = "orders" },
  { target = "api.stripe.com",    type = "external" },
  { target = "legacy-billing",    type = "rpc",    system = "grpc", uninstrumented = true },
  { target = "email-service",     type = "http",   collision = true },  # email-service is ALSO a real service
]
```

- `type = database` → client span carries `db.system=<system>` (+ `db.namespace`).
- `type = queue` → a PRODUCER span (kind 4) with `messaging.system=<system>` +
  `messaging.destination.name=<destination>` in the caller, AND a CONSUMER span
  (kind 5) with the same attrs in a separate consumer service (async, separate
  trace) — reproducing the `checkout→orders→fraud-detection` shape.
- `type = rpc` → client span with `rpc.system=<system>` + `rpc.service`. If
  `uninstrumented = true`, do NOT generate any server/self spans for the target
  (it becomes a genuine inferred-only rpc backend with no matching service).
- `type = external` → client span with `server.address`/`http.url` = the host,
  `http.request.method`, no `peer.service` → inference types it `external`.
- `type = http` + `collision = true` → client span whose `server.address` /
  `peer.service` equals an existing instrumented service name (so it's inferred
  `external` but ALSO a real service → the collision case).

### Generator changes (`trace_generator.rs`, `config.rs`)

- Replace the hardcoded rpc tagging in the cross-service client-span synthesis
  (~line 460) with a lookup of the edge's `type`/`system` from the new config,
  attaching the matching semconv attributes.
- Add PRODUCER/CONSUMER span generation for `queue` edges (currently only
  client/server are synthesized).
- For `uninstrumented` rpc targets, skip creating the target's own service spans
  so it appears only as an inferred name.

### Validation harness (new)

A small script / test that:
1. Runs the enhanced generator against a fresh OpenObserve test stream
   (`topology_matrix`).
2. Runs the same diagnostic queries we used on otel_demo (the `is_real_service`
   flag query, the inferred-entity list, the rpc-vs-service-edge cross-check).
3. Asserts the stream contains at least one entity in EVERY classification bucket:
   real-service, database, queue(topic), external(genuine), rpc(redundant),
   rpc(genuine-uninstrumented), collision, and (if modeled) unknown-type.

This proves the generator produces the full matrix, which then becomes the
end-to-end fixture for validating `classifyEntity`.

## Success criteria

Querying the `topology_matrix` stream yields at minimum:
- ≥1 genuine database via `db.system` (postgres, redis, mysql).
- ≥1 kafka topic with BOTH producer and consumer spans (async reconnect case).
- ≥1 genuine external third-party host (stripe) with no matching service.
- ≥1 rpc target that IS a real service (redundant → drop).
- ≥1 rpc target that is NOT a real service (genuine uninstrumented backend).
- ≥1 collision: a name that is both a real service AND inferred external.

## Open question this data will force (important)

The **genuine uninstrumented RPC** case is not just test coverage — it exposes a
real product decision the classification spec currently side-steps. Today's rule
drops ALL non-real rpc as "redundant." That is correct ONLY when the rpc target
is an instrumented service reachable another way (true for 100% of otel_demo).
But a *genuinely* uninstrumented rpc backend (no matching service, no other edge)
is a **real dependency** — dropping it would hide it.

Once traces_tester can produce this case, we must decide:
- **Keep the current drop** (accept that genuine uninstrumented rpc is invisible),
  relying on the drop-telemetry debug log to surface it; OR
- **Refine the rule:** drop rpc ONLY when a matching real service exists (the
  proven-redundant case); show it as an rpc/dependency node otherwise.

The second is more correct. This spec deliberately generates the case so we can
validate whichever rule we choose against real data instead of assuming. Flagging
here so it is decided explicitly, not silently.

## Out of scope

- The `classifyEntity` refactor itself (separate spec) — this spec only produces
  the data to validate it.
- Changes to OpenObserve ingestion/inference.
- Load/throughput tuning of the generator (unchanged).
