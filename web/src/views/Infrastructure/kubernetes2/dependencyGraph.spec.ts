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
import type { Series } from "./kubernetesModel";
import {
  MAX_GRAPH_EDGES,
  buildGraph,
  endOf,
  filterFlows,
  flowQuery,
  flowWindowSeconds,
  layoutGraph,
  pairFlows,
  type FlowEdge,
  type FlowFilter,
} from "./dependencyGraph";

type End = [namespace: string, type: string, name: string];

const W = (namespace: string, name: string, type = "Deployment"): End => [namespace, type, name];
const NODE = (name: string): End => ["", "Node", name];
const EXTERNAL: End = ["", "", ""];

const flow = (src: End, dst: End, direction: string, value: number, host = "h1"): Series => ({
  metric: {
    host_id: host,
    k8s_cluster: "prod",
    k8s_src_namespace: src[0],
    k8s_src_owner_type: src[1],
    k8s_src_owner_name: src[2],
    k8s_dst_namespace: dst[0],
    k8s_dst_owner_type: dst[1],
    k8s_dst_owner_name: dst[2],
    direction,
  },
  value,
});

const WEB = W("frontend", "web");
const API = W("backend", "api");
const DB = W("data", "postgres", "StatefulSet");

const names = (e: FlowEdge) => [e.source.name, e.target.name];

const ALL: FlowFilter = { namespaces: [], search: "", showSystem: true, showNodeTraffic: true };

describe("flowQuery", () => {
  it("sums per reporting node and direction, and drops Service rows", () => {
    expect(flowQuery(null, 3600)).toBe(
      "sum by (k8s_cluster, k8s_src_namespace, k8s_src_owner_name, k8s_src_owner_type, " +
        "k8s_dst_namespace, k8s_dst_owner_name, k8s_dst_owner_type, direction, host_id) (" +
        'rate(obi_network_flow_bytes{k8s_src_owner_type!="Service", k8s_dst_owner_type!="Service"}[3600s]))',
    );
  });

  it("scopes to the cluster, escaping its name", () => {
    expect(flowQuery('pr"od', 300)).toContain('{k8s_cluster="pr\\"od", k8s_src_owner_type');
  });
});

describe("flowWindowSeconds", () => {
  it.each([
    [60, 300],
    [3600, 3600],
    [7 * 86_400, 86_400],
  ])("rates a %ss range over %ss", (seconds, window) => {
    expect(flowWindowSeconds(0, seconds * 1_000_000)).toBe(window);
  });
});

describe("endOf", () => {
  it("names a workload by namespace, owner type and name", () => {
    expect(endOf(flow(API, DB, "request", 1).metric, "dst")).toEqual({
      id: "prod/data/StatefulSet/postgres",
      kind: "workload",
      cluster: "prod",
      namespace: "data",
      name: "postgres",
      ownerType: "StatefulSet",
    });
  });

  it("reads a Node owner as the node and an empty owner as outside the cluster", () => {
    const metric = flow(NODE("n1"), EXTERNAL, "request", 1).metric;
    expect(endOf(metric, "src")).toMatchObject({ id: "prod/node/n1", kind: "node", name: "n1" });
    expect(endOf(metric, "dst")).toMatchObject({ id: "prod/external", kind: "external" });
  });
});

