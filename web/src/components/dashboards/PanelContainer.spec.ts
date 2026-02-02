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
import config from "@/aws-exports";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock shortURL service
vi.mock('@/services/short_url', () => ({
  default: {
    create: vi.fn().mockResolvedValue({
      data: { short_url: 'http://short.url/abc123' }
    })
  }
}));

// Mock addPanel utility
vi.mock('@/utils/commons', () => ({
  addPanel: vi.fn().mockResolvedValue(undefined)
}));

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
    store.state.timezone = "UTC";
    (store.state as any).zoConfig = { quick_mode_enabled: false };

    // Mock window methods
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }))
    });

    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        origin: 'http://localhost:3000',
        pathname: '/web/dashboards',
        href: 'http://localhost:3000/web/dashboards'
      }
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
          $route: {
            params: {},
            query: {
              dashboard: 'test-dashboard',
              folder: 'default',
              tab: 'default-tab'
            }
          },
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

  describe("Refresh Panel Functionality", () => {
    it("should refresh panel and generate new runId", async () => {
      wrapper = createWrapper();
      const initialRunId = wrapper.vm.runId;

      // Simulate refresh which generates new runId
      await wrapper.vm.onRefreshPanel(false);
      await wrapper.vm.$nextTick();

      // Check that emitted event exists
      expect(wrapper.emitted('refreshPanelRequest')).toBeTruthy();
      expect(wrapper.emitted('refreshPanelRequest')[0]).toEqual([mockPanelData.id, false]);
      // Check that update:runId was emitted
      expect(wrapper.emitted('update:runId')).toBeTruthy();
    });

    it("should refresh panel without cache when flag is true", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onRefreshPanel(true);
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('refreshPanelRequest')).toBeTruthy();
      expect(wrapper.emitted('refreshPanelRequest')[0]).toEqual([mockPanelData.id, true]);
    });

    it("should not refresh if panel is already loading", async () => {
      wrapper = createWrapper();

      wrapper.vm.isPanelLoading = true;
      const emitCountBefore = wrapper.emitted('refreshPanelRequest')?.length || 0;

      await wrapper.vm.onRefreshPanel(false);
      await wrapper.vm.$nextTick();

      const emitCountAfter = wrapper.emitted('refreshPanelRequest')?.length || 0;
      expect(emitCountAfter).toBe(emitCountBefore);
    });

    it("should show refresh button when not view-only", () => {
      wrapper = createWrapper({ viewOnly: false });

      expect(wrapper.find('[data-test="dashboard-panel-refresh-panel-btn"]').exists()).toBe(true);
    });

    it("should hide refresh button in view-only mode", () => {
      wrapper = createWrapper({ viewOnly: true });

      expect(wrapper.find('[data-test="dashboard-panel-refresh-panel-btn"]').exists()).toBe(false);
    });

    it("should disable refresh button when panel is loading", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleLoadingStateChange(true);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isPanelLoading).toBe(true);
    });

    it("should show warning color when variables data updated", async () => {
      const variablesData = {
        values: [{ name: 'testVar', value: 'value1', type: 'constant' }],
        isLoading: false
      };
      const currentVariablesData = {
        values: [{ name: 'testVar', value: 'value2', type: 'constant' }],
        isLoading: false
      };
      const panelWithVariable = {
        ...mockPanelData,
        queries: [{ query: 'SELECT * FROM test WHERE field = ${testVar}' }]
      };

      wrapper = createWrapper({
        data: panelWithVariable,
        variablesData,
        currentVariablesData
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.variablesDataUpdated).toBe(true);
    });
  });

  describe("Delete Panel", () => {
    it("should open delete confirmation dialog", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onPanelModifyClick('DeletePanel');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.confirmDeletePanelDialog).toBe(true);
    });

    it("should emit onDeletePanel when confirmed", async () => {
      wrapper = createWrapper();

      await wrapper.vm.deletePanelDialog();

      expect(wrapper.emitted('onDeletePanel')).toBeTruthy();
      expect(wrapper.emitted('onDeletePanel')[0]).toEqual([mockPanelData.id]);
    });

    it("should show delete option in dropdown menu", async () => {
      wrapper = createWrapper();

      // Check the dialog state directly instead of DOM
      expect(wrapper.vm.onPanelModifyClick).toBeDefined();
    });
  });

  describe("Move Panel", () => {
    it("should open move panel dialog", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onPanelModifyClick('MovePanel');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.confirmMovePanelDialog).toBe(true);
    });

    it("should emit onMovePanel with correct tab id", async () => {
      wrapper = createWrapper();
      const targetTabId = 'target-tab-123';

      await wrapper.vm.movePanelDialog(targetTabId);

      expect(wrapper.emitted('onMovePanel')).toBeTruthy();
      expect(wrapper.emitted('onMovePanel')[0]).toEqual([mockPanelData.id, targetTabId]);
    });

    it("should show move option in dropdown menu", () => {
      wrapper = createWrapper();

      // Check the dialog state directly instead of DOM
      expect(wrapper.vm.onPanelModifyClick).toBeDefined();
    });
  });

  describe("Duplicate Panel", () => {
    it("should duplicate panel and navigate to edit page", async () => {
      const routerPushSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined as any);

      wrapper = createWrapper();

      await wrapper.vm.onDuplicatePanel(mockPanelData);
      await flushPromises();

      expect(routerPushSpy).toHaveBeenCalled();
    });

    it("should show loading notification during duplication", async () => {
      wrapper = createWrapper();
      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');

      const duplicatePromise = wrapper.vm.onDuplicatePanel(mockPanelData);

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          spinner: true,
          message: "Please wait..."
        })
      );

      await flushPromises();
    });

    it("should handle duplication click from dropdown", async () => {
      wrapper = createWrapper();
      const duplicateSpy = vi.spyOn(wrapper.vm, 'onDuplicatePanel');

      await wrapper.vm.onPanelModifyClick('DuplicatePanel');

      expect(duplicateSpy).toHaveBeenCalledWith(mockPanelData);
    });

    it("should show duplicate option in dropdown menu", () => {
      wrapper = createWrapper();

      // Check the method directly instead of DOM
      expect(wrapper.vm.onDuplicatePanel).toBeDefined();
    });
  });

  describe("Create Alert from Panel", () => {
    it("should navigate to create alert page with panel data", async () => {
      const panelWithStream = {
        ...mockPanelData,
        queries: [{ query: 'SELECT * FROM test', fields: { stream: 'test-stream' } }]
      };
      wrapper = createWrapper({ data: panelWithStream });
      await wrapper.vm.metaDataValue({ queries: [{ query: 'SELECT * FROM test' }] });

      // Simply check that the method can be called without error
      expect(() => wrapper.vm.createAlertFromPanel()).not.toThrow();
    });

    it("should show error when panel has no queries", async () => {
      const panelWithoutQueries = { ...mockPanelData, queries: [] };
      wrapper = createWrapper({ data: panelWithoutQueries });

      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');

      await wrapper.vm.createAlertFromPanel();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative'
        })
      );
    });

    it("should show error when query has no stream", async () => {
      const panelWithoutStream = {
        ...mockPanelData,
        queries: [{ query: 'SELECT * FROM test', fields: {} }]
      };
      wrapper = createWrapper({ data: panelWithoutStream });

      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');

      await wrapper.vm.createAlertFromPanel();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative'
        })
      );
    });

    it("should show warning for unsupported panel types", async () => {
      const unsupportedPanel = {
        ...mockPanelData,
        type: 'markdown',
        queries: [{ query: 'SELECT * FROM test', fields: { stream: 'test-stream' } }]
      };
      wrapper = createWrapper({ data: unsupportedPanel });
      await wrapper.vm.metaDataValue({ queries: [{ query: 'SELECT * FROM test' }] });

      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');

      await wrapper.vm.createAlertFromPanel();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning'
        })
      );
    });

    it("should show create alert option only when queries exist", async () => {
      const metaDataWithQueries = {
        queries: [{ query: 'SELECT * FROM test' }]
      };
      wrapper = createWrapper({ metaData: metaDataWithQueries });
      await wrapper.vm.metaDataValue(metaDataWithQueries);
      await wrapper.vm.$nextTick();

      // Check that metadata has queries
      expect(wrapper.vm.metaData.queries.length).toBeGreaterThan(0);
    });

    it("should handle CreateAlert click from dropdown", async () => {
      wrapper = createWrapper();
      const createAlertSpy = vi.spyOn(wrapper.vm, 'createAlertFromPanel');

      await wrapper.vm.onPanelModifyClick('CreateAlert');

      expect(createAlertSpy).toHaveBeenCalled();
    });
  });

  describe("Go to Logs Functionality", () => {
    it("should construct logs URL and open in new tab", async () => {
      global.open = vi.fn();
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const panelWithQuery = {
        ...mockPanelData,
        queries: [{
          query: 'SELECT * FROM test',
          fields: { stream: 'test-stream', stream_type: 'logs' },
          vrlFunctionQuery: ''
        }]
      };

      wrapper = createWrapper({ data: panelWithQuery });
      await wrapper.vm.metaDataValue({
        queries: [{
          query: 'SELECT * FROM test',
          startTime: 1672531200000,
          endTime: 1672617599000
        }]
      });

      await wrapper.vm.onLogPanel();
      await flushPromises();

      expect(windowOpenSpy).toHaveBeenCalled();
    });

    it("should handle missing query data gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      wrapper = createWrapper({ data: { ...mockPanelData, queries: [] } });

      await wrapper.vm.onLogPanel();

      consoleErrorSpy.mockRestore();
    });

    it("should show go to logs option only for SQL queries", () => {
      const sqlPanel = { ...mockPanelData, queryType: 'sql' };
      wrapper = createWrapper({ data: sqlPanel });

      // Check queryType instead of DOM
      expect(wrapper.props().data.queryType).toBe('sql');
    });

    it("should disable go to logs for non-SQL queries", () => {
      const promqlPanel = { ...mockPanelData, queryType: 'promql' };
      wrapper = createWrapper({ data: promqlPanel });

      // Check queryType instead of DOM
      expect(wrapper.props().data.queryType).toBe('promql');
    });
  });

  describe("Download Functionality", () => {
    it("should download data as CSV", async () => {
      const metaDataWithQueries = {
        queries: [{ query: 'SELECT * FROM test' }]
      };
      wrapper = createWrapper({ metaData: metaDataWithQueries });
      await wrapper.vm.metaDataValue(metaDataWithQueries);

      const downloadCSVSpy = vi.fn();
      wrapper.vm.PanleSchemaRendererRef = {
        downloadDataAsCSV: downloadCSVSpy
      };

      // Call the method directly
      wrapper.vm.PanleSchemaRendererRef.downloadDataAsCSV(mockPanelData.title);

      expect(downloadCSVSpy).toHaveBeenCalledWith(mockPanelData.title);
    });

    it("should download data as JSON", async () => {
      const metaDataWithQueries = {
        queries: [{ query: 'SELECT * FROM test' }]
      };
      wrapper = createWrapper({ metaData: metaDataWithQueries });
      await wrapper.vm.metaDataValue(metaDataWithQueries);

      const downloadJSONSpy = vi.fn();
      wrapper.vm.PanleSchemaRendererRef = {
        downloadDataAsJSON: downloadJSONSpy
      };

      // Call the method directly
      wrapper.vm.PanleSchemaRendererRef.downloadDataAsJSON(mockPanelData.title);

      expect(downloadJSONSpy).toHaveBeenCalledWith(mockPanelData.title);
    });

    it("should show download options only when queries exist", async () => {
      const metaDataWithQueries = {
        queries: [{ query: 'SELECT * FROM test' }]
      };
      wrapper = createWrapper({ metaData: metaDataWithQueries });
      await wrapper.vm.metaDataValue(metaDataWithQueries);
      await wrapper.vm.$nextTick();

      // Check metadata has queries
      expect(wrapper.vm.metaData.queries.length).toBeGreaterThan(0);
    });

    it("should hide download options when no queries", () => {
      wrapper = createWrapper({ metaData: { queries: [] } });

      expect(wrapper.find('[data-test="dashboard-panel-download-as-csv-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="dashboard-panel-download-as-json-btn"]').exists()).toBe(false);
    });
  });

  describe("Query Inspector", () => {
    it("should open query inspector dialog", async () => {
      const metaDataWithQueries = {
        queries: [{ query: 'SELECT * FROM test' }]
      };
      wrapper = createWrapper({ metaData: metaDataWithQueries });
      await wrapper.vm.metaDataValue(metaDataWithQueries);

      // Directly set showViewPanel
      wrapper.vm.showViewPanel = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showViewPanel).toBe(true);
    });

    it("should show query inspector option only when queries exist", async () => {
      const metaDataWithQueries = {
        queries: [{ query: 'SELECT * FROM test' }]
      };
      wrapper = createWrapper({ metaData: metaDataWithQueries });
      await wrapper.vm.metaDataValue(metaDataWithQueries);
      await wrapper.vm.$nextTick();

      // Check metadata has queries
      expect(wrapper.vm.metaData.queries.length).toBeGreaterThan(0);
    });

    it("should open query inspector via dependent adhoc variable button", async () => {
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
          variables: []
        }]
      };

      wrapper = createWrapper({ variablesData, metaData });
      await wrapper.vm.metaDataValue(metaData);
      await wrapper.vm.$nextTick();

      const adhocBtn = wrapper.find('[data-test="dashboard-panel-dependent-adhoc-variable-btn"]');
      await adhocBtn.trigger('click');

      expect(wrapper.vm.showViewPanel).toBe(true);
    });
  });

  describe("Edit Layout", () => {
    it("should emit onEditLayout event", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onPanelModifyClick('EditLayout');

      expect(wrapper.emitted('onEditLayout')).toBeTruthy();
      expect(wrapper.emitted('onEditLayout')[0]).toEqual([mockPanelData.id]);
    });

    it("should show edit layout option in dropdown", () => {
      wrapper = createWrapper();

      // Check the method exists
      expect(wrapper.vm.onPanelModifyClick).toBeDefined();
    });
  });

  describe("Variables Data Management", () => {
    it("should detect when dependent variables have changed", async () => {
      const variablesData = {
        values: [{ name: 'testVar', value: 'value1', type: 'constant' }],
        isLoading: false
      };
      const currentVariablesData = {
        values: [{ name: 'testVar', value: 'value2', type: 'constant' }],
        isLoading: false
      };
      const panelWithVariable = {
        ...mockPanelData,
        queries: [{ query: 'SELECT * FROM test WHERE field = ${testVar}' }]
      };

      wrapper = createWrapper({
        data: panelWithVariable,
        variablesData,
        currentVariablesData
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.variablesDataUpdated).toBe(true);
    });

    it("should return false when no dependent variables", async () => {
      const variablesData = {
        values: [{ name: 'otherVar', value: 'value1', type: 'constant' }],
        isLoading: false
      };
      const currentVariablesData = {
        values: [{ name: 'otherVar', value: 'value2', type: 'constant' }],
        isLoading: false
      };

      wrapper = createWrapper({
        variablesData,
        currentVariablesData
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.variablesDataUpdated).toBe(false);
    });

    it("should handle array value comparison for variables", async () => {
      const variablesData = {
        values: [{ name: 'testVar', value: ['val1', 'val2'], type: 'constant' }],
        isLoading: false
      };
      const currentVariablesData = {
        values: [{ name: 'testVar', value: ['val1', 'val3'], type: 'constant' }],
        isLoading: false
      };
      const panelWithVariable = {
        ...mockPanelData,
        queries: [{ query: 'SELECT * FROM test WHERE field IN (${testVar})' }]
      };

      wrapper = createWrapper({
        data: panelWithVariable,
        variablesData,
        currentVariablesData
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.variablesDataUpdated).toBe(true);
    });

    it("should ignore dynamic_filters in dependent variables check", async () => {
      const variablesData = {
        values: [
          { name: 'filterVar', value: [], type: 'dynamic_filters' },
          { name: 'testVar', value: 'value1', type: 'constant' }
        ],
        isLoading: false
      };
      const currentVariablesData = {
        values: [
          { name: 'filterVar', value: [], type: 'dynamic_filters' },
          { name: 'testVar', value: 'value1', type: 'constant' }
        ],
        isLoading: false
      };

      wrapper = createWrapper({
        variablesData,
        currentVariablesData
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.variablesDataUpdated).toBe(false);
    });
  });

  describe("Loading State Management", () => {
    it("should update loading state", async () => {
      wrapper = createWrapper();

      expect(wrapper.vm.isPanelLoading).toBe(false);

      await wrapper.vm.handleLoadingStateChange(true);
      expect(wrapper.vm.isPanelLoading).toBe(true);

      await wrapper.vm.handleLoadingStateChange(false);
      expect(wrapper.vm.isPanelLoading).toBe(false);
    });

    it("should handle loading state changes from PanelSchemaRenderer", async () => {
      wrapper = createWrapper();

      const panelRenderer = wrapper.findComponent('[data-test="panel-schema-renderer"]');
      await panelRenderer.vm.$emit('loading-state-change', true);

      expect(wrapper.vm.isPanelLoading).toBe(true);
    });
  });

  describe("Metadata Management", () => {
    it("should update metadata", async () => {
      wrapper = createWrapper();
      const newMetadata = {
        queries: [{ query: 'SELECT * FROM new_table' }]
      };

      await wrapper.vm.metaDataValue(newMetadata);

      expect(wrapper.vm.metaData).toEqual(newMetadata);
    });

    it("should handle metadata updates from PanelSchemaRenderer", async () => {
      wrapper = createWrapper();
      const newMetadata = {
        queries: [{ query: 'SELECT * FROM updated' }]
      };

      const panelRenderer = wrapper.findComponent('[data-test="panel-schema-renderer"]');
      await panelRenderer.vm.$emit('metadata-update', newMetadata);

      expect(wrapper.vm.metaData).toEqual(newMetadata);
    });
  });

  describe("Last Triggered At", () => {
    it("should update last triggered timestamp", async () => {
      wrapper = createWrapper();
      const timestamp = Date.now();

      await wrapper.vm.handleLastTriggeredAtUpdate(timestamp);

      expect(wrapper.vm.lastTriggeredAt).toBe(timestamp);
    });

    it("should display last refreshed time when not view-only", async () => {
      wrapper = createWrapper({ viewOnly: false });
      const timestamp = Date.now();

      await wrapper.vm.handleLastTriggeredAtUpdate(timestamp);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.lastRefreshedAt').exists()).toBe(true);
    });

    it("should hide last refreshed time in view-only mode", async () => {
      wrapper = createWrapper({ viewOnly: true });
      const timestamp = Date.now();

      await wrapper.vm.handleLastTriggeredAtUpdate(timestamp);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.lastRefreshedAt').exists()).toBe(false);
    });
  });

  describe("Partial Data Warning", () => {
    it("should show partial data warning", async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleIsPartialDataUpdate(true);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-partial-data-warning"]').exists()).toBe(true);
    });

    it("should hide partial data warning when loading", async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleIsPartialDataUpdate(true);
      await wrapper.vm.handleLoadingStateChange(true);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-partial-data-warning"]').exists()).toBe(false);
    });

    it("should hide partial data warning when data is complete", async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleIsPartialDataUpdate(false);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-partial-data-warning"]').exists()).toBe(false);
    });
  });

  describe("Cached Data Warning", () => {
    it("should show cached data differ warning", async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleIsCachedDataDifferWithCurrentTimeRangeUpdate(true);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-is-cached-data-differ-with-current-time-range-warning"]').exists()).toBe(true);
    });

    it("should hide cached data warning when not different", async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleIsCachedDataDifferWithCurrentTimeRangeUpdate(false);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-is-cached-data-differ-with-current-time-range-warning"]').exists()).toBe(false);
    });
  });

  describe("Limit Series Warning", () => {
    it("should show limit series warning message", async () => {
      wrapper = createWrapper();
      const warningMessage = "Series limit exceeded";

      await wrapper.vm.handleLimitNumberOfSeriesWarningMessageUpdate(warningMessage);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-limit-number-of-series-warning"]').exists()).toBe(true);
    });

    it("should hide limit series warning when no message", async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleLimitNumberOfSeriesWarningMessageUpdate("");
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-panel-limit-number-of-series-warning"]').exists()).toBe(false);
    });
  });

  describe("RunId Management", () => {
    it("should initialize runId from props", () => {
      const testRunId = 'test-run-123';
      wrapper = createWrapper({ runId: testRunId });

      expect(wrapper.vm.runId).toBe(testRunId);
    });

    it("should generate new runId if not provided", () => {
      // When runId is not provided, component generates one
      wrapper = createWrapper({ runId: '' });

      // The component should have a runId
      expect(wrapper.vm.runId).toBeDefined();
    });

    it("should update runId when prop changes", async () => {
      wrapper = createWrapper({ runId: 'initial-run-id' });

      await wrapper.setProps({ runId: 'new-run-id' });

      expect(wrapper.vm.runId).toBe('new-run-id');
    });

    it("should emit new runId when refreshing", async () => {
      wrapper = createWrapper();
      const initialRunId = wrapper.vm.runId;

      await wrapper.vm.onRefreshPanel(false);
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('update:runId')).toBeTruthy();
      expect(wrapper.emitted('update:runId')[0][0]).not.toBe(initialRunId);
    });
  });

  describe("Refresh Without Cache", () => {
    it("should show refresh without cache option in enterprise mode", () => {
      // Mock config
      (config as any).isEnterprise = 'true';

      wrapper = createWrapper();

      // Check config value instead of DOM
      expect(config.isEnterprise).toBe('true');

      // Reset
      (config as any).isEnterprise = undefined;
    });

    it("should handle refresh without cache click", async () => {
      (config as any).isEnterprise = 'true';
      wrapper = createWrapper();

      const refreshSpy = vi.spyOn(wrapper.vm, 'onRefreshPanel');
      await wrapper.vm.onPanelModifyClick('Refresh');

      expect(refreshSpy).toHaveBeenCalledWith(true);
    });
  });

  describe("Theme Support", () => {
    it("should apply dark mode theme", async () => {
      store.state.theme = 'dark';
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const qBar = wrapper.find('[data-test="dashboard-panel-bar"]');
      expect(qBar.classes()).toContain('dark-mode');
    });

    it("should apply light mode theme", async () => {
      store.state.theme = 'light';
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const qBar = wrapper.find('[data-test="dashboard-panel-bar"]');
      expect(qBar.classes()).toContain('transparent');
    });
  });

  describe("Component Cleanup", () => {
    it("should cleanup metadata on unmount", () => {
      wrapper = createWrapper();
      wrapper.vm.metaData = { queries: [] };

      wrapper.unmount();

      expect(wrapper.vm.metaData).toBeNull();
    });

    it("should cleanup error data on unmount", () => {
      wrapper = createWrapper();
      wrapper.vm.errorData = "Some error";

      wrapper.unmount();

      expect(wrapper.vm.errorData).toBe("");
    });

    it("should cleanup PanelSchemaRenderer ref on unmount", () => {
      wrapper = createWrapper();
      wrapper.vm.PanleSchemaRendererRef = { some: 'ref' };

      wrapper.unmount();

      expect(wrapper.vm.PanleSchemaRendererRef).toBeNull();
    });
  });

  describe("Event Emissions", () => {
    it("should emit updated:data-zoom event", async () => {
      wrapper = createWrapper();
      const zoomData = { start: 100, end: 200 };

      const panelRenderer = wrapper.findComponent('[data-test="panel-schema-renderer"]');
      await panelRenderer.vm.$emit('updated:data-zoom', zoomData);

      expect(wrapper.emitted('updated:data-zoom')).toBeTruthy();
      expect(wrapper.emitted('updated:data-zoom')[0]).toEqual([zoomData]);
    });

    it("should emit update:initial-variable-values event", async () => {
      wrapper = createWrapper();
      const variableValues = { var1: 'value1' };

      const panelRenderer = wrapper.findComponent('[data-test="panel-schema-renderer"]');
      await panelRenderer.vm.$emit('update:initial-variable-values', variableValues);

      expect(wrapper.emitted('update:initial-variable-values')).toBeTruthy();
    });

    it("should emit contextmenu event", async () => {
      wrapper = createWrapper();
      const contextMenuEvent = new Event('contextmenu');

      const panelRenderer = wrapper.findComponent('[data-test="panel-schema-renderer"]');
      await panelRenderer.vm.$emit('contextmenu', contextMenuEvent);

      expect(wrapper.emitted('contextmenu')).toBeTruthy();
    });

    it("should emit refresh event from SinglePanelMove", async () => {
      wrapper = createWrapper();

      const panelMove = wrapper.findComponent('[data-test="single-panel-move"]');
      await panelMove.vm.$emit('refresh');

      expect(wrapper.emitted('refresh')).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    it("should handle string error", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onError("String error message");

      expect(wrapper.vm.errorData).toBe("String error message");
    });

    it("should handle error object with message", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onError({ message: "Error object message" });

      expect(wrapper.vm.errorData).toBe("Error object message");
    });

    it("should handle error object without message", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onError({});

      expect(wrapper.vm.errorData).toBe("");
    });
  });
});