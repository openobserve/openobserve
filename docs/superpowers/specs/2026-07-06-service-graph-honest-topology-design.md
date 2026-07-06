# Service Graph — Honest Topology Redesign

**Date:** 2026-07-06
**Branch:** `service_graph_fixes`
**Status:** Approved design, pending implementation plan

## Problem

The service graph does not answer the question a user actually arrives with. Its
core failure is not that it is ugly — it is that the **topology it shows is
dishonest**: it misrepresents the shape of the system. No amount of prettier
layout, focus views, or health highlighting matters until the map is truthful.

Evidence (from production screenshots and the code):

1. **Dependencies render identically to services.** In
   `o2_enterprise/src/enterprise/service_graph/api.rs` (`build_topology`), every
   node is the same `ServiceNode`. A redis host, `google.com`, and a `payment`
   service are drawn the same way. The user cannot tell "my code" from "a
   datastore I call" from "a third party."
2. **Identity is per-host/per-topic, so one logical dependency becomes many
   nodes.** `src/service/traces/inferred.rs` derives the inferred name from
   `db.namespace`/host, messaging `destination`/host, or raw host. Result:
   redis behind 5 hosts → 5 nodes; a queue with 40 topics → 40 nodes; every
   external host its own node. The graph claims these are distinct dependencies
   when they are one system. This is the "1000 external APIs = hairball"
   problem, and it is a *topology* bug, not mere clutter.
3. **No sense of direction / entry points.** The graph is rendered essentially
   undirected. Downstream dependencies float as peers of the services that call
   them, instead of appearing as terminal, downstream leaves.
4. **Inferred nodes can duplicate real services** on partial/near name matches
   (the existing anti-join only catches exact matches).

**Guiding principle:** get the topology honest first; insights come after.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Unit of a "dependency" node | **Logical service** — group by `peer.service`, else `db.namespace` / messaging destination-root / external registrable domain. One `redis`, one `kafka:orders`, one `stripe.com`. |
| Where grouping is computed | **Read-time, in enterprise `build_topology`.** Applies to all existing data immediately, reversible, no re-ingest. `inferred.rs` and the stream schema stay untouched; raw per-host names are preserved in-stream for future drill-in. |
| Node-kind visual encoding | **Icons.** Kind = icon (shape channel), health = color (color channel). Two orthogonal channels. |
| Icon rendering method | **ECharts `symbol: 'path://<svg-path>'`** using SVG paths extracted from the Material Symbols icons the app already uses. Vector (crisp at any zoom), recolorable via `itemStyle.color` (so health color stays orthogonal), cheap. Trade-off accepted: single-color glyphs only — correct for kind indicators. |
| Layout | **Layered directional (left→right)** as the new default. Inferred deps are terminal leaves. Force layout remains available as an option. |
| Insights scope | Topology-honesty first. Only cheap insights ride along now (kind counts in legend, health-colored edges). Focus view, incident highlighting, node expansion, latency overlays are **deferred** to future specs. |

## Design

### Section 1 — Logical-service grouping in `build_topology`

**Layer:** enterprise, read-time. `o2_enterprise/src/enterprise/service_graph/api.rs`.
The processor SQL (`src/service/traces/service_graph/processor.rs`) is unchanged —
it keeps emitting per-host edges; `build_topology` collapses them.

**Constraint that shapes the approach:** the `_o2_service_graph` stream stores only
`client_service`, `server_service`, `connection_type` — **not** `db.namespace`,
`messaging.destination`, or raw host parts. Therefore grouping is
**string-normalization on `server_service`, keyed by `connection_type`**, applied
*before* the `edge_map` / `service_stats` aggregation:

- `connection_type = external` → collapse `server_service` to its **registrable
  domain** (`api.stripe.com` → `stripe.com`).
- `connection_type = database` or `rpc` → strip **instance/pod suffixes and
  numeric shards** from the host-like name (`redis-01.prod.aws` → `redis`).
- `connection_type = queue` → collapse **sibling topics under one broker node**.
  Rule (explicit): strip a trailing topic segment when the name is of the form
  `<root>:<topic>` or `<root>/<topic>` → keep `<root>`; otherwise (a bare topic
  name like `refund-order` with no broker prefix) group all such bare queue
  targets that share the same **producing service** under a single
  `queue` node labeled by the messaging system when known, else a generic
  `queue` node. This avoids inventing a false broker identity from an
  arbitrary common prefix.
- **Instrumented service→service edges (`connection_type` absent) are NEVER
  grouped** — real services keep exact identity.

The derived `group_key` becomes the node identity; edges re-aggregate onto the
grouped key (summing requests/errors, max latencies, as `build_topology` already
does). The group's `service_type`/`connection_type` is preserved.

**Honesty caveat:** this is heuristic (regex/domain rules on names), not
attribute-perfect. If attribute-perfect grouping is later required, that is the
deferred "add `infer_service_group` at ingest" change.

