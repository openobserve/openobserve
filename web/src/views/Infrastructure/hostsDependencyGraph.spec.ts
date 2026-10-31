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
import type { Series } from "./kubernetes2/kubernetesModel";
import { buildGraph } from "./kubernetes2/dependencyGraph";
import {
  hostFlowQuery,
  isSelfEdge,
  layoutHostGraph,
  pairHostFlows,
  type HostFlowEdge,
} from "./hostsDependencyGraph";

const flow = (
  host: string,
  src: string,
  dst: string,
  direction: string,
  value: number,
): Series => ({
  metric: { host_name: host, src_cidr: src, dst_cidr: dst, direction },
  value,
});

// Recorded from four VMs on two machines, each running the agent with the same --network-flows list.
const LIVE: Series[] = [
  flow("m1-api", "m1-api", "m1-web", "response", 231576.26),
  flow("m1-web", "m1-api", "m1-web", "response", 2579.91),
  flow("m3-web", "m3-api", "m3-web", "response", 2577.44),
  flow("m3-api", "m3-api", "m3-web", "response", 2526.58),
  flow("m1-api", "m1-web", "m1-api", "request", 1856.41),
  flow("m3-web", "m3-web", "m3-api", "request", 1655.81),
  flow("m1-web", "m1-web", "m1-api", "request", 1654.69),
  flow("m3-api", "m3-web", "m3-api", "request", 1623.16),
  flow("m1-api", "m1-api", "mini3", "request", 986.46),
  flow("m3-api", "m3-api", "mini3", "request", 907.1),
  flow("m3-web", "mini3", "m3-web", "response", 846.45),
  flow("m1-web", "mini3", "m1-web", "response", 835.27),
  flow("m3-web", "m3-web", "mini3", "request", 384.93),
  flow("m1-web", "m1-web", "mini3", "request", 369.25),
  flow("m1-api", "mini3", "m1-api", "response", 98.18),
  flow("m3-api", "mini3", "m3-api", "response", 92.12),
  flow("m1-web", "mini3", "m1-web", "unknown", 2.2),
  flow("m3-web", "mini3", "m3-web", "unknown", 1.1),
  flow("m3-api", "mini3", "m3-api", "unknown", 1.1),
  flow("m1-web", "m1-api", "m1-web", "unknown", 0.28),
  flow("m3-api", "m3-api", "vmhost", "request", 3),
  flow("m3-api", "vmhost", "m3-api", "response", 2),
  flow("m1-web", "loopback", "loopback", "unknown", 4),
  flow("m1-web", "m1-web", "other", "request", 0),
];

const names = (e: HostFlowEdge) => [e.source.name, e.target.name];

const edge = (edges: HostFlowEdge[], a: string, b: string) =>
  edges.find((e) => [a, b].every((n) => names(e).includes(n)) && (a === b) === isSelfEdge(e))!;

describe("hostFlowQuery", () => {
  it("sums per reporting host and direction, without a direction filter", () => {
    expect(hostFlowQuery(3600)).toBe(
      "sum by (src_cidr, dst_cidr, direction, host_name) (rate(obi_network_flow_bytes[3600s]))",
    );
  });
});

describe("pairHostFlows", () => {
  const edges = pairHostFlows(LIVE);

  it("draws one edge per pair of names, client to server", () => {
    expect(edges.map(names).sort()).toEqual(
      [
        ["loopback", "loopback"],
        ["m1-api", "mini3"],
        ["m1-web", "m1-api"],
        ["m1-web", "mini3"],
        ["m3-api", "mini3"],
        ["m3-api", "vmhost"],
        ["m3-web", "m3-api"],
        ["m3-web", "mini3"],
      ].sort(),
    );
    expect(edges.filter((e) => !isSelfEdge(e)).every((e) => e.directed)).toBe(true);
  });

  it("marks reporting host names as hosts and every other name as a network", () => {
    const web = edge(edges, "m1-web", "mini3");
    expect(web.source).toEqual({ id: "m1-web", kind: "host", name: "m1-web" });
    expect(web.target).toEqual({ id: "mini3", kind: "network", name: "mini3" });
    expect(edge(edges, "loopback", "loopback").source.kind).toBe("network");
  });

  it("counts traffic between two agents once, from the host that saw the most of it", () => {
    const pair = edge(edges, "m1-web", "m1-api");
    // m1-api's 231576 response bytes, not m1-web's 2580 added to them.
    expect(pair.backward).toBeCloseTo(231576.26);
    expect(pair.forward).toBeCloseTo(1856.41);
  });

  it("keeps an edge only one agent reports, with its direction split", () => {
    const pair = edge(edges, "m1-web", "mini3");
    expect(pair.forward).toBeCloseTo(369.25);
    expect(pair.backward).toBeCloseTo(837.47);
    expect(pair.unknown).toBeCloseTo(2.2);
  });

  it("keeps traffic within one name as a self edge", () => {
    expect(edge(edges, "loopback", "loopback").total).toBe(4);
  });

  it("gathers addresses no entry names into one unnamed end", () => {
    const [e] = pairHostFlows([
      flow("m1-web", "m1-web", "", "request", 5),
      flow("m1-web", "", "m1-web", "response", 7),
    ]);
    expect(e.target).toEqual({ id: "(unnamed)", kind: "unnamed", name: "" });
    expect(e.total).toBe(12);
  });

  it("reads a series without CIDR labels as unnamed at both ends", () => {
    const [e] = pairHostFlows([{ metric: { host_name: "h", direction: "unknown" }, value: 1 }]);
    expect(isSelfEdge(e)).toBe(true);
    expect(e.source.kind).toBe("unnamed");
  });

  it("returns nothing for no data or idle series", () => {
    expect(pairHostFlows([])).toEqual([]);
    expect(pairHostFlows([flow("h", "a", "b", "request", 0)])).toEqual([]);
  });
});

describe("layoutHostGraph", () => {
  it("lists hosts before networks before unnamed addresses in a column", () => {
    const graph = buildGraph(
      pairHostFlows([
        flow("web", "", "lan", "unknown", 1),
        flow("web", "lan", "web", "unknown", 1),
        flow("web", "web", "", "unknown", 1),
      ]),
    );
    const positions = layoutHostGraph(graph.nodes);
    const ys = ["web", "lan", "(unnamed)"].map((id) => positions.get(id)!.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });
});
