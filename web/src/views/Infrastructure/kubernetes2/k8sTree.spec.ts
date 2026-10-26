// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  buildTree,
  clusterCodes,
  clusterHue,
  clusterSeen,
  clusterStatsOf,
  clusterTone,
  filterTree,
  nodeSummary,
  rowIsBad,
} from "./k8sTree";
import type { Inventory } from "./kubernetesModel";

const inventory = (patch: Partial<Inventory> = {}): Inventory =>
  ({
    pods: [],
    nodes: [],
    deployments: [],
    daemonsets: [],
    statefulsets: [],
    replicasets: [],
    jobs: [],
    cronjobs: [],
    pvcs: [],
    hpas: [],
    namespaces: [],
    unlabelledFamilies: [],
    ...patch,
  }) as Inventory;

const pod = (cluster: string, name: string, phase: string, ready = "true") =>
  ({
    kind: "pod",
    cluster,
    namespace: "web",
    name,
    phase,
    ready,
    statusReason: null,
    object: null,
  }) as any;

const items = (groups: ReturnType<typeof buildTree>) => groups.flatMap((g) => g.items);
const events = { total: 14, warnings: 8 };
const find = (groups: ReturnType<typeof buildTree>, view: string) =>
  items(groups).find((i) => i.view === view)!;

describe("buildTree", () => {
  it("follows the design's groups and order, with a distinct workloads overview label", () => {
    const groups = buildTree({ inventory: inventory(), cluster: null, events });
    expect(groups.map((g) => g.id)).toEqual(["cluster", "workloads", "storage", "autoscaling"]);
    expect(groups[0].items.map((i) => i.view)).toEqual([
      "cluster",
      "map",
      "nodes",
      "namespaces",
      "events",
    ]);
    expect(groups[1].items.map((i) => i.view)).toEqual([
      "workloads",
      "pods",
      "deployments",
      "daemonsets",
      "statefulsets",
      "replicasets",
      "jobs",
      "cronjobs",
    ]);
    expect(groups[1].items[0].label).toBe("infra.k8s2.treeWorkloadsOverview");
    expect(groups[0].items[0].label).not.toBe(groups[1].items[0].label);
  });

  it("takes every total from the cluster-wide stats, so no view has to be loaded first", () => {
    const stats = { pods: 62, deployments: 15, daemonsets: 3, pvcs: 7, hpas: 4, nodes: 6 };
    const groups = buildTree({ inventory: inventory(), cluster: "prod", events, stats });
    expect(find(groups, "pods").count).toBe(62);
    expect(find(groups, "deployments").count).toBe(15);
    expect(find(groups, "pvcs").count).toBe(7);
    expect(find(groups, "nodes").count).toBe(6);
  });

  it("takes problem counts from the stats for nodes, pods and deployments", () => {
    const stats = {
      pods: 62,
      podsBad: 5,
      nodes: 6,
      nodesBad: 1,
      deployments: 15,
      deploymentsBad: 2,
    };
    const groups = buildTree({ inventory: inventory(), cluster: "prod", events, stats });
    expect(find(groups, "pods").bad).toBe(5);
    expect(find(groups, "nodes").bad).toBe(1);
    expect(find(groups, "deployments").bad).toBe(2);
  });

  it("falls back to loaded rows when the stats do not cover a kind", () => {
    const groups = buildTree({
      inventory: inventory({
        pods: [
          pod("prod", "a", "Running"),
          pod("prod", "b", "Failed"),
          pod("stage", "c", "Failed"),
        ],
      }),
      cluster: "prod",
      events,
    });
    expect(find(groups, "pods")).toMatchObject({ count: 2, bad: 1 });
  });

  it("takes the other kinds' problem counts from the stats, ahead of loaded rows", () => {
    const stats = {
      daemonsets: 4,
      daemonsetsBad: 3,
      statefulsets: 2,
      statefulsetsBad: 2,
      replicasets: 9,
      replicasetsBad: 7,
      jobs: 5,
      jobsBad: 1,
      pvcs: 7,
      pvcsBad: 1,
      hpas: 4,
      hpasBad: 1,
    };
    const groups = buildTree({ inventory: inventory(), cluster: "prod", events, stats });
    const bad = (view: string) => find(groups, view).bad;
    expect([bad("daemonsets"), bad("statefulsets"), bad("replicasets")]).toEqual([3, 2, 7]);
    expect([bad("jobs"), bad("pvcs"), bad("hpas")]).toEqual([1, 1, 1]);
  });

  it("counts zero for a kind the present stats do not mention", () => {
    const stats = { pods: 62 };
    const groups = buildTree({ inventory: inventory(), cluster: "prod", events, stats });
    expect(find(groups, "daemonsets")).toMatchObject({ count: 0 });
    expect(find(groups, "pods")).toMatchObject({ count: 62 });
    expect(find(groups, "deployments")).toMatchObject({ count: 0 });
  });

  it("shows no count for an unknown kind rather than a false zero", () => {
    const groups = buildTree({ inventory: inventory(), cluster: "prod", events });
    expect(find(groups, "deployments")).toMatchObject({ count: null, bad: 0 });
  });

  it("takes event counts from the caller", () => {
    const groups = buildTree({ inventory: inventory(), cluster: null, events });
    expect(find(groups, "events")).toMatchObject({ count: 14, bad: 8 });
  });
});

