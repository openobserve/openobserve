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
  filterRows,
  formatAge,
  formatBytes,
  formatCores,
  formatPct,
  inScope,
  lensPodStatus,
  nodeConditionWords,
  parseVector,
  sortRows,
  usageBarVariant,
  warningLabel,
  type PodRow,
  type Series,
  type WarningEvent,
} from "./kubernetesModel";

const GI = 1024 ** 3;
const MI = 1024 ** 2;

// KSM carries k8s_cluster; generator kubeletstats carries k8s_cluster_name.
const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});
const kub = (metric: Record<string, string>, value: number): Series => ({
  metric: { k8s_cluster_name: "prod", ...metric },
  value,
});

const pod = (name: string, extra: Record<string, string> = {}) => ({
  namespace: "shop",
  pod: name,
  uid: `${name}-uid`,
  ...extra,
});

const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const onlyPod = (data: Partial<Record<QueryId, Series[]>>) => {
  const inventory = buildInventory(results(data));
  expect(inventory.pods).toHaveLength(1);
  return inventory.pods[0];
};

const keys = (row: { warnings: { key: string }[] }) => row.warnings.map((w) => w.key);

describe("buildInventory — pods", () => {
  it("joins a KSM row and a kubeletstats row with the same values into one row", () => {
    const row = onlyPod({
      P1: [ksm({ ...pod("web-1"), phase: "Running" })],
      K1: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "web-1" }, 0.25)],
      K2: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "web-1" }, 100 * MI)],
    });
    expect(row).toMatchObject({
      cluster: "prod",
      namespace: "shop",
      name: "web-1",
      cpuCores: 0.25,
      memoryBytes: 100 * MI,
    });
  });

  it("joins the openobserve-collector shape, where kubeletstats uses k8s_cluster", () => {
    const row = onlyPod({
      P1: [ksm({ ...pod("web-1"), phase: "Running" })],
      K2: [
        {
          metric: { k8s_cluster: "prod", k8s_namespace_name: "shop", k8s_pod_name: "web-1" },
          value: 5,
        },
      ],
    });
    expect(row.memoryBytes).toBe(5);
  });

  describe("delete then recreate with the same name", () => {
    const A = { namespace: "data", pod: "db-0", uid: "A" };
    const B = { namespace: "data", pod: "db-0", uid: "B" };
    const fixture = (extra: Partial<Record<QueryId, Series[]>> = {}) => ({
      P1: [ksm({ ...A, phase: "Failed" }), ksm({ ...B, phase: "Running" })],
      P11: [ksm({ ...B, condition: "true" })],
      P12: [ksm(A, 100), ksm(B, 200)],
      P4: [
        ksm({ ...A, owner_kind: "ReplicaSet", owner_name: "rs-a" }),
        ksm({ ...B, owner_kind: "ReplicaSet", owner_name: "rs-b" }),
      ],
      P5: [
        ksm({ namespace: "data", replicaset: "rs-a", owner_kind: "Deployment", owner_name: "old" }),
        ksm({ namespace: "data", replicaset: "rs-b", owner_kind: "Deployment", owner_name: "db" }),
      ],
      P10: [ksm({ ...A, container: "main" }), ksm({ ...B, container: "main" })],
      P9: [
        ksm({ ...A, container: "main", resource: "memory" }, 2 * GI),
        ksm({ ...B, container: "main", resource: "memory" }, 1 * GI),
      ],
      K2: [
        kub({ k8s_namespace_name: "data", k8s_pod_name: "db-0", k8s_pod_uid: "A" }, 900 * MI),
        kub({ k8s_namespace_name: "data", k8s_pod_name: "db-0", k8s_pod_uid: "B" }, 100 * MI),
      ],
      ...extra,
    });

    it("shows only the newest uid's state, owner, limit and usage", () => {
      const row = onlyPod(fixture());
      expect(row.uid).toBe("B");
      expect(row.status).toEqual({ text: "Running", variant: "success-soft" });
      expect(row.controller).toEqual({ kind: "ReplicaSet", name: "rs-b" });
      expect(row.workload).toEqual({ kind: "Deployment", name: "db" });
      expect(row.memoryLimit).toBe(1 * GI);
      expect(row.memoryBytes).toBe(100 * MI);
      expect(row.series).toEqual({
        cpu: null,
        memory: { clusterLabel: "k8s_cluster_name", uid: "B" },
      });
    });

    it("joins a usage series without k8s_pod_uid by name and namespace", () => {
      const row = onlyPod(
        fixture({ K2: [kub({ k8s_namespace_name: "data", k8s_pod_name: "db-0" }, 42)] }),
      );
      expect(row.memoryBytes).toBe(42);
      expect(row.series.memory?.uid).toBeNull();
    });

    it("marks the pod ambiguous when only some uids have a creation time", () => {
      const data = fixture({ P12: [ksm(A, 100)] });
      const row = buildInventory(results(data)).pods[0];
      expect(row.ambiguous).toBe(true);
      expect(row.uid).toBeNull();
    });

    it("marks the pod ambiguous when several uids exist and P12 is unavailable", () => {
      const data = fixture();
      delete data.P12;
      const inventory = buildInventory(results(data));
      const row = inventory.pods[0];
      expect(row.ambiguous).toBe(true);
      expect(row.status).toBeNull();
      expect(row.uid).toBeNull();
      expect(row.controller).toBeNull();
      expect(row.memoryLimit).toBeNull();
      expect(row.warnings).toEqual([]);
    });
  });

  describe("status precedence", () => {
    it("a container waiting on CrashLoopBackOff outranks a Running phase", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("rec"), phase: "Running" })],
        P2: [ksm({ ...pod("rec"), container: "main", reason: "CrashLoopBackOff" })],
      });
      expect(row.status).toEqual({ text: "CrashLoopBackOff", variant: "error-soft" });
      expect(row.warnings[0]).toMatchObject({ key: "infra.k8s2.warnWaiting", severity: "error" });
    });

    it.each([
      [["Running", "Pending"], "Pending"],
      [["Succeeded", "Running"], "Running"],
      [["Unknown", "Running"], "Unknown"],
      [["Pending", "Failed"], "Failed"],
    ])("several phases %j resolve to %s", (phases, expected) => {
      const row = onlyPod({ P1: phases.map((phase) => ksm({ ...pod("x"), phase })) });
      expect(row.phase).toBe(expected);
    });

    it("drops a pod from container errors once P2 no longer has its series", () => {
      const before = onlyPod({
        P1: [ksm({ ...pod("rec"), phase: "Running" })],
        P2: [ksm({ ...pod("rec"), container: "main", reason: "CrashLoopBackOff" })],
      });
      expect(keys(before)).toContain("infra.k8s2.warnWaiting");
      const after = onlyPod({ P1: [ksm({ ...pod("rec"), phase: "Running" })], P2: [] });
      expect(keys(after)).not.toContain("infra.k8s2.warnWaiting");
      expect(after.status?.text).toBe("Running");
    });
  });

  describe("readiness", () => {
    const running = (ready?: string) => ({
      P1: [ksm({ ...pod("o"), phase: "Running" })],
      P11: ready ? [ksm({ ...pod("o"), condition: ready })] : [],
    });

    it("Running and ready is success-soft", () => {
      expect(onlyPod(running("true")).status).toEqual({ text: "Running", variant: "success-soft" });
    });

    it("Running and not ready is a warning counted as not running", () => {
      const row = onlyPod(running("false"));
      expect(row.status).toEqual({ key: "infra.k8s2.podRunningNotReady", variant: "warning-soft" });
      expect(keys(row)).toContain("infra.k8s2.warnNotReady");
    });

    it("Running with no ready series is neutral and not counted", () => {
      const row = onlyPod(running());
      expect(row.status).toEqual({ text: "Running", variant: "default-soft" });
      expect(row.warnings).toEqual([]);
    });

    it("a waiting reason outside the error set is a warning", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("o"), phase: "Pending" })],
        P2: [ksm({ ...pod("o"), container: "main", reason: "ContainerCreating" })],
      });
      expect(row.status).toEqual({ text: "ContainerCreating", variant: "warning-soft" });
      expect(keys(row)).not.toContain("infra.k8s2.warnWaiting");
    });

    it.each([
      ["Failed", "error-soft"],
      ["Pending", "warning-soft"],
      ["Unknown", "amber-soft"],
      ["Succeeded", "default-soft"],
    ])("phase %s is %s", (phase, variant) => {
      expect(onlyPod({ P1: [ksm({ ...pod("o"), phase })] }).status).toEqual({
        text: phase,
        variant,
      });
    });
  });

  describe("request and limit completeness", () => {
    it("a container without a CPU request makes the CPU request 'missing'", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("w"), phase: "Running" })],
        P10: [ksm({ ...pod("w"), container: "a" }), ksm({ ...pod("w"), container: "b" })],
        P8: [ksm({ ...pod("w"), container: "a", resource: "cpu" }, 0.5)],
        K1: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "w" }, 0.25)],
      });
      expect(row.cpuRequest).toBe("missing");
      expect(row.cpuPctOfRequest).toBeNull();
    });

    it("a container without a memory limit is 'missing' and never near the limit", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("w"), phase: "Running" })],
        P10: [ksm({ ...pod("w"), container: "a" }), ksm({ ...pod("w"), container: "b" })],
        P9: [ksm({ ...pod("w"), container: "a", resource: "memory" }, 100)],
        K2: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "w" }, 99)],
      });
      expect(row.memoryLimit).toBe("missing");
      expect(row.memoryPctOfLimit).toBeNull();
      expect(keys(row)).not.toContain("infra.k8s2.warnNearMemoryLimit");
    });

    it("uses the full sums when every container has both", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("w"), phase: "Running" })],
        P10: [ksm({ ...pod("w"), container: "a" })],
        P8: [
          ksm({ ...pod("w"), container: "a", resource: "cpu" }, 0.5),
          ksm({ ...pod("w"), container: "b", resource: "cpu" }, 0.5),
          ksm({ ...pod("w"), container: "a", resource: "memory" }, 100),
          ksm({ ...pod("w"), container: "b", resource: "memory" }, 100),
        ],
        P9: [
          ksm({ ...pod("w"), container: "a", resource: "memory" }, 100),
          ksm({ ...pod("w"), container: "b", resource: "memory" }, 100),
        ],
        K1: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "w" }, 0.5)],
        K2: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "w" }, 190)],
      });
      // Container b is known only from P8, as for a Pending pod with no container statuses.
      expect(row.cpuRequest).toBe(1);
      expect(row.cpuPctOfRequest).toBe(50);
      expect(row.memoryLimit).toBe(200);
      expect(row.memoryPctOfLimit).toBe(95);
      expect(row.warnings).toContainEqual({
        key: "infra.k8s2.warnNearMemoryLimit",
        params: { pct: "95%" },
        severity: "warning",
      });
    });

    it("an empty sparse limits result reads 'missing' for every pod", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("w"), phase: "Running" })],
        P10: [ksm({ ...pod("w"), container: "a" })],
        P9: [],
      });
      expect(row.memoryLimit).toBe("missing");
    });

    it("an unavailable query blanks its column instead", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("w"), phase: "Running" })],
        P10: [ksm({ ...pod("w"), container: "a" })],
      });
      expect(row.memoryLimit).toBeNull();
      expect(row.cpuRequest).toBeNull();
      expect(row.restarts).toBeNull();
    });
  });

  it("sums lifetime per-container restarts and rounds the pod total", () => {
    const row = onlyPod({
      P1: [ksm({ ...pod("r"), phase: "Running" })],
      P7: [ksm({ ...pod("r"), container: "a" }, 0.6), ksm({ ...pod("r"), container: "b" }, 1.3)],
    });
    expect(row.restarts).toBe(2);
  });

  it.each([
    [{ a: "Completed", b: "OOMKilled", c: "Error" }, "OOMKilled"],
    [{ a: "Completed", b: "Error" }, "Error"],
    [{ a: "Completed" }, "Completed"],
  ])("prefers OOMKilled, then anything but Completed, for Last: %j", (reasons, expected) => {
    const row = onlyPod({
      P1: [ksm({ ...pod("l"), phase: "Running" })],
      P3: Object.entries(reasons).map(([container, reason]) =>
        ksm({ ...pod("l"), container, reason }),
      ),
    });
    expect(row.lastTerminatedReason).toBe(expected);
  });

  it("flags the last termination OOMKilled for as long as KSM reports it", () => {
    const row = onlyPod({
      P1: [ksm({ ...pod("an"), phase: "Running" })],
      P3: [ksm({ ...pod("an"), container: "a", reason: "OOMKilled" })],
      P7: [ksm({ ...pod("an"), container: "a" }, 0)],
    });
    expect(keys(row)).toContain("infra.k8s2.warnOomKilled");
  });

  describe("owners", () => {
    it("resolves pod → ReplicaSet → Deployment through controller owners only", () => {
      const inventory = buildInventory(
        results({
          P1: [
            ksm({ ...pod("web-a"), phase: "Running" }),
            ksm({ ...pod("web-b"), phase: "Running" }),
          ],
          P4: [
            ksm({ ...pod("web-a"), owner_kind: "ReplicaSet", owner_name: "web-rs" }),
            ksm({
              ...pod("web-a"),
              owner_kind: "Node",
              owner_name: "n1",
              owner_is_controller: "false",
            }),
            ksm({ ...pod("web-b"), owner_kind: "ReplicaSet", owner_name: "web-rs" }),
          ],
          P5: [
            ksm({
              namespace: "shop",
              replicaset: "web-rs",
              owner_kind: "Deployment",
              owner_name: "web",
            }),
            ksm({
              namespace: "shop",
              replicaset: "web-rs",
              owner_kind: "Other",
              owner_name: "x",
              owner_is_controller: "false",
            }),
          ],
          D1: [ksm({ namespace: "shop", deployment: "web" }, 2)],
          D2: [ksm({ namespace: "shop", deployment: "web" }, 2)],
        }),
      );
      expect(inventory.pods.map((p) => p.workload)).toEqual([
        { kind: "Deployment", name: "web" },
        { kind: "Deployment", name: "web" },
      ]);
      expect(inventory.pods.map((p) => p.controller)).toEqual([
        { kind: "ReplicaSet", name: "web-rs" },
        { kind: "ReplicaSet", name: "web-rs" },
      ]);
    });

    it("resolves the workload to the ReplicaSet itself without the owner join", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("web-a"), phase: "Running" })],
        P4: [ksm({ ...pod("web-a"), owner_kind: "ReplicaSet", owner_name: "web-rs" })],
      });
      expect(row.workload).toEqual({ kind: "ReplicaSet", name: "web-rs" });
    });

    it("keeps a Job owner as it is", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("backfill"), phase: "Failed" })],
        P4: [ksm({ ...pod("backfill"), owner_kind: "Job", owner_name: "backfill" })],
        P5: [],
      });
      expect(row.controller).toEqual({ kind: "Job", name: "backfill" });
      expect(row.workload).toEqual({ kind: "Job", name: "backfill" });
    });
  });

  describe("membership", () => {
    it("lists a pod known only from one usage stream, with the other blank", () => {
      const row = onlyPod({ K1: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "u" }, 0.1)] });
      expect(row.cpuCores).toBe(0.1);
      expect(row.memoryBytes).toBeNull();
      expect(row.status).toBeNull();
    });

    it("drops non-finite samples so the cell blanks", () => {
      const metric = { k8s_cluster_name: "prod", k8s_namespace_name: "shop", k8s_pod_name: "n" };
      const response = (value: string) => ({
        data: { data: { result: [{ metric, value: [1, value] }] } },
      });
      expect(parseVector(response("7"))).toEqual([{ metric, value: 7 }]);
      expect(parseVector(response("NaN"))).toEqual([]);
      expect(parseVector(response("+Inf"))).toEqual([]);
      const row = onlyPod({
        P1: [ksm({ ...pod("n"), phase: "Running" })],
        K2: parseVector(response("NaN")),
      });
      expect(row.memoryBytes).toBeNull();
    });

    it("without the pod anchor every status is null and no pod counts", () => {
      const inventory = buildInventory(
        results({ K1: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "u" }, 0.1)] }),
      );
      expect(inventory.pods[0].status).toBeNull();
      expect(inventory.pods[0].warnings).toEqual([]);
    });
  });

  describe("uid handling", () => {
    it("keeps the CPU and memory matchers apart when their series differ", () => {
      const row = onlyPod({
        P1: [ksm({ namespace: "shop", pod: "p", uid: "B", phase: "Running" })],
        K1: [
          {
            metric: {
              k8s_cluster: "prod",
              k8s_namespace_name: "shop",
              k8s_pod_name: "p",
              k8s_pod_uid: "B",
            },
            value: 1,
          },
        ],
        K2: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "p" }, 2)],
      });
      expect(row.series).toEqual({
        cpu: { clusterLabel: "k8s_cluster", uid: "B" },
        memory: { clusterLabel: "k8s_cluster_name", uid: null },
      });
    });

    it("joins uid-labelled usage when the KSM series carry no uid", () => {
      const row = onlyPod({
        P1: [ksm({ namespace: "shop", pod: "p", phase: "Running" })],
        K2: [kub({ k8s_namespace_name: "shop", k8s_pod_name: "p", k8s_pod_uid: "X" }, 7)],
      });
      expect(row.memoryBytes).toBe(7);
    });

    it("marks a kubeletstats-only pod with several uids ambiguous instead of summing", () => {
      const row = onlyPod({
        K2: [
          kub({ k8s_namespace_name: "shop", k8s_pod_name: "p", k8s_pod_uid: "A" }, 900),
          kub({ k8s_namespace_name: "shop", k8s_pod_name: "p", k8s_pod_uid: "B" }, 100),
        ],
      });
      expect(row.ambiguous).toBe(true);
      expect(row.memoryBytes).toBeNull();
      expect(row.series).toEqual({ cpu: null, memory: null });
    });
  });

  describe("cluster labels", () => {
    it("prefers k8s_cluster when a series carries both spellings", () => {
      const row = onlyPod({
        K2: [
          {
            metric: {
              k8s_cluster: "a",
              k8s_cluster_name: "b",
              k8s_namespace_name: "shop",
              k8s_pod_name: "p",
            },
            value: 1,
          },
        ],
      });
      expect(row.cluster).toBe("a");
      expect(row.series.memory?.clusterLabel).toBe("k8s_cluster");
    });

    it("leaves unlabelled kubeletstats rows unjoined and reports the family", () => {
      const inventory = buildInventory(
        results({
          P1: [ksm({ ...pod("p"), phase: "Running" })],
          K2: [{ metric: { k8s_namespace_name: "shop", k8s_pod_name: "p" }, value: 1 }],
        }),
      );
      expect(inventory.pods.map((p) => p.cluster).sort()).toEqual(["", "prod"]);
      expect(inventory.unlabelledFamilies).toEqual(["kubeletstats"]);
    });
  });
});

