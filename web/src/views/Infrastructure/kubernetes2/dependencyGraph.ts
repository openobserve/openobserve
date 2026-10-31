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

// The map's card size; DependencyMap.vue draws its cards at exactly this size, so edges can be routed around them.
export const CARD_W = 216;
export const CARD_H = 76;
// A column is a card wide plus a gap with room for edges to fan out and a rate label to sit clear of the arrowheads.
export const COLUMN_GAP = CARD_W + 240;
// A card's slot is its height plus a gap; an edge passing through a column takes a thin slot of its own.
const NODE_SLOT = CARD_H + 68;
const PASS_SLOT = 40;

// Alternating left-to-right and right-to-left passes; a few settle a graph of this size.
const SWEEPS = 6;

interface Link {
  id: string;
  source: { id: string };
  target: { id: string };
  directed: boolean;
}

export interface Layout {
  // Each card's top-left corner.
  positions: Map<string, Position>;
  // Per edge that skips columns, where it passes each column between its ends, in column order: the slot's left
  // edge and its middle, so the edge runs straight across the column between the cards.
  waypoints: Map<string, Position[]>;
}

// Columns by rank, each starting in `compare` order. An end that only calls sits just left of the nearest end it
// calls, so its edges do not run behind the columns in between. The `aside` ends get a column of their own past the
// rest, so catch-all ends many workloads talk to do not land among the callers; a map of only aside ends is ranked
// by the calls between them instead. An edge that skips columns takes a slot in each column it passes, and each
// column is reordered a few times by the mean position of its neighbours and slots in the columns already placed,
// keeping the order with the fewest crossings.
export function layoutColumns<E extends { id: string }>(
  nodes: { end: E; rank: number }[],
  compare: (x: E, y: E) => number,
  edges: Link[],
  aside: (end: E) => boolean,
): Layout {
  const rank = new Map(nodes.map((n) => [n.end.id, n.rank]));
  const isAside = new Set(nodes.filter((n) => aside(n.end)).map((n) => n.end.id));
  const called = new Set(edges.filter((e) => e.directed).map((e) => e.target.id));
  const nearest = new Map<string, number>();
  for (const { source, target, directed } of edges) {
    if (!directed || called.has(source.id) || isAside.has(target.id) || !rank.has(target.id))
      continue;
    nearest.set(source.id, Math.min(nearest.get(source.id) ?? Infinity, rank.get(target.id)! - 1));
  }
  const main = nodes.filter((n) => !isAside.has(n.end.id));
  const last = Math.max(-1, ...main.map((n) => n.rank)) + 1;
  const asideRank = main.length
    ? new Map<string, number>()
    : rankOf(edges.filter((e) => isAside.has(e.source.id) && isAside.has(e.target.id)));
  const rankOfNode = (n: { end: E; rank: number }) =>
    isAside.has(n.end.id)
      ? last + (asideRank.get(n.end.id) ?? 0)
      : (nearest.get(n.end.id) ?? n.rank);
  // Renumbered, so a rank emptied by moving its ends aside leaves no gap.
  const used = [...new Set(nodes.map(rankOfNode))].sort((a, b) => a - b);
  const columnOf = new Map<string, number>();
  for (const n of nodes) columnOf.set(n.end.id, used.indexOf(rankOfNode(n)));
  const columnEnds: E[][] = used.map(() => []);
  for (const n of nodes) columnEnds[columnOf.get(n.end.id)!].push(n.end);
  for (const column of columnEnds) column.sort(compare);
  let order: string[][] = columnEnds.map((column) => column.map((end) => end.id));

  // Each edge becomes segments between adjacent columns, through one pass slot per column it skips.
  const passes = new Map<string, string[]>();
  const segments: [string, string][] = [];
  for (const e of edges) {
    const [a, b] = [columnOf.get(e.source.id), columnOf.get(e.target.id)];
    if (a == null || b == null || a === b) continue;
    const [from, to] = a < b ? [e.source.id, e.target.id] : [e.target.id, e.source.id];
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    const chain = [from];
    const slots: string[] = [];
    for (let c = lo + 1; c < hi; c++) {
      const slot = `${e.id}\u0000${c}`;
      columnOf.set(slot, c);
      order[c].push(slot);
      slots.push(slot);
      chain.push(slot);
    }
    chain.push(to);
    if (slots.length) passes.set(e.id, slots);
    for (let i = 1; i < chain.length; i++) segments.push([chain[i - 1], chain[i]]);
  }
  const isPass = (id: string) => id.includes("\u0000");
  const neighbours = new Map<string, string[]>();
  for (const [a, b] of segments) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }

  // Middle of each slot, so columns of different heights line up on their middles.
  const middles = new Map<string, number>();
  const place = (column: string[]) => {
    const heights = column.map((id) => (isPass(id) ? PASS_SLOT : NODE_SLOT));
    let y = -heights.reduce((a, b) => a + b, 0) / 2;
    column.forEach((id, i) => {
      middles.set(id, y + heights[i] / 2);
      y += heights[i];
    });
  };
  order.forEach(place);

  let best = order;
  let fewest = crossings(segments, columnOf, middles);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const forward = sweep % 2 === 0;
    const next = [...order];
    for (let k = 0; k < next.length; k++) {
      const i = forward ? k : next.length - 1 - k;
      const placed = (id: string) => (forward ? columnOf.get(id)! < i : columnOf.get(id)! > i);
      const weight = new Map<string, number>();
      for (const id of next[i]) {
        const ys = (neighbours.get(id) ?? []).filter(placed).map((n) => middles.get(n)!);
        weight.set(id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : middles.get(id)!);
      }
      // A stable sort, so slots without placed neighbours and ties keep their order.
      next[i] = [...next[i]].sort((x, y) => weight.get(x)! - weight.get(y)!);
      place(next[i]);
    }
    order = next;
    const count = crossings(segments, columnOf, middles);
    if (count < fewest) {
      fewest = count;
      best = order;
    }
  }

  best.forEach(place);
  const positions = new Map<string, Position>();
  for (const [i, column] of best.entries()) {
    for (const id of column) {
      if (!isPass(id)) positions.set(id, { x: i * COLUMN_GAP, y: middles.get(id)! - CARD_H / 2 });
    }
  }
  const waypoints = new Map<string, Position[]>();
  for (const [id, slots] of passes) {
    waypoints.set(
      id,
      slots.map((slot) => ({ x: columnOf.get(slot)! * COLUMN_GAP, y: middles.get(slot)! })),
    );
  }
  return { positions, waypoints };
}

