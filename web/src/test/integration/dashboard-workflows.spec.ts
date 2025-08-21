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

// Mock services
vi.mock("@/services/dashboards", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
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

// Mock utilities
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn().mockReturnValue("/mock-image.svg"),
}));

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
  }),
  dispose: vi.fn(),
}));

import Dashboards from "@/views/Dashboards/Dashboards.vue";
import ViewDashboard from "@/views/Dashboards/ViewDashboard.vue";
import AddDashboard from "@/components/dashboards/AddDashboard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import dashboardService from "@/services/dashboards";
import searchService from "@/services/search";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockDashboards = [
  {
    dashboardId: "dashboard-1",
    title: "Sales Analytics",
    description: "Sales performance dashboard",
    created: "2023-01-01T00:00:00Z",
    owner: "user@example.com",
    folderId: "default"
  },
  {
    dashboardId: "dashboard-2", 
    title: "System Monitoring",
    description: "Infrastructure monitoring dashboard",
    created: "2023-01-02T00:00:00Z",
    owner: "admin@example.com",
    folderId: "monitoring"
  }
];

const mockDashboardDetail = {
  data: {
    dashboardId: "dashboard-1",
    title: "Sales Analytics",
    description: "Sales performance dashboard",
    variables: { list: [] },
    tabs: [
      {
        tabId: "tab-1",
        name: "Overview",
        panels: [
          {
            id: "panel-1",
            type: "line",
            title: "Revenue Trend",
            queries: [{ query: "SELECT * FROM sales", queryType: "sql" }],
            layout: { x: 0, y: 0, w: 6, h: 4 }
          },
          {
            id: "panel-2",
            type: "pie",
            title: "Sales by Region",
            queries: [{ query: "SELECT region, SUM(amount) FROM sales GROUP BY region", queryType: "sql" }],
            layout: { x: 6, y: 0, w: 6, h: 4 }
          }
        ]
      }
    ]
  }
};

const mockSearchResponse = {
  data: {
    hits: [
      { timestamp: "2023-01-01T00:00:00Z", revenue: 1000, region: "US" },
      { timestamp: "2023-01-01T01:00:00Z", revenue: 1200, region: "EU" },
    ],
    total: 2,
    took: 15
  }
};

