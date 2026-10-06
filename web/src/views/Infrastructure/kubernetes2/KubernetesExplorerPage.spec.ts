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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import searchService from "@/services/search";
import KubernetesExplorerPage from "./KubernetesExplorerPage.vue";
import { QUERY_STREAM, type QueryId } from "./kubernetesQueries";

type Row = { metric: Record<string, string>; value: number };
type Fixture = Partial<Record<QueryId, Row[]>>;

const getStreams = vi.fn();

vi.mock("@/services/search", () => ({
  default: { metrics_query: vi.fn(), metrics_query_range: vi.fn() },
}));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams }) }));

const viewport = { mdUp: true, lgUp: true };

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => !viewport.mdUp),
      isTablet: computed(() => viewport.mdUp && !viewport.lgUp),
      isDesktop: computed(() => viewport.lgUp),
      mdUp: computed(() => viewport.mdUp),
      lgUp: computed(() => viewport.lgUp),
    }),
  };
});

const metricsQuery = vi.mocked(searchService.metrics_query);

const ALL_STREAMS = Object.values(QUERY_STREAM);

const idOf = (query: string): QueryId => {
  const decoded = decodeURIComponent(query);
  return (Object.keys(QUERY_STREAM) as QueryId[]).find((q) =>
    new RegExp(`\\b${QUERY_STREAM[q]}\\b`).test(decoded),
  )!;
};

let fixture: Fixture = {};

const serve = () =>
  metricsQuery.mockImplementation((({ query }: { query: string }) =>
    Promise.resolve({
      data: {
        data: {
          result: (fixture[idOf(query)] ?? []).map((r) => ({
            metric: r.metric,
            value: [1, String(r.value)],
          })),
        },
      },
    })) as any);

const GEN = "prod-us-east-1";
const MI = 1024 ** 2;

// Generator-shaped fixture (traces_generator PR #5): KSM carries k8s_cluster, kubeletstats k8s_cluster_name.
function generatorFixture(cluster = GEN): Fixture {
  const f: Fixture = {};
  const add = (id: QueryId, metric: Record<string, string>, value = 1) =>
    (f[id] ??= []).push({ metric: { k8s_cluster: cluster, ...metric }, value });
  const usage = (id: QueryId, metric: Record<string, string>, value: number) =>
    (f[id] ??= []).push({ metric: { k8s_cluster_name: cluster, ...metric }, value });
  const pod = (
    namespace: string,
    name: string,
    opts: {
      phase?: string;
      ready?: string;
      rs?: string;
      deployment?: string;
      job?: string;
      node?: string;
      containers?: string[];
      cpuRequest?: number;
      memoryLimit?: number;
      cpu?: number;
      memory?: number;
    } = {},
  ) => {
    const p = { namespace, pod: name, uid: name };
    add("P1", { ...p, phase: opts.phase ?? "Running" });
    if (opts.ready) add("P11", { ...p, condition: opts.ready });
    if (opts.rs) {
      add("P4", { ...p, owner_kind: "ReplicaSet", owner_name: opts.rs });
      add("P5", {
        namespace,
        replicaset: opts.rs,
        owner_kind: "Deployment",
        owner_name: opts.deployment!,
      });
    }
    if (opts.job) add("P4", { ...p, owner_kind: "Job", owner_name: opts.job });
    add("P6", { ...p, node: opts.node ?? "ip-10-0-1-10.ec2.internal" });
    for (const c of opts.containers ?? ["main"]) {
      add("P10", { ...p, container: c });
      if (opts.cpuRequest != null)
        add("P8", { ...p, container: c, resource: "cpu" }, opts.cpuRequest);
      if (opts.memoryLimit != null)
        add("P9", { ...p, container: c, resource: "memory" }, opts.memoryLimit);
    }
    const k = { k8s_namespace_name: namespace, k8s_pod_name: name, k8s_pod_uid: name };
    if (opts.cpu != null) usage("K1", k, opts.cpu);
    if (opts.memory != null) usage("K2", k, opts.memory);
    return p;
  };
  const crash = pod("data", "recommendation-service-9x58zgdb6z-sclvv", {
    ready: "false",
    rs: "recommendation-service-9x58zgdb6z",
    deployment: "recommendation-service",
    cpuRequest: 0.5,
    memoryLimit: 256 * MI,
    cpu: 0.1,
    memory: 50 * MI,
  });
  add("P2", { ...crash, container: "main", reason: "CrashLoopBackOff" });
  pod("data", "recommendation-service-9x58zgdb6z-jwhzq", {
    ready: "true",
    rs: "recommendation-service-9x58zgdb6z",
    deployment: "recommendation-service",
    cpuRequest: 0.5,
    memoryLimit: 256 * MI,
    cpu: 0.4,
    memory: 100 * MI,
  });
  const oom = pod("data", "analytics-service-x6xv7pjxhb-zqcl4", {
    ready: "true",
    rs: "analytics-service-x6xv7pjxhb",
    deployment: "analytics-service",
    node: "ip-10-0-13-37.ec2.internal",
    containers: ["analytics"],
    cpuRequest: 1,
    memoryLimit: 512 * MI,
    cpu: 0.6,
    memory: 300 * MI,
  });
  add("P3", { ...oom, container: "analytics", reason: "OOMKilled" });
  add("P7", { ...oom, container: "analytics" }, 1);
  pod("commerce", "order-service-6xphqm265w-nb2sq", {
    ready: "false",
    rs: "order-service-6xphqm265w",
    deployment: "order-service",
    cpuRequest: 0.5,
    memoryLimit: 256 * MI,
    cpu: 0.3,
    memory: 80 * MI,
  });
  const pending = { namespace: "media", pod: "transcoding-service-nkgbp5xp5l-vwvn2", uid: "t" };
  add("P1", { ...pending, phase: "Pending" });
  add("P4", { ...pending, owner_kind: "ReplicaSet", owner_name: "transcoding-service-nkgbp5xp5l" });
  add("P5", {
    namespace: "media",
    replicaset: "transcoding-service-nkgbp5xp5l",
    owner_kind: "Deployment",
    owner_name: "transcoding-service",
  });
  add("P8", { ...pending, container: "ffmpeg", resource: "cpu" }, 2);
  pod("chat", "chat-service-8g7f88v79d-2hth6", {
    ready: "true",
    cpuRequest: 1,
    memoryLimit: 512 * MI,
    cpu: 0.05,
    memory: 100 * MI,
  });
  pod("commerce", "inventory-service-blkdl5tcm2-94jdl", {
    ready: "true",
    cpuRequest: 0.5,
    memoryLimit: 100 * MI,
    cpu: 0.4,
    memory: 95 * MI,
  });
  pod("monitoring", "monitoring-service-ngzwq692gl-gj99g", {
    ready: "true",
    cpuRequest: 0.5,
    cpu: 0.3,
    memory: 40 * MI,
  });
  pod("data", "analytics-backfill-hc9zb", { phase: "Failed", job: "analytics-backfill" });
  for (const node of [
    "ip-10-0-1-10.ec2.internal",
    "ip-10-0-13-37.ec2.internal",
    "ip-10-0-2-20.ec2.internal",
    "ip-10-0-3-30.ec2.internal",
  ]) {
    add("N1", { node, condition: "Ready", status: "true" });
    add("N2", { node, resource: "cpu" }, 4);
    add("N2", { node, resource: "memory" }, 16 * 1024 * MI);
    usage("K3", { k8s_node_name: node }, 1);
    usage("K4", { k8s_node_name: node }, 4 * 1024 * MI);
  }
  add("N1", { node: "ip-10-0-13-37.ec2.internal", condition: "MemoryPressure", status: "true" });
  for (const [deployment, namespace, desired, available] of [
    ["recommendation-service", "data", 2, 1],
    ["transcoding-service", "media", 1, 0],
    ["order-service", "commerce", 2, 1],
    ["analytics-service", "data", 1, 1],
  ] as const) {
    add("D1", { namespace, deployment }, desired);
    add("D2", { namespace, deployment }, available);
  }
  return f;
}

