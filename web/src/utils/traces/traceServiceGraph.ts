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

import type { Span } from "@/ts/interfaces/traces/span.types";
import { isSpanError } from "@/utils/traces/patternDetection";
import { useSpanServiceDetection } from "@/utils/traces/useSpanServiceDetection";

export interface TraceServiceGraphNode {
  id: string;
  label: string;
  requests: number;
  errors: number;
  error_rate: number;
  service_type?: string;
}

export interface TraceServiceGraphEdge {
  from: string;
  to: string;
  total_requests: number;
  failed_requests: number;
  error_rate: number;
}

export interface TraceServiceGraph {
  nodes: TraceServiceGraphNode[];
  edges: TraceServiceGraphEdge[];
}

interface TraceGraphSpan {
  span_id?: string;
  reference_parent_span_id?: string;
  service_name?: string;
  infer_service_name?: string;
  infer_service_system?: string;
  infer_service_type?: string;
  span_status?: string;
  status_code?: number;
}

interface NamedTreeNode {
  name: string;
  children?: NamedTreeNode[];
}

const toRate = (failed: number, total: number) => (total > 0 ? (failed / total) * 100 : 0);

/** Aggregates a trace's spans into the service graph shape `convertServiceGraphToNetwork` draws. */
export function buildTraceServiceGraph(
  spans: TraceGraphSpan[],
  unknownServiceLabel = "unknown",
): TraceServiceGraph {
  const { resolveSpanIdentity } = useSpanServiceDetection();
  const identityBySpanId = new Map<string, string>();
  const nodes = new Map<string, TraceServiceGraphNode>();
  const edges = new Map<string, TraceServiceGraphEdge>();

  spans.forEach((span) => {
    const id = resolveSpanIdentity(span as Span) || unknownServiceLabel;
    if (span.span_id) identityBySpanId.set(span.span_id, id);
    const node = nodes.get(id) ?? {
      id,
      label: id,
      requests: 0,
      errors: 0,
      error_rate: 0,
      service_type: undefined,
    };
    node.requests += 1;
    if (isSpanError(span)) node.errors += 1;
    if (!node.service_type && (span.infer_service_name || span.infer_service_system)) {
      node.service_type = span.infer_service_type || undefined;
    }
    nodes.set(id, node);
  });

  spans.forEach((span) => {
    const from = identityBySpanId.get(span.reference_parent_span_id ?? "");
    const to = identityBySpanId.get(span.span_id ?? "");
    if (!from || !to || from === to) return;
    const key = `${from}\u0000${to}`;
    const edge = edges.get(key) ?? {
      from,
      to,
      total_requests: 0,
      failed_requests: 0,
      error_rate: 0,
    };
    edge.total_requests += 1;
    if (isSpanError(span)) edge.failed_requests += 1;
    edges.set(key, edge);
  });

  nodes.forEach((node) => (node.error_rate = toRate(node.errors, node.requests)));
  edges.forEach((edge) => (edge.error_rate = toRate(edge.failed_requests, edge.total_requests)));

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    ),
  };
}

/** ServiceGraph.vue `applyFilters` rule, but isolated matching nodes are also kept. */
export function filterTraceServiceGraph(
  graph: TraceServiceGraph,
  search: string,
): TraceServiceGraph {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return graph;
  const matchingNodeIds = new Set(
    graph.nodes.filter((n) => n.label.toLowerCase().includes(trimmed)).map((n) => n.id),
  );
  const edges = graph.edges.filter((e) => matchingNodeIds.has(e.from) || matchingNodeIds.has(e.to));
  const usedNodeIds = new Set([...edges.map((e) => e.from), ...edges.map((e) => e.to)]);
  return {
    nodes: graph.nodes.filter((n) => matchingNodeIds.has(n.id) || usedNodeIds.has(n.id)),
    edges,
  };
}

/** Keeps matching nodes with their whole subtree, plus their ancestors so the tree stays connected. */
export function filterTraceTree<T extends NamedTreeNode>(nodes: T[], search: string): T[] {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return nodes;
  const prune = (list: T[]): T[] =>
    list.flatMap((node) => {
      if (node.name.toLowerCase().includes(trimmed)) return [node];
      const children = prune((node.children ?? []) as T[]);
      return children.length ? [{ ...node, children }] : [];
    });
  return prune(nodes);
}
