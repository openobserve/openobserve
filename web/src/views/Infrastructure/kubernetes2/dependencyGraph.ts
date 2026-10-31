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

import type { Series } from "./kubernetesModel";
import { escapeLabel } from "./kubernetesQueries";

// The eBPF network flow counter: bytes one end sent the other, per reporting node.
export const FLOW_STREAM = "obi_network_flow_bytes";

export const SYSTEM_NAMESPACES: ReadonlySet<string> = new Set([
  "kube-system",
  "kube-node-lease",
  "openobserve-collector",
  "cert-manager",
  "opentelemetry-operator-system",
]);

// Past this a layered graph stops being readable, so only the busiest ends are drawn.
export const MAX_GRAPH_NODES = 80;

const MIN_WINDOW_S = 300;
// One day of samples keeps the instant query cheap on a long range.
const MAX_WINDOW_S = 86_400;

// "workload" is any pod owner; "node" is host processes and host-network pods; "external" is outside the cluster.
export type EndKind = "workload" | "node" | "external";

export interface FlowEnd {
  id: string;
  kind: EndKind;
  cluster: string;
  namespace: string;
  name: string;
  ownerType: string;
}

export interface FlowEdge {
  id: string;
  // Client to server when directed; otherwise in id order.
  source: FlowEnd;
  target: FlowEnd;
  directed: boolean;
  // Bytes/s source to target, and back.
  forward: number;
  backward: number;
  request: number;
  response: number;
  unknown: number;
  total: number;
}

export interface FlowFilter {
  namespaces: string[];
  search: string;
  showSystem: boolean;
  showNodeTraffic: boolean;
}

export interface GraphNode {
  end: FlowEnd;
  total: number;
  // Column in the layered layout: callers to the left of what they call.
  rank: number;
}

export interface FlowGraph {
  nodes: GraphNode[];
  edges: FlowEdge[];
  // Ends before the cap, so the view can say how many were left out.
  totalNodes: number;
}

const END = (side: "src" | "dst") =>
  `k8s_${side}_namespace, k8s_${side}_owner_name, k8s_${side}_owner_type`;

const PAIR = `k8s_cluster, ${END("src")}, ${END("dst")}, direction, host_id`;

// The rate covers the selected range, bounded so a short range still has samples and a long one stays cheap.
export const flowWindowSeconds = (startUs: number, endUs: number) =>
  Math.min(MAX_WINDOW_S, Math.max(MIN_WINDOW_S, Math.round((endUs - startUs) / 1_000_000)));

// Per reporting node, since both nodes report cross-node traffic; pairFlows keeps one node's count.
// Service rows repeat the workload rows on the client's node, so they are left out.
export function flowQuery(cluster: string | null, windowS: number): string {
  const matchers = ['k8s_src_owner_type!="Service"', 'k8s_dst_owner_type!="Service"'];
  if (cluster) matchers.unshift(`k8s_cluster="${escapeLabel(cluster)}"`);
  const rate = `rate(${FLOW_STREAM}{${matchers.join(", ")}}[${windowS}s])`;
  return `sum by (${PAIR}) (${rate})`;
}

export function endOf(metric: Record<string, string>, side: "src" | "dst"): FlowEnd {
  const cluster = metric.k8s_cluster ?? "";
  const name = metric[`k8s_${side}_owner_name`] ?? "";
  const ownerType = metric[`k8s_${side}_owner_type`] ?? "";
  const namespace = metric[`k8s_${side}_namespace`] ?? "";
  if (!name) {
    return {
      id: `${cluster}/external`,
      kind: "external",
      cluster,
      namespace: "",
      name: "",
      ownerType: "",
    };
  }
  if (ownerType === "Node") {
    return { id: `${cluster}/node/${name}`, kind: "node", cluster, namespace: "", name, ownerType };
  }
  return {
    id: `${cluster}/${namespace}/${ownerType}/${name}`,
    kind: "workload",
    cluster,
    namespace,
    name,
    ownerType,
  };
}

