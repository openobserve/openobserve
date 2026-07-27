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
  /**
   * Individual boundary groups the user has drilled into, by boundary id
   * (`__group_<kind>__<caller>`). Expanding one group reveals ONLY that caller's
   * members — clicking `payment`'s External group does not expand `product`'s.
   * A group is a hub if its id is here OR its kind is in `expandedKinds`.
   */
  expandedGroups?: Set<string>;
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

/** Boundary-node id prefix, e.g. `__group_external__payment`. */
export const GROUP_PREFIX = "__group_";
/** Separator between the kind and the caller in a boundary-node id. */
const GROUP_SEP = "__";

/** Inferred-dependency kinds that may collapse. Services are never collapsed. */
const DEP_KINDS = ["database", "queue", "external", "rpc"];

/** A node's kind: its `service_type`, or `"service"` when it has none. */
const kindOf = (n: GNode) => (n.service_type ? n.service_type : "service");

/** Per-caller boundary id: `__group_<kind>__<caller>` (caller "" for roots). */
const groupId = (kind: string, caller: string | null) =>
  `${GROUP_PREFIX}${kind}${GROUP_SEP}${caller ?? ""}`;

/** Extract the kind from a boundary id (for click→toggle). */
export function groupKind(id: string): string | null {
  if (!id.startsWith(GROUP_PREFIX)) return null;
  const rest = id.slice(GROUP_PREFIX.length);
  const sep = rest.indexOf(GROUP_SEP);
  return sep === -1 ? rest : rest.slice(0, sep);
}

