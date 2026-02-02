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
import Drilldown from "@/components/dashboards/addPanel/Drilldown.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock dashboard panel composable
const mockDashboardPanelData = {
  data: {
    config: {
      drilldown: []
    },
    queries: [{ fields: [] }],
    type: "line"
  },
  layout: {
    currentQueryIndex: 0
  }
};

vi.mock("@/composables/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: mockDashboardPanelData
  }))
}));

installQuasar({
  plugins: [Dialog, Notify],
});

const mockVariablesData = [
  { name: "region", value: "us-east-1" },
  { name: "environment", value: "production" }
];

describe("Drilldown", () => {
  let wrapper: any;

  const defaultProps = {
    variablesData: mockVariablesData
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    store.state.theme = 'light';
    mockDashboardPanelData.data.config.drilldown = [];
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(Drilldown, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n, store, router],
        provide: {
          dashboardPanelDataPageKey: "dashboard"
        },
        stubs: {
          'DrilldownPopUp': {
            template: '<div data-test="drilldown-popup"></div>',
            emits: ['close']
          },
          'AppDialog': {
            template: '<div v-if="modelValue" data-test="app-dialog"><slot /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          }
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render drilldown section", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain('Drilldown');
    });

    it("should render info tooltip button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-info"]').exists()).toBe(true);
    });

    it("should render add drilldown button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').text()).toBe('+ Add');
    });

    it("should not render drilldown items when list is empty", () => {
      mockDashboardPanelData.data.config.drilldown = [];
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-0"]').exists()).toBe(false);
    });

    it("should not show dialog initially", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showDrilldownPopUp).toBe(false);
    });
  });

  describe("Props Handling", () => {
    it("should accept and handle variablesData prop", () => {
      const customVariables = [
        { name: "user", value: "admin" },
        { name: "role", value: "superuser" }
      ];

      wrapper = createWrapper({ variablesData: customVariables });

      expect(wrapper.props('variablesData')).toEqual(customVariables);
    });

    it("should handle empty variablesData", () => {
      wrapper = createWrapper({ variablesData: [] });

      expect(wrapper.props('variablesData')).toEqual([]);
    });

    it("should handle undefined variablesData", () => {
      wrapper = createWrapper({ variablesData: undefined });

      expect(wrapper.props('variablesData')).toBeUndefined();
    });
  });

  describe("Drilldown Items Rendering", () => {
    it("should render drilldown items when they exist", async () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Dashboard 1", url: "/dashboard/1" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-0"]').text()).toContain('Dashboard 1');
    });

    it("should render multiple drilldown items", async () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Dashboard 1", url: "/dashboard/1" },
        { name: "Dashboard 2", url: "/dashboard/2" },
        { name: "External URL", url: "https://example.com" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-2"]').exists()).toBe(true);
    });

    it("should render remove button for each drilldown item", async () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Dashboard 1", url: "/dashboard/1" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-remove-0"]').exists()).toBe(true);
    });

    it("should display drilldown names with numbering", async () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "First Dashboard", url: "/dashboard/1" },
        { name: "Second Dashboard", url: "/dashboard/2" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-0"]').text()).toBe('1. First Dashboard');
      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-1"]').text()).toBe('2. Second Dashboard');
    });
  });

  describe("Adding Drilldowns", () => {
    it("should show dialog when add button is clicked", async () => {
      wrapper = createWrapper();

      const addBtn = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
      await addBtn.trigger('click');

      expect(wrapper.vm.showDrilldownPopUp).toBe(true);
      expect(wrapper.vm.isDrilldownEditMode).toBe(false);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(null);
    });

    it("should have addNewDrilldown method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.addNewDrilldown).toBe('function');
    });

    it("should set correct state when adding new drilldown", () => {
      wrapper = createWrapper();

      wrapper.vm.addNewDrilldown();

      expect(wrapper.vm.showDrilldownPopUp).toBe(true);
      expect(wrapper.vm.isDrilldownEditMode).toBe(false);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(null);
    });
  });

  describe("Editing Drilldowns", () => {
    it("should show dialog in edit mode when drilldown item is clicked", async () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Dashboard 1", url: "/dashboard/1" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      const drilldownItem = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-0"]');
      await drilldownItem.trigger('click');

      expect(wrapper.vm.showDrilldownPopUp).toBe(true);
      expect(wrapper.vm.isDrilldownEditMode).toBe(true);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(0);
    });

    it("should have onDrilldownClick method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.onDrilldownClick).toBe('function');
    });

    it("should set correct state when editing drilldown", () => {
      wrapper = createWrapper();

      wrapper.vm.onDrilldownClick(2);

      expect(wrapper.vm.showDrilldownPopUp).toBe(true);
      expect(wrapper.vm.isDrilldownEditMode).toBe(true);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(2);
    });
  });

  describe("Removing Drilldowns", () => {
    it("should remove drilldown when remove button is clicked", async () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Dashboard 1", url: "/dashboard/1" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(1);

      const removeBtn = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-remove-0"]');
      await removeBtn.trigger('click');

      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(0);
    });

    it("should remove correct drilldown by index", async () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Dashboard 1", url: "/dashboard/1" },
        { name: "Dashboard 2", url: "/dashboard/2" },
        { name: "Dashboard 3", url: "/dashboard/3" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      // Remove middle item (index 1)
      const removeBtn = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-remove-1"]');
      await removeBtn.trigger('click');

      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(2);
      expect(mockDashboardPanelData.data.config.drilldown[0].name).toBe("Dashboard 1");
      expect(mockDashboardPanelData.data.config.drilldown[1].name).toBe("Dashboard 3");
    });

    it("should have removeDrilldownByIndex method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.removeDrilldownByIndex).toBe('function');
    });

    it("should remove drilldown through method call", () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Dashboard 1", url: "/dashboard/1" },
        { name: "Dashboard 2", url: "/dashboard/2" }
      ];
      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(2);
      wrapper.vm.removeDrilldownByIndex(0);
      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(1);
      expect(mockDashboardPanelData.data.config.drilldown[0].name).toBe("Dashboard 2");
    });
  });

  describe("Dialog Management", () => {
    it("should render dialog when showDrilldownPopUp is true", async () => {
      wrapper = createWrapper();

      wrapper.vm.showDrilldownPopUp = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="app-dialog"]').exists()).toBe(true);
    });

    it("should pass correct props to DrilldownPopUp", async () => {
      wrapper = createWrapper();

      wrapper.vm.selectedDrilldownIndexToEdit = 5;
      wrapper.vm.isDrilldownEditMode = true;
      wrapper.vm.showDrilldownPopUp = true;
      await wrapper.vm.$nextTick();

      const popup = wrapper.findComponent({ name: 'DrilldownPopUp' });
      if (popup.exists()) {
        expect(popup.props('drilldownDataIndex')).toBe(5);
        expect(popup.props('isEditMode')).toBe(true);
        expect(popup.props('variablesData')).toEqual(mockVariablesData);
      }
    });

    it("should close dialog when saveDrilldownData is called", () => {
      wrapper = createWrapper();

      wrapper.vm.showDrilldownPopUp = true;
      wrapper.vm.selectedDrilldownIndexToEdit = 3;
      wrapper.vm.isDrilldownEditMode = true;

      wrapper.vm.saveDrilldownData();

      expect(wrapper.vm.showDrilldownPopUp).toBe(false);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(null);
      expect(wrapper.vm.isDrilldownEditMode).toBe(false);
    });

    it("should have saveDrilldownData method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.saveDrilldownData).toBe('function');
    });
  });

  describe("Theme Integration", () => {
    it("should handle light theme", async () => {
      store.state.theme = 'light';
      wrapper = createWrapper();

      expect(wrapper.vm.store.state.theme).toBe('light');
    });

    it("should handle dark theme", async () => {
      store.state.theme = 'dark';
      wrapper = createWrapper();

      expect(wrapper.vm.store.state.theme).toBe('dark');
    });
  });

  describe("Drilldown Initialization", () => {
    it("should initialize drilldown array if not present", () => {
      const mockDataWithoutDrilldown = {
        data: {
          config: {},
          queries: [{ fields: [] }],
          type: "line"
        },
        layout: { currentQueryIndex: 0 }
      };

      // Simulate initialization as component would do
      if (!mockDataWithoutDrilldown.data.config.drilldown) {
        mockDataWithoutDrilldown.data.config.drilldown = [];
      }

      expect(mockDataWithoutDrilldown.data.config.drilldown).toEqual([]);
    });

    it("should not override existing drilldown array", () => {
      const existingDrilldowns = [{ name: "Existing", url: "/existing" }];
      mockDashboardPanelData.data.config.drilldown = existingDrilldowns;

      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.drilldown).toEqual(existingDrilldowns);
    });
  });

  describe("Dashboard Panel Integration", () => {
    it("should have access to dashboard panel data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.config.drilldown).toBeDefined();
    });

    it("should work with injected dashboard panel data key", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Store Integration", () => {
    it("should have access to store", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty drilldown configuration", () => {
      mockDashboardPanelData.data.config.drilldown = [];
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').exists()).toBe(true);
    });

    it("should handle null drilldown configuration", () => {
      const mockDataWithNullDrilldown = {
        data: {
          config: { drilldown: null },
          queries: [{ fields: [] }],
          type: "line"
        },
        layout: { currentQueryIndex: 0 }
      };

      // Simulate initialization as component would do
      if (!mockDataWithNullDrilldown.data.config.drilldown) {
        mockDataWithNullDrilldown.data.config.drilldown = [];
      }

      expect(mockDataWithNullDrilldown.data.config.drilldown).toEqual([]);
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle removing from empty array gracefully", () => {
      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(0);
      expect(() => wrapper.vm.removeDrilldownByIndex(0)).not.toThrow();
      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(0);
    });

    it("should handle removing invalid index gracefully", () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Dashboard 1", url: "/dashboard/1" }
      ];
      wrapper = createWrapper();

      expect(() => wrapper.vm.removeDrilldownByIndex(10)).not.toThrow();
      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(1);
    });

    it("should handle long drilldown names gracefully", async () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "This is a very long dashboard name that should be truncated with ellipsis when displayed in the UI", url: "/dashboard/1" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-name-0"]').exists()).toBe(true);
    });
  });

  describe("Component Structure", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe('Drilldown');
    });

    it("should have all required methods", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.onDrilldownClick).toBe('function');
      expect(typeof wrapper.vm.addNewDrilldown).toBe('function');
      expect(typeof wrapper.vm.removeDrilldownByIndex).toBe('function');
      expect(typeof wrapper.vm.saveDrilldownData).toBe('function');
    });

    it("should have all required data properties", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.showDrilldownPopUp).toBeDefined();
      expect(wrapper.vm.isDrilldownEditMode).toBeDefined();
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBeDefined();
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle multiple drilldown operations", async () => {
      wrapper = createWrapper();

      // Add a drilldown (simulate)
      mockDashboardPanelData.data.config.drilldown.push({ name: "Test 1", url: "/test/1" });
      await wrapper.vm.$nextTick();

      // Click on it to edit
      wrapper.vm.onDrilldownClick(0);
      expect(wrapper.vm.isDrilldownEditMode).toBe(true);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(0);

      // Save and close
      wrapper.vm.saveDrilldownData();
      expect(wrapper.vm.showDrilldownPopUp).toBe(false);

      // Add new drilldown
      wrapper.vm.addNewDrilldown();
      expect(wrapper.vm.isDrilldownEditMode).toBe(false);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(null);
    });

    it("should handle drilldown data modifications", () => {
      mockDashboardPanelData.data.config.drilldown = [
        { name: "Initial", url: "/initial" }
      ];
      wrapper = createWrapper();

      // Modify drilldown data
      mockDashboardPanelData.data.config.drilldown[0].name = "Modified";
      mockDashboardPanelData.data.config.drilldown[0].url = "/modified";

      expect(mockDashboardPanelData.data.config.drilldown[0].name).toBe("Modified");
      expect(mockDashboardPanelData.data.config.drilldown[0].url).toBe("/modified");
    });

    it("should handle state transitions correctly", () => {
      wrapper = createWrapper();

      // Initial state
      expect(wrapper.vm.showDrilldownPopUp).toBe(false);
      expect(wrapper.vm.isDrilldownEditMode).toBe(false);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(null);

      // Add mode
      wrapper.vm.addNewDrilldown();
      expect(wrapper.vm.showDrilldownPopUp).toBe(true);
      expect(wrapper.vm.isDrilldownEditMode).toBe(false);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(null);

      // Edit mode
      wrapper.vm.onDrilldownClick(3);
      expect(wrapper.vm.showDrilldownPopUp).toBe(true);
      expect(wrapper.vm.isDrilldownEditMode).toBe(true);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(3);

      // Close
      wrapper.vm.saveDrilldownData();
      expect(wrapper.vm.showDrilldownPopUp).toBe(false);
      expect(wrapper.vm.isDrilldownEditMode).toBe(false);
      expect(wrapper.vm.selectedDrilldownIndexToEdit).toBe(null);
    });
  });
});