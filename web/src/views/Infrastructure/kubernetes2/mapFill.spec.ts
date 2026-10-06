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
import type { NodeRow, PodRow } from "./kubernetesModel";
import type { K8sUrlState } from "./kubernetesUrlState";
import {
  FILL_EDGES,
  bucketOf,
  bucketRanges,
  fillClass,
  fillValue,
  groupRows,
  legendClasses,
  listTarget,
  statusClass,
} from "./mapFill";

const pod = (over: Partial<PodRow> = {}): PodRow =>
  ({
    key: `c/ns/${over.name ?? "p"}`,
    kind: "pod",
    cluster: "c",
    namespace: "ns",
    name: "p",
    uid: null,
    createdAt: null,
    warnings: [],
    object: null,
    phase: "Running",
    ready: "true",
    status: { text: "Running", variant: "success-soft" },
    controller: null,
    workload: null,
    node: "n1",
    restarts: 0,
    cpuPctOfRequest: null,
    cpuPctOfLimit: null,
    memoryPctOfRequest: null,
    memoryPctOfLimit: null,
    ...over,
  }) as PodRow;

const node = (over: Partial<NodeRow> = {}): NodeRow =>
  ({
    key: `c/${over.name ?? "n"}`,
    kind: "node",
    cluster: "c",
    namespace: "",
    name: "n",
    warnings: [],
    ready: "true",
    pressures: [],
    cpuPct: null,
    memoryPct: null,
    ...over,
  }) as NodeRow;

const state = (over: Partial<K8sUrlState> = {}): K8sUrlState => ({
  view: "map",
  cluster: "c",
  namespaces: ["shop"],
  search: "web",
  sort: null,
  desc: false,
  entity: "pods",
  fill: "cpuReq",
  group: "node",
  details: null,
  ...over,
});

describe("mapFill buckets (AC 43)", () => {
  const table: Array<[string, readonly number[], Array<[number, string]>]> = [
    [
      "cpuReq",
      FILL_EDGES.cpuReq,
      [
        [0, "b1"],
        [24.999, "b1"],
        [25, "b2"],
        [50, "b3"],
        [75, "b4"],
        [99.999, "b4"],
        [100, "b5"],
      ],
    ],
    ["memReq", FILL_EDGES.memReq, [[25, "b2"]]],
    ...(["cpuLim", "memLim", "cpu", "memory"] as const).map(
      (fill) =>
        [
          fill,
          FILL_EDGES[fill],
          [
            [49.999, "b1"],
            [50, "b2"],
            [70, "b3"],
            [90, "b4"],
            [100, "b5"],
          ],
        ] as [string, readonly number[], Array<[number, string]>],
    ),
    [
      "restarts",
      FILL_EDGES.restarts,
      [
        [0, "b1"],
        [1, "b2"],
        [2, "b3"],
        [5, "b3"],
        [6, "b4"],
        [20, "b4"],
        [21, "b5"],
      ],
    ],
  ];
  for (const [fill, edges, cases] of table) {
    it.each(cases)(`${fill}: %s → %s`, (value, expected) => {
      expect(bucketOf(value, edges)).toBe(expected);
    });
  }

  it.each([null, -1, NaN, Infinity, -Infinity])("%s is No data", (value) => {
    expect(bucketOf(value, FILL_EDGES.cpuReq)).toBe("noData");
  });

  it("reads each fill from its row field", () => {
    const p = pod({
      cpuPctOfRequest: 1,
      cpuPctOfLimit: 2,
      memoryPctOfRequest: 3,
      memoryPctOfLimit: 4,
      restarts: 5,
    });
    expect(
      (["cpuReq", "cpuLim", "memReq", "memLim", "restarts"] as const).map((f) => fillValue(p, f)),
    ).toEqual([1, 2, 3, 4, 5]);
    const n = node({ cpuPct: 7, memoryPct: 8 });
    expect([fillValue(n, "cpu"), fillValue(n, "memory")]).toEqual([7, 8]);
  });

  it("a pod with no request or no usage is No data, never the coldest bucket", () => {
    expect(fillClass(pod({ cpuPctOfRequest: null }), "cpuReq")).toBe("noData");
    expect(fillClass(pod({ restarts: null }), "restarts")).toBe("noData");
  });

  it("the legend lists five buckets plus No data, or the four status categories", () => {
    expect(legendClasses("memLim")).toEqual(["b1", "b2", "b3", "b4", "b5", "noData"]);
    expect(legendClasses("status")).toEqual(["ok", "warning", "error", "noData"]);
  });
});

