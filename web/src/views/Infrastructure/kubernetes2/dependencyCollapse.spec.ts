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
import type { FlowEdge, FlowEnd } from "./dependencyGraph";
import { collapseNamespaces, namespaceId, shouldCollapse } from "./dependencyCollapse";

const workload = (namespace: string, name: string): FlowEnd => ({
  id: `prod/${namespace}/Deployment/${name}`,
  kind: "workload",
  cluster: "prod",
  namespace,
  name,
  ownerType: "Deployment",
});

const NODE: FlowEnd = {
  id: "prod/node/n1",
  kind: "node",
  cluster: "prod",
  namespace: "",
  name: "n1",
  ownerType: "Node",
};

const EXTERNAL: FlowEnd = {
  id: "prod/external",
  kind: "external",
  cluster: "prod",
  namespace: "",
  name: "",
  ownerType: "",
};

const edge = (source: FlowEnd, target: FlowEnd, over: Partial<FlowEdge> = {}): FlowEdge => ({
  id: [source.id, target.id].sort().join("\n"),
  source,
  target,
  directed: true,
  forward: 10,
  backward: 2,
  request: 8,
  response: 3,
  unknown: 1,
  total: 12,
  ...over,
});

const state = (over: Partial<Parameters<typeof collapseNamespaces>[1]> = {}) => ({
  mode: "collapsed" as const,
  expanded: new Set<string>(),
  threshold: 40,
  ...over,
});

const web = workload("frontend", "web");
const web2 = workload("frontend", "web2");
const api = workload("backend", "api");
const db = workload("data", "db");

describe("shouldCollapse", () => {
  const many = Array.from({ length: 21 }, (_, i) =>
    edge(workload("a", `s${i}`), workload("b", `t${i}`)),
  );

  it("collapses in auto mode only above the threshold of distinct ends", () => {
    expect(shouldCollapse(many, state({ mode: "auto" }))).toBe(true);
    expect(shouldCollapse(many, state({ mode: "auto", threshold: 42 }))).toBe(false);
    expect(shouldCollapse(many, state({ mode: "auto", threshold: 41 }))).toBe(true);
  });

  it("forces collapse in collapsed mode and never in expanded mode", () => {
    expect(shouldCollapse([edge(web, api)], state({ mode: "collapsed" }))).toBe(true);
    expect(shouldCollapse(many, state({ mode: "expanded" }))).toBe(false);
  });
});

