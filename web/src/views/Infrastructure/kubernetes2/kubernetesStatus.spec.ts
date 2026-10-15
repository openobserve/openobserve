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
import type { QueryId } from "./kubernetesQueries";
import {
  buildInventory,
  membersOf,
  type AnyRow,
  type Inventory,
  type PodRow,
  type Series,
} from "./kubernetesModel";
import {
  STATUS_VARIANT,
  controllerStatusOf,
  cronJobStatusOf,
  jobStatusOf,
  podStatusOf,
  statusCounts,
  statusOf,
  type StatusRow,
  type WorkloadStatus,
} from "./kubernetesStatus";

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", namespace: "shop", ...metric },
  value,
});

const inventoryOf = (entries: Partial<Record<QueryId, Series[]>>): Inventory =>
  buildInventory(new Map(Object.entries(entries) as [QueryId, Series[]][]));

type PodSpec = {
  phase: string;
  ready?: "true" | "false" | "unknown";
  reason?: string;
  owner?: [kind: string, name: string];
};

// One P1 series per pod, plus readiness (P11), status reason (P15) and controller (P4).
const podSeries = (pods: Record<string, PodSpec>, withP11 = true) => {
  const out: Partial<Record<QueryId, Series[]>> = { P1: [], P4: [], P15: [] };
  if (withP11) out.P11 = [];
  for (const [name, spec] of Object.entries(pods)) {
    const id = { pod: name, uid: `${name}-uid` };
    out.P1!.push(ksm({ ...id, phase: spec.phase }));
    if (spec.ready && withP11) out.P11!.push(ksm({ ...id, condition: spec.ready }));
    if (spec.reason) out.P15!.push(ksm({ ...id, reason: spec.reason }));
    if (spec.owner) {
      out.P4!.push(
        ksm({
          ...id,
          owner_kind: spec.owner[0],
          owner_name: spec.owner[1],
          owner_is_controller: "true",
        }),
      );
    }
  }
  return out;
};

describe("pod status rules", () => {
  it.each<[string, PodSpec, boolean, WorkloadStatus, boolean]>([
    ["Running and Ready", { phase: "Running", ready: "true" }, true, "running", false],
    ["Running with Ready false", { phase: "Running", ready: "false" }, true, "pending", false],
    ["Running with no P11 series", { phase: "Running" }, true, "unknown", true],
    ["Running with P11 rejected", { phase: "Running", ready: "true" }, false, "unknown", true],
    ["phase Unknown", { phase: "Unknown" }, true, "unknown", true],
    ["Evicted", { phase: "Failed", reason: "Evicted" }, true, "evicted", false],
    ["Failed", { phase: "Failed" }, true, "failed", false],
    ["Succeeded", { phase: "Succeeded" }, true, "succeeded", false],
    ["Pending", { phase: "Pending" }, true, "pending", false],
  ])("%s", (_name, spec, withP11, status, rule) => {
    const [pod] = inventoryOf(podSeries({ p: spec }, withP11)).pods;
    expect(podStatusOf(pod)).toEqual({ status, rule });
  });

  it("needs Initialized True as well when the pod object was observed", () => {
    const [pod] = inventoryOf(podSeries({ p: { phase: "Running", ready: "true" } })).pods;
    pod.object = {
      uid: "p-uid",
      metadata: {},
      spec: {},
      status: { conditions: [{ type: "Initialized", status: "False" }] },
    };
    expect(podStatusOf(pod).status).toBe("pending");
    pod.object.status.conditions[0].status = "True";
    expect(podStatusOf(pod).status).toBe("running");
  });
});

