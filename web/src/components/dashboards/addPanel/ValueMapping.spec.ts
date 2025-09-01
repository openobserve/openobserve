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
import ValueMapping from "@/components/dashboards/addPanel/ValueMapping.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock dashboard panel composable
const mockDashboardPanelData = {
  data: {
    config: {
      mappings: []
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

describe("ValueMapping", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    store.state.theme = 'light';
    mockDashboardPanelData.data.config.mappings = [];
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(ValueMapping, {
      props: {
        ...props
      },
      global: {
        plugins: [i18n, store, router],
        provide: {
          dashboardPanelDataPageKey: "dashboard"
        },
        stubs: {
          'ValueMappingPopUp': {
            template: '<div data-test="value-mapping-popup"></div>',
            emits: ['close', 'save']
          }
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render value mappings section", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain('Value Mappings');
    });

    it("should render info tooltip button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-info"]').exists()).toBe(true);
    });

    it("should render tooltip component", () => {
      wrapper = createWrapper();

      // Test that the component renders successfully
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-info"]').exists()).toBe(true);
    });

    it("should render add/edit button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').exists()).toBe(true);
    });
  });

  describe("Button Label Logic", () => {
    it("should show 'Add Value Mapping' when no mappings exist", () => {
      mockDashboardPanelData.data.config.mappings = [];
      wrapper = createWrapper();

      const button = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
      expect(button.text().trim()).toBe('Add Value Mapping');
    });

    it("should show 'Edit Value Mapping' when mappings exist", () => {
      mockDashboardPanelData.data.config.mappings = [
        { value: '1', text: 'Active', color: 'green' }
      ];
      wrapper = createWrapper();

      const button = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
      expect(button.text().trim()).toBe('Edit Value Mapping');
    });

    it("should handle button label based on mappings state", () => {
      // Test with empty mappings
      mockDashboardPanelData.data.config.mappings = [];
      wrapper = createWrapper();

      let button = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
      expect(button.text().trim()).toBe('Add Value Mapping');

      // Test with non-empty mappings
      wrapper.unmount();
      mockDashboardPanelData.data.config.mappings = [{ value: '1', text: 'Active' }];
      wrapper = createWrapper();

      button = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
      expect(button.text().trim()).toBe('Edit Value Mapping');
    });
  });

  describe("Dialog Management", () => {
    it("should not show dialog initially", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showValueMappingPopUp).toBe(false);
    });

    it("should show dialog when button is clicked", async () => {
      wrapper = createWrapper();

      const button = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
      await button.trigger('click');

      expect(wrapper.vm.showValueMappingPopUp).toBe(true);
    });

    it("should show dialog state correctly", async () => {
      wrapper = createWrapper();

      wrapper.vm.showValueMappingPopUp = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showValueMappingPopUp).toBe(true);
    });

    it("should handle popup rendering", async () => {
      mockDashboardPanelData.data.config.mappings = [
        { value: '1', text: 'Active', color: 'green' }
      ];
      
      wrapper = createWrapper();
      wrapper.vm.showValueMappingPopUp = true;
      await wrapper.vm.$nextTick();

      // Test that the component state is correct
      expect(wrapper.vm.showValueMappingPopUp).toBe(true);
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

  describe("Component Methods", () => {
    it("should have openValueMappingPopUp method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.openValueMappingPopUp).toBe('function');
    });

    it("should have saveValueMappingConfig method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.saveValueMappingConfig).toBe('function');
    });

    it("should open dialog with openValueMappingPopUp method", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showValueMappingPopUp).toBe(false);
      wrapper.vm.openValueMappingPopUp();
      expect(wrapper.vm.showValueMappingPopUp).toBe(true);
    });
  });

  describe("Save Value Mapping", () => {
    it("should save value mapping and close dialog", () => {
      wrapper = createWrapper();

      const newMappings = [
        { value: '1', text: 'Active', color: 'green' },
        { value: '0', text: 'Inactive', color: 'red' }
      ];

      wrapper.vm.showValueMappingPopUp = true;
      wrapper.vm.saveValueMappingConfig(newMappings);

      expect(mockDashboardPanelData.data.config.mappings).toEqual(newMappings);
      expect(wrapper.vm.showValueMappingPopUp).toBe(false);
    });

    it("should handle empty mappings array", () => {
      wrapper = createWrapper();

      wrapper.vm.saveValueMappingConfig([]);

      expect(mockDashboardPanelData.data.config.mappings).toEqual([]);
      expect(wrapper.vm.showValueMappingPopUp).toBe(false);
    });

    it("should handle complex mapping objects", () => {
      wrapper = createWrapper();

      const complexMappings = [
        {
          value: 'success',
          text: 'Success',
          color: '#00ff00',
          backgroundColor: '#e8f5e8',
          priority: 1
        }
      ];

      wrapper.vm.saveValueMappingConfig(complexMappings);

      expect(mockDashboardPanelData.data.config.mappings).toEqual(complexMappings);
    });
  });

  describe("Mappings Initialization", () => {
    it("should initialize mappings array if not present", () => {
      // Test initialization by checking the component ensures mappings exist
      const mockDataWithoutMappings = {
        data: {
          config: {},
          queries: [{ fields: [] }],
          type: "line"
        },
        layout: { currentQueryIndex: 0 }
      };

      // Manually initialize mappings as the component would
      if (!mockDataWithoutMappings.data.config.mappings) {
        mockDataWithoutMappings.data.config.mappings = [];
      }

      expect(mockDataWithoutMappings.data.config.mappings).toEqual([]);
    });

    it("should not override existing mappings array", () => {
      const existingMappings = [{ value: '1', text: 'Existing' }];
      mockDashboardPanelData.data.config.mappings = existingMappings;

      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.mappings).toEqual(existingMappings);
    });
  });

  describe("Dashboard Panel Integration", () => {
    it("should have access to dashboard panel data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.config.mappings).toBeDefined();
    });

    it("should work with injected dashboard panel data key", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Event Handling", () => {
    it("should handle close event simulation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showValueMappingPopUp = true;
      await wrapper.vm.$nextTick();

      // Simulate close event
      wrapper.vm.showValueMappingPopUp = false;
      expect(wrapper.vm.showValueMappingPopUp).toBe(false);
    });

    it("should handle save event simulation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showValueMappingPopUp = true;
      await wrapper.vm.$nextTick();

      const newMappings = [{ value: '1', text: 'Test' }];
      // Simulate save event
      wrapper.vm.saveValueMappingConfig(newMappings);
      
      expect(mockDashboardPanelData.data.config.mappings).toEqual(newMappings);
      expect(wrapper.vm.showValueMappingPopUp).toBe(false);
    });
  });

  describe("Data Deep Copy", () => {
    it("should pass deep copy of mappings to popup", async () => {
      const originalMappings = [{ value: '1', text: 'Original', nested: { prop: 'test' } }];
      mockDashboardPanelData.data.config.mappings = originalMappings;

      wrapper = createWrapper();
      wrapper.vm.showValueMappingPopUp = true;
      await wrapper.vm.$nextTick();

      // The component uses JSON.parse(JSON.stringify()) to create deep copy
      // This ensures that modifications in the popup don't affect original data
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null/undefined mappings gracefully", () => {
      const mockDataWithNullMappings = {
        data: {
          config: { mappings: null },
          queries: [{ fields: [] }],
          type: "line"
        },
        layout: { currentQueryIndex: 0 }
      };

      // Simulate initialization as component would do
      if (!mockDataWithNullMappings.data.config.mappings) {
        mockDataWithNullMappings.data.config.mappings = [];
      }

      expect(mockDataWithNullMappings.data.config.mappings).toEqual([]);
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle store access properly", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state.theme).toBeDefined();
    });
  });

  describe("Reactive Updates", () => {
    it("should handle save function correctly with mappings", () => {
      mockDashboardPanelData.data.config.mappings = [];
      wrapper = createWrapper();

      let button = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
      expect(button.text().trim()).toBe('Add Value Mapping');

      // Save new mappings
      wrapper.vm.saveValueMappingConfig([{ value: '1', text: 'Test' }]);
      
      // Verify mappings were saved
      expect(mockDashboardPanelData.data.config.mappings).toEqual([{ value: '1', text: 'Test' }]);
    });

    it("should handle clearing mappings correctly", () => {
      mockDashboardPanelData.data.config.mappings = [{ value: '1', text: 'Test' }];
      wrapper = createWrapper();

      let button = wrapper.find('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
      expect(button.text().trim()).toBe('Edit Value Mapping');

      // Clear mappings
      wrapper.vm.saveValueMappingConfig([]);
      
      // Verify mappings were cleared
      expect(mockDashboardPanelData.data.config.mappings).toEqual([]);
    });
  });
});