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
import { defineComponent, h, onMounted, type Component } from "vue";
import { createStore } from "vuex";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { routerKey } from "vue-router";
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

const { listAlerts, listIncidents, push } = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/services/alerts", async (orig) => {
  const actual: any = await orig();
  return { ...actual, default: { ...actual.default, listByFolderId: listAlerts } };
});
vi.mock("@/services/incidents", async (orig) => {
  const actual: any = await orig();
  return { ...actual, default: { ...actual.default, list: listIncidents } };
});
vi.mock("@/composables/useLockedAffordance", async () => {
  const { computed } = await import("vue");
  return { useLockedAffordance: () => computed(() => ({ allowed: true, message: "" })) };
});

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

  const overviewStore = () =>
    createStore({
      state: {
        selectedOrganization: { identifier: "org1" },
        zoConfig: { incidents_enabled: true },
      },
    });

  const provideGlobals = () => ({
    plugins: [
      i18n,
      overviewStore(),
      [
        VueQueryPlugin,
        { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      ],
    ] as any[],
    provide: { [routerKey as symbol]: { push } },
  });

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
        lastUpdatedAt: END,
        ...props,
      },
      global: { ...provideGlobals(), stubs: { OTooltip: tooltipStub } },
    });
    await flushPromises();
    return wrapper;
  };

  const text = (testId: string) => wrapper.find(`[data-test="${testId}"]`).text();

  const renderer = () => wrapper.findComponent({ name: "PanelSchemaRenderer" });

  beforeEach(() => {
    push.mockClear();
    listAlerts.mockResolvedValue({ data: { list: [] } });
    listIncidents.mockResolvedValue({ data: { incidents: [], total: 0 } });
  });

  afterEach(() => wrapper?.unmount());

  describe("capacity cards", () => {
    const barOf = (testId: string) =>
      wrapper
        .findAllComponents({ name: "OSegmentedBar" })
        .find((c) => c.attributes("data-test") === testId)!;

    it("shows CPU Usage, Requests and Limits as cores over allocatable", async () => {
      await mountView();
      expect(text("k8s2-overview-cpu-usage")).toContain("8.00 cores · 50%");
      expect(text("k8s2-overview-cpu-requests")).toContain("4.00 cores · 25%");
      expect(text("k8s2-overview-cpu-limits")).toContain("20.00 cores · 125%");
      expect(text("k8s2-overview-cpu-allocatable")).toBe("Allocatable: 16.00 cores");
    });

    it("places usage, requests, limits and allocatable on one track that stretches for overcommit", async () => {
      await mountView();
      const props = barOf("k8s2-overview-cpu-bar").props();
      expect(props.segments).toEqual([expect.objectContaining({ id: "usage", pct: 40 })]);
      const at = (id: string) => props.markers!.find((m: any) => m.id === id)!.pct;
      expect(at("limits")).toBe(100);
      expect(at("allocatable")).toBeCloseTo(80);
      expect(at("requests")).toBeCloseTo(20);
    });

    it("shows Memory rows as bytes at the share of allocatable", async () => {
      await mountView();
      expect(text("k8s2-overview-memory-usage")).toContain("48.0GB · 75%");
      expect(text("k8s2-overview-memory-allocatable")).toBe("Allocatable: 64.0GB");
    });

    it("warns only where limits exceed allocatable, with the percent over", async () => {
      await mountView();
      expect(text("k8s2-overview-cpu-limits-higher")).toContain("Limits are 25% over allocatable");
      expect(wrapper.find('[data-test="k8s2-overview-memory-limits-higher"]').exists()).toBe(false);
    });

    it("notes partial data when requests and limits are not reported", async () => {
      const { O2: _o2, O3: _o3, ...sparse } = BASE;
      await mountView(sparse);
      expect(text("k8s2-overview-partial")).toContain("not reported");
      expect(text("k8s2-overview-cpu-limits")).toContain("—");
      expect(wrapper.find('[data-test="k8s2-overview-cpu-limits-higher"]').exists()).toBe(false);
    });

    it("shows No nodes available once a load finished with nothing for the cluster", async () => {
      await mountView({ ...BASE, O1: [] });
      expect(text("k8s2-overview-no-nodes")).toContain("No nodes available");
      expect(wrapper.find('[data-test="k8s2-overview-side-loading"]').exists()).toBe(false);
    });

    it("shows skeletons, never the empty state, while the first load is in flight", async () => {
      await mountView({}, { loading: true, lastUpdatedAt: null });
      expect(wrapper.find('[data-test="k8s2-overview-no-nodes"]').exists()).toBe(false);
      expect(wrapper.findAll('[data-test="k8s2-overview-side-loading"]').length).toBe(3);
      expect(wrapper.find('[data-test="k8s2-overview-chart-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="k8s2-overview-attention-loading"]').exists()).toBe(true);
    });
  });

  describe("pod slots", () => {
    it("states used slots over allocatable pods with a legend of counts", async () => {
      await mountView();
      expect(text("k8s2-overview-pods-slots")).toBe("3 of 110 pod slots used (3%)");
      expect(text("k8s2-overview-pods-legend-pending")).toBe("Pending 1");
      expect(wrapper.find('[data-test="k8s2-overview-pods-legend-completed"]').exists()).toBe(true);
    });
  });

  describe("KPI tiles", () => {
    it("shows nodes, pods, warnings and alerts tiles", async () => {
      await mountView();
      expect(text("k8s2-overview-kpi-nodes")).toContain("1 / 1");
      expect(
        wrapper
          .find('[data-test="k8s2-overview-kpi-pods"] [data-test="o-stat-card-sub-icon"]')
          .attributes("aria-label"),
      ).toContain("1 pending");
      expect(text("k8s2-overview-kpi-pods")).toMatch(/\d+ \/ 3/);
      expect(text("k8s2-overview-kpi-warnings")).toContain("3");
      expect(text("k8s2-overview-kpi-alerts")).toContain("0");
      expect(text("k8s2-overview-kpi-alerts")).toContain("Firing · org-wide");
    });

    it("emits navigate with the destination view when a tile is clicked", async () => {
      await mountView();
      await wrapper.find('[data-test="k8s2-overview-kpi-nodes"]').trigger("click");
      await wrapper.find('[data-test="k8s2-overview-kpi-pods"]').trigger("click");
      await wrapper.find('[data-test="k8s2-overview-kpi-warnings"]').trigger("click");
      expect(wrapper.emitted("navigate")).toEqual([
        [{ view: "nodes" }],
        [{ view: "pods", status: "failing" }],
        [{ view: "events", status: "warnings" }],
      ]);
    });

    it("shows a no-access state instead of tiles when forbidden", async () => {
      await mountView(BASE, { forbidden: true });
      expect(wrapper.find('[data-test="k8s2-overview-forbidden"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="k8s2-overview-kpis"]').exists()).toBe(false);
    });

    it("keeps the nodes tile neutral when no node is reported", async () => {
      await mountView({ ...BASE, N1: [], O1: [] });
      expect(text("k8s2-overview-kpi-nodes")).toContain("0 / 0");
      expect(
        wrapper.find('[data-test="k8s2-overview-kpi-nodes"]').classes().join(" "),
      ).not.toContain("success");
    });

    it("counts firing alerts and open incidents, and links to them", async () => {
      listAlerts.mockResolvedValue({
        data: {
          list: [
            {
              alert_id: "a1",
              name: "High error rate",
              enabled: true,
              last_outcome: "firing",
              last_triggered_at: END - 5 * MIN,
            },
            { alert_id: "a2", name: "Quiet", enabled: true, last_outcome: "normal" },
          ],
        },
      });
      listIncidents.mockResolvedValue({
        data: {
          incidents: [
            {
              id: "inc1",
              title: "Checkout degraded",
              severity: "P2",
              first_alert_at: END - 10 * MIN,
              group_values: {},
            },
            {
              id: "inc2",
              title: "Other cluster",
              severity: "P3",
              first_alert_at: END,
              group_values: { k8s_cluster: "dev" },
            },
          ],
          total: 2,
        },
      });
      await mountView();
      await vi.waitFor(() =>
        expect(text("k8s2-overview-kpi-alerts")).toContain("Firing · 1 open incident"),
      );
      expect(text("k8s2-overview-kpi-alerts")).toContain("Firing · 1 open incident");
      expect(text("k8s2-overview-incident-card")).toContain("Checkout degraded");
      expect(text("k8s2-overview-alert-a1")).toContain("High error rate");
      expect(wrapper.find('[data-test="k8s2-overview-alert-a2"]').exists()).toBe(false);
      await wrapper.find('[data-test="k8s2-overview-incident-open"]').trigger("click");
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ name: "incidentDetail", params: { id: "inc1" } }),
      );
      await wrapper.find('[data-test="k8s2-overview-alerts-open"]').trigger("click");
      expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ name: "alertList" }));
    });

    it("hides the incident and alert cards when there are none", async () => {
      await mountView();
      await flushPromises();
      expect(wrapper.find('[data-test="k8s2-overview-incident-card"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="k8s2-overview-alerts-card"]').exists()).toBe(false);
    });

    it("shows the alerts tile as unavailable when the reads fail", async () => {
      listAlerts.mockRejectedValue(new Error("403"));
      listIncidents.mockRejectedValue(new Error("403"));
      await mountView();
      await vi.waitFor(() => expect(text("k8s2-overview-kpi-alerts")).toContain("—"));
      expect(text("k8s2-overview-kpi-alerts")).toContain("Unavailable");
    });
  });

  describe("needs attention", () => {
    const failing = {
      ...BASE,
      P1: [ksm({ ...pod("crash-1"), phase: "Running" })],
      P2: [ksm({ ...pod("crash-1"), container: "app", reason: "CrashLoopBackOff" })],
      P11: [],
    };

    it("lists failing pods with open, logs and a disabled Explain", async () => {
      await mountView(failing);
      const row = wrapper.find(`[data-test^="k8s2-overview-attention-row-"]`);
      expect(row.exists()).toBe(true);
      const explain = wrapper.find('button[data-test^="k8s2-overview-attention-explain-"]');
      expect(explain.attributes("aria-disabled")).toBe("true");
      expect(explain.text()).toContain("AI explanations are not available yet");
    });

    it("makes the workload name the one focusable control, not the row", async () => {
      await mountView(failing);
      const row = wrapper.find('[data-test^="k8s2-overview-attention-row-"]');
      expect(row.attributes("role")).toBeUndefined();
      expect(row.attributes("tabindex")).toBeUndefined();
      await wrapper.find('button[data-test^="k8s2-overview-attention-open-"]').trigger("click");
      expect(wrapper.emitted("open")).toEqual([
        [{ kind: "pod", cluster: "prod", namespace: "shop", name: "crash-1" }],
      ]);
    });

    it("emits open on a row click and action logs from the Logs button", async () => {
      await mountView(failing);
      await wrapper.find('[data-test^="k8s2-overview-attention-row-"]').trigger("click");
      expect(wrapper.emitted("open")?.[0]).toEqual([
        { kind: "pod", cluster: "prod", namespace: "shop", name: "crash-1" },
      ]);
      await wrapper.find('[data-test^="k8s2-overview-attention-logs-"]').trigger("click");
      expect(wrapper.emitted("action")?.[0]).toEqual([
        "logs",
        { kind: "pod", cluster: "prod", namespace: "shop", name: "crash-1" },
      ]);
      expect(wrapper.emitted("open")).toHaveLength(1);
    });

    it("shows the empty state when nothing needs attention", async () => {
      await mountView({
        ...BASE,
        P1: [ksm({ ...pod("ok"), phase: "Running" })],
        P11: [ksm({ ...pod("ok"), condition: "Ready" })],
        N1: [],
      });
      expect(wrapper.find('[data-test="k8s2-overview-attention-empty"]').exists()).toBe(true);
    });
  });

  describe("60-minute chart (AC 37)", () => {
    it("sends one CPU usage query over the hour ending at END, with allocatable, limits and requests mark lines", async () => {
      await mountView();
      const props = renderer().props();
      expect(props.panelSchema.type).toBe("bar");
      expect(props.panelSchema.queryType).toBe("promql");
      expect(props.panelSchema.queries.map((q: any) => q.query)).toEqual([
        'sum(k8s_node_cpu_usage{k8s_cluster_name="prod"})',
      ]);
      expect(props.panelSchema.config.mark_line).toEqual([
        { type: "yAxis", value: 16, name: "Allocatable" },
        { type: "yAxis", value: 20, name: "Limits" },
        { type: "yAxis", value: 4, name: "Requests" },
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

    it("keeps a mark line whose value is a reported zero", async () => {
      await mountView({ ...BASE, O2: [] });
      const marks = renderer().props().panelSchema.config.mark_line;
      expect(marks.find((m: any) => m.name === "Requests")?.value).toBe(0);
    });

    it("switching to Memory swaps the metric and the mark-line value", async () => {
      await mountView();
      wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "memory");
      await flushPromises();
      const schema = renderer().props().panelSchema;
      expect(schema.queries[0].query).toBe(
        'sum(k8s_node_memory_working_set{k8s_cluster_name="prod"})',
      );
      expect(schema.config.mark_line.map((m: any) => m.value)).toEqual([64 * GI, 32 * GI, 16 * GI]);
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
          lastUpdatedAt: END,
        },
        global: {
          ...provideGlobals(),
          plugins: [...provideGlobals().plugins, store],
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
      expect(text("k8s2-overview-warning-age-Pod|shop|web-3|web-3-uid")).toBe("5m");
      expect(text("k8s2-overview-warning-message-node|ip-10-0-10-38|MemoryPressure")).toBe(
        "MemoryPressure",
      );
    });

    it("opens the drawer on a row click when the kind has one", async () => {
      await mountView();
      await wrapper
        .find('[data-test="k8s2-overview-warning-message-Pod|shop|web-3|web-3-uid"]')
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
