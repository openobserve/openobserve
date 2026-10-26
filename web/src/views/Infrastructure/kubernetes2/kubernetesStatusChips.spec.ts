import { describe, expect, it } from "vitest";
import { buildInventory, type PodRow, type Series } from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";
import { hasStatusChip, matchesStatusChip, statusChipsFor } from "./kubernetesStatusChips";

const pod = (phase: string, ready: string | null = "true") =>
  ({ kind: "pod", phase, ready, statusReason: null, object: null }) as any;

describe("statusChipsFor", () => {
  it("counts pod buckets with All first", () => {
    const rows = [
      pod("Running"),
      pod("Running"),
      pod("Pending", null),
      pod("Failed"),
      pod("Succeeded"),
    ];
    expect(statusChipsFor("pods", rows).map((c) => [c.id, c.count])).toEqual([
      ["all", 5],
      ["running", 2],
      ["pending", 1],
      ["failing", 1],
      ["completed", 1],
      ["unknown", 0],
    ]);
  });

  it("counts a running pod with an error waiting reason as failing, like the tree badge and overview", () => {
    const crash = {
      ...pod("Running", "false"),
      status: { text: "CrashLoopBackOff", variant: "error-soft" },
      containers: [{ name: "app", waitingReason: "CrashLoopBackOff" }],
    };
    const counts = statusChipsFor("pods", [pod("Running"), crash]);
    expect(counts.find((c) => c.id === "failing")?.count).toBe(1);
    expect(counts.find((c) => c.id === "pending")?.count).toBe(0);
    expect(matchesStatusChip("pods", crash, "failing")).toBe(true);
  });

  it("buckets events by type", () => {
    const rows = [{ type: "Warning" }, { type: "Normal" }, { type: "Normal" }];
    expect(statusChipsFor("events", rows).map((c) => [c.id, c.count])).toEqual([
      ["all", 3],
      ["warnings", 1],
      ["normal", 2],
    ]);
  });

  it("offers no chips on views without a status", () => {
    expect(statusChipsFor("namespaces", [])).toEqual([]);
    expect(statusChipsFor("cluster", [])).toEqual([]);
  });

  const countsOf = (view: any, rows: any[], pods: PodRow[] = []) =>
    statusChipsFor(view, rows, pods).map((c) => [c.id, c.count]);

  const controller = (kind: string, desired: number | null, ready = 0) => ({
    kind,
    cluster: "prod",
    namespace: "shop",
    name: `${kind}-${desired}-${ready}`,
    desired,
    replicas: desired,
    ready,
    available: ready,
  });

  it.each(["deployment", "daemonset", "statefulset", "replicaset"])(
    "buckets %s rows by workload status",
    (kind) => {
      const view = `${kind}s`;
      const rows = [
        controller(kind, 0),
        controller(kind, 1, 1),
        controller(kind, 2, 1),
        controller(kind, 3, 0),
        controller(kind, null),
      ];
      expect(countsOf(view, rows)).toEqual([
        ["all", 5],
        ["running", 2],
        ["pending", 1],
        ["failed", 1],
        ["unknown", 1],
      ]);
    },
  );

  it("derives controller and job status from the member pods", () => {
    const series = (metric: Record<string, string>, value = 1): Series => ({
      metric: { k8s_cluster: "prod", namespace: "shop", ...metric },
      value,
    });
    const owned = (pod: string, kind: string, name: string) =>
      series({
        pod,
        uid: `${pod}-uid`,
        owner_kind: kind,
        owner_name: name,
        owner_is_controller: "true",
      });
    const inventory = buildInventory(
      new Map<QueryId, Series[]>([
        [
          "P1",
          [
            series({ pod: "a", uid: "a-uid", phase: "Failed" }),
            series({ pod: "b", uid: "b-uid", phase: "Succeeded" }),
          ],
        ],
        ["P4", [owned("a", "ReplicaSet", "web"), owned("b", "Job", "backfill")]],
        ["RS2", [series({ replicaset: "web" }, 1)]],
        ["J1", [series({ job_name: "backfill" })]],
      ]),
    );
    expect(countsOf("replicasets", inventory.replicasets, inventory.pods)).toContainEqual([
      "failed",
      1,
    ]);
    expect(countsOf("jobs", inventory.jobs, inventory.pods)).toEqual([
      ["all", 1],
      ["running", 0],
      ["succeeded", 1],
      ["failed", 0],
    ]);
    expect(
      matchesStatusChip("replicasets", inventory.replicasets[0], "failed", inventory.pods),
    ).toBe(true);
    expect(
      matchesStatusChip("replicasets", inventory.replicasets[0], "running", inventory.pods),
    ).toBe(false);
  });

  it("buckets jobs by rule signals", () => {
    const job = (extra: object) => ({
      kind: "job",
      cluster: "prod",
      namespace: "shop",
      name: "j",
      ...extra,
    });
    const rows = [
      job({ complete: true }),
      job({ failed: 1 }),
      job({ active: 1 }),
      job({ active: 1 }),
    ];
    expect(countsOf("jobs", rows)).toEqual([
      ["all", 4],
      ["running", 2],
      ["succeeded", 1],
      ["failed", 1],
    ]);
  });

  it("buckets cronjobs by suspend flag", () => {
    const rows = [
      { kind: "cronjob", suspend: false },
      { kind: "cronjob", suspend: true },
      { kind: "cronjob", suspend: false },
    ];
    expect(countsOf("cronjobs", rows)).toEqual([
      ["all", 3],
      ["scheduled", 2],
      ["suspended", 1],
    ]);
  });

  it("buckets nodes by readiness and leaves unknown readiness out of both", () => {
    const rows = [
      { ready: "true" },
      { ready: "true" },
      { ready: "false" },
      { ready: "unknown" },
      { ready: null },
    ];
    expect(countsOf("nodes", rows)).toEqual([
      ["all", 5],
      ["ready", 2],
      ["notReady", 1],
    ]);
  });

  it("buckets pvcs by phase", () => {
    const rows = [
      { phase: "Bound" },
      { phase: "Bound" },
      { phase: "Pending" },
      { phase: "Lost" },
      { phase: null },
    ];
    expect(countsOf("pvcs", rows)).toEqual([
      ["all", 5],
      ["bound", 2],
      ["pending", 1],
      ["lost", 1],
    ]);
  });

  it("buckets hpas by the ScalingLimited condition", () => {
    const rows = [
      { conditions: [{ condition: "ScalingLimited", status: "true" }] },
      { conditions: [{ condition: "AbleToScale", status: "true" }] },
      { conditions: [] },
    ];
    expect(countsOf("hpas", rows)).toEqual([
      ["all", 3],
      ["scalingLimited", 1],
      ["healthy", 2],
    ]);
  });
});

