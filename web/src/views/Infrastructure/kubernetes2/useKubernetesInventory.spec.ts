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
import { queryClient } from "@/composables/query/queryClient";
import * as queries from "@/services/kubernetes.queries";
import { useKubernetesInventory, type K8sTime } from "./useKubernetesInventory";
import { CLUSTER_QUERIES, QUERY_STREAM, queryText, type QueryId } from "./kubernetesQueries";
import { parseUrlState, type K8sUrlState } from "./kubernetesUrlState";

const getStreams = vi.fn();
const getStream = vi.fn();

vi.mock("@/services/search", () => ({ default: { metrics_query: vi.fn(), search: vi.fn() } }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams, getStream }) }));

const metricsQuery = vi.mocked(searchService.metrics_query);
const search = vi.mocked(searchService.search);

const END = 1_700_000_000_000_000;
const START = END - 3_600_000_000;
const HOUR = 3_600_000_000;

const ALL_IDS = Object.keys(QUERY_STREAM) as QueryId[];
const ALL_STREAMS = [...new Set(Object.values(QUERY_STREAM))];

type Row = { metric: Record<string, string>; value: number };
type Fixture = Partial<Record<QueryId, Row[]>>;

// Strips the injected cluster matchers so a sent query maps back to its id.
const unscope = (text: string) =>
  text
    .replace(/,?k8s_cluster(_name)?="(?:[^"\\]|\\.)*"/g, "")
    .replace(/\{,/g, "{")
    .replace(/\{\}/g, "");

const idOf = (query: string): QueryId => {
  const text = unscope(decodeURIComponent(query));
  const id = ALL_IDS.find((q) => queryText(q) === text);
  if (!id) throw new Error(`unknown query ${text}`);
  return id;
};

const vector = (rows: Row[] = []) => ({
  data: { data: { result: rows.map((r) => ({ metric: r.metric, value: [1, String(r.value)] })) } },
});

let fixture: Fixture = {};
let sqlHits: (sql: string) => any[] = () => [];
let reject: QueryId[] = [];

const sentQueries = () =>
  metricsQuery.mock.calls.map(([args]: any[]) => decodeURIComponent(args.query));
const sentIds = () => sentQueries().map((q) => idOf(encodeURIComponent(q)));
const sentSql = () => search.mock.calls.map(([args]: any[]) => args.query.query);

const ksm = (metric: Record<string, string>, value = 1): Row => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const CL = (cluster = "prod", label = "k8s_cluster"): Fixture => ({
  CL1N: [{ metric: { [label]: cluster }, value: 1 }],
  CL1P: [{ metric: { [label]: cluster }, value: 1 }],
  CL1D: [{ metric: { [label]: cluster }, value: 1 }],
  CL2N: [{ metric: { k8s_cluster_name: cluster }, value: 1 }],
  CL2P: [{ metric: { k8s_cluster_name: cluster }, value: 1 }],
});

const setup = async (
  query: Record<string, string> = {},
  {
    metrics = ALL_STREAMS,
    logs = ["k8s_events"],
    eventFields = ["k8s_cluster", "body_object_note"],
    relative = true,
  }: { metrics?: string[]; logs?: string[]; eventFields?: string[]; relative?: boolean } = {},
) => {
  getStreams.mockImplementation(async (type: string) => ({
    list: (type === "metrics" ? metrics : logs).map((name) => ({ name })),
  }));
  getStream.mockResolvedValue({ schema: eventFields.map((name) => ({ name })) });
  const state = ref<K8sUrlState>(parseUrlState(query));
  const time = ref<K8sTime>({ start: START, end: END, relative });
  const org = ref("org1");
  const inv = useKubernetesInventory(
    () => state.value,
    () => time.value,
    () => org.value,
  );
  await inv.loadStreams();
  return { inv, state, time, org };
};

describe("useKubernetesInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    fixture = CL();
    sqlHits = () => [];
    reject = [];
    metricsQuery.mockImplementation((async ({ query }: { query: string }) => {
      const id = idOf(query);
      if (reject.includes(id))
        throw Object.assign(new Error(`boom ${id}`), { response: { status: 500 } });
      return vector(fixture[id]);
    }) as any);
    search.mockImplementation((async (args: any) => ({
      data: { hits: sqlHits(args.query.query.sql) },
    })) as any);
  });

  describe("detection", () => {
    it("is unknown before the stream lists resolve, and an error when listing rejects", async () => {
      const inv = useKubernetesInventory(
        () => parseUrlState({}),
        () => ({ start: START, end: END, relative: true }),
        () => "org1",
      );
      expect(inv.detection.value).toBe("unknown");
      getStreams.mockRejectedValueOnce(new Error("down"));
      await inv.loadStreams();
      expect(inv.detection.value).toBe("error");
    });

    it("detects an events-only org from the k8s_events logs stream", async () => {
      const { inv } = await setup({}, { metrics: ["system_cpu"], logs: ["k8s_events"] });
      expect(inv.detection.value).toBe("detected");
      expect(inv.metricsDetected.value).toBe(false);
      expect(inv.anchorMissing("pods")).toBe("kube_pod_status_phase");
      expect(inv.anchorMissing("events")).toBeNull();
    });

    it("is undetected with no metric detection stream and no k8s_events", async () => {
      const { inv } = await setup({}, { metrics: ["kube_pod_owner"], logs: ["default"] });
      expect(inv.detection.value).toBe("undetected");
    });
  });

  describe("per-view sets (§7.2) plus CL and NS1", () => {
    const CL_IDS = [...CLUSTER_QUERIES];
    it.each([
      ["pods", 17 + 6, ["W:Pod", "O:pod"]],
      ["cluster", 10 + 6, ["W:*"]],
      ["workloads", 16 + 6, ["E"]],
      ["hpas", 5 + 6, ["W:HorizontalPodAutoscaler"]],
      ["replicasets", 5 + 6, ["W:ReplicaSet"]],
      ["nodes", 9 + 6, ["W:Node", "O:node"]],
      ["events", 0 + 6, ["E"]],
    ] as const)("%s sends %i PromQL and %j", async (view, count, sqlNames) => {
      const { inv } = await setup({ view });
      await inv.load();
      expect(sentIds().length).toBe(count);
      expect(sentIds()).toEqual(expect.arrayContaining([...CL_IDS, "NS1"]));
      const names = search.mock.calls.map(([args]: any[]) => args.query.query.sql);
      expect(names).toHaveLength(sqlNames.length);
    });

    it("sends the map's pod set with N1 only when grouped by node, and the node set", async () => {
      const pods = await setup({ view: "map", group: "namespace" });
      await pods.inv.load();
      expect(
        sentIds()
          .filter((id) => !CL_IDS.includes(id) && id !== "NS1")
          .sort(),
      ).toEqual(
        [
          "P1",
          "P2",
          "P3",
          "P4",
          "P5",
          "P6",
          "P7",
          "P8",
          "P9",
          "P10",
          "P11",
          "P12",
          "P15",
          "K1",
          "K2",
        ].sort(),
      );
      vi.clearAllMocks();
      queryClient.clear();
      const nodes = await setup({ view: "map", entity: "nodes" });
      await nodes.inv.load();
      expect(
        sentIds()
          .filter((id) => !CL_IDS.includes(id) && id !== "NS1")
          .sort(),
      ).toEqual(["N1", "N2", "K3", "K4"].sort());
    });

    it("adds exactly a drawer's additions on top of its kind's set", async () => {
      fixture = { ...CL(), H1: [ksm({ namespace: "m", horizontalpodautoscaler: "h" }, 3)] };
      const { inv } = await setup({ view: "hpas", details: "hpa/prod/m/h" });
      await inv.load();
      expect(sentIds()).toContain("H8");
      const sqls = sentSql().map((q: any) => q.sql);
      expect(
        sqls.some(
          (s: string) =>
            s.includes("k8s_resource_name = 'horizontalpodautoscalers'") && s.endsWith("LIMIT 1"),
        ),
      ).toBe(true);
      expect(sqls.some((s: string) => s.includes("LIMIT 100"))).toBe(true);
    });

    it("sends no query of a view whose anchor stream is absent, and counts Jobs present on any status stream", async () => {
      const { inv } = await setup(
        { view: "deployments" },
        { metrics: ALL_STREAMS.filter((s) => s !== "kube_deployment_spec_replicas") },
      );
      await inv.load();
      expect(sentIds().some((id) => /^D\d/.test(id))).toBe(false);
      expect(inv.anchorMissing("deployments")).toBe("kube_deployment_spec_replicas");
      const jobs = await setup(
        { view: "jobs" },
        { metrics: ["kube_job_status_succeeded", "kube_pod_status_phase"] },
      );
      expect(jobs.inv.anchorMissing("jobs")).toBeNull();
    });
  });

  describe("cluster scope", () => {
    it("lists clusters from CL1 ∪ CL2, defaults to the first alphabetically, and scopes the SQL", async () => {
      fixture = {
        CL1P: [ksm({}), { metric: { k8s_cluster: "alpha" }, value: 1 }],
        CL2N: [{ metric: { k8s_cluster_name: "zeta" }, value: 1 }],
      };
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(inv.clusters.value).toEqual(["alpha", "prod", "zeta"]);
      expect(inv.effectiveCluster.value).toBe("alpha");
      expect(sentSql()[0].sql).toContain("k8s_cluster = 'alpha'");
    });

    it("finds the cluster of a pod-only org", async () => {
      fixture = {
        CL1P: [ksm({})],
        P1: [ksm({ namespace: "a", pod: "p", uid: "u", phase: "Running" })],
      };
      const { inv } = await setup({ view: "pods" }, { metrics: ["kube_pod_status_phase"] });
      await inv.load();
      expect(sentIds().filter((id) => id.startsWith("CL"))).toEqual(["CL1P"]);
      expect(inv.clusters.value).toEqual(["prod"]);
      expect(inv.inventory.value.pods).toHaveLength(1);
    });

    it("falls back to the events stream when no CL series exists", async () => {
      fixture = {};
      sqlHits = (sql) => (sql.startsWith("SELECT DISTINCT") ? [{ c: "ev" }] : []);
      const { inv } = await setup({ view: "events" }, { metrics: [] });
      await inv.load();
      expect(inv.clusters.value).toEqual(["ev"]);
      const fallback = sentSql().find((q: any) => q.sql.startsWith("SELECT DISTINCT"));
      expect(fallback).toMatchObject({ start_time: END - 24 * HOUR, end_time: END });
    });

    it("injects k8s_cluster into KSM and the CL2 spelling into kubeletstats queries", async () => {
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      const sent = sentQueries();
      expect(
        sent.find((q) => q.includes("kube_pod_status_phase") && !q.startsWith("count")),
      ).toContain('kube_pod_status_phase{k8s_cluster="prod"}');
      expect(sent.find((q) => q.includes("k8s_pod_cpu_usage") && !q.startsWith("count"))).toContain(
        'k8s_pod_cpu_usage{k8s_cluster_name="prod"}',
      );
    });

    it("sends a family with unlabelled CL rows unscoped, and banners it", async () => {
      fixture = {
        ...CL(),
        CL2P: [
          { metric: { k8s_cluster_name: "prod" }, value: 1 },
          { metric: {}, value: 1 },
        ],
        K1: [{ metric: { k8s_namespace_name: "a", k8s_pod_name: "x" }, value: 1 }],
        P1: [ksm({ namespace: "a", pod: "p", uid: "u", phase: "Running" })],
      };
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(
        sentQueries().find((q) => q.startsWith("sum by") && q.includes("k8s_pod_cpu_usage")),
      ).not.toContain("{");
      expect(inv.banners.value.map((b) => b.id)).toContain("no-cluster-kubeletstats");
    });
  });

  describe("scope failures", () => {
    it("shows a page error and withholds every row when cluster discovery fails", async () => {
      fixture = { P1: [ksm({ namespace: "a", pod: "p", uid: "u", phase: "Running" })] };
      reject = [...CLUSTER_QUERIES];
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(inv.pageError.value).toContain("boom");
      expect(inv.inventory.value.pods).toEqual([]);
      expect(sentIds().filter((id) => !id.startsWith("CL"))).toEqual([]);
    });

    it("shows the page error when CL succeeds but every sent view request fails, despite sparse empties", async () => {
      const sparse = [
        "kube_pod_container_status_waiting_reason",
        "kube_pod_container_resource_limits",
        "kube_pod_container_status_terminated_reason",
      ];
      reject = ALL_IDS.filter((id) => !CLUSTER_QUERIES.includes(id));
      search.mockRejectedValue(Object.assign(new Error("sql down"), { response: { status: 500 } }));
      const { inv } = await setup(
        { view: "pods" },
        { metrics: ALL_STREAMS.filter((s) => !sparse.includes(s)) },
      );
      await inv.load();
      expect(inv.results.value.size).toBe(0);
      expect(inv.pageError.value).toContain("boom");
    });

    it("sends the ReplicaSet owner query on its own stream, without the pod anchor", async () => {
      fixture = {
        ...CL(),
        RS2: [ksm({ namespace: "a", replicaset: "rs" }, 1)],
        P5: [ksm({ namespace: "a", replicaset: "rs", owner_kind: "Deployment", owner_name: "d" })],
      };
      const { inv } = await setup(
        { view: "replicasets" },
        { metrics: ALL_STREAMS.filter((s) => s !== "kube_pod_status_phase") },
      );
      await inv.load();
      expect(sentIds()).toContain("P5");
      expect(inv.inventory.value.replicasets[0].owner).toEqual({ kind: "Deployment", name: "d" });
    });

    it("treats a failed k8s_events schema lookup as a stream error, never as unlabelled", async () => {
      getStreams.mockImplementation(async (type: string) => ({
        list: (type === "metrics" ? ALL_STREAMS : ["k8s_events"]).map((name) => ({ name })),
      }));
      getStream.mockRejectedValue(new Error("schema down"));
      const inv = useKubernetesInventory(
        () => parseUrlState({ view: "events" }),
        () => ({ start: START, end: END, relative: true }),
        () => "org1",
      );
      await inv.loadStreams();
      expect(inv.detection.value).toBe("error");
      expect(inv.eventsScoped.value).toBe(false);
      await inv.load();
      expect(search).not.toHaveBeenCalled();
    });
  });

  describe("unscoped events (no k8s_cluster field)", () => {
    it("runs E with no cluster term and sends no W, DE, O* or fallback", async () => {
      fixture = {};
      const { inv } = await setup(
        { view: "events" },
        { eventFields: ["body_object_note"], metrics: [] },
      );
      await inv.load();
      const sqls = sentSql().map((q: any) => q.sql);
      expect(sqls).toHaveLength(1);
      expect(sqls[0]).not.toContain("k8s_cluster");
      expect(inv.eventsScoped.value).toBe(false);
      expect(inv.eventLinksEnabled.value).toBe(false);
      fixture = CL();
      const pods = await setup({ view: "pods", details: "pod/prod/a/p" }, { eventFields: [] });
      search.mockClear();
      await pods.inv.load();
      expect(search).not.toHaveBeenCalled();
      expect(pods.inv.eventLinksEnabled.value).toBe(true);
    });
  });

  describe("SQL windows and W", () => {
    it("sends W over the last hour with size 20001, E over the picker range and O over 24h", async () => {
      const pods = await setup({ view: "pods" });
      await pods.inv.load();
      const w = sentSql().find((q: any) => q.sql.includes("body_object_type = 'Warning'"));
      expect(w).toMatchObject({ start_time: END - HOUR, end_time: END, size: 20001 });
      const o = sentSql().find((q: any) => q.sql.includes("k8s_resource_name"));
      expect(o).toMatchObject({ start_time: END - 24 * HOUR, end_time: END });
      const events = await setup({ view: "events" });
      search.mockClear();
      await events.inv.load();
      expect(sentSql()[0]).toMatchObject({ start_time: START, end_time: END });
    });

    it("marks all of 1,200 affected objects, and banners a truncated W", async () => {
      const pods = Array.from({ length: 1200 }, (_, i) => `p${i}`);
      fixture = {
        ...CL(),
        P1: pods.map((pod) => ksm({ namespace: "a", pod, uid: pod, phase: "Running" })),
      };
      sqlHits = (sql) =>
        sql.includes("'Warning'")
          ? pods.map((name) => ({
              kind: "Pod",
              name,
              namespace: "a",
              uid: name,
              events: 1,
              last_seen: END - 1,
              reason: "R",
              note: "n",
            }))
          : [];
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(inv.inventory.value.pods.filter((p) => p.warnings.length > 0)).toHaveLength(1200);
      expect(inv.banners.value.map((b) => b.id)).not.toContain("warnings-truncated");
      sqlHits = (sql) =>
        sql.includes("'Warning'")
          ? Array.from({ length: 20001 }, (_, i) => ({ kind: "Pod", name: `x${i}` }))
          : [];
      const big = await setup({ view: "pods" }, { relative: false });
      big.time.value = { start: START, end: END + 1, relative: false };
      await big.inv.load();
      expect(big.inv.banners.value.map((b) => b.id)).toContain("warnings-truncated");
    });

    it("does not attach a Warning older than the hour", async () => {
      fixture = { ...CL(), P1: [ksm({ namespace: "a", pod: "p", uid: "u", phase: "Running" })] };
      sqlHits = (sql) =>
        sql.includes("'Warning'")
          ? [
              {
                kind: "Pod",
                name: "p",
                namespace: "a",
                uid: "u",
                events: 1,
                last_seen: END - 61 * 60_000_000,
                reason: "R",
                note: "n",
              },
            ]
          : [];
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(inv.inventory.value.pods[0].warnings).toEqual([]);
    });
  });

  describe("sparse and optional streams", () => {
    it("treats absent waiting, limits and terminated reasons as empty, and leaves P3 unavailable", async () => {
      fixture = {
        ...CL(),
        P1: [ksm({ namespace: "a", pod: "p", uid: "u", phase: "Running" })],
        P10: [ksm({ namespace: "a", pod: "p", uid: "u", container: "c" })],
      };
      const absent = [
        "kube_pod_container_status_waiting_reason",
        "kube_pod_container_resource_limits",
        "kube_pod_container_status_terminated_reason",
        "kube_pod_container_status_last_terminated_reason",
      ];
      const { inv } = await setup(
        { view: "pods" },
        { metrics: ALL_STREAMS.filter((s) => !absent.includes(s)) },
      );
      await inv.load();
      for (const id of ["P2", "P3", "P9", "P14"]) expect(sentIds()).not.toContain(id);
      expect(inv.results.value.get("P2")).toEqual([]);
      expect(inv.results.value.get("P9")).toEqual([]);
      expect(inv.results.value.get("P14")).toEqual([]);
      expect(inv.results.value.has("P3")).toBe(false);
      expect(inv.inventory.value.pods[0].memoryLimit).toBe("missing");
      expect(inv.banners.value.filter((b) => b.variant === "warning")).toEqual([]);
    });
  });

  describe("failures", () => {
    it("blanks only a rejected query and banners it", async () => {
      fixture = { ...CL(), P1: [ksm({ namespace: "a", pod: "p", uid: "u", phase: "Running" })] };
      reject = ["P6"];
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(inv.inventory.value.pods[0].node).toBeNull();
      expect(inv.pageError.value).toBeNull();
      expect(inv.banners.value.map((b) => b.id)).toContain("partial-failure");
    });

    it("shows one page error when every query is rejected", async () => {
      metricsQuery.mockRejectedValue(new Error("all down"));
      search.mockRejectedValue(new Error("all down"));
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(inv.pageError.value).toBe("all down");
    });

    it("reports forbidden when the view's anchor query is rejected with 403", async () => {
      metricsQuery.mockImplementation((async ({ query }: { query: string }) => {
        const id = idOf(query);
        if (id === "P1") throw Object.assign(new Error("no"), { response: { status: 403 } });
        return vector(fixture[id]);
      }) as any);
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(inv.forbidden.value).toBe(true);
    });
  });

  describe("TanStack", () => {
    it("reads every query through the declared factories", async () => {
      const instant = vi.spyOn(queries, "k8sInstantQuery");
      const sqlQuery = vi.spyOn(queries, "k8sSqlQuery");
      const fetch = vi.spyOn(queryClient, "fetchQuery");
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      expect(instant).toHaveBeenCalledTimes(metricsQuery.mock.calls.length);
      expect(sqlQuery).toHaveBeenCalledTimes(search.mock.calls.length);
      expect(fetch).toHaveBeenCalledTimes(
        metricsQuery.mock.calls.length + search.mock.calls.length,
      );
      for (const [options] of fetch.mock.calls as any[])
        expect(options.queryKey.slice(0, 3)).toEqual(["org", "org1", "kubernetes"]);
    });

    it("serves a revisit inside the stale time from the cache, and Refresh re-sends everything", async () => {
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      const first = metricsQuery.mock.calls.length + search.mock.calls.length;
      await inv.load();
      expect(metricsQuery.mock.calls.length + search.mock.calls.length).toBe(first);
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const nonce = inv.refreshNonce.value;
      await inv.load({ force: true });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["org", "org1", "kubernetes"],
        refetchType: "none",
      });
      expect(metricsQuery.mock.calls.length + search.mock.calls.length).toBe(2 * first);
      expect(inv.refreshNonce.value).toBe(nonce + 1);
    });

    it("drops a late response from an older generation", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      metricsQuery.mockImplementation((async ({ query, end_time }: any) => {
        const id = idOf(query);
        const old = end_time === END;
        if (old && id === "P1") await gate;
        if (id === "P1")
          return vector([
            ksm({ namespace: "a", pod: "p", uid: "u", phase: old ? "Failed" : "Running" }),
          ]);
        return vector(fixture[id]);
      }) as any);
      const { inv, time } = await setup({ view: "pods" }, { metrics: ["kube_pod_status_phase"] });
      const old = inv.load();
      time.value = { start: START, end: END + HOUR, relative: true };
      await inv.load();
      release();
      await old;
      expect(inv.inventory.value.pods[0].phase).toBe("Running");
    });

    it("reset forgets the org's streams, results and errors", async () => {
      fixture = { ...CL(), P1: [ksm({ namespace: "a", pod: "p", uid: "u", phase: "Running" })] };
      const { inv } = await setup({ view: "pods" });
      await inv.load();
      inv.reset();
      expect(inv.detection.value).toBe("unknown");
      expect(inv.inventory.value.pods).toEqual([]);
      expect(inv.loaded.value).toBe(false);
    });
  });

  describe("drawer", () => {
    it("fetches the kind's set for a drawer opened from another view, then the object by KSM uid", async () => {
      fixture = {
        ...CL(),
        P1: [ksm({ namespace: "a", pod: "p", uid: "u1", phase: "Running" })],
      };
      sqlHits = (sql) =>
        sql.includes("LIMIT 1") && sql.includes("'pods'")
          ? [
              {
                uid: "u1",
                event_name: "p",
                k8s_namespace_name: "a",
                body_type: "MODIFIED",
                body_object_metadata: '{"labels":{"app":"x"}}',
                body_object_spec: "{}",
                body_object_status: "{}",
              },
            ]
          : [];
      const { inv } = await setup({ view: "nodes", details: "pod/prod/a/p" });
      await inv.load();
      expect(sentIds()).toContain("P1");
      const obj = sentSql().find((q: any) => q.sql.endsWith("LIMIT 1"));
      expect(obj.sql).toContain("json_get_str(body_object_metadata,'uid') = 'u1'");
      const de = sentSql().find((q: any) => q.sql.endsWith("LIMIT 100"));
      expect(de.sql).toContain("json_get_str(body_object_regarding,'uid') = 'u1'");
      expect(inv.inventory.value.pods[0].object?.metadata.labels).toEqual({ app: "x" });
      expect(inv.detailObserved.value).toBe(true);
      expect(inv.detailLoading.value).toBe(false);
    });
  });

  describe("drawer data belongs to the drawer it was loaded for", () => {
    const pods = {
      P1: [
        ksm({ namespace: "a", pod: "p", uid: "u1", phase: "Running" }),
        ksm({ namespace: "a", pod: "q", uid: "u2", phase: "Running" }),
      ],
    };
    const objectFor = (uid: string, bodyType = "MODIFIED") => ({
      uid,
      event_name: "p",
      k8s_namespace_name: "a",
      body_type: bodyType,
      body_object_metadata: "{}",
      body_object_spec: "{}",
      body_object_status: "{}",
    });

    it("hides the previous drawer's events and object while the next one loads", async () => {
      fixture = { ...CL(), ...pods };
      sqlHits = (sql) =>
        sql.endsWith("LIMIT 100")
          ? [
              {
                event_name: "e",
                body_object_note: "for p",
                body_object_regarding: '{"kind":"Pod","name":"p"}',
              },
            ]
          : sql.endsWith("LIMIT 1")
            ? [objectFor("u1")]
            : [];
      const { inv, state } = await setup({ view: "pods", details: "pod/prod/a/p" });
      await inv.load();
      expect(inv.detailEvents.value?.map((e) => e.note)).toEqual(["for p"]);
      expect(inv.detailObserved.value).toBe(true);
      state.value = parseUrlState({ view: "pods", details: "pod/prod/a/q" });
      expect(inv.detailEvents.value).toBeNull();
      expect(inv.detailObserved.value).toBe(false);
    });

    it("reports the drawer's events as failed, not as still loading, when DE is rejected", async () => {
      fixture = { ...CL(), ...pods };
      search.mockImplementation((async (args: any) => {
        if (args.query.query.sql.endsWith("LIMIT 100")) {
          throw Object.assign(new Error("no"), { response: { status: 403 } });
        }
        return { data: { hits: [] } };
      }) as any);
      const { inv } = await setup({ view: "pods", details: "pod/prod/a/p" });
      await inv.load();
      expect(inv.detailEvents.value).toBeNull();
      expect(inv.detailEventsFailed.value).toBe(true);
    });

    it("treats a latest DELETED record as not observed", async () => {
      fixture = { ...CL(), ...pods };
      sqlHits = (sql) => (sql.endsWith("LIMIT 1") ? [objectFor("u1", "DELETED")] : []);
      const { inv } = await setup({ view: "pods", details: "pod/prod/a/p" });
      await inv.load();
      expect(inv.detailObserved.value).toBe(false);
    });
  });

  it("lists namespace options from NS1 plus the current selection", async () => {
    fixture = {
      ...CL(),
      NS1: [
        ksm({ namespace: "data", phase: "Active" }),
        ksm({ k8s_cluster: "dev", namespace: "devns", phase: "Active" }),
      ],
    };
    const { inv } = await setup({ view: "pods", namespace: "gone" });
    await inv.load();
    expect(inv.namespaceOptions.value).toEqual(["data", "gone"]);
  });
});
