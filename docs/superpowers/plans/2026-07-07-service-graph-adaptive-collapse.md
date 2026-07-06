# Service Graph Adaptive Collapse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the service graph exceeds a node threshold, auto-collapse inferred dependencies (external/database/queue/rpc) into per-kind boundary nodes, with user controls to expand a group, hide kinds, and override the collapse mode — keeping the overview readable while the backend topology stays complete.

**Architecture:** Pure `applyGraphCollapse(graphData, state)` transform slotted into `applyFilters` in `ServiceGraph.vue`, feeding the existing renderer. Frontend-only; no backend change.

**Tech Stack:** Vue 3 + TypeScript + ECharts, Vitest.

## Global Constraints

- **Frontend-only.** Backend `_o2_service_graph` / `/topology/current` unchanged — it returns the complete classified topology; this only changes presentation.
- **Services are never collapsed** (`service_type` falsy). Only inferred deps (`database`/`queue`/`external`/`rpc`) collapse.
- **Inferred deps are terminal leaves** (only edge targets), EXCEPT a queue topic which has both an incoming producer edge and outgoing consumer edge — a collapsed queue boundary keeps both directions rewired.
- Repo: `/Users/ashishkolhe/Documents/github/openobserve`. Verify via Vitest + `vue-tsc`; never `npm run build`.
- Reuse the kind vocabulary already in use: node `service_type` values `database`/`queue`/`external`/`rpc`, falsy = service.

## File Structure

- **Create:** `web/src/utils/traces/applyGraphCollapse.ts` — the pure transform. One responsibility: given topology + collapse state, return the collapsed/filtered `{nodes, edges}`. No Vue, no I/O.
- **Create:** `web/src/utils/traces/applyGraphCollapse.spec.ts` — unit tests.
- **Modify:** `web/src/plugins/traces/ServiceGraph.vue` — collapse state refs, call the transform in `applyFilters`, boundary-node click → expand, toolbar controls (mode toggle + per-kind checkboxes).
- **Modify:** `web/src/plugins/traces/ServiceGraph.spec.ts` — component tests for the controls.

## Shared interfaces

```ts
export type CollapseMode = "auto" | "expanded" | "collapsed";
export interface CollapseState {
  mode: CollapseMode;
  expandedKinds: Set<string>;   // kinds the user drilled into
  hiddenKinds: Set<string>;     // kinds hidden entirely
  threshold: number;            // total-node count that triggers auto-collapse
}
export interface GNode {
  id: string; label: string; requests: number; errors: number;
  service_type?: string; is_group?: boolean; member_count?: number;
  [k: string]: any;
}
export interface GEdge {
  from: string | null; to: string;
  total_requests: number; failed_requests: number; [k: string]: any;
}
// Boundary node id convention:
export const GROUP_PREFIX = "__group_";       // e.g. "__group_external"
const DEP_KINDS = ["database", "queue", "external", "rpc"];
```

---

## Task 1: Hidden-kind filtering + no-op under threshold

**Files:**
- Create: `web/src/utils/traces/applyGraphCollapse.ts`
- Create: `web/src/utils/traces/applyGraphCollapse.spec.ts`

**Interfaces:**
- Produces: `export function applyGraphCollapse(graph: { nodes: GNode[]; edges: GEdge[] }, state: CollapseState): { nodes: GNode[]; edges: GEdge[] }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { applyGraphCollapse } from "./applyGraphCollapse";

const st = (over: any = {}) => ({
  mode: "auto" as const, expandedKinds: new Set<string>(),
  hiddenKinds: new Set<string>(), threshold: 40, ...over,
});
const N = (id: string, service_type?: string) => ({
  id, label: id, requests: 1, errors: 0, service_type,
});

describe("applyGraphCollapse — passthrough & hidden kinds", () => {
  it("returns the graph unchanged when under threshold in auto mode", () => {
    const g = {
      nodes: [N("a"), N("db", "database")],
      edges: [{ from: "a", to: "db", total_requests: 1, failed_requests: 0 }],
    };
    const out = applyGraphCollapse(g, st());
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["a", "db"]);
    expect(out.edges).toHaveLength(1);
  });

  it("removes hidden-kind nodes and their edges", () => {
    const g = {
      nodes: [N("a"), N("ext", "external")],
      edges: [{ from: "a", to: "ext", total_requests: 1, failed_requests: 0 }],
    };
    const out = applyGraphCollapse(g, st({ hiddenKinds: new Set(["external"]) }));
    expect(out.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(out.edges).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/applyGraphCollapse.spec.ts 2>&1 | tail -8`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `applyGraphCollapse.ts`:

```ts
// Copyright 2026 OpenObserve Inc.
// ... (standard AGPL header) ...

export type CollapseMode = "auto" | "expanded" | "collapsed";
export interface CollapseState {
  mode: CollapseMode;
  expandedKinds: Set<string>;
  hiddenKinds: Set<string>;
  threshold: number;
}
export interface GNode {
  id: string; label: string; requests: number; errors: number;
  service_type?: string; is_group?: boolean; member_count?: number;
  [k: string]: any;
}
export interface GEdge {
  from: string | null; to: string;
  total_requests: number; failed_requests: number; [k: string]: any;
}

export const GROUP_PREFIX = "__group_";
const DEP_KINDS = ["database", "queue", "external", "rpc"];
const kindOf = (n: GNode) => (n.service_type ? n.service_type : "service");

export function applyGraphCollapse(
  graph: { nodes: GNode[]; edges: GEdge[] },
  state: CollapseState,
): { nodes: GNode[]; edges: GEdge[] } {
  let nodes = graph.nodes.slice();
  let edges = graph.edges.slice();

  // 1. Hidden kinds: drop nodes + any edge touching them.
  if (state.hiddenKinds.size) {
    const hiddenIds = new Set(
      nodes.filter((n) => state.hiddenKinds.has(kindOf(n))).map((n) => n.id),
    );
    nodes = nodes.filter((n) => !hiddenIds.has(n.id));
    edges = edges.filter(
      (e) => !hiddenIds.has(e.to) && !(e.from && hiddenIds.has(e.from)),
    );
  }

  // Collapse decided in Task 2; for now, no collapse.
  return { nodes, edges };
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/applyGraphCollapse.spec.ts 2>&1 | tail -6`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/utils/traces/applyGraphCollapse.ts web/src/utils/traces/applyGraphCollapse.spec.ts
git commit -m "feat(service-graph): applyGraphCollapse — hidden-kind filtering + passthrough"
```

---

## Task 2: Collapse dep kinds into boundary nodes (with edge rewiring)

**Files:**
- Modify: `web/src/utils/traces/applyGraphCollapse.ts`
- Modify: `web/src/utils/traces/applyGraphCollapse.spec.ts`

**Interfaces:**
- Consumes: `applyGraphCollapse` from Task 1.
- Produces: when a kind is collapsed, its member nodes are replaced by one boundary node `{ id: "__group_<kind>", label: "<Kind> (<n>)", service_type: <kind>, is_group: true, member_count: n }` and edges to/from members rewire to the boundary (deduped by `(from,to)`, `total_requests`/`failed_requests` summed).

- [ ] **Step 1: Write the failing test**

```ts
describe("applyGraphCollapse — collapse", () => {
  const many = (kind: string, n: number) =>
    Array.from({ length: n }, (_, i) => N(`${kind}${i}`, kind));

  it("auto-collapses a dep kind over threshold into one boundary node", () => {
    const exts = many("external", 6);
    const g = {
      nodes: [N("svc"), ...exts],
      edges: exts.map((e) => ({
        from: "svc", to: e.id, total_requests: 2, failed_requests: 1,
      })),
    };
    // 7 nodes > threshold 5 → collapse
    const out = applyGraphCollapse(g, st({ threshold: 5 }));
    const group = out.nodes.find((n) => n.id === "__group_external")!;
    expect(group).toBeTruthy();
    expect(group.is_group).toBe(true);
    expect(group.member_count).toBe(6);
    expect(group.label).toContain("(6)");
    // members gone
    expect(out.nodes.some((n) => n.id === "external0")).toBe(false);
    // one aggregated edge svc → group, requests summed (6*2)
    const ge = out.edges.filter((e) => e.to === "__group_external");
    expect(ge).toHaveLength(1);
    expect(ge[0].total_requests).toBe(12);
    expect(ge[0].failed_requests).toBe(6);
    // service stays
    expect(out.nodes.some((n) => n.id === "svc")).toBe(true);
  });

  it("keeps a kind expanded when it is in expandedKinds", () => {
    const exts = many("external", 6);
    const g = {
      nodes: [N("svc"), ...exts],
      edges: exts.map((e) => ({
        from: "svc", to: e.id, total_requests: 1, failed_requests: 0,
      })),
    };
    const out = applyGraphCollapse(
      g, st({ threshold: 5, expandedKinds: new Set(["external"]) }),
    );
    expect(out.nodes.some((n) => n.id === "__group_external")).toBe(false);
    expect(out.nodes.some((n) => n.id === "external0")).toBe(true);
  });

  it("mode=expanded never collapses; mode=collapsed always collapses", () => {
    const exts = many("external", 3);
    const g = {
      nodes: [N("svc"), ...exts],
      edges: exts.map((e) => ({
        from: "svc", to: e.id, total_requests: 1, failed_requests: 0,
      })),
    };
    // 4 nodes < high threshold, but mode=collapsed forces it
    const forced = applyGraphCollapse(g, st({ mode: "collapsed", threshold: 999 }));
    expect(forced.nodes.some((n) => n.id === "__group_external")).toBe(true);
    // mode=expanded ignores a low threshold
    const shown = applyGraphCollapse(g, st({ mode: "expanded", threshold: 1 }));
    expect(shown.nodes.some((n) => n.id === "external0")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/applyGraphCollapse.spec.ts -t "collapse" 2>&1 | tail -10`
Expected: FAIL (no collapse yet).

- [ ] **Step 3: Write minimal implementation**

Replace the `// Collapse decided in Task 2` line with:

```ts
  // 2. Decide which dep kinds to collapse.
  const shouldCollapseAll =
    state.mode === "collapsed" ||
    (state.mode === "auto" && nodes.length > state.threshold);
  const collapseKinds = new Set<string>();
  if (state.mode !== "expanded") {
    for (const k of DEP_KINDS) {
      if (state.expandedKinds.has(k)) continue;
      if (shouldCollapseAll) collapseKinds.add(k);
    }
  }
  if (!collapseKinds.size) return { nodes, edges };

  // 3. Build boundary nodes and a member→boundary id map.
  const memberToGroup = new Map<string, string>();
  const groups = new Map<string, GNode>();
  for (const n of nodes) {
    const k = kindOf(n);
    if (!collapseKinds.has(k)) continue;
    const gid = GROUP_PREFIX + k;
    memberToGroup.set(n.id, gid);
    let g = groups.get(gid);
    if (!g) {
      g = {
        id: gid, label: "", requests: 0, errors: 0,
        service_type: k, is_group: true, member_count: 0,
      };
      groups.set(gid, g);
    }
    g.requests += n.requests || 0;
    g.errors += n.errors || 0;
    g.member_count = (g.member_count || 0) + 1;
  }
  for (const g of groups.values()) {
    const kindLabel = g.service_type!.charAt(0).toUpperCase() + g.service_type!.slice(1);
    g.label = `${kindLabel} (${g.member_count})`;
  }

  // 4. Keep non-collapsed nodes + the boundary nodes.
  const keptNodes = nodes.filter((n) => !memberToGroup.has(n.id));
  const outNodes = [...keptNodes, ...groups.values()];

  // 5. Rewire edges to/from members onto their boundary, dedupe + sum.
  const remap = (id: string | null) => (id && memberToGroup.get(id)) || id;
  const edgeMap = new Map<string, GEdge>();
  for (const e of edges) {
    const from = remap(e.from);
    const to = remap(e.to)!;
    if (from === to) continue; // self-loop from collapsing both ends
    const key = `${from ?? ""}->${to}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.total_requests += e.total_requests || 0;
      existing.failed_requests += e.failed_requests || 0;
    } else {
      edgeMap.set(key, {
        ...e, from, to,
        total_requests: e.total_requests || 0,
        failed_requests: e.failed_requests || 0,
      });
    }
  }

  return { nodes: outNodes, edges: Array.from(edgeMap.values()) };
```

- [ ] **Step 4: Run test — verify pass**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/applyGraphCollapse.spec.ts 2>&1 | tail -6`
Expected: PASS (all collapse + passthrough tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/utils/traces/applyGraphCollapse.ts web/src/utils/traces/applyGraphCollapse.spec.ts
git commit -m "feat(service-graph): collapse dep kinds into boundary nodes with edge rewiring"
```

---

## Task 3: Wire the transform into ServiceGraph.vue + boundary-click expand

**Files:**
- Modify: `web/src/plugins/traces/ServiceGraph.vue`
- Modify: `web/src/plugins/traces/ServiceGraph.spec.ts`

**Interfaces:**
- Consumes: `applyGraphCollapse`, `GROUP_PREFIX`, `CollapseState`.
- Produces: collapse state refs; `applyFilters` runs the collapse transform; clicking a boundary node toggles its kind in `expandedKinds`.

**Context:** `applyFilters` (ServiceGraph.vue ~line 1344) currently ends with `filteredGraphData.value = { nodes, edges };`. The collapse runs there. The chart click handler (node click) must detect `is_group`/`__group_` ids and toggle expansion instead of opening the side panel.

- [ ] **Step 1: Write the failing test**

Add to `ServiceGraph.spec.ts`:

```ts
it("collapses inferred deps when node count exceeds threshold", async () => {
  const wrapper = createWrapper();
  await flushPromises();
  const exts = Array.from({ length: 8 }, (_, i) => ({
    id: `ext${i}`, label: `ext${i}`, requests: 1, errors: 0,
    service_type: "external",
  }));
  vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
    data: {
      nodes: [{ id: "svc", label: "svc", requests: 1, errors: 0 }, ...exts],
      edges: exts.map((e) => ({
        from: "svc", to: e.id, total_requests: 1, failed_requests: 0,
      })),
    },
  } as any);
  wrapper.vm.collapseThreshold = 5; // force collapse
  await wrapper.vm.loadServiceGraph();
  await flushPromises();
  const ids = wrapper.vm.filteredGraphData.nodes.map((n: any) => n.id);
  expect(ids).toContain("__group_external");
  expect(ids).not.toContain("ext0");
});

it("expands a group when its boundary node is clicked", async () => {
  const wrapper = createWrapper();
  await flushPromises();
  wrapper.vm.toggleGroupExpansion("external");
  await flushPromises();
  expect(wrapper.vm.expandedKinds.has("external")).toBe(true);
  wrapper.vm.toggleGroupExpansion("external");
  expect(wrapper.vm.expandedKinds.has("external")).toBe(false);
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/plugins/traces/ServiceGraph.spec.ts -t "collapses inferred deps\|expands a group" 2>&1 | tail -10`
Expected: FAIL (refs/methods undefined).

- [ ] **Step 3: Implement**

In `ServiceGraph.vue`:

Import:
```ts
import { applyGraphCollapse, GROUP_PREFIX } from "@/utils/traces/applyGraphCollapse";
```

Add state (near `filteredGraphData`):
```ts
const collapseMode = ref<"auto" | "expanded" | "collapsed">("auto");
const collapseThreshold = ref(40);
const expandedKinds = ref<Set<string>>(new Set());
const hiddenKinds = ref<Set<string>>(new Set());

const toggleGroupExpansion = (kind: string) => {
  const s = new Set(expandedKinds.value);
  s.has(kind) ? s.delete(kind) : s.add(kind);
  expandedKinds.value = s;
  lastChartOptions.value = null;
  applyFilters();
};
const setCollapseMode = (m: "auto" | "expanded" | "collapsed") => {
  collapseMode.value = m;
  lastChartOptions.value = null;
  applyFilters();
};
const toggleKindVisibility = (kind: string) => {
  const s = new Set(hiddenKinds.value);
  s.has(kind) ? s.delete(kind) : s.add(kind);
  hiddenKinds.value = s;
  lastChartOptions.value = null;
  applyFilters();
};
```

In `applyFilters`, replace the final `filteredGraphData.value = { nodes, edges };` with:
```ts
      const collapsed = applyGraphCollapse(
        { nodes, edges },
        {
          mode: collapseMode.value,
          expandedKinds: expandedKinds.value,
          hiddenKinds: hiddenKinds.value,
          threshold: collapseThreshold.value,
        },
      );
      filteredGraphData.value = collapsed;
```

In the node-click handler (`handleNodeClick` or the ECharts click callback), short-circuit group nodes:
```ts
      if (node?.id?.startsWith?.(GROUP_PREFIX) || node?.is_group) {
        toggleGroupExpansion(String(node.service_type));
        return;
      }
```

Expose the new refs/methods from `setup()` return: `collapseMode`, `collapseThreshold`, `expandedKinds`, `hiddenKinds`, `toggleGroupExpansion`, `setCollapseMode`, `toggleKindVisibility`.

- [ ] **Step 4: Run tests — verify pass**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/plugins/traces/ServiceGraph.spec.ts 2>&1 | tail -8`
Expected: PASS — new tests pass; existing ServiceGraph tests stay green (default `auto`/threshold 40 collapses nothing on the small mock graphs).

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/plugins/traces/ServiceGraph.vue web/src/plugins/traces/ServiceGraph.spec.ts
git commit -m "feat(service-graph): wire adaptive collapse + boundary-node expand into graph"
```

---

## Task 4: Toolbar controls — mode toggle + per-kind visibility

**Files:**
- Modify: `web/src/plugins/traces/ServiceGraph.vue`
- Modify: `web/src/plugins/traces/ServiceGraph.spec.ts`

**Interfaces:**
- Consumes: `setCollapseMode`, `toggleKindVisibility`, `collapseMode`, `hiddenKinds`, `kindCounts` (existing).

**Context:** the toolbar has the legend (`data-test="service-graph-legends"`, ~line 36) and kind counts (`data-test="service-graph-kind-counts"`, ~line 108). Add the controls near the kind counts.

- [ ] **Step 1: Write the failing test**

```ts
it("switches collapse mode via the toolbar control", async () => {
  const wrapper = createWrapper();
  await flushPromises();
  wrapper.vm.setCollapseMode("expanded");
  expect(wrapper.vm.collapseMode).toBe("expanded");
});

it("hides a kind via the visibility toggle", async () => {
  const wrapper = createWrapper();
  await flushPromises();
  wrapper.vm.toggleKindVisibility("external");
  expect(wrapper.vm.hiddenKinds.has("external")).toBe(true);
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/plugins/traces/ServiceGraph.spec.ts -t "collapse mode via\|hides a kind" 2>&1 | tail -8`
Expected: PASS if Task 3 exposed the methods (these assert the setters). If they already pass from Task 3, treat this task as adding the TEMPLATE controls (below) and add a DOM assertion instead:

```ts
it("renders the collapse-mode control and kind toggles", async () => {
  const wrapper = createWrapper();
  await flushPromises();
  expect(wrapper.find('[data-test="service-graph-collapse-mode"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="service-graph-kind-toggle-external"]').exists()).toBe(true);
});
```

- [ ] **Step 3: Implement template controls**

Near the kind-counts block, add (using the existing `OToggleGroup`/`OToggleGroupItem` already imported for other toolbars, or plain buttons + checkboxes consistent with the file's style):

```html
<div data-test="service-graph-collapse-mode" class="flex items-center gap-1 text-[11px]">
  <span class="opacity-60">Density</span>
  <button
    v-for="m in ['auto','expanded','collapsed']"
    :key="m"
    :data-test="`service-graph-collapse-${m}`"
    class="px-1.5 py-0.5 rounded"
    :class="collapseMode === m ? 'bg-[var(--o2-tag-grey-1)] font-medium' : 'opacity-60'"
    @click="setCollapseMode(m)"
  >{{ m }}</button>
</div>
<div class="flex items-center gap-2 text-[11px]">
  <label
    v-for="k in ['database','queue','external','rpc']"
    :key="k"
    :data-test="`service-graph-kind-toggle-${k}`"
    class="flex items-center gap-1 cursor-pointer"
  >
    <input type="checkbox" :checked="!hiddenKinds.has(k)" @change="toggleKindVisibility(k)" />
    {{ k }}
  </label>
</div>
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/plugins/traces/ServiceGraph.spec.ts 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add web/src/plugins/traces/ServiceGraph.vue web/src/plugins/traces/ServiceGraph.spec.ts
git commit -m "feat(service-graph): toolbar controls for collapse mode + per-kind visibility"
```

---

## Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Unit + component tests**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vitest run src/utils/traces/applyGraphCollapse.spec.ts src/plugins/traces/ServiceGraph.spec.ts src/plugins/traces/ServicesCatalog.spec.ts src/utils/traces/convertTraceData.spec.ts src/utils/traces/serviceClassification.spec.ts 2>&1 | tail -10`
Expected: all PASS.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve/web && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "applyGraphCollapse|ServiceGraph" | head; echo "clean if empty"`
Expected: no errors for changed files.

- [ ] **Step 3: Commit any final fixes**

```bash
cd /Users/ashishkolhe/Documents/github/openobserve
git add -A && git commit -m "test(service-graph): verify adaptive-collapse suite green"
```

---

## Self-Review Notes

- **Spec coverage:** hidden kinds + threshold → Task 1; collapse+rewire+expandedKinds+mode → Task 2; wiring + boundary click → Task 3; toolbar controls → Task 4; verify → Task 5. All spec sections covered.
- **Queue topic both-directions:** handled by the generic edge remap in Task 2 (a topic's incoming producer edge and outgoing consumer edge both remap onto `__group_queue`; self-loops from collapsing both ends are dropped). Note: if a producer service and consumer service are distinct, `service → __group_queue → consumer` is preserved.
- **Services never collapse:** `DEP_KINDS` excludes service; `kindOf` maps falsy `service_type` to `"service"` which is never in `collapseKinds`.
- **Existing tests stay green:** default `mode:"auto"`, `threshold:40` — the small mock graphs in `ServiceGraph.spec.ts` are under 40 nodes, so collapse is a no-op there.
- **Type consistency:** `CollapseState`, `GROUP_PREFIX`, `applyGraphCollapse` used identically across tasks; kind strings (`database`/`queue`/`external`/`rpc`) match the backend `service_type` vocabulary.
