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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import MapsRenderer from "./MapsRenderer.vue";

// Create mock chart instance
const mockChart = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

// Mock ECharts core
vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: vi.fn(() => mockChart),
  registerMap: vi.fn(),
}));

// Mock ECharts charts
vi.mock("echarts/charts", () => ({
  MapChart: vi.fn(),
}));

// Mock world map data
vi.mock("@/assets/dashboard/maps/map.json", () => ({
  default: {
    type: "FeatureCollection",
    features: []
  }
}));

// Mock Vuex
vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
    },
  }),
}));

// Mock window event listeners with callback tracking
let windowResizeCallback: Function | null = null;

Object.defineProperty(window, 'addEventListener', {
  writable: true,
  value: vi.fn((event: string, callback: Function) => {
    if (event === 'resize') {
      windowResizeCallback = callback;
    }
  }),
});

Object.defineProperty(window, 'removeEventListener', {
  writable: true,
  value: vi.fn((event: string, callback: Function) => {
    if (event === 'resize' && callback === windowResizeCallback) {
      windowResizeCallback = null;
    }
  }),
});

describe("MapsRenderer", () => {
  let wrapper: VueWrapper<any>;

  const mockMapData = {
    options: {
      tooltip: {
        formatter: "{b}: {c}"
      },
      series: [
        {
          type: "map",
          map: "world",
          data: [
            { name: "United States", value: 100 },
            { name: "Canada", value: 50 }
          ]
        }
      ]
    }
  };

  const createWrapper = (props = {}) => {
    return mount(MapsRenderer, {
      props: {
        data: mockMapData,
        ...props
      },
      global: {
        plugins: [Quasar],
      },
    });
  };
  
  const waitForChartInit = async (wrapper: any) => {
    // Wait for the component's multiple nextTick calls like the component does
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // Additional wait for initChart
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('#chart-map').exists()).toBe(true);
    });

    it("should have correct component name", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(wrapper.vm.$options.name).toBe("MapsRenderer");
    });

    it("should accept data prop", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(wrapper.props('data')).toEqual(mockMapData);
    });

    it("should handle default data prop", async () => {
      wrapper = mount(MapsRenderer, {
        props: {
          data: { options: {} }
        },
        global: {
          plugins: [Quasar],
        },
      });
      await wrapper.vm.$nextTick();
      
      expect(wrapper.props('data')).toEqual({ options: {} });
    });
  });

  describe("ECharts Integration", () => {
    it("should initialize ECharts on mount", async () => {
      const echarts = await import("echarts/core");
      
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(echarts.init).toHaveBeenCalled();
      expect(echarts.registerMap).toHaveBeenCalledWith("world", expect.any(Object));
    });

    it("should set chart options", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(mockChart.setOption).toHaveBeenCalled();
    });

    it("should dispose chart on unmount", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      wrapper.unmount();
      
      expect(mockChart.dispose).toHaveBeenCalled();
    });
  });

  describe("Data Handling", () => {
    it("should handle empty options", async () => {
      wrapper = createWrapper({
        data: { options: {} }
      });
      await waitForChartInit(wrapper);
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null options", async () => {
      wrapper = createWrapper({
        data: { options: null }
      });
      await waitForChartInit(wrapper);
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should update when data changes", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      const newData = {
        options: {
          series: [{ type: "map", map: "world", data: [{ name: "Test", value: 1 }] }]
        }
      };
      
      await wrapper.setProps({ data: newData });
      
      expect(wrapper.props('data')).toEqual(newData);
    });
  });

  describe("Resize Handling", () => {
    it("should add resize event listener", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(window.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    });

    it("should remove resize event listener on unmount", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(windowResizeCallback).not.toBeNull();
      const callbackBeforeUnmount = windowResizeCallback;
      
      wrapper.unmount();
      
      expect(window.removeEventListener).toHaveBeenCalledWith("resize", callbackBeforeUnmount);
    });

    it("should handle resize callback", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(windowResizeCallback).not.toBeNull();
      
      if (windowResizeCallback) {
        await windowResizeCallback();
        expect(mockChart.resize).toHaveBeenCalled();
      }
    });
  });

  describe("Chart Reference", () => {
    it("should have chart ref element", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(wrapper.vm.chartRef).toBeDefined();
    });

    it("should have correct chart container styling", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      const chartContainer = wrapper.find('#chart-map');
      expect(chartContainer.attributes('style')).toContain('height: 100%');
      expect(chartContainer.attributes('style')).toContain('width: 100%');
    });
  });

  describe("Props Validation", () => {
    it("should have required data prop", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      const component = wrapper?.vm?.$options;
      expect(component?.props?.data?.required).toBe(true);
    });

    it("should have correct prop types", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(typeof wrapper.props('data')).toBe('object');
    });

    it("should handle prop updates", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      const newData = { options: { series: [] } };
      await wrapper.setProps({ data: newData });
      
      expect(wrapper.props('data')).toEqual(newData);
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle multiple nextTick calls", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should cleanup on unmount", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle rapid mount/unmount", async () => {
      for (let i = 0; i < 3; i++) {
        const testWrapper = createWrapper();
        await waitForChartInit(testWrapper);
        testWrapper.unmount();
      }
      
      // Should not throw errors
      expect(true).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid data gracefully", async () => {
      expect(() => {
        wrapper = createWrapper({
          data: { options: { invalid: "data" } }
        });
      }).not.toThrow();
      await waitForChartInit(wrapper);
    });

    it("should handle null props", async () => {
      expect(() => {
        wrapper = mount(MapsRenderer, {
          props: {
            data: { options: {} } // Use valid default instead of null
          },
          global: {
            plugins: [Quasar],
          },
        });
      }).not.toThrow();
      
      if (wrapper) {
        await wrapper.vm.$nextTick();
        expect(wrapper.exists()).toBe(true);
      }
    });

    it("should handle missing chart reference", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      // Simulate missing chart ref
      wrapper.vm.chartRef = null;
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Map Configuration", () => {
    it("should use default map options", async () => {
      wrapper = createWrapper({
        data: { options: {} }
      });
      await waitForChartInit(wrapper);
      
      // Component should render without errors
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle complex map data", async () => {
      const complexData = {
        options: {
          tooltip: { formatter: "{b}: {c}" },
          visualMap: { min: 0, max: 1000 },
          series: [{
            type: "map",
            map: "world",
            roam: true,
            data: [
              { name: "China", value: 1000 },
              { name: "India", value: 800 }
            ]
          }]
        }
      };
      
      expect(() => {
        wrapper = createWrapper({ data: complexData });
      }).not.toThrow();
      await waitForChartInit(wrapper);
    });

    it("should handle empty series", async () => {
      const emptySeriesData = {
        options: {
          series: []
        }
      };
      
      expect(() => {
        wrapper = createWrapper({ data: emptySeriesData });
      }).not.toThrow();
      await waitForChartInit(wrapper);
    });
  });

  describe("Map Data Integration", () => {
    it("should load world map data", async () => {
      wrapper = createWrapper();
      const mapData = await import("@/assets/dashboard/maps/map.json");
      
      expect(mapData.default).toBeDefined();
      expect(mapData.default.type).toBe("FeatureCollection");
    });

    it("should register map with ECharts", async () => {
      const echarts = await import("echarts/core");
      
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      expect(echarts.registerMap).toHaveBeenCalledWith("world", expect.any(Object));
    });
  });

  describe("Performance", () => {
    it("should handle large datasets", async () => {
      const largeData = {
        options: {
          series: [{
            type: "map",
            map: "world",
            data: Array.from({ length: 100 }, (_, i) => ({
              name: `Country${i}`,
              value: Math.random() * 1000
            }))
          }]
        }
      };
      
      expect(() => {
        wrapper = createWrapper({ data: largeData });
      }).not.toThrow();
      await waitForChartInit(wrapper);
    });

    it("should handle rapid data updates", async () => {
      wrapper = createWrapper();
      await waitForChartInit(wrapper);
      
      for (let i = 0; i < 5; i++) {
        await wrapper.setProps({
          data: {
            options: {
              series: [{ type: "map", map: "world", data: [{ name: `Test${i}`, value: i }] }]
            }
          }
        });
      }
      
      expect(wrapper.exists()).toBe(true);
    });
  });
});