interface Flow {
  src: FlowEnd;
  dst: FlowEnd;
  request: number;
  response: number;
  unknown: number;
  total: number;
}

const known = (f: Flow) => f.request + f.response;

// One flow per direction of travel, from the node that saw the most of it, with that node's direction
// split: mixing nodes could add one node's request bytes to the other's unknown ones.
function busiestNode(series: Series[]): Flow[] {
  const perNode = new Map<string, Flow>();
  for (const { metric, value } of series) {
    if (!(value > 0)) continue;
    const src = endOf(metric, "src");
    const dst = endOf(metric, "dst");
    const key = `${src.id}\n${dst.id}\n${metric.host_id ?? ""}`;
    let f = perNode.get(key);
    if (!f) {
      f = { src, dst, request: 0, response: 0, unknown: 0, total: 0 };
      perNode.set(key, f);
    }
    if (metric.direction === "request") f.request += value;
    else if (metric.direction === "response") f.response += value;
    else f.unknown += value;
    f.total += value;
  }
  const best = new Map<string, Flow>();
  for (const f of perNode.values()) {
    const key = `${f.src.id}\n${f.dst.id}`;
    const kept = best.get(key);
    // On a tie the node that saw the connection open says more about its direction.
    if (!kept || f.total > kept.total || (f.total === kept.total && known(f) > known(kept))) {
      best.set(key, f);
    }
  }
  return [...best.values()];
}

interface Pair {
  a: FlowEnd;
  b: FlowEnd;
  ab: number;
  ba: number;
  aClient: number;
  bClient: number;
  request: number;
  response: number;
  unknown: number;
}

// One edge per unordered pair. A request leaves the client and a response leaves the server, so both
// count toward the same orientation; an edge is directed only when that evidence is most of its bytes.
export function pairFlows(series: Series[]): FlowEdge[] {
  const pairs = new Map<string, Pair>();
  for (const { src, dst, request, response, unknown, total } of busiestNode(series)) {
    // Traffic inside one workload, one node or the outside world is not a dependency.
    if (src.id === dst.id) continue;
    const [a, b] = src.id < dst.id ? [src, dst] : [dst, src];
    const key = `${a.id}\n${b.id}`;
    let p = pairs.get(key);
    if (!p) {
      p = { a, b, ab: 0, ba: 0, aClient: 0, bClient: 0, request: 0, response: 0, unknown: 0 };
      pairs.set(key, p);
    }
    const fromA = src.id === a.id;
    if (fromA) p.ab += total;
    else p.ba += total;
    p.request += request;
    p.response += response;
    p.unknown += unknown;
    if (fromA) {
      p.aClient += request;
      p.bClient += response;
    } else {
      p.bClient += request;
      p.aClient += response;
    }
  }
  return [...pairs.entries()].map(([key, p]) => {
    const total = p.ab + p.ba;
    const directed = Math.max(p.aClient, p.bClient) > total / 2;
    const flip = directed && p.bClient > p.aClient;
    return {
      id: key,
      source: flip ? p.b : p.a,
      target: flip ? p.a : p.b,
      directed,
      forward: flip ? p.ba : p.ab,
      backward: flip ? p.ab : p.ba,
      request: p.request,
      response: p.response,
      unknown: p.unknown,
      total,
    };
  });
}