describe("controller status rules", () => {
  // The ReplicaSet card exercises the member-pod rules; every controller kind shares them.
  const rs = (desired: number | null, pods: Record<string, PodSpec>) => {
    const inventory = inventoryOf({
      ...podSeries(pods),
      ...(desired == null ? {} : { RS2: [ksm({ replicaset: "web" }, desired)] }),
    });
    return { inventory, row: inventory.replicasets[0] };
  };
  const member = (phase: string, extra: Partial<PodSpec> = {}): PodSpec => ({
    phase,
    owner: ["ReplicaSet", "web"],
    ...extra,
  });

  it.each<[string, Record<string, PodSpec>, WorkloadStatus]>([
    [
      "failed beats pending and running",
      { a: member("Failed"), b: member("Pending"), c: member("Running", { ready: "true" }) },
      "failed",
    ],
    [
      "pending beats running",
      { b: member("Pending"), c: member("Running", { ready: "true" }) },
      "pending",
    ],
    ["running", { c: member("Running", { ready: "true" }) }, "running"],
    [
      "an Evicted member is not Failed",
      { a: member("Failed", { reason: "Evicted" }), c: member("Running", { ready: "true" }) },
      "running",
    ],
  ])("%s", (_name, pods, status) => {
    const { inventory, row } = rs(2, pods);
    expect(controllerStatusOf(row, inventory.pods)).toEqual({ status, rule: false });
  });

  it("only Unknown members → unknown, with the rule tooltip", () => {
    const { inventory, row } = rs(1, { a: member("Unknown") });
    expect(controllerStatusOf(row, inventory.pods)).toEqual({ status: "unknown", rule: true });
  });

  it.each<[string, number, WorkloadStatus]>([
    ["desired 0 → running", 0, "running"],
    ["desired 3 → pending", 3, "pending"],
  ])("zero member pods: %s", (_name, desired, status) => {
    const { inventory, row } = rs(desired, {});
    expect(controllerStatusOf(row, inventory.pods)).toEqual({ status, rule: true });
  });

  it("zero member pods with the desired series missing (D1 rejected) → unknown", () => {
    const inventory = inventoryOf({ D1: [ksm({ deployment: "api" }, 2)] });
    const row = { ...inventory.deployments[0], desired: null };
    expect(controllerStatusOf(row, inventory.pods)).toEqual({ status: "unknown", rule: true });
  });

  it("uses each kind's own desired signal: SS1 replicas and DS1 desired", () => {
    const inventory = inventoryOf({
      SS1: [ksm({ statefulset: "db" }, 0)],
      DS1: [ksm({ daemonset: "agent" }, 4)],
    });
    expect(controllerStatusOf(inventory.statefulsets[0], []).status).toBe("running");
    expect(controllerStatusOf(inventory.daemonsets[0], []).status).toBe("pending");
  });

  it("joins Deployment members through the ReplicaSet owner (P5)", () => {
    const inventory = inventoryOf({
      ...podSeries({ a: member("Failed") }),
      P5: [
        ksm({
          replicaset: "web",
          owner_kind: "Deployment",
          owner_name: "api",
          owner_is_controller: "true",
        }),
      ],
      D1: [ksm({ deployment: "api" }, 1)],
    });
    expect(controllerStatusOf(inventory.deployments[0], inventory.pods).status).toBe("failed");
  });
});

