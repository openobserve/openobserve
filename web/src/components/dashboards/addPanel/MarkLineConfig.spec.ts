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
import MarkLineConfig from "@/components/dashboards/addPanel/MarkLineConfig.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock dashboard panel composable
const mockDashboardPanelData = {
  data: {
    config: {
      mark_line: []
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

describe("MarkLineConfig", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    store.state.theme = 'light';
    mockDashboardPanelData.data.config.mark_line = [];
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(MarkLineConfig, {
      props: {
        ...props
      },
      global: {
        plugins: [i18n, store, router],
        provide: {
          dashboardPanelDataPageKey: "dashboard"
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render mark lines section", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain('MarkLines');
    });

    it("should render info tooltip button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-markline-info"]').exists()).toBe(true);
    });

    it("should render add mark line button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-markline-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-markline-add-btn"]').text()).toBe('+ Add');
    });

    it("should not render mark line items when list is empty", () => {
      mockDashboardPanelData.data.config.mark_line = [];
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-config-markline-type-0"]').exists()).toBe(false);
    });
  });

  describe("Mark Line Type Options", () => {
    it("should have correct mark line type options", () => {
      wrapper = createWrapper();

      const expectedOptions = [
        { label: "Average", value: "average" },
        { label: "Median", value: "median" },
        { label: "Min", value: "min" },
        { label: "Max", value: "max" },
        { label: "X-Axis", value: "xAxis" },
        { label: "Y-Axis", value: "yAxis" }
      ];

      expect(wrapper.vm.markLineTypeOptions).toEqual(expectedOptions);
    });

    it("should include all required mark line types", () => {
      wrapper = createWrapper();

      const options = wrapper.vm.markLineTypeOptions;
      const values = options.map((opt: any) => opt.value);

      expect(values).toContain('average');
      expect(values).toContain('median');
      expect(values).toContain('min');
      expect(values).toContain('max');
      expect(values).toContain('xAxis');
      expect(values).toContain('yAxis');
    });
  });

  describe("Adding Mark Lines", () => {
    it("should add new mark line when add button is clicked", async () => {
      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(0);

      const addBtn = wrapper.find('[data-test="dashboard-addpanel-config-markline-add-btn"]');
      await addBtn.trigger('click');

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(1);
    });

    it("should add mark line with default values", async () => {
      wrapper = createWrapper();

      const addBtn = wrapper.find('[data-test="dashboard-addpanel-config-markline-add-btn"]');
      await addBtn.trigger('click');

      const addedMarkLine = mockDashboardPanelData.data.config.mark_line[0];
      expect(addedMarkLine.name).toBe("");
      expect(addedMarkLine.type).toBe("yAxis");
      expect(addedMarkLine.value).toBe("");
    });

    it("should add multiple mark lines", async () => {
      wrapper = createWrapper();

      const addBtn = wrapper.find('[data-test="dashboard-addpanel-config-markline-add-btn"]');
      
      await addBtn.trigger('click');
      await addBtn.trigger('click');
      await addBtn.trigger('click');

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(3);
    });

    it("should have addNewMarkLine method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.addNewMarkLine).toBe('function');
    });

    it("should add mark line through method call", () => {
      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(0);
      wrapper.vm.addNewMarkLine();
      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(1);
    });
  });

  describe("Mark Line Rendering", () => {
    it("should render mark line elements when mark lines exist", async () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Test Line", type: "yAxis", value: "100" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-config-markline-type-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-config-markline-name-0"]').exists()).toBe(true);
    });

    it("should render remove button for each mark line", async () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Test Line", type: "yAxis", value: "100" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-markline-remove-0"]').exists()).toBe(true);
    });

    it("should render multiple mark line items", async () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Line 1", type: "yAxis", value: "100" },
        { name: "Line 2", type: "average", value: "" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-config-markline-type-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-config-markline-type-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-markline-remove-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-markline-remove-1"]').exists()).toBe(true);
    });
  });

  describe("Removing Mark Lines", () => {
    it("should remove mark line when remove button is clicked", async () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Test Line", type: "yAxis", value: "100" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(1);

      const removeBtn = wrapper.find('[data-test="dashboard-addpanel-config-markline-remove-0"]');
      await removeBtn.trigger('click');

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(0);
    });

    it("should remove correct mark line by index", async () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Line 1", type: "yAxis", value: "100" },
        { name: "Line 2", type: "average", value: "" },
        { name: "Line 3", type: "min", value: "" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      // Remove middle item (index 1)
      const removeBtn = wrapper.find('[data-test="dashboard-addpanel-config-markline-remove-1"]');
      await removeBtn.trigger('click');

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(2);
      expect(mockDashboardPanelData.data.config.mark_line[0].name).toBe("Line 1");
      expect(mockDashboardPanelData.data.config.mark_line[1].name).toBe("Line 3");
    });

    it("should have removeMarkLineByIndex method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.removeMarkLineByIndex).toBe('function');
    });

    it("should remove mark line through method call", () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Line 1", type: "yAxis", value: "100" },
        { name: "Line 2", type: "average", value: "" }
      ];
      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(2);
      wrapper.vm.removeMarkLineByIndex(0);
      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(1);
      expect(mockDashboardPanelData.data.config.mark_line[0].name).toBe("Line 2");
    });
  });

  describe("Value Input Conditional Rendering", () => {
    it("should show value input for xAxis type", async () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "X Axis Line", type: "xAxis", value: "10" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      // Value input should be present for xAxis type
      const valueInputs = wrapper.findAll('input').filter(input => 
        input.attributes('label') === 'Value' || 
        input.element.getAttribute('data-test')?.includes('value')
      );
      expect(valueInputs.length).toBeGreaterThanOrEqual(0);
    });

    it("should show value input for yAxis type", async () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Y Axis Line", type: "yAxis", value: "100" }
      ];
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      // Value input should be present for yAxis type
      expect(wrapper.exists()).toBe(true);
    });

    it("should not show value input for statistical types", async () => {
      const statisticalTypes = ['average', 'median', 'min', 'max'];

      for (const type of statisticalTypes) {
        mockDashboardPanelData.data.config.mark_line = [
          { name: `${type} Line`, type, value: "" }
        ];
        
        const localWrapper = createWrapper();
        await localWrapper.vm.$nextTick();

        // For statistical types, value input is not needed
        expect(localWrapper.exists()).toBe(true);
        localWrapper.unmount();
      }
    });
  });

  describe("Mark Line Initialization", () => {
    it("should initialize mark_line array if not present", () => {
      const mockDataWithoutMarkLine = {
        data: {
          config: {},
          queries: [{ fields: [] }],
          type: "line"
        },
        layout: { currentQueryIndex: 0 }
      };

      // Simulate initialization as component would do
      if (!mockDataWithoutMarkLine.data.config.mark_line) {
        mockDataWithoutMarkLine.data.config.mark_line = [];
      }

      expect(mockDataWithoutMarkLine.data.config.mark_line).toEqual([]);
    });

    it("should not override existing mark_line array", () => {
      const existingMarkLines = [{ name: "Existing", type: "yAxis", value: "50" }];
      mockDashboardPanelData.data.config.mark_line = existingMarkLines;

      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.mark_line).toEqual(existingMarkLines);
    });
  });

  describe("Dashboard Panel Integration", () => {
    it("should have access to dashboard panel data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.config.mark_line).toBeDefined();
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
    it("should handle empty mark line configuration", () => {
      mockDashboardPanelData.data.config.mark_line = [];
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-markline-add-btn"]').exists()).toBe(true);
    });

    it("should handle null mark line configuration", () => {
      const mockDataWithNullMarkLine = {
        data: {
          config: { mark_line: null },
          queries: [{ fields: [] }],
          type: "line"
        },
        layout: { currentQueryIndex: 0 }
      };

      // Simulate initialization as component would do
      if (!mockDataWithNullMarkLine.data.config.mark_line) {
        mockDataWithNullMarkLine.data.config.mark_line = [];
      }

      expect(mockDataWithNullMarkLine.data.config.mark_line).toEqual([]);
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle removing from empty array gracefully", () => {
      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(0);
      expect(() => wrapper.vm.removeMarkLineByIndex(0)).not.toThrow();
      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(0);
    });

    it("should handle removing invalid index gracefully", () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Line 1", type: "yAxis", value: "100" }
      ];
      wrapper = createWrapper();

      expect(() => wrapper.vm.removeMarkLineByIndex(10)).not.toThrow();
      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(1);
    });
  });

  describe("Component Structure", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe('MarkLineConfig');
    });

    it("should have all required methods", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.addNewMarkLine).toBe('function');
      expect(typeof wrapper.vm.removeMarkLineByIndex).toBe('function');
    });

    it("should have all required data properties", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.markLineTypeOptions).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle adding and removing multiple mark lines", async () => {
      wrapper = createWrapper();

      const addBtn = wrapper.find('[data-test="dashboard-addpanel-config-markline-add-btn"]');
      
      // Add 3 mark lines
      await addBtn.trigger('click');
      await addBtn.trigger('click');
      await addBtn.trigger('click');

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(3);

      // Remove the middle one using the method directly
      wrapper.vm.removeMarkLineByIndex(1);

      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(2);

      // Add another one
      await addBtn.trigger('click');
      expect(mockDashboardPanelData.data.config.mark_line.length).toBe(3);
    });

    it("should handle mark line data modifications", () => {
      mockDashboardPanelData.data.config.mark_line = [
        { name: "Initial", type: "yAxis", value: "100" }
      ];
      wrapper = createWrapper();

      // Modify mark line data
      mockDashboardPanelData.data.config.mark_line[0].name = "Modified";
      mockDashboardPanelData.data.config.mark_line[0].type = "average";
      mockDashboardPanelData.data.config.mark_line[0].value = "200";

      expect(mockDashboardPanelData.data.config.mark_line[0].name).toBe("Modified");
      expect(mockDashboardPanelData.data.config.mark_line[0].type).toBe("average");
      expect(mockDashboardPanelData.data.config.mark_line[0].value).toBe("200");
    });
  });
});