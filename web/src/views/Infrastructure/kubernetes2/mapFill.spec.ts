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
import { NODES, labelledInventory, observed } from "./__fixtures__/mapInventory";
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
  MAX_LABEL_GROUPS,
  SHORT_KIND,
  noLabelCounts,
  statusClass,
  statusCounts,
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
  filter: [],
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
    const { groups } = groupRows(rows, "node");
    expect(groups.map((g) => [g.name, g.special, g.rows.map((r) => r.name)])).toEqual([
      ["n1", null, ["d", "e"]],
      ["", "unscheduled", ["b", "c"]],
      ["n2", null, ["a"]],
    ]);
  });

  it("titles a workload group by its name, as ns/name only when two would read alike", () => {
    const rows = [
      pod({ name: "a", workload: { kind: "Deployment", name: "api" } }),
      pod({ name: "b", workload: { kind: "Deployment", name: "api" } }),
      pod({ name: "c", namespace: "other", workload: { kind: "Deployment", name: "api" } }),
      pod({ name: "d" }),
    ];
    const { groups } = groupRows(
      [...rows, pod({ name: "e", workload: { kind: "DaemonSet", name: "agent" } })],
      "workload",
    );
    expect(groups.map((g) => [g.name, g.namespace, g.rows.length])).toEqual([
      ["ns/api", "ns", 2],
      ["agent", "ns", 1],
      ["other/api", "other", 1],
      ["", "", 1],
    ]);
    expect(groups[3].special).toBe("noOwner");
    expect(groups[0].owner).toEqual({ kind: "Deployment", name: "api" });
  });

  it("adds the short kind when two same-named workloads share a namespace too", () => {
    const { groups } = groupRows(
      [
        pod({ name: "a", workload: { kind: "Deployment", name: "api" } }),
        pod({ name: "b", workload: { kind: "StatefulSet", name: "api" } }),
        pod({ name: "c", namespace: "other", workload: { kind: "Deployment", name: "api" } }),
      ],
      "workload",
    );
    expect(groups.map((g) => g.name).sort()).toEqual([
      "ns/api (deploy)",
      "ns/api (sts)",
      "other/api",
    ]);
  });

  it("orders by size, then name; none is one block", () => {
    expect(bucketRanges("restarts")).toEqual(["0", "1", "2–5", "6–20", "> 20"]);
    expect(bucketRanges("cpuLim")[4]).toBe("≥ 100%");
    const rows = [pod({ name: "a", namespace: "z" }), pod({ name: "b", namespace: "y" })];
    expect(groupRows(rows, "namespace").groups.map((g) => g.name)).toEqual(["y", "z"]);
    const { groups: none, totalGroups } = groupRows(rows, "none");
    expect(totalGroups).toBe(1);
    expect(none).toHaveLength(1);
    expect(none[0].rows).toHaveLength(2);
  });
});

