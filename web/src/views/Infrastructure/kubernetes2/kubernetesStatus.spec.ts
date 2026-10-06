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
import { buildInventory, type Inventory, type Series } from "./kubernetesModel";
import {
  STATUS_VARIANT,
  controllerStatusOf,
  cronJobStatusOf,
  jobStatusOf,
  podStatusOf,
  statusCounts,
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
