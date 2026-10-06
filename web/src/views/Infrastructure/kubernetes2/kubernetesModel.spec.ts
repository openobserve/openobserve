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
  issueCounts,
  parseVector,
  sortRows,
  type PodRow,
  type Series,
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

const allIssuesVisible = () => true;

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
      expect(row.owner).toEqual({ kind: "Deployment", name: "db" });
      expect(row.memoryLimit).toBe(1 * GI);
      expect(row.memoryBytes).toBe(100 * MI);
      expect(row.usage).toEqual({ clusterLabel: "k8s_cluster_name", uid: "B" });
    });

    it("joins a usage series without k8s_pod_uid by name and namespace", () => {
      const row = onlyPod(
        fixture({ K2: [kub({ k8s_namespace_name: "data", k8s_pod_name: "db-0" }, 42)] }),
      );
      expect(row.memoryBytes).toBe(42);
      expect(row.usage?.uid).toBeNull();
    });

    it("marks the pod ambiguous when several uids exist and P12 is unavailable", () => {
      const data = fixture();
      delete data.P12;
      const inventory = buildInventory(results(data));
      const row = inventory.pods[0];
      expect(row.ambiguous).toBe(true);
      expect(row.status).toBeNull();
      expect(row.uid).toBeNull();
      expect(row.owner).toBeNull();
      expect(row.memoryLimit).toBeNull();
      expect(row.issues).toEqual([]);
      const counts = issueCounts(inventory, { cluster: null, namespace: null }, allIssuesVisible);
      expect(counts.podsNotRunning).toBe(0);
    });
  });

  describe("status precedence", () => {
    it("a container waiting on CrashLoopBackOff outranks a Running phase", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("rec"), phase: "Running" })],
        P2: [ksm({ ...pod("rec"), container: "main", reason: "CrashLoopBackOff" })],
      });
      expect(row.status).toEqual({ text: "CrashLoopBackOff", variant: "error-soft" });
      expect(row.issues).toContain("podsContainerErrors");
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
      expect(before.issues).toContain("podsContainerErrors");
      const after = onlyPod({ P1: [ksm({ ...pod("rec"), phase: "Running" })], P2: [] });
      expect(after.issues).not.toContain("podsContainerErrors");
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
      expect(row.status).toEqual({ text: "Running · NotReady", variant: "warning-soft" });
      expect(row.issues).toContain("podsNotRunning");
    });

    it("Running with no ready series is neutral and not counted", () => {
      const row = onlyPod(running());
      expect(row.status).toEqual({ text: "Running", variant: "default-soft" });
      expect(row.issues).not.toContain("podsNotRunning");
    });

    it("a waiting reason outside the error set is a warning", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("o"), phase: "Pending" })],
        P2: [ksm({ ...pod("o"), container: "main", reason: "ContainerCreating" })],
      });
      expect(row.status).toEqual({ text: "ContainerCreating", variant: "warning-soft" });
      expect(row.issues).not.toContain("podsContainerErrors");
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
      expect(row.issues).not.toContain("podsNearMemoryLimit");
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
      expect(row.issues).toContain("podsNearMemoryLimit");
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

  it("sums per-container restarts and rounds the pod total", () => {
    const row = onlyPod({
      P1: [ksm({ ...pod("r"), phase: "Running" })],
      P7: [ksm({ ...pod("r"), container: "a" }, 0.6), ksm({ ...pod("r"), container: "b" }, 1.3)],
    });
    expect(row.restarts).toBe(2);
    expect(row.issues).toContain("podsRestarting");
  });

  describe("OOMKilled per container", () => {
    const base = (restartsA: number, restartsB: number) => ({
      P1: [ksm({ ...pod("an"), phase: "Running" })],
      P3: [ksm({ ...pod("an"), container: "a", reason: "OOMKilled" })],
      P7: [
        ksm({ ...pod("an"), container: "a" }, restartsA),
        ksm({ ...pod("an"), container: "b" }, restartsB),
      ],
    });

    it("an old OOM in one container with a restart in another does not count", () => {
      const row = onlyPod(base(0, 2));
      expect(row.issues).not.toContain("podsOomKilled");
      expect(row.lastTerminatedReason).toBe("OOMKilled");
    });

    it("an OOM with a restart of the same container counts", () => {
      expect(onlyPod(base(1, 0)).issues).toContain("podsOomKilled");
    });
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
            ksm({ ...pod("web-b"), owner_kind: "ReplicaSet", owner_name: "web-rs" }),
          ],
          P5: [
            ksm({
              namespace: "shop",
              replicaset: "web-rs",
              owner_kind: "Deployment",
              owner_name: "web",
            }),
          ],
          D1: [ksm({ namespace: "shop", deployment: "web" }, 2)],
          D2: [ksm({ namespace: "shop", deployment: "web" }, 2)],
        }),
      );
      expect(inventory.pods.map((p) => p.owner)).toEqual([
        { kind: "Deployment", name: "web" },
        { kind: "Deployment", name: "web" },
      ]);
      expect(inventory.deployments[0].pods).toBe(2);
    });

    it("keeps a Job owner as it is", () => {
      const row = onlyPod({
        P1: [ksm({ ...pod("backfill"), phase: "Failed" })],
        P4: [ksm({ ...pod("backfill"), owner_kind: "Job", owner_name: "backfill" })],
        P5: [],
      });
      expect(row.owner).toEqual({ kind: "Job", name: "backfill" });
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
      expect(inventory.pods[0].issues).toEqual([]);
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
      expect(row.usage?.clusterLabel).toBe("k8s_cluster");
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

describe("buildInventory — nodes", () => {
  const n1 = (node: string, condition: string, status: string) => ksm({ node, condition, status });

  it.each([
    ["true", "Ready", "success-soft"],
    ["false", "NotReady", "error-soft"],
    ["unknown", "Unknown", "amber-soft"],
  ])("Ready=%s is %s", (status, text, variant) => {
    const inventory = buildInventory(results({ N1: [n1("n1", "Ready", status)] }));
    expect(inventory.nodes[0].status).toEqual({ text, variant });
  });

  it("counts NotReady and Unknown only, and pressure separately", () => {
    const inventory = buildInventory(
      results({
        N1: [
          n1("ok", "Ready", "true"),
          n1("bad", "Ready", "false"),
          n1("unk", "Ready", "unknown"),
          n1("hot", "Ready", "true"),
          n1("hot", "MemoryPressure", "true"),
          n1("ok", "DiskPressure", "false"),
        ],
      }),
    );
    const counts = issueCounts(inventory, { cluster: null, namespace: null }, allIssuesVisible);
    expect(counts.nodesNotReady).toBe(2);
    expect(counts.nodesPressure).toBe(1);
    expect(inventory.nodes.find((n) => n.name === "hot")?.pressures).toEqual(["MemoryPressure"]);
  });

  it("has a null status without an N1 series and divides usage by allocatable", () => {
    const inventory = buildInventory(
      results({
        N1: [],
        N2: [
          ksm({ node: "n1", resource: "cpu" }, 4),
          ksm({ node: "n1", resource: "memory" }, 8 * GI),
        ],
        K3: [kub({ k8s_node_name: "n1" }, 1)],
        K4: [kub({ k8s_node_name: "n1" }, 2 * GI)],
      }),
    );
    expect(inventory.nodes[0]).toMatchObject({
      name: "n1",
      cluster: "prod",
      status: null,
      cpuPct: 25,
      memoryPct: 25,
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

  it("counts current-uid pods per node", () => {
    const inventory = buildInventory(
      results({
        N1: [n1("n1", "Ready", "true")],
        P1: [ksm({ ...pod("a"), phase: "Running" }), ksm({ ...pod("b"), phase: "Running" })],
        P6: [ksm({ ...pod("a"), node: "n1" }), ksm({ ...pod("b"), node: "n2" })],
      }),
    );
    expect(inventory.nodes.find((n) => n.name === "n1")?.pods).toBe(1);
  });
});

describe("buildInventory — deployments", () => {
  const dep = (
    desired: number,
    available?: number,
    extra: Partial<Record<QueryId, Series[]>> = {},
  ) =>
    buildInventory(
      results({
        D1: [ksm({ namespace: "shop", deployment: "web" }, desired)],
        D2: available == null ? [] : [ksm({ namespace: "shop", deployment: "web" }, available)],
        ...extra,
      }),
    ).deployments[0];

  it.each([
    [3, 3, "Available", "success-soft"],
    [3, 4, "Available", "success-soft"],
    [3, 1, "Degraded", "warning-soft"],
    [3, 0, "Unavailable", "error-soft"],
    [0, 0, "ScaledToZero", "default-soft"],
  ])("desired %i available %i is %s", (desired, available, state, variant) => {
    expect(dep(desired, available).status).toEqual({ state, variant });
  });

  it("ready but not yet available is Degraded, because availability is the source", () => {
    // kube_deployment_status_replicas_ready is not queried at all; a ready-3 fixture cannot leak in.
    expect(dep(3, 1).status?.state).toBe("Degraded");
    expect(dep(3, 1).issues).toEqual(["deploymentsUnavailable"]);
  });

  it("has a null status and no issue without a D2 series", () => {
    const row = dep(3);
    expect(row.status).toBeNull();
    expect(row.issues).toEqual([]);
  });
});

describe("issue counts, filtering and sorting", () => {
  const twoClusters = () =>
    buildInventory(
      results({
        P1: [
          ksm({ ...pod("a"), phase: "Pending" }),
          ksm({ k8s_cluster: "dev", namespace: "data", pod: "b", uid: "b", phase: "Pending" }),
        ],
        N1: [
          ksm({ node: "n1", condition: "Ready", status: "false" }),
          ksm({ k8s_cluster: "dev", node: "n1", condition: "Ready", status: "false" }),
        ],
        P6: [
          ksm({ ...pod("a"), node: "n1" }),
          ksm({ k8s_cluster: "dev", namespace: "data", pod: "b", uid: "b", node: "n1" }),
        ],
      }),
    );

  it("applies only the scope facets, and namespace never touches node tiles", () => {
    const inventory = twoClusters();
    expect(
      issueCounts(inventory, { cluster: "prod", namespace: null }, allIssuesVisible),
    ).toMatchObject({
      podsNotRunning: 1,
      nodesNotReady: 1,
    });
    expect(
      issueCounts(inventory, { cluster: null, namespace: "shop" }, allIssuesVisible),
    ).toMatchObject({
      podsNotRunning: 1,
      nodesNotReady: 2,
    });
  });

  it("reports a hidden tile as null", () => {
    const counts = issueCounts(
      twoClusters(),
      { cluster: null, namespace: null },
      (key) => key !== "podsOomKilled",
    );
    expect(counts.podsOomKilled).toBeNull();
    expect(counts.podsNotRunning).toBe(2);
  });

  it("filters pods by onNode and workload within one cluster", () => {
    const inventory = twoClusters();
    const base = {
      scope: { cluster: null, namespace: null },
      issue: null,
      name: "",
      onNode: null,
      workload: null,
    };
    expect(
      filterRows("pods", inventory.pods, { ...base, onNode: ["dev", "n1"] }).map((p) => p.name),
    ).toEqual(["b"]);
    expect(filterRows("pods", inventory.pods, { ...base, name: "A" }).map((p) => p.name)).toEqual([
      "a",
    ]);
    expect(
      filterRows("nodes", inventory.nodes, {
        ...base,
        scope: { cluster: "dev", namespace: "shop" },
      }),
    ).toHaveLength(1);
  });

  it("puts null values last in both directions", () => {
    const rows = [{ v: 2 }, { v: null }, { v: 1 }] as { v: number | null }[];
    expect(sortRows(rows, (r) => r.v, false).map((r) => r.v)).toEqual([1, 2, null]);
    expect(sortRows(rows, (r) => r.v, true).map((r) => r.v)).toEqual([2, 1, null]);
  });

  it("filters a list to exactly the rows a tile counted", () => {
    const inventory = twoClusters();
    const scope = { cluster: "prod", namespace: null };
    const listed = filterRows("pods", inventory.pods, {
      scope,
      issue: "podsNotRunning",
      name: "",
      onNode: null,
      workload: null,
    });
    expect(listed).toHaveLength(
      issueCounts(inventory, scope, allIssuesVisible).podsNotRunning as number,
    );
  });

  it("keeps PodRow sortable on the CPU % of request", () => {
    const rows = [{ cpuPctOfRequest: 80 }, { cpuPctOfRequest: 5 }] as PodRow[];
    expect(sortRows(rows, (r) => r.cpuPctOfRequest, false)[0].cpuPctOfRequest).toBe(5);
  });
});