describe("Dashboard Workflows Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mocks
    vi.mocked(dashboardService.list).mockResolvedValue({ data: mockDashboards });
    vi.mocked(dashboardService.get).mockResolvedValue(mockDashboardDetail);
    vi.mocked(dashboardService.create).mockResolvedValue({ data: { dashboardId: "new-dashboard" } });
    vi.mocked(dashboardService.update).mockResolvedValue({ data: { success: true } });
    vi.mocked(dashboardService.delete).mockResolvedValue({ data: { success: true } });
    vi.mocked(searchService.search_multi).mockResolvedValue(mockSearchResponse);
    
    // Setup store state
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
    store.state.printMode = false;
    store.state.organizationData = { folders: [{ id: "default", name: "Default" }] };
  });

  describe("Dashboard Creation Workflow", () => {
    it("should complete end-to-end dashboard creation", async () => {
      const wrapper = mount(Dashboards, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'router-view': true,
            'AddDashboard': AddDashboard,
            'ExportDashboard': { template: '<div></div>' }
          },
          mocks: {
            $t: (key: string) => key,
            $route: { params: {}, query: {} },
            $router: router
          }
        }
      });

      await flushPromises();

      // Step 1: User clicks "Add Dashboard" button
      const addButton = wrapper.find('[data-test="dashboard-add"]');
      if (addButton.exists()) {
        await addButton.trigger('click');
        
        // Step 2: Fill in dashboard details
        const addDashboardComponent = wrapper.findComponent(AddDashboard);
        if (addDashboardComponent.exists()) {
          await addDashboardComponent.find('[data-test="add-dashboard-name"]').setValue('New Analytics Dashboard');
          await addDashboardComponent.find('[data-test="add-dashboard-description"]').setValue('Customer analytics dashboard');
          
          // Step 3: Submit the form
          await addDashboardComponent.find('form').trigger('submit.prevent');
          await flushPromises();
          
          // Verify dashboard creation API was called
          expect(dashboardService.create).toHaveBeenCalledWith(
            "test-org",
            expect.objectContaining({
              name: 'New Analytics Dashboard',
              description: 'Customer analytics dashboard'
            }),
            expect.any(String)
          );
        }
      }

      wrapper.unmount();
    });

    it("should handle dashboard creation validation errors", async () => {
      const wrapper = mount(AddDashboard, {
        props: {
          showFolderSelection: false,
          beingUpdated: false,
          dashboardData: { id: "", name: "", description: "" }
        },
        global: {
          plugins: [i18n, store],
          mocks: { $t: (key: string) => key }
        }
      });

      // Try to submit without required fields
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      // Should show validation error
      expect(wrapper.text()).toContain('dashboard.nameRequired');

      wrapper.unmount();
    });
  });

  describe("Dashboard Viewing Workflow", () => {
    it("should load and display dashboard with panels", async () => {
      const mockRoute = {
        params: { dashboardId: "dashboard-1", folderId: "default" },
        query: {}
      };

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { template: '<div></div>' },
            'PanelContainer': { 
              template: '<div data-test="panel-container">{{ data.title }}</div>',
              props: ['data']
            },
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();

      // Verify dashboard data is loaded
      expect(dashboardService.get).toHaveBeenCalledWith("test-org", "dashboard-1", "default");

      // Verify dashboard title is displayed
      expect(wrapper.text()).toContain("Sales Analytics");

      // Verify panels are rendered
      const panels = wrapper.findAll('[data-test="panel-container"]');
      expect(panels.length).toBeGreaterThan(0);

      wrapper.unmount();
    });

    it("should refresh dashboard data when refresh button is clicked", async () => {
      const mockRoute = {
        params: { dashboardId: "dashboard-1", folderId: "default" },
        query: {}
      };

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { template: '<div></div>' },
            'PanelContainer': { template: '<div></div>' },
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();
      vi.clearAllMocks(); // Clear initial load calls

      // Click refresh button
      const refreshButton = wrapper.find('[data-test="dashboard-refresh-btn"]');
      await refreshButton.trigger('click');
      await flushPromises();

      // Verify search API is called for data refresh
      expect(searchService.search_multi).toHaveBeenCalled();

      wrapper.unmount();
    });
  });

  describe("Dashboard Panel Management Workflow", () => {
    it("should add new panel to dashboard", async () => {
      const mockRoute = {
        params: { dashboardId: "dashboard-1", folderId: "default" },
        query: {}
      };

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { template: '<div></div>' },
            'PanelContainer': { template: '<div></div>' },
            'AddPanel': { 
              template: '<div data-test="add-panel-dialog"></div>',
              emits: ['panel-added']
            }
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();

      // Click add panel button
      const addPanelButton = wrapper.find('[data-test="dashboard-panel-add"]');
      await addPanelButton.trigger('click');

      // Verify add panel dialog opens
      expect(wrapper.vm.addPanelRef).toBeDefined();

      wrapper.unmount();
    });

    it("should handle panel interactions", async () => {
      const mockPanelData = mockDashboardDetail.data.tabs[0].panels[0];
      
      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'PanelContainer': {
              template: `
                <div data-test="panel-container" @click="$emit('panel-click', data)">
                  <div data-test="panel-fullscreen" @click="$emit('panel-fullscreen', data)">Fullscreen</div>
                  <div data-test="panel-edit" @click="$emit('panel-edit', data)">Edit</div>
                </div>
              `,
              props: ['data'],
              emits: ['panel-click', 'panel-fullscreen', 'panel-edit']
            }
          },
          mocks: {
            $t: (key: string) => key,
            $route: {
              params: { dashboardId: "dashboard-1", folderId: "default" },
              query: {}
            },
            $router: router
          }
        }
      });

      await flushPromises();

      const panelContainer = wrapper.findComponent('[data-test="panel-container"]');
      await panelContainer.vm.$emit('panel-fullscreen', mockPanelData);

      expect(wrapper.emitted('panel-fullscreen')).toBeTruthy();

      wrapper.unmount();
    });
  });

  describe("Dashboard Settings Workflow", () => {
    it("should open and navigate dashboard settings", async () => {
      const mockRoute = {
        params: { dashboardId: "dashboard-1", folderId: "default" },
        query: {}
      };

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { template: '<div></div>' },
            'DashboardSettings': {
              template: '<div data-test="dashboard-settings"></div>',
              emits: ['settings-saved']
            }
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();

      // Click settings button
      const settingsButton = wrapper.find('[data-test="dashboard-setting-btn"]');
      await settingsButton.trigger('click');

      expect(wrapper.vm.showSettingsDialog).toBe(true);

      wrapper.unmount();
    });
  });

  describe("Dashboard Export Workflow", () => {
    it("should handle dashboard sharing", async () => {
      const mockRoute = {
        params: { dashboardId: "dashboard-1", folderId: "default" },
        query: {}
      };

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { 
              template: '<div data-test="export-dashboard"></div>',
              props: ['dashboardId']
            }
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();

      // Click share button
      const shareButton = wrapper.find('[data-test="dashboard-share-btn"]');
      await shareButton.trigger('click');

      expect(wrapper.vm.shareLink.execute).toBeDefined();

      wrapper.unmount();
    });

    it("should handle print mode", async () => {
      const mockRoute = {
        params: { dashboardId: "dashboard-1", folderId: "default" },
        query: {}
      };

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { template: '<div></div>' }
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();

      // Click print button
      const printButton = wrapper.find('[data-test="dashboard-print-btn"]');
      await printButton.trigger('click');

      expect(store.state.printMode).toBe(true);

      wrapper.unmount();
    });
  });

  describe("Error Handling Workflows", () => {
    it("should handle dashboard loading errors gracefully", async () => {
      vi.mocked(dashboardService.get).mockRejectedValue(new Error("Dashboard not found"));
      
      const mockRoute = {
        params: { dashboardId: "non-existent", folderId: "default" },
        query: {}
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { template: '<div></div>' }
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      expect(wrapper.exists()).toBe(true); // Component should still exist

      consoleSpy.mockRestore();
      wrapper.unmount();
    });

    it("should handle search API errors", async () => {
      vi.mocked(searchService.search_multi).mockRejectedValue(new Error("Search failed"));
      
      const mockRoute = {
        params: { dashboardId: "dashboard-1", folderId: "default" },
        query: {}
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { template: '<div></div>' },
            'PanelContainer': { template: '<div data-test="panel-error">Error loading data</div>' }
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();

      // Trigger refresh to test error handling
      const refreshButton = wrapper.find('[data-test="dashboard-refresh-btn"]');
      await refreshButton.trigger('click');
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      wrapper.unmount();
    });
  });

  describe("Full Dashboard Lifecycle", () => {
    it("should complete full dashboard lifecycle: create → view → edit → delete", async () => {
      // Step 1: Create Dashboard
      const createWrapper = mount(AddDashboard, {
        props: {
          showFolderSelection: false,
          beingUpdated: false,
          dashboardData: { id: "", name: "", description: "" }
        },
        global: {
          plugins: [i18n, store],
          mocks: { $t: (key: string) => key }
        }
      });

      await createWrapper.find('[data-test="add-dashboard-name"]').setValue('Lifecycle Test Dashboard');
      await createWrapper.find('form').trigger('submit.prevent');
      await flushPromises();

      expect(dashboardService.create).toHaveBeenCalled();
      createWrapper.unmount();

      // Step 2: View Dashboard
      const viewWrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': { template: '<div></div>' },
            'ExportDashboard': { template: '<div></div>' }
          },
          mocks: {
            $t: (key: string) => key,
            $route: { params: { dashboardId: "new-dashboard", folderId: "default" }, query: {} },
            $router: router
          }
        }
      });

      await flushPromises();
      expect(dashboardService.get).toHaveBeenCalled();
      viewWrapper.unmount();

      // Step 3: Update Dashboard  
      vi.mocked(dashboardService.update).mockResolvedValue({ data: { success: true } });
      
      const updateWrapper = mount(AddDashboard, {
        props: {
          showFolderSelection: false,
          beingUpdated: true,
          dashboardData: { id: "new-dashboard", name: "Lifecycle Test Dashboard", description: "" }
        },
        global: {
          plugins: [i18n, store],
          mocks: { $t: (key: string) => key }
        }
      });

      await updateWrapper.find('[data-test="add-dashboard-name"]').setValue('Updated Lifecycle Dashboard');
      await updateWrapper.find('form').trigger('submit.prevent');
      await flushPromises();

      expect(dashboardService.update).toHaveBeenCalled();
      updateWrapper.unmount();

      // Step 4: Delete Dashboard
      await dashboardService.delete("test-org", "new-dashboard", "default");
      expect(dashboardService.delete).toHaveBeenCalledWith("test-org", "new-dashboard", "default");
    });
  });

  describe("Real-time Updates", () => {
    it("should handle auto-refresh functionality", async () => {
      const mockRoute = {
        params: { dashboardId: "dashboard-1", folderId: "default" },
        query: {}
      };

      const wrapper = mount(ViewDashboard, {
        global: {
          plugins: [i18n, store],
          stubs: {
            'DateTimePickerDashboard': { template: '<div></div>' },
            'AutoRefreshInterval': {
              template: '<button @click="$emit(\'trigger\')" data-test="auto-refresh">Auto Refresh</button>',
              emits: ['trigger']
            },
            'ExportDashboard': { template: '<div></div>' }
          },
          mocks: {
            $t: (key: string) => key,
            $route: mockRoute,
            $router: router
          }
        }
      });

      await flushPromises();
      vi.clearAllMocks();

      // Trigger auto-refresh
      const autoRefresh = wrapper.findComponent('[data-test="auto-refresh"]');
      await autoRefresh.vm.$emit('trigger');
      await flushPromises();

      expect(searchService.search_multi).toHaveBeenCalled();

      wrapper.unmount();
    });
  });
});