describe("matchesStatusChip", () => {
  it("filters pods and passes everything for all", () => {
    expect(matchesStatusChip("pods", pod("Failed"), "failing")).toBe(true);
    expect(matchesStatusChip("pods", pod("Running"), "failing")).toBe(false);
    expect(matchesStatusChip("pods", pod("Running"), "all")).toBe(true);
  });

  it.each([
    ["nodes", { ready: "false" }, "notReady", true],
    ["nodes", { ready: "true" }, "notReady", false],
    ["pvcs", { phase: "Lost" }, "lost", true],
    ["pvcs", { phase: "Bound" }, "lost", false],
    ["hpas", { conditions: [{ condition: "ScalingLimited", status: "true" }] }, "healthy", false],
    ["cronjobs", { kind: "cronjob", suspend: true }, "suspended", true],
  ] as const)("filters %s rows for the %s chip", (view, row, id, expected) => {
    expect(matchesStatusChip(view, row, id as any)).toBe(expected);
  });

  it("passes everything through for a chip the view does not offer", () => {
    expect(matchesStatusChip("nodes", { ready: "true" }, "lost")).toBe(true);
  });
});

describe("hasStatusChip", () => {
  it("accepts only the chips a view offers", () => {
    expect(hasStatusChip("pods", "failing")).toBe(true);
    expect(hasStatusChip("pods", "lost")).toBe(false);
    expect(hasStatusChip("jobs", "failed")).toBe(true);
    expect(hasStatusChip("namespaces", "all")).toBe(false);
  });
});

describe("controller chips without member pods", () => {
  const dep = (over: object) =>
    ({
      kind: "deployment",
      cluster: "c",
      namespace: "n",
      name: "d",
      desired: 3,
      available: 3,
      ...over,
    }) as any;

  it("classify from the object's own replica counts", () => {
    const rows = [
      dep({ available: 3 }),
      dep({ available: 1 }),
      dep({ available: 0 }),
      dep({ desired: 0, available: 0 }),
    ];
    const counts = statusChipsFor("deployments", rows, []);
    const countOf = (id: string) => counts.find((c) => c.id === id)?.count;
    expect(countOf("running")).toBe(2);
    expect(countOf("pending")).toBe(1);
    expect(countOf("failed")).toBe(1);
  });

  it("filter with the same rule", () => {
    expect(matchesStatusChip("deployments", dep({ available: 1 }), "pending", [])).toBe(true);
    expect(matchesStatusChip("deployments", dep({ available: 3 }), "running", [])).toBe(true);
    expect(matchesStatusChip("deployments", dep({ available: 3 }), "pending", [])).toBe(false);
  });
});
