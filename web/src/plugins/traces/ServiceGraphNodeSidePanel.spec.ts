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

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(),
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

    it("should render the panel header", () => {
      expect(
        wrapper.find('[data-test="service-graph-side-panel-header"]').exists(),
      ).toBe(true);
    });

    it("should render the close button", () => {
      expect(
        wrapper
          .find('[data-test="service-graph-side-panel-close-btn"]')
          .exists(),
      ).toBe(true);
    });

  });

  // -------------------------------------------------------------------------
  // Service name display
  // -------------------------------------------------------------------------

  describe("service name display", () => {
    it("should show the node name from the name property", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, name: "checkout-service" },
      });
      const el = wrapper.find(
        '[data-test="service-graph-side-panel-service-name"]',
      );
      expect(el.exists()).toBe(true);
      expect(el.text()).toContain("checkout-service");
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
      const el = wrapper.find(
        '[data-test="service-graph-side-panel-service-name"]',
      );
      expect(el.text()).toContain("payment-svc");
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
      const el = wrapper.find(
        '[data-test="service-graph-side-panel-service-name"]',
      );
      expect(el.text()).toContain("bare-id-service");
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
      const closeBtn = wrapper.find(
        '[data-test="service-graph-side-panel-close-btn"]',
      );
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
});