// An edge touching a namespace picked in the namespace filter is shown even with system namespaces hidden.
export function filterFlows(edges: FlowEdge[], filter: FlowFilter): FlowEdge[] {
  const selected = new Set(filter.namespaces);
  const needle = filter.search.trim().toLowerCase();
  const picked = (e: FlowEdge) =>
    selected.has(e.source.namespace) || selected.has(e.target.namespace);
  const system = (end: FlowEnd) => SYSTEM_NAMESPACES.has(end.namespace);
  const matches = (end: FlowEnd) =>
    end.name.toLowerCase().includes(needle) || end.namespace.toLowerCase().includes(needle);
  return edges.filter((e) => {
    if (!filter.showSystem && (system(e.source) || system(e.target)) && !picked(e)) return false;
    // Node to node bytes are mostly pod traffic between nodes, already drawn between the pods' workloads.
    if (!filter.showNodeTraffic && e.source.kind === "node" && e.target.kind === "node") {
      return false;
    }
    if (selected.size && !picked(e)) return false;
    return !needle || matches(e.source) || matches(e.target);
  });
}

// Takes the busiest edges while their ends fit under the limit, ranked so each caller sits left of what it calls.
export function buildGraph(edges: FlowEdge[], limit = MAX_GRAPH_NODES): FlowGraph {
  const totals = new Map<string, { end: FlowEnd; total: number }>();
  for (const e of edges) {
    for (const end of [e.source, e.target]) {
      const entry = totals.get(end.id) ?? { end, total: 0 };
      entry.total += e.total;
      totals.set(end.id, entry);
    }
  }
  // Picking ends first could keep every client of disjoint pairs and none of their servers.
  const kept = new Set<string>();
  const keptEdges: FlowEdge[] = [];
  const busiest = [...edges].sort((x, y) => y.total - x.total || x.id.localeCompare(y.id));
  for (const e of busiest) {
    const added = [e.source.id, e.target.id].filter((id) => !kept.has(id)).length;
    if (kept.size + added > limit) continue;
    kept.add(e.source.id);
    kept.add(e.target.id);
    keptEdges.push(e);
  }
  const ranks = rankOf(keptEdges);
  const nodes = [...totals.values()]
    .filter((n) => kept.has(n.end.id))
    .map((n) => ({ ...n, rank: ranks.get(n.end.id) ?? 0 }));
  return { nodes, edges: keptEdges, totalNodes: totals.size };
}

// Longest chain of callers above each end; an edge back into the current chain is a cycle and ignored.
function rankOf(edges: FlowEdge[]): Map<string, number> {
  const callers = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.directed) continue;
    const list = callers.get(e.target.id) ?? [];
    list.push(e.source.id);
    callers.set(e.target.id, list);
  }
  const rank = new Map<string, number>();
  const onPath = new Set<string>();
  const visit = (id: string): number => {
    const known = rank.get(id);
    if (known != null) return known;
    if (onPath.has(id)) return -1;
    onPath.add(id);
    let r = 0;
    for (const caller of callers.get(id) ?? []) r = Math.max(r, visit(caller) + 1);
    onPath.delete(id);
    rank.set(id, r);
    return r;
  };
  for (const e of edges) {
    visit(e.source.id);
    visit(e.target.id);
  }
  return rank;
}

export interface Position {
  x: number;
  y: number;
}

const COLUMN_GAP = 260;
const ROW_GAP = 70;

// Columns by rank, each sorted by namespace then name so a namespace's workloads sit together.
export function layoutGraph(nodes: GraphNode[]): Map<string, Position> {
  const columns = new Map<number, GraphNode[]>();
  for (const n of nodes) columns.set(n.rank, [...(columns.get(n.rank) ?? []), n]);
  const out = new Map<string, Position>();
  for (const [rank, column] of columns) {
    column.sort(
      (x, y) =>
        orderOf(x.end) - orderOf(y.end) ||
        x.end.namespace.localeCompare(y.end.namespace) ||
        x.end.name.localeCompare(y.end.name),
    );
    column.forEach((n, i) => {
      out.set(n.end.id, { x: rank * COLUMN_GAP, y: (i - (column.length - 1) / 2) * ROW_GAP });
    });
  }
  return out;
}

// Workloads first, then nodes, then the outside world, in every column.
const orderOf = (end: FlowEnd) => (end.kind === "workload" ? 0 : end.kind === "node" ? 1 : 2);
