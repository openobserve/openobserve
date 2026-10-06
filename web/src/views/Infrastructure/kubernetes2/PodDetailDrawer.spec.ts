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
import PodDetailDrawer from "./PodDetailDrawer.vue";
import type { PodRow } from "./kubernetesModel";
import { resolvePodLogs } from "./podLogsLink";

const toastMock = vi.fn();

vi.mock("@/services/search", () => ({ default: { metrics_query_range: vi.fn() } }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({}) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: any[]) => toastMock(...args) }));
vi.mock("./podLogsLink", () => ({ resolvePodLogs: vi.fn() }));

const rangeQuery = vi.mocked(searchService.metrics_query_range);
const resolveMock = vi.mocked(resolvePodLogs);

const makePod = (over: Partial<PodRow> = {}): PodRow => ({
  key: "prod/shop/web-1",
  cluster: "prod",
  namespace: "shop",
  name: "web-1",
  uid: "B",
  ambiguous: false,
  phase: "Running",
  ready: "true",
  waitingReason: "ContainerCreating",
  lastTerminatedReason: "OOMKilled",
  status: { text: "Running", variant: "success-soft" },
  owner: { kind: "Deployment", name: "web" },
  node: "node-1",
  restarts: 3,
  containers: [
    {
      name: "main",
      waitingReason: null,
      lastTerminatedReason: "OOMKilled",
      restarts: 3,
      cpuRequest: 0.5,
      cpuLimit: 1,
      memoryRequest: 64 * 1024 ** 2,
      memoryLimit: 128 * 1024 ** 2,
    },
  ],
  cpuCores: 0.25,
  cpuRequest: 0.5,
  cpuLimit: 1,
  cpuPctOfRequest: 50,
  cpuPctOfLimit: 25,
  memoryBytes: 64 * 1024 ** 2,
  memoryRequest: 64 * 1024 ** 2,
  memoryLimit: 128 * 1024 ** 2,
  memoryPctOfRequest: 100,
  memoryPctOfLimit: 50,
  usage: { clusterLabel: "k8s_cluster_name", uid: "B" },
  issues: [],
  ...over,
});

const matrix = (values: number[]) => ({
  data: { data: { result: [{ metric: {}, values: values.map((v, i) => [i, String(v)]) }] } },
});

const drawerStub = defineComponent({
  name: "ODrawer",
  props: ["open", "title", "subTitle"],
  emits: ["update:open"],
  setup(props, { slots }) {
    return () =>
      h("div", { "data-title": props.title, "data-sub": props.subTitle }, [slots.default?.()]);
  },
});

const RANGE = { start: 1_000, end: 2_000 };