describe("mapFill status (AC 46)", () => {
  it("follows the ⚠ severity first", () => {
    const err = pod({ warnings: [{ key: "infra.k8s2.warnFailed", severity: "error" }] });
    const warn = pod({ warnings: [{ key: "infra.k8s2.warnNotReady", severity: "warning" }] });
    expect(statusClass(err)).toBe("error");
    expect(statusClass(warn)).toBe("warning");
    expect(fillClass(err, "status")).toBe("error");
  });

  it("is ok only when the status is fully known", () => {
    expect(statusClass(pod())).toBe("ok");
    expect(statusClass(pod({ ready: null }))).toBe("noData");
    expect(statusClass(pod({ phase: null, status: null }))).toBe("noData");
    expect(statusClass(pod({ status: null }))).toBe("noData");
    expect(statusClass(node())).toBe("ok");
    expect(statusClass(node({ ready: null }))).toBe("noData");
  });
});

describe("mapFill groups (AC 44, 45)", () => {
  it("groups by node with Unscheduled for an empty or missing node", () => {
    const rows = [
      pod({ name: "a", node: "n2" }),
      pod({ name: "b", node: "" }),
      pod({ name: "c", node: null }),
      pod({ name: "d", node: "n1" }),
      pod({ name: "e", node: "n1" }),
    ];
    const groups = groupRows(rows, "node");
    expect(groups.map((g) => [g.name, g.special, g.rows.map((r) => r.name)])).toEqual([
      ["n1", null, ["d", "e"]],
      ["", "unscheduled", ["b", "c"]],
      ["n2", null, ["a"]],
    ]);
  });

  it("groups by resolved workload with No owner", () => {
    const rows = [
      pod({ name: "a", workload: { kind: "Deployment", name: "api" } }),
      pod({ name: "b", workload: { kind: "Deployment", name: "api" } }),
      pod({ name: "c", namespace: "other", workload: { kind: "Deployment", name: "api" } }),
      pod({ name: "d" }),
    ];
    const groups = groupRows(rows, "workload");
    expect(groups.map((g) => [g.name, g.namespace, g.rows.length])).toEqual([
      ["Deployment api", "ns", 2],
      ["Deployment api", "other", 1],
      ["", "", 1],
    ]);
    expect(groups[2].special).toBe("noOwner");
    expect(groups[0].owner).toEqual({ kind: "Deployment", name: "api" });
  });

  it("orders by size, then name; none is one block", () => {
    expect(bucketRanges("restarts")).toEqual(["0", "1", "2–5", "6–20", "> 20"]);
    expect(bucketRanges("cpuLim")[4]).toBe("≥ 100%");
    const rows = [pod({ name: "a", namespace: "z" }), pod({ name: "b", namespace: "y" })];
    expect(groupRows(rows, "namespace").map((g) => g.name)).toEqual(["y", "z"]);
    const none = groupRows(rows, "none");
    expect(none).toHaveLength(1);
    expect(none[0].rows).toHaveLength(2);
  });
});

describe("mapFill Show as list (AC 51)", () => {
  it.each([
    ["cpuReq", "cpuReq"],
    ["cpuLim", "cpuLim"],
    ["memReq", "memReq"],
    ["memLim", "memLim"],
    ["restarts", "restarts"],
    ["status", "warnings"],
  ] as const)("pods %s sorts the Pods list by %s", (fill, sort) => {
    expect(listTarget(state({ fill }))).toEqual({
      ...state(),
      view: "pods",
      fill: "cpuReq",
      sort,
      desc: true,
    });
  });

  it.each([
    ["cpu", "cpu"],
    ["memory", "memory"],
    ["status", "warnings"],
  ] as const)("nodes %s sorts the Nodes list by %s", (fill, sort) => {
    const target = listTarget(state({ entity: "nodes", fill }));
    expect(target).toMatchObject({ view: "nodes", sort, desc: true, search: "web" });
    expect(target.details).toBeNull();
  });
});