describe("pods — Lens redesign", () => {
  it.each([
    [
      "Evicted beats a waiting reason",
      { reason: "Evicted", waiting: "CrashLoopBackOff", phase: "Failed" },
      { text: "Evicted", variant: "error-soft" },
    ],
    [
      "a waiting reason beats Failed",
      { waiting: "CrashLoopBackOff", phase: "Failed" },
      { text: "CrashLoopBackOff", variant: "error-soft" },
    ],
    [
      "Failed beats readiness",
      { phase: "Failed", ready: "true" },
      { text: "Failed", variant: "error-soft" },
    ],
    ["Pending", { phase: "Pending" }, { text: "Pending", variant: "warning-soft" }],
    ["Unknown", { phase: "Unknown" }, { text: "Unknown", variant: "amber-soft" }],
    [
      "Running not ready",
      { phase: "Running", ready: "false" },
      { key: "infra.k8s2.podRunningNotReady", variant: "warning-soft" },
    ],
    [
      "Running ready",
      { phase: "Running", ready: "true" },
      { text: "Running", variant: "success-soft" },
    ],
  ] as const)("status precedence: %s", (_name, f: any, expected) => {
    const p = pod("s");
    const row = onlyPod({
      P1: [ksm({ ...p, phase: f.phase })],
      P11: f.ready ? [ksm({ ...p, condition: f.ready })] : [],
      P2: f.waiting ? [ksm({ ...p, container: "main", reason: f.waiting })] : [],
      P15: f.reason ? [ksm({ ...p, reason: f.reason })] : [],
    });
    expect(row.status).toEqual(expected);
  });

  describe("container squares", () => {
    const p = pod("sq");
    const fixture = (extra: Partial<Record<QueryId, Series[]>>) =>
      onlyPod({ P1: [ksm({ ...p, phase: "Running" })], P7: [], ...extra });

    it("orders the states terminated, restarted, ready, waiting, unknown", () => {
      const row = fixture({
        P10: ["a", "b", "c", "d"].map((container) =>
          ksm({ ...p, container, image: `img-${container}` }),
        ),
        P8: [ksm({ ...p, container: "e", resource: "cpu" }, 0.1)],
        P13: [
          ksm({ ...p, container: "a" }, 1),
          ksm({ ...p, container: "b" }, 1),
          ksm({ ...p, container: "c" }, 1),
          ksm({ ...p, container: "d" }, 0),
        ],
        P14: [ksm({ ...p, container: "a", reason: "Completed" })],
        P7: [ksm({ ...p, container: "b" }, 2), ksm({ ...p, container: "a" }, 3)],
      });
      expect(row.containers.map((c) => [c.name, c.state])).toEqual([
        ["a", "terminated"],
        ["b", "restarted"],
        ["c", "ready"],
        ["d", "waiting"],
        ["e", "unknown"],
      ]);
      expect(row.containers[0].image).toBe("img-a");
    });

    it("shows a CrashLoopBackOff container as waiting", () => {
      const row = fixture({
        P10: [ksm({ ...p, container: "main" })],
        P13: [ksm({ ...p, container: "main" }, 0)],
        P2: [ksm({ ...p, container: "main", reason: "CrashLoopBackOff" })],
      });
      expect(row.containers[0].state).toBe("waiting");
      expect(row.containers[0].running).toBe(false);
    });

    it("gives a Pending pod with requests only an unknown square per requested container", () => {
      const row = onlyPod({
        P1: [ksm({ ...p, phase: "Pending" })],
        P8: [
          ksm({ ...p, container: "x", resource: "cpu" }, 1),
          ksm({ ...p, container: "y", resource: "cpu" }, 1),
        ],
      });
      expect(row.containers.map((c) => c.state)).toEqual(["unknown", "unknown"]);
    });
  });

  describe("controlled by", () => {
    it("keeps the direct ReplicaSet owner, and resolves the Deployment as the workload", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("w"), phase: "Running" })],
        P4: [ksm({ ...pod("w"), owner_kind: "ReplicaSet", owner_name: "w-rs" })],
        P5: [
          ksm({ namespace: "shop", replicaset: "w-rs", owner_kind: "Deployment", owner_name: "w" }),
        ],
      });
      expect(row.controller).toEqual({ kind: "ReplicaSet", name: "w-rs" });
      expect(row.workload).toEqual({ kind: "Deployment", name: "w" });
    });

    it.each(["<none>", ""])("treats a P4 owner of %j as absent", (name) => {
      const row = onlyPod({
        P1: [ksm({ ...pod("w"), phase: "Running" })],
        P4: [ksm({ ...pod("w"), owner_kind: name, owner_name: name })],
      });
      expect(row.controller).toBeNull();
      expect(row.workload).toBeNull();
    });

    it.each(["<none>", ""])("treats a P5 and J7 owner of %j as absent", (name) => {
      const inventory = buildInventory(
        results({
          RS2: [ksm({ namespace: "shop", replicaset: "rs" }, 1)],
          P5: [ksm({ namespace: "shop", replicaset: "rs", owner_kind: name, owner_name: name })],
          J1: [ksm({ namespace: "shop", job_name: "j" }, 0)],
          J7: [ksm({ namespace: "shop", job_name: "j", owner_kind: name, owner_name: name })],
        }),
      );
      expect(inventory.replicasets[0].owner).toBeNull();
      expect(inventory.jobs[0].owner).toBeNull();
    });
  });

  describe("QoS estimate", () => {
    const qos = (p8: Series[], p9: Series[]) =>
      onlyPod({
        P1: [ksm({ ...pod("q"), phase: "Running" })],
        P10: [ksm({ ...pod("q"), container: "c" })],
        P8: p8,
        P9: p9,
      }).qos;

    it("is BestEffort without any request or limit", () => {
      expect(qos([], [])).toEqual({ cls: "BestEffort", estimated: true });
    });

    it("is Guaranteed when limits equal requests for cpu and memory", () => {
      const both = (id: "cpu" | "memory", v: number) =>
        ksm({ ...pod("q"), container: "c", resource: id }, v);
      expect(qos([both("cpu", 1), both("memory", 5)], [both("cpu", 1), both("memory", 5)])).toEqual(
        {
          cls: "Guaranteed",
          estimated: true,
        },
      );
    });

    it("is Burstable for the coredns shape (requests, and a memory limit only)", () => {
      const r = (id: "cpu" | "memory", v: number) =>
        ksm({ ...pod("q"), container: "c", resource: id }, v);
      expect(qos([r("cpu", 0.1), r("memory", 70 * MI)], [r("memory", 170 * MI)])?.cls).toBe(
        "Burstable",
      );
    });

    it("is unknown when requests or limits are unavailable", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("q"), phase: "Running" })],
        P10: [ksm({ ...pod("q"), container: "c" })],
      });
      expect(row.qos).toBeNull();
    });
  });

  it("reads pod age, IP, priority class and node from P12 and P6", () => {
    const row = onlyPod({
      P1: [ksm({ ...pod("a"), phase: "Running" })],
      P12: [ksm(pod("a"), 1_700_000_000)],
      P6: [ksm({ ...pod("a"), node: "n1", pod_ip: "10.0.0.5", priority_class: "high" })],
    });
    expect(row).toMatchObject({
      createdAt: 1_700_000_000_000_000,
      ip: "10.0.0.5",
      priorityClass: "high",
      node: "n1",
    });
  });

  describe("⚠ reasons", () => {
    const p = pod("w");
    it.each([
      ["Failed", { P1: [ksm({ ...p, phase: "Failed" })] }, "infra.k8s2.warnFailed", "error"],
      [
        "Evicted",
        { P1: [ksm({ ...p, phase: "Failed" })], P15: [ksm({ ...p, reason: "Evicted" })] },
        "infra.k8s2.warnEvicted",
        "error",
      ],
      ["Pending", { P1: [ksm({ ...p, phase: "Pending" })] }, "infra.k8s2.warnPhase", "warning"],
      ["Unknown", { P1: [ksm({ ...p, phase: "Unknown" })] }, "infra.k8s2.warnPhase", "warning"],
      [
        "not ready",
        { P1: [ksm({ ...p, phase: "Running" })], P11: [ksm({ ...p, condition: "unknown" })] },
        "infra.k8s2.warnNotReady",
        "warning",
      ],
      [
        "image pull",
        {
          P1: [ksm({ ...p, phase: "Pending" })],
          P2: [ksm({ ...p, container: "c", reason: "ImagePullBackOff" })],
        },
        "infra.k8s2.warnWaiting",
        "error",
      ],
    ] as const)("%s yields its line and severity", (_n, data: any, key, severity) => {
      expect(onlyPod(data).warnings).toContainEqual(expect.objectContaining({ key, severity }));
    });

    const END = 1_700_000_000_000_000;
    const event = (extra: Partial<WarningEvent>): WarningEvent => ({
      cluster: "prod",
      kind: "Pod",
      name: "w",
      namespace: "shop",
      uid: "w-uid",
      events: 3,
      lastSeen: END - 59 * 60_000_000,
      reason: "BackOff",
      note: "Back-off restarting failed container",
      ...extra,
    });
    const withEvents = (events: WarningEvent[], uid = "w-uid") =>
      buildInventory(
        results({
          P1: [ksm({ ...p, uid, phase: "Running" })],
          P11: [ksm({ ...p, uid, condition: "true" })],
        }),
        events,
      ).pods[0];

    it("attaches a Warning event on the current uid with its reason, count and time", () => {
      expect(withEvents([event({})]).warnings).toEqual([
        {
          key: "infra.k8s2.warnEvents",
          params: { reason: "BackOff", note: "Back-off restarting failed container", count: "3" },
          severity: "warning",
          lastSeen: END - 59 * 60_000_000,
        },
      ]);
    });

    it("labels an event warning with its reason, age and count", () => {
      const t = (key: string, params: Record<string, unknown>, plural?: number) =>
        `${key}|${params.reason}|${params.age}|${params.count}|${plural}`;
      expect(warningLabel(withEvents([event({})]).warnings[0], t as any, END)).toBe(
        "infra.k8s2.warnEvents|BackOff|59m|3|3",
      );
    });

    it("never attaches an event on a previous uid of the same name", () => {
      expect(withEvents([event({ uid: "old-uid" })]).warnings).toEqual([]);
    });

    it("attaches an event without a uid by namespace and name", () => {
      expect(keys(withEvents([event({ uid: "" })]))).toEqual(["infra.k8s2.warnEvents"]);
    });

    it("merges a uid-bearing and a uid-less group into one entry with the summed count", () => {
      const row = withEvents([
        event({ events: 2, lastSeen: END - 120_000_000, reason: "Old" }),
        event({ uid: "", events: 5, lastSeen: END - 60_000_000, reason: "BackOff" }),
      ]);
      expect(row.warnings).toHaveLength(1);
      expect(row.warnings[0].params).toMatchObject({ reason: "BackOff", count: "7" });
      expect(row.warnings[0].lastSeen).toBe(END - 60_000_000);
    });

    it("leaves an event for another cluster unattached", () => {
      expect(withEvents([event({ uid: "", cluster: "dev" })]).warnings).toEqual([]);
    });
  });
});