describe("PodDetailDrawer", () => {
  let wrapper: VueWrapper<any>;
  let store: any;
  let router: any;

  const mountDrawer = async (props: Record<string, any> = {}) => {
    store = createStore({
      state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", theme: "light" },
    });
    store.dispatch = vi.fn();
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/logs", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    vi.spyOn(router, "push");
    wrapper = mount(PodDetailDrawer, {
      props: {
        target: ["prod", "shop", "web-1"],
        pod: makePod(),
        range: RANGE,
        orgId: "org1",
        multiCluster: false,
        usageStreams: { cpu: true, memory: true },
        ...props,
      },
      global: { plugins: [store, router, i18n], stubs: { ODrawer: drawerStub } },
    });
    await flushPromises();
    return wrapper;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    rangeQuery.mockResolvedValue(matrix([1, 2, 3]) as any);
  });

  afterEach(() => wrapper?.unmount());

  it("shows the pod facts and the per-container table", async () => {
    await mountDrawer();
    const text = wrapper.text();
    for (const fact of [
      "Running",
      "ContainerCreating",
      "OOMKilled",
      "3",
      "node-1",
      "Deployment/web",
      "main",
    ]) {
      expect(text).toContain(fact);
    }
    expect(wrapper.find('[data-test="k8s2-drawer-containers"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-pod-drawer"]').attributes("data-title")).toBe("web-1");
    expect(wrapper.find('[data-test="k8s2-pod-drawer"]').attributes("data-sub")).toBe(
      "shop · prod",
    );
  });

  it("queries CPU and working-set trends for this cluster, namespace, pod and uid over the page range", async () => {
    await mountDrawer();
    const calls = rangeQuery.mock.calls.map(([args]) => args);
    expect(calls.map((c) => c.query).sort()).toEqual([
      'sum(k8s_pod_cpu_usage{k8s_cluster_name="prod",k8s_namespace_name="shop",k8s_pod_name="web-1",k8s_pod_uid="B"})',
      'sum(k8s_pod_memory_working_set{k8s_cluster_name="prod",k8s_namespace_name="shop",k8s_pod_name="web-1",k8s_pod_uid="B"})',
    ]);
    for (const call of calls) {
      expect(call).toMatchObject({
        org_identifier: "org1",
        start_time: 1_000,
        end_time: 2_000,
        step: "0",
      });
    }
    const sparks = wrapper.findAllComponents({ name: "OSparkline" });
    expect(sparks).toHaveLength(2);
    expect(sparks[0].props("points")).toEqual([1, 2, 3]);
  });

  it("queries only its own cluster when two clusters hold the same namespace and pod", async () => {
    await mountDrawer({
      target: ["dev", "shop", "web-1"],
      pod: makePod({
        key: "dev/shop/web-1",
        cluster: "dev",
        usage: { clusterLabel: "k8s_cluster", uid: null },
      }),
    });
    for (const [args] of rangeQuery.mock.calls) {
      expect(args.query).toContain('k8s_cluster="dev"');
      expect(args.query).not.toContain("prod");
      expect(args.query).not.toContain("k8s_pod_uid");
    }
  });

  it("renders only the newest pod's trends when responses arrive out of order", async () => {
    const pending: Array<(v: any) => void> = [];
    rangeQuery.mockImplementation(() => new Promise((resolve) => pending.push(resolve)) as any);
    await mountDrawer();
    await wrapper.setProps({
      target: ["prod", "shop", "web-2"],
      pod: makePod({ key: "prod/shop/web-2", name: "web-2" }),
    });
    await flushPromises();
    expect(pending).toHaveLength(4);
    pending[2](matrix([7]));
    pending[3](matrix([8]));
    await flushPromises();
    pending[0](matrix([1]));
    pending[1](matrix([2]));
    await flushPromises();
    const points = wrapper.findAllComponents({ name: "OSparkline" }).map((s) => s.props("points"));
    expect(points).toEqual([[7], [8]]);
  });

  it("shows No usage data and sends no range query for a pod without a usage row", async () => {
    await mountDrawer({ pod: makePod({ usage: null, cpuCores: null, memoryBytes: null }) });
    expect(wrapper.find('[data-test="k8s2-drawer-no-usage"]').text()).toBe("No usage data");
    expect(rangeQuery).not.toHaveBeenCalled();
  });

  it("hides a trend whose stream is missing", async () => {
    await mountDrawer({ usageStreams: { cpu: true, memory: false } });
    expect(rangeQuery).toHaveBeenCalledTimes(1);
    expect(wrapper.findAllComponents({ name: "OSparkline" })).toHaveLength(1);
  });

  it("emits the node and owner filters from their links", async () => {
    await mountDrawer();
    await wrapper.find('[data-test="k8s2-drawer-node-link"]').trigger("click");
    await wrapper.find('[data-test="k8s2-drawer-owner-link"]').trigger("click");
    expect(wrapper.emitted("filter-node")?.[0]?.[0]).toMatchObject({
      cluster: "prod",
      node: "node-1",
    });
    expect(wrapper.emitted("filter-owner")?.[0]?.[0]).toMatchObject({
      owner: { kind: "Deployment", name: "web" },
    });
  });

  describe("View logs", () => {
    const route = { path: "/logs" as const, query: { stream: "default" } };

    it("clears the Logs session before navigating", async () => {
      resolveMock.mockResolvedValue({ route, warnNoClusterField: false });
      await mountDrawer();
      await wrapper.find('[data-test="k8s2-drawer-view-logs"]').trigger("click");
      await flushPromises();
      expect(resolveMock).toHaveBeenCalledWith(
        { cluster: "prod", namespace: "shop", pod: "web-1" },
        { orgId: "org1", start: 1_000, end: 2_000, multiCluster: false },
        expect.anything(),
      );
      expect(store.dispatch).toHaveBeenCalledWith("logs/setIsInitialized", false);
      expect(router.push).toHaveBeenCalledWith(route);
      const dispatchOrder = (store.dispatch as any).mock.invocationCallOrder[0];
      const pushOrder = (router.push as any).mock.invocationCallOrder.at(-1);
      expect(dispatchOrder).toBeLessThan(pushOrder);
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("warns but still navigates when the stream has no cluster field across clusters", async () => {
      resolveMock.mockResolvedValue({ route, warnNoClusterField: true });
      await mountDrawer({ multiCluster: true });
      await wrapper.find('[data-test="k8s2-drawer-view-logs"]').trigger("click");
      await flushPromises();
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(router.push).toHaveBeenCalledWith(route);
    });

    it("warns and stays put when no stream qualifies", async () => {
      resolveMock.mockResolvedValue(null);
      await mountDrawer();
      await wrapper.find('[data-test="k8s2-drawer-view-logs"]').trigger("click");
      await flushPromises();
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(router.push).not.toHaveBeenCalledWith(route);
    });
  });
});
