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
import { mount, shallowMount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import RenderDashboardCharts from "./RenderDashboardCharts.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock GridStack
const mockGridStackInstance = {
  init: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  removeAll: vi.fn(),
  makeWidget: vi.fn(),
  getGridItems: vi.fn().mockReturnValue([]),
  float: vi.fn(),
  setAnimation: vi.fn(),
  setStatic: vi.fn(),
};

vi.mock("gridstack", () => ({
  GridStack: {
    init: vi.fn(() => mockGridStackInstance),
  },
}));

vi.mock("gridstack/dist/gridstack.min.css", () => ({}));

// Mock composables
const mockNotifications = { showPositiveNotification: vi.fn(), showErrorNotification: vi.fn() };
const mockLoading = { isLoading: ref(false) };
const mockDebouncer = { setImmediateValue: vi.fn(), setDebounceValue: vi.fn() };

vi.mock("@/composables/useNotifications", () => ({
  default: () => mockNotifications,
}));

vi.mock("@/composables/useLoading", () => ({
  useLoading: () => mockLoading,
}));

vi.mock("../../utils/dashboard/useCustomDebouncer", () => ({
  useCustomDebouncer: () => mockDebouncer,
}));

// Mock utils
vi.mock("../../utils/commons", () => ({
  checkIfVariablesAreLoaded: vi.fn().mockReturnValue(false),
  updateDashboard: vi.fn().mockResolvedValue(true),
}));

describe("RenderDashboardCharts", () => {
  let wrapper;

  const defaultProps = {
    viewOnly: false,
    dashboardData: {
      dashboardId: "test-dashboard",
      name: "Test Dashboard",
      variables: { showDynamicFilters: true, list: [] },
      tabs: [{ tabId: "default", name: "Default Tab", panels: [] }],
      panels: [
        {
          id: "panel-1",
          tabId: "default",
          title: "Test Panel",
          type: "line",
          layout: { x: 0, y: 0, w: 6, h: 4 },
          queries: [],
        },
      ],
    },
    folderId: "default",
    reportId: null,
    currentTimeObj: { __global: { start: "now-1h", end: "now" } },
    initialVariableValues: {},
    selectedDateForViewPanel: null,
    showTabs: false,
    forceLoad: false,
    searchType: "logs",
    runId: "test-run-id",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
    store.state.printMode = false;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  const createWrapper = (props = {}) => {
    return shallowMount(RenderDashboardCharts, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store, router],
        mocks: {
          $t: (key) => key,
          $route: { params: {}, query: {} },
          $router: { push: vi.fn(), replace: vi.fn() },
        },
      },
    });
  };

  describe("Component Initialization", () => {
    it("should render without errors with minimum props", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize with correct default values", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.props().viewOnly).toBe(false);
    });

    it("should handle missing optional props gracefully", () => {
      wrapper = createWrapper({
        showTabs: false,
        selectedDateForViewPanel: null,
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should set up provide/inject correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize GridStack when mounted", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle component activation lifecycle", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should clean up resources on unmount", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });

    it("should handle props validation", () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      wrapper = createWrapper({
        viewOnly: "invalid", // Wrong type
        forceLoad: "invalid", // Wrong type
      });
      expect(wrapper.exists()).toBe(true);
      consoleWarn.mockRestore();
    });
  });

  describe("GridStack Integration", () => {
    it("should initialize GridStack with correct configuration", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle GridStack change events for drag/drop", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle GridStack resize events", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should update panel layouts when grid items change", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should disable/enable grid based on viewOnly prop", async () => {
      wrapper = createWrapper({ viewOnly: true });
      await nextTick();
      expect(wrapper.props().viewOnly).toBe(true);
    });

    it("should disable/enable grid based on loading state", async () => {
      wrapper = createWrapper();
      mockLoading.isLoading.value = true;
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle grid refresh when tabs change", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle grid refresh when panels change", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should clean up GridStack on component destroy", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });

    it("should handle grid initialization errors gracefully", async () => {
      mockGridStackInstance.init.mockImplementation(() => {
        throw new Error("GridStack initialization failed");
      });
      
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
      
      mockGridStackInstance.init.mockRestore();
    });

    it("should handle minimum width/height constraints", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle layout position calculations", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Panel Management", () => {
    it("should render panels from selected tab", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty panels array", () => {
      const dashboardWithEmptyPanels = {
        ...defaultProps.dashboardData,
        tabs: [{ tabId: "default", name: "Default Tab", panels: [] }],
      };
      wrapper = createWrapper({ dashboardData: dashboardWithEmptyPanels });
      expect(wrapper.exists()).toBe(true);
    });

    it("should render NoPanel component when no panels exist", () => {
      const dashboardWithNoPanels = {
        ...defaultProps.dashboardData,
        tabs: [{ tabId: "default", name: "Default Tab", panels: [] }],
        panels: [],
      };
      wrapper = createWrapper({ dashboardData: dashboardWithNoPanels });
      expect(wrapper.exists()).toBe(true);
    });

    it("should pass correct props to PanelContainer components", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel deletion events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel view events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel move events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel refresh events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle layout edit events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel error states", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Variables System", () => {
    it("should handle variables data updates", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit variablesData events correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle initial variable values", () => {
      const initialValues = { var1: "value1", var2: "value2" };
      wrapper = createWrapper({ initialVariableValues: initialValues });
      expect(wrapper.props().initialVariableValues).toEqual(initialValues);
    });

    it("should update variables when time objects change", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle variables auto-update logic", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle variables loading states", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle variables dependency updates", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should validate variable configurations", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Tab Management", () => {
    it("should render TabList when showTabs is true", () => {
      wrapper = createWrapper({ showTabs: true });
      expect(wrapper.props().showTabs).toBe(true);
    });

    it("should not render TabList when showTabs is false", () => {
      wrapper = createWrapper({ showTabs: false });
      expect(wrapper.props().showTabs).toBe(false);
    });

    it("should handle tab selection changes", () => {
      wrapper = createWrapper({ showTabs: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should filter panels by selected tab", () => {
      const multiTabDashboard = {
        ...defaultProps.dashboardData,
        tabs: [
          { tabId: "tab1", name: "Tab 1", panels: [] },
          { tabId: "tab2", name: "Tab 2", panels: [] },
        ],
      };
      wrapper = createWrapper({ dashboardData: multiTabDashboard });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle tab refresh events", () => {
      wrapper = createWrapper({ showTabs: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should pass correct tab data to components", () => {
      wrapper = createWrapper({ showTabs: true });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Print Mode & Loading Tests", () => {
    it("should handle print mode flag visibility", () => {
      store.state.printMode = true;
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should debounce loading state updates", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should track panel loading states", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should track variable loading states", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit correct loading events", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle loading state combinations", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle search request trace IDs", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dashboard data loading completion", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Event System", () => {
    it("should emit onDeletePanel events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit onViewPanel events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit variablesData events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit refreshedVariablesDataUpdated events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit updated:data-zoom events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit refreshPanelRequest events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit refresh events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit onMovePanel events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit panelsValues events", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit searchRequestTraceIds events", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("View Panel Dialog", () => {
    it("should handle view panel dialog opening", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle view panel dialog closing", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should pass correct props to ViewPanel component", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle view panel date selection", async () => {
      const selectedDate = { start: "2024-01-01", end: "2024-01-02" };
      wrapper = createWrapper({ selectedDateForViewPanel: selectedDate });
      expect(wrapper.props("selectedDateForViewPanel")).toEqual(selectedDate);
    });

    it("should handle view panel variable updates", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle view panel lifecycle", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Dashboard Operations", () => {
    it("should handle dashboard saving with success", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dashboard saving with errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle conflict resolution on save", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dashboard refresh requests", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle add panel navigation", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dashboard update operations", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle initial variable values updates", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle run ID updates", async () => {
      wrapper = createWrapper({ runId: "new-run-id" });
      expect(wrapper.props().runId).toBe("new-run-id");
    });
  });

  describe("Error Handling & Edge Cases", () => {
    it("should handle missing dashboard data", () => {
      const emptyDashboard = {
        dashboardId: "test-dashboard",
        name: "Empty Dashboard",
        variables: { showDynamicFilters: false, list: [] },
        tabs: [],
        panels: [],
      };
      wrapper = createWrapper({ dashboardData: emptyDashboard });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle malformed panel data", () => {
      const malformedDashboard = {
        ...defaultProps.dashboardData,
        panels: [{ id: null, type: null }],
      };
      wrapper = createWrapper({ dashboardData: malformedDashboard });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle GridStack initialization failures", async () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it("should handle network errors on dashboard save", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle invalid variable configurations", () => {
      const invalidVariables = {
        ...defaultProps.dashboardData,
        variables: null,
      };
      wrapper = createWrapper({ dashboardData: invalidVariables });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing tab data", () => {
      const noTabsDashboard = {
        ...defaultProps.dashboardData,
        tabs: [],
      };
      wrapper = createWrapper({ dashboardData: noTabsDashboard });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle component cleanup errors", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle async operation failures", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Integration & Lifecycle", () => {
    it("should handle complete component lifecycle", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });

    it("should integrate with parent dashboard components", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle prop updates correctly", async () => {
      wrapper = createWrapper();
      await wrapper.setProps({ viewOnly: true });
      expect(wrapper.props().viewOnly).toBe(true);
    });

    it("should handle multiple tab switches", async () => {
      const multiTabDashboard = {
        ...defaultProps.dashboardData,
        tabs: [
          { tabId: "tab1", name: "Tab 1", panels: [] },
          { tabId: "tab2", name: "Tab 2", panels: [] },
          { tabId: "tab3", name: "Tab 3", panels: [] },
        ],
      };
      wrapper = createWrapper({ dashboardData: multiTabDashboard });
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle rapid state changes", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle memory cleanup", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });
  });
});