const merge = (...fixtures: Fixture[]) => {
  const out: Fixture = {};
  for (const f of fixtures) {
    for (const [id, rows] of Object.entries(f) as [QueryId, Row[]][])
      (out[id] ??= []).push(...rows);
  }
  return out;
};

const notReadyNode = (): Fixture => ({
  N1: [
    {
      metric: {
        k8s_cluster: GEN,
        node: "ip-10-0-9-99.ec2.internal",
        condition: "Ready",
        status: "false",
      },
      value: 1,
    },
  ],
});

const OTableStub = defineComponent({
  name: "OTable",
  props: ["data", "columns", "sortBy", "sortOrder", "currentPage", "totalCount"],
  emits: ["sort-change", "pagination-change"],
  setup(props: any, { slots, attrs }: any) {
    return () =>
      h(
        "div",
        { "data-test": attrs["data-test"] },
        (props.data ?? []).map((row: any) =>
          h(
            "div",
            { class: "row-stub" },
            Object.keys(slots)
              .filter((s) => s.startsWith("cell-"))
              .map((s) => slots[s]?.({ row })),
          ),
        ),
      );
  },
});

const passthrough = (name: string) =>
  defineComponent({
    name,
    setup(_p: any, { slots }: any) {
      return () =>
        h("div", {}, [
          slots.actions?.(),
          h("div", { "data-test": "layout-overflow" }, slots["actions-overflow"]?.()),
          h("div", { "data-test": "layout-sidebar" }, slots.sidebar?.()),
          slots.default?.(),
        ]);
    },
  });

const radioGroupStub = defineComponent({
  name: "ORadioGroup",
  props: ["modelValue"],
  emits: ["update:modelValue"],
  setup(props: any, { slots }: any) {
    return () => h("div", { "data-model": String(props.modelValue) }, slots.default?.());
  },
});

const radioStub = defineComponent({
  name: "ORadio",
  props: ["value", "label"],
  setup(props: any, { slots }: any) {
    return () => h("div", { "data-radio": props.value }, [props.label, slots.label?.()]);
  },
});

