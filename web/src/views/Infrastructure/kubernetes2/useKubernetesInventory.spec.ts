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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import searchService from "@/services/search";
import { useKubernetesInventory } from "./useKubernetesInventory";
import { QUERY_STREAM, type QueryId } from "./kubernetesQueries";
import { parseListState, type K8sListState } from "./kubernetesUrlState";

const getStreams = vi.fn();

vi.mock("@/services/search", () => ({ default: { metrics_query: vi.fn() } }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams }) }));

const metricsQuery = vi.mocked(searchService.metrics_query);

const START = 1_700_000_000_000_000;
const END = START + 3_600_000_000;

const ALL_STREAMS = Object.values(QUERY_STREAM);
const KUBELET = ALL_STREAMS.filter((s) => s.startsWith("k8s_"));
const KSM = ALL_STREAMS.filter((s) => s.startsWith("kube_"));

type Fixture = Partial<Record<QueryId, Array<{ metric: Record<string, string>; value: number }>>>;

const idOf = (query: string): QueryId => {
  const decoded = decodeURIComponent(query);
  const id = (Object.keys(QUERY_STREAM) as QueryId[]).find((q) =>
    new RegExp(`\\b${QUERY_STREAM[q]}\\b`).test(decoded),
  );
  if (!id) throw new Error(`unknown query ${decoded}`);
  return id;
};

const vector = (rows: Array<{ metric: Record<string, string>; value: number }> = []) => ({
  data: { data: { result: rows.map((r) => ({ metric: r.metric, value: [1, String(r.value)] })) } },
});

const respond = (fixture: Fixture, reject: QueryId[] = []) =>
  metricsQuery.mockImplementation((({ query }: { query: string }) => {
    const id = idOf(query);
    if (reject.includes(id)) return Promise.reject(new Error(`boom ${id}`));
    return Promise.resolve(vector(fixture[id]));
  }) as any);

const sentIds = () => metricsQuery.mock.calls.map(([args]: any[]) => idOf(args.query)).sort();

const ksm = (metric: Record<string, string>, value = 1) => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const setup = async (streams: string[], query: Record<string, string> = {}) => {
  getStreams.mockResolvedValue({ list: streams.map((name) => ({ name })) });
  const state = ref<K8sListState>(parseListState(query));
  const inventory = useKubernetesInventory(() => state.value);
  await inventory.loadStreams();
  return { inventory, state };
};

const refresh = (inventory: ReturnType<typeof useKubernetesInventory>, kind = "pods" as const) =>
  inventory.refresh({ orgId: "org1", start: START, end: END, kind });