describe("pod status rules (Workloads overview)", () => {
  const p = pod("x");
  it.each([
    ["Running and Ready", { phase: "Running", ready: "true" }, "running"],
    ["Running not Ready", { phase: "Running", ready: "false" }, "pending"],
    ["Running without readiness", { phase: "Running" }, "unknown"],
    ["phase Unknown", { phase: "Unknown" }, "unknown"],
    ["Evicted", { phase: "Failed", reason: "Evicted" }, "evicted"],
    ["Failed", { phase: "Failed" }, "failed"],
    ["Succeeded", { phase: "Succeeded" }, "succeeded"],
    ["Pending", { phase: "Pending" }, "pending"],
  ] as const)("%s → %s", (_n, f: any, expected) => {
    const row = onlyPod({
      P1: [ksm({ ...p, phase: f.phase })],
      ...(f.ready ? { P11: [ksm({ ...p, condition: f.ready })] } : {}),
      P15: f.reason ? [ksm({ ...p, reason: f.reason })] : [],
    });
    expect(lensPodStatus(row)).toBe(expected);
  });

  it("needs Initialized True as well when the pod object was observed", () => {
    const row = onlyPod({
      P1: [ksm({ ...p, phase: "Running" })],
      P11: [ksm({ ...p, condition: "true" })],
    });
    row.object = {
      uid: "x-uid",
      metadata: {},
      spec: {},
      status: { conditions: [{ type: "Initialized", status: "False" }] },
    };
    expect(lensPodStatus(row)).toBe("pending");
    row.object.status.conditions[0].status = "True";
    expect(lensPodStatus(row)).toBe("running");
  });
});

