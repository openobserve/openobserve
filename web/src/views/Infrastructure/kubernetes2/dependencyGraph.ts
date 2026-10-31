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
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
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

// Endpoints alone do not bound the edges between them, and every edge is also a button in the edge list.
export const MAX_GRAPH_EDGES = 200;

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

// One flow per direction of travel: the bytes from the node that saw the most of them, split by direction
// as the node that saw the most request and response bytes did, since a node whose eBPF pod restarted
// reports the same bytes as unknown. Adding nodes' rows together would count cross-node bytes twice.
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
  const best = new Map<string, { busiest: Flow; informed: Flow }>();
  for (const f of perNode.values()) {
    const key = `${f.src.id}\n${f.dst.id}`;
    const kept = best.get(key);
    if (!kept) {
      best.set(key, { busiest: f, informed: f });
      continue;
    }
    if (f.total > kept.busiest.total) kept.busiest = f;
    if (known(f) > known(kept.informed)) kept.informed = f;
  }
  return [...best.values()].map(({ busiest, informed }) => {
    const scale = busiest.total / informed.total;
    return {
      ...busiest,
      request: informed.request * scale,
      response: informed.response * scale,
      unknown: informed.unknown * scale,
    };
  });
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

// Takes the busiest edges while they and their ends fit under the limits, ranked so each caller sits left of what it calls.
export function buildGraph(
  edges: FlowEdge[],
  limit = MAX_GRAPH_NODES,
  edgeLimit = MAX_GRAPH_EDGES,
): FlowGraph {
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
    if (keptEdges.length >= edgeLimit) break;
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
  return { nodes, edges: keptEdges };
}

