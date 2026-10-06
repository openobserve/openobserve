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
  decodeCompound,
  encodeCompound,
  isCanonical,
  parseListState,
  stripListParams,
  toQuery,
  withFilter,
  withKind,
  withTile,
} from "./kubernetesUrlState";

describe("kubernetesUrlState", () => {
  describe("compound values", () => {
    it("encodes each segment and joins with a slash", () => {
      expect(encodeCompound(["prod", "shop", "a/b"])).toBe("prod/shop/a%2Fb");
    });

    it("round-trips a value containing a slash", () => {
      expect(decodeCompound(encodeCompound(["prod", "shop", "a/b"]), 3)).toEqual([
        "prod",
        "shop",
        "a/b",
      ]);
    });

    it("keeps an empty cluster as an empty segment", () => {
      expect(encodeCompound(["", "node-1"])).toBe("/node-1");
      expect(decodeCompound("/node-1", 2)).toEqual(["", "node-1"]);
    });

    it("rejects the wrong number of segments", () => {
      expect(decodeCompound("a/b/c", 2)).toBeNull();
      expect(decodeCompound("a", 2)).toBeNull();
    });
  });

  describe("parseListState", () => {
    it("reads defaults from an empty query", () => {
      expect(parseListState({})).toEqual({
        kind: "pods",
        name: "",
        cluster: null,
        namespace: null,
        issue: null,
        onNode: null,
        workload: null,
        sort: null,
        desc: false,
        page: 1,
        pod: null,
      });
    });

    it("keeps the first of a repeated single-select param and flags the URL for rewrite", () => {
      const query = { cluster: ["a", "b"] };
      expect(parseListState(query).cluster).toBe("a");
      expect(isCanonical(query)).toBe(false);
      expect(toQuery(parseListState(query), query)).toEqual({ cluster: "a" });
    });

    it("lets the issue imply its kind", () => {
      expect(parseListState({ issue: "nodesNotReady" }).kind).toBe("nodes");
      expect(parseListState({ kind: "pods", issue: "deploymentsUnavailable" }).kind).toBe(
        "deployments",
      );
    });

    it("normalizes a pod deep link to the pods kind", () => {
      const query = { kind: "nodes", pod: "prod/shop/web-1" };
      const state = parseListState(query);
      expect(state.kind).toBe("pods");
      expect(state.pod).toEqual(["prod", "shop", "web-1"]);
      expect(isCanonical(query)).toBe(false);
      expect(toQuery(state, query)).toEqual({ pod: "prod/shop/web-1" });
    });

    it("drops a compound param with the wrong number of segments", () => {
      const query = { onNode: "a/b/c", workload: "a/b" };
      const state = parseListState(query);
      expect(state.onNode).toBeNull();
      expect(state.workload).toBeNull();
      expect(toQuery(state, query)).toEqual({});
    });

    it("ignores an unknown kind or issue", () => {
      expect(parseListState({ kind: "jobs", issue: "nope" })).toMatchObject({
        kind: "pods",
        issue: null,
      });
    });

    it("leaves unrelated params alone", () => {
      const query = { org_identifier: "o1", kind: "nodes" };
      expect(isCanonical(query)).toBe(true);
      expect(toQuery(parseListState(query), query)).toEqual(query);
    });
  });

  describe("transitions", () => {
    const base = parseListState({
      kind: "pods",
      name: "web",
      cluster: "prod",
      namespace: "shop",
      issue: "podsRestarting",
      sort: "cpu",
      desc: "true",
      page: "3",
    });

    it("changing kind keeps the scope and name, clears sort, page and another kind's issue", () => {
      const next = withKind(base, "nodes");
      expect(next).toMatchObject({
        kind: "nodes",
        name: "web",
        cluster: "prod",
        namespace: "shop",
        issue: null,
        sort: null,
        desc: false,
        page: 1,
      });
    });

    it("keeps an issue that belongs to the new kind", () => {
      expect(withKind({ ...base, issue: "nodesPressure", kind: "nodes" }, "nodes").issue).toBe(
        "nodesPressure",
      );
    });

    it("a tile sets kind and issue and clears the list-specific filters", () => {
      const filtered = {
        ...base,
        onNode: ["prod", "n1"] as [string, string],
        workload: ["prod", "shop", "Deployment", "web"] as [string, string, string, string],
      };
      expect(withTile(filtered, "podsContainerErrors")).toMatchObject({
        kind: "pods",
        issue: "podsContainerErrors",
        name: "",
        onNode: null,
        workload: null,
        page: 1,
      });
      expect(withTile(filtered, "nodesNotReady")).toMatchObject({
        kind: "nodes",
        issue: "nodesNotReady",
        sort: null,
      });
    });

    it("the all tile clears only the issue", () => {
      expect(withTile(base, "all")).toMatchObject({ issue: null, name: "web", kind: "pods" });
    });

    it("a filter change resets the page", () => {
      expect(withFilter(base, { namespace: "data" })).toMatchObject({ namespace: "data", page: 1 });
    });
  });

  describe("toQuery", () => {
    it("omits defaults and writes compound values encoded", () => {
      const state = {
        ...parseListState({}),
        kind: "pods" as const,
        cluster: "*",
        onNode: ["", "node/1"] as [string, string],
        workload: ["prod", "shop", "Deployment", "web"] as [string, string, string, string],
        sort: "cpu",
        desc: true,
        page: 2,
      };
      expect(toQuery(state, {})).toEqual({
        cluster: "*",
        onNode: "/node%2F1",
        workload: "prod/shop/Deployment/web",
        sort: "cpu",
        desc: "true",
        page: "2",
      });
    });

    it("strips every Kubernetes 2 param", () => {
      expect(
        stripListParams({ kind: "nodes", cluster: "*", pod: "a/b/c", org_identifier: "o" }),
      ).toEqual({ org_identifier: "o" });
    });
  });
});