describe("pairFlows", () => {
  it("draws one edge per pair, client to server, with the bytes each way", () => {
    const [edge] = pairFlows([flow(DB, API, "response", 30), flow(API, DB, "request", 10)]);
    expect(names(edge)).toEqual(["api", "postgres"]);
    expect(edge).toMatchObject({ directed: true, forward: 10, backward: 30, total: 40 });
    expect(edge).toMatchObject({ request: 10, response: 30, unknown: 0 });
  });

  it("orients from responses alone when the requests went unseen", () => {
    const [edge] = pairFlows([flow(API, WEB, "response", 50), flow(WEB, API, "unknown", 5)]);
    expect(names(edge)).toEqual(["web", "api"]);
    expect(edge.directed).toBe(true);
  });

  it("leaves a pair undirected when most of its bytes have no direction", () => {
    const [edge] = pairFlows([
      flow(API, DB, "unknown", 80),
      flow(DB, API, "unknown", 80),
      flow(API, DB, "request", 10),
    ]);
    expect(edge.directed).toBe(false);
    expect(edge.total).toBe(170);
  });

  it("counts cross-node traffic once, keeping the direction from the node that saw it", () => {
    const [edge] = pairFlows([
      flow(WEB, API, "request", 100, "n1"),
      flow(API, WEB, "response", 300, "n1"),
      flow(WEB, API, "unknown", 100, "n2"),
      flow(API, WEB, "unknown", 300, "n2"),
    ]);
    expect(edge).toMatchObject({ total: 400, directed: true, request: 100, response: 300 });
    expect(edge.unknown).toBe(0);
    expect(names(edge)).toEqual(["web", "api"]);
  });

  it("keeps the busier node's count for each direction of travel", () => {
    const [edge] = pairFlows([
      flow(WEB, API, "request", 90, "n1"),
      flow(WEB, API, "request", 70, "n2"),
      flow(WEB, API, "unknown", 30, "n2"),
    ]);
    expect(edge).toMatchObject({ forward: 100, unknown: 0 });
    expect(edge.request).toBeCloseTo(100);
  });

  it("orients from the node that saw the direction, even when another node counted more", () => {
    const [edge] = pairFlows([
      flow(WEB, API, "unknown", 100, "n1"),
      flow(WEB, API, "request", 98, "n2"),
    ]);
    expect(edge).toMatchObject({ total: 100, directed: true });
    expect(names(edge)).toEqual(["web", "api"]);
  });

  it("stays undirected when no node saw the direction", () => {
    const [edge] = pairFlows([
      flow(WEB, API, "unknown", 100, "n1"),
      flow(WEB, API, "unknown", 98, "n2"),
    ]);
    expect(edge).toMatchObject({ total: 100, directed: false, unknown: 100 });
  });

  it("adds a pair's request and unknown rows together", () => {
    const [edge] = pairFlows([flow(WEB, API, "request", 90), flow(WEB, API, "unknown", 3)]);
    expect(edge).toMatchObject({ forward: 93, backward: 0, request: 90, unknown: 3 });
  });

  it("skips idle rows and traffic inside one workload or one node", () => {
    expect(
      pairFlows([
        flow(API, API, "request", 10),
        flow(NODE("n1"), NODE("n1"), "unknown", 10),
        flow(EXTERNAL, EXTERNAL, "unknown", 10),
        flow(WEB, API, "request", 0),
      ]),
    ).toEqual([]);
  });

  it("keeps a Job and a CronJob of the same name apart", () => {
    const edges = pairFlows([
      flow(W("batch", "load", "Job"), API, "request", 1),
      flow(W("batch", "load", "CronJob"), API, "request", 1),
    ]);
    expect(edges).toHaveLength(2);
  });
});

describe("filterFlows", () => {
  const edges = pairFlows([
    flow(WEB, API, "request", 10),
    flow(API, DB, "request", 10),
    flow(W("kube-system", "coredns"), API, "response", 10),
    flow(NODE("n1"), NODE("n2"), "unknown", 10),
    flow(NODE("n1"), API, "request", 10),
    flow(API, EXTERNAL, "request", 10),
    flow(W("kube-system", "coredns"), W("openobserve-collector", "gateway"), "request", 10),
  ]);
  const pairs = (filter: Partial<FlowFilter>) =>
    filterFlows(edges, { ...ALL, ...filter }).map((e) => names(e).join(">"));

  it("hides system namespaces and node-to-node traffic when asked", () => {
    expect(pairs({ showSystem: false, showNodeTraffic: false })).toEqual([
      "web>api",
      "api>postgres",
      "n1>api",
      "api>",
    ]);
  });

  it("keeps the edges of a system namespace that the namespace filter picks", () => {
    expect(pairs({ showSystem: false, namespaces: ["kube-system"] })).toEqual([
      "api>coredns",
      "coredns>gateway",
    ]);
  });

  it("keeps the edges that touch a picked namespace, with their other ends", () => {
    expect(pairs({ namespaces: ["data"] })).toEqual(["api>postgres"]);
  });

  it("searches both ends by name and namespace", () => {
    expect(pairs({ search: "POSTGRES" })).toEqual(["api>postgres"]);
    expect(pairs({ search: "frontend" })).toEqual(["web>api"]);
  });
});

