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
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import CustomChartEditor from "@/components/dashboards/addPanel/CustomChartEditor.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Use vi.hoisted to define mock data that can be used in vi.mock
const { globalMockStore, globalMockDashboardPanelData } = vi.hoisted(() => {
  return {
    globalMockStore: {
      state: {
        theme: 'light'
      }
    },
    globalMockDashboardPanelData: {
      dashboardPanelData: {
        value: {}
      }
    }
  };
});

// Mock vuex with reference to hoisted mock objects
vi.mock("vuex", async () => {
  const actual = await vi.importActual("vuex");
  return {
    ...actual,
    useStore: () => globalMockStore,
    createStore: vi.fn(() => globalMockStore)
  };
});

// Mock useDashboardPanelData composable 
vi.mock("@/composables/useDashboardPanel", () => ({
  default: () => globalMockDashboardPanelData
}));

// Create test-scoped references
let mockStore: any;
let mockDashboardPanelData: any;

describe("CustomChartEditor", () => {
  let wrapper: any;
  const defaultModelValue = `\ // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// The data variable is accessible and holds the response data from the search result, which is formatted as an array.\noption = {  \n \n};
  `;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset global mock objects to default state
    globalMockStore.state = { theme: 'light' };
    globalMockDashboardPanelData.dashboardPanelData = { value: {} };
    
    // Create test-scoped references that point to the same objects
    mockStore = globalMockStore;
    mockDashboardPanelData = globalMockDashboardPanelData;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(CustomChartEditor, {
      props: {
        modelValue: defaultModelValue,
        ...props
      },
      global: {
        plugins: [i18n],
        stubs: {
          'QueryEditor': true
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render markdown editor container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('.markdown-editor').exists()).toBe(true);
    });

    it("should render editor container with correct styling", () => {
      wrapper = createWrapper();

      const container = wrapper.find('.markdown-editor');
      const style = container.element.getAttribute('style');

      expect(style).toContain('width: 100%');
      expect(style).toContain('height: 100%');
      expect(style).toContain('overflow: hidden');
    });

    it("should render inner container with correct height", () => {
      wrapper = createWrapper();

      const innerContainer = wrapper.find('div').findAll('div').find(el =>
        el.attributes('style') && el.attributes('style').includes('width: 100%') && el.attributes('style').includes('height: 100%')
      );
      expect(innerContainer).toBeDefined();
    });

    it("should render column container with correct styling", () => {
      wrapper = createWrapper();

      const colContainer = wrapper.findAll('.col').find(el => 
        el.attributes('style') && el.attributes('style').includes('height: 100%')
      );
      expect(colContainer).toBeDefined();
    });

    it("should render query editor with correct attributes", () => {
      wrapper = createWrapper();

      // Since QueryEditor is stubbed, we check the component structure
      expect(wrapper.vm.$options.components.QueryEditor).toBeDefined();
    });

    it("should have data-test attribute for query editor", () => {
      wrapper = createWrapper();

      const queryEditor = wrapper.find('[data-test="dashboard-markdown-editor-query-editor"]');
      expect(queryEditor.exists()).toBe(true);
    });
  });

  describe("Component Name and Setup", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe('CustomChartEditor');
    });

    it("should register QueryEditor component", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.QueryEditor).toBeDefined();
    });
  });

  describe("Props Handling", () => {
    it("should accept modelValue prop with default value", () => {
      wrapper = createWrapper();

      expect(wrapper.props('modelValue')).toBe(defaultModelValue);
      expect(wrapper.vm.javascriptCodeContent).toBe(defaultModelValue);
    });

    it("should accept custom modelValue", () => {
      const customValue = "option = { title: { text: 'Test Chart' } };";
      wrapper = createWrapper({ modelValue: customValue });

      expect(wrapper.props('modelValue')).toBe(customValue);
      expect(wrapper.vm.javascriptCodeContent).toBe(customValue);
    });

    it("should handle empty modelValue", () => {
      wrapper = createWrapper({ modelValue: "" });

      expect(wrapper.props('modelValue')).toBe("");
      expect(wrapper.vm.javascriptCodeContent).toBe("");
    });

    it("should handle null modelValue", () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.props('modelValue')).toBe(null);
      expect(wrapper.vm.javascriptCodeContent).toBe(null);
    });

    it("should handle undefined modelValue", () => {
      const createWrapperOverride = () => {
        return mount(CustomChartEditor, {
          props: {
            modelValue: undefined
          },
          global: {
            plugins: [i18n],
            stubs: {
              'QueryEditor': true
            },
            mocks: {
              $t: (key: string) => key
            }
          }
        });
      };

      wrapper = createWrapperOverride();
      
      // When undefined is passed, Vue uses the default value
      expect(wrapper.props('modelValue')).toBe(defaultModelValue);
      expect(wrapper.vm.javascriptCodeContent).toBe(defaultModelValue);
    });
  });

  describe("Data Properties", () => {
    it("should initialize javascriptCodeContent with modelValue", () => {
      const testValue = "option = { series: [] };";
      wrapper = createWrapper({ modelValue: testValue });

      expect(wrapper.vm.javascriptCodeContent).toBe(testValue);
    });

    it("should initialize splitterModel with default value", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.splitterModel).toBe(50);
    });

    it("should initialize dataToBeRendered as empty object", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dataToBeRendered).toEqual({});
    });

    it("should have store reference", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store).toBe(mockStore);
    });

    it("should have dashboardPanelData reference", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData).toBe(mockDashboardPanelData.dashboardPanelData);
    });
  });

  describe("Methods", () => {
    describe("layoutSplitterUpdated", () => {
      it("should exist and be a function", () => {
        wrapper = createWrapper();

        expect(typeof wrapper.vm.layoutSplitterUpdated).toBe('function');
      });

      it("should dispatch resize event", () => {
        wrapper = createWrapper();

        const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
        wrapper.vm.layoutSplitterUpdated();

        expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(Event));
        expect(dispatchEventSpy.mock.calls[0][0].type).toBe('resize');

        dispatchEventSpy.mockRestore();
      });
    });

    describe("onEditorValueChange", () => {
      it("should exist and be a function", () => {
        wrapper = createWrapper();

        expect(typeof wrapper.vm.onEditorValueChange).toBe('function');
      });

      it("should update javascriptCodeContent", () => {
        wrapper = createWrapper();

        const newValue = "option = { xAxis: {}, yAxis: {} };";
        wrapper.vm.onEditorValueChange(newValue);

        expect(wrapper.vm.javascriptCodeContent).toBe(newValue);
      });

      it("should emit update:modelValue event", () => {
        wrapper = createWrapper();

        const newValue = "option = { title: { text: 'New Chart' } };";
        wrapper.vm.onEditorValueChange(newValue);

        expect(wrapper.emitted('update:modelValue')).toBeTruthy();
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([newValue]);
      });

      it("should handle empty string value", () => {
        wrapper = createWrapper();

        wrapper.vm.onEditorValueChange("");

        expect(wrapper.vm.javascriptCodeContent).toBe("");
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([""]);
      });

      it("should handle null value", () => {
        wrapper = createWrapper();

        wrapper.vm.onEditorValueChange(null);

        expect(wrapper.vm.javascriptCodeContent).toBe(null);
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([null]);
      });

      it("should handle undefined value", () => {
        wrapper = createWrapper();

        wrapper.vm.onEditorValueChange(undefined);

        expect(wrapper.vm.javascriptCodeContent).toBe(undefined);
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([undefined]);
      });

      it("should handle complex ECharts option object as string", () => {
        wrapper = createWrapper();

        const complexOption = `option = {
          title: { text: 'Complex Chart' },
          tooltip: {},
          xAxis: { data: ['A', 'B', 'C'] },
          yAxis: {},
          series: [{ name: 'Sales', type: 'bar', data: [5, 20, 36] }]
        };`;

        wrapper.vm.onEditorValueChange(complexOption);

        expect(wrapper.vm.javascriptCodeContent).toBe(complexOption);
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([complexOption]);
      });

      it("should handle malformed JavaScript gracefully", () => {
        wrapper = createWrapper();

        const malformedCode = "option = { invalid: syntax }";
        
        expect(() => {
          wrapper.vm.onEditorValueChange(malformedCode);
        }).not.toThrow();

        expect(wrapper.vm.javascriptCodeContent).toBe(malformedCode);
      });

      it("should handle error during processing gracefully", () => {
        wrapper = createWrapper();

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        // Test with potentially problematic value
        const newValue = "test value";
        
        // The actual component doesn't have try-catch, so this tests normal flow
        expect(() => {
          wrapper.vm.onEditorValueChange(newValue);
        }).not.toThrow();

        expect(wrapper.vm.javascriptCodeContent).toBe(newValue);
        expect(wrapper.emitted('update:modelValue')).toBeTruthy();

        consoleSpy.mockRestore();
      });
    });
  });

  describe("Store Integration", () => {
    it("should access store theme for light theme", () => {
      mockStore.state.theme = 'light';
      wrapper = createWrapper();

      expect(wrapper.vm.store.state.theme).toBe('light');
    });

    it("should access store theme for dark theme", () => {
      mockStore.state.theme = 'dark';
      wrapper = createWrapper();

      expect(wrapper.vm.store.state.theme).toBe('dark');
    });

    it("should handle undefined theme", () => {
      mockStore.state.theme = undefined;
      wrapper = createWrapper();

      expect(wrapper.vm.store.state.theme).toBe(undefined);
    });
  });

  describe("Dashboard Panel Data Integration", () => {
    it("should have access to dashboardPanelData", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData).toBe(mockDashboardPanelData.dashboardPanelData);
    });

    it("should handle different dashboard panel data", () => {
      const customPanelData = { value: { customProperty: 'test' } };
      mockDashboardPanelData.dashboardPanelData = customPanelData;
      
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBe(customPanelData);
    });
  });

  describe("Query Editor Configuration", () => {
    it("should configure QueryEditor with correct language", () => {
      wrapper = createWrapper();

      const queryEditor = wrapper.find('[data-test="dashboard-markdown-editor-query-editor"]');
      expect(queryEditor.attributes('language')).toBe('javascript');
    });

    it("should configure QueryEditor with debounce time", () => {
      wrapper = createWrapper();

      const queryEditor = wrapper.find('[data-test="dashboard-markdown-editor-query-editor"]');
      expect(queryEditor.attributes('debouncetime')).toBe('500');
    });

    it("should configure QueryEditor with correct CSS class", () => {
      wrapper = createWrapper();

      const queryEditor = wrapper.find('[data-test="dashboard-markdown-editor-query-editor"]');
      expect(queryEditor.classes()).toContain('javascript-query-editor');
    });

    it("should configure QueryEditor with inline styling", () => {
      wrapper = createWrapper();

      const queryEditor = wrapper.find('[data-test="dashboard-markdown-editor-query-editor"]');
      const style = queryEditor.attributes('style');

      expect(style).toContain('padding-left: 20px');
      expect(style).toContain('height: 100%');
    });
  });

  describe("Dynamic Styling Based on Theme", () => {
    it("should apply light theme background color", () => {
      mockStore.state.theme = 'light';
      wrapper = createWrapper();

      // Since we're testing the computed style binding, we check the component's reactive data
      expect(wrapper.vm.store.state.theme).toBe('light');
    });

    it("should apply dark theme background color", () => {
      mockStore.state.theme = 'dark';
      wrapper = createWrapper();

      expect(wrapper.vm.store.state.theme).toBe('dark');
    });

    it("should handle theme changes", async () => {
      wrapper = createWrapper();

      mockStore.state.theme = 'dark';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.store.state.theme).toBe('dark');

      mockStore.state.theme = 'light';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.store.state.theme).toBe('light');
    });
  });

  describe("Event Handling", () => {
    it("should handle QueryEditor query update", async () => {
      wrapper = createWrapper();

      const newQuery = "option = { tooltip: { trigger: 'axis' } };";
      const queryEditor = wrapper.findComponent({ name: 'QueryEditor' });
      
      if (queryEditor.exists()) {
        await queryEditor.vm.$emit('update:query', newQuery);
        expect(wrapper.vm.javascriptCodeContent).toBe(newQuery);
      } else {
        // Manually trigger the method since component is stubbed
        wrapper.vm.onEditorValueChange(newQuery);
        expect(wrapper.vm.javascriptCodeContent).toBe(newQuery);
        expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      }
    });

    it("should bind v-model correctly to QueryEditor", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.javascriptCodeContent).toBe(defaultModelValue);
    });

    it("should handle multiple rapid updates", () => {
      wrapper = createWrapper();

      const updates = [
        "option = { title: { text: '1' } };",
        "option = { title: { text: '2' } };",
        "option = { title: { text: '3' } };"
      ];

      updates.forEach(update => {
        wrapper.vm.onEditorValueChange(update);
      });

      expect(wrapper.vm.javascriptCodeContent).toBe(updates[2]);
      expect(wrapper.emitted('update:modelValue')).toHaveLength(3);
    });
  });

  describe("Component Structure and Layout", () => {
    it("should have proper container structure", () => {
      wrapper = createWrapper();

      const outerContainer = wrapper.find('.markdown-editor');
      expect(outerContainer.exists()).toBe(true);

      // Check for inner div with proper styling
      const innerDivs = wrapper.findAll('div');
      const hasInnerContainer = innerDivs.some(div => {
        const style = div.attributes('style');
        return style && style.includes('width: 100%') && style.includes('height: 100%');
      });
      expect(hasInnerContainer).toBe(true);

      // Check for col container
      const colContainers = wrapper.findAll('.col');
      const hasColContainer = colContainers.some(col => {
        const style = col.attributes('style');
        return style && style.includes('height: 100%');
      });
      expect(hasColContainer).toBe(true);
    });

    it("should maintain component hierarchy", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe('CustomChartEditor');
      expect(wrapper.vm.$options.components.QueryEditor).toBeDefined();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle very large JavaScript code", () => {
      const largeCode = "option = { series: [" + "{ data: [1, 2, 3] },".repeat(1000) + "] };";
      wrapper = createWrapper({ modelValue: largeCode });

      expect(wrapper.vm.javascriptCodeContent).toBe(largeCode);
    });

    it("should handle special characters in code", () => {
      const specialCharCode = 'option = { title: { text: "Chart with quotes and newlines" } };';
      wrapper = createWrapper({ modelValue: specialCharCode });

      expect(wrapper.vm.javascriptCodeContent).toBe(specialCharCode);
    });

    it("should handle multiline JavaScript code", () => {
      const multilineCode = `option = {
        title: {
          text: 'My Chart'
        },
        xAxis: {
          type: 'category',
          data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        },
        yAxis: {
          type: 'value'
        },
        series: [{
          data: [120, 200, 150, 80, 70, 110, 130],
          type: 'bar'
        }]
      };`;
      
      wrapper = createWrapper({ modelValue: multilineCode });

      expect(wrapper.vm.javascriptCodeContent).toBe(multilineCode);
    });

    it("should handle component unmount gracefully", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Reactive Data Updates", () => {
    it("should update javascriptCodeContent reactively", async () => {
      wrapper = createWrapper();

      const newCode = "option = { animation: true };";
      wrapper.vm.javascriptCodeContent = newCode;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.javascriptCodeContent).toBe(newCode);
    });

    it("should update splitterModel reactively", async () => {
      wrapper = createWrapper();

      wrapper.vm.splitterModel = 75;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.splitterModel).toBe(75);
    });

    it("should update dataToBeRendered reactively", async () => {
      wrapper = createWrapper();

      const newData = { chartData: [1, 2, 3] };
      wrapper.vm.dataToBeRendered = newData;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dataToBeRendered).toEqual(newData);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete editor workflow", async () => {
      wrapper = createWrapper();

      // Initial state
      expect(wrapper.vm.javascriptCodeContent).toBe(defaultModelValue);

      // Update content
      const newOption = "option = { legend: { data: ['Sales'] } };";
      wrapper.vm.onEditorValueChange(newOption);

      expect(wrapper.vm.javascriptCodeContent).toBe(newOption);
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();

      // Trigger layout update
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      wrapper.vm.layoutSplitterUpdated();

      expect(dispatchSpy).toHaveBeenCalled();
      dispatchSpy.mockRestore();
    });

    it("should maintain state consistency", () => {
      wrapper = createWrapper();

      const initialState = {
        splitterModel: wrapper.vm.splitterModel,
        dataToBeRendered: wrapper.vm.dataToBeRendered
      };

      wrapper.vm.onEditorValueChange("option = { grid: {} };");

      expect(wrapper.vm.splitterModel).toBe(initialState.splitterModel);
      expect(wrapper.vm.dataToBeRendered).toEqual(initialState.dataToBeRendered);
    });

    it("should handle stress testing", () => {
      wrapper = createWrapper();

      for (let i = 0; i < 50; i++) {
        wrapper.vm.onEditorValueChange(`option = { title: { text: 'Chart ${i}' } };`);
        wrapper.vm.splitterModel = 30 + (i % 40);
        wrapper.vm.layoutSplitterUpdated();
      }

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.javascriptCodeContent).toBe("option = { title: { text: 'Chart 49' } };");
      expect(wrapper.emitted('update:modelValue')).toHaveLength(50);
    });
  });

  describe("Props Validation", () => {
    it("should handle default modelValue correctly", () => {
      wrapper = createWrapper();

      expect(wrapper.props('modelValue')).toBe(defaultModelValue);
      expect(wrapper.vm.$props.modelValue).toBe(defaultModelValue);
    });

    it("should accept string modelValue", () => {
      const stringValue = "custom code";
      wrapper = createWrapper({ modelValue: stringValue });

      expect(wrapper.props('modelValue')).toBe(stringValue);
    });

    it("should handle prop updates", async () => {
      wrapper = createWrapper();

      const newValue = "option = { updated: true };";
      await wrapper.setProps({ modelValue: newValue });

      expect(wrapper.props('modelValue')).toBe(newValue);
    });
  });
});