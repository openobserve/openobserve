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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, onMounted, type Component } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";
import type { QueryId } from "./kubernetesQueries";
import { buildInventory, type Series, type WarningEvent } from "./kubernetesModel";
import ClusterOverview from "./ClusterOverview.vue";

const { rendererMounts } = vi.hoisted(() => ({ rendererMounts: { count: 0 } }));

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: defineComponent({
    name: "PanelSchemaRenderer",
    props: ["panelSchema", "selectedTimeObj", "variablesData", "forceLoad", "searchType"],
    setup() {
      onMounted(() => rendererMounts.count++);
      return () => h("div", { "data-test": "renderer-stub" });
    },
  }),
}));

// The chart's request transport, the last seam before the network, for the real-loader case.
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn(async () => {}) }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: streamMock,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
    resetAuthToken: vi.fn(),
  }),
}));

const tooltipStub = defineComponent({
  name: "OTooltip",
  props: ["content"],
  setup(props) {
    return () => h("span", { "data-test": "tooltip" }, props.content);
  },
});

const GI = 1024 ** 3;
const END = 1_800_000_000_000_000;
const MIN = 60_000_000;
const RANGE = { start: END - 15 * MIN, end: END };

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const pod = (name: string, uid = `${name}-uid`) => ({ namespace: "shop", pod: name, uid });

const BASE: Partial<Record<QueryId, Series[]>> = {
  O1: [
    ksm({ resource: "cpu" }, 16),
    ksm({ resource: "memory" }, 64 * GI),
    ksm({ resource: "pods" }, 110),
    { metric: { k8s_cluster: "dev", resource: "cpu" }, value: 4 },
  ],
  O2: [ksm({ resource: "cpu" }, 4), ksm({ resource: "memory" }, 16 * GI)],
  O3: [ksm({ resource: "cpu" }, 20), ksm({ resource: "memory" }, 32 * GI)],
  O4: [
    { metric: { k8s_cluster_name: "prod" }, value: 8 },
    { metric: { k8s_cluster_name: "dev" }, value: 1 },
  ],
  O5: [{ metric: { k8s_cluster_name: "prod" }, value: 48 * GI }],
  // web-1 was recreated: both uids report Running and both have a creation time.
  P1: [
    ksm({ ...pod("web-1", "old"), phase: "Running" }),
    ksm({ ...pod("web-1", "new"), phase: "Running" }),
    ksm({ ...pod("web-2"), phase: "Running" }),
    ksm({ ...pod("web-3"), phase: "Pending" }),
    { metric: { k8s_cluster: "dev", ...pod("dev-1"), phase: "Running" }, value: 1 },
  ],
  P12: [ksm(pod("web-1", "old"), 100), ksm(pod("web-1", "new"), 200)],
  N1: [
    ksm({ node: "ip-10-0-10-38", condition: "Ready", status: "true" }),
    ksm({ node: "ip-10-0-10-38", condition: "MemoryPressure", status: "true" }),
  ],
};

const warning = (over: Partial<WarningEvent>): WarningEvent => ({
  cluster: "prod",
  kind: "Pod",
  name: "web-3",
  namespace: "shop",
  uid: "web-3-uid",
  events: 1,
  lastSeen: END - 5 * MIN,
  reason: "BackOff",
  note: "Back-off restarting failed container",
  ...over,
});

const WARNINGS: WarningEvent[] = [
  warning({}),
  warning({
    kind: "Service",
    name: "api-svc",
    uid: "",
    reason: "SyncLoadBalancerFailed",
    note: "Error syncing load balancer",
  }),
];

