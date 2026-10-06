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
import { queryClient } from "@/composables/query/queryClient";
import KubernetesPage from "./KubernetesPage.vue";
import { QUERY_STREAM, VIEWS, queryText, type QueryId } from "./kubernetesQueries";

const getStreams = vi.fn();
const getStream = vi.fn();

vi.mock("@/services/search", () => ({ default: { metrics_query: vi.fn(), search: vi.fn() } }));
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
    },
    emits,
    setup(props) {
      return () => h("div", { "data-test": `stub-${name}`, "data-view": props.view });
    },
  });

const ListStub = recorder("K8sListView", ["open", "update", "refresh"]);
const MapStub = recorder("MapView", ["open", "update", "navigate", "refresh"]);
const ClusterStub = recorder("ClusterOverview", ["open", "refresh"]);
const WorkloadsStub = recorder("WorkloadsOverview", ["open", "update", "view", "refresh"]);
const DrawerStub = recorder("K8sDetailsDrawer", ["close", "open"]);

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

const dateTimeStub = defineComponent({
  name: "DateTime",
  emits: ["on:date-change"],
  setup(_p, { expose }) {
    expose({ refresh: () => {} });
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
    { metrics = ALL_STREAMS, logs = ["k8s_events"], eventFields = ["k8s_cluster"] } = {},
  ) => {
    getStreams.mockImplementation(async (type: string) => ({
      list: (type === "metrics" ? metrics : logs).map((name) => ({ name })),
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
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  const query = () => router.currentRoute.value.query;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    fixture = {
      CL1N: [{ metric: { k8s_cluster: "beta" }, value: 1 }],
      CL1P: [{ metric: { k8s_cluster: "alpha" }, value: 1 }],
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
        "namespaces",
        "events",
      ]);
      const text = wrapper.find('[data-test="layout-sidebar"]').text();
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
      await wrapper.find('[data-test="k8s2-rail-nodes"]').trigger("click");
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
      await wrapper.find('[data-test="k8s2-rail-deployments"]').trigger("click");
      await flushPromises();
      expect(query().namespace).toBe("a,b");
    });

    it("rewrites a fill that does not belong to the new map entity", async () => {
      await mountPage({ view: "map", fill: "memLim" });
      wrapper.findComponent(MapStub).vm.$emit("update", { entity: "nodes" });
      await flushPromises();
      expect(query()).toEqual({ view: "map", entity: "nodes" });
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
      await wrapper.find('[data-test="k8s2-rail-pods"]').trigger("click");
      await flushPromises();
      expect(wrapper.findComponent(ListStub).props("anchorMissing")).toBe("kube_pod_status_phase");
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
});
