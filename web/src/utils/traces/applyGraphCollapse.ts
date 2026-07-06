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

  // Collapse decided in Task 2; for now, no collapse.
  return { nodes, edges };
}