describe("rowIsBad", () => {
  const dep = (over: object) =>
    ({ kind: "deployment", unavailable: 0, desired: 3, available: 3, ...over }) as any;

  it("does not flag a deployment whose replicas are all available, with or without loaded pods", () => {
    expect(rowIsBad(dep({}))).toBe(false);
  });

  it("flags unavailable or missing replicas on deployments", () => {
    expect(rowIsBad(dep({ unavailable: 1 }))).toBe(true);
    expect(rowIsBad(dep({ available: 2 }))).toBe(true);
  });

  it("flags short daemonsets, statefulsets and replicasets but not scaled-to-zero ones", () => {
    expect(rowIsBad({ kind: "daemonset", desired: 6, ready: 5 } as any)).toBe(true);
    expect(rowIsBad({ kind: "daemonset", desired: 6, ready: 6 } as any)).toBe(false);
    expect(rowIsBad({ kind: "statefulset", replicas: 3, ready: 2 } as any)).toBe(true);
    expect(rowIsBad({ kind: "replicaset", desired: 0, ready: 0 } as any)).toBe(false);
  });

  it("flags failed jobs that did not complete", () => {
    expect(rowIsBad({ kind: "job", failed: 1, complete: false } as any)).toBe(true);
    expect(rowIsBad({ kind: "job", failed: 1, complete: true } as any)).toBe(false);
  });

  it("flags unbound claims, scaling-limited autoscalers, terminating namespaces and idle nodes", () => {
    expect(rowIsBad({ kind: "pvc", phase: "Pending" } as any)).toBe(true);
    expect(rowIsBad({ kind: "pvc", phase: "Bound" } as any)).toBe(false);
    expect(
      rowIsBad({
        kind: "hpa",
        conditions: [{ condition: "ScalingLimited", status: "True" }],
      } as any),
    ).toBe(true);
    expect(rowIsBad({ kind: "namespace", phase: "Terminating" } as any)).toBe(true);
    expect(rowIsBad({ kind: "node", ready: "unknown" } as any)).toBe(true);
    expect(rowIsBad({ kind: "node", ready: "true" } as any)).toBe(false);
  });

  it("flags failed, evicted and pending pods", () => {
    expect(rowIsBad(pod("prod", "a", "Failed"))).toBe(true);
    expect(rowIsBad(pod("prod", "a", "Pending"))).toBe(true);
    expect(rowIsBad(pod("prod", "a", "Running"))).toBe(false);
  });

  it("flags a running pod that carries an error waiting reason", () => {
    const crash = {
      ...pod("prod", "a", "Running"),
      status: { text: "CrashLoopBackOff", variant: "error-soft" },
      containers: [{ name: "app", waitingReason: "CrashLoopBackOff" }],
    };
    expect(rowIsBad(crash as any)).toBe(true);
  });
});

describe("filterTree", () => {
  const groups = buildTree({
    inventory: inventory(),
    cluster: null,
    events: { total: 0, warnings: 0 },
  });
  const labelOf = (key: string) => key.split(".").pop()!.replace(/^view/, "");

  it("returns everything for a blank query", () => {
    expect(filterTree(groups, "  ", labelOf)).toBe(groups);
  });

  it("keeps matching items and drops emptied groups", () => {
    const result = filterTree(groups, "pvc", labelOf);
    expect(result.map((g) => g.id)).toEqual(["storage"]);
    expect(result[0].items.map((i) => i.view)).toEqual(["pvcs"]);
  });
});

describe("clusterStatsOf", () => {
  const series = (cluster: string, stat: string, value: number) => ({
    metric: { k8s_cluster: cluster, stat },
    value,
  });
  const results = new Map([
    [
      "CST",
      [series("prod", "nodes", 6), series("prod", "nodesBad", 1), series("stage", "nodes", 2)],
    ],
  ]) as any;

  it("reads one cluster's stats", () => {
    expect(clusterStatsOf(results, "prod")).toEqual({ nodes: 6, nodesBad: 1 });
  });

  it("adds every cluster up when none is selected", () => {
    expect(clusterStatsOf(results, null)).toEqual({ nodes: 8, nodesBad: 1 });
  });

  it("is null for a cluster with no series", () => {
    expect(clusterStatsOf(results, "dev")).toBeNull();
    expect(clusterStatsOf(new Map() as any, "prod")).toBeNull();
  });
});

