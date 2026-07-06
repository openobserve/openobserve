# Service Graph — Adaptive Dependency Collapse

**Date:** 2026-07-07
**Branch:** `service_graph_fixes`
**Status:** Design, pending plan
**Layer:** Frontend only (`web/src/plugins/traces/ServiceGraph.vue` + graph render
utils). No backend change — `_o2_service_graph` keeps returning the complete,
classified topology; this is purely how the UI *presents* it.

## Problem

The graph renders one node per entity. Real systems have hundreds/thousands of
inferred dependencies (external APIs, DBs, queues, rpc). Showing them all makes
the graph an unreadable hairball — demonstrated by pushing the traces_tester to
emit 23 external nodes, which cluttered the view. "Render everything" never
scales; the graph must show important structure and progressively disclose the
rest.

## Principle

Services ARE the topology the user wants to see; inferred dependencies are
context. So: **never collapse services; adaptively collapse the dependency
fan-out** into typed boundary nodes when the graph gets large, with user controls
to drill in or change density. The graph is clean by default and detailed on
demand.

## Design

### Trigger — total-node threshold

- Config: `COLLAPSE_NODE_THRESHOLD` (default 40).
- When `nodes.length > threshold`, auto-collapse inferred-dependency nodes
  (`service_type` in `database`/`queue`/`external`/`rpc`) into per-kind boundary
  nodes. When `<= threshold`, render everything as today.
- Services (`service_type` == none) are never collapsed.

### Collapsed boundary node

- One synthetic node per collapsed kind, e.g. id `__group_external`, label
  `External (23)`, `service_type = external`, `is_group = true`, `member_count`.
- Edges that pointed at any member are rewired to point at the boundary node
  (deduped, request counts summed). So `checkout → api.stripe.com` and
  `checkout → api.github.com` become one `checkout → External(23)` edge.
- Rendered like a normal node (kind icon + count badge), visually marked as a
  group (e.g. stacked/rounded frame) so it reads as expandable.

### User controls (toolbar + interaction)

1. **Expand a group inline.** Clicking a boundary node toggles that ONE kind
   between collapsed and expanded (its members + their real edges reappear).
   State held in a `Set<expandedKind>`; re-render on toggle. Other groups stay
   collapsed.
2. **Global show-all / collapse-all toggle.** A toolbar control with three
   states: `Auto` (threshold-driven, default), `Expanded` (force everything
   shown, accept clutter), `Collapsed` (force all deps collapsed regardless of
   count). Overrides the threshold.
3. **Per-kind visibility toggles.** Checkboxes per kind (Service / Datastore /
   Queue / External / RPC) to hide a whole category from the graph. Reuses the
   Service Catalog's kind-filter concept. Hidden kinds drop their nodes AND edges
   to them. (Service is toggleable too but on by default.)

### Rendering pipeline (where it slots in)

`graphData` (from the backend topology, unchanged) → **a new pure transform
`applyGraphCollapse(graphData, { mode, expandedKinds, hiddenKinds, threshold })`**
→ `{ nodes, edges }` for the existing `convertServiceGraphToNetwork` /
`convertServiceGraphToTree`. The transform:
1. Drops nodes/edges of hidden kinds.
2. Decides collapse per `mode` (auto → threshold check; expanded → none;
   collapsed → all dep kinds) minus any kind in `expandedKinds`.
3. For each collapsed kind, replaces its member nodes with one boundary node and
   rewires+aggregates edges.

**Simplifying invariant:** inferred dependencies are terminal downstream leaves —
they are only ever the *target* of an edge, never the source (the backend only
emits `service → dep` and `topic → service`; a dep node has no outgoing edges).
So a boundary node only ever has **incoming** edges to rewire. The queue TOPIC is
the one node with both an incoming (producer) and outgoing (consumer) edge — but
a topic collapsed under the `queue` boundary keeps both its in- and out-edges
rewired to the boundary, so `service → Queues(n) → consumer` still reads
correctly. No general two-directional edge merging is needed beyond this.

Pure and unit-testable in isolation (like the old `buildTopologyFromTraces`),
separate from the Vue component.

## Interfaces

```ts
type CollapseMode = "auto" | "expanded" | "collapsed";
interface CollapseState {
  mode: CollapseMode;
  expandedKinds: Set<string>;   // kinds the user drilled into
  hiddenKinds: Set<string>;     // kinds hidden entirely
  threshold: number;
}
function applyGraphCollapse(
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] },
  state: CollapseState,
): { nodes: GraphNode[]; edges: GraphEdge[] };
```

Boundary node: `{ id: "__group_<kind>", label: "<Kind> (<n>)", service_type: <kind>, is_group: true, member_count: n, requests, errors }`.

## Testing

- **Unit (`applyGraphCollapse.spec.ts`):**
  - under threshold → unchanged.
  - over threshold in `auto` → each dep kind becomes one boundary node with
    correct count; services untouched.
  - edges to members rewired to the boundary node, request counts summed, deduped.
  - `expandedKinds` containing a kind → that kind stays expanded while others
    collapse.
  - `mode = expanded` → nothing collapses regardless of count; `mode = collapsed`
    → all dep kinds collapse regardless of count.
  - `hiddenKinds` → those nodes and their edges removed.
  - collapsing never touches service nodes.
- **Component:** clicking a boundary node toggles its kind in `expandedKinds`;
  toolbar mode toggle switches `mode`; kind checkboxes update `hiddenKinds`.
- **Regression:** existing `ServiceGraph.spec.ts` stays green (default `auto`
  mode with a small graph collapses nothing).

## Out of scope / future

- **Focus mode** (one service + its up/downstream) — the other big scaling lever,
  a separate future spec. Collapse is the foundation it would build on.
- **Provider grouping** (Stripe/AWS) — a finer collapse granularity that can be
  added as an expand-one-level step later.
- Backend changes — none; the topology stays complete server-side.
