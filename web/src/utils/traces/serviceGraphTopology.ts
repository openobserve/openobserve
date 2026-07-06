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

//! Service graph topology built live from the raw traces stream.
//!
//! The pre-aggregated `_o2_service_graph` stream loses inferred dependencies
//! (databases/queues/external), so the topology + node kinds are derived here
//! from the traces query instead, and `_o2_service_graph` is used only to
//! decorate edges with latency metrics (see `mergeEdgeMetrics`).

export interface ServiceEdgeRow {
  client: string | null;
  server: string;
  total_requests?: number;
  errors?: number;
}

export interface InferredEdgeRow {
  client: string;
  server: string;
  connection_type: string;
  total_requests?: number;
  errors?: number;
}

export interface GraphNode {
  id: string;
  label: string;
  requests: number;
  errors: number;
  service_type?: string;
}

export interface GraphEdge {
  from: string | null;
  to: string;
  total_requests: number;
  failed_requests: number;
  error_rate: number;
  p50_latency_ns?: number;
  p95_latency_ns?: number;
  p99_latency_ns?: number;
  connection_type?: string;
}

function ensureNode(
  map: Map<string, GraphNode>,
  id: string,
  serviceType?: string,
): GraphNode {
  let n = map.get(id);
  if (!n) {
    n = { id, label: id, requests: 0, errors: 0, service_type: serviceType };
    map.set(id, n);
  }
  // A real-service classification (undefined type) always wins over inferred.
  if (serviceType === undefined) n.service_type = undefined;
  return n;
}

/**
 * Build the graph topology (nodes + edges + kinds) from the two traces queries.
 * Service→service rows produce real service nodes; inferred rows produce typed
 * dependency nodes (added in a later step). Inferred targets appear only when
 * their name is not already a real service.
 */
export function buildTopologyFromTraces(
  serviceRows: ServiceEdgeRow[],
  inferredRows: InferredEdgeRow[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const r of serviceRows) {
    const req = r.total_requests ?? 0;
    const err = r.errors ?? 0;
    const server = ensureNode(nodes, r.server);
    server.requests += req;
    server.errors += err;
    if (r.client) {
      const client = ensureNode(nodes, r.client);
      client.requests += req;
      client.errors += err;
    }
    edges.push({
      from: r.client,
      to: r.server,
      total_requests: req,
      failed_requests: err,
      error_rate: req > 0 ? (err / req) * 100 : 0,
    });
  }

  // A name is a "real service" if it appears as a service_name in serviceRows.
  const realServices = new Set<string>();
  for (const r of serviceRows) {
    realServices.add(r.server);
    if (r.client) realServices.add(r.client);
  }

  for (const r of inferredRows) {
    const req = r.total_requests ?? 0;
    const err = r.errors ?? 0;
    const client = ensureNode(nodes, r.client); // caller is always a real service
    client.requests += req;
    client.errors += err;

    const collides = realServices.has(r.server);
    if (!collides) {
      // Genuine infra dependency → typed inferred node.
      const dep = ensureNode(nodes, r.server, r.connection_type);
      dep.requests += req;
      dep.errors += err;
    } else {
      // Collision: keep the real service node; ensure it exists, real type wins.
      ensureNode(nodes, r.server);
    }

    edges.push({
      from: r.client,
      to: r.server, // retargets to the real service on collision (same id)
      total_requests: req,
      failed_requests: err,
      error_rate: req > 0 ? (err / req) * 100 : 0,
      // Only mark the edge inferred when the target is a genuine inferred node.
      connection_type: collides ? undefined : r.connection_type,
    });
  }

  return { nodes: Array.from(nodes.values()), edges };
}

export interface EdgeMetrics {
  from: string | null;
  to: string;
  p50_latency_ns?: number;
  p95_latency_ns?: number;
  p99_latency_ns?: number;
  error_rate?: number;
  total_requests?: number;
}

const edgeKey = (from: string | null, to: string) => `${from ?? ""} ${to}`;

/**
 * Decorate the traces-derived topology with pre-aggregated edge metrics from
 * `_o2_service_graph`. Topology is authoritative — an edge with no matching
 * metric keeps undefined latency but still renders.
 */
export function mergeEdgeMetrics(
  topology: { nodes: GraphNode[]; edges: GraphEdge[] },
  metricEdges: EdgeMetrics[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byKey = new Map<string, EdgeMetrics>();
  for (const m of metricEdges) byKey.set(edgeKey(m.from, m.to), m);

  const edges = topology.edges.map((e) => {
    const m = byKey.get(edgeKey(e.from, e.to));
    if (!m) return e;
    return {
      ...e,
      p50_latency_ns: m.p50_latency_ns,
      p95_latency_ns: m.p95_latency_ns,
      p99_latency_ns: m.p99_latency_ns,
      // Prefer live error_rate from traces; fall back to metrics if edge had none.
      error_rate: e.error_rate || m.error_rate || 0,
    };
  });

  return { nodes: topology.nodes, edges };
}
