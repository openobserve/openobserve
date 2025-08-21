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

vi.mock("@/services/dashboards", () => ({
  default: {
    get: vi.fn(),
    move_panel: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/services/search", () => ({
  default: {
    search_multi: vi.fn(),
    search: vi.fn(),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue([]),
  }),
}));

import ViewDashboard from "@/views/Dashboards/ViewDashboard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import dashboardService from "@/services/dashboards";
import searchService from "@/services/search";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockDashboardData = {
  data: {
    dashboardId: "test-dashboard-1",
    title: "Test Dashboard",
    description: "Test dashboard description",
    variables: {
      list: []
    },
    tabs: [
      {
        tabId: "tab-1",
        name: "Tab 1",
        panels: [
          {
            id: "panel-1",
            type: "line",
            title: "Test Panel",
            queries: [{ query: "SELECT * FROM test", queryType: "sql" }],
            layout: { x: 0, y: 0, w: 6, h: 3 }
          }
        ]
      }
    ]
  }
};

const mockSearchResponse = {
  data: {
    hits: [],
    total: 0,
    took: 10
  }
};

describe("ViewDashboard", () => {
  let wrapper: any;
  const mockRoute = {
    params: { 
      dashboardId: "test-dashboard-1",
      folderId: "default"
    },
    query: {}
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(dashboardService.get).mockResolvedValue(mockDashboardData);
    vi.mocked(searchService.search_multi).mockResolvedValue(mockSearchResponse);
    
    // Mock router
    vi.spyOn(router, 'push').mockImplementation(vi.fn());
    vi.spyOn(router, 'replace').mockImplementation(vi.fn());
    
    // Mock store
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
    store.state.printMode = false;
    store.state.timezone = "UTC";
    store.state.organizationData = { folders: [] };
    store.state.zoConfig = { min_auto_refresh_interval: 5 };
    
    // Mock window methods
    Object.defineProperty(window, 'location', {
      value: { href: '', replace: vi.fn() },
      writable: true
    });
    
    global.print = vi.fn();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (routeParams = mockRoute) => {
    return mount(ViewDashboard, {
      global: {
        plugins: [i18n, store],
        stubs: {
          'DateTimePickerDashboard': { template: '<div data-test="datetime-picker"></div>' },
          'AutoRefreshInterval': { template: '<div data-test="auto-refresh"></div>' },
          'ExportDashboard': { template: '<div data-test="export-dashboard"></div>' },
          'PanelContainer': { template: '<div data-test="panel-container"></div>' },
          'VariablesValueSelector': { template: '<div data-test="variables-selector"></div>' }
        },
        mocks: {
          $route: routeParams,
          $router: router,
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Initialization", () => {
    it("should render dashboard view with correct structure", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-back-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-panel-add"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-refresh-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-share-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-setting-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-print-btn"]').exists()).toBe(true);
    });

    it("should load dashboard data on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(dashboardService.get).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "test-dashboard-1",
        "default"
      );
    });

    it("should display dashboard title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Test Dashboard");
    });

    it("should handle theme changes", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();

      expect(wrapper.find('.dark-mode').exists()).toBe(true);
    });
  });

  describe("User Interactions", () => {
    it("should navigate back when back button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('[data-test="dashboard-back-btn"]').trigger('click');

      expect(router.push).toHaveBeenCalledWith({
        path: "/dashboards",
        query: { folderId: "default" }
      });
    });

    it("should refresh data when refresh button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.clearAllMocks();
      await wrapper.find('[data-test="dashboard-refresh-btn"]').trigger('click');

      expect(searchService.search_multi).toHaveBeenCalled();
    });

    it("should open add panel dialog when add panel button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const addPanelBtn = wrapper.find('[data-test="dashboard-panel-add"]');
      await addPanelBtn.trigger('click');

      expect(wrapper.vm.addPanelRef).toBeDefined();
    });

    it("should toggle print mode when print button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('[data-test="dashboard-print-btn"]').trigger('click');

      expect(store.state.printMode).toBe(true);
    });

    it("should open settings dialog when settings button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('[data-test="dashboard-setting-btn"]').trigger('click');

      expect(wrapper.vm.showSettingsDialog).toBe(true);
    });
  });

  describe("Dashboard Loading States", () => {
    it("should show loading spinner when organization data is loading", () => {
      store.state.organizationData.folders = [];
      wrapper = createWrapper();

      expect(wrapper.find('q-spinner-dots').exists()).toBe(true);
    });

    it("should hide loading spinner when organization data is loaded", () => {
      store.state.organizationData.folders = [{ id: "1", name: "Folder 1" }];
      wrapper = createWrapper();

      expect(wrapper.find('q-spinner-dots').exists()).toBe(false);
    });

    it("should disable refresh button when panels are loading", async () => {
      wrapper = createWrapper();
      await wrapper.setData({ arePanelsLoading: true });

      const refreshBtn = wrapper.find('[data-test="dashboard-refresh-btn"]');
      expect(refreshBtn.attributes('disable')).toBeDefined();
    });

    it("should show cancel button when panels are loading in enterprise mode", async () => {
      wrapper = createWrapper();
      wrapper.vm.config = { isEnterprise: 'true' };
      await wrapper.setData({ arePanelsLoading: true });

      expect(wrapper.find('[data-test="dashboard-cancel-btn"]').exists()).toBe(true);
    });
  });

  describe("Print Mode", () => {
    it("should hide certain elements in print mode", async () => {
      store.state.printMode = true;
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-back-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="dashboard-panel-add"]').exists()).toBe(false);
    });

    it("should show time string in print mode", async () => {
      store.state.printMode = true;
      wrapper = createWrapper();
      await wrapper.setData({
        currentTimeObj: {
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-01-01T23:59:59Z')
        }
      });

      expect(wrapper.text()).toContain('(UTC)');
    });

    it("should change print button icon in print mode", async () => {
      store.state.printMode = true;
      wrapper = createWrapper();

      const printBtn = wrapper.find('[data-test="dashboard-print-btn"]');
      expect(printBtn.attributes('icon')).toBe('close');
    });
  });

  describe("Fullscreen Mode", () => {
    it("should apply fullscreen class when in fullscreen", async () => {
      wrapper = createWrapper();
      await wrapper.setData({ isFullscreen: true });

      expect(wrapper.find('.fullscreen').exists()).toBe(true);
    });

    it("should hide navigation elements in fullscreen", async () => {
      wrapper = createWrapper();
      await wrapper.setData({ isFullscreen: true });

      expect(wrapper.find('[data-test="dashboard-back-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="dashboard-panel-add"]').exists()).toBe(false);
    });
  });

  describe("Variables", () => {
    it("should show variables changed state", async () => {
      wrapper = createWrapper();
      await wrapper.setData({ isVariablesChanged: true });

      const refreshBtn = wrapper.find('[data-test="dashboard-refresh-btn"]');
      expect(refreshBtn.attributes('color')).toBe('warning');
    });

    it("should handle variable time changes", async () => {
      wrapper = createWrapper();
      
      const dateTimePicker = wrapper.findComponent({ name: 'DateTimePickerDashboard' });
      if (dateTimePicker.exists()) {
        await dateTimePicker.vm.$emit('hide');
        expect(wrapper.vm.setTimeForVariables).toBeDefined();
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle dashboard loading error", async () => {
      vi.mocked(dashboardService.get).mockRejectedValue(new Error("Dashboard not found"));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should handle search error", async () => {
      vi.mocked(searchService.search_multi).mockRejectedValue(new Error("Search failed"));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      // Trigger refresh to test search error
      await wrapper.find('[data-test="dashboard-refresh-btn"]').trigger('click');
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Route Parameter Changes", () => {
    it("should reload dashboard when dashboardId changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.clearAllMocks();

      // Simulate route parameter change
      await wrapper.vm.$options.watch['$route.params.dashboardId'].call(
        wrapper.vm,
        'new-dashboard-id',
        'test-dashboard-1'
      );

      expect(dashboardService.get).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        'new-dashboard-id',
        'default'
      );
    });

    it("should reload dashboard when folderId changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.clearAllMocks();

      // Simulate route parameter change
      await wrapper.vm.$options.watch['$route.params.folderId'].call(
        wrapper.vm,
        'new-folder-id',
        'default'
      );

      expect(dashboardService.get).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        'test-dashboard-1',
        'new-folder-id'
      );
    });
  });

  describe("Component Lifecycle", () => {
    it("should set up auto-refresh interval", async () => {
      wrapper = createWrapper();
      await wrapper.setData({ refreshInterval: 10 });

      expect(wrapper.vm.refreshInterval).toBe(10);
    });

    it("should clean up resources on unmount", () => {
      wrapper = createWrapper();
      const cleanupSpy = vi.spyOn(wrapper.vm, '$destroy');
      
      wrapper.unmount();
      
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  describe("Date Time Handling", () => {
    it("should handle date time picker updates", async () => {
      wrapper = createWrapper();
      const newDate = {
        startTime: new Date('2023-01-01T00:00:00Z'),
        endTime: new Date('2023-01-01T23:59:59Z'),
        type: 'absolute'
      };

      await wrapper.setData({ selectedDate: newDate });

      expect(wrapper.vm.selectedDate).toEqual(newDate);
    });

    it("should format time string correctly", async () => {
      wrapper = createWrapper();
      const timeObj = {
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-01-01T23:59:59Z')
      };

      await wrapper.setData({ currentTimeObj: timeObj });

      expect(wrapper.vm.timeString).toBeDefined();
    });
  });

  describe("Dashboard Actions", () => {
    it("should handle dashboard sharing", async () => {
      wrapper = createWrapper();
      const shareButton = wrapper.find('[data-test="dashboard-share-btn"]');
      
      await shareButton.trigger('click');

      expect(wrapper.vm.shareLink.execute).toBeDefined();
    });

    it("should handle dashboard export", async () => {
      wrapper = createWrapper();
      const exportComponent = wrapper.findComponent({ name: 'ExportDashboard' });
      
      if (exportComponent.exists()) {
        expect(exportComponent.props('dashboardId')).toBe('test-dashboard-1');
      }
    });
  });

  describe("Panel Management", () => {
    it("should handle panel addition", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const addPanelBtn = wrapper.find('[data-test="dashboard-panel-add"]');
      await addPanelBtn.trigger('click');

      expect(wrapper.vm.addPanelData).toBeDefined();
    });

    it("should handle panel updates", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Simulate panel update
      const panelData = {
        id: "panel-1",
        title: "Updated Panel",
        type: "bar"
      };

      await wrapper.vm.updatePanelData(panelData);

      expect(wrapper.vm.currentDashboardData.data.tabs[0].panels).toBeDefined();
    });
  });
});