describe("useKubernetesInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respond({});
  });

  describe("detection", () => {
    it("is unknown before the stream list resolves", () => {
      const inventory = useKubernetesInventory(() => parseListState({}));
      expect(inventory.detection.value).toBe("unknown");
    });

    it("is an error when listing streams rejects, and Retry forces a refetch", async () => {
      getStreams.mockRejectedValueOnce(new Error("down"));
      const inventory = useKubernetesInventory(() => parseListState({}));
      await inventory.loadStreams();
      expect(inventory.detection.value).toBe("error");
      getStreams.mockResolvedValueOnce({ list: [{ name: "kube_pod_status_phase" }] });
      await inventory.loadStreams({ force: true });
      expect(getStreams).toHaveBeenLastCalledWith("metrics", false, false, true);
      expect(inventory.detection.value).toBe("detected");
    });

    it("is undetected without any of the seven streams", async () => {
      const { inventory } = await setup(["kube_pod_owner", "system_cpu_time"]);
      expect(inventory.detection.value).toBe("undetected");
    });

    it("ignores a stream list that resolves after a newer request started", async () => {
      let releaseOld: (v: any) => void = () => {};
      getStreams.mockReturnValueOnce(new Promise((resolve) => (releaseOld = resolve)));
      getStreams.mockResolvedValueOnce({ list: [] });
      const inventory = useKubernetesInventory(() => parseListState({}));
      const old = inventory.loadStreams();
      await inventory.loadStreams({ force: true });
      releaseOld({ list: [{ name: "kube_pod_status_phase" }] });
      await old;
      expect(inventory.detection.value).toBe("undetected");
    });

    it("reset forgets the org's streams, results and errors and drops an in-flight refresh", async () => {
      respond({ P1: [ksm({ namespace: "shop", pod: "web", uid: "u", phase: "Running" })] });
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.loaded.value).toBe(true);
      const inFlight = refresh(inventory);
      inventory.reset();
      await inFlight;
      expect(inventory.detection.value).toBe("unknown");
      expect(inventory.inventory.value.pods).toEqual([]);
      expect(inventory.pageError.value).toBeNull();
      expect(inventory.banners.value).toEqual([]);
      expect(inventory.loaded.value).toBe(false);
    });

    it("detects a KSM-only org from the pod anchor alone", async () => {
      const { inventory } = await setup(["kube_pod_status_phase"]);
      expect(inventory.detection.value).toBe("detected");
    });
  });

  describe("fan-out", () => {
    it("sends every instant query encoded, at the picker END in µs", async () => {
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(metricsQuery).toHaveBeenCalled();
      for (const [args] of metricsQuery.mock.calls as any[]) {
        expect(args.org_identifier).toBe("org1");
        expect(args.end_time).toBe(END);
        expect(args.query).toBe(encodeURIComponent(decodeURIComponent(args.query)));
        expect(args.query).not.toContain(" ");
      }
      const restarts = (metricsQuery.mock.calls as any[]).find(
        ([args]) => idOf(args.query) === "P7",
      );
      expect(decodeURIComponent(restarts[0].query)).toContain("[3600s]");
    });

    it.each([
      ["pods", ["P4", "P5", "P6", "P8", "K1"]],
      ["nodes", ["P6", "N2", "K3", "K4"]],
      ["deployments", ["P4", "P5"]],
    ] as const)("on %s sends the 12 always-fetched queries plus %j", async (kind, extra) => {
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory, kind as any);
      const always = ["P1", "P2", "P3", "P7", "P9", "P10", "P11", "P12", "K2", "N1", "D1", "D2"];
      expect(sentIds()).toEqual([...always, ...extra].sort());
    });

    it("sends no kubeletstats query when only kube_* streams exist", async () => {
      const { inventory } = await setup(KSM);
      await refresh(inventory, "nodes");
      expect(sentIds().some((id) => id.startsWith("K"))).toBe(false);
      expect(sentIds()).toContain("N2");
    });

    it("sends no KSM query when only k8s_* streams exist", async () => {
      const { inventory } = await setup(KUBELET);
      await refresh(inventory);
      expect(sentIds()).toEqual(["K1", "K2"]);
    });

    it("gates a KSM family on its anchor, not on its own stream", async () => {
      const { inventory } = await setup(KSM.filter((s) => s !== "kube_deployment_spec_replicas"));
      await refresh(inventory, "deployments");
      expect(sentIds()).not.toContain("D1");
      expect(sentIds()).not.toContain("D2");
      expect(inventory.banners.value.map((b) => b.id)).toContain("anchor-deployments");
      const anchor = inventory.banners.value.find((b) => b.id === "anchor-deployments");
      expect(anchor?.kind).toBe("deployments");
      expect(anchor?.params).toEqual({ stream: "kube_deployment_spec_replicas" });
    });
  });

  describe("sparse and optional streams", () => {
    const streams = ALL_STREAMS.filter(
      (s) =>
        ![
          "kube_pod_container_status_waiting_reason",
          "kube_pod_container_status_last_terminated_reason",
          "kube_pod_container_resource_limits",
        ].includes(s),
    );

    it("treats absent sparse streams as empty and hides the OOM tile behind its explainer", async () => {
      respond({
        P1: [ksm({ namespace: "shop", pod: "web", uid: "u", phase: "Running" })],
        P10: [ksm({ namespace: "shop", pod: "web", uid: "u", container: "main" })],
      });
      const { inventory } = await setup(streams);
      await refresh(inventory);
      expect(sentIds()).not.toContain("P2");
      expect(sentIds()).not.toContain("P3");
      expect(sentIds()).not.toContain("P9");
      expect(inventory.counts.value.podsContainerErrors).toBe(0);
      expect(inventory.counts.value.podsOomKilled).toBeNull();
      expect(inventory.inventory.value.pods[0].memoryLimit).toBe("missing");
      const ids = inventory.banners.value.map((b) => b.id);
      expect(ids).toEqual(["oom-stream"]);
    });
  });

  describe("single-stream usage", () => {
    const usage = {
      K1: [
        {
          metric: { k8s_cluster_name: "prod", k8s_namespace_name: "shop", k8s_pod_name: "a" },
          value: 0.5,
        },
      ],
      K2: [
        {
          metric: { k8s_cluster_name: "prod", k8s_namespace_name: "shop", k8s_pod_name: "a" },
          value: 9,
        },
      ],
      K4: [{ metric: { k8s_cluster_name: "prod", k8s_node_name: "n1" }, value: 2 }],
    };

    it("lists pods with CPU and a memory banner when only the CPU stream exists", async () => {
      respond(usage);
      const { inventory } = await setup(["k8s_pod_cpu_usage"]);
      await refresh(inventory);
      const pod = inventory.inventory.value.pods[0];
      expect(pod.cpuCores).toBe(0.5);
      expect(pod.memoryBytes).toBeNull();
      const banner = inventory.banners.value.find((b) => b.id === "usage-K2");
      expect(banner?.params).toEqual({ stream: "k8s_pod_memory_working_set" });
      expect(inventory.counts.value.podsNearMemoryLimit).toBeNull();
    });

    it("lists pods with memory and CPU blank when only the memory stream exists", async () => {
      respond(usage);
      const { inventory } = await setup(["k8s_pod_memory_working_set"]);
      await refresh(inventory);
      const pod = inventory.inventory.value.pods[0];
      expect(pod.memoryBytes).toBe(9);
      expect(pod.cpuCores).toBeNull();
    });

    it("lists a memory-only node with CPU blank", async () => {
      respond(usage);
      const { inventory } = await setup(["k8s_node_memory_working_set"]);
      await refresh(inventory, "nodes");
      expect(inventory.inventory.value.nodes).toHaveLength(1);
      expect(inventory.inventory.value.nodes[0].cpuPct).toBeNull();
    });
  });

  describe("degradation", () => {
    it("hides the not-running tile without readiness, absent or failed", async () => {
      const pending = { P1: [ksm({ namespace: "shop", pod: "web", uid: "u", phase: "Pending" })] };
      respond(pending);
      const absent = await setup(ALL_STREAMS.filter((s) => s !== "kube_pod_status_ready"));
      await refresh(absent.inventory);
      expect(absent.inventory.counts.value.podsNotRunning).toBeNull();
      respond(pending, ["P11"]);
      const failing = await setup(ALL_STREAMS);
      await refresh(failing.inventory);
      expect(failing.inventory.counts.value.podsNotRunning).toBeNull();
      respond(pending);
      const healthy = await setup(ALL_STREAMS);
      await refresh(healthy.inventory);
      expect(healthy.inventory.counts.value.podsNotRunning).toBe(1);
    });

    it("hides every pod tile without the pod anchor", async () => {
      const { inventory } = await setup(KUBELET);
      await refresh(inventory);
      for (const key of [
        "podsNotRunning",
        "podsContainerErrors",
        "podsOomKilled",
        "podsRestarting",
        "podsNearMemoryLimit",
      ] as const) {
        expect(inventory.counts.value[key], key).toBeNull();
      }
      expect(inventory.banners.value.map((b) => b.id)).toContain("anchor-pods");
    });

    it("blanks only a rejected query's columns and explains it", async () => {
      respond(
        {
          P1: [ksm({ namespace: "shop", pod: "web", uid: "u", phase: "Running" })],
          P7: [ksm({ namespace: "shop", pod: "web", uid: "u", container: "c" }, 2)],
        },
        ["P6"],
      );
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory);
      const pod = inventory.inventory.value.pods[0];
      expect(pod.node).toBeNull();
      expect(pod.restarts).toBe(2);
      expect(inventory.pageError.value).toBeNull();
      expect(inventory.banners.value.map((b) => b.id)).toContain("partial-failure");
    });

    it("shows one page error when every query is rejected", async () => {
      metricsQuery.mockRejectedValue(new Error("all down"));
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.pageError.value).toBe("all down");
    });

    it("says unlabelled rows are hidden while a single cluster is in scope", async () => {
      respond({
        P1: [
          ksm({ namespace: "shop", pod: "web", uid: "u", phase: "Running" }),
          ksm({ k8s_cluster: "alpha", namespace: "shop", pod: "a", uid: "a", phase: "Running" }),
        ],
        K2: [{ metric: { k8s_namespace_name: "shop", k8s_pod_name: "web" }, value: 1 }],
      });
      const { inventory, state } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.banners.value.find((b) => b.id === "no-cluster-kubeletstats")?.key).toBe(
        "infra.k8s2.noClusterLabelScoped",
      );
      state.value = parseListState({ cluster: "*" });
      expect(inventory.banners.value.find((b) => b.id === "no-cluster-kubeletstats")?.key).toBe(
        "infra.k8s2.noClusterLabel",
      );
    });

    it("warns when one family has no cluster label next to a labelled one", async () => {
      respond({
        P1: [ksm({ namespace: "shop", pod: "web", uid: "u", phase: "Running" })],
        K2: [{ metric: { k8s_namespace_name: "shop", k8s_pod_name: "web" }, value: 1 }],
      });
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory);
      const banner = inventory.banners.value.find((b) => b.id === "no-cluster-kubeletstats");
      expect(banner?.params).toEqual({ family: "kubeletstats" });
      expect(inventory.inventory.value.pods).toHaveLength(2);
    });
  });

  it("discards a response from an older refresh that lands after a newer one started", async () => {
    let releaseOld: () => void = () => {};
    const gate = new Promise<void>((resolve) => (releaseOld = resolve));
    let call = 0;
    metricsQuery.mockImplementation((async ({ query }: { query: string }) => {
      const first = call++ < 2;
      if (first) await gate;
      const phase = first ? "Failed" : "Running";
      return idOf(query) === "P1"
        ? vector([ksm({ namespace: "shop", pod: "web", uid: "u", phase })])
        : vector([]);
    }) as any);
    const { inventory } = await setup(["kube_pod_status_phase", "kube_pod_status_ready"]);
    const old = refresh(inventory);
    await refresh(inventory);
    releaseOld();
    await old;
    expect(inventory.inventory.value.pods[0].phase).toBe("Running");
  });

  describe("scope, list and facets", () => {
    const twoClusters = {
      P1: [
        ksm({ namespace: "shop", pod: "a", uid: "a", phase: "Pending" }),
        ksm({ k8s_cluster: "beta", namespace: "shop", pod: "b", uid: "b", phase: "Running" }),
        ksm({ k8s_cluster: "beta", namespace: "data", pod: "c", uid: "c", phase: "Failed" }),
      ],
    };

    it("defaults to the alphabetically first of several clusters", async () => {
      respond(twoClusters);
      const { inventory, state } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.clusters.value).toEqual(["beta", "prod"]);
      expect(inventory.effectiveCluster.value).toBe("beta");
      expect(inventory.rows.value.map((r) => r.name).sort()).toEqual(["b", "c"]);
      state.value = parseListState({ cluster: "*" });
      expect(inventory.effectiveCluster.value).toBeNull();
      expect(inventory.rows.value).toHaveLength(3);
    });

    it("applies no default with a single cluster and names it in the scope", async () => {
      respond({ P1: [ksm({ namespace: "shop", pod: "a", uid: "a", phase: "Running" })] });
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.effectiveCluster.value).toBe("prod");
      expect(inventory.rows.value).toHaveLength(1);
    });

    it("leaves unlabelled rows out when the lone labelled cluster is the scope", async () => {
      respond({
        P1: [ksm({ namespace: "shop", pod: "web", uid: "u", phase: "Running" })],
        K2: [{ metric: { k8s_namespace_name: "shop", k8s_pod_name: "orphan" }, value: 1 }],
      });
      const { inventory, state } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.effectiveCluster.value).toBe("prod");
      expect(inventory.rows.value.map((r) => r.name)).toEqual(["web"]);
      expect(inventory.banners.value.find((b) => b.id === "no-cluster-kubeletstats")?.key).toBe(
        "infra.k8s2.noClusterLabelScoped",
      );
      state.value = parseListState({ cluster: "*" });
      expect(inventory.rows.value.map((r) => r.name).sort()).toEqual(["orphan", "web"]);
    });

    it("counts tiles over the scope facets only", async () => {
      respond(twoClusters);
      const { inventory, state } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.counts.value.podsNotRunning).toBe(1);
      state.value = parseListState({ cluster: "*", namespace: "shop" });
      expect(inventory.counts.value.podsNotRunning).toBe(1);
      state.value = parseListState({ cluster: "*" });
      expect(inventory.counts.value.podsNotRunning).toBe(2);
      state.value = parseListState({ cluster: "*", name: "zzz", issue: "podsNotRunning" });
      expect(inventory.counts.value.podsNotRunning).toBe(2);
      expect(inventory.rows.value).toHaveLength(0);
    });

    it("counts the All facet rows", async () => {
      respond(twoClusters);
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.clusterTotal.value).toBe(3);
      expect(inventory.namespaceTotal.value).toBe(2);
    });

    it("lists namespace facets for the scoped cluster with counts", async () => {
      respond(twoClusters);
      const { inventory } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.namespaceFacet.value).toEqual([
        { value: "data", count: 1 },
        { value: "shop", count: 1 },
      ]);
      expect(inventory.clusterFacet.value).toEqual([
        { value: "beta", count: 2 },
        { value: "prod", count: 1 },
      ]);
    });

    it("pages 50 rows at a time and never strands the pager", async () => {
      respond({
        P1: Array.from({ length: 60 }, (_, i) =>
          ksm({
            namespace: "shop",
            pod: `p${String(i).padStart(2, "0")}`,
            uid: `${i}`,
            phase: "Running",
          }),
        ),
      });
      const { inventory, state } = await setup(ALL_STREAMS);
      await refresh(inventory);
      expect(inventory.pagedRows.value).toHaveLength(50);
      state.value = parseListState({ page: "2" });
      expect(inventory.pagedRows.value).toHaveLength(10);
      state.value = parseListState({ page: "9" });
      expect(inventory.pagedRows.value).toHaveLength(10);
    });

    it("sorts by the CPU % of request with nulls last", async () => {
      respond({
        P1: [
          ksm({ namespace: "shop", pod: "idle", uid: "1", phase: "Running" }),
          ksm({ namespace: "shop", pod: "busy", uid: "2", phase: "Running" }),
          ksm({ namespace: "shop", pod: "none", uid: "3", phase: "Running" }),
        ],
        P10: ["idle", "busy", "none"].map((pod, i) =>
          ksm({ namespace: "shop", pod, uid: `${i + 1}`, container: "c" }),
        ),
        P8: [
          ksm({ namespace: "shop", pod: "idle", uid: "1", container: "c", resource: "cpu" }, 1),
          ksm({ namespace: "shop", pod: "busy", uid: "2", container: "c", resource: "cpu" }, 1),
        ],
        K1: ["idle", "busy", "none"].map((pod, i) => ({
          metric: { k8s_cluster_name: "prod", k8s_namespace_name: "shop", k8s_pod_name: pod },
          value: [0.05, 0.9, 0.3][i],
        })),
      });
      const { inventory, state } = await setup(ALL_STREAMS, { sort: "cpu" });
      await refresh(inventory);
      expect(inventory.rows.value.map((r) => r.name)).toEqual(["idle", "busy", "none"]);
      state.value = parseListState({ sort: "cpu", desc: "true" });
      expect(inventory.rows.value.map((r) => r.name)).toEqual(["busy", "idle", "none"]);
    });
  });
});