describe("job status rules", () => {
  const job = (signals: Partial<Record<QueryId, number>>, pods: Record<string, PodSpec> = {}) => {
    const key = { job_name: "backfill" };
    const entries: Partial<Record<QueryId, Series[]>> = {
      ...podSeries(pods),
      J1: [ksm(key, signals.J1 ?? 0)],
    };
    if (signals.J2 != null) entries.J2 = [ksm(key, signals.J2)];
    if (signals.J3 != null)
      entries.J3 = [ksm({ ...key, reason: "BackoffLimitExceeded" }, signals.J3)];
    if (signals.J5 != null) entries.J5 = [ksm(key, signals.J5)];
    const inventory = inventoryOf(entries);
    return { inventory, row: inventory.jobs[0] };
  };
  const member = (phase: string, extra: Partial<PodSpec> = {}): PodSpec => ({
    phase,
    owner: ["Job", "backfill"],
    ...extra,
  });

  it.each<[string, Record<string, PodSpec>, WorkloadStatus]>([
    ["failed beats pending", { a: member("Failed"), b: member("Pending") }, "failed"],
    [
      "pending beats running",
      { b: member("Pending"), c: member("Running", { ready: "true" }) },
      "pending",
    ],
    [
      "running beats succeeded",
      { c: member("Running", { ready: "true" }), d: member("Succeeded") },
      "running",
    ],
    ["succeeded", { d: member("Succeeded") }, "succeeded"],
  ])("%s", (_name, pods, status) => {
    const { inventory, row } = job({ J1: 1 }, pods);
    expect(jobStatusOf(row, inventory.pods)).toEqual({ status, rule: false });
  });

  it.each<[string, Partial<Record<QueryId, number>>, WorkloadStatus]>([
    ["J5 complete → succeeded", { J5: 1, J3: 2 }, "succeeded"],
    ["J3 > 0 → failed", { J3: 2, J1: 1 }, "failed"],
    ["J1 > 0 → running", { J1: 1, J3: 0 }, "running"],
  ])("zero member pods: %s", (_name, signals, status) => {
    const { inventory, row } = job(signals);
    expect(jobStatusOf(row, inventory.pods)).toEqual({ status, rule: true });
  });

  it("zero member pods with J1–J3 and J5 all unavailable → unknown", () => {
    const { inventory, row } = job({ J1: 0 });
    const blank = { ...row, active: null, succeeded: null, failed: null, complete: false };
    expect(jobStatusOf(blank, inventory.pods)).toEqual({ status: "unknown", rule: true });
  });
});

describe("cron job status rules", () => {
  it.each<[number, WorkloadStatus]>([
    [1, "suspended"],
    [0, "scheduled"],
  ])("suspend %s → %s", (suspend, status) => {
    const inventory = inventoryOf({ CJ2: [ksm({ cronjob: "nightly" }, suspend)] });
    expect(cronJobStatusOf(inventory.cronjobs[0])).toEqual({ status, rule: false });
  });
});

describe("status variants", () => {
  it.each<[WorkloadStatus, string]>([
    ["running", "success"],
    ["scheduled", "success"],
    ["succeeded", "success"],
    ["pending", "warning"],
    ["suspended", "warning"],
    ["failed", "danger"],
    ["evicted", "danger"],
    ["unknown", "default"],
  ])("%s → %s", (status, variant) => {
    expect(STATUS_VARIANT[status]).toBe(variant);
  });

  it("uses only OProgressBar variants", () => {
    for (const variant of Object.values(STATUS_VARIANT)) {
      expect(["default", "success", "warning", "danger"]).toContain(variant);
    }
  });
});

describe("statusCounts", () => {
  it("counts per status in Lens order, drops zero statuses and flags rule rows", () => {
    const inventory = inventoryOf(
      podSeries({
        a: { phase: "Running", ready: "true" },
        b: { phase: "Running", ready: "true" },
        c: { phase: "Running", ready: "false" },
        d: { phase: "Unknown" },
      }),
    );
    expect(statusCounts("pod", inventory.pods, inventory.pods)).toEqual([
      { status: "running", count: 2, variant: "success", rule: false },
      { status: "pending", count: 1, variant: "warning", rule: false },
      { status: "unknown", count: 1, variant: "default", rule: true },
    ]);
  });

  it("marks a row as a rule row when any of its objects used the zero-pod rule", () => {
    const inventory = inventoryOf({
      ...podSeries({ a: { phase: "Running", ready: "true", owner: ["ReplicaSet", "web"] } }),
      RS2: [ksm({ replicaset: "web" }, 1), ksm({ replicaset: "idle" }, 0)],
    });
    expect(statusCounts("replicaset", inventory.replicasets, inventory.pods)).toEqual([
      { status: "running", count: 2, variant: "success", rule: true },
    ]);
  });

  it("returns no rows for no objects", () => {
    expect(statusCounts("cronjob", [], [])).toEqual([]);
  });
});