const drawerStub = defineComponent({
  name: "PodDetailDrawer",
  props: ["target", "pod", "range", "orgId", "multiCluster", "usageStreams", "pending"],
  emits: ["close", "filter-node", "filter-owner"],
  setup() {
    return () => h("div", { "data-test": "drawer-stub" });
  },
});

const setupCardStub = defineComponent({
  name: "DataSourceSetupCard",
  props: ["slug"],
  emits: ["detected"],
  setup(props: any) {
    return () => h("div", { "data-test": "setup-card-stub", "data-slug": props.slug });
  },
});

const dateTimeStub = defineComponent({
  name: "DateTime",
  emits: ["on:date-change"],
  setup() {
    return () => h("div");
  },
});

describe("KubernetesExplorerPage", () => {
  let wrapper: VueWrapper<any>;
  let router: any;
  let store: any;

  const mountPage = async (
    query: Record<string, any> = {},
    streams: string[] | null = ALL_STREAMS,
    { realLayout = false } = {},
  ) => {
    if (streams) getStreams.mockResolvedValue({ list: streams.map((name) => ({ name })) });
    store = createStore({
      state: {
        selectedOrganization: { identifier: "org1" },
        timezone: "UTC",
        theme: "light",
        zoConfig: {},
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        {
          path: "/infra/kubernetes-2",
          name: "infraKubernetes2",
          component: { template: "<div />" },
        },
      ],
    });
    await router.push({ path: "/infra/kubernetes-2", query });
    await router.isReady();
    wrapper = mount(KubernetesExplorerPage, {
      global: {
        plugins: [store, router, i18n],
        stubs: {
          ...(realLayout ? {} : { OPageLayout: passthrough("OPageLayout") }),
          OTable: OTableStub,
          ORadioGroup: radioGroupStub,
          ORadio: radioStub,
          PodDetailDrawer: drawerStub,
          DataSourceSetupCard: setupCardStub,
          DateTime: dateTimeStub,
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  const query = () => router.currentRoute.value.query;
  const tiles = () =>
    Object.fromEntries(
      (wrapper.findComponent({ name: "OStatStrip" }).props("items") as any[]).map((i) => [
        i.key,
        i.value,
      ]),
    );
  const listed = (kind: "pod" | "node" | "deployment") =>
    wrapper
      .findAll(`[data-test^="k8s2-${kind}-open-"]`)
      .map((el) => el.text())
      .sort();
  const selectTile = async (key: string) => {
    wrapper.findComponent({ name: "OStatStrip" }).vm.$emit("select", key);
    await flushPromises();
  };
  const radio = (testId: string) =>
    wrapper
      .findAllComponents({ name: "ORadioGroup" })
      .find((c) => c.attributes("data-test") === testId)!;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = generatorFixture();
    serve();
  });

  afterEach(() => wrapper?.unmount());

  describe("faces", () => {
    it("shows a spinner while detection is unresolved", async () => {
      getStreams.mockReturnValue(new Promise(() => {}));
      await mountPage({}, null);
      expect(wrapper.find('[data-test="k8s2-spinner"]').exists()).toBe(true);
    });

    it("shows an error face with Retry that forces the stream list", async () => {
      getStreams.mockRejectedValueOnce(new Error("down"));
      await mountPage({}, null);
      expect(wrapper.find('[data-test="k8s2-streams-error"]').exists()).toBe(true);
      getStreams.mockResolvedValue({ list: ALL_STREAMS.map((name) => ({ name })) });
      const face = wrapper.findComponent({ name: "OEmptyState" });
      expect(face.attributes("data-test")).toBe("k8s2-streams-error");
      face.vm.$emit("action", "retry");
      await flushPromises();
      expect(getStreams).toHaveBeenLastCalledWith("metrics", false, false, true);
      expect(wrapper.find('[data-test="k8s2-tiles"]').exists()).toBe(true);
    });

    it("shows the kubernetes setup card when none of the seven streams exist", async () => {
      await mountPage({}, ["kube_pod_owner", "system_cpu_time"]);
      expect(wrapper.find('[data-test="setup-card-stub"]').attributes("data-slug")).toBe(
        "kubernetes",
      );
      expect(metricsQuery).not.toHaveBeenCalled();
    });

    it("is ready with only kube_pod_status_phase", async () => {
      await mountPage({}, ["kube_pod_status_phase"]);
      expect(wrapper.find('[data-test="k8s2-tiles"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="k8s2-pods-table"]').exists()).toBe(true);
    });

    it("shows one page error with Retry when every query fails", async () => {
      metricsQuery.mockRejectedValue(new Error("engine down"));
      await mountPage();
      expect(wrapper.find('[data-test="k8s2-page-error"]').text()).toContain("engine down");
      serve();
      const face = wrapper.findComponent({ name: "OEmptyState" });
      expect(face.attributes("data-test")).toBe("k8s2-page-error");
      face.vm.$emit("action", "retry");
      await flushPromises();
      expect(wrapper.find('[data-test="k8s2-page-error"]').exists()).toBe(false);
    });

    it("shows a family's banner on its own tab", async () => {
      await mountPage(
        { kind: "deployments" },
        ALL_STREAMS.filter((s) => s !== "kube_deployment_spec_replicas"),
      );
      expect(wrapper.find('[data-test="k8s2-banner-anchor-deployments"]').exists()).toBe(true);
    });

    it("explains the hidden OOM tile", async () => {
      await mountPage(
        {},
        ALL_STREAMS.filter((s) => s !== "kube_pod_container_status_last_terminated_reason"),
      );
      expect(wrapper.find('[data-test="k8s2-banner-oom-stream"]').text()).toBe(
        "OOMKilled needs kube_pod_container_status_last_terminated_reason, which the openobserve-collector chart's keep list drops",
      );
      expect(tiles().podsOomKilled).toBeUndefined();
    });
  });

  describe("cross-kind strip", () => {
    beforeEach(() => {
      fixture = merge(generatorFixture(), notReadyNode());
      serve();
    });

    it("shows node and deployment tiles on the Pods tab", async () => {
      await mountPage();
      expect(tiles()).toMatchObject({
        nodesNotReady: 1,
        nodesPressure: 1,
        deploymentsUnavailable: 3,
      });
      expect(tiles().podsNotRunning).toBeGreaterThan(0);
    });

    it("switches tab and filters on a tile click, and a reload restores it", async () => {
      await mountPage();
      await selectTile("nodesNotReady");
      expect(query()).toEqual({ kind: "nodes", issue: "nodesNotReady" });
      expect(listed("node")).toEqual(["ip-10-0-9-99.ec2.internal"]);
      wrapper.unmount();
      await mountPage({ kind: "nodes", issue: "nodesNotReady" });
      expect(listed("node")).toEqual(["ip-10-0-9-99.ec2.internal"]);
      expect(wrapper.findComponent({ name: "OStatStrip" }).props("selectedKey")).toBe(
        "nodesNotReady",
      );
    });
  });

  describe("generator faults", () => {
    const inTile = async (key: string) => {
      await selectTile(key);
      return listed(
        key.startsWith("node") ? "node" : key.startsWith("deploy") ? "deployment" : "pod",
      );
    };

    it("puts each deliberate fault in its tile", async () => {
      fixture = merge(generatorFixture(), notReadyNode());
      serve();
      await mountPage();
      expect(await inTile("podsContainerErrors")).toEqual([
        "recommendation-service-9x58zgdb6z-sclvv",
      ]);
      expect(await inTile("podsOomKilled")).toEqual(["analytics-service-x6xv7pjxhb-zqcl4"]);
      expect(await inTile("podsNotRunning")).toEqual([
        "analytics-backfill-hc9zb",
        "order-service-6xphqm265w-nb2sq",
        "recommendation-service-9x58zgdb6z-sclvv",
        "transcoding-service-nkgbp5xp5l-vwvn2",
      ]);
      expect(await inTile("deploymentsUnavailable")).toEqual([
        "order-service",
        "recommendation-service",
        "transcoding-service",
      ]);
      expect(await inTile("nodesPressure")).toEqual(["ip-10-0-13-37.ec2.internal"]);
      expect(await inTile("nodesNotReady")).toEqual(["ip-10-0-9-99.ec2.internal"]);
      expect(await inTile("podsNearMemoryLimit")).toEqual(["inventory-service-blkdl5tcm2-94jdl"]);
    });

    it("renders the crash status, the danger bar, No limit and the exact CPU %", async () => {
      await mountPage();
      const key = (ns: string, pod: string) => `${GEN}/${ns}/${pod}`;
      expect(
        wrapper
          .find(
            `[data-test="k8s2-pod-status-${key("data", "recommendation-service-9x58zgdb6z-sclvv")}"]`,
          )
          .text(),
      ).toContain("CrashLoopBackOff");
      expect(
        wrapper
          .find(
            `[data-test="k8s2-pod-status-${key("commerce", "order-service-6xphqm265w-nb2sq")}"]`,
          )
          .text(),
      ).toContain("Running · NotReady");
      const bar = wrapper.findComponent(
        `[data-test="k8s2-pod-memory-bar-${key("commerce", "inventory-service-blkdl5tcm2-94jdl")}"]` as any,
      );
      expect(bar.props("variant")).toBe("danger");
      expect(
        wrapper
          .find(
            `[data-test="k8s2-pod-memory-${key("monitoring", "monitoring-service-ngzwq692gl-gj99g")}"]`,
          )
          .text(),
      ).toContain("No limit");
      expect(
        wrapper
          .find(`[data-test="k8s2-pod-cpu-${key("chat", "chat-service-8g7f88v79d-2hth6")}"]`)
          .text(),
      ).toContain("5% of request");
      expect(wrapper.text()).toContain("Job/analytics-backfill");
    });

    it("sorts the over-provisioned pod first on CPU ascending", async () => {
      await mountPage();
      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("sort-change", { column: "cpu", order: "asc" });
      await flushPromises();
      expect(query()).toMatchObject({ sort: "cpu" });
      expect(query().desc).toBeUndefined();
      expect(wrapper.find('[data-test^="k8s2-pod-open-"]').text()).toBe(
        "chat-service-8g7f88v79d-2hth6",
      );
    });
  });

  describe("cluster scope", () => {
    beforeEach(() => {
      fixture = merge(generatorFixture(), generatorFixture("alpha"));
      serve();
    });

    it("shows only the alphabetically first cluster without writing the URL", async () => {
      await mountPage();
      expect(query()).toEqual({});
      expect(wrapper.find('[data-test="k8s2-scope-cluster"]').text()).toBe("Cluster: alpha");
      expect(
        new Set(wrapper.findAll('[data-test^="k8s2-pod-open-alpha/"]').map((e) => e.text())).size,
      ).toBe(9);
      expect(wrapper.findAll(`[data-test^="k8s2-pod-open-${GEN}/"]`)).toHaveLength(0);
    });

    it("writes cluster=* for All and names the scope", async () => {
      await mountPage();
      radio("k8s2-cluster-facet").vm.$emit("update:modelValue", "*");
      await flushPromises();
      expect(query().cluster).toBe("*");
      expect(wrapper.find('[data-test="k8s2-scope-cluster"]').text()).toBe("All clusters");
      expect(wrapper.findAll('[data-test^="k8s2-pod-open-"]')).toHaveLength(18);
    });

    it("applies no default with a single cluster", async () => {
      fixture = generatorFixture();
      serve();
      await mountPage();
      expect(wrapper.find('[data-test="k8s2-scope-cluster"]').text()).toBe(`Cluster: ${GEN}`);
      expect(wrapper.findAll('[data-test^="k8s2-pod-open-"]')).toHaveLength(9);
    });

    it("rewrites a repeated cluster param to its first value", async () => {
      await mountPage({ cluster: [GEN, "alpha"] });
      expect(query().cluster).toBe(GEN);
      expect(wrapper.find('[data-test="k8s2-scope-cluster"]').text()).toBe(`Cluster: ${GEN}`);
    });

    it("counts tiles by the scope facets only", async () => {
      fixture = merge(generatorFixture(), generatorFixture("alpha"), notReadyNode());
      serve();
      await mountPage({ cluster: GEN });
      const base = tiles();
      expect(base.nodesNotReady).toBe(1);
      radio("k8s2-cluster-facet").vm.$emit("update:modelValue", "alpha");
      await flushPromises();
      expect(tiles().nodesNotReady).toBe(0);
      await router.replace({ query: { cluster: GEN, namespace: "data" } });
      await flushPromises();
      expect(tiles().podsNotRunning).toBe(2);
      expect(tiles().nodesNotReady).toBe(1);
      const scoped = tiles();
      await router.replace({
        query: {
          cluster: GEN,
          namespace: "data",
          name: "zzz",
          onNode: `${GEN}/ip-10-0-1-10.ec2.internal`,
          workload: `${GEN}/data/Deployment/recommendation-service`,
        },
      });
      await flushPromises();
      expect(tiles()).toEqual(scoped);
      await selectTile("podsRestarting");
      expect(tiles()).toEqual({ ...scoped });
      expect(base).not.toEqual(scoped);
    });
  });

  describe("list filters", () => {
    it("writes the debounced name search and resets the page", async () => {
      await mountPage({ page: "2" });
      const search = wrapper.findComponent({ name: "OSearchInput" });
      expect(search.props("debounce")).toBe(300);
      search.vm.$emit("update:modelValue", "chat");
      await flushPromises();
      expect(query()).toEqual({ name: "chat" });
      expect(listed("pod")).toEqual(["chat-service-8g7f88v79d-2hth6"]);
    });

    it("writes the namespace facet into the URL", async () => {
      await mountPage();
      radio("k8s2-namespace-facet").vm.$emit("update:modelValue", "commerce");
      await flushPromises();
      expect(query()).toEqual({ namespace: "commerce" });
      expect(listed("pod")).toEqual([
        "inventory-service-blkdl5tcm2-94jdl",
        "order-service-6xphqm265w-nb2sq",
      ]);
      expect(wrapper.find('[data-test="k8s2-scope-namespace"]').text()).toBe("Namespace: commerce");
    });

    it("changing kind keeps the scope and name but clears sort, page and another kind's issue", async () => {
      await mountPage({
        namespace: "data",
        name: "rec",
        sort: "cpu",
        page: "2",
        issue: "podsRestarting",
      });
      wrapper.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "nodes");
      await flushPromises();
      expect(query()).toEqual({ kind: "nodes", namespace: "data", name: "rec" });
    });

    it.each([
      [{ name: "rec" }],
      [{ onNode: `${GEN}/ip-10-0-1-10.ec2.internal` }],
      [{ workload: `${GEN}/data/Deployment/recommendation-service` }],
      [
        {
          name: "rec",
          onNode: `${GEN}/ip-10-0-1-10.ec2.internal`,
          workload: `${GEN}/data/Deployment/recommendation-service`,
        },
      ],
    ])("a tile click clears the list-specific filters %j", async (filters) => {
      await mountPage(filters);
      await selectTile("podsContainerErrors");
      expect(query()).toEqual({ issue: "podsContainerErrors" });
      expect(wrapper.findAll('[data-test^="k8s2-pod-open-"]')).toHaveLength(
        tiles().podsContainerErrors,
      );
    });
  });

  describe("cross-links", () => {
    const twoClusters = () => {
      fixture = merge(generatorFixture(), generatorFixture("alpha"));
      serve();
    };

    it("a Deployment row opens its pods in that cluster only", async () => {
      twoClusters();
      await mountPage({ kind: "deployments", cluster: "*" });
      await wrapper
        .find(`[data-test="k8s2-deployment-open-alpha/data/recommendation-service"]`)
        .trigger("click");
      await flushPromises();
      expect(query()).toEqual({
        cluster: "alpha",
        namespace: "data",
        workload: "alpha/data/Deployment/recommendation-service",
      });
      expect(
        wrapper.findAll('[data-test^="k8s2-pod-open-"]').map((e) => e.attributes("data-test")),
      ).toEqual([
        "k8s2-pod-open-alpha/data/recommendation-service-9x58zgdb6z-jwhzq",
        "k8s2-pod-open-alpha/data/recommendation-service-9x58zgdb6z-sclvv",
      ]);
    });

    it("a Node row opens its pods in that cluster only", async () => {
      twoClusters();
      await mountPage({ kind: "nodes", cluster: "*" });
      await wrapper
        .find(`[data-test="k8s2-node-open-${GEN}/ip-10-0-13-37.ec2.internal"]`)
        .trigger("click");
      await flushPromises();
      expect(query()).toEqual({ cluster: GEN, onNode: `${GEN}/ip-10-0-13-37.ec2.internal` });
      expect(
        wrapper.findAll('[data-test^="k8s2-pod-open-"]').map((e) => e.attributes("data-test")),
      ).toEqual([`k8s2-pod-open-${GEN}/data/analytics-service-x6xv7pjxhb-zqcl4`]);
    });

    it("the drawer's node and owner links apply the same filters", async () => {
      await mountPage({ pod: `${GEN}/data/analytics-service-x6xv7pjxhb-zqcl4` });
      const drawer = wrapper.findComponent({ name: "PodDetailDrawer" });
      drawer.vm.$emit("filter-node", drawer.props("pod"));
      await flushPromises();
      expect(query()).toEqual({ cluster: GEN, onNode: `${GEN}/ip-10-0-13-37.ec2.internal` });
      await router.replace({ query: { pod: `${GEN}/data/analytics-service-x6xv7pjxhb-zqcl4` } });
      await flushPromises();
      const again = wrapper.findComponent({ name: "PodDetailDrawer" });
      again.vm.$emit("filter-owner", again.props("pod"));
      await flushPromises();
      expect(query()).toEqual({
        cluster: GEN,
        namespace: "data",
        workload: `${GEN}/data/Deployment/analytics-service`,
      });
    });

    it("round-trips an empty cluster as an empty segment", async () => {
      fixture = {
        K2: [{ metric: { k8s_namespace_name: "shop", k8s_pod_name: "web" }, value: 1 }],
        K3: [{ metric: { k8s_node_name: "node-1" }, value: 1 }],
      };
      serve();
      await mountPage({ kind: "nodes" });
      expect(wrapper.find('[data-test="k8s2-node-cluster-/node-1"]').text()).toBe("—");
      await wrapper.find('[data-test="k8s2-node-open-/node-1"]').trigger("click");
      await flushPromises();
      expect(query()).toEqual({ cluster: "*", onNode: "/node-1" });
    });
  });

  describe("pod drawer", () => {
    it("opens from a row, writes ?pod= encoded, and closes", async () => {
      await mountPage();
      await wrapper
        .find(`[data-test="k8s2-pod-open-${GEN}/chat/chat-service-8g7f88v79d-2hth6"]`)
        .trigger("click");
      await flushPromises();
      expect(query()).toEqual({ pod: `${GEN}/chat/chat-service-8g7f88v79d-2hth6` });
      const drawer = wrapper.findComponent({ name: "PodDetailDrawer" });
      expect(drawer.props("pod").name).toBe("chat-service-8g7f88v79d-2hth6");
      drawer.vm.$emit("close");
      await flushPromises();
      expect(query()).toEqual({});
      expect(wrapper.findComponent({ name: "PodDetailDrawer" }).exists()).toBe(false);
    });

    it("round-trips a pod name containing a slash", async () => {
      fixture = {
        P1: [
          {
            metric: { k8s_cluster: "c", namespace: "ns", pod: "a/b", uid: "u", phase: "Running" },
            value: 1,
          },
        ],
      };
      serve();
      await mountPage();
      await wrapper.find('[data-test="k8s2-pod-open-c/ns/a%2Fb"]').trigger("click");
      await flushPromises();
      expect(query().pod).toBe("c/ns/a%2Fb");
      expect(wrapper.findComponent({ name: "PodDetailDrawer" }).props("target")).toEqual([
        "c",
        "ns",
        "a/b",
      ]);
    });

    it("normalizes a deep link on another tab to Pods with the Pods-tab columns behind it", async () => {
      await mountPage({ kind: "nodes", pod: `${GEN}/data/analytics-service-x6xv7pjxhb-zqcl4` });
      expect(query()).toEqual({ pod: `${GEN}/data/analytics-service-x6xv7pjxhb-zqcl4` });
      const pod = wrapper.findComponent({ name: "PodDetailDrawer" }).props("pod");
      expect(pod.owner).toEqual({ kind: "Deployment", name: "analytics-service" });
      expect(pod.node).toBe("ip-10-0-13-37.ec2.internal");
      expect(pod.cpuRequest).toBe(1);
    });
  });

  it("an org switch clears every Kubernetes 2 param and refreshes detection", async () => {
    await mountPage({ cluster: "*", kind: "nodes", name: "x", pod: `${GEN}/a/b` });
    getStreams.mockClear();
    metricsQuery.mockClear();
    let releaseStreams: (v: any) => void = () => {};
    getStreams.mockReturnValue(new Promise((resolve) => (releaseStreams = resolve)));
    store.state.selectedOrganization = { identifier: "org2" };
    await flushPromises();
    expect(query()).toEqual({});
    expect(getStreams).toHaveBeenCalledWith("metrics", false, false, true);
    expect(wrapper.find('[data-test="k8s2-spinner"]').exists()).toBe(true);
    // A date change mid-switch must not query org2 with org1's stream set.
    wrapper
      .findComponent({ name: "DateTime" })
      .vm.$emit("on:date-change", { startTime: 1, endTime: 2, userChangedValue: true });
    await flushPromises();
    expect(metricsQuery).not.toHaveBeenCalled();
    releaseStreams({ list: [{ name: "kube_pod_status_phase" }] });
    await flushPromises();
    const calls = metricsQuery.mock.calls.map(([args]: any[]) => args);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.org_identifier === "org2")).toBe(true);
    expect(calls.map((c) => idOf(c.query))).toEqual(["P1"]);
  });

  describe("live-check and review fixes", () => {
    afterEach(() => {
      viewport.mdUp = true;
      viewport.lgUp = true;
    });

    it("Refresh reloads the stream list first, so an undetected page comes alive", async () => {
      await mountPage({}, ["system_cpu_time"]);
      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(true);
      getStreams.mockClear();
      getStreams.mockResolvedValue({ list: ALL_STREAMS.map((name) => ({ name })) });
      await wrapper.find('[data-test="k8s2-refresh"]').trigger("click");
      await flushPromises();
      expect(getStreams).toHaveBeenCalledTimes(1);
      expect(getStreams).toHaveBeenCalledWith("metrics", false, false, true);
      const ids = metricsQuery.mock.calls.map(([args]: any[]) => idOf(args.query));
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("Refresh picks up a family that arrived after the page loaded", async () => {
      await mountPage({ kind: "nodes" }, ["kube_pod_status_phase"]);
      metricsQuery.mockClear();
      getStreams.mockResolvedValue({ list: ALL_STREAMS.map((name) => ({ name })) });
      await wrapper.find('[data-test="k8s2-refresh"]').trigger("click");
      await flushPromises();
      expect(metricsQuery.mock.calls.map(([args]: any[]) => idOf(args.query))).toContain("N1");
    });

    it("keeps the facets in the page rail and Refresh among the secondary actions", async () => {
      await mountPage();
      expect(
        wrapper.find('[data-test="layout-sidebar"] [data-test="k8s2-name-filter"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="layout-overflow"] [data-test="k8s2-refresh"]').exists(),
      ).toBe(true);
    });

    it("puts the facets behind the side-panel drawer on a phone", async () => {
      viewport.mdUp = false;
      viewport.lgUp = false;
      await mountPage({}, ALL_STREAMS, { realLayout: true });
      expect(wrapper.find('[data-test="o-page-layout-mobile-sidebar-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="k8s2-name-filter"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="k8s2-pods-table"]').exists()).toBe(true);
    });

    it("selects the defaulted single cluster in the facet, matching the chip", async () => {
      await mountPage();
      expect(radio("k8s2-cluster-facet").props("modelValue")).toBe(GEN);
      expect(wrapper.find('[data-test="k8s2-scope-cluster"]').text()).toBe(`Cluster: ${GEN}`);
    });

    it("explains an ambiguous pod in its status cell", async () => {
      fixture = {
        P1: [
          {
            metric: { k8s_cluster: GEN, namespace: "data", pod: "db-0", uid: "A", phase: "Failed" },
            value: 1,
          },
          {
            metric: {
              k8s_cluster: GEN,
              namespace: "data",
              pod: "db-0",
              uid: "B",
              phase: "Running",
            },
            value: 1,
          },
        ],
      };
      serve();
      await mountPage(
        {},
        ALL_STREAMS.filter((name) => name !== "kube_pod_created"),
      );
      const cell = wrapper.find('[data-test="k8s2-pod-ambiguous"]');
      expect(cell.text()).toBe("—");
      expect(cell.attributes("aria-label")).toBe(
        "Several pod instances share this name and their creation time is unavailable",
      );
    });

    it("gives pod names the widest column and their full name on hover", async () => {
      await mountPage();
      const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as any[];
      const size = (id: string) => columns.find((c) => c.id === id).size;
      expect(size("name")).toBeGreaterThan(size("owner"));
      expect(size("name")).toBeGreaterThan(size("node"));
      const name = "recommendation-service-9x58zgdb6z-jwhzq";
      expect(
        wrapper.find(`[data-test="k8s2-pod-open-${GEN}/data/${name}"]`).attributes("title"),
      ).toBe(name);
    });
  });

  describe("navigation and state hygiene", () => {
    it("drops a node filter when leaving Pods, so a Deployment row shows only its pods", async () => {
      await mountPage({ kind: "nodes" });
      await wrapper
        .find(`[data-test="k8s2-node-open-${GEN}/ip-10-0-1-10.ec2.internal"]`)
        .trigger("click");
      await flushPromises();
      wrapper.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "deployments");
      await flushPromises();
      expect(query()).toEqual({ kind: "deployments", cluster: GEN });
      await wrapper
        .find(`[data-test="k8s2-deployment-open-${GEN}/data/analytics-service"]`)
        .trigger("click");
      await flushPromises();
      expect(query()).toEqual({
        cluster: GEN,
        namespace: "data",
        workload: `${GEN}/data/Deployment/analytics-service`,
      });
      expect(listed("pod")).toEqual(["analytics-service-x6xv7pjxhb-zqcl4"]);
    });

    it("a drawer link replaces an active issue filter", async () => {
      await mountPage({
        issue: "podsOomKilled",
        pod: `${GEN}/data/analytics-service-x6xv7pjxhb-zqcl4`,
      });
      const drawer = wrapper.findComponent({ name: "PodDetailDrawer" });
      drawer.vm.$emit("filter-node", drawer.props("pod"));
      await flushPromises();
      expect(query()).toEqual({ cluster: GEN, onNode: `${GEN}/ip-10-0-13-37.ec2.internal` });
    });

    it("rewrites a repeated param on any route change, not only on mount", async () => {
      fixture = merge(generatorFixture(), generatorFixture("alpha"));
      serve();
      await mountPage();
      await router.push({ query: { cluster: ["alpha", GEN] } });
      await flushPromises();
      expect(query()).toEqual({ cluster: "alpha" });
    });

    it("gives the All facet rows a count", async () => {
      fixture = merge(generatorFixture(), generatorFixture("alpha"));
      serve();
      await mountPage();
      expect(wrapper.find('[data-test="k8s2-cluster-facet-all-count"]').text()).toBe("18");
      expect(wrapper.find('[data-test="k8s2-namespace-facet-all-count"]').text()).toBe("9");
    });

    it("shows a skeleton, never All clusters, until the clusters are known", async () => {
      metricsQuery.mockReturnValue(new Promise(() => {}) as any);
      await mountPage();
      expect(wrapper.find('[data-test="k8s2-scope-cluster"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="k8s2-scope-skeleton"]').exists()).toBe(true);
    });

    it("drops the skeleton and the drawer spinner once every query has failed", async () => {
      metricsQuery.mockRejectedValue(new Error("engine down"));
      await mountPage({ pod: `${GEN}/chat/chat-service-8g7f88v79d-2hth6` });
      expect(wrapper.find('[data-test="k8s2-page-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="k8s2-scope-skeleton"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "PodDetailDrawer" }).props("pending")).toBe(false);
    });

    it("names the All tile after the tab", async () => {
      await mountPage();
      const label = () =>
        (wrapper.findComponent({ name: "OStatStrip" }).props("items") as any[])[0].label;
      expect(label()).toBe("All pods");
      wrapper.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "nodes");
      await flushPromises();
      expect(label()).toBe("All nodes");
    });

    it("a sort change returns to page 1", async () => {
      await mountPage({ page: "2" });
      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("sort-change", { column: "cpu", order: "desc" });
      await flushPromises();
      expect(query()).toEqual({ sort: "cpu", desc: "true" });
    });

    it("pushes history for tabs, links and the drawer, and replaces it for filters", async () => {
      await mountPage();
      const push = vi.spyOn(router, "push");
      const replace = vi.spyOn(router, "replace");
      radio("k8s2-namespace-facet").vm.$emit("update:modelValue", "data");
      await flushPromises();
      wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "rec");
      await flushPromises();
      expect(push).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledTimes(2);
      await wrapper
        .find(`[data-test="k8s2-pod-open-${GEN}/data/recommendation-service-9x58zgdb6z-jwhzq"]`)
        .trigger("click");
      await flushPromises();
      expect(push).toHaveBeenCalledTimes(1);
      router.back();
      await flushPromises();
      expect(query()).toEqual({ namespace: "data", name: "rec" });
      wrapper.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "nodes");
      await flushPromises();
      expect(push).toHaveBeenCalledTimes(2);
      router.back();
      await flushPromises();
      expect(query()).toEqual({ namespace: "data", name: "rec" });
    });
  });
});
