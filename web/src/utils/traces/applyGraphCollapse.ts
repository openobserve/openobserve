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

  // 2. Decide which dependency kinds to collapse.
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

  // 3. Build one boundary node per collapsed kind + a member→boundary id map.
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
        id: gid,
        label: "",
        requests: 0,
        errors: 0,
        service_type: k,
        is_group: true,
        member_count: 0,
      };
      groups.set(gid, g);
    }
    g.requests += n.requests || 0;
    g.errors += n.errors || 0;
    g.member_count = (g.member_count || 0) + 1;
  }
  for (const g of groups.values()) {
    const kind = g.service_type!;
    const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
    g.label = `${kindLabel} (${g.member_count})`;
  }

  // 4. Keep non-collapsed nodes + the boundary nodes.
  const keptNodes = nodes.filter((n) => !memberToGroup.has(n.id));
  const outNodes = [...keptNodes, ...groups.values()];

  // 5. Rewire member edges onto their boundary node, dedupe by (from,to), sum.
  const remap = (id: string | null) => (id != null && memberToGroup.get(id)) || id;
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
        ...e,
        from,
        to,
        total_requests: e.total_requests || 0,
        failed_requests: e.failed_requests || 0,
      });
    }
  }

  return { nodes: outNodes, edges: Array.from(edgeMap.values()) };
}
