# Service Graph — Honest Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the service graph show an honest topology — collapse per-host/per-topic dependencies into one logical node, render node *kind* from authoritative backend data, and lay dependencies out as terminal downstream leaves.

**Architecture:** Read-time grouping in the enterprise `build_topology`. Frontend drives node icons from the backend's `service_type`/`connection_type` (not name-regex) and adds a directional layered graph layout. No DB/migration/ingest changes; raw per-host names stay in the stream.

**Tech Stack:** Rust (enterprise crate, `build_topology`), Vue 3 + TypeScript + ECharts (`convertTraceData.ts`, `ServiceGraph.vue`), Vitest, `cargo test`.

## Global Constraints

- **OSS/Enterprise split:** grouping logic lives in enterprise `o2_enterprise/src/enterprise/service_graph/`; no HTTP handlers or migrations move to enterprise. Frontend is OSS.
- **No DB schema / migration / ingest changes.** `src/service/traces/inferred.rs` and the `_o2_service_graph` stream schema are untouched. Raw per-host `infer_service_name` stays in the stream.
- **Services are never grouped.** Only edges whose target is inferred (`connection_type` present: `database`/`queue`/`rpc`/`external`) are collapsed. Instrumented service→service edges keep exact identity.
- **Icon rendering method:** reuse the existing `image://` data-URL SVG approach in `convertTraceData.ts` (`getServiceIconSvg`/`buildServiceNodeSvg`). **This supersedes the spec's `path://` note** — the codebase already standardizes on `image://` and builds the health border into the SVG, so kind (icon) and health (border color) remain orthogonal.
- **Kind = icon, health = color.** Never conflate the two channels.
- Enterprise repo path (separate working dir): `/Users/ashishkolhe/Documents/github/o2-enterprise`. OSS repo: `/Users/ashishkolhe/Documents/github/openobserve`.
- Run Rust builds non-release (`cargo build`, no `--release`). Never build the UI (`npm run build`); frontend verified via Vitest only.

---

## File Structure

**Enterprise (grouping):**
- Create: `o2_enterprise/src/enterprise/service_graph/grouping.rs` — pure functions that normalize an inferred `server_service` name to a logical group key, keyed by `connection_type`. One responsibility: name→group. Independently unit-testable, no I/O.
- Modify: `o2_enterprise/src/enterprise/service_graph/mod.rs` — declare `pub mod grouping;`.
- Modify: `o2_enterprise/src/enterprise/service_graph/api.rs` — call the grouping normalizer inside `build_topology` before edge/service aggregation.

**Frontend (kinds + layout):**
- Modify: `web/src/utils/traces/convertTraceData.ts` — (a) authoritative kind→icon selection using `node.service_type`; (b) directional layered layout for the network view.
- Modify: `web/src/utils/traces/convertTraceData.spec.ts` — tests.
- Modify: `web/src/plugins/traces/ServiceGraph.vue` — legend kind counts; pass through the (now non-force) layout option.

---

## Task 1: Grouping normalizer — external domain collapse

**Files:**
- Create: `/Users/ashishkolhe/Documents/github/o2-enterprise/o2_enterprise/src/enterprise/service_graph/grouping.rs`
- Modify: `/Users/ashishkolhe/Documents/github/o2-enterprise/o2_enterprise/src/enterprise/service_graph/mod.rs`

**Interfaces:**
- Produces: `pub fn group_key(connection_type: Option<&str>, server_service: &str) -> String` — returns the logical group key for an inferred target; returns `server_service` verbatim when `connection_type` is `None` (a real service) or unrecognized.
- Produces (internal, tested): `fn collapse_external_domain(host: &str) -> String`.

- [ ] **Step 1: Write the failing test**