describe("nodes", () => {
  const n1 = (node: string, condition: string, status: string) => ksm({ node, condition, status });

  it.each([
    ["true", "infra.k8s2.nodeReady", "success-soft"],
    ["false", "infra.k8s2.nodeNotReady", "error-soft"],
    ["unknown", "infra.k8s2.nodeUnknown", "amber-soft"],
  ])("Ready=%s is %s", (status, key, variant) => {
    const inventory = buildInventory(results({ N1: [n1("n1", "Ready", status)] }));
    expect(inventory.nodes[0].status).toEqual({ key, variant });
  });

  it("flags NotReady as an error, Unknown and pressure as warnings", () => {
    const inventory = buildInventory(
      results({
        N1: [
          n1("bad", "Ready", "false"),
          n1("unk", "Ready", "unknown"),
          n1("hot", "Ready", "true"),
          n1("hot", "MemoryPressure", "true"),
        ],
      }),
    );
    const byName = Object.fromEntries(inventory.nodes.map((n) => [n.name, n.warnings]));
    expect(byName.bad).toEqual([{ key: "infra.k8s2.warnNodeNotReady", severity: "error" }]);
    expect(byName.unk[0].severity).toBe("warning");
    expect(byName.hot).toEqual([
      {
        key: "infra.k8s2.warnCondition",
        params: { condition: "MemoryPressure" },
        severity: "warning",
      },
    ]);
  });

  it("divides CPU, memory and disk by allocatable and capacity, with null for a missing stream", () => {
    const fixture = {
      N1: [],
      N2: [
        ksm({ node: "n1", resource: "cpu" }, 4),
        ksm({ node: "n1", resource: "memory" }, 8 * GI),
      ],
      K3: [kub({ k8s_node_name: "n1" }, 1)],
      K4: [kub({ k8s_node_name: "n1" }, 2 * GI)],
      K5: [kub({ k8s_node_name: "n1" }, 30)],
      K6: [kub({ k8s_node_name: "n1" }, 120)],
    };
    expect(buildInventory(results(fixture)).nodes[0]).toMatchObject({
      name: "n1",
      status: null,
      cpuPct: 25,
      memoryPct: 25,
      diskPct: 25,
      clusterLabel: "k8s_cluster_name",
    });
    const { K6: _k6, ...noCapacity } = fixture;
    expect(buildInventory(results(noCapacity)).nodes[0].diskPct).toBeNull();
  });

  it("reads taints, kubelet info and age, and words the true conditions", () => {
    const node = buildInventory(
      results({
        N1: [
          n1("n1", "Ready", "true"),
          n1("n1", "MemoryPressure", "true"),
          n1("n1", "DiskPressure", "false"),
        ],
        N3: [ksm({ node: "n1", kubelet_version: "v1.29.0", internal_ip: "10.0.10.38" })],
        N4: [
          ksm({ node: "n1", key: "node.kubernetes.io/memory-pressure", effect: "NoSchedule" }),
          ksm({ node: "n1", key: "dedicated", value: "gpu", effect: "NoExecute" }),
        ],
        N5: [ksm({ node: "n1" }, 1_600_000_000)],
      }),
    ).nodes[0];
    expect(node.taints).toEqual([
      { key: "node.kubernetes.io/memory-pressure", value: "", effect: "NoSchedule" },
      { key: "dedicated", value: "gpu", effect: "NoExecute" },
    ]);
    expect(node.info?.kubelet_version).toBe("v1.29.0");
    expect(node.createdAt).toBe(1_600_000_000_000_000);
    expect(nodeConditionWords(node)).toEqual([
      { text: "Ready", variant: "success-soft" },
      { text: "MemoryPressure", variant: "warning-soft" },
    ]);
    node.unschedulable = true;
    expect(nodeConditionWords(node).at(-1)).toEqual({
      text: "SchedulingDisabled",
      variant: "warning-soft",
    });
  });

  it("lists a memory-only node with CPU blank", () => {
    const inventory = buildInventory(
      results({
        N2: [ksm({ node: "n1", resource: "memory" }, 8 * GI)],
        K4: [kub({ k8s_node_name: "n1" }, 4 * GI)],
      }),
    );
    expect(inventory.nodes[0]).toMatchObject({ memoryPct: 50, cpuPct: null });
  });
});

