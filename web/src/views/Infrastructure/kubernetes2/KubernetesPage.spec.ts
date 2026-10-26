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
import { toast } from "@/lib/feedback/Toast/useToast";
import { queryClient } from "@/composables/query/queryClient";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import K8sClusterHotbar from "./K8sClusterHotbar.vue";
import K8sCommandPalette from "./K8sCommandPalette.vue";
import KubernetesPage from "./KubernetesPage.vue";
import { QUERY_STREAM, VIEWS, queryText, type QueryId } from "./kubernetesQueries";

const shortcuts = vi.hoisted(() => ({ defs: [] as { id: string; handler: () => unknown }[] }));
const getStreams = vi.fn();
const getStream = vi.fn();

vi.mock("@/lib/vue-shortcut-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vue-shortcut-manager")>()),
  useShortcuts: (defs: { id: string; handler: () => unknown }[]) => {
    shortcuts.defs = defs;
  },
}));
vi.mock("@/services/search", () => ({ default: { metrics_query: vi.fn(), search: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams, getStream }) }));

const metricsQuery = vi.mocked(searchService.metrics_query);
const search = vi.mocked(searchService.search);

const ALL_IDS = Object.keys(QUERY_STREAM) as QueryId[];
const ALL_STREAMS = [...new Set(Object.values(QUERY_STREAM))];

type Row = { metric: Record<string, string>; value: number };

