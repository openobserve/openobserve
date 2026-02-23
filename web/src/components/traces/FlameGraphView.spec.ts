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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import FlameGraphView from "@/components/traces/FlameGraphView.vue";
import * as echarts from "echarts";

installQuasar();

// Mock ECharts
vi.mock("echarts", () => {
  const mockChartInstance = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
  };

  return {
    init: vi.fn(() => mockChartInstance),
    default: {
      init: vi.fn(() => mockChartInstance),
    },
  };
});

// Mock useTraces composable
const mockSearchObj = {
  meta: {
    serviceColors: {
      "service-1": "#4caf50",
      "service-2": "#2196f3",
      "service-3": "#ff9800",
    },
  },
};

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
  }),
}));

// Mock formatDuration utility
vi.mock("@/composables/traces/useTraceProcessing", () => ({
  formatDuration: vi.fn((ms: number) => {
    if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }),
}));

// Mock span data
const createMockSpan = (overrides = {}) => ({
  span_id: "span-1",
  operationName: "GET /api/users",
  serviceName: "service-1",
  startOffsetMs: 0,
  durationMs: 100,
  depth: 0,
  hasError: false,
  ...overrides,
});

describe("FlameGraphView", () => {
  let wrapper: any;
  const mockSpans = [
    createMockSpan({
      span_id: "span-1",
      operationName: "GET /api/users",
      serviceName: "service-1",
      startOffsetMs: 0,
      durationMs: 100,
      depth: 0,
      hasError: false,
    }),
    createMockSpan({
      span_id: "span-2",
      operationName: "Database Query",
      serviceName: "service-2",
      startOffsetMs: 10,
      durationMs: 50,
      depth: 1,
      hasError: false,
    }),
    createMockSpan({
      span_id: "span-3",
      operationName: "External API Call",
      serviceName: "service-3",
      startOffsetMs: 70,
      durationMs: 20,
      depth: 1,
      hasError: true,
    }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Mounting & Initialization", () => {
    it("should mount the component successfully", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".flame-graph-view").exists()).toBe(true);
    });

    it("should initialize ECharts on mount with data", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(echarts.init).toHaveBeenCalled();
    });

    it("should not initialize chart when no data", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: [],
          traceDuration: 0,
          selectedSpanId: null,
        },
      });

      expect(echarts.init).not.toHaveBeenCalled();
    });
  });

  describe("Computed Properties", () => {
    it("should calculate total spans correctly", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.totalSpans).toBe(3);
    });

    it("should calculate max depth correctly", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.maxDepth).toBe(1);
    });

    it("should return 0 for max depth when no spans", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: [],
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.maxDepth).toBe(0);
    });

    it("should determine hasData correctly with valid data", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.hasData).toBe(true);
    });

    it("should determine hasData as false with no spans", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: [],
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.hasData).toBe(false);
    });

    it("should determine hasData as false with zero duration", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 0,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.hasData).toBe(false);
    });
  });

  describe("Display & UI", () => {
    it("should display total spans count", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.text()).toContain("3");
      expect(wrapper.text()).toContain("spans");
    });

    it("should display max depth", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.text()).toContain("1");
      expect(wrapper.text()).toContain("max depth");
    });

    it("should show empty state when no data", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: [],
          traceDuration: 0,
          selectedSpanId: null,
        },
      });

      expect(wrapper.text()).toContain("No spans to display");
    });

    it("should not show empty state when data exists", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.text()).not.toContain("No spans to display");
    });

    it("should render chart container", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.find(".tw\\:flex-1").exists()).toBe(true);
    });
  });

  describe("Flame Graph Data Building", () => {
    it("should build flame graph data from spans", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
    });

    it("should calculate percentage position correctly", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();

      // First span: starts at 0, duration 100ms out of 100ms total = 100%
      expect(data[0].value[0]).toBe(0); // start at 0%
      expect(data[0].value[2]).toBe(100); // width 100%
    });

    it("should include span data in flame graph nodes", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();

      expect(data[0].spanData).toBeDefined();
      expect(data[0].spanData.operationName).toBe("GET /api/users");
    });

    it("should apply service colors from searchObj", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();

      expect(data[0].itemStyle.color).toBe("#4caf50"); // service-1 color
    });

    it("should use default color for unknown services", async () => {
      const unknownServiceSpan = [
        createMockSpan({
          serviceName: "unknown-service",
        }),
      ];

      wrapper = mount(FlameGraphView, {
        props: {
          spans: unknownServiceSpan,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();

      expect(data[0].itemStyle.color).toBe("#9CA3AF"); // default color
    });

    it("should highlight error spans with red border", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();
      const errorSpan = data.find((d: any) => d.spanData.span_id === "span-3");

      expect(errorSpan.itemStyle.borderColor).toBe("#EF4444"); // red for errors
      expect(errorSpan.itemStyle.borderWidth).toBe(2);
    });

    it("should use white border for normal spans", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();
      const normalSpan = data.find((d: any) => d.spanData.span_id === "span-1");

      expect(normalSpan.itemStyle.borderColor).toBe("#ffffff");
      expect(normalSpan.itemStyle.borderWidth).toBe(1);
    });

    it("should filter out spans below threshold width", async () => {
      const tinySpan = [
        createMockSpan({
          span_id: "tiny",
          durationMs: 0.01, // Very small duration
          startOffsetMs: 0,
        }),
      ];

      wrapper = mount(FlameGraphView, {
        props: {
          spans: tinySpan,
          traceDuration: 10000, // Large total duration
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();

      // Should be filtered out due to < 0.1% threshold
      expect(data.length).toBe(0);
    });
  });

  describe("Chart Interaction", () => {
    it("should emit span-selected event when span is clicked", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Get the mock chart instance
      const mockChart = (echarts.init as any).mock.results[0].value;

      // Simulate click event handler
      const clickHandler = mockChart.on.mock.calls.find(
        (call: any) => call[0] === "click"
      )?.[1];

      expect(clickHandler).toBeDefined();

      // Simulate click with span data
      clickHandler({
        data: {
          spanData: {
            span_id: "span-1",
          },
        },
      });

      expect(wrapper.emitted("span-selected")).toBeTruthy();
      expect(wrapper.emitted("span-selected")[0]).toEqual(["span-1"]);
    });

    it("should not emit event when clicking without span data", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      const clickHandler = mockChart.on.mock.calls.find(
        (call: any) => call[0] === "click"
      )?.[1];

      // Click without span data
      clickHandler({ data: null });

      expect(wrapper.emitted("span-selected")).toBeFalsy();
    });
  });

  describe("Chart Updates", () => {
    it("should update chart when spans change", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      mockChart.setOption.mockClear();

      // Update spans
      await wrapper.setProps({
        spans: [
          createMockSpan({
            span_id: "new-span",
            operationName: "New Operation",
          }),
        ],
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(mockChart.setOption).toHaveBeenCalled();
    });

    it("should update chart when traceDuration changes", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      mockChart.setOption.mockClear();

      // Update duration
      await wrapper.setProps({
        traceDuration: 200,
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(mockChart.setOption).toHaveBeenCalled();
    });

    it("should highlight selected span when selectedSpanId changes", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      mockChart.setOption.mockClear();

      // Select a span
      await wrapper.setProps({
        selectedSpanId: "span-1",
      });

      await flushPromises();

      expect(mockChart.setOption).toHaveBeenCalled();
    });
  });

  describe("Resize Handling", () => {
    it("should call resize on chart when handleResize is called", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;

      wrapper.vm.handleResize();

      expect(mockChart.resize).toHaveBeenCalled();
    });

    it("should not error when handleResize is called without chart", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: [],
          traceDuration: 0,
          selectedSpanId: null,
        },
      });

      // Should not throw error
      expect(() => wrapper.vm.handleResize()).not.toThrow();
    });
  });

  describe("Cleanup", () => {
    it("should dispose chart on component unmount", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;

      wrapper.unmount();

      expect(mockChart.dispose).toHaveBeenCalled();
    });

    it("should not error on unmount when chart was never initialized", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: [],
          traceDuration: 0,
          selectedSpanId: null,
        },
      });

      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should handle single span correctly", () => {
      const singleSpan = [createMockSpan()];

      wrapper = mount(FlameGraphView, {
        props: {
          spans: singleSpan,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.totalSpans).toBe(1);
      expect(wrapper.vm.maxDepth).toBe(0);
      expect(wrapper.vm.hasData).toBe(true);
    });

    it("should handle very deep trace (many depth levels)", () => {
      const deepSpans = Array.from({ length: 10 }, (_, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          depth: i,
          durationMs: 10,
          startOffsetMs: i * 10,
        })
      );

      wrapper = mount(FlameGraphView, {
        props: {
          spans: deepSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.maxDepth).toBe(9);
    });

    it("should handle spans with zero duration", async () => {
      const zeroDurationSpan = [
        createMockSpan({
          durationMs: 0,
        }),
      ];

      wrapper = mount(FlameGraphView, {
        props: {
          spans: zeroDurationSpan,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();

      // Should be filtered out due to 0% width
      expect(data.length).toBe(0);
    });

    it("should handle negative start offset gracefully", async () => {
      const negativeOffsetSpan = [
        createMockSpan({
          startOffsetMs: -10, // Invalid negative offset
          durationMs: 50,
        }),
      ];

      wrapper = mount(FlameGraphView, {
        props: {
          spans: negativeOffsetSpan,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      // Should not throw error
      expect(() => wrapper.vm.buildFlameGraphData()).not.toThrow();
    });

    it("should handle very large trace duration", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 1000000, // Very large duration
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const data = wrapper.vm.buildFlameGraphData();

      // All spans should be filtered due to tiny percentage
      expect(data.length).toBe(0);
    });

    it("should handle undefined selectedSpanId", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: undefined,
        },
      });

      expect(wrapper.vm).toBeTruthy();
    });
  });

  describe("Props Validation", () => {
    it("should accept valid props", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: "span-1",
        },
      });

      expect(wrapper.props("spans")).toEqual(mockSpans);
      expect(wrapper.props("traceDuration")).toBe(100);
      expect(wrapper.props("selectedSpanId")).toBe("span-1");
    });

    it("should use default null for selectedSpanId", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
        },
      });

      expect(wrapper.props("selectedSpanId")).toBeNull();
    });
  });

  describe("Tooltip Formatter (Line 162)", () => {
    it("should format tooltip with span information", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Get the chart options passed to setOption
      const mockChart = (echarts.init as any).mock.results[0].value;
      const setOptionCalls = mockChart.setOption.mock.calls;
      const chartOptions = setOptionCalls[0][0];

      // Access the formatter function
      const formatter = chartOptions.tooltip.formatter;

      // Create mock params that ECharts would pass to formatter
      const mockParams = {
        data: {
          spanData: {
            operationName: "GET /api/users",
            serviceName: "service-1",
            durationMs: 100,
            hasError: false,
          },
        },
      };

      // Call the formatter
      const result = formatter(mockParams);

      // Verify the HTML output contains expected information
      expect(result).toContain("GET /api/users"); // Operation name
      expect(result).toContain("service-1"); // Service name
      expect(result).toContain("100.00%"); // Percentage
      expect(result).toContain("Service:"); // Label
      expect(result).toContain("Duration:"); // Label
      expect(result).toContain("% of trace:"); // Label
    });

    it("should show error indicator in tooltip for error spans", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      const chartOptions = mockChart.setOption.mock.calls[0][0];
      const formatter = chartOptions.tooltip.formatter;

      const mockParamsWithError = {
        data: {
          spanData: {
            operationName: "Failed Operation",
            serviceName: "service-error",
            durationMs: 50,
            hasError: true,
          },
        },
      };

      const result = formatter(mockParamsWithError);

      // Should contain error indicator
      expect(result).toContain("⚠ Has errors");
      expect(result).toContain("#f87171"); // Error color
    });

    it("should not show error indicator for normal spans", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      const chartOptions = mockChart.setOption.mock.calls[0][0];
      const formatter = chartOptions.tooltip.formatter;

      const mockParamsNormal = {
        data: {
          spanData: {
            operationName: "Normal Operation",
            serviceName: "service-normal",
            durationMs: 50,
            hasError: false,
          },
        },
      };

      const result = formatter(mockParamsNormal);

      // Should NOT contain error indicator
      expect(result).not.toContain("⚠ Has errors");
    });

    it("should calculate percentage correctly in tooltip", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 200, // Total duration
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      const chartOptions = mockChart.setOption.mock.calls[0][0];
      const formatter = chartOptions.tooltip.formatter;

      const mockParams = {
        data: {
          spanData: {
            operationName: "Test Operation",
            serviceName: "test-service",
            durationMs: 50, // 50ms out of 200ms = 25%
            hasError: false,
          },
        },
      };

      const result = formatter(mockParams);

      // Should show 25.00%
      expect(result).toContain("25.00%");
    });

    it("should call formatDuration utility for duration display", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      const chartOptions = mockChart.setOption.mock.calls[0][0];
      const formatter = chartOptions.tooltip.formatter;

      // Import the mocked formatDuration to verify it was called
      const { formatDuration } =
        await import("@/composables/traces/useTraceProcessing");

      const mockParams = {
        data: {
          spanData: {
            operationName: "Test",
            serviceName: "test",
            durationMs: 1500,
            hasError: false,
          },
        },
      };

      formatter(mockParams);

      // Verify formatDuration was called with the correct duration
      expect(formatDuration).toHaveBeenCalledWith(1500);
    });

    it("should include proper HTML structure and styling", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      const chartOptions = mockChart.setOption.mock.calls[0][0];
      const formatter = chartOptions.tooltip.formatter;

      const mockParams = {
        data: {
          spanData: {
            operationName: "Test",
            serviceName: "test",
            durationMs: 100,
            hasError: false,
          },
        },
      };

      const result = formatter(mockParams);

      // Check HTML structure
      expect(result).toContain("<div"); // Has div elements
      expect(result).toContain("font-weight: bold"); // Bold title
      expect(result).toContain("font-size: 11px"); // Font size styling
      expect(result).toContain("display: flex"); // Flexbox layout
      expect(result).toContain("justify-content: space-between"); // Space between
      expect(result).toContain("color: #cbd5e1"); // Label color
    });

    it("should handle very small percentages correctly", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 10000, // Very large total
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      const chartOptions = mockChart.setOption.mock.calls[0][0];
      const formatter = chartOptions.tooltip.formatter;

      const mockParams = {
        data: {
          spanData: {
            operationName: "Tiny Span",
            serviceName: "test",
            durationMs: 1, // 1ms out of 10000ms = 0.01%
            hasError: false,
          },
        },
      };

      const result = formatter(mockParams);

      // Should show 0.01%
      expect(result).toContain("0.01%");
    });

    it("should escape HTML in span data to prevent XSS", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const mockChart = (echarts.init as any).mock.results[0].value;
      const chartOptions = mockChart.setOption.mock.calls[0][0];
      const formatter = chartOptions.tooltip.formatter;

      // Test with potentially malicious data
      const mockParamsWithScript = {
        data: {
          spanData: {
            operationName: "<script>alert('xss')</script>",
            serviceName: "<img src=x onerror=alert('xss')>",
            durationMs: 100,
            hasError: false,
          },
        },
      };

      const result = formatter(mockParamsWithScript);

      // The HTML should contain the literal strings (not executed)
      expect(result).toContain("<script>alert('xss')</script>");
      expect(result).toContain("<img src=x onerror=alert('xss')>");
    });
  });
});
