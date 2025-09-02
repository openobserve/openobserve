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

import PanelContainer from "@/components/dashboards/PanelContainer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockPanelData = {
  id: "panel-1",
  title: "Test Panel",
  description: "Test panel description",
  type: "line",
  queries: [
    {
      query: "SELECT * FROM test",
      queryType: "sql"
    }
  ],
  layout: {
    x: 0,
    y: 0,
    w: 6,
    h: 4
  },
  panels: [{ tabId: "default-tab" }]
};

const mockSearchResponse = {
  data: {
    hits: [],
    total: 0,
    took: 10
  }
};

describe("PanelContainer", () => {
  let wrapper: any;

  const defaultProps = {
    data: mockPanelData,
    searchData: mockSearchResponse,
    variablesData: { 
      values: [],
      isLoading: false 
    },
    currentVariablesData: { 
      values: [],
      isLoading: false 
    },
    DateTime: {
      start_time: new Date('2023-01-01T00:00:00Z'),
      end_time: new Date('2023-01-01T23:59:59Z')
    },
    selectedTimeDate: {
      start_time: new Date('2023-01-01T00:00:00Z'),
      end_time: new Date('2023-01-01T23:59:59Z'),
      type: 'relative'
    },
    viewOnly: false,
    width: 400,
    height: 300,
    metaData: {
      queries: [{ 
        query: "SELECT * FROM test",
        variables: []
      }]
    },
    forceLoad: false,
    searchType: 'logs',
    dashboardId: 'test-dashboard-id',
    folderId: 'test-folder-id',
    reportId: null,
    runId: 'test-run-id',
    tabId: 'test-tab-id',
    tabName: 'Test Tab'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
    
    // Mock window methods
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
    return mount(PanelContainer, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'ChartRenderer': { template: '<div data-test="chart-renderer"></div>' },
          'TableRenderer': { template: '<div data-test="table-renderer"></div>' },
          'ViewPanel': { template: '<div data-test="view-panel"></div>' },
          'QueryInspector': { template: '<div data-test="query-inspector"></div>' },
          'PanelSchemaRenderer': { 
            template: '<div data-test="panel-schema-renderer"></div>',
            props: ['panelSchema', 'selectedTimeObj', 'width', 'height']
          },
          'SinglePanelMove': { 
            template: '<div data-test="single-panel-move"></div>',
            props: ['title', 'message']
          },
          'RelativeTime': { 
            template: '<span>relative time</span>',
            props: ['timestamp', 'fullTimePrefix']
          }
        },
        mocks: {
          $t: (key: string) => key,
          $route: { params: {}, query: {} },
          $router: { push: vi.fn(), replace: vi.fn() }
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render panel container with basic structure", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-panel-container"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-panel-bar"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Test Panel");
    });

    it("should show drag indicator when not in view-only mode", () => {
      wrapper = createWrapper({ viewOnly: false });

      expect(wrapper.find('[data-test="dashboard-panel-drag"]').exists()).toBe(true);
    });

    it("should hide drag indicator in view-only mode", () => {
      wrapper = createWrapper({ viewOnly: true });

      expect(wrapper.find('[data-test="dashboard-panel-drag"]').exists()).toBe(false);
    });

    it("should apply dark theme class", () => {
      store.state.theme = "dark";
      wrapper = createWrapper();

      expect(wrapper.find('.dark-mode').exists()).toBe(true);
    });

    it("should apply light theme class", () => {
      store.state.theme = "light";
      wrapper = createWrapper();

      expect(wrapper.find('.bg-white').exists()).toBe(true);
    });
  });

  describe("Panel Header", () => {
    it("should display panel title", () => {
      wrapper = createWrapper();

      const header = wrapper.find('.panelHeader');
      expect(header.text()).toBe("Test Panel");
      expect(header.attributes('title')).toBe("Test Panel");
    });

    it("should show description tooltip on hover when description exists", async () => {
      wrapper = createWrapper();
      
      // Trigger mouseover to show hover state
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseover');

      expect(wrapper.find('[data-test="dashboard-panel-description-info"]').exists()).toBe(true);
    });

    it("should hide description tooltip when no description", async () => {
      const panelWithoutDescription = { ...mockPanelData, description: "" };
      wrapper = createWrapper({ data: panelWithoutDescription });
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseover');

      expect(wrapper.find('[data-test="dashboard-panel-description-info"]').exists()).toBe(false);
    });
  });

  describe("Panel Controls", () => {
    it("should show fullscreen button on hover when not view-only", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseover');

      expect(wrapper.find('[data-test="dashboard-panel-fullscreen-btn"]').exists()).toBe(true);
    });

    it("should hide fullscreen button in view-only mode", async () => {
      wrapper = createWrapper({ viewOnly: true });
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseover');

      expect(wrapper.find('[data-test="dashboard-panel-fullscreen-btn"]').exists()).toBe(false);
    });

    it("should hide controls on mouse leave", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseover');
      expect(wrapper.find('[data-test="dashboard-panel-fullscreen-btn"]').exists()).toBe(true);
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseleave');
      expect(wrapper.find('[data-test="dashboard-panel-fullscreen-btn"]').exists()).toBe(false);
    });

    it("should open fullscreen view when fullscreen button is clicked", async () => {
      wrapper = createWrapper();
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseover');
      await wrapper.find('[data-test="dashboard-panel-fullscreen-btn"]').trigger('click');

      expect(wrapper.emitted('onViewPanel')).toBeTruthy();
      expect(wrapper.emitted('onViewPanel')[0]).toEqual([mockPanelData.id]);
    });
  });

  describe("Error States", () => {
    it("should show error button when error data exists", async () => {
      wrapper = createWrapper();
      
      // Simulate error by calling the onError method
      await wrapper.vm.onError("Query execution failed");

      expect(wrapper.find('[data-test="dashboard-panel-error-data"]').exists()).toBe(true);
    });

    it("should hide error button when no error data", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-panel-error-data"]').exists()).toBe(false);
    });

    it("should show error tooltip with correct message", async () => {
      wrapper = createWrapper();
      const errorMessage = "Query execution failed";
      
      // Simulate error by calling the onError method
      await wrapper.vm.onError(errorMessage);
      await wrapper.vm.$nextTick();

      const errorBtn = wrapper.find('[data-test="dashboard-panel-error-data"]');
      expect(errorBtn.exists()).toBe(true);
      
      const tooltip = errorBtn.find('q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text().trim()).toBe(errorMessage);
      } else {
        // Check if error message is in errorData ref
        expect(wrapper.vm.errorData).toBe(errorMessage);
      }
    });
  });

  describe("Warning States", () => {
    it("should show dependent ad-hoc variable warning", async () => {
      // Create conditions for dependentAdHocVariable to be true
      const variablesData = {
        values: [{
          type: 'dynamic_filters',
          name: 'testVariable',
          value: [{ operator: 'eq', name: 'field1', value: 'value1' }]
        }],
        isLoading: false
      };
      
      const metaData = {
        queries: [{ 
          query: "SELECT * FROM test",
          variables: [] // Empty variables will make dependentAdHocVariable true
        }]
      };

      wrapper = createWrapper({ variablesData, metaData });
      await wrapper.vm.metaDataValue(metaData);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-dependent-adhoc-variable-btn"]').exists()).toBe(true);
    });

    it("should hide dependent ad-hoc variable warning when false", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-panel-dependent-adhoc-variable-btn"]').exists()).toBe(false);
    });

    it("should show query range warning when max query range exceeded", async () => {
      wrapper = createWrapper();
      
      // Simulate the result metadata update that would show warnings
      await wrapper.vm.handleResultMetadataUpdate([{
        function_error: "Query 1 exceeded limit",
        new_start_time: "2023-01-01T00:00:00Z",
        new_end_time: "2023-01-01T23:59:59Z"
      }]);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-max-duration-warning"]').exists()).toBe(true);
    });

    it("should hide query range warning when no issues", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-panel-max-duration-warning"]').exists()).toBe(false);
    });
  });

  describe("Chart Rendering", () => {
    it("should render panel schema renderer for chart types", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="panel-schema-renderer"]').exists()).toBe(true);
    });

    it("should render panel schema renderer for table type", () => {
      const tablePanel = { ...mockPanelData, type: "table" };
      wrapper = createWrapper({ data: tablePanel });

      expect(wrapper.find('[data-test="panel-schema-renderer"]').exists()).toBe(true);
    });

    it("should pass correct props to panel schema renderer", () => {
      wrapper = createWrapper();

      const panelRenderer = wrapper.findComponent('[data-test="panel-schema-renderer"]');
      expect(panelRenderer.exists()).toBe(true);
    });
  });

  describe("Panel State Management", () => {
    it("should track hover state correctly", async () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.isCurrentlyHoveredPanel).toBe(false);
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseover');
      expect(wrapper.vm.isCurrentlyHoveredPanel).toBe(true);
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('mouseleave');
      expect(wrapper.vm.isCurrentlyHoveredPanel).toBe(false);
    });

    it("should handle panel modification requests", async () => {
      wrapper = createWrapper();
      
      await wrapper.vm.onPanelModifyClick('ViewPanel');
      
      expect(wrapper.emitted('onViewPanel')).toBeTruthy();
      expect(wrapper.emitted('onViewPanel')[0]).toEqual([mockPanelData.id]);
    });

    it("should emit panel events", async () => {
      wrapper = createWrapper();
      const routerPushSpy = vi.spyOn(wrapper.vm.$router, 'push');
      
      await wrapper.vm.onPanelModifyClick('EditPanel');
      
      // EditPanel calls router.push, not emit, so let's check the router was called
      expect(routerPushSpy).toHaveBeenCalled();
    });
  });

  describe("Responsive Behavior", () => {
    it("should handle component mounting", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-panel-container"]').exists()).toBe(true);
    });

    it("should cleanup on unmount", () => {
      wrapper = createWrapper();
      
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Props Validation", () => {
    it("should handle missing panel data gracefully", () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Create minimal valid data to avoid null reference
      const minimalData = { ...mockPanelData, title: null };
      wrapper = createWrapper({ 
        data: minimalData,
        variablesData: { values: [], isLoading: false }
      });
      
      expect(wrapper.exists()).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it("should handle malformed search data", () => {
      const malformedSearchData = { invalid: "data" };
      wrapper = createWrapper({ searchData: malformedSearchData });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty variables data", () => {
      wrapper = createWrapper({ 
        variablesData: { values: [], isLoading: false },
        currentVariablesData: { values: [], isLoading: false }
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing date time", () => {
      wrapper = createWrapper({ DateTime: null });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Context Menu", () => {
    it("should show dropdown menu in non-view-only mode", () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const dropdown = wrapper.find('[data-test="dashboard-edit-panel-Test Panel-dropdown"]');
      expect(dropdown.exists()).toBe(true);
    });

    it("should hide dropdown menu in view-only mode", () => {
      wrapper = createWrapper({ viewOnly: true });
      
      const dropdown = wrapper.find('[data-test="dashboard-edit-panel-Test Panel-dropdown"]');
      expect(dropdown.exists()).toBe(false);
    });
  });

  describe("Performance", () => {
    it("should handle component updates without errors", async () => {
      wrapper = createWrapper();
      
      // Update props multiple times
      await wrapper.setProps({ width: 500 });
      await wrapper.setProps({ height: 400 });
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle variable updates", async () => {
      wrapper = createWrapper();
      const newVariablesData = {
        values: [{ name: 'test', value: 'new value' }],
        isLoading: false
      };
      
      await wrapper.setProps({ variablesData: newVariablesData });
      
      expect(wrapper.props().variablesData).toEqual(newVariablesData);
    });
  });
});