### Section 2 — Node kinds rendered as icons (frontend)

**Layer:** frontend. `web/src/plugins/traces/ServiceGraph.vue` + a new static
icon-path map.

`ServiceNode.service_type` (`database`/`queue`/`rpc`/`external`/none) and
`ServiceEdge.connection_type` already reach the frontend and are currently
ignored visually. This section renders them.

| Kind | Icon (from existing Material Symbols) | Style |
|---|---|---|
| Service (instrumented) | service dot / circle | solid |
| Database | `database` | dotted border |
| Queue | `storage` / envelope glyph | dotted border |
| RPC | `dns` / plug glyph | dotted border |
| External | `cloud` / globe glyph | dotted border |

- **Icon method:** `symbol: 'path://…'`, path strings extracted once into a
  `{ database: "M…", queue: "M…", rpc: "M…", external: "M…" }` map.
- **Kind = icon, health = color.** Icon recolors via `itemStyle.color` using the
  existing `--o2-service-health-*` tokens. Dotted border = inferred (not
  instrumented); solid = a real service emitting spans.
- **Legend** gains the kinds (Service / Database / Queue / RPC / External)
  alongside the existing health legend.
- The **tree view** gets the same glyph treatment on its nodes.

### Section 3 — Directional, downstream-honest layout (frontend)

**Layer:** frontend. `ServiceGraph.vue` + tree composables
(`useServiceGraphTree.ts`, `useTreeVisualization.ts`).

**Rule:** requests flow **left → right** (horizontal) / top → down (vertical).
Instrumented services are sources/intermediates; inferred dependencies are
**always terminal leaves** on the right — flowed *into*, never out; never a root.

- **Graph view:** default changes from undirected force to a **layered directed**
  layout. Edges render `symbol: ['none','arrow']`. Inferred nodes pin to the
  rightmost rank (they have no outgoing edges — the SQL only makes them edge
  targets). Entry-point services (`from = null`) anchor the left.
- **Tree view:** already hierarchical — ensure inferred deps sort to the leaf
  level and root = entry-point services.
- **Layout toggle** (Horizontal / Vertical / Force) stays; the layered
  directional layout becomes the **default**, force remains available.
- **Cycles:** real systems have `A ↔ B`. Choose primary flow per edge by
  request-volume/direction; render back-edges as curved/dashed rather than
  forcing a false hierarchy.

### Section 4 — Insights layer (thin, mostly deferred)

**In scope now (cheap, ride on honest topology):**
- **Kind counts in the legend** — "12 services · 2 datastores · 1 queue · 5
  external · 8 rpc" — same taxonomy as the Service Catalog, so the two screens
  agree.
- **Health-colored edges** — edge color by `error_rate`/`failed_requests` (data
  already present), so a red path is visible at a glance.

**Explicitly deferred (future specs):** single-service focus view
("N upstream / M downstream"); incident-first highlighting/dimming;
expand-a-collapsed-node to reveal instances/topics (raw `infer_service_name` is
preserved in-stream, so this stays possible); latency-trend overlays.

## Summary table

| § | Change | Layer | File(s) |
|---|---|---|---|
| 1 | Logical-service grouping (collapse per-host/topic → one dep) | Enterprise, read-time | `service_graph/api.rs` (`build_topology`) |
| 2 | Node kinds rendered as `path://` icons; kind=icon, health=color | Frontend | `ServiceGraph.vue`, new icon-path map |
| 3 | Layered directional layout; inferred deps = terminal leaves (new default) | Frontend | `ServiceGraph.vue`, tree composables |
| 4 | Kind counts in legend + health-colored edges | Frontend | `ServiceGraph.vue` |

## Architecture boundaries (OSS / Enterprise split)

- Grouping logic stays in **enterprise** `build_topology`, called from OSS —
  consistent with the existing split (business logic in enterprise, handlers/
  routes in OSS).
- **No DB schema / migration changes.** Stream schema untouched.
- **`inferred.rs` untouched.** Raw per-host `infer_service_name` preserved
  in-stream for future drill-in.
- Frontend changes are OSS.

## Testing

- **Unit (enterprise, grouping normalizer):** external domain collapse; database/
  rpc host-suffix + numeric-shard stripping; queue topic-root collapse;
  services-never-grouped; grouped edge re-aggregation (sum requests/errors, max
  latencies); `service_type` preserved on grouped node.
- **Frontend:** kind → icon-path mapping for each kind; inferred nodes render as
  terminal leaves (no outgoing edges); legend shows kind counts; edges colored by
  health.
- **Regression:** existing `build_topology` tests and `ServiceGraph.spec.ts`
  stay green.

## Out of scope

Everything under "deferred" in Section 4; any ingest-side (`inferred.rs`) or
stream-schema change; the Service Catalog (already shipped on this branch).
