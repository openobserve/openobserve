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

//! Adaptive dependency collapse for the service graph.
//!
//! The backend returns the complete, classified topology. When it is large, this
//! pure transform collapses inferred-dependency nodes (database/queue/external/
//! rpc) into per-kind boundary nodes so the overview stays readable, with user
//! controls (mode, per-kind expand, per-kind hide) driving the behavior. Services
//! are never collapsed.

export type CollapseMode = "auto" | "expanded" | "collapsed";

export interface CollapseState {
  mode: CollapseMode;
  /** Kinds the user has drilled into (shown individually despite collapse). */
  expandedKinds: Set<string>;
  /** Kinds hidden from the graph entirely. */
  hiddenKinds: Set<string>;
  /** Total-node count above which `auto` mode collapses dependency kinds. */
  threshold: number;
}

export interface GNode {
  id: string;
  label: string;
  requests: number;
  errors: number;
  service_type?: string;
  is_group?: boolean;
  member_count?: number;
  [k: string]: any;
}

export interface GEdge {
  from: string | null;
  to: string;
  total_requests: number;
  failed_requests: number;
  [k: string]: any;
}

/** Boundary-node id prefix, e.g. `__group_external`. */
export const GROUP_PREFIX = "__group_";

/** Inferred-dependency kinds that may collapse. Services are never collapsed. */
const DEP_KINDS = ["database", "queue", "external", "rpc"];

/** A node's kind: its `service_type`, or `"service"` when it has none. */
const kindOf = (n: GNode) => (n.service_type ? n.service_type : "service");

/**
 * Transform a complete topology into the presented graph: drop hidden kinds, and
 * (in Task 2) collapse dependency kinds into boundary nodes per the state.
 */
export function applyGraphCollapse(
  graph: { nodes: GNode[]; edges: GEdge[] },
  state: CollapseState,
): { nodes: GNode[]; edges: GEdge[] } {
  let nodes = graph.nodes.slice();
  let edges = graph.edges.slice();

  // 1. Hidden kinds: drop their nodes and any edge touching them.
  if (state.hiddenKinds.size) {
    const hiddenIds = new Set(
      nodes.filter((n) => state.hiddenKinds.has(kindOf(n))).map((n) => n.id),
    );
    nodes = nodes.filter((n) => !hiddenIds.has(n.id));
    edges = edges.filter(
      (e) => !hiddenIds.has(e.to) && !(e.from != null && hiddenIds.has(e.from)),
    );
  }

  // 2. Decide, per dependency kind, whether it collapses. A kind that WOULD
  // collapse but is in `expandedKinds` becomes a HUB: the boundary node stays
  // visible (so the user can click it to fold back) while its members are also
  // shown, hanging off the boundary.
  const shouldCollapseAll =
    state.mode === "collapsed" ||
    (state.mode === "auto" && nodes.length > state.threshold);
  const collapseKinds = new Set<string>(); // fully folded (members hidden)
  const hubKinds = new Set<string>(); // boundary + members both shown
  if (state.mode !== "expanded" && shouldCollapseAll) {
    for (const k of DEP_KINDS) {
      if (state.expandedKinds.has(k)) hubKinds.add(k);
      else collapseKinds.add(k);
    }
  }
  if (!collapseKinds.size && !hubKinds.size) return { nodes, edges };

  // 3. Build one boundary node per collapsed OR hub kind. For collapsed kinds we
  //    also map member→boundary so their edges rewire onto it; hub members keep
  //    their own node and get a boundary→member containment edge instead.
  const memberToGroup = new Map<string, string>(); // collapsed members only
  const hubMembers: GNode[] = []; // (member, boundaryId) for hub kinds
  const groups = new Map<string, GNode>();
  const ensureGroup = (k: string) => {
    const gid = GROUP_PREFIX + k;
    let g = groups.get(gid);
    if (!g) {
      g = {
        id: gid, label: "", requests: 0, errors: 0,
        service_type: k, is_group: true, member_count: 0,
      };
      groups.set(gid, g);
    }
    return g;
  };
  for (const n of nodes) {
    const k = kindOf(n);
    const gid = GROUP_PREFIX + k;
    if (collapseKinds.has(k)) {
      memberToGroup.set(n.id, gid);
      const g = ensureGroup(k);
      g.requests += n.requests || 0;
      g.errors += n.errors || 0;
      g.member_count = (g.member_count || 0) + 1;
    } else if (hubKinds.has(k)) {
      const g = ensureGroup(k);
      g.requests += n.requests || 0;
      g.errors += n.errors || 0;
      g.member_count = (g.member_count || 0) + 1;
      hubMembers.push(n);
    }
  }
  for (const g of groups.values()) {
    const kind = g.service_type!;
    const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
    const isHub = hubKinds.has(kind);
    g.is_expanded = isHub;
    // ▾ = expanded (click to collapse), ▸ = collapsed (click to expand).
    g.label = `${kindLabel} (${g.member_count}) ${isHub ? "▾" : "▸"}`;
  }

  // 4. Nodes: keep everything except collapsed members; add boundary nodes.
  //    Hub members stay (they are shown under their boundary).
  const keptNodes = nodes.filter((n) => !memberToGroup.has(n.id));
  const outNodes = [...keptNodes, ...groups.values()];

  // 5. Edges:
  //    - collapsed members: rewire their edges onto the boundary (dedupe + sum).
  //    - hub members: rewire the CALLER→member edge to caller→boundary
  //      (aggregated), and add a boundary→member containment edge, so the flow
  //      reads caller → boundary → member.
  const hubMemberIds = new Set(hubMembers.map((m) => m.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const remap = (id: string | null) => {
    if (id == null) return id;
    if (memberToGroup.has(id)) return memberToGroup.get(id)!;
    if (hubMemberIds.has(id)) return GROUP_PREFIX + kindOf(nodeById.get(id)!);
    return id;
  };
  const edgeMap = new Map<string, GEdge>();
  const addEdge = (from: string | null, to: string, e: Partial<GEdge>) => {
    if (from === to) return;
    const key = `${from ?? ""}->${to}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.total_requests += e.total_requests || 0;
      existing.failed_requests += e.failed_requests || 0;
    } else {
      edgeMap.set(key, {
        ...(e as GEdge), from, to,
        total_requests: e.total_requests || 0,
        failed_requests: e.failed_requests || 0,
      });
    }
  };
  for (const e of edges) {
    addEdge(remap(e.from), remap(e.to)!, e);
  }
  // Containment edges: boundary → each hub member.
  for (const m of hubMembers) {
    const gid = GROUP_PREFIX + kindOf(m);
    addEdge(gid, m.id, {
      total_requests: m.requests || 0,
      failed_requests: m.errors || 0,
      connection_type: m.service_type,
    });
  }

  return { nodes: outNodes, edges: Array.from(edgeMap.values()) };
}