/**
 * Transform the complete topology into the presented graph: drop hidden kinds,
 * and collapse each CALLER's inferred dependencies (per kind) into its OWN
 * boundary node. Collapsing is per-(caller, kind), not global — so `payment`'s
 * externals and `product`'s externals are separate groups, faithfully attached
 * to their real caller. Services are never collapsed.
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
    edges = edges.filter((e) => !hiddenIds.has(e.to) && !(e.from != null && hiddenIds.has(e.from)));
  }

  // 2. Decide which KINDS are collapsible at all (auto over threshold, or
  //    collapsed mode). Whether each individual GROUP is a hub (members shown,
  //    foldable) or fully collapsed is decided per-group in step 3b — so
  //    expanding one caller's group never expands another caller's.
  const shouldCollapseAll =
    state.mode === "collapsed" || (state.mode === "auto" && nodes.length > state.threshold);
  const collapsibleKinds = new Set<string>();
  if (state.mode !== "expanded" && shouldCollapseAll) {
    for (const k of DEP_KINDS) collapsibleKinds.add(k);
  }
  if (!collapsibleKinds.size) return { nodes, edges };

  const expandedGroups = state.expandedGroups ?? new Set<string>();
  // A group is a hub (expanded, members visible) when the user drilled into that
  // specific group, OR into its whole kind via `expandedKinds`.
  const isHubGroup = (gid: string, kind: string) =>
    expandedGroups.has(gid) || state.expandedKinds.has(kind);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const isDep = (id: string) => {
    const n = nodeById.get(id);
    return n ? DEP_KINDS.includes(kindOf(n)) : false;
  };

  // 3. Walk edges CALLER→dep. Each such edge assigns the dep to the caller's
  //    per-kind boundary group. (Deps are terminal leaves, so they only ever
  //    appear as an edge target; a dep called by two services joins both callers'
  //    groups — faithful, since it really is called by both.)
  const groups = new Map<string, GNode>(); // boundary id → node
  // boundary id → set of member dep ids (for containment edges + counts)
  const groupMembers = new Map<string, Set<string>>();
  // dep id → the caller→dep edge(s) it came in on (to aggregate caller→boundary)
  const ensureGroup = (gid: string, kind: string, caller: string | null) => {
    let g = groups.get(gid);
    if (!g) {
      g = {
        id: gid,
        label: "",
        requests: 0,
        errors: 0,
        service_type: kind,
        is_group: true,
        member_count: 0,
        group_caller: caller,
      };
      groups.set(gid, g);
      groupMembers.set(gid, new Set());
    }
    return g;
  };

  // caller→boundary aggregated edge metrics, and boundary→member metrics.
  const callerEdge = new Map<string, GEdge>(); // key from->gid
  const memberEdge = new Map<string, GEdge>(); // key gid->member

  for (const e of edges) {
    const depId = e.to;
    if (!isDep(depId)) continue;
    const kind = kindOf(nodeById.get(depId)!);
    if (!collapsibleKinds.has(kind)) continue;
    const caller = e.from; // the real service calling this dep
    const gid = groupId(kind, caller);
    ensureGroup(gid, kind, caller);
    const mem = groupMembers.get(gid)!;
    if (!mem.has(depId)) mem.add(depId);

    // caller → boundary (aggregate this edge's metrics)
    const ck = `${caller ?? ""}->${gid}`;
    const ce = callerEdge.get(ck);
    if (ce) {
      ce.total_requests += e.total_requests || 0;
      ce.failed_requests += e.failed_requests || 0;
    } else {
      callerEdge.set(ck, {
        ...e,
        from: caller,
        to: gid,
        total_requests: e.total_requests || 0,
        failed_requests: e.failed_requests || 0,
        connection_type: kind,
      });
    }
    // boundary → member (containment; carries the original edge metrics)
    const mk = `${gid}->${depId}`;
    const me = memberEdge.get(mk);
    if (me) {
      me.total_requests += e.total_requests || 0;
      me.failed_requests += e.failed_requests || 0;
    } else {
      memberEdge.set(mk, {
        ...e,
        from: gid,
        to: depId,
        total_requests: e.total_requests || 0,
        failed_requests: e.failed_requests || 0,
        connection_type: kind,
      });
    }
  }

  // Finalize group node counts/labels + roll member metrics into the boundary.
  for (const [gid, g] of groups) {
    const members = groupMembers.get(gid)!;
    g.member_count = members.size;
    for (const mid of members) {
      const m = nodeById.get(mid)!;
      g.requests += m.requests || 0;
      g.errors += m.errors || 0;
    }
    const kind = g.service_type!;
    const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
    const isHub = isHubGroup(gid, kind);
    (g as any).is_expanded = isHub;
    // ▾ = expanded (click to collapse), ▸ = collapsed (click to expand).
    g.label = `${kindLabel} (${g.member_count}) ${isHub ? "▾" : "▸"}`;
  }

  // 4. Which dep member ids are hidden behind a collapsed boundary. A member is
  //    hidden only if it is NOT a visible member of ANY hub group — a dep shared
  //    by two callers (collapsed under one, expanded under the other) stays
  //    visible. So: gather hub members first, then collapse everything else.
  const hubMemberIds = new Set<string>();
  for (const g of groups.values()) {
    if (isHubGroup(g.id, g.service_type!)) {
      for (const mid of groupMembers.get(g.id)!) hubMemberIds.add(mid);
    }
  }
  const collapsedMemberIds = new Set<string>();
  for (const g of groups.values()) {
    for (const mid of groupMembers.get(g.id)!) {
      if (!hubMemberIds.has(mid)) collapsedMemberIds.add(mid);
    }
  }

  // 5. Assemble nodes: keep non-collapsed nodes (services + hub members) and add
  //    all boundary nodes.
  const keptNodes = nodes.filter((n) => !collapsedMemberIds.has(n.id));
  const outNodes = [...keptNodes, ...groups.values()];
  const keptIds = new Set(outNodes.map((n) => n.id));

  // 6. Assemble edges:
  //    - original non-dep edges (service→service) pass through unchanged.
  //    - caller→boundary edges for every collapsed/hub group.
  //    - boundary→member edges only for HUB groups (members are visible).
  const edgeMap = new Map<string, GEdge>();
  const put = (e: GEdge) => {
    if (e.from === e.to) return;
    if (e.from != null && !keptIds.has(e.from)) return;
    if (!keptIds.has(e.to)) return;
    const key = `${e.from ?? ""}->${e.to}`;
    const ex = edgeMap.get(key);
    if (ex) {
      ex.total_requests += e.total_requests || 0;
      ex.failed_requests += e.failed_requests || 0;
    } else {
      edgeMap.set(key, e);
    }
  };
  // Original edges that are NOT caller→dep (those became boundary edges).
  for (const e of edges) {
    if (isDep(e.to) && collapsibleKinds.has(kindOf(nodeById.get(e.to)!))) continue;
    put({ ...e });
  }
  for (const ce of callerEdge.values()) put(ce);
  for (const me of memberEdge.values()) {
    // Emit the boundary→member containment edge only for HUB groups (members
    // visible). `me.from` is the boundary id; check that specific group.
    const gid = me.from as string;
    const g = groups.get(gid);
    if (g && isHubGroup(gid, g.service_type!)) put(me);
  }

  return { nodes: outNodes, edges: Array.from(edgeMap.values()) };
}