describe("collapseNamespaces", () => {
  it("returns the edges untouched when not collapsing", () => {
    const edges = [edge(web, api)];
    expect(collapseNamespaces(edges, state({ mode: "expanded" }))).toBe(edges);
    expect(collapseNamespaces(edges, state({ mode: "auto" }))).toBe(edges);
  });

  it("replaces workloads with one boundary end per namespace", () => {
    const [e] = collapseNamespaces([edge(web, api)], state());
    expect(e.source).toEqual({
      id: "__ns__prod/frontend",
      kind: "workload",
      cluster: "prod",
      namespace: "frontend",
      name: "frontend",
      ownerType: "Namespace",
      group: true,
      members: 1,
    });
    expect(e.target.id).toBe("__ns__prod/backend");
  });

  it("counts distinct collapsed workloads as members", () => {
    const out = collapseNamespaces([edge(web, api), edge(web2, api), edge(web, db)], state());
    const boundary = out.map((e) => e.source).find((s) => s.namespace === "frontend");
    expect(boundary?.members).toBe(2);
  });

  it("merges edges between the same namespaces, summing their rates", () => {
    const out = collapseNamespaces(
      [edge(web, api), edge(web2, api, { forward: 5, backward: 1, request: 4, total: 6 })],
      state(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      forward: 15,
      backward: 3,
      request: 12,
      response: 6,
      unknown: 2,
      total: 18,
      directed: true,
    });
  });

  it("merges opposite orientations of a pair into one edge", () => {
    const out = collapseNamespaces(
      [edge(web, api), edge(api, web2, { forward: 4, backward: 1, total: 5 })],
      state(),
    );
    expect(out).toHaveLength(1);
    const [e] = out;
    expect(e.forward + e.backward).toBe(12 + 5);
    expect(e.total).toBe(17);
    expect(e.directed).toBe(true);
    // The heavier directed side is the client.
    expect(e.source.namespace).toBe("frontend");
    expect(e.forward).toBe(10 + 1);
    expect(e.backward).toBe(2 + 4);
  });

  it("keeps a merged edge undirected when none of its edges are directed", () => {
    const [e] = collapseNamespaces(
      [edge(web, api, { directed: false }), edge(web2, api, { directed: false })],
      state(),
    );
    expect(e.directed).toBe(false);
    expect(e.source.id < e.target.id).toBe(true);
  });

  it("draws no arrow when both namespaces act as client equally", () => {
    const [e] = collapseNamespaces(
      [
        edge(web, api, { forward: 1000, backward: 0, total: 1000 }),
        edge(api, web2, { forward: 1000, backward: 0, total: 1000 }),
      ],
      state(),
    );
    expect(e.directed).toBe(false);
  });

  it("draws no arrow when most of the merged bytes have no known direction", () => {
    const [e] = collapseNamespaces(
      [
        edge(web, api, { forward: 1, backward: 0, total: 1 }),
        edge(web2, api, { directed: false, forward: 5000, backward: 5000, total: 10000 }),
      ],
      state(),
    );
    expect(e.directed).toBe(false);
  });

  it("keeps a namespace as its workloads when all of its traffic stays inside it", () => {
    const db = workload("shop", "db");
    const shop = workload("shop", "web");
    const out = collapseNamespaces([edge(shop, db), edge(web, api)], state());
    expect(out.map((e) => e.id)).toContain(edge(shop, db).id);
    expect(out).toHaveLength(2);
    expect(out.some((e) => e.source.namespace === "frontend" && e.source.group)).toBe(true);
  });

  it("drops edges inside one namespace", () => {
    const out = collapseNamespaces([edge(web, web2), edge(web, api)], state());
    expect(out).toHaveLength(1);
    expect(out[0].target.namespace).toBe("backend");
  });

  it("never collapses nodes or external ends", () => {
    const out = collapseNamespaces([edge(web, NODE), edge(EXTERNAL, api)], state());
    expect(out.map((e) => e.target.id)).toContain(NODE.id);
    expect(out.map((e) => e.source.id)).toContain(EXTERNAL.id);
    expect(out.find((e) => e.target.id === NODE.id)?.target).toBe(NODE);
  });

  it("expands only the named namespace", () => {
    const out = collapseNamespaces(
      [edge(web, api), edge(api, db)],
      state({ expanded: new Set([namespaceId("prod", "backend")]) }),
    );
    const ids = out.flatMap((e) => [e.source.id, e.target.id]);
    expect(ids).toContain(api.id);
    expect(ids).toContain("__ns__prod/frontend");
    expect(ids).toContain("__ns__prod/data");
    expect(ids).not.toContain("__ns__prod/backend");
  });

  it("leaves an edge between two expanded ends as it was", () => {
    const original = edge(web, api);
    const out = collapseNamespaces(
      [original],
      state({
        expanded: new Set([namespaceId("prod", "frontend"), namespaceId("prod", "backend")]),
      }),
    );
    expect(out[0]).toBe(original);
  });

  it("gives the same ids whatever the input order", () => {
    const a = [edge(web, api), edge(db, web2), edge(api, db)];
    const ids = (edges: FlowEdge[]) =>
      collapseNamespaces(edges, state())
        .map((e) => e.id)
        .sort();
    expect(ids(a)).toEqual(ids([...a].reverse()));
    expect(ids(a)).toEqual(ids(a));
  });
});