describe("clusterTone", () => {
  it("is neutral without nodes or pods, so a silent cluster is not shown as healthy", () => {
    expect(clusterTone(null)).toBe("neutral");
    expect(clusterTone({})).toBe("neutral");
  });

  it("is critical when a node is down, a warning for stuck pods or deployments, else healthy", () => {
    expect(clusterTone({ nodes: 6, nodesBad: 1 })).toBe("error");
    expect(clusterTone({ nodes: 6, podsBad: 2 })).toBe("warning");
    expect(clusterTone({ nodes: 6, deploymentsBad: 1 })).toBe("warning");
    expect(clusterTone({ nodes: 6, pods: 40 })).toBe("success");
  });
});

describe("clusterHue", () => {
  it("is stable for a name and stays inside the palette", () => {
    expect(clusterHue("prod-us-east")).toBe(clusterHue("prod-us-east"));
    for (const name of ["a", "prod-eu-west", "staging", "x".repeat(50)]) {
      const hue = clusterHue(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(4);
    }
  });

  it("spreads different names across more than one tint", () => {
    const hues = new Set(
      ["prod-us-east", "prod-eu-west", "staging", "dev", "qa", "uat"].map((n) => clusterHue(n)),
    );
    expect(hues.size).toBeGreaterThan(1);
  });
});

describe("clusterCodes", () => {
  it("uses the leading letters of the first two segments", () => {
    expect(clusterCodes(["prod-us-east", "staging"])).toEqual({
      "prod-us-east": "PU",
      staging: "ST",
    });
  });

  it("never repeats a code, even for clusters that share a prefix", () => {
    const codes = clusterCodes(["prod-us-east", "prod-us-west", "prod-us-north", "prod-us-south"]);
    expect(new Set(Object.values(codes)).size).toBe(4);
  });

  it("falls back to numbered codes once the letters run out", () => {
    const names = ["prod-a-1", "prod-a-2", "prod-a-3", "prod-a-4", "prod-a-5"];
    const codes = clusterCodes(names);
    expect(new Set(Object.values(codes)).size).toBe(names.length);
  });

  it("handles single-word and odd names", () => {
    expect(clusterCodes(["x", "ap1cloud"])).toEqual({ x: "X", ap1cloud: "AP" });
  });
});

describe("nodeSummary", () => {
  const node = (cluster: string, ready: string, extra: object = {}) =>
    ({ kind: "node", cluster, ready, info: null, object: null, ...extra }) as any;

  it("counts ready nodes of the cluster from the rows when there are no stats", () => {
    const nodes = [node("prod", "true"), node("prod", "false"), node("stage", "true")];
    expect(nodeSummary(inventory({ nodes }), "prod")).toMatchObject({ total: 2, ready: 1 });
  });

  it("prefers the cluster-wide stats over the loaded rows", () => {
    expect(nodeSummary(inventory(), "prod", { nodes: 6, nodesBad: 1 })).toMatchObject({
      total: 6,
      ready: 5,
    });
  });

  it("reads provider, region and version once nodes are loaded", () => {
    const nodes = [
      node("prod", "true", {
        info: { kubelet_version: "v1.29.4" },
        object: {
          spec: { providerID: "aws:///ap-south-1a/i-0abc" },
          metadata: { labels: { "topology.kubernetes.io/region": "ap-south-1" } },
        },
      }),
    ];
    expect(nodeSummary(inventory({ nodes }), "prod")).toEqual({
      total: 1,
      ready: 1,
      provider: "AWS",
      region: "ap-south-1",
      version: "v1.29.4",
    });
  });

  it("is null without nodes and leaves unknown context null", () => {
    expect(nodeSummary(inventory(), "prod")).toBeNull();
    expect(nodeSummary(inventory({ nodes: [node("prod", "true")] }), "prod")).toMatchObject({
      provider: null,
      region: null,
      version: null,
    });
  });
});

describe("clusterSeen", () => {
  const results = new Map<string, any[]>([
    ["CL1N", [{ metric: { k8s_cluster: "prod" }, value: 1 }]],
    ["CL2P", [{ metric: { k8s_cluster_name: "edge" }, value: 1 }]],
    ["CST", [{ metric: { k8s_cluster_name: "dev", stat: "pods" }, value: 3 }]],
  ]);

  it("is true for no selected cluster", () => {
    expect(clusterSeen(new Map(), null)).toBe(true);
  });

  it("finds a cluster in any cross-cluster query under either label spelling", () => {
    expect(clusterSeen(results, "prod")).toBe(true);
    expect(clusterSeen(results, "edge")).toBe(true);
    expect(clusterSeen(results, "dev")).toBe(true);
  });

  it("is false for a cluster no series names, and for empty results", () => {
    expect(clusterSeen(results, "ghost")).toBe(false);
    expect(clusterSeen(new Map(), "prod")).toBe(false);
  });

  it("ignores series of queries that are not cross-cluster", () => {
    const other = new Map<string, any[]>([["P1", [{ metric: { k8s_cluster: "prod" }, value: 1 }]]]);
    expect(clusterSeen(other as any, "prod")).toBe(false);
  });
});
