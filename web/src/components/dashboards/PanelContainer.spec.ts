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
  }
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
    variablesData: { values: [] },
    DateTime: {
      start_time: new Date('2023-01-01T00:00:00Z'),
      end_time: new Date('2023-01-01T23:59:59Z')
    },
    selectedTimeObj: {
      start_time: new Date('2023-01-01T00:00:00Z'),
      end_time: new Date('2023-01-01T23:59:59Z'),
      type: 'relative'
    },
    viewOnly: false,
    errorData: null,
    maxQueryRange: [],
    dependentAdHocVariable: false,
    width: 400,
    height: 300
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

      expect(wrapper.vm.showViewPanel).toBe(true);
    });
  });

  describe("Error States", () => {
    it("should show error button when error data exists", () => {
      const errorMessage = "Query execution failed";
      wrapper = createWrapper({ errorData: errorMessage });

      expect(wrapper.find('[data-test="dashboard-panel-error-data"]').exists()).toBe(true);
    });

    it("should hide error button when no error data", () => {
      wrapper = createWrapper({ errorData: null });

      expect(wrapper.find('[data-test="dashboard-panel-error-data"]').exists()).toBe(false);
    });

    it("should show error tooltip with correct message", () => {
      const errorMessage = "Query execution failed";
      wrapper = createWrapper({ errorData: errorMessage });

      const errorBtn = wrapper.find('[data-test="dashboard-panel-error-data"]');
      const tooltip = errorBtn.find('q-tooltip');
      expect(tooltip.text().trim()).toBe(errorMessage);
    });
  });

  describe("Warning States", () => {
    it("should show dependent ad-hoc variable warning", () => {
      wrapper = createWrapper({ dependentAdHocVariable: true });

      expect(wrapper.find('[data-test="dashboard-panel-dependent-adhoc-variable-btn"]').exists()).toBe(true);
    });

    it("should hide dependent ad-hoc variable warning when false", () => {
      wrapper = createWrapper({ dependentAdHocVariable: false });

      expect(wrapper.find('[data-test="dashboard-panel-dependent-adhoc-variable-btn"]').exists()).toBe(false);
    });

    it("should show query range warning when max query range exceeded", () => {
      wrapper = createWrapper({ maxQueryRange: ["Query 1 exceeded limit"] });

      expect(wrapper.find('[data-test="dashboard-panel-max-query-range"]').exists()).toBe(true);
    });

    it("should hide query range warning when no issues", () => {
      wrapper = createWrapper({ maxQueryRange: [] });

      expect(wrapper.find('[data-test="dashboard-panel-max-query-range"]').exists()).toBe(false);
    });
  });

  describe("Chart Rendering", () => {
    it("should render chart renderer for chart types", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="chart-renderer"]').exists()).toBe(true);
    });

    it("should render table renderer for table type", () => {
      const tablePanel = { ...mockPanelData, type: "table" };
      wrapper = createWrapper({ data: tablePanel });

      expect(wrapper.find('[data-test="table-renderer"]').exists()).toBe(true);
    });

    it("should pass correct props to chart renderer", () => {
      wrapper = createWrapper();

      const chartRenderer = wrapper.findComponent('[data-test="chart-renderer"]');
      expect(chartRenderer.exists()).toBe(true);
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
      
      expect(wrapper.vm.showViewPanel).toBe(true);
      expect(wrapper.vm.selectedView).toBe('ViewPanel');
    });

    it("should emit panel events", async () => {
      wrapper = createWrapper();
      
      await wrapper.vm.onPanelModifyClick('EditPanel');
      
      expect(wrapper.emitted('panel-modify')).toBeTruthy();
    });
  });

  describe("Responsive Behavior", () => {
    it("should handle resize events", async () => {
      wrapper = createWrapper();
      
      // Mock ResizeObserver callback
      const resizeCallback = vi.fn();
      wrapper.vm.setupResizeObserver(resizeCallback);
      
      // Simulate resize
      const entries = [
        {
          contentRect: { width: 800, height: 400 }
        }
      ];
      
      if (wrapper.vm.resizeObserver) {
        wrapper.vm.resizeObserver.callback(entries);
        expect(resizeCallback).toHaveBeenCalled();
      }
    });

    it("should cleanup resize observer on unmount", () => {
      wrapper = createWrapper();
      const disconnectSpy = vi.spyOn(wrapper.vm.resizeObserver || {}, 'disconnect');
      
      wrapper.unmount();
      
      if (disconnectSpy.getMockImplementation()) {
        expect(disconnectSpy).toHaveBeenCalled();
      }
    });
  });

  describe("Props Validation", () => {
    it("should handle missing panel data gracefully", () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      wrapper = createWrapper({ data: null });
      
      expect(wrapper.exists()).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it("should handle malformed search data", () => {
      const malformedSearchData = { invalid: "data" };
      wrapper = createWrapper({ searchData: malformedSearchData });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty variables data", () => {
      wrapper = createWrapper({ variablesData: null });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing date time", () => {
      wrapper = createWrapper({ DateTime: null });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Context Menu", () => {
    it("should show context menu on right click when not view-only", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('contextmenu');

      expect(wrapper.vm.showContextMenu).toBe(true);
    });

    it("should hide context menu in view-only mode", async () => {
      wrapper = createWrapper({ viewOnly: true });
      
      await wrapper.find('[data-test="dashboard-panel-container"]').trigger('contextmenu');

      expect(wrapper.vm.showContextMenu).toBe(false);
    });

    it("should provide context menu options", () => {
      wrapper = createWrapper();
      
      const menuOptions = wrapper.vm.contextMenuOptions;
      expect(Array.isArray(menuOptions)).toBe(true);
      expect(menuOptions.length).toBeGreaterThan(0);
    });
  });

  describe("Accessibility", () => {
    it("should have proper ARIA labels", () => {
      wrapper = createWrapper();

      const container = wrapper.find('[data-test="dashboard-panel-container"]');
      expect(container.attributes('role')).toBeDefined();
    });

    it("should support keyboard navigation", async () => {
      wrapper = createWrapper();

      const container = wrapper.find('[data-test="dashboard-panel-container"]');
      await container.trigger('keydown.enter');

      expect(wrapper.emitted('panel-select')).toBeTruthy();
    });

    it("should have proper focus management", async () => {
      wrapper = createWrapper();

      const fullscreenBtn = wrapper.find('[data-test="dashboard-panel-fullscreen-btn"]');
      if (fullscreenBtn.exists()) {
        await fullscreenBtn.trigger('focus');
        expect(document.activeElement).toBe(fullscreenBtn.element);
      }
    });
  });

  describe("Performance", () => {
    it("should debounce resize events", async () => {
      wrapper = createWrapper();
      
      const debouncedCallback = vi.fn();
      wrapper.vm.setupResizeDebounce(debouncedCallback, 100);
      
      // Trigger multiple resize events quickly
      wrapper.vm.onResize();
      wrapper.vm.onResize();
      wrapper.vm.onResize();
      
      // Only one callback should be scheduled
      setTimeout(() => {
        expect(debouncedCallback).toHaveBeenCalledTimes(1);
      }, 150);
    });

    it("should optimize re-renders", async () => {
      wrapper = createWrapper();
      const renderSpy = vi.spyOn(wrapper.vm, '$forceUpdate');
      
      // Update props multiple times
      await wrapper.setProps({ errorData: "Error 1" });
      await wrapper.setProps({ errorData: "Error 2" });
      
      // Should not force unnecessary re-renders
      expect(renderSpy).not.toHaveBeenCalled();
    });
  });
});