describe("workload kinds", () => {
  const ns = { namespace: "shop" };

  it("deployments: available/replicas, derived Available, and ⚠ when available < desired", () => {
    const dep = (desired: number, available: number) =>
      buildInventory(
        results({
          D1: [ksm({ ...ns, deployment: "web" }, desired)],
          D2: [ksm({ ...ns, deployment: "web" }, available)],
          D3: [ksm({ ...ns, deployment: "web" }, desired + 1)],
          D5: [ksm({ ...ns, deployment: "web" }, 1_000)],
        }),
      ).deployments[0];
    expect(dep(3, 3)).toMatchObject({
      available: 3,
      replicas: 4,
      createdAt: 1_000_000_000,
      conditions: [{ text: "Available", variant: "success-soft" }],
      conditionsDerived: true,
      warnings: [],
    });
    expect(dep(3, 1).conditions).toEqual([]);
    expect(dep(3, 1).warnings[0].severity).toBe("warning");
    expect(dep(3, 0).warnings[0].severity).toBe("error");
  });

  it("daemonsets: current scheduled and ⚠ when ready < desired", () => {
    const row = buildInventory(
      results({
        DS1: [ksm({ ...ns, daemonset: "fluent-bit" }, 4)],
        DS3: [ksm({ ...ns, daemonset: "fluent-bit" }, 4)],
        DS5: [ksm({ ...ns, daemonset: "fluent-bit" }, 3)],
      }),
    ).daemonsets[0];
    expect(row).toMatchObject({ desired: 4, current: 4, ready: 3, nodeSelector: null });
    expect(keys(row)).toEqual(["infra.k8s2.warnNotAllReady"]);
  });

  it("statefulsets: ready/current", () => {
    const row = buildInventory(
      results({
        SS1: [ksm({ ...ns, statefulset: "db" }, 3)],
        SS2: [ksm({ ...ns, statefulset: "db" }, 2)],
        SS3: [ksm({ ...ns, statefulset: "db" }, 3)],
      }),
    ).statefulsets[0];
    expect(row).toMatchObject({ replicas: 3, ready: 2, current: 3 });
    expect(row.warnings).toHaveLength(1);
  });

  it("replicasets: desired, current from status_replicas, ready, and an ownerless one is listed", () => {
    const inventory = buildInventory(
      results({
        RS2: [ksm({ ...ns, replicaset: "a" }, 2), ksm({ ...ns, replicaset: "lone" }, 1)],
        RS3: [ksm({ ...ns, replicaset: "a" }, 2)],
        RS4: [ksm({ ...ns, replicaset: "a" }, 1)],
        P5: [ksm({ ...ns, replicaset: "a", owner_kind: "Deployment", owner_name: "web" })],
      }),
    );
    const byName = Object.fromEntries(inventory.replicasets.map((r) => [r.name, r]));
    expect(byName.a).toMatchObject({
      desired: 2,
      current: 2,
      ready: 1,
      owner: { kind: "Deployment", name: "web" },
    });
    expect(byName.lone.owner).toBeNull();
  });

  it("jobs: membership from any status series, Failed reasons only above zero, Complete", () => {
    const inventory = buildInventory(
      results({
        J1: [ksm({ ...ns, job_name: "nightly" }, 0)],
        J2: [ksm({ ...ns, job_name: "nightly" }, 1)],
        J3: [
          ksm({ ...ns, job_name: "backfill", reason: "BackoffLimitExceeded" }, 1),
          ksm({ ...ns, job_name: "backfill", reason: "DeadlineExceeded" }, 0),
        ],
        J4: [ksm({ ...ns, job_name: "nightly" }, 1)],
        J5: [ksm({ ...ns, job_name: "nightly" }, 1)],
      }),
    );
    const byName = Object.fromEntries(inventory.jobs.map((r) => [r.name, r]));
    expect(byName.nightly).toMatchObject({
      succeeded: 1,
      completions: 1,
      complete: true,
      failed: 0,
    });
    expect(byName.backfill).toMatchObject({
      failed: 1,
      failedReasons: ["BackoffLimitExceeded"],
      complete: false,
    });
    expect(byName.backfill.warnings[0]).toMatchObject({
      key: "infra.k8s2.warnJobFailed",
      severity: "error",
    });
  });

  it("cronjobs: schedule, suspend, active, and last schedule from the newest owned job", () => {
    const inventory = buildInventory(
      results({
        CJ1: [ksm({ namespace: "data", cronjob: "nightly-report", schedule: "0 2 * * *" })],
        CJ2: [ksm({ namespace: "data", cronjob: "nightly-report" }, 0)],
        CJ3: [ksm({ namespace: "data", cronjob: "nightly-report" }, 0)],
        J6: [
          ksm({ namespace: "data", job_name: "nightly-report-1" }, 100),
          ksm({ namespace: "data", job_name: "nightly-report-2" }, 200),
        ],
        J7: [
          ksm({
            namespace: "data",
            job_name: "nightly-report-1",
            owner_kind: "CronJob",
            owner_name: "nightly-report",
          }),
          ksm({
            namespace: "data",
            job_name: "nightly-report-2",
            owner_kind: "CronJob",
            owner_name: "nightly-report",
          }),
        ],
      }),
    );
    expect(inventory.cronjobs[0]).toMatchObject({
      schedule: "0 2 * * *",
      suspend: false,
      active: 0,
      lastSchedule: 200_000_000,
      jobs: ["nightly-report-1", "nightly-report-2"],
    });
    expect(
      buildInventory(
        results({
          CJ1: inventory.cronjobs.length
            ? [ksm({ namespace: "data", cronjob: "x", schedule: "*" })]
            : [],
        }),
      ).cronjobs[0].lastSchedule,
    ).toBeNull();
  });

  it("pvcs: storage class, size, pods from K7 and phase warnings", () => {
    const inventory = buildInventory(
      results({
        V1: [
          ksm({ namespace: "data", persistentvolumeclaim: "data-postgres-0", phase: "Bound" }),
          ksm({ namespace: "data", persistentvolumeclaim: "lost", phase: "Lost" }),
        ],
        V2: [
          ksm({ namespace: "data", persistentvolumeclaim: "data-postgres-0", storageclass: "gp3" }),
        ],
        V3: [ksm({ namespace: "data", persistentvolumeclaim: "data-postgres-0" }, 10 * GI)],
        K7: [
          kub(
            {
              k8s_namespace_name: "data",
              k8s_pod_name: "postgres-0",
              k8s_persistentvolumeclaim_name: "data-postgres-0",
            },
            10 * GI,
          ),
        ],
      }),
    );
    const byName = Object.fromEntries(inventory.pvcs.map((r) => [r.name, r]));
    expect(byName["data-postgres-0"]).toMatchObject({
      phase: "Bound",
      storageClass: "gp3",
      size: 10 * GI,
      pods: ["postgres-0"],
      warnings: [],
    });
    expect(byName.lost.warnings[0].severity).toBe("error");
  });

  it("hpas: min, max, replicas, true conditions, target and ScalingLimited", () => {
    const row = buildInventory(
      results({
        H1: [ksm({ namespace: "media", horizontalpodautoscaler: "transcoding-service" }, 5)],
        H2: [ksm({ namespace: "media", horizontalpodautoscaler: "transcoding-service" }, 1)],
        H3: [ksm({ namespace: "media", horizontalpodautoscaler: "transcoding-service" }, 5)],
        H4: [
          ksm({
            namespace: "media",
            horizontalpodautoscaler: "transcoding-service",
            condition: "AbleToScale",
            status: "true",
          }),
          ksm({
            namespace: "media",
            horizontalpodautoscaler: "transcoding-service",
            condition: "ScalingLimited",
            status: "true",
          }),
          ksm({
            namespace: "media",
            horizontalpodautoscaler: "transcoding-service",
            condition: "ScalingActive",
            status: "false",
          }),
        ],
        H8: [
          ksm({
            namespace: "media",
            horizontalpodautoscaler: "transcoding-service",
            scaletargetref_kind: "Deployment",
            scaletargetref_name: "transcoding-service",
          }),
        ],
      }),
    ).hpas[0];
    expect(row).toMatchObject({
      min: 1,
      max: 5,
      current: 5,
      conditions: [
        { condition: "AbleToScale", status: "true" },
        { condition: "ScalingLimited", status: "true" },
      ],
      target: { kind: "Deployment", name: "transcoding-service" },
    });
    expect(keys(row)).toEqual(["infra.k8s2.warnScalingLimited"]);
  });

  it("namespaces: cluster-scoped rows with their phase", () => {
    const row = buildInventory(
      results({
        NS1: [ksm({ namespace: "data", phase: "Active" })],
        NS2: [ksm({ namespace: "data" }, 10)],
      }),
    ).namespaces[0];
    expect(row).toMatchObject({
      name: "data",
      namespace: "",
      phase: "Active",
      createdAt: 10_000_000,
    });
  });
});

