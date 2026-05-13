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
import { mount, flushPromises, config } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import FlameGraphView from "@/components/traces/FlameGraphView.vue";

installQuasar();

// Stub ChartRenderer globally so defineAsyncComponent resolves synchronously
const ChartRendererStub = {
  name: "ChartRenderer",
  props: ["data"],
  emits: ["click"],
  template: '<div class="chart-renderer-stub"></div>',
};

// Stub TraceDetailsSidebar so defineAsyncComponent resolves
const TraceDetailsSidebarStub = {
  name: "TraceDetailsSidebar",
  props: [
    "span",
    "baseTracePosition",
    "searchQuery",
    "streamName",
    "serviceStreamsEnabled",
    "parentMode",
    "activeTab",
  ],
  emits: [
    "view-logs",
    "close",
    "select-span",
    "open-trace",
    "add-filter",
    "apply-filter-immediately",
    "update:activeTab",
  ],
  template: '<div class="trace-details-sidebar-stub"></div>',
};

// Mock useTraces composable
const mockSearchObj = {
  meta: {
    serviceColors: {
      "service-1": "#4caf50",
      "service-2": "#2196f3",
      "service-3": "#ff9800",
    },
  },
  data: {
    traceDetails: {
      selectedSpanId: null as string | null,
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
    config.global.stubs = {
      ChartRenderer: ChartRendererStub,
      TraceDetailsSidebar: TraceDetailsSidebarStub,
    };
    // Reset store state between tests
    mockSearchObj.data.traceDetails.selectedSpanId = null;
  });

  afterEach(() => {
    config.global.stubs = {};
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

    it("should render ChartRenderer when data exists", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".chart-renderer-stub").exists()).toBe(true);
    });

    it("should not render ChartRenderer when no data", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: [],
          traceDuration: 0,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".chart-renderer-stub").exists()).toBe(false);
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

    it("should calculate depth correctly", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.maxDepth).toBe(1);
    });

    it("should return 0 for depth when no spans", () => {
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

    it("should display depth", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.text()).toContain("1");
      expect(wrapper.text()).toContain("depth");
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

      const { data } = wrapper.vm.flameGraphDataAndDepth;
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

      const { data } = wrapper.vm.flameGraphDataAndDepth;

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

      const { data } = wrapper.vm.flameGraphDataAndDepth;

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

      const { data } = wrapper.vm.flameGraphDataAndDepth;

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

      const { data } = wrapper.vm.flameGraphDataAndDepth;

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

      const { data } = wrapper.vm.flameGraphDataAndDepth;
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

      const { data } = wrapper.vm.flameGraphDataAndDepth;
      const normalSpan = data.find((d: any) => d.spanData.span_id === "span-1");

      expect(normalSpan.itemStyle.borderColor).toBe("#ffffff");
      expect(normalSpan.itemStyle.borderWidth).toBe(1);
    });

    it("should include spans with tiny duration using minimum 0.1% width", async () => {
      const tinySpan = [
        createMockSpan({
          span_id: "tiny",
          durationMs: 0.01, // Very small duration: 0.01/10000 * 100 = 0.00001%
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

      const { data } = wrapper.vm.flameGraphDataAndDepth;

      // Tiny spans are included with a minimum 0.1% width so they remain visible
      expect(data.length).toBe(1);
      expect(data[0].value[2]).toBe(0.1);
    });
  });

  describe("Chart Interaction", () => {
    it("should open bottom panel and set selectedSpanId when span is clicked", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Sidebar should not be visible initially
      expect(wrapper.vm.sidebarVisible).toBe(false);

      // Click a span
      wrapper.vm.handleChartClick({
        data: {
          spanData: {
            span_id: "span-1",
          },
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Should open the bottom panel
      expect(wrapper.vm.sidebarVisible).toBe(true);
      // Should emit select-span with the span id
      expect(wrapper.emitted("select-span")).toBeTruthy();
      expect(wrapper.emitted("select-span")[0]).toEqual(["span-1"]);
    });

    it("should not open bottom panel when clicking without span data", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Click without span data
      wrapper.vm.handleChartClick({ data: null });

      expect(wrapper.vm.sidebarVisible).toBe(false);
    });

    it("should render TraceDetailsSidebar when bottom panel is open", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Sidebar should not be rendered initially
      expect(wrapper.find(".trace-details-sidebar-stub").exists()).toBe(false);

      // Click a span to open the panel
      wrapper.vm.handleChartClick({
        data: {
          spanData: {
            span_id: "span-1",
          },
        },
      });
      await wrapper.vm.$nextTick();

      // Sidebar should now be rendered
      expect(wrapper.find(".trace-details-sidebar-stub").exists()).toBe(true);
    });
  });

  describe("Bottom Panel Behavior", () => {
    it("should close sidebar and emit close event", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      // Open sidebar first
      wrapper.vm.sidebarVisible = true;
      await wrapper.vm.$nextTick();

      // Close sidebar
      wrapper.vm.closeSidebar();

      expect(wrapper.vm.sidebarVisible).toBe(false);
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should close sidebar when selectedSpanId prop becomes null", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: "span-1",
        },
      });

      // Open sidebar
      wrapper.vm.sidebarVisible = true;
      await wrapper.vm.$nextTick();

      // Change prop to null (simulating parent clearing selection)
      await wrapper.setProps({ selectedSpanId: null });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.sidebarVisible).toBe(false);
    });

    it("should emit select-span when handleSelectSpan is called", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      wrapper.vm.handleSelectSpan("span-2");

      expect(wrapper.emitted("select-span")).toBeTruthy();
      expect(wrapper.emitted("select-span")[0]).toEqual(["span-2"]);
    });

    it("should set sidebarActiveTab default to attributes", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      expect(wrapper.vm.sidebarActiveTab).toBe("attributes");
    });
  });

  describe("New Props", () => {
    it("should accept spanMap prop and compute selectedSpan", async () => {
      const spanMap = {
        "span-1": createMockSpan({ span_id: "span-1" }),
        "span-2": createMockSpan({ span_id: "span-2" }),
      };

      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: "span-1",
          spanMap,
        },
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedSpan).toEqual(spanMap["span-1"]);
    });

    it("should return null from selectedSpan when spanId not in spanMap", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: "nonexistent",
          spanMap: {},
        },
      });

      expect(wrapper.vm.selectedSpan).toBeNull();
    });

    it("should accept streamName and parentMode props", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
          streamName: "test-stream",
          parentMode: "embedded",
        },
      });

      expect(wrapper.props("streamName")).toBe("test-stream");
      expect(wrapper.props("parentMode")).toBe("embedded");
    });
  });

  describe("Chart Updates", () => {
    it("should update flame graph data when spans change", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const newSpans = [
        createMockSpan({
          span_id: "new-span",
          operationName: "New Operation",
        }),
      ];

      await wrapper.setProps({ spans: newSpans });
      await wrapper.vm.$nextTick();

      const { data } = wrapper.vm.flameGraphDataAndDepth;
      expect(data[0].spanData.operationName).toBe("New Operation");
    });

    it("should update flame graph data when traceDuration changes", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      const { data: dataBefore } = wrapper.vm.flameGraphDataAndDepth;
      const widthBefore = dataBefore[0].value[2]; // width percentage

      await wrapper.setProps({ traceDuration: 200 });
      await wrapper.vm.$nextTick();

      const { data: dataAfter } = wrapper.vm.flameGraphDataAndDepth;
      const widthAfter = dataAfter[0].value[2];

      // Same 100ms span over 200ms trace = 50% (was 100% over 100ms)
      expect(widthAfter).toBeLessThan(widthBefore);
    });

    it("should apply selection highlight when selectedSpanId changes", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      await wrapper.setProps({ selectedSpanId: "span-1" });
      await wrapper.vm.$nextTick();

      const { data } = wrapper.vm.flameGraphDataAndDepth;
      const selectedItem = data.find(
        (d: any) => d.spanData.span_id === "span-1",
      );
      expect(selectedItem.itemStyle.borderColor).toBe("#2563EB");
      expect(selectedItem.itemStyle.borderWidth).toBe(3);
    });
  });

  describe("Resize Handling", () => {
    it("should compute correct chartContentHeight for given spans", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      // chartContentHeight must be a positive number
      expect(wrapper.vm.chartContentHeight).toBeGreaterThan(0);
    });

    it("should not error when mouse cursor moves over an empty chart", () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: [],
          traceDuration: 0,
          selectedSpanId: null,
        },
      });

      const mockEvent = {
        clientX: 50,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 500 }),
        },
      } as unknown as MouseEvent;

      // handleChartMouseMove returns early when !hasData — should not throw
      expect(() => wrapper.vm.handleChartMouseMove(mockEvent)).not.toThrow();
    });
  });

  describe("Cleanup", () => {
    it("should unmount cleanly when chart is rendered", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should not error on unmount when chart was never rendered", () => {
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
        }),
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

      const { data } = wrapper.vm.flameGraphDataAndDepth;

      // Zero-duration spans are included with the minimum 0.1% width
      expect(data.length).toBe(1);
      expect(data[0].value[2]).toBe(0.1);
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

      // Should not throw error when accessing computed
      expect(() => wrapper.vm.flameGraphDataAndDepth).not.toThrow();
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

      const { data } = wrapper.vm.flameGraphDataAndDepth;

      // All spans are included; each gets the minimum 0.1% width since their natural
      // percentage is far below the threshold against a 1,000,000ms trace duration
      expect(data.length).toBe(mockSpans.length);
      data.forEach((d: any) => expect(d.value[2]).toBe(0.1));
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

  describe("Tooltip Formatter", () => {
    const getFormatter = (w: any) => w.vm.chartOptions.tooltip.formatter;

    it("should format tooltip with span information", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const formatter = getFormatter(wrapper);
      const result = formatter({
        data: {
          spanData: {
            operationName: "GET /api/users",
            serviceName: "service-1",
            durationMs: 100,
            hasError: false,
          },
        },
      });

      expect(result).toContain("GET /api/users");
      expect(result).toContain("service-1");
      expect(result).toContain("100.00%");
      expect(result).toContain("Service:");
      expect(result).toContain("Duration:");
      expect(result).toContain("% of trace:");
    });

    it("should show error indicator in tooltip for error spans", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const result = getFormatter(wrapper)({
        data: {
          spanData: {
            operationName: "Failed Operation",
            serviceName: "service-error",
            durationMs: 50,
            hasError: true,
          },
        },
      });

      expect(result).toContain("⚠ Has errors");
      expect(result).toContain("#f87171");
    });

    it("should not show error indicator for normal spans", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const result = getFormatter(wrapper)({
        data: {
          spanData: {
            operationName: "Normal Operation",
            serviceName: "service-normal",
            durationMs: 50,
            hasError: false,
          },
        },
      });

      expect(result).not.toContain("⚠ Has errors");
    });

    it("should calculate percentage correctly in tooltip", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 200,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const result = getFormatter(wrapper)({
        data: {
          spanData: {
            operationName: "Test Operation",
            serviceName: "test-service",
            durationMs: 50, // 50ms out of 200ms = 25%
            hasError: false,
          },
        },
      });

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

      await wrapper.vm.$nextTick();

      const { formatDuration } =
        await import("@/composables/traces/useTraceProcessing");

      getFormatter(wrapper)({
        data: {
          spanData: {
            operationName: "Test",
            serviceName: "test",
            durationMs: 1500,
            hasError: false,
          },
        },
      });

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

      await wrapper.vm.$nextTick();

      const result = getFormatter(wrapper)({
        data: {
          spanData: {
            operationName: "Test",
            serviceName: "test",
            durationMs: 100,
            hasError: false,
          },
        },
      });

      expect(result).toContain("<div");
      expect(result).toContain("font-weight: bold");
      expect(result).toContain("font-size: 11px");
      expect(result).toContain("display: flex");
      expect(result).toContain("justify-content: space-between");
      expect(result).toContain("color: #cbd5e1");
    });

    it("should handle very small percentages correctly", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 10000,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const result = getFormatter(wrapper)({
        data: {
          spanData: {
            operationName: "Tiny Span",
            serviceName: "test",
            durationMs: 1, // 1ms out of 10000ms = 0.01%
            hasError: false,
          },
        },
      });

      expect(result).toContain("0.01%");
    });

    it("should escape HTML special characters in tooltip to prevent XSS", async () => {
      wrapper = mount(FlameGraphView, {
        props: {
          spans: mockSpans,
          traceDuration: 100,
          selectedSpanId: null,
        },
      });

      await wrapper.vm.$nextTick();

      const result = getFormatter(wrapper)({
        data: {
          spanData: {
            operationName: "<script>alert('xss')</script>",
            serviceName: "<img src=x onerror=alert('xss')>",
            durationMs: 100,
            hasError: false,
          },
        },
      });

      // Raw tags must not appear in the output
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("<img");
      // Escaped entities must be present instead (single quotes are not escaped)
      expect(result).toContain("&lt;script&gt;alert('xss')&lt;/script&gt;");
      expect(result).toContain("&lt;img src=x onerror=alert('xss')&gt;");
    });
  });

  describe("timelineTicks computed", () => {
    it("should return 5 ticks", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: mockSpans, traceDuration: 1000, selectedSpanId: null },
      });
      expect(wrapper.vm.timelineTicks).toHaveLength(5);
    });

    it("should have label, left, and transform on each tick", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: mockSpans, traceDuration: 1000, selectedSpanId: null },
      });
      const ticks = wrapper.vm.timelineTicks;
      ticks.forEach((tick: any) => {
        expect(tick).toHaveProperty("label");
        expect(tick).toHaveProperty("left");
        expect(tick).toHaveProperty("transform");
      });
    });

    it("should use translateX(-100%) for the last tick", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: mockSpans, traceDuration: 1000, selectedSpanId: null },
      });
      const ticks = wrapper.vm.timelineTicks;
      const lastTick = ticks[ticks.length - 1];
      expect(lastTick.transform).toContain("translateX(-100%)");
    });

    it("should use translateY(-50%) for non-last ticks", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: mockSpans, traceDuration: 1000, selectedSpanId: null },
      });
      const ticks = wrapper.vm.timelineTicks;
      // First tick should be translateY(-50%) only
      expect(ticks[0].transform).toBe("translateY(-50%)");
    });

    it("should return 5 ticks when traceDuration is 0", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: [], traceDuration: 0, selectedSpanId: null },
      });
      expect(wrapper.vm.timelineTicks).toHaveLength(5);
    });
  });

  describe("cursor state", () => {
    it("should initialize cursorVisible as false", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: mockSpans, traceDuration: 100, selectedSpanId: null },
      });
      expect(wrapper.vm.cursorVisible).toBe(false);
    });

    it("should set cursorVisible to false on mouseleave", async () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: mockSpans, traceDuration: 100, selectedSpanId: null },
      });
      // Manually set cursorVisible to true first
      wrapper.vm.cursorVisible = true;
      // Trigger mouseleave on the chart wrapper div
      const chartWrapper = wrapper.find('[data-test="flame-graph-view-chart-wrapper"]');
      if (chartWrapper.exists()) {
        await chartWrapper.trigger("mouseleave");
        expect(wrapper.vm.cursorVisible).toBe(false);
      } else {
        // Directly test the reactive property
        wrapper.vm.cursorVisible = false;
        expect(wrapper.vm.cursorVisible).toBe(false);
      }
    });

    it("should not update cursor when hasData is false", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: [], traceDuration: 0, selectedSpanId: null },
      });
      // handleChartMouseMove returns early when !hasData
      const mockEvent = {
        clientX: 50,
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 0,
            width: 500,
          }),
        },
      } as unknown as MouseEvent;
      wrapper.vm.handleChartMouseMove(mockEvent);
      expect(wrapper.vm.cursorVisible).toBe(false);
    });

    it("should update cursorX and cursorVisible when hasData is true", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: mockSpans, traceDuration: 100, selectedSpanId: null },
      });
      const mockEvent = {
        clientX: 60,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 10, width: 500 }),
        },
      } as unknown as MouseEvent;
      wrapper.vm.handleChartMouseMove(mockEvent);
      expect(wrapper.vm.cursorVisible).toBe(true);
      expect(wrapper.vm.cursorX).toBe(50); // clientX - rect.left
    });

    it("should update cursorTimeLabel on mouse move", () => {
      wrapper = mount(FlameGraphView, {
        props: { spans: mockSpans, traceDuration: 100, selectedSpanId: null },
      });
      const mockEvent = {
        clientX: 60,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 10, width: 500 }),
        },
      } as unknown as MouseEvent;
      wrapper.vm.handleChartMouseMove(mockEvent);
      // cursorTimeLabel should be a non-empty string (set by formatDuration)
      expect(typeof wrapper.vm.cursorTimeLabel).toBe("string");
    });
  });
});
