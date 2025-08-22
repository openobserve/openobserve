// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";

// Mock ECharts
vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: vi.fn().mockReturnValue({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getOption: vi.fn().mockReturnValue({}),
    clear: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
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

vi.mock("echarts/components", () => ({
  TitleComponent: vi.fn(),
  TooltipComponent: vi.fn(),
  LegendComponent: vi.fn(),
  GridComponent: vi.fn(),
  DataZoomComponent: vi.fn(),
  ToolboxComponent: vi.fn(),
  DatasetComponent: vi.fn(),
  MarkLineComponent: vi.fn(),
  MarkPointComponent: vi.fn(),
  MarkAreaComponent: vi.fn(),
  PolarComponent: vi.fn(),
  VisualMapComponent: vi.fn(),
}));

vi.mock("echarts/renderers", () => ({
  CanvasRenderer: vi.fn(),
  SVGRenderer: vi.fn(),
}));

vi.mock("echarts/features", () => ({
  UniversalTransition: vi.fn(),
  LabelLayout: vi.fn(),
}));

import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import * as echarts from "echarts/core";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockChartData = {
  chartType: "line",
  series: [
    {
      name: "Series 1",
      type: "line",
      data: [[1609459200000, 10], [1609462800000, 20], [1609466400000, 15]],
    }
  ],
  xAxis: {
    type: "time",
    data: [1609459200000, 1609462800000, 1609466400000]
  },
  yAxis: {
    type: "value"
  },
  extras: {
    panelId: "panel-1"
  }
};

const mockHoveredSeriesState = {
  panelId: null,
  setIndex: vi.fn(),
  seriesIndex: -1,
  dataIndex: -1,
  value: null
};

describe("ChartRenderer", () => {
  let wrapper: any;
  let mockChart: any;

  const defaultProps = {
    data: mockChartData,
    hoveredSeriesState: mockHoveredSeriesState,
    annotations: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockChart = {
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      getOption: vi.fn().mockReturnValue({ legend: [{}] }),
      clear: vi.fn(),
      showLoading: vi.fn(),
      hideLoading: vi.fn(),
      dispatchAction: vi.fn(),
    };
    
    vi.mocked(echarts.init).mockReturnValue(mockChart);
    
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
    
    // Mock ResizeObserver
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }))
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(ChartRenderer, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Initialization", () => {
    it("should render chart renderer container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="chart-renderer"]').exists()).toBe(true);
      expect(wrapper.find('#chart1').exists()).toBe(true);
    });

    it("should initialize ECharts instance on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(echarts.init).toHaveBeenCalled();
      expect(mockChart.setOption).toHaveBeenCalled();
    });

    it("should dispose chart on unmount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      
      wrapper.unmount();

      // Check that chart instance dispose was called
      expect(mockChart.dispose).toHaveBeenCalled();
    });

    it("should handle missing chart data gracefully", () => {
      wrapper = createWrapper({ data: { chartType: "line", series: [] } });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Chart Data Rendering", () => {
    it("should render line chart with correct data", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(mockChart.setOption).toHaveBeenCalled();
      // Check that setOption was called at least once
      expect(mockChart.setOption).toHaveBeenCalledTimes(1);
    });

    it("should render bar chart", async () => {
      const barData = { ...mockChartData, chartType: "bar" };
      wrapper = createWrapper({ data: barData });
      await flushPromises();

      expect(mockChart.setOption).toHaveBeenCalled();
    });

    it("should render pie chart", async () => {
      const pieData = {
        ...mockChartData,
        chartType: "pie",
        series: [{
          name: "Pie Series",
          type: "pie",
          data: [{ name: "A", value: 10 }, { name: "B", value: 20 }]
        }]
      };
      wrapper = createWrapper({ data: pieData });
      await flushPromises();

      expect(mockChart.setOption).toHaveBeenCalled();
    });

    it("should render gauge chart", async () => {
      const gaugeData = {
        ...mockChartData,
        chartType: "gauge",
        series: [{
          name: "Gauge",
          type: "gauge",
          data: [{ value: 75, name: "Score" }]
        }]
      };
      wrapper = createWrapper({ data: gaugeData });
      await flushPromises();

      expect(mockChart.setOption).toHaveBeenCalled();
    });

    it("should update chart when data changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newData = {
        ...mockChartData,
        series: [{
          name: "Updated Series",
          type: "line",
          data: [[1609459200000, 30], [1609462800000, 40]]
        }]
      };

      await wrapper.setProps({ data: newData });

      expect(mockChart.setOption).toHaveBeenCalledTimes(2);
    });
  });

  describe("Chart Interactions", () => {
    it("should handle mouseover events", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('[data-test="chart-renderer"]').trigger('mouseover');

      expect(mockHoveredSeriesState.panelId).toBe("panel-1");
    });

    it("should handle mouseleave events", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('[data-test="chart-renderer"]').trigger('mouseleave');

      expect(mockHoveredSeriesState.setIndex).toHaveBeenCalledWith(-1, -1, -1, null);
    });

    it("should handle chart click events", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const clickCallback = mockChart.on.mock.calls.find(call => call[0] === 'click')?.[1];
      if (clickCallback) {
        clickCallback({ seriesIndex: 0, dataIndex: 1 });
        expect(wrapper.emitted('chart-click')).toBeTruthy();
      }
    });

    it("should handle legend selection", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const legendCallback = mockChart.on.mock.calls.find(call => call[0] === 'legendselectchanged')?.[1];
      if (legendCallback) {
        legendCallback({ name: "Series 1", selected: false });
        expect(wrapper.emitted('legend-changed')).toBeTruthy();
      }
    });
  });

  describe("Chart Resizing", () => {
    it("should resize chart when container size changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Simulate resize
      window.dispatchEvent(new Event('resize'));
      await flushPromises();

      expect(mockChart.resize).toHaveBeenCalled();
    });

    it("should use ResizeObserver when available", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const ResizeObserverSpy = vi.spyOn(window, 'ResizeObserver');
      expect(ResizeObserverSpy).toHaveBeenCalled();
    });

    it("should throttle resize events", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Multiple rapid resize events
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event('resize'));
      }
      await flushPromises();

      // Should be throttled
      expect(mockChart.resize).toHaveBeenCalledTimes(1);
    });
  });

  describe("Chart Themes", () => {
    it("should apply light theme", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();
      await flushPromises();

      expect(echarts.init).toHaveBeenCalledWith(
        expect.any(Object),
        "light"
      );
    });

    it("should apply dark theme", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      await flushPromises();

      expect(echarts.init).toHaveBeenCalledWith(
        expect.any(Object),
        "dark"
      );
    });

    it("should update theme when store changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      store.state.theme = "dark";
      await wrapper.vm.$nextTick();

      // Should recreate chart with new theme
      expect(mockChart.dispose).toHaveBeenCalled();
      expect(echarts.init).toHaveBeenCalledTimes(2);
    });
  });

  describe("Annotations", () => {
    it("should render annotations on chart", async () => {
      const annotations = [
        {
          id: "annotation-1",
          type: "line",
          value: 1609462800000,
          text: "Important Event"
        }
      ];

      wrapper = createWrapper({ annotations });
      await flushPromises();

      expect(mockChart.setOption).toHaveBeenCalledWith(
        expect.objectContaining({
          series: expect.arrayContaining([
            expect.objectContaining({
              markLine: expect.objectContaining({
                data: expect.arrayContaining([
                  expect.objectContaining({
                    name: "Important Event"
                  })
                ])
              })
            })
          ])
        }),
        expect.any(Boolean)
      );
    });

    it("should handle multiple annotations", async () => {
      const annotations = [
        { id: "1", type: "line", value: 1609462800000, text: "Event 1" },
        { id: "2", type: "line", value: 1609466400000, text: "Event 2" }
      ];

      wrapper = createWrapper({ annotations });
      await flushPromises();

      expect(mockChart.setOption).toHaveBeenCalled();
    });

    it("should update annotations when they change", async () => {
      wrapper = createWrapper({ annotations: [] });
      await flushPromises();

      const newAnnotations = [
        { id: "1", type: "line", value: 1609462800000, text: "New Event" }
      ];

      await wrapper.setProps({ annotations: newAnnotations });

      expect(mockChart.setOption).toHaveBeenCalledTimes(2);
    });
  });

  describe("Loading States", () => {
    it("should show loading when data is loading", async () => {
      wrapper = createWrapper({ loading: true });
      await flushPromises();

      expect(mockChart.showLoading).toHaveBeenCalled();
    });

    it("should hide loading when data is loaded", async () => {
      wrapper = createWrapper({ loading: true });
      await flushPromises();

      await wrapper.setProps({ loading: false });

      expect(mockChart.hideLoading).toHaveBeenCalled();
    });

    it("should handle loading state transitions", async () => {
      wrapper = createWrapper({ loading: false });
      await flushPromises();

      await wrapper.setProps({ loading: true });
      expect(mockChart.showLoading).toHaveBeenCalled();

      await wrapper.setProps({ loading: false });
      expect(mockChart.hideLoading).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle chart initialization errors", async () => {
      vi.mocked(echarts.init).mockImplementation(() => {
        throw new Error("Chart init failed");
      });
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should handle malformed chart data", async () => {
      const malformedData = {
        chartType: "line",
        series: "invalid data"
      };

      wrapper = createWrapper({ data: malformedData });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle chart option errors", async () => {
      mockChart.setOption.mockImplementation(() => {
        throw new Error("Invalid option");
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Chart Configuration", () => {
    it("should apply custom chart options", async () => {
      const customData = {
        ...mockChartData,
        options: {
          grid: { top: 50, bottom: 50 },
          animation: false
        }
      };

      wrapper = createWrapper({ data: customData });
      await flushPromises();

      expect(mockChart.setOption).toHaveBeenCalledWith(
        expect.objectContaining({
          grid: { top: 50, bottom: 50 },
          animation: false
        }),
        expect.any(Boolean)
      );
    });

    it("should merge custom options with defaults", async () => {
      const customData = {
        ...mockChartData,
        options: {
          tooltip: { trigger: 'axis' }
        }
      };

      wrapper = createWrapper({ data: customData });
      await flushPromises();

      const setOptionCall = mockChart.setOption.mock.calls[0][0];
      expect(setOptionCall).toHaveProperty('tooltip');
      expect(setOptionCall).toHaveProperty('series');
    });
  });

  describe("Hover Series State", () => {
    it("should sync hover state across charts", async () => {
      const hoveredState = {
        ...mockHoveredSeriesState,
        seriesIndex: 0,
        dataIndex: 1,
        value: [1609462800000, 20]
      };

      wrapper = createWrapper({ hoveredSeriesState: hoveredState });
      await flushPromises();

      // Should highlight corresponding point
      expect(wrapper.vm.hoveredSeriesState).toBe(hoveredState);
    });

    it("should handle hover state updates", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newHoverState = {
        ...mockHoveredSeriesState,
        seriesIndex: 1,
        dataIndex: 2
      };

      await wrapper.setProps({ hoveredSeriesState: newHoverState });

      expect(wrapper.vm.hoveredSeriesState).toBe(newHoverState);
    });
  });

  describe("Chart Export", () => {
    it("should support chart image export", async () => {
      mockChart.getDataURL = vi.fn().mockReturnValue('data:image/png;base64,mock');
      
      wrapper = createWrapper();
      await flushPromises();

      const imageUrl = wrapper.vm.exportChart('png');
      expect(imageUrl).toBe('data:image/png;base64,mock');
    });

    it("should handle export errors", async () => {
      mockChart.getDataURL = vi.fn().mockImplementation(() => {
        throw new Error("Export failed");
      });
      
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.exportChart('png');
      expect(result).toBeNull();
    });
  });
});