describe("scope and sorting", () => {
  it("scopes by cluster and the namespace selection, never filtering nodes or namespaces by namespace", () => {
    const inventory = buildInventory(
      results({
        P1: [
          ksm({ ...pod("a"), phase: "Pending" }),
          ksm({ k8s_cluster: "dev", namespace: "data", pod: "b", uid: "b", phase: "Pending" }),
        ],
        N1: [ksm({ node: "n1", condition: "Ready", status: "true" })],
      }),
    );
    const scope = { cluster: "prod", namespaces: ["data"] };
    expect(inventory.pods.filter((r) => inScope(r, scope))).toEqual([]);
    expect(
      inventory.pods.filter((r) => inScope(r, { cluster: "dev", namespaces: ["data"] })),
    ).toHaveLength(1);
    expect(inventory.nodes.filter((r) => inScope(r, scope))).toHaveLength(1);
  });

  it("searches the name plus each kind's extra fields, case-insensitively", () => {
    const inventory = buildInventory(
      results({
        P1: [ksm({ ...pod("web"), phase: "Running" }), ksm({ ...pod("db"), phase: "Pending" })],
        P6: [ksm({ ...pod("web"), node: "ip-10-0-1-1", pod_ip: "10.1.2.3" })],
        P2: [ksm({ ...pod("db"), container: "c", reason: "CrashLoopBackOff" })],
        N1: [ksm({ node: "n1", condition: "MemoryPressure", status: "true" })],
        N3: [ksm({ node: "n1", kubelet_version: "v1.29.3" })],
        CJ1: [ksm({ namespace: "data", cronjob: "nightly", schedule: "0 2 * * *" })],
      }),
    );
    const scope = { cluster: null, namespaces: [] };
    const names = (rows: { name: string }[]) => rows.map((r) => r.name);
    expect(names(filterRows(inventory.pods, scope, "IP-10-0"))).toEqual(["web"]);
    expect(names(filterRows(inventory.pods, scope, "10.1.2"))).toEqual(["web"]);
    expect(names(filterRows(inventory.pods, scope, "crashloop"))).toEqual(["db"]);
    expect(names(filterRows(inventory.nodes, scope, "pressure"))).toEqual(["n1"]);
    expect(names(filterRows(inventory.nodes, scope, "v1.29"))).toEqual(["n1"]);
    expect(names(filterRows(inventory.cronjobs, scope, "0 2"))).toEqual(["nightly"]);
    expect(filterRows(inventory.pods, { cluster: null, namespaces: ["other"] }, "")).toEqual([]);
  });

  it("puts null values last in both directions", () => {
    const rows = [{ v: 2 }, { v: null }, { v: 1 }] as { v: number | null }[];
    expect(sortRows(rows, (r) => r.v, false).map((r) => r.v)).toEqual([1, 2, null]);
    expect(sortRows(rows, (r) => r.v, true).map((r) => r.v)).toEqual([2, 1, null]);
  });

  it("keeps PodRow sortable on the CPU % of request", () => {
    const rows = [{ cpuPctOfRequest: 80 }, { cpuPctOfRequest: 5 }] as PodRow[];
    expect(sortRows(rows, (r) => r.cpuPctOfRequest, false)[0].cpuPctOfRequest).toBe(5);
  });
});

describe("formatters", () => {
  it("prints cores in millicores below one core", () => {
    expect(formatCores(0.05)).toBe("50m");
    expect(formatCores(1.5)).toBe("1.50");
    expect(formatCores(null)).toBe("—");
  });

  it("rounds percentages and scales bytes", () => {
    expect(formatPct(4.6)).toBe("5%");
    expect(formatPct(null)).toBe("—");
    expect(formatBytes(1024 ** 3)).toBe("1.0GB");
  });

  it("formats ages kubectl-style", () => {
    expect(formatAge(59_000_000)).toBe("59s");
    expect(formatAge(45 * 60_000_000)).toBe("45m");
    expect(formatAge(3600_000_000)).toBe("1h");
    expect(formatAge(12 * 86400_000_000)).toBe("12d");
    expect(formatAge(null)).toBe("—");
  });

  it("tints usage bars with the Hosts thresholds", () => {
    expect(usageBarVariant(95)).toBe("danger");
    expect(usageBarVariant(75)).toBe("warning");
    expect(usageBarVariant(10)).toBe("default");
    expect(usageBarVariant(null)).toBe("default");
  });
});
