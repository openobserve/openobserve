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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import store from "@/test/unit/helpers/store";

// Stable spy references — must be declared before vi.mock() factories reference them.
// vi.mock is hoisted so these plain vi.fn() declarations are fine here.
const notifyMock = vi.fn();
const routerPushMock = vi.fn();

// vi.mock calls are hoisted — must come before component import
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn().mockResolvedValue({ data: { hits: [] } }),
  },
}));

vi.mock("@/services/service_streams", () => ({
  correlate: vi.fn().mockResolvedValue({
    data: {
      service_name: "frontend",
      matched_dimensions: {},
      additional_dimensions: {},
      related_streams: { logs: [], metrics: [], traces: [] },
    },
  }),
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((d: any) => d),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useRouter: () => ({
      push: routerPushMock,
      replace: vi.fn(),
      currentRoute: { value: { path: "/", query: {} } },
    }),
    useRoute: () => ({
      path: "/",
      query: {},
      params: {},
    }),
  };
});

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({
      notify: notifyMock,
      dialog: vi.fn(),
    }),
  };
});

import ServiceGraphNodeSidePanel from "./ServiceGraphNodeSidePanel.vue";
import searchService from "@/services/search";
import { correlate as correlateStreams } from "@/services/service_streams";

installQuasar({ plugins: [quasar.Notify, quasar.Dialog] });

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000_000; // microseconds

const baseNode = {
  id: "frontend",
  name: "frontend",
  label: "frontend",
  value: 1200,
  errors: 60,
  error_rate: 5,
};

const healthyNode = { ...baseNode, error_rate: 0, errors: 0 };
const degradedNode = { ...baseNode, error_rate: 8 };
const criticalNode = { ...baseNode, error_rate: 15 };

const baseGraphData = {
  nodes: [baseNode],
  edges: [
    {
      from: "gateway",
      to: "frontend",
      total_requests: 1200,
      p50_latency_ns: 5_000_000,
      p95_latency_ns: 120_000_000,
      p99_latency_ns: 250_000_000,
    },
  ],
};

const baseTimeRange = {
  startTime: NOW - 3_600_000_000,
  endTime: NOW,
};

