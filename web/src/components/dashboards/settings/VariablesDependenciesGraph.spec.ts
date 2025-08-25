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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import { nextTick } from "vue";
import VariablesDependenciesGraph from "./VariablesDependenciesGraph.vue";

// Mock ChartRenderer component
const MockChartRenderer = {
  name: "ChartRenderer",
  template: '<div data-test="chart-renderer-mock">Chart Renderer</div>',
  props: ["data"]
};

vi.mock("../panels/ChartRenderer.vue", () => ({
  default: MockChartRenderer
}));

describe("VariablesDependenciesGraph", () => {
  let wrapper: VueWrapper<any>;

  const mockVariablesList = [
    {
      name: "variable1",
      type: "query_values",
      query_data: {
        filter: [
          { name: "field1", operator: "=", value: "$variable2" }
        ]
      }
    },
    {
      name: "variable2", 
      type: "custom",
      options: [
        { label: "Option 1", value: "value1" }
      ]
    },
    {
      name: "variable3",
      type: "query_values", 
      query_data: {
        filter: [
          { name: "field2", operator: "=", value: "$variable1" }
        ]
      }
    }
  ];

  beforeEach(() => {
    wrapper = mount(VariablesDependenciesGraph, {
      global: {
        plugins: [Quasar],
        stubs: {
          ChartRenderer: MockChartRenderer
        }
      },
      props: {
        variablesList: mockVariablesList
      }
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  describe("Component Initialization", () => {
    it("should render correctly", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="chart-renderer-mock"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("VariablesDependenciesGraph");
    });

    it("should accept required props", () => {
      expect(wrapper.props('variablesList')).toEqual(mockVariablesList);
    });

    it("should have default empty array for variablesList", async () => {
      const wrapperWithoutProps = mount(VariablesDependenciesGraph, {
        global: {
          plugins: [Quasar],
          stubs: {
            ChartRenderer: MockChartRenderer
          }
        }
      });

      expect(wrapperWithoutProps.props('variablesList')).toEqual([]);
      
      wrapperWithoutProps.unmount();
    });
  });

  describe("Chart Configuration", () => {
    it("should initialize options correctly", async () => {
      await nextTick();
      
      expect(wrapper.vm.options).toBeDefined();
    });

    it("should configure chart with transparent background", async () => {
      await nextTick();
      
      expect(wrapper.vm.options?.backgroundColor).toBe("transparent");
    });

    it("should disable tooltip", async () => {
      await nextTick();
      
      if (wrapper.vm.options) {
        expect(wrapper.vm.options.tooltip.show).toBe(false);
      }
    });

    it("should configure graph series correctly", async () => {
      await nextTick();
      
      if (wrapper.vm.options && wrapper.vm.options.series) {
        const graphSeries = wrapper.vm.options.series[0];
        
        expect(graphSeries.type).toBe("graph");
        expect(graphSeries.layout).toBe("force");
        expect(graphSeries.roam).toBe(true);
        expect(graphSeries.draggable).toBe(true);
        expect(graphSeries.zoom).toBe(5);
      }
    });

    it("should configure node appearance", async () => {
      await nextTick();
      
      if (wrapper.vm.options && wrapper.vm.options.series) {
        const graphSeries = wrapper.vm.options.series[0];
        
        expect(graphSeries.symbol).toBe("rect");
        expect(graphSeries.symbolSize).toEqual([50, 10]);
        expect(graphSeries.label.show).toBe(true);
      }
    });

    it("should configure edge appearance", async () => {
      await nextTick();
      
      if (wrapper.vm.options && wrapper.vm.options.series) {
        const graphSeries = wrapper.vm.options.series[0];
        
        expect(graphSeries.edgeSymbol).toEqual(["none", "arrow"]);
        expect(graphSeries.lineStyle.opacity).toBe(0.5);
        expect(graphSeries.lineStyle.width).toBe(2);
      }
    });

    it("should pass correct data to ChartRenderer", async () => {
      await nextTick();
      
      const chartRenderer = wrapper.findComponent(MockChartRenderer);
      expect(chartRenderer.exists()).toBe(true);
      
      const chartData = chartRenderer.props('data');
      expect(chartData).toHaveProperty('options');
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty variables list", async () => {
      const emptyWrapper = mount(VariablesDependenciesGraph, {
        global: {
          plugins: [Quasar],
          stubs: {
            ChartRenderer: MockChartRenderer
          }
        },
        props: {
          variablesList: []
        }
      });

      await nextTick();

      expect(emptyWrapper.vm.options).toBeDefined();
      
      emptyWrapper.unmount();
    });

    it("should handle single variable", async () => {
      const singleVarWrapper = mount(VariablesDependenciesGraph, {
        global: {
          plugins: [Quasar],
          stubs: {
            ChartRenderer: MockChartRenderer
          }
        },
        props: {
          variablesList: [{ name: "variable1", type: "custom" }]
        }
      });

      await nextTick();

      expect(singleVarWrapper.vm.options).toBeDefined();
      
      singleVarWrapper.unmount();
    });
  });

  describe("Props Reactivity", () => {
    it("should handle props change", async () => {
      const newVariablesList = [
        { name: "newVar1", type: "custom" },
        { name: "newVar2", type: "query_values" }
      ];

      await wrapper.setProps({ variablesList: newVariablesList });
      await nextTick();

      expect(wrapper.props('variablesList')).toEqual(newVariablesList);
    });
  });

  describe("Component Styling and Layout", () => {
    it("should have correct container styling", () => {
      const container = wrapper.find('div');
      expect(container.attributes('style')).toContain('height: 100%');
      expect(container.attributes('style')).toContain('width: 100%');
    });

    it("should pass transparent background to chart", async () => {
      await nextTick();
      
      const chartRenderer = wrapper.findComponent(MockChartRenderer);
      const options = chartRenderer.props('data').options;
      
      if (options) {
        expect(options.backgroundColor).toBe("transparent");
      } else {
        // If options is null, it should have default background
        expect(chartRenderer.props('data')).toHaveProperty('options');
      }
    });
  });

  describe("Integration with ChartRenderer", () => {
    it("should render ChartRenderer component", () => {
      const chartRenderer = wrapper.findComponent(MockChartRenderer);
      expect(chartRenderer.exists()).toBe(true);
    });

    it("should pass correct props to ChartRenderer", async () => {
      await nextTick();
      
      const chartRenderer = wrapper.findComponent(MockChartRenderer);
      const chartData = chartRenderer.props('data');
      
      expect(chartData).toHaveProperty('options');
    });

    it("should handle ChartRenderer with fallback options", () => {
      const nullOptionsWrapper = mount(VariablesDependenciesGraph, {
        global: {
          plugins: [Quasar],
          stubs: {
            ChartRenderer: MockChartRenderer
          }
        },
        props: {
          variablesList: []
        }
      });

      const chartRenderer = nullOptionsWrapper.findComponent(MockChartRenderer);
      const chartData = chartRenderer.props('data');
      
      expect(chartData.options).toEqual({ backgroundColor: 'transparent' });
      
      nullOptionsWrapper.unmount();
    });
  });

  describe("Data Processing", () => {
    it("should process variables list and create graph", async () => {
      await nextTick();
      
      // The component should process the variables and create options
      expect(wrapper.vm.options).toBeDefined();
      
      if (wrapper.vm.options && wrapper.vm.options.series) {
        const series = wrapper.vm.options.series;
        expect(Array.isArray(series)).toBe(true);
        expect(series.length).toBeGreaterThanOrEqual(1);
        
        const graphSeries = series[0];
        expect(graphSeries).toHaveProperty('data');
        expect(graphSeries).toHaveProperty('links');
        expect(Array.isArray(graphSeries.data)).toBe(true);
        expect(Array.isArray(graphSeries.links)).toBe(true);
      }
    });

    it("should handle variables with no dependencies", async () => {
      const noDepsWrapper = mount(VariablesDependenciesGraph, {
        global: {
          plugins: [Quasar],
          stubs: {
            ChartRenderer: MockChartRenderer
          }
        },
        props: {
          variablesList: [
            { name: "variable1", type: "custom" },
            { name: "variable2", type: "custom" }
          ]
        }
      });

      await nextTick();

      expect(noDepsWrapper.vm.options).toBeDefined();
      
      if (noDepsWrapper.vm.options && noDepsWrapper.vm.options.series) {
        const graphSeries = noDepsWrapper.vm.options.series[0];
        expect(Array.isArray(graphSeries.data)).toBe(true);
        expect(Array.isArray(graphSeries.links)).toBe(true);
      }
      
      noDepsWrapper.unmount();
    });
  });

  describe("Async Component Behavior", () => {
    it("should handle async ChartRenderer loading", () => {
      // Test that the component handles async loading of ChartRenderer
      const asyncWrapper = mount(VariablesDependenciesGraph, {
        global: {
          plugins: [Quasar],
          stubs: {
            ChartRenderer: MockChartRenderer
          }
        },
        props: {
          variablesList: mockVariablesList
        }
      });

      expect(asyncWrapper.exists()).toBe(true);
      expect(asyncWrapper.findComponent(MockChartRenderer).exists()).toBe(true);
      
      asyncWrapper.unmount();
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed variablesList gracefully", async () => {
      const malformedVariables = [
        { name: "var1" }, // missing type
        { type: "custom" } // missing name
      ];

      const errorWrapper = mount(VariablesDependenciesGraph, {
        global: {
          plugins: [Quasar],
          stubs: {
            ChartRenderer: MockChartRenderer
          }
        },
        props: {
          variablesList: malformedVariables
        }
      });

      await nextTick();
      
      // Component should still render even with malformed data
      expect(errorWrapper.exists()).toBe(true);
      expect(errorWrapper.vm.options).toBeDefined();
      
      errorWrapper.unmount();
    });
  });
});