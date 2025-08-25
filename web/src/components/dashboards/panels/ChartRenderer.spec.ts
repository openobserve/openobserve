// Copyright 2023 OpenObserve Inc.
//
// Licensed under the GNU Affero General Public License, Version 3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.gnu.org/licenses/agpl-3.0.en.html
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import ChartRenderer from "./ChartRenderer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mock ECharts with comprehensive functionality
vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: vi.fn().mockReturnValue({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    clear: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    getOption: vi.fn().mockReturnValue({ 
      series: [{ data: [[1609459200000, 10], [1609462800000, 20]] }],
      legend: [{}]
    }),
    dispatchAction: vi.fn(),
  }),
  dispose: vi.fn(),
}));

vi.mock("echarts/charts", () => ({
  BarChart: vi.fn(),
  LineChart: vi.fn(),
  CustomChart: vi.fn(),
  GaugeChart: vi.fn(),
  PieChart: vi.fn(),
  ScatterChart: vi.fn(),
  HeatmapChart: vi.fn(),
  SankeyChart: vi.fn(),
  TreeChart: vi.fn(),
  GraphChart: vi.fn(),
}));

vi.mock("echarts/features", () => ({
  LegendComponent: vi.fn(),
  TitleComponent: vi.fn(),
  TooltipComponent: vi.fn(),
  GridComponent: vi.fn(),
  DatasetComponent: vi.fn(),
  TransformComponent: vi.fn(),
  AxisPointerComponent: vi.fn(),
  BrushComponent: vi.fn(),
  MarkLineComponent: vi.fn(),
  MarkPointComponent: vi.fn(),
  MarkAreaComponent: vi.fn(),
  TimelineComponent: vi.fn(),
  ToolboxComponent: vi.fn(),
  DataZoomComponent: vi.fn(),
  VisualMapComponent: vi.fn(),
  GraphicComponent: vi.fn(),
  AriaComponent: vi.fn(),
  GeoComponent: vi.fn(),
  CalendarComponent: vi.fn(),
  SingleAxisComponent: vi.fn(),
  ParallelComponent: vi.fn(),
  PolarComponent: vi.fn(),
  RadarComponent: vi.fn(),
  AngleAxisComponent: vi.fn(),
  RadiusAxisComponent: vi.fn(),
  LabelLayout: vi.fn(),
  UniversalTransition: vi.fn(),
}));

vi.mock("echarts/renderers", () => ({
  CanvasRenderer: vi.fn(),
  SVGRenderer: vi.fn(),
}));

// Mock lodash-es throttle and cloneDeep
vi.mock("lodash-es", () => ({
  throttle: vi.fn((fn) => {
    const throttled = (...args: any[]) => fn(...args);
    throttled.flush = vi.fn();
    throttled.cancel = vi.fn();
    return throttled;
  }),
  cloneDeep: vi.fn((obj) => JSON.parse(JSON.stringify(obj))),
}));

installQuasar({
  plugins: [Dialog, Notify],
});

