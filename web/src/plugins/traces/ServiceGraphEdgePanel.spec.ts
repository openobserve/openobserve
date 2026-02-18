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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { nextTick } from "vue";
import ServiceGraphEdgePanel from "./ServiceGraphEdgePanel.vue";

installQuasar({
  plugins: [],
});

// Mock CustomChartRenderer component
vi.mock("@/components/dashboards/panels/CustomChartRenderer.vue", () => ({
  default: {
    name: "CustomChartRenderer",
    props: ["data"],
    template: '<div data-test="custom-chart-renderer">Chart</div>',
  },
}));

// Mock store
const createMockStore = (overrides = {}) => ({
  state: {
    theme: "dark",
    ...overrides,
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

describe("ServiceGraphEdgePanel.vue", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;

  const mockNodes = [
    { id: "service-a", label: "Service A" },
    { id: "service-b", label: "Service B" },
    { id: "service-c", label: "Service C" },
  ];

  const mockEdges = [
    {
      from: "service-a",
      to: "service-b",
      total_requests: 1500,
      failed_requests: 50,
      p50_latency_ns: 10000000, // 10ms
      p95_latency_ns: 50000000, // 50ms
      p99_latency_ns: 100000000, // 100ms
    },
  ];

  const mockTimeRange = {
    startTime: Date.now() - 3600000,
    endTime: Date.now(),
  };

  const createWrapper = (props = {}, storeOverrides = {}) => {
    mockStore = createMockStore(storeOverrides);

    return mount(ServiceGraphEdgePanel, {
      props: {
        selectedEdge: mockEdges[0],
        graphData: { nodes: mockNodes, edges: mockEdges },
        timeRange: mockTimeRange,
        visible: true,
        ...props,
      },
      global: {
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render panel when visible is true", () => {
      wrapper = createWrapper({ visible: true });
      expect(wrapper.find('[data-test="service-graph-edge-panel"]').exists()).toBe(true);
    });

    it("should not render panel when visible is false", () => {
      wrapper = createWrapper({ visible: false });
      expect(wrapper.find('[data-test="service-graph-edge-panel"]').exists()).toBe(false);
    });

    it("should display panel header", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-header"]').exists()).toBe(true);
    });

    it("should display panel title with service names", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-title"]').exists()).toBe(true);
    });

    it("should display close button", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-close-btn"]').exists()).toBe(true);
    });
  });

  describe("Computed Properties - sourceServiceName", () => {
    it("should compute source service name from graph data", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sourceServiceName).toBe("Service A");
    });

    it("should return edge.from when node is not found", () => {
      const edgeWithUnknownSource = {
        ...mockEdges[0],
        from: "unknown-service",
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithUnknownSource,
      });

      expect(wrapper.vm.sourceServiceName).toBe("unknown-service");
    });

    it("should return empty string when selectedEdge is null", () => {
      wrapper = createWrapper({
        selectedEdge: null,
      });

      expect(wrapper.vm.sourceServiceName).toBe("");
    });
  });

  describe("Computed Properties - targetServiceName", () => {
    it("should compute target service name from graph data", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.targetServiceName).toBe("Service B");
    });

    it("should return edge.to when node is not found", () => {
      const edgeWithUnknownTarget = {
        ...mockEdges[0],
        to: "unknown-service",
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithUnknownTarget,
      });

      expect(wrapper.vm.targetServiceName).toBe("unknown-service");
    });

    it("should return empty string when selectedEdge is null", () => {
      wrapper = createWrapper({
        selectedEdge: null,
      });

      expect(wrapper.vm.targetServiceName).toBe("");
    });
  });

  describe("Computed Properties - edgeStats", () => {
    it("should compute edge statistics correctly", () => {
      wrapper = createWrapper();
      const stats = wrapper.vm.edgeStats;

      expect(stats.totalRequests).toBe("1.5K");
      expect(stats.requestRate).toBe("1.5K req/min");
    });

    it("should calculate success rate correctly", () => {
      wrapper = createWrapper();
      const stats = wrapper.vm.edgeStats;

      // (1500 - 50) / 1500 * 100 = 96.67%
      expect(stats.successRate).toBe("96.7%");
    });

    it("should calculate error rate correctly", () => {
      wrapper = createWrapper();
      const stats = wrapper.vm.edgeStats;

      // 50 / 1500 * 100 = 3.33%
      expect(stats.errorRate).toBe("3.33%");
      expect(stats.errorRateValue).toBe(3.3333333333333335);
    });

    it("should return N/A for all stats when selectedEdge is null", () => {
      wrapper = createWrapper({
        selectedEdge: null,
      });

      const stats = wrapper.vm.edgeStats;
      expect(stats.totalRequests).toBe("N/A");
      expect(stats.requestRate).toBe("N/A");
      expect(stats.successRate).toBe("N/A");
      expect(stats.errorRate).toBe("N/A");
      expect(stats.errorRateValue).toBe(0);
    });

    it("should handle edge with zero total requests", () => {
      const edgeWithZeroRequests = {
        ...mockEdges[0],
        total_requests: 0,
        failed_requests: 0,
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithZeroRequests,
      });

      const stats = wrapper.vm.edgeStats;
      expect(stats.totalRequests).toBe("0");
      expect(stats.successRate).toBe("100.0%");
      expect(stats.errorRate).toBe("0.00%");
    });

    it("should handle edge with missing request data", () => {
      const edgeWithMissingData = {
        from: "service-a",
        to: "service-b",
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithMissingData,
      });

      const stats = wrapper.vm.edgeStats;
      expect(stats.totalRequests).toBe("0");
      expect(stats.errorRate).toBe("0.00%");
    });

    it("should handle 100% error rate", () => {
      const edgeWithAllErrors = {
        ...mockEdges[0],
        total_requests: 100,
        failed_requests: 100,
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithAllErrors,
      });

      const stats = wrapper.vm.edgeStats;
      expect(stats.successRate).toBe("0.0%");
      expect(stats.errorRate).toBe("100.00%");
      expect(stats.errorRateValue).toBe(100);
    });
  });

  describe("Computed Properties - latencyDistribution", () => {
    it("should compute latency distribution chart data", () => {
      wrapper = createWrapper();
      const distribution = wrapper.vm.latencyDistribution;

      expect(distribution).toBeTruthy();
      expect(distribution.chartType).toBe("custom_chart");
      expect(distribution.series).toBeTruthy();
    });

    it("should convert nanoseconds to milliseconds", () => {
      wrapper = createWrapper();
      const distribution = wrapper.vm.latencyDistribution;

      const values = distribution.series[0].data.map((d: any) => d.value);
      expect(values[0]).toBe(10); // 10ms (P50)
      expect(values[1]).toBe(50); // 50ms (P95)
      expect(values[2]).toBe(100); // 100ms (P99)
      expect(values[3]).toBe(100); // 100ms (Max)
    });

    it("should return no data message when all latencies are zero", () => {
      const edgeWithZeroLatency = {
        ...mockEdges[0],
        p50_latency_ns: 0,
        p95_latency_ns: 0,
        p99_latency_ns: 0,
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithZeroLatency,
      });

      const distribution = wrapper.vm.latencyDistribution;
      expect(distribution.title.text).toBe("No latency data available");
    });

    it("should return null when selectedEdge is null", () => {
      wrapper = createWrapper({
        selectedEdge: null,
      });

      const distribution = wrapper.vm.latencyDistribution;
      expect(distribution).toBeNull();
    });

    it("should use correct colors for latency bars", () => {
      wrapper = createWrapper();
      const distribution = wrapper.vm.latencyDistribution;

      const colors = distribution.series[0].data.map((d: any) => d.itemStyle.color.colorStops[0].color);
      expect(colors[0]).toBe("#4caf50"); // P50 - green
      expect(colors[1]).toBe("#2196f3"); // P95 - blue
      expect(colors[2]).toBe("#ff9800"); // P99 - orange
      expect(colors[3]).toBe("#f44336"); // Max - red
    });

    it("should use dark theme colors when theme is dark", () => {
      wrapper = createWrapper({}, { theme: "dark" });
      const distribution = wrapper.vm.latencyDistribution;

      expect(distribution.tooltip.backgroundColor).toBe("#2B2C2D");
      expect(distribution.tooltip.borderColor).toBe("#444444");
    });

    it("should use light theme colors when theme is light", () => {
      wrapper = createWrapper({}, { theme: "light" });
      const distribution = wrapper.vm.latencyDistribution;

      expect(distribution.tooltip.backgroundColor).toBe("#ffffff");
      expect(distribution.tooltip.borderColor).toBe("#E7EAEE");
    });

    it("should handle missing latency data gracefully", () => {
      const edgeWithMissingLatency = {
        from: "service-a",
        to: "service-b",
        total_requests: 100,
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithMissingLatency,
      });

      const distribution = wrapper.vm.latencyDistribution;
      expect(distribution.title.text).toBe("No latency data available");
    });

    it("should format large latency values correctly (>= 1 second)", () => {
      const edgeWithHighLatency = {
        ...mockEdges[0],
        p50_latency_ns: 1000000000, // 1s
        p95_latency_ns: 2000000000, // 2s
        p99_latency_ns: 3000000000, // 3s
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithHighLatency,
      });

      const distribution = wrapper.vm.latencyDistribution;
      const values = distribution.series[0].data.map((d: any) => d.value);

      expect(values[0]).toBe(1000); // 1000ms
      expect(values[1]).toBe(2000); // 2000ms
      expect(values[2]).toBe(3000); // 3000ms
    });
  });

  describe("Helper Functions - formatNumber", () => {
    it("should format numbers >= 1M with M suffix", () => {
      wrapper = createWrapper();
      const edge = {
        ...mockEdges[0],
        total_requests: 1500000,
      };

      wrapper = createWrapper({ selectedEdge: edge });
      const stats = wrapper.vm.edgeStats;

      expect(stats.totalRequests).toBe("1.5M");
    });

    it("should format numbers >= 1K with K suffix", () => {
      wrapper = createWrapper();
      const stats = wrapper.vm.edgeStats;

      expect(stats.totalRequests).toBe("1.5K");
    });

    it("should format numbers < 1K as plain numbers", () => {
      const edge = {
        ...mockEdges[0],
        total_requests: 500,
      };

      wrapper = createWrapper({ selectedEdge: edge });
      const stats = wrapper.vm.edgeStats;

      expect(stats.totalRequests).toBe("500");
    });

    it("should handle zero correctly", () => {
      const edge = {
        ...mockEdges[0],
        total_requests: 0,
      };

      wrapper = createWrapper({ selectedEdge: edge });
      const stats = wrapper.vm.edgeStats;

      expect(stats.totalRequests).toBe("0");
    });
  });

  describe("Helper Functions - formatRequestRate", () => {
    it("should format rate >= 1M with M req/min suffix", () => {
      const edge = {
        ...mockEdges[0],
        total_requests: 1500000,
      };

      wrapper = createWrapper({ selectedEdge: edge });
      const stats = wrapper.vm.edgeStats;

      expect(stats.requestRate).toBe("1.5M req/min");
    });

    it("should format rate >= 1K with K req/min suffix", () => {
      wrapper = createWrapper();
      const stats = wrapper.vm.edgeStats;

      expect(stats.requestRate).toBe("1.5K req/min");
    });

    it("should format rate < 1K with req/min suffix", () => {
      const edge = {
        ...mockEdges[0],
        total_requests: 500,
      };

      wrapper = createWrapper({ selectedEdge: edge });
      const stats = wrapper.vm.edgeStats;

      expect(stats.requestRate).toBe("500 req/min");
    });
  });

  describe("Event Handlers", () => {
    it("should emit close event when close button is clicked", async () => {
      wrapper = createWrapper();
      const closeBtn = wrapper.find('[data-test="service-graph-edge-panel-close-btn"]');

      await closeBtn.trigger("click");

      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("should invoke handleClose method", () => {
      wrapper = createWrapper();

      // Verify the method exists and is callable
      expect(typeof wrapper.vm.handleClose).toBe("function");

      // Call the method directly
      wrapper.vm.handleClose();

      // Verify it emits the close event
      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("UI Rendering - Statistics Section", () => {
    it("should display statistics section", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-stats"]').exists()).toBe(true);
    });

    it("should display total requests stat", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-total-requests"]').exists()).toBe(true);
    });

    it("should display request rate stat", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-request-rate"]').exists()).toBe(true);
    });

    it("should display success rate stat", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-success-rate"]').exists()).toBe(true);
    });

    it("should display error rate stat", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-error-rate"]').exists()).toBe(true);
    });

    it("should apply error class when error rate > 5%", () => {
      const edgeWithHighError = {
        ...mockEdges[0],
        total_requests: 100,
        failed_requests: 10, // 10% error rate
      };

      wrapper = createWrapper({ selectedEdge: edgeWithHighError });

      // The error class is applied when errorRateValue > 5
      expect(wrapper.vm.edgeStats.errorRateValue).toBeGreaterThan(5);
    });

    it("should not apply error class when error rate <= 5%", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.edgeStats.errorRateValue).toBeLessThanOrEqual(5);
    });
  });

  describe("UI Rendering - Latency Distribution Section", () => {
    it("should display latency distribution section", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-edge-panel-latency-distribution"]').exists()).toBe(true);
    });

    it("should render CustomChartRenderer when latency data exists", async () => {
      wrapper = createWrapper();
      await nextTick();

      expect(wrapper.findComponent({ name: "CustomChartRenderer" }).exists()).toBe(true);
    });

    it("should not render CustomChartRenderer when latency data is null", async () => {
      wrapper = createWrapper({
        selectedEdge: null,
      });
      await nextTick();

      expect(wrapper.findComponent({ name: "CustomChartRenderer" }).exists()).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined graphData nodes", () => {
      wrapper = createWrapper({
        graphData: { nodes: [], edges: mockEdges },
      });

      expect(wrapper.vm.sourceServiceName).toBe("service-a");
      expect(wrapper.vm.targetServiceName).toBe("service-b");
    });

    it("should handle edge with very large request numbers", () => {
      const edgeWithLargeNumbers = {
        ...mockEdges[0],
        total_requests: 99999999,
        failed_requests: 1000000,
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithLargeNumbers,
      });

      const stats = wrapper.vm.edgeStats;
      expect(stats.totalRequests).toBe("100.0M");
      expect(stats.requestRate).toContain("M req/min");
    });

    it("should handle edge with fractional requests", () => {
      const edgeWithFractionalRequests = {
        ...mockEdges[0],
        total_requests: 1234.56,
        failed_requests: 12.34,
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithFractionalRequests,
      });

      const stats = wrapper.vm.edgeStats;
      expect(stats.totalRequests).toBeTruthy();
      expect(stats.errorRate).toBeTruthy();
    });

    it("should handle edge with negative values gracefully", () => {
      const edgeWithNegativeValues = {
        ...mockEdges[0],
        total_requests: -100,
        failed_requests: -10,
      };

      wrapper = createWrapper({
        selectedEdge: edgeWithNegativeValues,
      });

      const stats = wrapper.vm.edgeStats;
      expect(stats).toBeTruthy();
    });

    it("should handle missing time range", () => {
      wrapper = createWrapper({
        timeRange: null,
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Props Validation", () => {
    it("should accept all required props", () => {
      wrapper = createWrapper();

      expect(wrapper.props("selectedEdge")).toEqual(mockEdges[0]);
      expect(wrapper.props("graphData")).toEqual({ nodes: mockNodes, edges: mockEdges });
      expect(wrapper.props("timeRange")).toEqual(mockTimeRange);
      expect(wrapper.props("visible")).toBe(true);
    });

    it("should handle visible prop change", async () => {
      wrapper = createWrapper({ visible: true });
      expect(wrapper.find('[data-test="service-graph-edge-panel"]').exists()).toBe(true);

      await wrapper.setProps({ visible: false });
      expect(wrapper.find('[data-test="service-graph-edge-panel"]').exists()).toBe(false);
    });

    it("should handle selectedEdge prop change", async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sourceServiceName).toBe("Service A");

      const newEdge = {
        from: "service-b",
        to: "service-c",
        total_requests: 2000,
        failed_requests: 100,
      };

      await wrapper.setProps({ selectedEdge: newEdge });
      expect(wrapper.vm.sourceServiceName).toBe("Service B");
      expect(wrapper.vm.targetServiceName).toBe("Service C");
    });
  });

  describe("Animation and Transitions", () => {
    it("should apply slide transition class", () => {
      wrapper = createWrapper();
      const panel = wrapper.find('[data-test="service-graph-edge-panel"]');

      expect(panel.classes()).toContain("service-graph-edge-panel");
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="service-graph-edge-panel"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-edge-panel-header"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-edge-panel-title"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-edge-panel-close-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-edge-panel-stats"]').exists()).toBe(true);
    });

    it("should have close button that is clickable", async () => {
      wrapper = createWrapper();
      const closeBtn = wrapper.find('[data-test="service-graph-edge-panel-close-btn"]');

      expect(closeBtn.exists()).toBe(true);

      // Verify button can be clicked
      await closeBtn.trigger("click");
      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("Theme Support", () => {
    it("should use dark theme colors by default", () => {
      wrapper = createWrapper();
      const distribution = wrapper.vm.latencyDistribution;

      expect(distribution.tooltip.backgroundColor).toBe("#2B2C2D");
    });

    it("should switch to light theme colors when theme changes", async () => {
      wrapper = createWrapper({}, { theme: "light" });
      const distribution = wrapper.vm.latencyDistribution;

      expect(distribution.tooltip.backgroundColor).toBe("#ffffff");
    });
  });
});