Create `grouping.rs` with only this test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_collapses_to_registrable_domain() {
        assert_eq!(group_key(Some("external"), "api.stripe.com"), "stripe.com");
        assert_eq!(group_key(Some("external"), "hooks.slack.com"), "slack.com");
        assert_eq!(group_key(Some("external"), "stripe.com"), "stripe.com");
        // Non-domain external (bare host / no dot) passes through unchanged.
        assert_eq!(group_key(Some("external"), "localhost"), "localhost");
    }

    #[test]
    fn service_edges_pass_through_untouched() {
        assert_eq!(group_key(None, "payment-service"), "payment-service");
        assert_eq!(group_key(Some("unknown"), "weird"), "weird");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph::grouping 2>&1 | tail -20`
Expected: FAIL — `cannot find function group_key`.

- [ ] **Step 3: Write minimal implementation**

Prepend to `grouping.rs` (above the test module):

```rust
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

//! Logical-service grouping for inferred dependencies.
//!
//! Collapses per-host / per-topic inferred targets into one logical node so the
//! service graph shows an honest shape (one `redis`, one `stripe.com`) instead
//! of a hairball. Operates purely on the already-derived `server_service` name
//! plus the record's `connection_type` — no raw span attributes are needed, so
//! it runs at read time in `build_topology` over existing stream data.

/// Return the logical group key for an inferred edge target.
///
/// `connection_type` is the edge record's inferred category
/// (`database`/`queue`/`rpc`/`external`); `None` means an instrumented
/// service→service edge, which is returned verbatim (services are never
/// grouped). Unrecognized categories also pass through unchanged.
pub fn group_key(connection_type: Option<&str>, server_service: &str) -> String {
    match connection_type {
        Some("external") => collapse_external_domain(server_service),
        _ => server_service.to_string(),
    }
}

/// Collapse a host to its registrable domain: keep the last two dot-separated
/// labels (`api.stripe.com` -> `stripe.com`). Hosts with fewer than two labels
/// (e.g. `localhost`) are returned unchanged.
fn collapse_external_domain(host: &str) -> String {
    let labels: Vec<&str> = host.split('.').filter(|s| !s.is_empty()).collect();
    if labels.len() >= 2 {
        labels[labels.len() - 2..].join(".")
    } else {
        host.to_string()
    }
}
```

Then add to `mod.rs` after the existing `pub mod` lines:

```rust
pub mod grouping;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph::grouping 2>&1 | tail -20`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/o2-enterprise
git add o2_enterprise/src/enterprise/service_graph/grouping.rs o2_enterprise/src/enterprise/service_graph/mod.rs
git commit -m "feat(service-graph): group external inferred deps by registrable domain"
```

---

## Task 2: Grouping normalizer — database / rpc host-suffix stripping

**Files:**
- Modify: `/Users/ashishkolhe/Documents/github/o2-enterprise/o2_enterprise/src/enterprise/service_graph/grouping.rs`

**Interfaces:**
- Consumes: `group_key` from Task 1.
- Produces (internal, tested): `fn collapse_host_root(name: &str) -> String` — strips instance/pod/shard suffixes from a host-like dependency name.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `grouping.rs`:

```rust
    #[test]
    fn database_strips_instance_and_shard_suffixes() {
        // Numeric instance/shard suffixes collapse to the base.
        assert_eq!(group_key(Some("database"), "redis-01"), "redis");
        assert_eq!(group_key(Some("database"), "redis-01.prod.aws"), "redis");
        assert_eq!(group_key(Some("database"), "postgres-primary-2"), "postgres-primary");
        // A clean logical name is left alone.
        assert_eq!(group_key(Some("database"), "orders-db"), "orders-db");
    }

    #[test]
    fn rpc_uses_the_same_host_root_collapse() {
        assert_eq!(group_key(Some("rpc"), "auth-rpc-03.internal"), "auth-rpc");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph::grouping 2>&1 | tail -20`
Expected: FAIL — `group_key(Some("database"), ...)` currently returns the input verbatim, so assertions mismatch.

- [ ] **Step 3: Write minimal implementation**

In `group_key`, extend the match:

```rust
pub fn group_key(connection_type: Option<&str>, server_service: &str) -> String {
    match connection_type {
        Some("external") => collapse_external_domain(server_service),
        Some("database") | Some("rpc") => collapse_host_root(server_service),
        _ => server_service.to_string(),
    }
}
```

Add below `collapse_external_domain`:

```rust
/// Collapse a host-like dependency name to its logical root by dropping the
/// domain tail (first dot-segment only) and any trailing numeric instance/shard
/// suffix (`-01`, `-2`). `redis-01.prod.aws` -> `redis`;
/// `postgres-primary-2` -> `postgres-primary`.
fn collapse_host_root(name: &str) -> String {
    // Keep only the first dot-segment (drop .prod.aws etc.).
    let head = name.split('.').next().unwrap_or(name);
    // Drop a trailing `-<digits>` instance/shard suffix if present.
    match head.rsplit_once('-') {
        Some((base, suffix)) if !base.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) => {
            base.to_string()
        }
        _ => head.to_string(),
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph::grouping 2>&1 | tail -20`
Expected: PASS (all grouping tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/o2-enterprise
git add o2_enterprise/src/enterprise/service_graph/grouping.rs
git commit -m "feat(service-graph): collapse db/rpc inferred deps to host root"
```

---

## Task 3: Grouping normalizer — queue topic collapse

**Files:**
- Modify: `/Users/ashishkolhe/Documents/github/o2-enterprise/o2_enterprise/src/enterprise/service_graph/grouping.rs`

**Interfaces:**
- Consumes: `group_key` from Tasks 1–2.
- Produces (internal, tested): `fn collapse_queue(name: &str) -> String`.

Per the spec rule: `<root>:<topic>` or `<root>/<topic>` → keep `<root>`; a bare topic name (no `:` or `/`) collapses to a single generic `"queue"` node so per-topic explosion is removed without inventing a false broker identity.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module:

```rust
    #[test]
    fn queue_keeps_broker_root_when_present() {
        assert_eq!(group_key(Some("queue"), "orders-kafka:refund-order"), "orders-kafka");
        assert_eq!(group_key(Some("queue"), "sqs/account-del"), "sqs");
    }

    #[test]
    fn queue_bare_topics_collapse_to_generic_queue() {
        // Bare topic names (the screenshot case) have no broker prefix.
        assert_eq!(group_key(Some("queue"), "refund-order"), "queue");
        assert_eq!(group_key(Some("queue"), "account_del"), "queue");
        assert_eq!(group_key(Some("queue"), "gupshup_webhook"), "queue");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph::grouping 2>&1 | tail -20`
Expected: FAIL — queue currently passes through verbatim.

- [ ] **Step 3: Write minimal implementation**

Extend the match:

```rust
        Some("queue") => collapse_queue(server_service),
```

(placed before the `_ =>` arm). Add:

```rust
/// Collapse a queue target. A `<root>:<topic>` or `<root>/<topic>` name keeps
/// its broker root; a bare topic name (no separator) collapses to a single
/// generic `queue` node rather than inventing a broker identity from an
/// arbitrary prefix.
fn collapse_queue(name: &str) -> String {
    if let Some((root, _topic)) = name.split_once([':', '/']) {
        if !root.is_empty() {
            return root.to_string();
        }
    }
    "queue".to_string()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph::grouping 2>&1 | tail -20`
Expected: PASS (all grouping tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/o2-enterprise
git add o2_enterprise/src/enterprise/service_graph/grouping.rs
git commit -m "feat(service-graph): collapse queue topics to broker root or generic queue"
```

---

## Task 4: Apply grouping inside `build_topology`

**Files:**
- Modify: `/Users/ashishkolhe/Documents/github/o2-enterprise/o2_enterprise/src/enterprise/service_graph/api.rs`

**Interfaces:**
- Consumes: `crate::enterprise::service_graph::grouping::group_key`.
- Produces: `build_topology` returns nodes/edges keyed on the grouped server name; the grouped node's `service_type` is preserved. Signature unchanged.

**Context:** In `api.rs`, `build_topology` parses each hit into `EdgeRecord { client_service, server_service, connection_type, ... }` then loops building `edge_map` and `service_stats` keyed on `(client, server)` / `server`. The change: rewrite `server` to its group key at the top of that loop, using the record's `connection_type`, so all downstream aggregation lands on the grouped identity.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `api.rs` (alongside the existing `build_topology` tests):

```rust
    #[test]
    fn build_topology_collapses_inferred_hosts_into_one_node() {
        let input = vec![
            json!({
                "client_service": "checkout",
                "server_service": "redis-01.prod",
                "connection_type": "database",
                "total_requests": 10, "failed_requests": 0,
                "p50_latency_ns": 1, "p95_latency_ns": 2, "p99_latency_ns": 3,
                "trace_stream_name": "traces"
            }),
            json!({
                "client_service": "checkout",
                "server_service": "redis-02.prod",
                "connection_type": "database",
                "total_requests": 5, "failed_requests": 0,
                "p50_latency_ns": 1, "p95_latency_ns": 2, "p99_latency_ns": 3,
                "trace_stream_name": "traces"
            }),
        ];

        let (nodes, edges) = build_topology(input, std::collections::HashMap::new());

        // checkout + one collapsed "redis" node (not redis-01/redis-02).
        assert!(nodes.iter().any(|n| n.id == "redis"));
        assert!(!nodes.iter().any(|n| n.id.starts_with("redis-0")));
        let redis = nodes.iter().find(|n| n.id == "redis").unwrap();
        assert_eq!(redis.service_type.as_deref(), Some("database"));
        // Two host edges collapsed into one; requests summed.
        let edge = edges.iter().find(|e| e.to == "redis").unwrap();
        assert_eq!(edge.total_requests, 15);
        assert_eq!(edge.connection_type.as_deref(), Some("database"));
    }

    #[test]
    fn build_topology_leaves_instrumented_services_ungrouped() {
        let input = vec![json!({
            "client_service": "frontend",
            "server_service": "backend-01.internal",
            "total_requests": 10, "failed_requests": 0,
            "p50_latency_ns": 1, "p95_latency_ns": 2, "p99_latency_ns": 3,
            "trace_stream_name": "traces"
        })];
        let (nodes, _edges) = build_topology(input, std::collections::HashMap::new());
        // No connection_type => real service => exact name preserved.
        assert!(nodes.iter().any(|n| n.id == "backend-01.internal"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph::api::tests::build_topology_collapses 2>&1 | tail -20`
Expected: FAIL — node id is `redis-01.prod`, not `redis`.

- [ ] **Step 3: Write minimal implementation**

At the top of `api.rs`, add the import:

```rust
use crate::enterprise::service_graph::grouping::group_key;
```

Inside `build_topology`, in the `for record in edge_records` loop, replace the current:

```rust
        let client = record.client_service.clone();
        let server = record.server_service.clone();
        let connection_type = record.connection_type.clone();
```

with:

```rust
        let client = record.client_service.clone();
        // Collapse inferred per-host/per-topic targets into one logical node.
        // Real service→service edges (connection_type = None) pass through.
        let server = group_key(record.connection_type.as_deref(), &record.server_service);
        let connection_type = record.connection_type.clone();
```

(The rest of the loop already keys `edge_map`/`service_stats` on `server`, so no further change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph::api 2>&1 | tail -25`
Expected: PASS — new tests pass and all pre-existing `build_topology` tests stay green.

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/o2-enterprise
git add o2_enterprise/src/enterprise/service_graph/api.rs
git commit -m "feat(service-graph): collapse inferred deps to logical nodes in build_topology"
```

---

## Task 5: Authoritative kind→icon selection (frontend)

**Files:**
- Modify: `/Users/ashishkolhe/Documents/github/openobserve/web/src/utils/traces/convertTraceData.ts`
- Modify: `/Users/ashishkolhe/Documents/github/openobserve/web/src/utils/traces/convertTraceData.spec.ts`

**Interfaces:**
- Produces: `export function iconSvgForType(serviceType: string | undefined | null): string | null` — returns the raw 24×24 SVG path string for a known kind (`database`/`queue`/`rpc`/`external`), or `null` to fall back to the existing name-regex rules.
- Consumes (existing, verified): `SERVICE_ICON_RULES` (array of `{regex, svg}`); `getServiceIconDataUrl(name, isDark, borderColor)` at line ~952 (builds the `data:image/svg+xml` URL: circle border + icon, picks `matched.svg` via `SERVICE_ICON_RULES` else `SERVER_ICON_SVG` at line 964–965); `getServiceIconSvg(name, isDark, borderColor)` at line ~978 (wraps the above with `image://`).

**Context:** Today `getServiceIconDataUrl` picks the icon by keyword-matching the node *name* (line 964). This is wrong for inferred deps whose name lacks a keyword (e.g. a redis host named `prod-cache-01`). The backend already tells us the kind via `node.service_type`. We make the icon authoritative: use `service_type` when present, fall back to name-regex only when absent (real services with no inferred type).

- [ ] **Step 1: Write the failing test**

Add to `convertTraceData.spec.ts`:

```ts
import { iconSvgForType } from "./convertTraceData";

describe("iconSvgForType (authoritative kind icons)", () => {
  it("returns a distinct icon for each inferred kind", () => {
    const db = iconSvgForType("database");
    const queue = iconSvgForType("queue");
    const rpc = iconSvgForType("rpc");
    const external = iconSvgForType("external");
    expect(db).toBeTruthy();
    expect(queue).toBeTruthy();
    expect(rpc).toBeTruthy();
    expect(external).toBeTruthy();
    // Kinds must not all map to the same glyph.
    expect(new Set([db, queue, rpc, external]).size).toBe(4);
  });

  it("returns null for a real service (no inferred type) so regex fallback runs", () => {
    expect(iconSvgForType(undefined)).toBeNull();
    expect(iconSvgForType(null)).toBeNull();
    expect(iconSvgForType("")).toBeNull();
    expect(iconSvgForType("service")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/convertTraceData.spec.ts -t "authoritative kind icons" 2>&1 | tail -15`
Expected: FAIL — `iconSvgForType` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `convertTraceData.ts`, near `SERVICE_ICON_RULES`, add (reusing existing SVG path constants where present — the database cylinder, queue share-network, rpc phone, and external globe already exist inline in `SERVICE_ICON_RULES`; extract them to named consts if not already, then reference here):

```ts
// Authoritative kind → icon. Driven by the backend's service_type/connection_type
// (database/queue/rpc/external) rather than guessing from the node name.
// Returns null when there is no inferred type (a real instrumented service),
// so the caller falls back to the name-regex SERVICE_ICON_RULES.
const KIND_ICON_SVG: Record<string, string> = {
  database:
    `<ellipse cx="12" cy="5" rx="9" ry="3"/>` +
    `<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>` +
    `<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>`,
  queue:
    `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>` +
    `<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>` +
    `<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>`,
  rpc: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.86 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  external:
    `<circle cx="12" cy="12" r="10"/>` +
    `<line x1="2" y1="12" x2="22" y2="12"/>` +
    `<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
};

export function iconSvgForType(
  serviceType: string | undefined | null,
): string | null {
  if (!serviceType) return null;
  return KIND_ICON_SVG[serviceType] ?? null;
}
```

Then, in `getServiceIconDataUrl` (line ~952, where line 965 reads `const icon = matched ? matched.svg : SERVER_ICON_SVG;`), add an optional `serviceType` param and prefer the authoritative icon:

```ts
export function getServiceIconDataUrl(
  name: string,
  isDark: boolean,
  borderColor: string,
  serviceType?: string | null,
): string {
  // ...existing body up to the `matched` line...
  const authoritative = iconSvgForType(serviceType);
  const icon = authoritative ?? (matched ? matched.svg : SERVER_ICON_SVG);
  // ...rest unchanged...
}
```

And in `getServiceIconSvg` (line ~978), add the same optional `serviceType` param and forward it:

```ts
function getServiceIconSvg(
  name: string,
  isDark: boolean,
  borderColor: string,
  serviceType?: string | null,
): string {
  return `image://${getServiceIconDataUrl(name, isDark, borderColor, serviceType)}`;
}
```

Update its two call sites (network view ~line 1111 and tree view ~line 327) to pass `node.service_type`:

```ts
const iconDataUrl = getServiceIconSvg(node.id, isDarkMode, borderColor, node.service_type);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/convertTraceData.spec.ts 2>&1 | tail -12`
Expected: PASS — new tests pass, existing `convertTraceData` tests stay green.

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/utils/traces/convertTraceData.ts web/src/utils/traces/convertTraceData.spec.ts
git commit -m "feat(service-graph): drive node icons from authoritative service_type"
```

---

## Task 6: Directional layered layout for the network (graph) view

**Files:**
- Modify: `/Users/ashishkolhe/Documents/github/openobserve/web/src/utils/traces/convertTraceData.ts`
- Modify: `/Users/ashishkolhe/Documents/github/openobserve/web/src/utils/traces/convertTraceData.spec.ts`

**Interfaces:**
- Consumes: `convertServiceGraphToNetwork(graphData, layoutType, cachedPositions?, isDarkMode?, selectedNodeId?, canvasWidth?, canvasHeight?)`.
- Produces: when `layoutType === "layered"`, nodes receive computed `x`/`fixed` placing inferred-dependency nodes (`service_type` present) at the rightmost column and entry-point services (no inbound edge) at the left. Force remains the behavior for `layoutType === "force"`.

**Context:** `convertServiceGraphToNetwork` currently hard-forces `"force"` (line ~1027) and already returns `series[0].edgeSymbol = ["none","arrow"]` unconditionally (line ~1397) — so **arrows already render; this task does NOT touch `edgeSymbol`.** The change is purely the `"layered"` rank-based positioning. `layout` stays `"none"` (line ~1338) since we set explicit `x`/`fixed`. Rank assignment: rank 0 = nodes with no inbound edge; each node's rank = 1 + max(rank of its predecessors); inferred nodes (`service_type` truthy) are forced to the max rank so they are always terminal leaves. Break cycles via the `seen` guard during ranking.

- [ ] **Step 1: Write the failing test**

Add to `convertTraceData.spec.ts`:

```ts
import { convertServiceGraphToNetwork } from "./convertTraceData";

describe("convertServiceGraphToNetwork layered layout", () => {
  const graph = {
    nodes: [
      { id: "frontend", label: "frontend", requests: 100, errors: 0 },
      { id: "checkout", label: "checkout", requests: 80, errors: 0 },
      { id: "redis", label: "redis", requests: 50, errors: 0, service_type: "database" },
    ],
    edges: [
      { from: "frontend", to: "checkout", total_requests: 80 },
      { from: "checkout", to: "redis", total_requests: 50, connection_type: "database" },
    ],
  };

  it("places the inferred dependency to the right of the services that call it", () => {
    const opt: any = convertServiceGraphToNetwork(graph, "layered", undefined, true);
    const series = opt.options.series[0];
    const byId: Record<string, any> = {};
    series.data.forEach((n: any) => (byId[n.id] = n));
    // redis (inferred) must be the rightmost.
    expect(byId["redis"].x).toBeGreaterThan(byId["checkout"].x);
    expect(byId["checkout"].x).toBeGreaterThan(byId["frontend"].x);
    expect(byId["redis"].fixed).toBe(true);
  });

  it("keeps the existing directional arrow on edges", () => {
    // edgeSymbol is already set unconditionally by the function; assert we did
    // not regress it while adding the layered branch.
    const opt: any = convertServiceGraphToNetwork(graph, "layered", undefined, true);
    expect(opt.options.series[0].edgeSymbol).toEqual(["none", "arrow"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/convertTraceData.spec.ts -t "layered layout" 2>&1 | tail -15`
Expected: FAIL — layout is forced to `"force"`, no `x`/`fixed`, `edgeSymbol` not `['none','arrow']`.

- [ ] **Step 3: Write minimal implementation**

In `convertServiceGraphToNetwork`, replace the hard `const normalizedLayoutType = "force";` block with acceptance of `"layered"`:

```ts
  const normalizedLayoutType =
    layoutType === "layered" ? "layered" : "force";
```

Add a rank computation before building `nodes` (after `validNodes` is known):

```ts
  // Layered ranks: rank 0 = no inbound edge; rank = 1 + max(pred ranks).
  // Inferred deps (service_type present) are pinned to the max rank so they are
  // always terminal downstream leaves. Back-edges (to a not-yet-higher rank)
  // are ignored to break cycles.
  const rank = new Map<string, number>();
  if (normalizedLayoutType === "layered") {
    const preds = new Map<string, string[]>();
    validNodes.forEach((n: any) => preds.set(n.id, []));
    graphData.edges.forEach((e: any) => {
      if (preds.has(e.to)) preds.get(e.to)!.push(e.from);
    });
    const visit = (id: string, seen: Set<string>): number => {
      if (rank.has(id)) return rank.get(id)!;
      if (seen.has(id)) return 0; // cycle guard
      seen.add(id);
      const ps = preds.get(id) || [];
      const r = ps.length ? 1 + Math.max(...ps.map((p) => visit(p, seen))) : 0;
      rank.set(id, r);
      return r;
    };
    validNodes.forEach((n: any) => visit(n.id, new Set()));
    const maxRank = Math.max(0, ...Array.from(rank.values()));
    validNodes.forEach((n: any) => {
      if (n.service_type) rank.set(n.id, maxRank); // deps are terminal leaves
    });
  }
```

When building each `nodeData` in the `.map`, add layered positioning:

```ts
    if (normalizedLayoutType === "layered") {
      const r = rank.get(node.id) ?? 0;
      const colGap = canvasWidth / (Math.max(1, Math.max(...rank.values())) + 1);
      nodeData.x = colGap * (r + 0.5);
      nodeData.fixed = true;
    }
```

Do **not** touch `edgeSymbol` — it is already `["none","arrow"]` unconditionally (line ~1397), so arrows already render.

Relax the early `console.warn` for non-force layouts so `"layered"` no longer warns: change the guard from `if (layoutType !== normalizedLayoutType)` to only warn when `layoutType` is neither `"force"` nor `"layered"`.

**Important:** the existing force-only positioning block is guarded by `if (normalizedLayoutType === "force" && !hasPositions)` (line ~1291), so it will correctly skip for `"layered"`. Ensure the layered `x`/`fixed` assignment happens in the node `.map` (or a follow-up `nodes.forEach`) and that `layoutMode` stays `"none"` (line ~1338) — no change needed there since explicit positions use `"none"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/convertTraceData.spec.ts 2>&1 | tail -12`
Expected: PASS — layered tests pass; existing force-layout tests stay green.

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/utils/traces/convertTraceData.ts web/src/utils/traces/convertTraceData.spec.ts
git commit -m "feat(service-graph): add layered directional layout with terminal deps"
```

---

## Task 7: Make layered the default + legend kind counts (ServiceGraph.vue)

**Files:**
- Modify: `/Users/ashishkolhe/Documents/github/openobserve/web/src/plugins/traces/ServiceGraph.vue`
- Modify: `/Users/ashishkolhe/Documents/github/openobserve/web/src/plugins/traces/ServiceGraph.spec.ts`
- Modify: `/Users/ashishkolhe/Documents/github/openobserve/web/src/locales/languages/en.json`

**Interfaces:**
- Consumes: `convertServiceGraphToNetwork(..., "layered", ...)` from Task 6, `filteredGraphData` (has `.nodes` with `service_type`).
- Produces: a `kindCounts` computed (`{ service, database, queue, rpc, external }`) rendered in the legend; the network view is invoked with `"layered"` by default.

**Context:** `chartData` (line ~356) calls `convertServiceGraphToNetwork(filteredGraphData.value, layoutType, ...)` where `layoutType = searchObj.meta.serviceGraphLayoutType`. Change the effective default passed for graph view to `"layered"` unless the user explicitly chose force. Add a legend showing kind counts using the same taxonomy as the Service Catalog.

- [ ] **Step 1: Write the failing test**

Add to `ServiceGraph.spec.ts` (follow its existing mount pattern):

```ts
it("counts nodes by kind for the legend", async () => {
  const wrapper = mountServiceGraph(); // existing helper
  await flushPromises();
  wrapper.vm.filteredGraphData = {
    nodes: [
      { id: "a", label: "a", requests: 1, errors: 0 },
      { id: "b", label: "b", requests: 1, errors: 0, service_type: "database" },
      { id: "c", label: "c", requests: 1, errors: 0, service_type: "external" },
    ],
    edges: [],
  };
  await flushPromises();
  expect(wrapper.vm.kindCounts).toEqual({
    service: 1, database: 1, queue: 0, external: 1, rpc: 0,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/plugins/traces/ServiceGraph.spec.ts -t "counts nodes by kind" 2>&1 | tail -15`
Expected: FAIL — `kindCounts` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `ServiceGraph.vue` `<script setup>`/`setup()`, add:

```ts
const kindCounts = computed(() => {
  const counts = { service: 0, database: 0, queue: 0, external: 0, rpc: 0 };
  for (const n of filteredGraphData.value.nodes) {
    const t = (n as any).service_type;
    if (t === "database") counts.database++;
    else if (t === "queue") counts.queue++;
    else if (t === "external") counts.external++;
    else if (t === "rpc") counts.rpc++;
    else counts.service++;
  }
  return counts;
});
```

Expose `kindCounts` from `setup()` (add to the returned object). In `chartData`, make graph view default to layered:

```ts
      : convertServiceGraphToNetwork(
          filteredGraphData.value,
          layoutType === "force" ? "force" : "layered",
          new Map(),
          store.state.theme === 'dark',
          undefined,
          graphContainerRef.value?.clientWidth || 1200,
          graphContainerRef.value?.clientHeight || 700,
        );
```

In the legend markup (the `data-test="service-graph-legends"` block near line 36), render kind counts using existing i18n keys:

```html
<span data-test="service-graph-kind-counts" class="text-[0.7rem] text-[var(--o2-text-4)]">
  {{ kindCounts.service }} {{ t('traces.servicesCatalog.types.service') }} ·
  {{ kindCounts.database }} {{ t('traces.servicesCatalog.types.datastore') }} ·
  {{ kindCounts.queue }} {{ t('traces.servicesCatalog.types.queue') }} ·
  {{ kindCounts.external }} {{ t('traces.servicesCatalog.types.external') }} ·
  {{ kindCounts.rpc }} {{ t('traces.servicesCatalog.types.rpc') }}
</span>
```

(The `traces.servicesCatalog.types.*` keys already exist from the Service Catalog work — no new i18n needed. If a `datastore`/`database` label mismatch surfaces, reuse `types.datastore`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/plugins/traces/ServiceGraph.spec.ts 2>&1 | tail -12`
Expected: PASS — new test passes; existing ServiceGraph tests stay green.

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/plugins/traces/ServiceGraph.vue web/src/plugins/traces/ServiceGraph.spec.ts web/src/locales/languages/en.json
git commit -m "feat(service-graph): default to layered layout + kind counts in legend"
```

---

## Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Enterprise Rust tests**

Run: `cd /Users/ashishkolhe/Documents/github/o2-enterprise && cargo test -p o2_enterprise service_graph 2>&1 | tail -20`
Expected: all `service_graph::grouping` and `service_graph::api` tests PASS.

- [ ] **Step 2: OSS build compiles with enterprise feature**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve && cargo build --features enterprise 2>&1 | tail -15`
Expected: builds (no `--release`).

- [ ] **Step 3: Frontend unit tests**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/convertTraceData.spec.ts src/plugins/traces/ServiceGraph.spec.ts src/plugins/traces/ServicesCatalog.spec.ts 2>&1 | tail -12`
Expected: all PASS.

- [ ] **Step 4: Frontend typecheck**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "convertTraceData|ServiceGraph" | head; echo "clean if empty"`
Expected: no errors for changed files.

- [ ] **Step 5: Commit any final fixes**

```bash
# Only if steps above required fixes:
cd /Users/ashishkolhe/Documents/github/openobserve
git add -A && git commit -m "test(service-graph): verify honest-topology suite green"
```

---

## Self-Review Notes

- **Spec coverage:** §1 grouping → Tasks 1–4; §2 kinds/icons → Task 5; §3 directional layout → Tasks 6–7; §4 legend kind counts → Task 7; health-colored edges already exist in `convertServiceGraphToNetwork` (border color by error rate) and are preserved — no separate task needed (noted here so it isn't mistaken for a gap).
- **Deferred items** (focus view, incident highlighting, node expansion, latency overlays) are intentionally absent per spec.
- **`path://` vs `image://`:** the spec proposed `path://`; the codebase already uses `image://` data-URLs with the health border baked in. The plan follows the codebase (documented in Global Constraints) — kind/health remain orthogonal because the border color is a separate SVG element from the icon stroke.
- **Type consistency:** `iconSvgForType` (Task 5), `group_key` (Tasks 1–4), `kindCounts` (Task 7), `"layered"` layout string (Tasks 6–7) are used consistently across tasks.
- **Corrections made during self-review against real code:**
  1. Task 5 referenced a non-existent `buildServiceNodeSvg`; the real functions are `getServiceIconDataUrl` (line ~952) and `getServiceIconSvg` (line ~978). Fixed to thread `serviceType` through both.
  2. Task 6 originally added `edgeSymbol`; it already exists unconditionally (line ~1397). Removed that addition — task now only adds layered positioning and asserts the arrow isn't regressed.
  3. Confirmed the returned option shape is `{ options: { series: [{ type:"graph", data, links }] } }` and `layout` stays `"none"` for explicit positions — Task 6 assertions and implementation match.