// Catches a quadratic blow-up (seconds), not machine speed: CI runs this slower, under coverage.
const MEMBERSHIP_BUDGET_MS = 250;

// The original full scan, kept verbatim so the indexed lookup is pinned to it.
function referenceMembersOf(pods: PodRow[], row: AnyRow): PodRow[] {
  const same = (p: PodRow) => p.cluster === row.cluster;
  switch (row.kind) {
    case "node":
      return pods.filter((p) => same(p) && p.node === row.name);
    case "namespace":
      return pods.filter((p) => same(p) && p.namespace === row.name);
    case "deployment":
      return pods.filter(
        (p) =>
          same(p) &&
          p.namespace === row.namespace &&
          p.workload?.kind === "Deployment" &&
          p.workload.name === row.name,
      );
    case "daemonset":
    case "statefulset":
    case "replicaset":
    case "job": {
      const kind = {
        daemonset: "DaemonSet",
        statefulset: "StatefulSet",
        replicaset: "ReplicaSet",
        job: "Job",
      }[row.kind];
      return pods.filter(
        (p) =>
          same(p) &&
          p.namespace === row.namespace &&
          p.controller?.kind === kind &&
          p.controller.name === row.name,
      );
    }
    default:
      return [];
  }
}

describe("pod membership, pinned against the original full scan", () => {
  const at = (cluster: string, namespace: string, metric: Record<string, string>, value = 1) =>
    ({ metric: { k8s_cluster: cluster, namespace, ...metric }, value }) as Series;
  const podsAt = (
    cluster: string,
    namespace: string,
    names: string[],
    owner: [string, string],
  ) => ({
    P1: names.map((pod) =>
      at(cluster, namespace, { pod, uid: `${cluster}-${namespace}-${pod}`, phase: "Running" }),
    ),
    P11: names.map((pod) =>
      at(cluster, namespace, { pod, uid: `${cluster}-${namespace}-${pod}`, condition: "true" }),
    ),
    P4: names.map((pod) =>
      at(cluster, namespace, {
        pod,
        uid: `${cluster}-${namespace}-${pod}`,
        owner_kind: owner[0],
        owner_name: owner[1],
        owner_is_controller: "true",
      }),
    ),
  });
  const places: [string, string][] = [
    ["prod", "shop"],
    ["prod", "ops"],
    ["stage", "shop"],
  ];
  const parts = places.flatMap(([c, ns]) => [
    podsAt(c, ns, ["web-1", "web-2"], ["ReplicaSet", "web-abc"]),
    podsAt(c, ns, ["nightly-1"], ["Job", "nightly-29"]),
  ]);
  const merged = (id: "P1" | "P11" | "P4") => parts.flatMap((part) => part[id]);
  const inventory = inventoryOf({
    P1: merged("P1"),
    P11: merged("P11"),
    P4: merged("P4"),
    P5: places.map(([c, ns]) =>
      at(c, ns, {
        replicaset: "web-abc",
        owner_kind: "Deployment",
        owner_name: "web",
        owner_is_controller: "true",
      }),
    ),
    D1: places.map(([c, ns]) => at(c, ns, { deployment: "web" })),
    RS2: places.map(([c, ns]) => at(c, ns, { replicaset: "web-abc" })),
    J1: places.map(([c, ns]) => at(c, ns, { job_name: "nightly-29" })),
    CJ1: places.map(([c, ns]) => at(c, ns, { cronjob: "nightly" })),
  });
  const uids = (pods: PodRow[]) => pods.map((p) => p.uid).sort();

  it("joins Deployment through ReplicaSet, and Job pods, only within one cluster and namespace", () => {
    for (const [cluster, namespace] of places) {
      const find = <T extends AnyRow>(rows: T[]) =>
        rows.find((r) => r.cluster === cluster && r.namespace === namespace)!;
      const id = (pod: string) => `${cluster}-${namespace}-${pod}`;
      expect(uids(membersOf(inventory.pods, find(inventory.deployments)))).toEqual([
        id("web-1"),
        id("web-2"),
      ]);
      expect(uids(membersOf(inventory.pods, find(inventory.replicasets)))).toEqual([
        id("web-1"),
        id("web-2"),
      ]);
      expect(uids(membersOf(inventory.pods, find(inventory.jobs)))).toEqual([id("nightly-1")]);
      expect(membersOf(inventory.pods, find(inventory.cronjobs))).toEqual([]);
    }
    expect(inventory.deployments).toHaveLength(3);
    expect(inventory.jobs).toHaveLength(3);
  });

  it("keeps the statuses those memberships give", () => {
    for (const row of [...inventory.deployments, ...inventory.replicasets, ...inventory.jobs]) {
      expect(statusOf(row as StatusRow, inventory.pods)).toEqual({
        status: "running",
        rule: false,
      });
    }
    expect(statusCounts("deployment", inventory.deployments, inventory.pods)).toEqual([
      { status: "running", count: 3, variant: "success", rule: false },
    ]);
  });

  const KINDS = [
    "node",
    "namespace",
    "deployment",
    "daemonset",
    "statefulset",
    "replicaset",
    "job",
    "cronjob",
  ] as const;
  const OWNER_KINDS = ["Deployment", "DaemonSet", "StatefulSet", "ReplicaSet", "Job", "CronJob"];

  it("matches the full scan for 200 random clusters", () => {
    // mulberry32, so every random case is repeatable.
    let seed = 7;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)];
    const owner = () =>
      random() < 0.15 ? null : { kind: pick(OWNER_KINDS), name: pick(["a", "b", "c"]) };
    for (let round = 0; round < 200; round++) {
      const pods = Array.from({ length: 1 + Math.floor(random() * 40) }, (_, i) => ({
        kind: "pod",
        uid: `p${i}`,
        cluster: pick(["x", "y"]),
        namespace: pick(["a", "b", "c"]),
        node: random() < 0.1 ? null : pick(["a", "b", "c"]),
        controller: owner(),
        workload: owner(),
      })) as unknown as PodRow[];
      for (const kind of KINDS) {
        for (const cluster of ["x", "y"]) {
          for (const namespace of ["a", "b", "c"]) {
            for (const name of ["a", "b", "c"]) {
              const row = { kind, cluster, namespace, name } as AnyRow;
              expect(membersOf(pods, row)).toEqual(referenceMembersOf(pods, row));
            }
          }
        }
      }
    }
  });

  it("counts 3,000 workloads over 5,000 pods without a scan per workload", () => {
    const controllers = ["Deployment", "DaemonSet", "StatefulSet", "ReplicaSet", "Job"];
    const pods = Array.from({ length: 5000 }, (_, i) => {
      const owner = { kind: controllers[i % 5], name: `w${i % 600}` };
      return {
        kind: "pod",
        cluster: "prod",
        namespace: `ns${i % 7}`,
        phase: "Running",
        ready: "true",
        statusReason: null,
        object: null,
        controller: owner,
        workload: owner,
      };
    }) as unknown as PodRow[];
    const rowsOf = (kind: string) =>
      Array.from({ length: 600 }, (_, i) => ({
        kind,
        cluster: "prod",
        namespace: `ns${i % 7}`,
        name: `w${i}`,
        desired: 1,
        replicas: 1,
      })) as unknown as StatusRow[];
    const kinds = ["deployment", "daemonset", "statefulset", "replicaset", "job"] as const;
    const started = performance.now();
    const counts = kinds.map((kind) => statusCounts(kind, rowsOf(kind), pods));
    expect(performance.now() - started).toBeLessThan(MEMBERSHIP_BUDGET_MS);
    expect(counts.flat().reduce((sum, c) => sum + c.count, 0)).toBe(3000);
  });
});