describe("mapFill label groups (AC 96)", () => {
  const ZONE = "label.topology.kubernetes.io/zone";
  const NAME = "label.app.kubernetes.io/name";
  const short = (name: string) => name.split(".")[0];

  it("groups nodes by zone by size then name, with no No-label group when every node has it", () => {
    const { groups, totalGroups } = groupRows(labelledInventory().nodes, ZONE);
    expect(groups.map((g) => [g.name, g.special, g.rows.length])).toEqual([
      ["us-east-1a", null, 2],
      ["us-east-1b", null, 1],
      ["us-east-1c", null, 1],
    ]);
    expect(totalGroups).toBe(3);
    expect(groups[0].rows.map((r) => short(r.name)).sort()).toEqual([
      "ip-10-0-10-38",
      "ip-10-0-13-37",
    ]);
  });

  it("puts a node whose labels were not observed into No <key>, last", () => {
    const inv = labelledInventory();
    inv.nodes.find((n) => n.name === NODES[2])!.object = null;
    const { groups } = groupRows(inv.nodes, ZONE);
    expect(groups.map((g) => [g.name, g.special, g.rows.length])).toEqual([
      ["us-east-1a", null, 2],
      ["us-east-1c", null, 1],
      ["", "noLabel", 1],
    ]);
  });

  it("keeps No <key> last even when it is the largest group, and splits its count", () => {
    const { pods } = labelledInventory();
    const { groups } = groupRows(pods, NAME);
    const last = groups[groups.length - 1];
    expect(last.special).toBe("noLabel");
    expect(last.rows.map((r) => r.name).sort()).toEqual([
      "debug-shell",
      "transcoding-service-nkgbp5xp5l-vwvn2",
    ]);
    expect(noLabelCounts(last)).toEqual({ without: 0, notObserved: 2 });
    const big = groupRows(
      [
        pod({ name: "a", object: observed({ app: "x" }) as any }),
        pod({ name: "b", object: observed({ app: "y" }) as any }),
        pod({ name: "c", object: observed({ tier: "db" }) as any }),
        pod({ name: "d", object: observed({ app: "" }) as any }),
        pod({ name: "e" }),
      ],
      "label.app",
    ).groups;
    expect(big.map((g) => [g.name, g.special, g.rows.length])).toEqual([
      ["x", null, 1],
      ["y", null, 1],
      ["", "noLabel", 3],
    ]);
    expect(noLabelCounts(big[2])).toEqual({ without: 2, notObserved: 1 });
  });

  const many = (values: number, unlabelled: number) => [
    ...Array.from({ length: 5000 - unlabelled }, (_, i) =>
      pod({ name: `p${i}`, object: observed({ build: `b${i % values}` }) as any }),
    ),
    ...Array.from({ length: unlabelled }, (_, i) => pod({ name: `u${i}` })),
  ];

  it("caps label groups at 100 cards, with Other before No <key>", () => {
    const { groups, totalGroups } = groupRows(many(2000, 10), "label.build");
    expect(MAX_LABEL_GROUPS).toBe(100);
    expect(groups).toHaveLength(100);
    expect(groups.slice(0, 98).every((g) => g.special === null)).toBe(true);
    expect(groups[98]).toMatchObject({ special: "other", merged: 1902 });
    expect(groups[99].special).toBe("noLabel");
    expect(totalGroups).toBe(2001);
    expect(groups.reduce((sum, g) => sum + g.rows.length, 0)).toBe(5000);
  });

  it("caps at 99 regular groups and Other when every row carries the key", () => {
    const { groups, totalGroups } = groupRows(many(2000, 0), "label.build");
    expect(groups).toHaveLength(100);
    expect(groups[99]).toMatchObject({ special: "other", merged: 1901 });
    expect(totalGroups).toBe(2000);
  });

  it("draws every label group when they fit, and never caps built-in grouping", () => {
    expect(groupRows(many(99, 10), "label.build").groups).toHaveLength(100);
    const rows = Array.from({ length: 300 }, (_, i) =>
      pod({ name: `w${i}`, workload: { kind: "Deployment", name: `svc-${i}` } }),
    );
    expect(groupRows(rows, "workload").groups).toHaveLength(300);
  });
});

describe("mapFill short kinds", () => {
  it("names each workload kind as kubectl does", () => {
    expect(SHORT_KIND).toEqual({
      Deployment: "deploy",
      DaemonSet: "ds",
      StatefulSet: "sts",
      ReplicaSet: "rs",
      Job: "job",
      CronJob: "cj",
      Pod: "pod",
    });
  });
});

describe("mapFill status summary (AC 83)", () => {
  it("counts error, warning and ok in that order, zeros included", () => {
    const { pods } = labelledInventory();
    const rows = pods.filter((p) => p.node === NODES[1]);
    const summary = statusCounts(rows);
    expect(summary.map((s) => s.cls)).toEqual(["error", "warning", "ok"]);
    const known = rows.filter((r) => statusClass(r) !== "noData").length;
    expect(summary.reduce((sum, s) => sum + s.count, 0)).toBe(known);
    expect(statusCounts([pod()])).toEqual([
      { cls: "error", count: 0 },
      { cls: "warning", count: 0 },
      { cls: "ok", count: 1 },
    ]);
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