describe("ClusterOverview", () => {
  let wrapper: VueWrapper<any>;

  const mountView = async (
    entries: Partial<Record<QueryId, Series[]>> = BASE,
    props: Record<string, any> = {},
  ) => {
    const data = results(entries);
    wrapper = mount(ClusterOverview, {
      props: {
        inventory: buildInventory(data),
        results: data,
        warnings: WARNINGS,
        cluster: "prod",
        range: RANGE,
        refreshNonce: 0,
        hasStream: () => true,
        loading: false,
        lastUpdatedAt: null,
        ...props,
      },
      global: { plugins: [i18n], stubs: { OTooltip: tooltipStub } },
    });
    await flushPromises();
    return wrapper;
  };

  const text = (testId: string) => wrapper.find(`[data-test="${testId}"]`).text();

  const bar = (testId: string) =>
    wrapper
      .findAllComponents({ name: "OProgressBar" })
      .find((c) => c.attributes("data-test") === testId)!;

  const renderer = () => wrapper.findComponent({ name: "PanelSchemaRenderer" });

  afterEach(() => wrapper?.unmount());

  describe("gauges (AC 35)", () => {
    it("shows CPU Usage, Requests and Limits over O1 allocatable with the usage-bar variant", async () => {
      await mountView();
      expect(text("k8s2-overview-cpu-usage")).toContain("8.00 cores · 50%");
      expect(text("k8s2-overview-cpu-requests")).toContain("4.00 cores · 25%");
      expect(text("k8s2-overview-cpu-limits")).toContain("20.00 cores · 125%");
      expect(bar("k8s2-overview-cpu-usage-bar").props()).toMatchObject({
        value: 0.5,
        variant: "default",
      });
      expect(bar("k8s2-overview-cpu-limits-bar").props()).toMatchObject({
        value: 1,
        variant: "danger",
      });
      expect(text("k8s2-overview-cpu-allocatable")).toBe("Allocatable: 16.00 cores");
    });

    it("shows Memory rows as bytes at the share of allocatable", async () => {
      await mountView();
      expect(text("k8s2-overview-memory-usage")).toContain("48.0GB · 75%");
      expect(bar("k8s2-overview-memory-usage-bar").props()).toMatchObject({
        value: 0.75,
        variant: "warning",
      });
      expect(text("k8s2-overview-memory-allocatable")).toBe("Allocatable: 64.0GB");
    });

    it("shows the limits warning only where limits exceed allocatable, and no Capacity", async () => {
      await mountView();
      expect(wrapper.find('[data-test="k8s2-overview-cpu-limits-higher"]').text()).toBe(
        "Specified limits are higher than allocatable",
      );
      expect(wrapper.find('[data-test="k8s2-overview-memory-limits-higher"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Capacity");
    });

    it("counts a recreated pod once for Phase Running, over allocatable pods", async () => {
      await mountView();
      expect(text("k8s2-overview-pods-running")).toContain("Phase Running");
      expect(text("k8s2-overview-pods-running")).toContain("2 of 110 · 2%");
      expect(text("k8s2-overview-pods-note")).toBe(
        "Counts pods in phase Running. Workloads › Overview counts Running only when the pod is also Ready.",
      );
    });

    it("mounts no ChartRenderer and no ring, only OProgressBar gauges", async () => {
      await mountView();
      expect(wrapper.findComponent({ name: "ChartRenderer" }).exists()).toBe(false);
      expect(wrapper.findAllComponents({ name: "OProgressBar" })).toHaveLength(7);
    });

    it("shows No nodes available when O1 has nothing for the cluster", async () => {
      await mountView({ ...BASE, O1: [] });
      expect(text("k8s2-overview-no-nodes")).toContain("No nodes available");
      expect(wrapper.findAllComponents({ name: "OProgressBar" })).toHaveLength(0);
    });
  });

  describe("60-minute chart (AC 37)", () => {
    it("sends one CPU usage query over the hour ending at END, with an Allocatable mark line", async () => {
      await mountView();
      const props = renderer().props();
      expect(props.panelSchema.type).toBe("bar");
      expect(props.panelSchema.queryType).toBe("promql");
      expect(props.panelSchema.queries.map((q: any) => q.query)).toEqual([
        'sum(k8s_node_cpu_usage{k8s_cluster_name="prod"})',
      ]);
      expect(props.panelSchema.config.mark_line).toEqual([
        { type: "yAxis", value: 16, name: "Allocatable" },
      ]);
      expect(props.selectedTimeObj).toEqual({
        start_time: new Date(END - 60 * MIN),
        end_time: new Date(END),
      });
      expect(props.variablesData).toEqual({});
      expect(props.forceLoad).toBe(true);
      expect(props.searchType).toBe("ui");
      expect(wrapper.find('[data-test="k8s2-overview-chart"]').classes()).toContain("h-60");
      expect(wrapper.text()).not.toMatch(/Master|Worker/);
    });

    it("switching to Memory swaps the metric and the mark-line value", async () => {
      await mountView();
      wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "memory");
      await flushPromises();
      const schema = renderer().props().panelSchema;
      expect(schema.queries[0].query).toBe(
        'sum(k8s_node_memory_working_set{k8s_cluster_name="prod"})',
      );
      expect(schema.config.mark_line[0].value).toBe(64 * GI);
    });

    it("uses the k8s_cluster spelling when the usage series carried it", async () => {
      await mountView({ ...BASE, O4: [ksm({}, 8)] });
      expect(renderer().props().panelSchema.queries[0].query).toBe(
        'sum(k8s_node_cpu_usage{k8s_cluster="prod"})',
      );
    });

    it("shows Metrics are not available when the usage stream is absent", async () => {
      await mountView(BASE, { hasStream: (s: string) => s !== "k8s_node_cpu_usage" });
      expect(renderer().exists()).toBe(false);
      expect(text("k8s2-overview-chart-card")).toContain("Metrics are not available");
    });
  });

  describe("refresh (AC 13)", () => {
    it("sends a new chart request through the real PanelSchemaRenderer loader after Refresh", async () => {
      const real = (
        await vi.importActual<{ default: Component }>(
          "@/components/dashboards/PanelSchemaRenderer.vue",
        )
      ).default;
      // jsdom has no IntersectionObserver; the loader observes the panel on mount.
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      const store = createStore({
        state: {
          selectedOrganization: { identifier: "org1" },
          timezone: "UTC",
          theme: "light",
          printMode: false,
          zoConfig: {},
          organizationData: { organizationSettings: { scrape_interval: 15 } },
        },
      });
      const data = results(BASE);
      wrapper = mount(ClusterOverview, {
        props: {
          inventory: buildInventory(data),
          results: data,
          warnings: [],
          cluster: "prod",
          range: RANGE,
          refreshNonce: 0,
          hasStream: () => true,
          loading: false,
          lastUpdatedAt: null,
        },
        global: {
          plugins: [i18n, store],
          stubs: { OTooltip: tooltipStub, PanelSchemaRenderer: real },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(streamMock).toHaveBeenCalled(), { timeout: 20_000 });
      const before = streamMock.mock.calls.length;
      await wrapper.setProps({ refreshNonce: 1 });
      await flushPromises();
      await vi.waitFor(() => expect(streamMock.mock.calls.length).toBeGreaterThan(before), {
        timeout: 20_000,
      });
      const payload: any = streamMock.mock.calls.at(-1)![0];
      expect(payload.type).toBe("promql");
      expect(payload.queryReq.query).toBe('sum(k8s_node_cpu_usage{k8s_cluster_name="prod"})');
    }, 30_000);

    it("emits refresh from the header button and remounts the chart on a new refreshNonce", async () => {
      await mountView();
      await wrapper.find('[data-test="k8s2-overview-refresh"]').trigger("click");
      expect(wrapper.emitted("refresh")).toHaveLength(1);
      const before = rendererMounts.count;
      await wrapper.setProps({ refreshNonce: 1 });
      await flushPromises();
      expect(rendererMounts.count).toBe(before + 1);
    });
  });

  describe("warnings (AC 38)", () => {
    const rows = () => wrapper.findAll('[data-test^="k8s2-overview-warning-type-"]');

    it("lists node conditions and kept events with the involved object's kind as Type", async () => {
      await mountView();
      expect(text("k8s2-overview-warnings-title")).toBe("Warnings (last hour): 3");
      expect(rows().map((r) => r.text())).toEqual(["Service", "Node", "Pod"]);
      expect(wrapper.text()).not.toContain("Event:");
      expect(text("k8s2-overview-warning-age-node|ip-10-0-10-38|MemoryPressure")).toBe("—");
      expect(text("k8s2-overview-warning-age-Pod|shop|web-3")).toBe("5m");
      expect(text("k8s2-overview-warning-message-node|ip-10-0-10-38|MemoryPressure")).toBe(
        "MemoryPressure",
      );
    });

    it("opens the drawer on a row click when the kind has one", async () => {
      await mountView();
      await wrapper
        .find('[data-test="k8s2-overview-warning-message-Pod|shop|web-3"]')
        .trigger("click");
      expect(wrapper.emitted("open")?.[0]).toEqual([
        { kind: "pod", cluster: "prod", namespace: "shop", name: "web-3" },
      ]);
    });

    it("lists a Service warning without a drawer, not clickable, with a tooltip", async () => {
      await mountView();
      const cell = wrapper.find('[data-test="k8s2-overview-warning-message-Service|shop|api-svc"]');
      expect(cell.find('[data-test="tooltip"]').text()).toBe("No details view for Service");
      await cell.trigger("click");
      expect(wrapper.emitted("open")).toBeUndefined();
    });

    it("renders the message key for a NotReady node", async () => {
      await mountView({
        ...BASE,
        N1: [ksm({ node: "ip-1", condition: "Ready", status: "false" })],
      });
      expect(text("k8s2-overview-warning-message-node|ip-1|Ready")).toBe("Node is not ready");
    });

    it("shows No issues found when there is nothing to list", async () => {
      await mountView({ ...BASE, N1: [] }, { warnings: [] });
      expect(text("k8s2-overview-warnings-title")).toBe("Warnings (last hour): 0");
      expect(text("k8s2-overview-warnings-card")).toContain("No issues found");
      expect(text("k8s2-overview-warnings-card")).toContain("Everything is fine in the cluster");
    });
  });
});
