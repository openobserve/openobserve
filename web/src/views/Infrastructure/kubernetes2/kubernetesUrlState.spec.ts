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
import { createMemoryHistory, createRouter } from "vue-router";
import { VIEWS } from "./kubernetesQueries";
import {
  decodeCompound,
  encodeCompound,
  encodeDetails,
  isCanonical,
  parseUrlState,
  DEFAULT_GROUP,
  stripPageParams,
  toQuery,
  withDetails,
  withView,
} from "./kubernetesUrlState";

const roundTrip = (query: Record<string, string>) => toQuery(parseUrlState(query), {});

describe("kubernetesUrlState", () => {
  it("defaults to the Cluster overview with every default omitted", () => {
    const state = parseUrlState({});
    expect(state.view).toBe("cluster");
    expect(toQuery(state, {})).toEqual({});
  });

  it.each(VIEWS.filter((v) => v !== "cluster"))("keeps view=%s", (view) => {
    expect(roundTrip({ view })).toEqual({ view });
  });

  it("rewrites an unknown view to the Cluster overview", () => {
    expect(parseUrlState({ view: "configmaps" }).view).toBe("cluster");
    expect(isCanonical({ view: "configmaps" })).toBe(false);
  });

  it("round-trips a comma-joined namespace selection", () => {
    const state = parseUrlState({ view: "pods", namespace: "a,b" });
    expect(state.namespaces).toEqual(["a", "b"]);
    expect(toQuery(state, {}).namespace).toBe("a,b");
  });

  it("rewrites the removed All-clusters value to the default", () => {
    expect(parseUrlState({ cluster: "*" }).cluster).toBeNull();
    expect(isCanonical({ cluster: "*" })).toBe(false);
  });

  it("keeps search, sort and desc, and drops desc without a sort", () => {
    expect(roundTrip({ view: "pods", search: "web", sort: "memLim", desc: "true" })).toEqual({
      view: "pods",
      search: "web",
      sort: "memLim",
      desc: "true",
    });
    expect(roundTrip({ view: "pods", desc: "true" })).toEqual({ view: "pods" });
  });

  it("drops the removed MVP params", () => {
    expect(
      roundTrip({
        view: "pods",
        kind: "pods",
        name: "x",
        issue: "podsNotRunning",
        onNode: "a/b",
        workload: "a/b/c/d",
        page: "2",
        pod: "a/b/c",
      }),
    ).toEqual({ view: "pods" });
  });

  describe("details", () => {
    it("opens a node drawer with an empty namespace segment", () => {
      const state = parseUrlState({ details: "node/prod//ip-1", cluster: "prod" });
      expect(state.details).toEqual({ kind: "node", cluster: "prod", namespace: "", name: "ip-1" });
    });

    it("round-trips a segment containing a slash, encoded", () => {
      const details = { kind: "pod" as const, cluster: "c/1", namespace: "ns", name: "a/b" };
      const encoded = encodeDetails(details);
      expect(encoded).toBe("pod/c%2F1/ns/a%2Fb");
      expect(parseUrlState({ details: encoded }).details).toEqual(details);
    });

    it.each(["pod/prod/ns", "pod/prod/ns/a/b", "secret/prod/ns/a", "pod/%E0%A4%A/ns/a"])(
      "drops a malformed details %s",
      (details) => {
        expect(parseUrlState({ details }).details).toBeNull();
        expect(isCanonical({ details })).toBe(false);
      },
    );

    it("rewrites cluster to the cluster the drawer link names", () => {
      const state = parseUrlState({ cluster: "a", details: "pod/b/ns/x" });
      expect(state.cluster).toBe("b");
      expect(isCanonical({ cluster: "a", details: "pod/b/ns/x" })).toBe(false);
      expect(isCanonical({ cluster: "b", details: "pod/b/ns/x" })).toBe(true);
    });
  });

  describe("map params", () => {
    it("round-trips view=map&entity=nodes&fill=memory", () => {
      expect(roundTrip({ view: "map", entity: "nodes", fill: "memory" })).toEqual({
        view: "map",
        entity: "nodes",
        fill: "memory",
      });
    });

    it("rewrites a fill that does not belong to the entity to the entity's default", () => {
      const state = parseUrlState({ view: "map", entity: "nodes", fill: "memLim" });
      expect(state.fill).toBe("cpu");
      expect(toQuery(state, {})).toEqual({ view: "map", entity: "nodes" });
    });

    it("ignores and drops group for nodes, and drops an unknown fill or group", () => {
      expect(roundTrip({ view: "map", entity: "nodes", group: "namespace" })).toEqual({
        view: "map",
        entity: "nodes",
      });
      expect(parseUrlState({ view: "map", fill: "zzz", group: "zzz" })).toMatchObject({
        entity: "pods",
        fill: "cpuReq",
        group: "node",
      });
      expect(roundTrip({ view: "map", fill: "memLim", group: "workload" })).toEqual({
        view: "map",
        fill: "memLim",
        group: "workload",
      });
    });

    it("keeps map params only on the map", () => {
      expect(roundTrip({ view: "pods", entity: "nodes", fill: "cpu", group: "none" })).toEqual({
        view: "pods",
      });
    });
  });

  describe("map filter (AC 76)", () => {
    const TERMS = "app.kubernetes.io/name:order-service,app.kubernetes.io/name:api";

    it("round-trips comma-joined key:value terms, and the router keeps them literal", () => {
      const state = parseUrlState({ view: "map", filter: TERMS });
      expect(state.filter).toEqual([
        "app.kubernetes.io/name:order-service",
        "app.kubernetes.io/name:api",
      ]);
      const query = toQuery(state, {});
      expect(query).toEqual({ view: "map", filter: TERMS });
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/", component: {} }],
      });
      const href = router.resolve({ path: "/", query: query as any }).fullPath;
      expect(href).toContain(`filter=${TERMS}`);
      expect(href).not.toMatch(/%2F|%3A|%2C/i);
    });

    it("splits a term on its first colon", () => {
      const state = parseUrlState({
        view: "map",
        filter: "kubernetes.io/hostname:ip-10-0-11-39.ec2.internal",
      });
      expect(state.filter).toEqual(["kubernetes.io/hostname:ip-10-0-11-39.ec2.internal"]);
      const term = state.filter[0];
      const at = term.indexOf(":");
      expect([term.slice(0, at), term.slice(at + 1)]).toEqual([
        "kubernetes.io/hostname",
        "ip-10-0-11-39.ec2.internal",
      ]);
    });

    it("drops terms without a colon, key or value, keeps unknown keys, and collapses duplicates", () => {
      const state = parseUrlState({
        view: "map",
        filter: "nocolon,:v,k:,zz.io/unknown:x,a:b,a:b",
      });
      expect(state.filter).toEqual(["zz.io/unknown:x", "a:b"]);
      expect(isCanonical({ view: "map", filter: "nocolon,a:b" })).toBe(false);
    });

    it("emits filter only on the map, and a view change clears it", () => {
      expect(roundTrip({ view: "pods", filter: "a:b" })).toEqual({ view: "pods" });
      const state = parseUrlState({ view: "map", filter: "a:b" });
      expect(withView(state, "map").filter).toEqual([]);
      expect(toQuery(withView(state, "pods"), {})).toEqual({ view: "pods" });
    });
  });

  describe("label group (AC 95)", () => {
    it("round-trips a node label group literally", () => {
      const query = { view: "map", entity: "nodes", group: "label.topology.kubernetes.io/zone" };
      expect(roundTrip(query)).toEqual(query);
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/", component: {} }],
      });
      expect(router.resolve({ path: "/", query }).fullPath).toContain(
        "group=label.topology.kubernetes.io/zone",
      );
    });

    it("drops group=node for nodes, whose default is none", () => {
      expect(parseUrlState({ view: "map", entity: "nodes", group: "node" }).group).toBe("none");
      expect(roundTrip({ view: "map", entity: "nodes", group: "node" })).toEqual({
        view: "map",
        entity: "nodes",
      });
      expect(roundTrip({ view: "map", entity: "nodes", group: "none" })).toEqual({
        view: "map",
        entity: "nodes",
      });
    });

    it("round-trips a pod label group and drops an empty label key", () => {
      const query = { view: "map", group: "label.app.kubernetes.io/name" };
      expect(roundTrip(query)).toEqual(query);
      expect(parseUrlState({ view: "map", group: "label." }).group).toBe("node");
      expect(roundTrip({ view: "map", group: "label." })).toEqual({ view: "map" });
      expect(roundTrip({ view: "map", group: "none" })).toEqual({ view: "map", group: "none" });
    });

    it("gives each entity its own default group", () => {
      expect(DEFAULT_GROUP).toEqual({ pods: "node", nodes: "none" });
    });
  });

  describe("view change", () => {
    it("clears view-local params and the drawer, and keeps cluster and namespace", () => {
      const state = parseUrlState({
        view: "map",
        cluster: "prod",
        namespace: "a",
        search: "x",
        sort: "cpu",
        desc: "true",
        entity: "nodes",
        fill: "memory",
        details: "node/prod//n1",
      });
      expect(toQuery(withView(state, "nodes"), {})).toEqual({
        view: "nodes",
        cluster: "prod",
        namespace: "a",
      });
    });
  });

  it("opening a drawer sets details and keeps everything else", () => {
    const state = parseUrlState({ view: "pods", cluster: "prod", search: "x" });
    const next = withDetails(state, { kind: "pod", cluster: "prod", namespace: "ns", name: "p" });
    expect(toQuery(next, {})).toEqual({
      view: "pods",
      cluster: "prod",
      search: "x",
      details: "pod/prod/ns/p",
    });
  });

  it("strips every page param on an org switch and keeps the rest", () => {
    expect(
      stripPageParams({
        view: "pods",
        cluster: "c",
        namespace: "n",
        search: "s",
        sort: "x",
        desc: "true",
        entity: "nodes",
        fill: "cpu",
        group: "none",
        filter: "a:b",
        details: "pod/c/n/p",
        org_identifier: "o",
      }),
    ).toEqual({ org_identifier: "o" });
  });

  it("keeps compound encoding helpers", () => {
    expect(encodeCompound(["a/b", "c"])).toBe("a%2Fb/c");
    expect(decodeCompound("a%2Fb/c", 2)).toEqual(["a/b", "c"]);
    expect(decodeCompound("a/b/c", 2)).toBeNull();
  });
});