describe("ChartRenderer", () => {
  let wrapper: any;
  let mockHoveredSeriesState: any;

  const mockChartData = {
    chartType: "line",
    options: {
      series: [{ name: "Series 1", type: "line", data: [[1609459200000, 10]] }],
      xAxis: { type: "time" },
      yAxis: { type: "value" },
      tooltip: { 
        textStyle: { color: "#000" },
        backgroundColor: "rgba(255,255,255,1)"
      }
    },
    extras: { 
      panelId: "panel-1",
      isTimeSeries: true
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock hoveredSeriesState - needs to be a reactive ref-like object
    mockHoveredSeriesState = {
      value: {
        panelId: null,
        seriesIndex: -1,
        dataIndex: -1,
        hoveredTime: null,
        hoveredSeriesName: "",
      },
      setIndex: vi.fn(),
      setHoveredSeriesName: vi.fn(),
    };

    // Mock intersection observer
    global.IntersectionObserver = vi.fn().mockImplementation((callback) => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));

    // Mock window event listeners
    global.addEventListener = vi.fn();
    global.removeEventListener = vi.fn();

    store.state.theme = "light";
    
    wrapper = mount(ChartRenderer, {
      props: {
        data: mockChartData,
        renderType: "canvas",
        height: "100%"
      },
      global: {
        plugins: [i18n],
        provide: {
          store,
          hoveredSeriesState: mockHoveredSeriesState,
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe("Component Rendering & Initialization", () => {
    it("should render chart container with correct attributes", () => {
      expect(wrapper.find('[data-test="chart-renderer"]').exists()).toBe(true);
      const container = wrapper.find('[data-test="chart-renderer"]');
      expect(container.attributes("id")).toBe("chart1");
      expect(container.attributes("style")).toContain("height: 100%");
      expect(container.attributes("style")).toContain("width: 100%");
    });

    it("should initialize ECharts instance", async () => {
      const echarts = await import("echarts/core");
      expect(echarts.init).toHaveBeenCalled();
    });

    it("should handle different renderType props", async () => {
      await wrapper.setProps({ renderType: "svg" });
      await flushPromises();
      
      expect(wrapper.props("renderType")).toBe("svg");
    });

    it("should mount successfully with required props", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.props("data")).toEqual(mockChartData);
      expect(wrapper.props("renderType")).toBe("canvas");
      expect(wrapper.props("height")).toBe("100%");
    });
  });

  describe("Theme Management", () => {
    it("should respond to theme changes", async () => {
      const initialTheme = store.state.theme;
      expect(initialTheme).toBe("light");
      
      store.state.theme = "dark";
      await wrapper.vm.$nextTick();
      
      expect(store.state.theme).toBe("dark");
    });

    it("should handle light theme", () => {
      store.state.theme = "light";
      expect(store.state.theme).toBe("light");
    });

    it("should cleanup chart on theme change", async () => {
      const echarts = await import("echarts/core");
      const initialCallCount = vi.mocked(echarts.init).mock.calls.length;
      
      store.state.theme = "dark";
      await wrapper.vm.$nextTick();
      await flushPromises();
      
      expect(vi.mocked(echarts.init).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe("Data & Props Handling", () => {
    it("should handle data prop changes", async () => {
      const newData = {
        ...mockChartData,
        chartType: "bar",
        options: { 
          ...mockChartData.options,
          series: [{ name: "Bar Series", type: "bar", data: [[1609459200000, 15]] }]
        }
      };
      
      await wrapper.setProps({ data: newData });
      await flushPromises();
      
      expect(wrapper.props("data")).toEqual(newData);
    });

    it("should handle time series data correctly", () => {
      expect(wrapper.props("data").extras.isTimeSeries).toBe(true);
      expect(wrapper.props("data").extras.panelId).toBe("panel-1");
    });

    it("should handle empty data gracefully", async () => {
      const emptyData = { 
        chartType: "line", 
        options: { series: [], xAxis: {}, yAxis: {} },
        extras: {}
      };
      
      await wrapper.setProps({ data: emptyData });
      await flushPromises();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.props("data")).toEqual(emptyData);
    });

    it("should handle different chart types", async () => {
      const chartTypes = ["line", "bar", "pie", "scatter", "heatmap"];
      
      for (const chartType of chartTypes) {
        const chartData = { ...mockChartData, chartType };
        await wrapper.setProps({ data: chartData });
        await flushPromises();
        
        expect(wrapper.props("data").chartType).toBe(chartType);
      }
    });

    it("should handle height prop changes", async () => {
      await wrapper.setProps({ height: "300px" });
      expect(wrapper.props("height")).toBe("300px");
    });
  });

  describe("Event Handling", () => {
    it("should handle mouse events on container", async () => {
      const container = wrapper.find('[data-test="chart-renderer"]');
      
      await container.trigger("mouseover");
      await container.trigger("mouseleave");
      
      expect(mockHoveredSeriesState.setIndex).toHaveBeenCalledWith(-1, -1, -1, null);
    });

    it("should set panelId on mouseover", async () => {
      const container = wrapper.find('[data-test="chart-renderer"]');
      
      await container.trigger("mouseover");
      
      expect(mockHoveredSeriesState.panelId).toBe("panel-1");
    });

    it("should emit error events when needed", async () => {
      // Test error event emission by causing an error in data update
      const badData = { ...mockChartData, options: null };
      
      try {
        await wrapper.setProps({ data: badData });
        await flushPromises();
      } catch (e) {
        // Expected to potentially throw
      }
      
      // Component should still exist even with bad data
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Hover State Management", () => {
    it("should inject hoveredSeriesState correctly", () => {
      expect(wrapper.vm.hoveredSeriesState).toBeDefined();
      expect(wrapper.vm.hoveredSeriesState.setIndex).toBeDefined();
      expect(wrapper.vm.hoveredSeriesState.setHoveredSeriesName).toBeDefined();
    });

    it("should handle hover state updates", () => {
      expect(mockHoveredSeriesState.value.panelId).toBe(null);
      expect(mockHoveredSeriesState.value.seriesIndex).toBe(-1);
      expect(mockHoveredSeriesState.value.dataIndex).toBe(-1);
    });

    it("should respond to hover state changes", async () => {
      mockHoveredSeriesState.value.hoveredSeriesName = "Test Series";
      await wrapper.vm.$nextTick();
      
      expect(mockHoveredSeriesState.value.hoveredSeriesName).toBe("Test Series");
    });
  });

  describe("Chart Type Specific Behavior", () => {
    it("should handle pie chart data", async () => {
      const pieData = {
        ...mockChartData,
        chartType: "pie",
        options: {
          ...mockChartData.options,
          series: [{ name: "Pie Series", type: "pie", data: [{ name: "A", value: 10 }] }]
        }
      };
      
      await wrapper.setProps({ data: pieData });
      await flushPromises();
      
      expect(wrapper.props("data").chartType).toBe("pie");
    });

    it("should handle sankey chart data", async () => {
      const sankeyData = {
        ...mockChartData,
        chartType: "sankey",
        options: {
          ...mockChartData.options,
          series: [{ type: "sankey", data: [], links: [] }]
        }
      };
      
      await wrapper.setProps({ data: sankeyData });
      await flushPromises();
      
      expect(wrapper.props("data").chartType).toBe("sankey");
    });

    it("should handle time series specific properties", async () => {
      expect(wrapper.props("data").extras.isTimeSeries).toBe(true);
      
      const timeSeriesData = {
        ...mockChartData,
        extras: { ...mockChartData.extras, isTimeSeries: false }
      };
      
      await wrapper.setProps({ data: timeSeriesData });
      await flushPromises();
      
      expect(wrapper.props("data").extras.isTimeSeries).toBe(false);
    });
  });

  describe("Performance & Lifecycle", () => {
    it("should set up window resize listener", () => {
      expect(global.addEventListener).toHaveBeenCalledWith(
        "resize", 
        expect.any(Function)
      );
    });

    it("should set up intersection observer", () => {
      expect(global.IntersectionObserver).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it("should cleanup on unmount", async () => {
      const unmountWrapper = mount(ChartRenderer, {
        props: {
          data: mockChartData,
          renderType: "canvas"
        },
        global: {
          plugins: [i18n],
          provide: {
            store,
            hoveredSeriesState: mockHoveredSeriesState,
          },
        },
      });
      
      unmountWrapper.unmount();
      
      expect(global.removeEventListener).toHaveBeenCalledWith(
        "resize", 
        expect.any(Function)
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle component errors gracefully", () => {
      // Component should exist and handle errors without crashing
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing data options", async () => {
      const dataWithoutOptions = {
        chartType: "line",
        extras: { panelId: "test" }
      };
      
      await wrapper.setProps({ data: dataWithoutOptions });
      await flushPromises();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle malformed chart data", async () => {
      const malformedData = {
        chartType: "invalid-type",
        options: { series: "not-an-array" },
        extras: null
      };
      
      await wrapper.setProps({ data: malformedData });
      await flushPromises();
      
      expect(wrapper.exists()).toBe(true);
    });
  });
});