// ODrawer stub — renders slots inline so internal data-test selectors are
// queryable (real ODrawer teleports its content to <body> via DialogPortal,
// which puts it outside the test wrapper's element tree).
const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
  props: [
    "open",
    "width",
    "seamless",
    "portalTarget",
    "title",
    "subTitle",
    "size",
    "showClose",
    "persistent",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      v-if="open"
      :data-test="$attrs['data-test'] || 'o-drawer-stub'"
      :data-title="title"
    >
      <div class="o-drawer-stub-header">
        <slot name="header" />
        <slot name="header-left" />
        <slot name="header-right" />
        <button
          type="button"
          data-test="o-drawer-close-btn"
          @click="$emit('update:open', false)"
        >Close</button>
      </div>
      <div class="o-drawer-stub-body"><slot /></div>
      <div class="o-drawer-stub-footer"><slot name="footer" /></div>
    </div>
  `,
};

function mountPanel(
  props: Partial<InstanceType<typeof ServiceGraphNodeSidePanel>["$props"]> = {},
) {
  return mount(ServiceGraphNodeSidePanel, {
    global: {
      plugins: [store],
      stubs: {
        RenderDashboardCharts: { template: '<div data-test="stub-charts" />' },
        TenstackTable: { template: '<div data-test="stub-table" />' },
        TelemetryCorrelationDashboard: {
          template: '<div data-test="stub-telemetry" />',
        },
        ODrawer: ODrawerStub,
        // Render ODropdown content inline so data-test items are always queryable
        ODropdown: {
          name: "ODropdown",
          template: '<div class="o-dropdown-stub" v-bind="$attrs"><slot name="trigger" /><slot /></div>',
          emits: ["update:open"],
          props: ["open", "side", "align", "sideOffset"],
        },
        ODropdownItem: {
          name: "ODropdownItem",
          template: '<div class="o-dropdown-item-stub" v-bind="$attrs" @click="$emit(\'select\')"><slot name="icon-left" /><slot /></div>',
          emits: ["select"],
        },
        // OTabs stub — Reka UI-based, needs stub to avoid context errors
        OTabs: {
          name: "OTabs",
          template: '<div class="o-tabs-stub" v-bind="$attrs"><slot /></div>',
          props: ["modelValue", "dense", "align"],
          emits: ["update:modelValue"],
        },
        OTab: {
          name: "OTab",
          template: '<div class="o-tab-stub" v-bind="$attrs" @click="$parent.$emit(\'update:modelValue\', name)"><slot /></div>',
          props: ["name", "label", "style"],
        },
        // OTabPanels: provide reactive context via setup()
        OTabPanels: {
          name: "OTabPanels",
          template: '<div class="o-tab-panels-stub"><slot /></div>',
          props: ["modelValue", "animated", "keepAlive"],
          emits: ["update:modelValue"],
          setup(props) {
            const { computed, provide } = require("vue");
            const ctx = computed(() => ({ modelValue: props.modelValue }));
            provide("tabPanelsCtx", ctx);
            return {};
          },
        },
        OTabPanel: {
          name: "OTabPanel",
          // v-bind="$attrs" forwards data-test; renders only when active
          template: '<div v-if="isActive" v-bind="$attrs" class="o-tab-panel-stub"><slot /></div>',
          props: ["name", "padding", "layout", "stretch"],
          setup(props) {
            const { inject, computed } = require("vue");
            const ctx = inject("tabPanelsCtx", { value: { modelValue: null } });
            const isActive = computed(() => {
              const mv = ctx?.value?.modelValue ?? ctx?.modelValue ?? null;
              return mv === props.name;
            });
            return { isActive };
          },
        },
      },
    },
    props: {
      selectedNode: baseNode,
      graphData: baseGraphData,
      timeRange: baseTimeRange,
      visible: true,
      streamFilter: "default",
      ...props,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ServiceGraphNodeSidePanel", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial render
  // -------------------------------------------------------------------------

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should render the panel when visible is true", () => {
      expect(
        wrapper.find('[data-test="service-graph-side-panel"]').exists(),
      ).toBe(true);
    });

    it("should not render the panel when visible is false", () => {
      wrapper = mountPanel({ visible: false });
      expect(
        wrapper.find('[data-test="service-graph-side-panel"]').exists(),
      ).toBe(false);
    });

    it("should render the close button", () => {
      expect(
        wrapper.find('[data-test="o-drawer-close-btn"]').exists(),
      ).toBe(true);
    });

  });

  // -------------------------------------------------------------------------
  // Service name display
  // -------------------------------------------------------------------------

  describe("service name display", () => {
    it("should pass the node name to the drawer title when name is set", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, name: "checkout-service" },
      });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("checkout-service");
    });

    it("should fall back to label when name is absent", () => {
      wrapper = mountPanel({
        selectedNode: {
          id: "payment",
          label: "payment-svc",
          value: 100,
          errors: 0,
          error_rate: 0,
        },
      });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("payment-svc");
    });

    it("should fall back to id when name and label are absent", () => {
      wrapper = mountPanel({
        selectedNode: {
          id: "bare-id-service",
          value: 50,
          errors: 0,
          error_rate: 0,
        },
      });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("bare-id-service");
    });
  });

  // -------------------------------------------------------------------------
  // Health badge
  // -------------------------------------------------------------------------

  describe("health badge", () => {
    it("should show Healthy badge when error_rate is 0", () => {
      wrapper = mountPanel({ selectedNode: healthyNode });
      const badge = wrapper.find(".health-badge");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Healthy");
      expect(badge.classes()).toContain("healthy");
    });

    it("should show Degraded badge when error_rate is above 5", () => {
      wrapper = mountPanel({ selectedNode: degradedNode });
      const badge = wrapper.find(".health-badge");
      expect(badge.text()).toBe("Degraded");
      expect(badge.classes()).toContain("degraded");
    });

    it("should show Critical badge when error_rate is above 10", () => {
      wrapper = mountPanel({ selectedNode: criticalNode });
      const badge = wrapper.find(".health-badge");
      expect(badge.text()).toBe("Critical");
      expect(badge.classes()).toContain("critical");
    });

    it("should show Healthy badge when error_rate is exactly 5", () => {
      // error_rate <= 5 maps to "healthy" per the component logic (> 5 triggers degraded)
      wrapper = mountPanel({
        selectedNode: { ...baseNode, error_rate: 5 },
      });
      const badge = wrapper.find(".health-badge");
      expect(badge.text()).toBe("Healthy");
    });

    it("should show Degraded badge when error_rate is exactly 10", () => {
      // error_rate <= 10 maps to "degraded" per component logic (> 10 triggers critical)
      wrapper = mountPanel({
        selectedNode: { ...baseNode, error_rate: 10 },
      });
      const badge = wrapper.find(".health-badge");
      expect(badge.text()).toBe("Degraded");
    });
  });

  // -------------------------------------------------------------------------
  // RED charts section (streamFilter !== 'all')
  // -------------------------------------------------------------------------

  describe("RED charts section", () => {
    it("should render the red-charts section when streamFilter is not 'all'", async () => {
      wrapper = mountPanel({ streamFilter: "default" });
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="service-graph-side-panel-red-charts"]')
          .exists(),
      ).toBe(true);
    });

    it("should NOT render the red-charts section when streamFilter is 'all'", async () => {
      wrapper = mountPanel({ streamFilter: "all" });
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="service-graph-side-panel-red-charts"]')
          .exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tabs (operations / nodes / pods) — only visible when streamFilter !== 'all'
  // -------------------------------------------------------------------------

  describe("tabs section", () => {
    beforeEach(() => {
      wrapper = mountPanel({ streamFilter: "default" });
    });

    it("should render the tabs when streamFilter is not 'all'", async () => {
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="service-graph-node-panel-tabs"]')
          .exists(),
      ).toBe(true);
    });

    it("should NOT render the tabs when streamFilter is 'all'", async () => {
      wrapper = mountPanel({ streamFilter: "all" });
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="service-graph-node-panel-tabs"]')
          .exists(),
      ).toBe(false);
    });

    it("should default to the operations tab panel", async () => {
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="service-graph-side-panel-recent-operations"]')
          .exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Close button
  // -------------------------------------------------------------------------

  describe("close button", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should emit close when the close button is clicked", async () => {
      const closeBtn = wrapper.find('[data-test="o-drawer-close-btn"]');
      expect(closeBtn.exists()).toBe(true);
      await closeBtn.trigger("click");
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Metrics tab
  // -------------------------------------------------------------------------

  describe("metrics tab", () => {
    beforeEach(() => {
      wrapper = mountPanel({ streamFilter: "default" });
    });

    it("should render the metrics tab", async () => {
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="service-graph-node-panel-tab-metrics"]')
          .exists(),
      ).toBe(true);
    });

    it("should show loading state when metricsCorrelationLoading is true", async () => {
      // Delay the correlate response so the loading state is visible
      vi.mocked(correlateStreams).mockImplementationOnce(
        () => new Promise(() => {}),
      );

      // Activate the metrics tab to trigger fetchMetricsCorrelation
      const metricsTab = wrapper.find(
        '[data-test="service-graph-node-panel-tab-metrics"]',
      );
      expect(metricsTab.exists()).toBe(true);
      await metricsTab.trigger("click");
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="service-graph-side-panel-metrics-loading"]')
          .exists(),
      ).toBe(true);
    });

    it("should show error state when metricsCorrelationError is set", async () => {
      vi.mocked(correlateStreams).mockRejectedValueOnce(
        new Error("Network failure"),
      );

      const metricsTab = wrapper.find(
        '[data-test="service-graph-node-panel-tab-metrics"]',
      );
      expect(metricsTab.exists()).toBe(true);
      await metricsTab.trigger("click");
      await flushPromises();

      const errorEl = wrapper.find(
        '[data-test="service-graph-side-panel-metrics-error"]',
      );
      expect(errorEl.exists()).toBe(true);
      expect(errorEl.text()).toContain("Network failure");
    });

    it("should call fetchMetricsCorrelation with true when retry button is clicked", async () => {
      // First call fails to put the component into error state
      vi.mocked(correlateStreams).mockRejectedValueOnce(
        new Error("Server error"),
      );

      const metricsTab = wrapper.find(
        '[data-test="service-graph-node-panel-tab-metrics"]',
      );
      expect(metricsTab.exists()).toBe(true);
      await metricsTab.trigger("click");
      await flushPromises();

      const retryBtn = wrapper.find(
        '[data-test="service-graph-side-panel-metrics-retry-btn"]',
      );
      expect(retryBtn.exists()).toBe(true);

      // Second call succeeds
      vi.mocked(correlateStreams).mockResolvedValueOnce({
        data: {
          service_name: "frontend",
          matched_dimensions: {},
          additional_dimensions: {},
          related_streams: { logs: [], metrics: ["prom-stream"], traces: [] },
        },
      } as any);

      await retryBtn.trigger("click");
      await flushPromises();

      // After retry succeeds the error state should be gone
      expect(
        wrapper
          .find('[data-test="service-graph-side-panel-metrics-error"]')
          .exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Operations fetch — triggered on mount with visible=true + stream != 'all'
  // -------------------------------------------------------------------------

  describe("operations data fetch", () => {
    it("should call searchService.search for operations on mount", async () => {
      wrapper = mountPanel({ streamFilter: "traces-stream" });
      await flushPromises();
      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          page_type: "traces",
          org_identifier: "default",
        }),
      );
    });

    it("should NOT call searchService.search when streamFilter is 'all'", async () => {
      vi.mocked(searchService.search).mockClear();
      wrapper = mountPanel({ streamFilter: "all" });
      await flushPromises();
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should NOT call searchService.search when visible is false", async () => {
      vi.mocked(searchService.search).mockClear();
      wrapper = mountPanel({ visible: false });
      await flushPromises();
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should show 'No operations found' when search returns empty hits", async () => {
      vi.mocked(searchService.search).mockResolvedValue({
        data: { hits: [] },
      } as any);
      wrapper = mountPanel({ streamFilter: "default" });
      await flushPromises();
      const panel = wrapper.find(
        '[data-test="service-graph-side-panel-recent-operations"]',
      );
      expect(panel.exists()).toBe(true);
      expect(panel.text()).toContain("No operations found");
    });
  });

  // -------------------------------------------------------------------------
  // Edge-case: selectedNode changes reset tabs and correlation data
  // -------------------------------------------------------------------------

  describe("node change side-effects", () => {
    it("should re-fetch operations when selectedNode id changes", async () => {
      wrapper = mountPanel({ streamFilter: "default" });
      await flushPromises();

      const initialCallCount = vi.mocked(searchService.search).mock.calls
        .length;

      await wrapper.setProps({
        selectedNode: { ...baseNode, id: "new-service", name: "new-service" },
      });
      await flushPromises();

      expect(vi.mocked(searchService.search).mock.calls.length).toBeGreaterThan(
        initialCallCount,
      );
    });
  });

  // -------------------------------------------------------------------------
  // "View Related Logs" navigation
  // -------------------------------------------------------------------------

  describe("viewRelatedLogs — no logs stream found", () => {
    beforeEach(() => {
      wrapper = mountPanel({ streamFilter: "default" });
    });

    it("should show a warning notification when correlate returns an empty logs array", async () => {
      // Default mock already returns logs: [] — no override needed
      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          message: "traces.noLogsAvailableForService",
        }),
      );
    });

    it("should NOT navigate to /logs when no logs stream is found", async () => {
      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(routerPushMock).not.toHaveBeenCalled();
    });

    it("should show a warning notification when correlate throws an error", async () => {
      vi.mocked(correlateStreams).mockRejectedValueOnce(
        new Error("Network failure"),
      );

      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          message: "traces.noLogsAvailableForService",
        }),
      );
    });

    it("should NOT navigate to /logs when correlate throws an error", async () => {
      vi.mocked(correlateStreams).mockRejectedValueOnce(
        new Error("Network failure"),
      );

      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(routerPushMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // metricGroupResources ref
  // -------------------------------------------------------------------------

  describe("metricGroupResources", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should expose exactly 4 metric group entries", () => {
      expect(wrapper.vm.metricGroupResources).toHaveLength(4);
    });

    it("should have IDs in order: pods, nodes, network, others", () => {
      const ids = wrapper.vm.metricGroupResources.map(
        (g: { id: string }) => g.id,
      );
      expect(ids).toEqual(["pods", "nodes", "network", "others"]);
    });

    it("should have the expected id and label for each group", () => {
      const groups = wrapper.vm.metricGroupResources;
      expect(groups[0]).toMatchObject({ id: "pods", label: "Pods" });
      expect(groups[1]).toMatchObject({ id: "nodes", label: "Nodes" });
      expect(groups[2]).toMatchObject({ id: "network", label: "Network" });
      expect(groups[3]).toMatchObject({ id: "others", label: "Others" });
    });
  });

  describe("viewRelatedLogs — valid logs stream found", () => {
    beforeEach(() => {
      vi.mocked(correlateStreams).mockResolvedValue({
        data: {
          service_name: "frontend",
          matched_dimensions: {},
          additional_dimensions: {},
          related_streams: {
            logs: [
              {
                stream_name: "k8s-logs",
                filters: { service_name: "frontend" },
              },
            ],
            metrics: [],
            traces: [],
          },
        },
      } as any);
      wrapper = mountPanel({ streamFilter: "default" });
    });

    it("should navigate to /logs when a valid log stream is found", async () => {
      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(routerPushMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/logs",
          query: expect.objectContaining({
            stream_type: "logs",
            stream_value: "k8s-logs",
          }),
        }),
      );
    });

    it("should NOT show a warning notification when a valid log stream is found", async () => {
      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(notifyMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "warning" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // isDurationColumn helper
  // -------------------------------------------------------------------------

  describe("isDurationColumn helper", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should return true for p99", () => {
      expect(wrapper.vm.isDurationColumn("p99")).toBe(true);
    });

    it("should return true for p95", () => {
      expect(wrapper.vm.isDurationColumn("p95")).toBe(true);
    });

    it("should return true for p75", () => {
      expect(wrapper.vm.isDurationColumn("p75")).toBe(true);
    });

    it("should return false for p50", () => {
      expect(wrapper.vm.isDurationColumn("p50")).toBe(false);
    });

    it("should return false for requests", () => {
      expect(wrapper.vm.isDurationColumn("requests")).toBe(false);
    });

    it("should return false for operation", () => {
      expect(wrapper.vm.isDurationColumn("operation")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(wrapper.vm.isDurationColumn("")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // sortBy / sortOrder initial state
  // -------------------------------------------------------------------------

  describe("sort state initial defaults", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should default sortBy to empty string", () => {
      expect(wrapper.vm.sortBy).toBe("");
    });

    it("should default sortOrder to empty string", () => {
      expect(wrapper.vm.sortOrder).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // handleSortChange
  // -------------------------------------------------------------------------

  describe("handleSortChange", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should set sortBy to the provided field when called with asc order", () => {
      wrapper.vm.handleSortChange("p99", "asc");
      expect(wrapper.vm.sortBy).toBe("p99");
      expect(wrapper.vm.sortOrder).toBe("asc");
    });

    it("should set sortOrder to desc when provided", () => {
      wrapper.vm.handleSortChange("requests", "desc");
      expect(wrapper.vm.sortBy).toBe("requests");
      expect(wrapper.vm.sortOrder).toBe("desc");
    });

    it("should update both sortBy and sortOrder when called multiple times", () => {
      wrapper.vm.handleSortChange("operation", "asc");
      expect(wrapper.vm.sortBy).toBe("operation");
      expect(wrapper.vm.sortOrder).toBe("asc");

      wrapper.vm.handleSortChange("p95", "desc");
      expect(wrapper.vm.sortBy).toBe("p95");
      expect(wrapper.vm.sortOrder).toBe("desc");
    });
  });

  // -------------------------------------------------------------------------
  // sortedOperationsTableRows
  // -------------------------------------------------------------------------

  describe("sortedOperationsTableRows", () => {
    const mockOperationsHits = [
      {
        operation_name: "GET /api/users",
        request_count: 100,
        error_count: 5,
        p50_latency: 10000,
        p75_latency: 20000,
        p95_latency: 50000,
        p99_latency: 80000,
      },
      {
        operation_name: "POST /api/orders",
        request_count: 200,
        error_count: 10,
        p50_latency: 5000,
        p75_latency: 15000,
        p95_latency: 30000,
        p99_latency: 120000,
      },
      {
        operation_name: "GET /api/products",
        request_count: 50,
        error_count: 0,
        p50_latency: 20000,
        p75_latency: 40000,
        p95_latency: 80000,
        p99_latency: 150000,
      },
    ];

    describe("when operations are loaded", () => {
      beforeEach(async () => {
        vi.mocked(searchService.search).mockResolvedValue({
          data: { hits: mockOperationsHits },
        } as any);
        wrapper = mountPanel({ streamFilter: "default" });
        await flushPromises();
      });

      it("should return unsorted rows when sortBy is empty", () => {
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows).toHaveLength(3);
        expect(rows[0].operation).toBe("GET /api/users");
        expect(rows[1].operation).toBe("POST /api/orders");
        expect(rows[2].operation).toBe("GET /api/products");
      });

      it("should sort by p99 ascending when sortBy is p99 and sortOrder is asc", () => {
        wrapper.vm.handleSortChange("p99", "asc");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].p99).toBe(80000);
        expect(rows[1].p99).toBe(120000);
        expect(rows[2].p99).toBe(150000);
      });

      it("should sort by p99 descending when sortBy is p99 and sortOrder is desc", () => {
        wrapper.vm.handleSortChange("p99", "desc");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].p99).toBe(150000);
        expect(rows[1].p99).toBe(120000);
        expect(rows[2].p99).toBe(80000);
      });

      it("should sort by operation alphabetically ascending", () => {
        wrapper.vm.handleSortChange("operation", "asc");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].operation).toBe("GET /api/products");
        expect(rows[1].operation).toBe("GET /api/users");
        expect(rows[2].operation).toBe("POST /api/orders");
      });

      it("should sort by requests numerically descending", () => {
        wrapper.vm.handleSortChange("requests", "desc");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].requests).toBe(200);
        expect(rows[1].requests).toBe(100);
        expect(rows[2].requests).toBe(50);
      });

      it("should sort by errors numerically ascending", () => {
        wrapper.vm.handleSortChange("errors", "asc");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].errors).toBe(0);
        expect(rows[1].errors).toBe(5);
        expect(rows[2].errors).toBe(10);
      });
    });

    describe("when operations are empty", () => {
      beforeEach(async () => {
        vi.mocked(searchService.search).mockResolvedValue({
          data: { hits: [] },
        } as any);
        wrapper = mountPanel({ streamFilter: "default" });
        await flushPromises();
      });

      it("should return an empty array without error when sortBy is set", () => {
        wrapper.vm.handleSortChange("p99", "asc");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows).toHaveLength(0);
      });
    });
  });
});
