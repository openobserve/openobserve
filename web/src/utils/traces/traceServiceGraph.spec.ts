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

import { describe, expect, it } from "vitest";
import {
  buildTraceServiceGraph,
  filterTraceServiceGraph,
  filterTraceTree,
} from "./traceServiceGraph";

const span = (
  span_id: string,
  service_name: string,
  reference_parent_span_id = "",
  extra: Record<string, unknown> = {},
) => ({ span_id, service_name, reference_parent_span_id, span_status: "UNSET", ...extra });

describe("buildTraceServiceGraph", () => {
  it("returns an empty graph for an empty span list", () => {
    expect(buildTraceServiceGraph([])).toEqual({ nodes: [], edges: [] });
  });

  it("builds a single node for a single-service trace", () => {
    expect(buildTraceServiceGraph([span("a", "api"), span("b", "api", "a")])).toEqual({
      nodes: [
        {
          id: "api",
          label: "api",
          requests: 2,
          errors: 0,
          error_rate: 0,
          service_type: undefined,
        },
      ],
      edges: [],
    });
  });

  it("draws an edge for each parent→child service hop in a chain", () => {
    const graph = buildTraceServiceGraph([
      span("a", "web"),
      span("b", "api", "a"),
      span("c", "db", "b"),
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["api", "db", "web"]);
    expect(graph.edges).toEqual([
      { from: "api", to: "db", total_requests: 1, failed_requests: 0, error_rate: 0 },
      { from: "web", to: "api", total_requests: 1, failed_requests: 0, error_rate: 0 },
    ]);
  });

  it("aggregates repeated calls between the same services", () => {
    const graph = buildTraceServiceGraph([
      span("a", "web"),
      span("b", "api", "a"),
      span("c", "api", "a"),
      span("d", "api", "a"),
    ]);
    expect(graph.edges).toEqual([
      { from: "web", to: "api", total_requests: 3, failed_requests: 0, error_rate: 0 },
    ]);
    expect(graph.nodes.find((n) => n.id === "api")?.requests).toBe(3);
  });

  it("counts error spans on nodes and edges", () => {
    const graph = buildTraceServiceGraph([
      span("a", "web"),
      span("b", "api", "a", { span_status: "ERROR" }),
      span("c", "api", "a", { status_code: 2 }),
      span("d", "api", "a"),
      span("e", "api", "a"),
    ]);
    const api = graph.nodes.find((n) => n.id === "api")!;
    expect(api.errors).toBe(2);
    expect(api.error_rate).toBe(50);
    expect(graph.edges[0]).toEqual({
      from: "web",
      to: "api",
      total_requests: 4,
      failed_requests: 2,
      error_rate: 50,
    });
  });

  it("names inferred services by their inferred identity and carries the service type", () => {
    const graph = buildTraceServiceGraph([
      span("a", "api"),
      span("b", "api", "a", { infer_service_name: "postgres", infer_service_type: "database" }),
    ]);
    expect(graph.nodes).toEqual([
      { id: "api", label: "api", requests: 1, errors: 0, error_rate: 0, service_type: undefined },
      {
        id: "postgres",
        label: "postgres",
        requests: 1,
        errors: 0,
        error_rate: 0,
        service_type: "database",
      },
    ]);
    expect(graph.edges.map((e) => [e.from, e.to])).toEqual([["api", "postgres"]]);
  });

  it("names spans without any service by the given unknown-service label", () => {
    const graph = buildTraceServiceGraph([span("a", "web"), span("b", "", "a")], "Unknown Service");
    expect(graph.nodes.map((n) => n.id)).toEqual(["Unknown Service", "web"]);
    expect(graph.edges.map((e) => [e.from, e.to])).toEqual([["web", "Unknown Service"]]);
  });

  it("adds no edge for a span whose parent is not in the trace", () => {
    const graph = buildTraceServiceGraph([span("a", "web"), span("b", "api", "missing")]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["api", "web"]);
    expect(graph.edges).toEqual([]);
  });

  it("adds no edge for a call within the same service", () => {
    const graph = buildTraceServiceGraph([
      span("a", "api"),
      span("b", "api", "a"),
      span("c", "db", "b"),
    ]);
    expect(graph.edges.map((e) => [e.from, e.to])).toEqual([["api", "db"]]);
  });
});

describe("filterTraceServiceGraph", () => {
  const graph = buildTraceServiceGraph([
    span("a", "web"),
    span("b", "api", "a"),
    span("c", "db", "b"),
    span("d", "Cache", "a"),
  ]);

  it("returns the graph unchanged for an empty search", () => {
    expect(filterTraceServiceGraph(graph, "  ")).toEqual(graph);
  });

  it("keeps edges touching a matching node and the nodes on those edges", () => {
    const filtered = filterTraceServiceGraph(graph, "DB");
    expect(filtered.edges.map((e) => [e.from, e.to])).toEqual([["api", "db"]]);
    expect(filtered.nodes.map((n) => n.id)).toEqual(["api", "db"]);
  });

  it("matches case-insensitively", () => {
    expect(filterTraceServiceGraph(graph, "cache").nodes.map((n) => n.id)).toEqual([
      "Cache",
      "web",
    ]);
  });

  it("keeps a matching node that has no edges", () => {
    const withOrphan = buildTraceServiceGraph([span("a", "web"), span("b", "batch", "missing")]);
    expect(filterTraceServiceGraph(withOrphan, "batch")).toEqual({
      nodes: [withOrphan.nodes[0]],
      edges: [],
    });
    expect(withOrphan.nodes[0].id).toBe("batch");
  });

  it("returns an empty graph when nothing matches", () => {
    expect(filterTraceServiceGraph(graph, "nope")).toEqual({ nodes: [], edges: [] });
  });
});

describe("filterTraceTree", () => {
  const tree = [
    {
      name: "web",
      children: [{ name: "api", children: [{ name: "db" }] }, { name: "cache" }],
    },
    { name: "batch" },
  ];

  it("returns the tree unchanged for an empty search", () => {
    expect(filterTraceTree(tree, "")).toEqual(tree);
  });

  it("keeps a match together with its ancestors and drops other branches", () => {
    expect(filterTraceTree(tree, "DB")).toEqual([
      { name: "web", children: [{ name: "api", children: [{ name: "db" }] }] },
    ]);
  });

  it("keeps a matching node's whole subtree", () => {
    expect(filterTraceTree(tree, "api")).toEqual([
      { name: "web", children: [{ name: "api", children: [{ name: "db" }] }] },
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterTraceTree(tree, "nope")).toEqual([]);
  });
});
