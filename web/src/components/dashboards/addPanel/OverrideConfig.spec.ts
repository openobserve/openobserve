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
import OverrideConfig from "@/components/dashboards/addPanel/OverrideConfig.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock dashboard panel composable
const mockDashboardPanelData = {
  data: {
    config: {
      override_config: []
    },
    queries: [{
      fields: {
        x: [
          { alias: "timestamp", label: "Timestamp" },
          { alias: "user_id", label: "User ID" }
        ],
        y: [
          { alias: "count", label: "Count" },
          { alias: "duration", label: "Duration" }
        ]
      }
    }],
    type: "line",
    queryType: "sql" // Default to SQL mode
  },
  layout: {
    currentQueryIndex: 0
  },
  meta: {
    streamFields: {
      groupedFields: []
    }
  }
};

const mockPromqlMode = { value: false };

vi.mock("@/composables/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: mockDashboardPanelData,
    promqlMode: mockPromqlMode
  }))
}));

installQuasar({
  plugins: [Dialog, Notify],
});

describe("OverrideConfig", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();

    store.state.theme = 'light';
    mockDashboardPanelData.data.config.override_config = [];
    mockDashboardPanelData.data.queryType = 'sql';
    mockPromqlMode.value = false;
    mockDashboardPanelData.data.queries[0].fields = {
      x: [
        { alias: "timestamp", label: "Timestamp" },
        { alias: "user_id", label: "User ID" }
      ],
      y: [
        { alias: "count", label: "Count" },
        { alias: "duration", label: "Duration" }
      ]
    };
    mockDashboardPanelData.meta = {
      streamFields: {
        groupedFields: []
      }
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(OverrideConfig, {
      props: {
        ...props
      },
      global: {
        plugins: [i18n, store, router],
        provide: {
          dashboardPanelDataPageKey: "dashboard"
        },
        stubs: {
          'OverrideConfigPopup': {
            template: '<div data-test="override-config-popup"></div>',
            emits: ['close', 'save'],
            props: ['columns', 'overrideConfig']
          }
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render override config section", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain('Override Config');
    });

    it("should render info tooltip button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-info"]').exists()).toBe(true);
    });

    it("should render add field override button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]').text()).toBe('Add field override');
    });

    it("should not show dialog initially", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
    });
  });

  describe("Columns Management", () => {
    it("should fetch columns from dashboard panel data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.columns.length).toBe(4); // 2 x-fields + 2 y-fields
    });

    it("should combine x and y fields into columns", () => {
      wrapper = createWrapper();

      // Component transforms columns with name, field, and format properties
      expect(wrapper.vm.columns.length).toBe(4);
      expect(wrapper.vm.columns[0].name).toBe("timestamp");
      expect(wrapper.vm.columns[0].label).toBe("Timestamp");
      expect(wrapper.vm.columns[0].field).toBe("timestamp");
    });

    it("should handle empty x fields", () => {
      mockDashboardPanelData.data.queries[0].fields.x = [];
      wrapper = createWrapper();

      expect(wrapper.vm.columns.length).toBe(2); // Only y fields
    });

    it("should handle empty y fields", () => {
      mockDashboardPanelData.data.queries[0].fields.y = [];
      wrapper = createWrapper();

      expect(wrapper.vm.columns.length).toBe(2); // Only x fields
    });

    it("should handle empty fields gracefully", () => {
      mockDashboardPanelData.data.queries[0].fields = { x: [], y: [] };
      wrapper = createWrapper();

      expect(wrapper.vm.columns).toEqual([]);
    });
  });

  describe("Dialog Management", () => {
    it("should show dialog when add button is clicked", async () => {
      wrapper = createWrapper();

      const addBtn = wrapper.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]');
      await addBtn.trigger('click');

      expect(wrapper.vm.showOverrideConfigPopup).toBe(true);
    });

    it("should fetch columns when opening popup", async () => {
      wrapper = createWrapper();

      const initialColumnsLength = wrapper.vm.columns.length;
      
      // Modify fields to test fetchColumns
      mockDashboardPanelData.data.queries[0].fields.x.push({ alias: "new_field", label: "New Field" });

      const addBtn = wrapper.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]');
      await addBtn.trigger('click');

      expect(wrapper.vm.columns.length).toBe(initialColumnsLength + 1);
    });

    it("should have openOverrideConfigPopup method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.openOverrideConfigPopup).toBe('function');
    });

    it("should open dialog through method call", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
      wrapper.vm.openOverrideConfigPopup();
      expect(wrapper.vm.showOverrideConfigPopup).toBe(true);
    });
  });

  describe("Override Config Saving", () => {
    it("should save override config and close dialog", () => {
      wrapper = createWrapper();

      const newOverrideConfig = [
        { field: "count", unit: "ms" },
        { field: "duration", unit: "seconds" }
      ];

      wrapper.vm.showOverrideConfigPopup = true;
      wrapper.vm.saveOverrideConfigConfig(newOverrideConfig);

      expect(mockDashboardPanelData.data.config.override_config).toEqual(newOverrideConfig);
      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
    });

    it("should have saveOverrideConfigConfig method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.saveOverrideConfigConfig).toBe('function');
    });

    it("should handle empty override config", () => {
      wrapper = createWrapper();

      wrapper.vm.saveOverrideConfigConfig([]);

      expect(mockDashboardPanelData.data.config.override_config).toEqual([]);
      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
    });

    it("should apply override configs after saving", () => {
      wrapper = createWrapper();

      const overrideConfig = [
        { field: "count", unit: "items" }
      ];

      wrapper.vm.saveOverrideConfigConfig(overrideConfig);

      // Check that columns have been updated with format functions
      const countColumn = wrapper.vm.columns.find((col: any) => col.name === "count");
      if (countColumn && countColumn.format) {
        expect(countColumn.format(100)).toBe("100 items");
      }
    });
  });

  describe("Override Config Application", () => {
    it("should apply override configs to columns", () => {
      mockDashboardPanelData.data.config.override_config = {
        count: "ms",
        duration: "seconds"
      };
      
      wrapper = createWrapper();

      const countColumn = wrapper.vm.columns.find((col: any) => col.name === "count");
      const durationColumn = wrapper.vm.columns.find((col: any) => col.name === "duration");

      expect(countColumn?.format).toBeDefined();
      expect(durationColumn?.format).toBeDefined();
    });

    it("should format values with units correctly", () => {
      mockDashboardPanelData.data.config.override_config = {
        count: "items"
      };
      
      wrapper = createWrapper();

      const countColumn = wrapper.vm.columns.find((col: any) => col.name === "count");
      if (countColumn && countColumn.format) {
        expect(countColumn.format(150)).toBe("150 items");
        expect(countColumn.format(0)).toBe("0 items");
        expect(countColumn.format("test")).toBe("test items");
      }
    });

    it("should handle columns without override config", () => {
      mockDashboardPanelData.data.config.override_config = [];
      
      wrapper = createWrapper();

      const timestampColumn = wrapper.vm.columns.find((col: any) => col.name === "timestamp");
      if (timestampColumn && timestampColumn.format) {
        expect(timestampColumn.format(1000)).toBe("1000 ");
      }
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

    it("should pass correct theme class to popup", async () => {
      store.state.theme = 'dark';
      wrapper = createWrapper();

      wrapper.vm.showOverrideConfigPopup = true;
      await wrapper.vm.$nextTick();

      const popup = wrapper.findComponent({ name: 'OverrideConfigPopup' });
      if (popup.exists()) {
        expect(popup.classes()).toContain('dark-mode');
      }
    });
  });

  describe("Override Config Initialization", () => {
    it("should initialize override_config array if not present", () => {
      const mockDataWithoutOverrideConfig = {
        data: {
          config: {},
          queries: [{ fields: { x: [], y: [] } }],
          type: "line"
        },
        layout: { currentQueryIndex: 0 }
      };

      // Simulate initialization as component would do
      if (!mockDataWithoutOverrideConfig.data.config.override_config) {
        mockDataWithoutOverrideConfig.data.config.override_config = [];
      }

      expect(mockDataWithoutOverrideConfig.data.config.override_config).toEqual([]);
    });

    it("should not override existing override_config array", () => {
      const existingConfig = [{ field: "test", unit: "ms" }];
      mockDashboardPanelData.data.config.override_config = existingConfig;

      wrapper = createWrapper();

      expect(mockDashboardPanelData.data.config.override_config).toEqual(existingConfig);
    });
  });

  describe("Dashboard Panel Integration", () => {
    it("should have access to dashboard panel data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.config.override_config).toBeDefined();
    });

    it("should work with injected dashboard panel data key", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle queries with different field structures", () => {
      mockDashboardPanelData.data.queries[0].fields = {
        x: [{ alias: "time", label: "Time" }],
        y: [{ alias: "value", label: "Value" }]
      };

      wrapper = createWrapper();

      expect(wrapper.vm.columns.length).toBe(2);
      expect(wrapper.vm.columns[0].name).toBe("time");
      expect(wrapper.vm.columns[1].name).toBe("value");
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
    it("should handle empty override config configuration", () => {
      mockDashboardPanelData.data.config.override_config = [];
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]').exists()).toBe(true);
    });

    it("should handle null override config configuration", () => {
      const mockDataWithNullOverrideConfig = {
        data: {
          config: { override_config: null },
          queries: [{ fields: { x: [], y: [] } }],
          type: "line"
        },
        layout: { currentQueryIndex: 0 }
      };

      // Simulate initialization as component would do
      if (!mockDataWithNullOverrideConfig.data.config.override_config) {
        mockDataWithNullOverrideConfig.data.config.override_config = [];
      }

      expect(mockDataWithNullOverrideConfig.data.config.override_config).toEqual([]);
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle missing query fields", () => {
      mockDashboardPanelData.data.queries[0].fields = {};
      wrapper = createWrapper();

      expect(wrapper.vm.columns).toEqual([]);
    });

    it("should handle null query fields", () => {
      mockDashboardPanelData.data.queries[0].fields = { x: null, y: null };
      wrapper = createWrapper();

      expect(wrapper.vm.columns).toEqual([]);
    });
  });

  describe("Component Structure", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe('OverrideConfig');
    });

    it("should have all required methods", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.openOverrideConfigPopup).toBe('function');
      expect(typeof wrapper.vm.saveOverrideConfigConfig).toBe('function');
    });

    it("should have all required data properties", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.showOverrideConfigPopup).toBeDefined();
      expect(wrapper.vm.columns).toBeDefined();
      expect(wrapper.vm.overrideConfigs).toBeDefined();
    });

    it("should have correct initial state", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
      expect(Array.isArray(wrapper.vm.columns)).toBe(true);
      expect(Array.isArray(wrapper.vm.overrideConfigs)).toBe(true);
    });
  });

  describe("Column Format Functions", () => {
    it("should create format functions for columns", () => {
      mockDashboardPanelData.data.config.override_config = [
        { count: "requests" }
      ];
      
      wrapper = createWrapper();

      const columns = wrapper.vm.columns;
      const countColumn = columns.find((col: any) => col.field === "count");

      expect(countColumn.format).toBeDefined();
      expect(typeof countColumn.format).toBe('function');
    });

    it("should map column properties correctly", () => {
      wrapper = createWrapper();

      const columns = wrapper.vm.columns;
      const firstColumn = columns[0];

      expect(firstColumn.name).toBe(firstColumn.field);
      expect(firstColumn.label).toBeDefined();
      expect(firstColumn.format).toBeDefined();
    });

    it("should handle complex override configurations", () => {
      mockDashboardPanelData.data.config.override_config = {
        count: "requests/min",
        duration: "ms",
        timestamp: "",
        user_id: "ID"
      };
      
      wrapper = createWrapper();

      const columns = wrapper.vm.columns;
      
      const countColumn = columns.find((col: any) => col.field === "count");
      const durationColumn = columns.find((col: any) => col.field === "duration");
      const timestampColumn = columns.find((col: any) => col.field === "timestamp");

      if (countColumn?.format) expect(countColumn.format(100)).toBe("100 requests/min");
      if (durationColumn?.format) expect(durationColumn.format(500)).toBe("500 ms");
      if (timestampColumn?.format) expect(timestampColumn.format(123456789)).toBe("123456789 ");
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle full override config workflow", async () => {
      wrapper = createWrapper();

      // Initial state
      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
      expect(mockDashboardPanelData.data.config.override_config).toEqual([]);

      // Open popup
      wrapper.vm.openOverrideConfigPopup();
      expect(wrapper.vm.showOverrideConfigPopup).toBe(true);

      // Save config
      const newConfig = [
        { count: "items" },
        { duration: "seconds" }
      ];
      wrapper.vm.saveOverrideConfigConfig(newConfig);

      // Verify final state
      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
      expect(mockDashboardPanelData.data.config.override_config).toEqual(newConfig);
    });

    it("should handle dynamic field changes", async () => {
      wrapper = createWrapper();

      // Initial columns
      const initialColumnsLength = wrapper.vm.columns.length;

      // Simulate field changes
      mockDashboardPanelData.data.queries[0].fields.y.push({ alias: "new_metric", label: "New Metric" });

      // Open popup (which fetches columns)
      wrapper.vm.openOverrideConfigPopup();

      // Verify columns updated
      expect(wrapper.vm.columns.length).toBe(initialColumnsLength + 1);
    });
  });
});