// Longest chain of callers above each end; an edge back into the current chain is a cycle and ignored.
function rankOf(edges: Link[]): Map<string, number> {
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

// Sized to the map's cards: a card's width plus room for an edge's rate label, and a card's height plus a gap.
const COLUMN_GAP = 290;
const ROW_GAP = 84;

// Alternating left-to-right and right-to-left passes; a few settle a graph of this size.
const SWEEPS = 6;

interface Link {
  source: { id: string };
  target: { id: string };
  directed: boolean;
}

// Columns by rank, each starting in `compare` order. An end that only calls sits just left of the nearest end it
// calls, so its edges do not run behind the columns in between. The `aside` ends get columns of their own past the
// rest, ranked only by the calls between them, so catch-all ends many workloads talk to do not land among the callers. Each column is then reordered a few
// times by the mean position of its neighbours in the columns already placed, keeping the order with the fewest
// crossings.
export function layoutColumns<E extends { id: string }>(
  nodes: { end: E; rank: number }[],
  compare: (x: E, y: E) => number,
  edges: Link[],
  aside: (end: E) => boolean,
): Map<string, Position> {
  const rank = new Map(nodes.map((n) => [n.end.id, n.rank]));
  const isAside = new Set(nodes.filter((n) => aside(n.end)).map((n) => n.end.id));
  const called = new Set(edges.filter((e) => e.directed).map((e) => e.target.id));
  const nearest = new Map<string, number>();
  for (const { source, target, directed } of edges) {
    if (!directed || called.has(source.id) || isAside.has(target.id) || !rank.has(target.id))
      continue;
    nearest.set(source.id, Math.min(nearest.get(source.id) ?? Infinity, rank.get(target.id)! - 1));
  }
  const last = Math.max(-1, ...nodes.filter((n) => !isAside.has(n.end.id)).map((n) => n.rank)) + 1;
  // Only an aside caller pushes an aside end right, so ends the main columns call share the first aside column.
  const asideRank = rankOf(
    edges.filter((e) => isAside.has(e.source.id) && isAside.has(e.target.id)),
  );
  const rankOfNode = (n: { end: E; rank: number }) =>
    isAside.has(n.end.id)
      ? last + (asideRank.get(n.end.id) ?? 0)
      : (nearest.get(n.end.id) ?? n.rank);
  // Renumbered, so a rank emptied by moving its ends aside leaves no gap.
  const used = [...new Set(nodes.map(rankOfNode))].sort((a, b) => a - b);
  let order: E[][] = used.map(() => []);
  for (const n of nodes) order[used.indexOf(rankOfNode(n))].push(n.end);
  for (const column of order) column.sort(compare);

  const columnOf = new Map<string, number>();
  order.forEach((column, i) => column.forEach((end) => columnOf.set(end.id, i)));
  const neighbours = new Map<string, string[]>();
  const links = edges.filter((e) => columnOf.has(e.source.id) && columnOf.has(e.target.id));
  for (const { source, target } of links) {
    neighbours.set(source.id, [...(neighbours.get(source.id) ?? []), target.id]);
    neighbours.set(target.id, [...(neighbours.get(target.id) ?? []), source.id]);
  }

  // Centred row of each end, so columns of different heights line up on their middles.
  const rows = new Map<string, number>();
  const place = (column: E[]) =>
    column.forEach((end, i) => rows.set(end.id, i - (column.length - 1) / 2));
  order.forEach(place);

  let best = order;
  let fewest = crossings(links, columnOf, rows);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const forward = sweep % 2 === 0;
    const next = [...order];
    for (let k = 0; k < next.length; k++) {
      const i = forward ? k : next.length - 1 - k;
      const placed = (id: string) => (forward ? columnOf.get(id)! < i : columnOf.get(id)! > i);
      const weight = new Map<string, number>();
      for (const end of next[i]) {
        const ys = (neighbours.get(end.id) ?? []).filter(placed).map((id) => rows.get(id)!);
        weight.set(
          end.id,
          ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : rows.get(end.id)!,
        );
      }
      // A stable sort, so ends without placed neighbours and ties keep their order.
      next[i] = [...next[i]].sort((x, y) => weight.get(x.id)! - weight.get(y.id)!);
      place(next[i]);
    }
    order = next;
    const count = crossings(links, columnOf, rows);
    if (count < fewest) {
      fewest = count;
      best = order;
    }
  }

  const out = new Map<string, Position>();
  best.forEach((column, i) =>
    column.forEach((end, j) =>
      out.set(end.id, { x: i * COLUMN_GAP, y: (j - (column.length - 1) / 2) * ROW_GAP }),
    ),
  );
  return out;
}

// Pairs of edges between the same two columns whose ends are in opposite orders; edges between different column
// pairs are not compared.
function crossings(
  edges: Link[],
  columnOf: Map<string, number>,
  rows: Map<string, number>,
): number {
  const spans = edges
    .map(({ source, target }) => {
      const [a, b] = [source.id, target.id].sort((x, y) => columnOf.get(x)! - columnOf.get(y)!);
      return { from: columnOf.get(a)!, to: columnOf.get(b)!, ya: rows.get(a)!, yb: rows.get(b)! };
    })
    .filter((s) => s.from !== s.to);
  let count = 0;
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const [p, q] = [spans[i], spans[j]];
      if (p.from !== q.from || p.to !== q.to) continue;
      if ((p.ya - q.ya) * (p.yb - q.yb) < 0) count++;
    }
  }
  return count;
}

// Workloads by namespace then name, so a namespace's workloads start together; nodes and the outside world go aside.
export const layoutGraph = ({ nodes, edges }: FlowGraph) =>
  layoutColumns(
    nodes,
    (x, y) =>
      orderOf(x) - orderOf(y) ||
      x.namespace.localeCompare(y.namespace) ||
      x.name.localeCompare(y.name),
    edges,
    (end) => end.kind !== "workload",
  );

// Nodes before the outside world aside, until the sweeps reorder them by their neighbours.
const orderOf = (end: FlowEnd) => (end.kind === "workload" ? 0 : end.kind === "node" ? 1 : 2);

export const formatRate = (value: number) => formatUnitValue(getUnitValue(value, "bps", "", 1));