describe("buildGraph", () => {
  const chain = pairFlows([
    flow(W("frontend", "loadgen"), WEB, "request", 100),
    flow(WEB, API, "request", 50),
    flow(API, DB, "request", 20),
    flow(W("batch", "pinger", "CronJob"), DB, "request", 1),
  ]);

  it("ranks each caller left of what it calls", () => {
    const rank = Object.fromEntries(buildGraph(chain).nodes.map((n) => [n.end.name, n.rank]));
    expect(rank).toEqual({ loadgen: 0, web: 1, api: 2, postgres: 3, pinger: 0 });
  });

  it("keeps the busiest ends and only the edges between them", () => {
    const graph = buildGraph(chain, 3);
    expect(graph.nodes.map((n) => n.end.name).sort()).toEqual(["api", "loadgen", "web"]);
    expect(graph.edges.map((e) => names(e).join(">"))).toEqual(["loadgen>web", "web>api"]);
  });

  it("draws the busiest edges whole rather than one end of many", () => {
    const disjoint = pairFlows(
      Array.from({ length: 80 }, (_, i) =>
        flow(W("a", `client-${i}`), W("b", `server-${i}`), "request", 10),
      ),
    );
    const graph = buildGraph(disjoint, 80);
    expect(graph.edges).toHaveLength(40);
    expect(graph.nodes).toHaveLength(80);
  });

  it("caps a dense graph's edges, busiest first", () => {
    const ends = Array.from({ length: 25 }, (_, i) => W("mesh", `svc-${i}`));
    const rows: Series[] = [];
    ends.forEach((a, i) =>
      ends.slice(i + 1).forEach((b, j) => rows.push(flow(a, b, "request", 1000 - i - j))),
    );
    const dense = pairFlows(rows);
    expect(dense).toHaveLength(300);
    const graph = buildGraph(dense);
    expect(graph.edges).toHaveLength(MAX_GRAPH_EDGES);
    const weakestKept = Math.min(...graph.edges.map((e) => e.total));
    const left = dense.filter((e) => !graph.edges.includes(e));
    expect(Math.max(...left.map((e) => e.total))).toBeLessThanOrEqual(weakestKept);
  });

  it("survives a cycle", () => {
    const cycle = pairFlows([
      flow(WEB, API, "request", 10),
      flow(API, DB, "request", 10),
      flow(DB, WEB, "request", 10),
    ]);
    expect(buildGraph(cycle).nodes).toHaveLength(3);
  });

  it("puts undirected ends in the first column", () => {
    const graph = buildGraph(pairFlows([flow(API, DB, "unknown", 10)]));
    expect(graph.nodes.map((n) => n.rank)).toEqual([0, 0]);
  });
});

describe("layoutGraph", () => {
  it("places ranks in columns and centres each column", () => {
    const graph = buildGraph(
      pairFlows([flow(WEB, API, "request", 10), flow(WEB, DB, "request", 10)]),
    );
    const at = layoutGraph(graph.nodes);
    expect(at.get("prod/frontend/Deployment/web")).toEqual({ x: 0, y: 0 });
    const api = at.get("prod/backend/Deployment/api")!;
    const db = at.get("prod/data/StatefulSet/postgres")!;
    expect(api.x).toBe(db.x);
    expect(api.x).toBeGreaterThan(0);
    expect(api.y + db.y).toBe(0);
    expect(api.y).toBeLessThan(db.y);
  });
});
