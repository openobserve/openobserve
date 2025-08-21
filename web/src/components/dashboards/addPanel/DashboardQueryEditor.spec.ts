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

// Mock the image URL utility
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn().mockReturnValue("/mock-image.svg"),
}));

import DashboardQueryEditor from "@/components/dashboards/addPanel/DashboardQueryEditor.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockDashboardPanelData = {
  data: {
    id: "panel-1",
    title: "Test Panel",
    type: "line",
    queries: [
      {
        query: "SELECT * FROM test_stream",
        queryType: "sql",
        stream: "test_stream"
      }
    ]
  },
  layout: {
    currentQueryIndex: 0,
    vrlFunctionToggle: false
  }
};

describe("DashboardQueryEditor", () => {
  let wrapper: any;

  const defaultProps = {
    dashboardPanelData: mockDashboardPanelData,
    promqlMode: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(DashboardQueryEditor, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          'QueryTypeSelector': {
            template: '<div data-test="query-type-selector"></div>'
          }
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render query editor container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-panel-searchbar"]').exists()).toBe(true);
    });

    it("should show SQL label when not in PromQL mode", () => {
      wrapper = createWrapper({ promqlMode: false });

      expect(wrapper.text()).toContain("panel.sql");
    });

    it("should hide SQL label when in PromQL mode", () => {
      wrapper = createWrapper({ promqlMode: true });

      expect(wrapper.text()).not.toContain("panel.sql");
    });

    it("should render query type selector", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="query-type-selector"]').exists()).toBe(true);
    });

    it("should render VRL function toggle", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]').exists()).toBe(true);
    });
  });

  describe("Query Tabs", () => {
    it("should show query tabs in PromQL mode", () => {
      wrapper = createWrapper({ promqlMode: true });

      expect(wrapper.find('[data-test="dashboard-panel-query-tab"]').exists()).toBe(true);
    });

    it("should hide query tabs when not in PromQL mode", () => {
      wrapper = createWrapper({ promqlMode: false });

      expect(wrapper.find('[data-test="dashboard-panel-query-tab"]').exists()).toBe(false);
    });

    it("should show query tabs for geomap type", () => {
      const geomapPanelData = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, type: "geomap" }
      };
      
      wrapper = createWrapper({ 
        dashboardPanelData: geomapPanelData,
        promqlMode: false 
      });

      expect(wrapper.find('[data-test="dashboard-panel-query-tab"]').exists()).toBe(true);
    });

    it("should render multiple query tabs", () => {
      const multiQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [
            { query: "SELECT * FROM stream1", queryType: "sql" },
            { query: "SELECT * FROM stream2", queryType: "sql" },
            { query: "up", queryType: "promql" }
          ]
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: multiQueryPanelData,
        promqlMode: true 
      });

      const tabs = wrapper.findAll('[data-test^="dashboard-panel-query-tab-"]');
      expect(tabs.length).toBe(3);
    });

    it("should show correct tab labels", () => {
      const multiQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [
            { query: "SELECT * FROM stream1", queryType: "sql" },
            { query: "SELECT * FROM stream2", queryType: "sql" }
          ]
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: multiQueryPanelData,
        promqlMode: true 
      });

      expect(wrapper.text()).toContain("Query 1");
      expect(wrapper.text()).toContain("Query 2");
    });

    it("should show remove button for tabs when appropriate", () => {
      const multiQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [
            { query: "SELECT * FROM stream1", queryType: "sql" },
            { query: "SELECT * FROM stream2", queryType: "sql" }
          ]
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: multiQueryPanelData,
        promqlMode: true 
      });

      const removeButtons = wrapper.findAll('[data-test^="dashboard-panel-query-tab-remove-"]');
      expect(removeButtons.length).toBeGreaterThan(0);
    });
  });

  describe("Tab Management", () => {
    it("should add new tab when add button is clicked", async () => {
      wrapper = createWrapper({ promqlMode: true });

      const addBtn = wrapper.find('[data-test="dashboard-panel-query-tab-add"]');
      await addBtn.trigger('click');

      expect(wrapper.emitted('tab-added')).toBeTruthy();
    });

    it("should remove tab when remove button is clicked", async () => {
      const multiQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [
            { query: "SELECT * FROM stream1", queryType: "sql" },
            { query: "SELECT * FROM stream2", queryType: "sql" }
          ]
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: multiQueryPanelData,
        promqlMode: true 
      });

      const removeBtn = wrapper.find('[data-test="dashboard-panel-query-tab-remove-1"]');
      await removeBtn.trigger('click');

      expect(wrapper.emitted('tab-removed')).toBeTruthy();
    });

    it("should switch to clicked tab", async () => {
      const multiQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [
            { query: "SELECT * FROM stream1", queryType: "sql" },
            { query: "SELECT * FROM stream2", queryType: "sql" }
          ]
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: multiQueryPanelData,
        promqlMode: true 
      });

      const tab = wrapper.find('[data-test="dashboard-panel-query-tab-1"]');
      await tab.trigger('click');

      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).toBe(1);
    });

    it("should prevent event propagation when clicking remove button", async () => {
      const multiQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [
            { query: "SELECT * FROM stream1", queryType: "sql" },
            { query: "SELECT * FROM stream2", queryType: "sql" }
          ]
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: multiQueryPanelData,
        promqlMode: true 
      });

      const removeBtn = wrapper.find('[data-test="dashboard-panel-query-tab-remove-1"]');
      const clickSpy = vi.fn();
      removeBtn.element.addEventListener('click', clickSpy);
      
      await removeBtn.trigger('click');

      // Tab should not be switched when remove button is clicked
      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).not.toBe(1);
    });
  });

  describe("VRL Function Toggle", () => {
    it("should bind VRL function toggle state", () => {
      wrapper = createWrapper();

      const toggle = wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]');
      expect(toggle.exists()).toBe(true);
    });

    it("should emit function toggle event", async () => {
      wrapper = createWrapper();

      const toggle = wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]');
      await toggle.trigger('click');

      expect(wrapper.emitted('function-toggle')).toBeTruthy();
    });

    it("should disable VRL function toggle in PromQL mode", () => {
      wrapper = createWrapper({ promqlMode: true });

      const toggle = wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]');
      expect(toggle.attributes('disable')).toBeDefined();
    });

    it("should enable VRL function toggle when not in PromQL mode", () => {
      wrapper = createWrapper({ promqlMode: false });

      const toggle = wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]');
      expect(toggle.attributes('disable')).toBeUndefined();
    });

    it("should show correct icon for VRL function toggle", () => {
      wrapper = createWrapper();

      const toggle = wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]');
      expect(toggle.attributes('icon')).toContain('img:');
    });
  });

  describe("Query Type Selector", () => {
    it("should render query type selector component", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="query-type-selector"]').exists()).toBe(true);
    });

    it("should handle query type changes", async () => {
      wrapper = createWrapper();

      const selector = wrapper.findComponent('[data-test="query-type-selector"]');
      await selector.vm.$emit('query-type-changed', 'promql');

      expect(wrapper.emitted('query-type-changed')).toBeTruthy();
    });
  });

  describe("Component State", () => {
    it("should track current query index", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).toBe(0);
    });

    it("should update current query index when tab is selected", async () => {
      const multiQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [
            { query: "SELECT * FROM stream1", queryType: "sql" },
            { query: "SELECT * FROM stream2", queryType: "sql" }
          ]
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: multiQueryPanelData,
        promqlMode: true 
      });

      await wrapper.setData({ 
        'dashboardPanelData.layout.currentQueryIndex': 1 
      });

      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).toBe(1);
    });

    it("should track VRL function toggle state", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.layout.vrlFunctionToggle).toBe(false);
    });
  });

  describe("Event Handling", () => {
    it("should handle dropdown click events", async () => {
      wrapper = createWrapper();

      const dropdown = wrapper.find('[data-test="dashboard-panel-searchbar"]');
      await dropdown.trigger('click');

      expect(wrapper.emitted('dropdown-click')).toBeTruthy();
    });

    it("should prevent event propagation on tab interactions", async () => {
      wrapper = createWrapper({ promqlMode: true });

      const tabContainer = wrapper.find('[data-test="dashboard-panel-query-tab"]');
      const clickEvent = new Event('click');
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');

      tabContainer.element.dispatchEvent(clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe("Responsive Design", () => {
    it("should handle mobile arrows for tabs", () => {
      wrapper = createWrapper({ promqlMode: true });

      const tabs = wrapper.find('[data-test="dashboard-panel-query-tab"]');
      expect(tabs.attributes('mobile-arrows')).toBeDefined();
    });

    it("should handle outside arrows for tabs", () => {
      wrapper = createWrapper({ promqlMode: true });

      const tabs = wrapper.find('[data-test="dashboard-panel-query-tab"]');
      expect(tabs.attributes('outside-arrows')).toBeDefined();
    });

    it("should apply dense styling to tabs", () => {
      wrapper = createWrapper({ promqlMode: true });

      const tabs = wrapper.find('[data-test="dashboard-panel-query-tab"]');
      expect(tabs.attributes('dense')).toBeDefined();
    });
  });

  describe("Accessibility", () => {
    it("should provide proper ARIA labels", () => {
      wrapper = createWrapper();

      const toggle = wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]');
      expect(toggle.attributes('title')).toBe('Toggle Function Editor');
    });

    it("should support keyboard navigation", async () => {
      wrapper = createWrapper({ promqlMode: true });

      const tab = wrapper.find('[data-test="dashboard-panel-query-tab-0"]');
      await tab.trigger('keydown.enter');

      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).toBe(0);
    });

    it("should provide tooltips for buttons", () => {
      wrapper = createWrapper();

      const toggle = wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]');
      expect(toggle.attributes('title')).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty queries array", () => {
      const emptyQueriesPanelData = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, queries: [] }
      };

      wrapper = createWrapper({ dashboardPanelData: emptyQueriesPanelData });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle single query with multiple tabs condition", () => {
      const singleQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [{ query: "SELECT * FROM test", queryType: "sql" }]
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: singleQueryPanelData,
        promqlMode: true 
      });

      // Should show remove button even for single query if needed
      const removeBtn = wrapper.find('[data-test="dashboard-panel-query-tab-remove-0"]');
      expect(removeBtn.exists()).toBe(true);
    });

    it("should handle missing panel data gracefully", () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      wrapper = createWrapper({ dashboardPanelData: null });

      expect(wrapper.exists()).toBe(true);
      consoleWarnSpy.mockRestore();
    });
  });

  describe("Theme Integration", () => {
    it("should work with light theme", () => {
      store.state.theme = "light";
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should work with dark theme", () => {
      store.state.theme = "dark";
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Performance", () => {
    it("should handle rapid tab switching efficiently", async () => {
      const multiQueryPanelData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: Array.from({ length: 10 }, (_, i) => ({
            query: `SELECT * FROM stream${i}`,
            queryType: "sql"
          }))
        }
      };

      wrapper = createWrapper({ 
        dashboardPanelData: multiQueryPanelData,
        promqlMode: true 
      });

      // Rapidly switch between tabs
      for (let i = 0; i < 10; i++) {
        const tab = wrapper.find(`[data-test="dashboard-panel-query-tab-${i}"]`);
        await tab.trigger('click');
      }

      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).toBe(9);
    });
  });
});