const unscope = (text: string) =>
  text
    .replace(/,?k8s_cluster(_name)?="(?:[^"\\]|\\.)*"/g, "")
    .replace(/\{,/g, "{")
    .replace(/\{\}/g, "");

const idOf = (query: string) =>
  ALL_IDS.find((q) => queryText(q) === unscope(decodeURIComponent(query))) as QueryId;

let fixture: Partial<Record<QueryId, Row[]>> = {};

const recorder = (name: string, emits: string[] = []) =>
  defineComponent({
    name,
    inheritAttrs: false,
    props: {
      view: String,
      rows: Array,
      state: Object,
      details: Object,
      row: Object,
      chip: String,
      anchorMissing: String,
      loading: Boolean,
      objects: Object,
      pods: Array,
      nodes: Array,
    },
    emits,
    setup(props) {
      return () => h("div", { "data-test": `stub-${name}`, "data-view": props.view });
    },
  });

const ListStub = recorder("K8sListView", ["open", "update", "refresh", "action"]);
const MapStub = recorder("MapView", ["open", "update", "navigate", "refresh"]);
const ClusterStub = recorder("ClusterOverview", ["open", "refresh", "navigate"]);
const WorkloadsStub = recorder("WorkloadsOverview", ["open", "update", "view", "refresh"]);
const DrawerStub = recorder("K8sDetailsDrawer", ["close", "open"]);

const LogsPanelStub = defineComponent({
  name: "K8sLogsPanel",
  props: { target: Object },
  setup() {
    return () => h("div", { "data-test": "stub-K8sLogsPanel" });
  },
});
const YamlPanelStub = defineComponent({
  name: "K8sYamlPanel",
  props: { row: Object },
  setup() {
    return () => h("div", { "data-test": "stub-K8sYamlPanel" });
  },
});

const layoutStub = defineComponent({
  name: "OPageLayout",
  setup(_p, { slots }) {
    return () =>
      h("div", {}, [
        h("div", { "data-test": "layout-actions" }, slots.actions?.()),
        h("div", { "data-test": "layout-sidebar" }, slots.sidebar?.()),
        slots.default?.(),
      ]);
  },
});

const setRelativeDate = vi.fn();
const DAY_US = 24 * 3_600_000_000;

const dateTimeStub = defineComponent({
  name: "DateTime",
  emits: ["on:date-change"],
  setup(_p, { expose, emit }) {
    expose({
      refresh: () => {},
      setRelativeDate: (period: string, value: number) => {
        setRelativeDate(period, value);
        const end = Date.now() * 1000;
        emit("on:date-change", {
          startTime: end - DAY_US,
          endTime: end,
          valueType: "relative",
          userChangedValue: true,
        });
      },
    });
    return () => h("div");
  },
});

const setupCardStub = defineComponent({
  name: "DataSourceSetupCard",
  setup() {
    return () => h("div", { "data-test": "setup-card-stub" });
  },
});

describe("KubernetesPage", () => {
  let wrapper: VueWrapper<any>;
  let router: any;
  let store: any;

  const mountPage = async (
    query: Record<string, string> = {},
    {
      metrics = ALL_STREAMS,
      logs = ["k8s_events"],
      traces = ["default"],
      eventFields = ["k8s_cluster"],
    } = {},
  ) => {
    getStreams.mockImplementation(async (type: string) => ({
      list: (type === "metrics" ? metrics : type === "traces" ? traces : logs).map((name) => ({
        name,
      })),
    }));
    getStream.mockResolvedValue({ schema: eventFields.map((name) => ({ name })) });
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
        {
          path: "/infra/kubernetes-2",
          name: "infraKubernetes2",
          component: { template: "<div />" },
        },
      ],
    });
    await router.push({ path: "/infra/kubernetes-2", query });
    await router.isReady();
    wrapper = mount(KubernetesPage, {
      global: {
        plugins: [store, router, i18n],
        stubs: {
          OPageLayout: layoutStub,
          DateTime: dateTimeStub,
          DataSourceSetupCard: setupCardStub,
          K8sListView: ListStub,
          MapView: MapStub,
          ClusterOverview: ClusterStub,
          WorkloadsOverview: WorkloadsStub,
          K8sDetailsDrawer: DrawerStub,
          K8sLogsPanel: LogsPanelStub,
          K8sYamlPanel: YamlPanelStub,
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  const query = () => router.currentRoute.value.query;

  const clickRail = async (view: string) => {
    const rail = wrapper.find(`[data-test="k8s2-rail-${view}"]`);
    await rail.trigger("mousedown", { button: 0 });
    await rail.trigger("click");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    fixture = {
      CL1N: [{ metric: { k8s_cluster: "beta" }, value: 1 }],
      CL1P: [{ metric: { k8s_cluster: "alpha" }, value: 1 }],
      N1: [
        {
          metric: { k8s_cluster: "alpha", node: "n1", condition: "Ready", status: "true" },
          value: 1,
        },
      ],
      P1: [
        {
          metric: { k8s_cluster: "alpha", namespace: "a", pod: "p", uid: "u", phase: "Running" },
          value: 1,
        },
      ],
    };
    metricsQuery.mockImplementation((async ({ query: q }: { query: string }) => ({
      data: {
        data: {
          result: (fixture[idOf(q)] ?? []).map((r) => ({
            metric: r.metric,
            value: [1, String(r.value)],
          })),
        },
      },
    })) as any);
    search.mockResolvedValue({ data: { hits: [] } } as any);
  });

  afterEach(() => wrapper?.unmount());

  describe("views", () => {
    it("renders the Cluster overview with no view", async () => {
      await mountPage();
      expect(wrapper.find('[data-test="stub-ClusterOverview"]').exists()).toBe(true);
    });

    it.each(VIEWS.filter((v) => !["cluster", "map", "workloads"].includes(v)))(
      "renders the list for view=%s",
      async (view) => {
        await mountPage({ view });
        expect(wrapper.findComponent(ListStub).props("view")).toBe(view);
      },
    );

    it("renders the Map and the Workloads overview", async () => {
      await mountPage({ view: "map" });
      expect(wrapper.findComponent(MapStub).exists()).toBe(true);
      wrapper.unmount();
      await mountPage({ view: "workloads" });
      expect(wrapper.findComponent(WorkloadsStub).exists()).toBe(true);
    });

    it("shows the offline state when a cluster reports no nodes or pods", async () => {
      fixture = {
        CL1N: [{ metric: { k8s_cluster: "alpha" }, value: 1 }],
      };
      await mountPage();
      expect(wrapper.find('[data-test="k8s2-offline"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="stub-ClusterOverview"]').exists()).toBe(false);
    });

    it("does not call the cluster offline when one of its queries failed", async () => {
      fixture = {
        CL1N: [{ metric: { k8s_cluster: "alpha" }, value: 1 }],
      };
      const ok = metricsQuery.getMockImplementation()!;
      metricsQuery.mockImplementation(((args: { query: string }) =>
        idOf(args.query) === "N1" ? Promise.reject(new Error("boom")) : ok(args as any)) as any);
      await mountPage();
      expect(wrapper.find('[data-test="k8s2-offline"]').exists()).toBe(false);
    });

    it("keeps list views out of the offline state, since an empty filter is not a silent cluster", async () => {
      fixture = {
        CL1N: [{ metric: { k8s_cluster: "alpha" }, value: 1 }],
      };
      await mountPage({ view: "pods" });
      expect(wrapper.find('[data-test="k8s2-offline"]').exists()).toBe(false);
    });

    it("rewrites an unknown view to the Cluster overview", async () => {
      await mountPage({ view: "secrets" });
      expect(query().view).toBeUndefined();
      expect(wrapper.findComponent(ClusterStub).exists()).toBe(true);
    });
  });

  describe("sidebar", () => {
    const railItems = () =>
      wrapper
        .findAll('[data-test^="k8s2-rail-"]')
        .map((el) => el.attributes("data-test")!.slice(10));

    it("lists the §3.1 groups and items in order, with nothing for Config, Network, Helm or Access Control", async () => {
      await mountPage();
      expect(railItems()).toEqual([
        "cluster",
        "map",
        "nodes",
        "namespaces",
        "events",
        "workloads",
        "pods",
        "deployments",
        "daemonsets",
        "statefulsets",
        "replicasets",
        "jobs",
        "cronjobs",
        "pvcs",
        "hpas",
      ]);
      const text = wrapper.find('[data-test="k8s2-tree"]').text();
      for (const label of ["Cluster", "Workloads", "Storage", "Autoscaling"])
        expect(text).toContain(label);
      for (const absent of [
        "Config",
        "Network",
        "Helm",
        "Access Control",
        "Custom Resources",
        "Storage Classes",
      ]) {
        expect(text).not.toContain(absent);
      }
    });

    it("pushes the view, keeps cluster and namespace, clears the rest and closes an open drawer; Back restores", async () => {
      await mountPage({
        view: "pods",
        cluster: "alpha",
        namespace: "shop",
        search: "x",
        sort: "cpu",
        desc: "true",
        details: "pod/alpha/shop/web",
      });
      expect(wrapper.findComponent(DrawerStub).exists()).toBe(true);
      await clickRail("nodes");
      await flushPromises();
      expect(query()).toEqual({ view: "nodes", cluster: "alpha", namespace: "shop" });
      expect(wrapper.findComponent(DrawerStub).exists()).toBe(false);
      router.back();
      await flushPromises();
      expect(query()).toMatchObject({ view: "pods", details: "pod/alpha/shop/web", search: "x" });
    });
  });

  describe("URL writes", () => {
    it("writes search, sort and namespace with replace, adding no history entry", async () => {
      await mountPage({ view: "pods" });
      const replace = vi.spyOn(router, "replace");
      const push = vi.spyOn(router, "push");
      for (const patch of [
        { search: "web" },
        { sort: "cpu", desc: true },
        { namespaces: ["a", "b"] },
      ]) {
        wrapper.findComponent(ListStub).vm.$emit("update", patch);
        await flushPromises();
      }
      expect(push).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledTimes(3);
      expect(query()).toMatchObject({ search: "web", sort: "cpu", desc: "true", namespace: "a,b" });
    });

    it("keeps the namespace selection across views", async () => {
      await mountPage({ view: "pods", namespace: "a,b" });
      await clickRail("deployments");
      await flushPromises();
      expect(query().namespace).toBe("a,b");
    });

    it("rewrites a fill that does not belong to the new map entity", async () => {
      await mountPage({ view: "map", fill: "memLim" });
      wrapper.findComponent(MapStub).vm.$emit("update", { entity: "nodes" });
      await flushPromises();
      expect(query()).toEqual({ view: "map", entity: "nodes" });
    });

    it("resets the group and the filter on an entity change (AC 76)", async () => {
      await mountPage({ view: "map", group: "workload", filter: "app:web" });
      wrapper.findComponent(MapStub).vm.$emit("update", { entity: "nodes" });
      await flushPromises();
      expect(query()).toEqual({ view: "map", entity: "nodes" });
      wrapper.findComponent(MapStub).vm.$emit("update", { group: "label.zone", filter: ["z:a"] });
      await flushPromises();
      wrapper.findComponent(MapStub).vm.$emit("update", { entity: "pods" });
      await flushPromises();
      expect(query()).toEqual({ view: "map" });
    });

    it("re-filters on a filter change without sending a request (AC 81)", async () => {
      await mountPage({ view: "map", cluster: "alpha" });
      const sent = metricsQuery.mock.calls.length + search.mock.calls.length;
      wrapper.findComponent(MapStub).vm.$emit("update", { filter: ["app:web"] });
      await flushPromises();
      expect(query().filter).toBe("app:web");
      expect(metricsQuery.mock.calls.length + search.mock.calls.length).toBe(sent);
    });
  });

  describe("map rows", () => {
    it("hands the map the same pods and nodes arrays across renders that do not change them", async () => {
      await mountPage({ view: "map", cluster: "alpha" });
      const map = () => wrapper.findComponent(MapStub);
      const [pods, nodes] = [map().props("pods"), map().props("nodes")];
      expect(pods).toBeDefined();
      wrapper.findComponent(MapStub).vm.$emit("update", { search: "web" });
      await flushPromises();
      expect(query().search).toBe("web");
      expect(map().props("pods")).toBe(pods);
      expect(map().props("nodes")).toBe(nodes);
    });
  });

  describe("map grouping and requests", () => {
    const sent = () => [metricsQuery.mock.calls.length, search.mock.calls.length];
    const sentIds = () => metricsQuery.mock.calls.map(([args]: any[]) => idOf(args.query));

    it("sends nothing on a group change that reuses loaded rows, even with a cold cache", async () => {
      await mountPage({ view: "map", cluster: "alpha", group: "none" });
      queryClient.clear();
      const before = sent();
      for (const group of ["label.app", "namespace", "workload", "none"]) {
        wrapper.findComponent(MapStub).vm.$emit("update", { group });
        await flushPromises();
        expect(query().group).toBe(group);
      }
      expect(sent()).toEqual(before);
    });

    it("adds only N1 when grouping pods by node", async () => {
      await mountPage({ view: "map", cluster: "alpha", group: "none" });
      const [metrics, sql] = sent();
      wrapper.findComponent(MapStub).vm.$emit("update", { group: "node" });
      await flushPromises();
      expect(sentIds().slice(metrics)).toEqual(["N1"]);
      expect(search.mock.calls.length).toBe(sql);
    });
  });

  describe("map label objects (AC 81)", () => {
    const POD_OBJECTS = "k8s_resource_name = 'pods'";
    const objects = () => wrapper.findComponent(MapStub).props("objects");

    it.each([
      ["noStream", { logs: [] }],
      ["unscoped", { eventFields: [] }],
      ["anchor", { metrics: ALL_STREAMS.filter((s) => s !== "kube_pod_status_phase") }],
    ])("is skipped with reason %s", async (reason, streams) => {
      fixture = { ...fixture, CL1N: [{ metric: { k8s_cluster: "alpha" }, value: 1 }] };
      await mountPage({ view: "map", cluster: "alpha" }, streams);
      expect(objects()).toEqual({ state: "skipped", reason });
    });

    it("is failed when O:pod is rejected, and ok once it settles", async () => {
      search.mockImplementation((async (args: any) => {
        if (args.query.query.sql.includes(POD_OBJECTS)) throw new Error("boom");
        return { data: { hits: [] } };
      }) as any);
      await mountPage({ view: "map", cluster: "alpha" });
      expect(objects()).toEqual({ state: "failed" });
      wrapper.unmount();
      queryClient.clear();
      search.mockResolvedValue({ data: { hits: [] } } as any);
      await mountPage({ view: "map", cluster: "alpha" });
      expect(objects()).toEqual({ state: "ok" });
    });

    it("is loading while O:pod is in flight", async () => {
      let release: (v: any) => void = () => {};
      search.mockImplementation(((args: any) =>
        args.query.query.sql.includes(POD_OBJECTS)
          ? new Promise((resolve) => (release = resolve))
          : Promise.resolve({ data: { hits: [] } })) as any);
      await mountPage({ view: "map", cluster: "alpha" });
      expect(objects()).toEqual({ state: "loading" });
      release({ data: { hits: [] } });
      await flushPromises();
      expect(objects()).toEqual({ state: "ok" });
    });

    // The Pods list's O:pod has no labels, so it must not count as the map's.
    const holdMapObjects = () =>
      search.mockImplementation(((args: any) =>
        args.query.query.sql.includes(POD_OBJECTS) && args.query.query.sql.includes("AS labels")
          ? new Promise(() => {})
          : Promise.resolve({ data: { hits: [] } })) as any);

    it("is loading, not ok, while the map loads after the Pods list", async () => {
      await mountPage({ view: "pods", cluster: "alpha" });
      holdMapObjects();
      await router.push({ query: { view: "map", cluster: "alpha" } });
      await flushPromises();
      expect(objects()).toEqual({ state: "loading" });
    });

    it("is skipped, not loading forever, when no cluster can be resolved", async () => {
      fixture = {};
      await mountPage({ view: "map", filter: "app:web" });
      expect(objects()).toEqual({ state: "skipped", reason: "noCluster" });
    });

    it("is loading, not ok, while the map reloads for another cluster", async () => {
      await mountPage({ view: "map", cluster: "alpha" });
      expect(objects()).toEqual({ state: "ok" });
      holdMapObjects();
      wrapper.findComponent(MapStub).vm.$emit("update", { cluster: "beta" });
      await flushPromises();
      expect(objects()).toEqual({ state: "loading" });
    });

    it("is loading, not ok, while the map reloads for a wider namespace scope", async () => {
      await mountPage({ view: "map", cluster: "alpha", namespace: "a" });
      expect(objects()).toEqual({ state: "ok" });
      holdMapObjects();
      wrapper.findComponent(MapStub).vm.$emit("update", { namespaces: [] });
      await flushPromises();
      expect(objects()).toEqual({ state: "loading" });
    });

    it("is loading while a Refresh reloads the filtered map's labels", async () => {
      await mountPage({ view: "map", cluster: "alpha", filter: "app:web" });
      expect(objects()).toEqual({ state: "ok" });
      holdMapObjects();
      wrapper.findComponent(MapStub).vm.$emit("refresh");
      await flushPromises();
      expect(objects()).toEqual({ state: "loading" });
    });

    it("stays ok while grouping by node reloads with the same object query", async () => {
      await mountPage({ view: "map", cluster: "alpha", group: "none", filter: "app:web" });
      expect(objects()).toEqual({ state: "ok" });
      holdMapObjects();
      wrapper.findComponent(MapStub).vm.$emit("update", { group: "node" });
      await wrapper.vm.$nextTick();
      expect(objects()).toEqual({ state: "ok" });
      await flushPromises();
      expect(objects()).toEqual({ state: "ok" });
    });

    it("is loading when coming back to a filtered map from the Pods list", async () => {
      await mountPage({ view: "map", cluster: "alpha", filter: "app:web" });
      expect(objects()).toEqual({ state: "ok" });
      await router.push({ query: { view: "pods", cluster: "alpha" } });
      await flushPromises();
      queryClient.clear();
      holdMapObjects();
      await router.push({ query: { view: "map", cluster: "alpha", filter: "app:web" } });
      await flushPromises();
      expect(objects()).toEqual({ state: "loading" });
    });
  });

  describe("overview navigation", () => {
    it("opens the failing pods filter from a KPI tile without carrying the old search", async () => {
      await mountPage({ view: "cluster", cluster: "alpha", search: "stale" });
      wrapper
        .findComponent({ name: "ClusterOverview" })
        .vm.$emit("navigate", { view: "pods", status: "failing" });
      await flushPromises();
      expect(query()).toMatchObject({ view: "pods", status: "failing" });
      expect(query().search).toBeUndefined();
    });
  });

  describe("cluster", () => {
    it("lists CL1 ∪ CL2 clusters on the Events view and defaults to the first alphabetically", async () => {
      await mountPage({ view: "events" });
      const select = wrapper.find('[data-test="k8s2-cluster-select"]');
      expect(select.exists()).toBe(true);
      const options = wrapper.findComponent('[data-test="k8s2-cluster-select"]').props("options");
      expect(options.map((o: any) => o.value)).toEqual(["alpha", "beta"]);
      expect(query().cluster).toBeUndefined();
    });

    it("rewrites cluster=* to the default", async () => {
      await mountPage({ view: "pods", cluster: "*" });
      expect(query().cluster).toBeUndefined();
    });

    it("clears details on a cluster change", async () => {
      await mountPage({ view: "pods", cluster: "alpha", details: "pod/alpha/a/x" });
      wrapper
        .findComponent('[data-test="k8s2-cluster-select"]')
        .vm.$emit("update:modelValue", "beta");
      await flushPromises();
      expect(query()).toEqual({ view: "pods", cluster: "beta" });
    });

    it("opens a shared drawer link in its own cluster", async () => {
      await mountPage({ view: "pods", cluster: "alpha", details: "pod/beta/ns/x" });
      expect(query().cluster).toBe("beta");
      expect(wrapper.findComponent(DrawerStub).props("details")).toEqual({
        kind: "pod",
        cluster: "beta",
        namespace: "ns",
        name: "x",
      });
    });

    it("hides the selector when no cluster can be listed", async () => {
      fixture = {};
      await mountPage({ view: "events" }, { metrics: [], eventFields: [] });
      expect(wrapper.find('[data-test="k8s2-cluster-select"]').exists()).toBe(false);
    });
  });

  it("marks the list loading, not empty, while a new view's data is on its way", async () => {
    await mountPage({ view: "pods" });
    expect(wrapper.findComponent(ListStub).props("loading")).toBe(false);
    metricsQuery.mockImplementation((() => new Promise(() => {})) as any);
    await clickRail("nodes");
    await flushPromises();
    expect(wrapper.findComponent(ListStub).props("view")).toBe("nodes");
    expect(wrapper.findComponent(ListStub).props("loading")).toBe(true);
  });

  describe("phone chrome", () => {
    it("offers an icon-only palette button for narrow screens", async () => {
      await mountPage();
      const compact = wrapper.find('[data-test="k8s2-palette-open-compact"]');
      expect(compact.exists()).toBe(true);
      expect(compact.classes()).toContain("md:hidden");
      expect(compact.attributes("aria-label")).toBeTruthy();
      expect(wrapper.find('[data-test="k8s2-palette-open"]').classes()).toContain("max-md:hidden");
    });

    it("opens the palette from the compact button", async () => {
      await mountPage();
      await wrapper.find('[data-test="k8s2-palette-open-compact"]').trigger("click");
      expect(wrapper.findComponent({ name: "K8sCommandPalette" }).props("open")).toBe(true);
    });

    it("shows totals in the view select options", async () => {
      await mountPage();
      const options = wrapper
        .findComponent('[data-test="k8s2-view-select"]')
        .props("options") as any[];
      expect(options.some((o) => typeof o.label === "string" && /\(\d+\)$/.test(o.label))).toBe(
        true,
      );
    });
  });

  describe("row actions", () => {
    const pod = { kind: "pod", cluster: "alpha", namespace: "shop", name: "web-1" };

    const act = async (type: string, options?: Parameters<typeof mountPage>[1]) => {
      await mountPage({ view: "pods", cluster: "alpha" }, options);
      const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      wrapper.findComponent(ListStub).vm.$emit("action", type, pod);
      await flushPromises();
      return push;
    };

    it("opens Traces on the org's trace stream, preferring default", async () => {
      const push = await act("traces", { traces: ["zeta", "default"] });
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "traces",
          query: expect.objectContaining({ stream: "default", org_identifier: "org1" }),
        }),
      );
    });

    it("falls back to the first trace stream when there is no default", async () => {
      const push = await act("traces", { traces: ["zeta", "alpha-traces"] });
      expect(push.mock.calls[0][0]).toMatchObject({ query: { stream: "alpha-traces" } });
    });

    it("says which trace stream it opened when the org has several", async () => {
      await act("traces", { traces: ["zeta", "default"] });
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "info", message: expect.stringContaining("default") }),
      );
    });

    it("stays quiet when the org has a single trace stream", async () => {
      vi.mocked(toast).mockClear();
      await act("traces", { traces: ["default"] });
      expect(toast).not.toHaveBeenCalled();
    });

    it("does not navigate when the org has no trace stream", async () => {
      const push = await act("traces", { traces: [] });
      expect(push).not.toHaveBeenCalled();
    });

    it("opens Metrics with the pod's query", async () => {
      const push = await act("metrics");
      expect(push.mock.calls[0][0]).toMatchObject({
        name: "metrics",
        query: { query_type: "promql", stream_name: "k8s_pod_cpu_usage" },
      });
    });
  });

  describe("wiring", () => {
    const ref = { kind: "pod", cluster: "alpha", namespace: "a", name: "p" };
    const palette = () => wrapper.findComponent(K8sCommandPalette);
    const item = (target: unknown) => ({ target });

    it.each(["logs", "yaml"])("opens a %s dock tab from a list row action", async (kind) => {
      await mountPage({ view: "pods", cluster: "alpha" });
      expect(wrapper.find('[data-test="k8s2-dock"]').exists()).toBe(false);
      wrapper.findComponent(ListStub).vm.$emit("action", kind, ref);
      await flushPromises();
      expect(wrapper.find('[data-test="k8s2-dock"]').exists()).toBe(true);
      expect(wrapper.find(`[data-test="k8s2-dock-close-${kind}"]`).exists()).toBe(true);
    });

    it("keeps the YAML manifest after the row leaves the inventory", async () => {
      await mountPage({ view: "pods", cluster: "alpha" });
      wrapper.findComponent(ListStub).vm.$emit("action", "yaml", ref);
      await flushPromises();
      expect(wrapper.findComponent(YamlPanelStub).props("row")).toMatchObject({ name: "p" });
      fixture = { ...fixture, P1: [] };
      queryClient.clear();
      wrapper.findComponent(ListStub).vm.$emit("refresh");
      await flushPromises();
      expect(wrapper.findComponent(ListStub).props("rows")).toEqual([]);
      expect(wrapper.findComponent(YamlPanelStub).props("row")).toMatchObject({ name: "p" });
    });

    it("switches the cluster in the URL from the hot-bar", async () => {
      await mountPage({ view: "pods", cluster: "alpha" });
      wrapper.findComponent(K8sClusterHotbar).vm.$emit("select", "beta");
      await flushPromises();
      expect(query().cluster).toBe("beta");
    });

    it("opens the palette on its clusters group from the hot-bar", async () => {
      await mountPage();
      wrapper.findComponent(K8sClusterHotbar).vm.$emit("all");
      await flushPromises();
      expect(palette().props("open")).toBe(true);
      expect(palette().props("group")).toBe("clusters");
    });

    it("toggles the palette from the k8sPalette shortcut", async () => {
      await mountPage();
      const toggle = () => shortcuts.defs.find((d) => d.id === "k8sPalette")!.handler();
      toggle();
      await flushPromises();
      expect(palette().props("open")).toBe(true);
      toggle();
      await flushPromises();
      expect(palette().props("open")).toBe(false);
    });

    it("routes a palette view, cluster and details choice", async () => {
      await mountPage({ view: "nodes", cluster: "alpha" });
      palette().vm.$emit("select", item({ type: "view", view: "pods" }));
      await flushPromises();
      expect(query().view).toBe("pods");
      palette().vm.$emit("select", item({ type: "cluster", cluster: "beta" }));
      await flushPromises();
      expect(query().cluster).toBe("beta");
      palette().vm.$emit("select", item({ type: "details", details: { ...ref, cluster: "beta" } }));
      await flushPromises();
      expect(query().details).toBe("pod/beta/a/p");
    });

    it("explains an empty last-known range instead of repeating the offline copy", async () => {
      fixture = { CL1N: [{ metric: { k8s_cluster: "alpha" }, value: 1 }] };
      await mountPage();
      const description = () => wrapper.findComponent(OEmptyState).props("description");
      expect(description()).toContain("No nodes or pods were reported");
      queryClient.clear();
      wrapper.findComponent(OEmptyState).vm.$emit("action");
      await flushPromises();
      expect(wrapper.find('[data-test="k8s2-offline"]').exists()).toBe(true);
      expect(description()).toBe("Nothing was reported in the last 24 hours either.");
    });
  });

  describe("drawer", () => {
    const pod = (name: string) => ({ kind: "pod", cluster: "alpha", namespace: "shop", name });

    it("opens with push, swaps in place on another row, toggles on the same row, and Back closes", async () => {
      await mountPage({ view: "pods", cluster: "alpha" });
      const push = vi.spyOn(router, "push");
      wrapper.findComponent(ListStub).vm.$emit("open", pod("a"));
      await flushPromises();
      expect(query().details).toBe("pod/alpha/shop/a");
      const drawer = wrapper.findComponent(DrawerStub);
      wrapper.findComponent(ListStub).vm.$emit("open", pod("b"));
      await flushPromises();
      expect(query().details).toBe("pod/alpha/shop/b");
      expect(wrapper.findComponent(DrawerStub).vm).toBe(drawer.vm);
      expect(push).toHaveBeenCalledTimes(2);
      router.back();
      await flushPromises();
      expect(query().details).toBe("pod/alpha/shop/a");
      wrapper.findComponent(ListStub).vm.$emit("open", pod("a"));
      await flushPromises();
      expect(query().details).toBeUndefined();
    });

    it("swaps in place for an in-drawer link and closes with replace", async () => {
      await mountPage({ view: "pods", cluster: "alpha", details: "pod/alpha/shop/a" });
      const drawer = wrapper.findComponent(DrawerStub);
      drawer.vm.$emit("open", { kind: "node", cluster: "alpha", namespace: "", name: "n1" });
      await flushPromises();
      expect(query().details).toBe("node/alpha//n1");
      expect(wrapper.findComponent(DrawerStub).vm).toBe(drawer.vm);
      const replace = vi.spyOn(router, "replace");
      wrapper.findComponent(DrawerStub).vm.$emit("close");
      await flushPromises();
      expect(replace).toHaveBeenCalled();
      expect(query().details).toBeUndefined();
    });
  });

  describe("faces", () => {
    it("shows a spinner while detection is unresolved", async () => {
      getStreams.mockReturnValue(new Promise(() => {}));
      store = null;
      wrapper = mount(KubernetesPage, {
        global: {
          plugins: [
            createStore({ state: { selectedOrganization: { identifier: "o" }, zoConfig: {} } }),
            createRouter({
              history: createMemoryHistory(),
              routes: [{ path: "/", component: { template: "<div/>" } }],
            }),
            i18n,
          ],
          stubs: { OPageLayout: layoutStub, DateTime: dateTimeStub },
        },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="k8s2-spinner"]').exists()).toBe(true);
    });

    it("shows the setup card without metric detection streams or k8s_events", async () => {
      await mountPage({}, { metrics: ["system_cpu"], logs: ["default"] });
      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(true);
    });

    it("lands an events-only org on Events, where every metric view shows its anchor state", async () => {
      fixture = {};
      await mountPage({}, { metrics: [] });
      expect(query().view).toBe("events");
      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(false);
      await clickRail("pods");
      await flushPromises();
      expect(wrapper.findComponent(ListStub).props("anchorMissing")).toBe("kube_pod_status_phase");
    });

    it("lets an events-only org go back to the Cluster overview after landing on Events", async () => {
      fixture = {};
      await mountPage({}, { metrics: [] });
      expect(query().view).toBe("events");
      await clickRail("cluster");
      await flushPromises();
      expect(query().view).toBeUndefined();
      expect(wrapper.findComponent(ClusterStub).exists()).toBe(true);
    });

    it("shows the stream-list error with a forced Retry", async () => {
      getStreams.mockRejectedValueOnce(new Error("down"));
      await mountPage();
      expect(wrapper.find('[data-test="k8s2-streams-error"]').exists()).toBe(true);
    });

    it("shows the page error when every query is rejected", async () => {
      metricsQuery.mockRejectedValue(new Error("all down"));
      search.mockRejectedValue(new Error("all down"));
      await mountPage({ view: "pods" });
      expect(wrapper.find('[data-test="k8s2-page-error"]').exists()).toBe(true);
    });
  });

  it("shows the unscoped chip on Events when k8s_events has no cluster label", async () => {
    await mountPage({ view: "events" }, { eventFields: [] });
    expect(wrapper.findComponent(ListStub).props("chip")).toBe(
      "All clusters — events are not cluster-labelled",
    );
  });

  it("puts no Refresh in the page header, and a view's Refresh forces every read", async () => {
    await mountPage({ view: "pods" });
    expect(wrapper.find('[data-test="layout-actions"] [data-test="k8s2-refresh"]').exists()).toBe(
      false,
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const before = metricsQuery.mock.calls.length;
    wrapper.findComponent(ListStub).vm.$emit("refresh");
    await flushPromises();
    expect(getStreams).toHaveBeenLastCalledWith("logs", false, false, true);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["org", "org1", "kubernetes"],
      refetchType: "none",
    });
    expect(metricsQuery.mock.calls.length).toBeGreaterThan(before);
  });

  it("strips every page param, resets and reloads streams on an org switch", async () => {
    await mountPage({ view: "pods", cluster: "alpha", namespace: "a", details: "pod/alpha/a/x" });
    store.state.selectedOrganization = { identifier: "org2" };
    await flushPromises();
    expect(query()).toEqual({});
    expect(getStreams).toHaveBeenLastCalledWith("logs", false, false, true);
  });

  it("builds palette items only while the palette is open", async () => {
    await mountPage();
    const palette = () => wrapper.findComponent(K8sCommandPalette);
    expect(palette().props("items")).toEqual([]);
    await wrapper.find('[data-test="k8s2-palette-open"]').trigger("click");
    await flushPromises();
    expect(palette().props("items").length).toBeGreaterThan(0);
  });

  it("clears the last-known banner once the user picks another range", async () => {
    fixture = { CL1N: [{ metric: { k8s_cluster: "alpha" }, value: 1 }] };
    await mountPage();
    expect(wrapper.find('[data-test="k8s2-offline"]').exists()).toBe(true);
    fixture = {
      CL1N: [{ metric: { k8s_cluster: "alpha" }, value: 1 }],
      N1: [
        {
          metric: { k8s_cluster: "alpha", node: "n1", condition: "Ready", status: "true" },
          value: 1,
        },
      ],
    };
    // The relative range rounds to the same cache key, so drop it to force a real reload.
    queryClient.clear();
    wrapper.findComponent(OEmptyState).vm.$emit("action");
    await flushPromises();
    expect(setRelativeDate).toHaveBeenCalledWith("d", 1);
    expect(wrapper.find('[data-test="k8s2-banner-last-known"]').exists()).toBe(true);

    wrapper.findComponent(dateTimeStub).vm.$emit("on:date-change", {
      startTime: 1,
      endTime: 2,
      valueType: "relative",
      userChangedValue: true,
    });
    await flushPromises();
    expect(wrapper.find('[data-test="k8s2-banner-last-known"]').exists()).toBe(false);
  });

  it("renders the view select and routes the choice to the URL", async () => {
    await mountPage();
    const select = wrapper.findComponent('[data-test="k8s2-view-select"]');
    expect(select.exists()).toBe(true);
    expect(select.classes()).toContain("md:hidden");
    const values = (select.props("options") as { value?: string }[])
      .map((option) => option.value)
      .filter(Boolean);
    expect(values).toEqual(expect.arrayContaining(["cluster", "pods", "nodes"]));
    select.vm.$emit("update:modelValue", "pods");
    await flushPromises();
    expect(query().view).toBe("pods");
  });
});