// Pairs of segments in the same gap between adjacent columns whose ends are in opposite orders. Only segments in one
// gap can cross, so each gap is counted on its own, as inversions: sorted by their left ends, a pair crosses where the
// right ends run the other way. A merge sort counts them in n log n, where comparing every pair stalls on a big map.
export function crossings(
  segments: [string, string][],
  columnOf: Map<string, number>,
  middles: Map<string, number>,
): number {
  const gaps = new Map<number, [number, number][]>();
  for (const [a, b] of segments) {
    const gap = columnOf.get(a)!;
    if (!gaps.has(gap)) gaps.set(gap, []);
    gaps.get(gap)!.push([middles.get(a)!, middles.get(b)!]);
  }
  let count = 0;
  for (const ends of gaps.values()) {
    // Equal left ends never cross, so ordering them by their right ends keeps them from counting.
    ends.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    count += inversions(ends.map((e) => e[1]));
  }
  return count;
}

// Pairs i < j with values[i] > values[j], strictly.
function inversions(values: number[]): number {
  if (values.length < 2) return 0;
  const mid = values.length >> 1;
  const left = values.slice(0, mid);
  const right = values.slice(mid);
  let count = inversions(left) + inversions(right);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) values[k++] = left[i++];
    else {
      count += left.length - i;
      values[k++] = right[j++];
    }
  }
  while (i < left.length) values[k++] = left[i++];
  while (j < right.length) values[k++] = right[j++];
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

// Below this a connection is background chatter, such as DNS retries or health probes trickling a few bytes; its
// line would cross the whole map to say almost nothing. The low-traffic switch shows it.
export const QUIET_RATE = 1;

// Without the low-traffic connections unless `show`.
export const dropQuiet = <T extends { total: number }>(edges: T[], show: boolean): T[] =>
  show ? edges : edges.filter((e) => e.total >= QUIET_RATE);

const RATE_UNITS = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];

// Bytes/s in binary units to at most 3 significant digits, so a rate fits a card line: 1.0KB/s, 17.4KB/s, 168KB/s.
// Below 0.1 B/s it says so, rather than rounding to no traffic at all.
export function formatRate(value: number): string {
  if (!(value > 0)) return "0B/s";
  if (value < 0.1) return "<0.1B/s";
  let v = value;
  let unit = 0;
  while (v >= 999.5 && unit < RATE_UNITS.length - 1) {
    v /= 1024;
    unit++;
  }
  return `${v < 99.95 ? v.toFixed(1) : Math.round(v)}${RATE_UNITS[unit]}`;
}

// Every chart colour, ordered so neighbours differ, with the hue family each belongs to: red, pink and fuchsia, or blue
// and sky, read alike at a glance.
const NAMESPACE_COLORS = (
  [
    [1, "blue"],
    [3, "orange"],
    [2, "green"],
    [5, "purple"],
    [6, "orange"],
    [8, "red"],
    [9, "green"],
    [4, "red"],
    [7, "blue"],
    [12, "orange"],
    [10, "green"],
    [11, "red"],
  ] as const
).map(([i, family]) => ({ color: `var(--color-chart-series-${i})`, family }));

const slotOf = (namespace: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < namespace.length; i++) {
    hash = Math.imul(hash ^ namespace.charCodeAt(i), 0x01000193);
  }
  // FNV-1a alone barely mixes its low bits for short names; this finaliser spreads them.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % NAMESPACE_COLORS.length;
};

// A colour per namespace from its name, taken in name order: each starts at its own slot and moves on past colours
// an earlier namespace holds, and past a hue family one holds while another family is still free. So the same
// namespaces always get the same colours, up to twelve never share one, up to five get different families, and
// adding a namespace that sorts after another never changes the other's colour.
export function namespaceColors(namespaces: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<number>();
  const families = new Set<string>();
  const allFamilies = new Set(NAMESPACE_COLORS.map((c) => c.family)).size;
  const n = NAMESPACE_COLORS.length;
  for (const name of [...new Set(namespaces)].sort((a, b) => a.localeCompare(b))) {
    const start = slotOf(name);
    const free = (slot: number) => !taken.has(slot);
    const fresh = (slot: number) => free(slot) && !families.has(NAMESPACE_COLORS[slot].family);
    const want = families.size < allFamilies ? fresh : free;
    let slot = start;
    for (let tries = 0; tries < n && !want(slot); tries++) slot = (slot + 1) % n;
    if (!free(slot)) slot = start;
    taken.add(slot);
    families.add(NAMESPACE_COLORS[slot].family);
    out.set(name, NAMESPACE_COLORS[slot].color);
  }
  return out;
}
