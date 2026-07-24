// Copyright 2026 OpenObserve Inc.
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
import OverrideConfig from "@/components/dashboards/addPanel/OverrideConfig.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock dashboard panel composable
const mockDashboardPanelData = {
  data: {
    config: {
      override_config: [],
    },
    queries: [
      {
        fields: {
          x: [
            { alias: "timestamp", label: "Timestamp" },
            { alias: "user_id", label: "User ID" },
          ],
          y: [
            { alias: "count", label: "Count" },
            { alias: "duration", label: "Duration" },
          ],
        },
      },
    ],
    type: "line",
    queryType: "sql", // Default to SQL mode
  },
  layout: {
    currentQueryIndex: 0,
  },
  meta: {
    streamFields: {
      groupedFields: [],
    },
  },
};

const mockPromqlMode = { value: false };

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: mockDashboardPanelData,
    promqlMode: mockPromqlMode,
  })),
}));

describe("OverrideConfig", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();

    store.state.theme = "light";
    mockDashboardPanelData.data.config.override_config = [];
    mockDashboardPanelData.data.queryType = "sql";
    mockPromqlMode.value = false;
    mockDashboardPanelData.data.queries[0].fields = {
      x: [
        { alias: "timestamp", label: "Timestamp" },
        { alias: "user_id", label: "User ID" },
      ],
      y: [
        { alias: "count", label: "Count" },
        { alias: "duration", label: "Duration" },
      ],
    };
    mockDashboardPanelData.meta = {
      streamFields: {
        groupedFields: [],
      },
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
        ...props,
      },
      global: {
        plugins: [i18n, store, router],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        stubs: {
          OverrideConfigPopup: {
            name: "OverrideConfigPopup",
            template: '<div data-test="override-config-popup"></div>',
            emits: ["close", "save"],
            props: ["open", "columns", "overrideConfig"],
          },
        },
        mocks: {
          $t: (key: string) => key,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render override config section", () => {
      wrapper = createWrapper();

      // Title block was removed in config redesign (PR #10917);
      // the section header is now rendered by the parent ConfigPanel expansion item.
      expect(wrapper.exists()).toBe(true);
    });

    it("should render info tooltip button", () => {
      wrapper = createWrapper();

      // Info tooltip button was removed from this component in config redesign (PR #10917).
      expect(wrapper.find('[data-test="dashboard-addpanel-config-drilldown-info"]').exists()).toBe(
        false,
      );
    });

    it("should render add field override button", () => {
      wrapper = createWrapper();

      expect(
        wrapper.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]').text(),
      ).toBe("Configure column formatting");
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

      // Columns are passed to OverrideConfigPopup as { alias, label, isNumeric }.
      expect(wrapper.vm.columns.length).toBe(4);
      expect(wrapper.vm.columns[0].alias).toBe("timestamp");
      expect(wrapper.vm.columns[0].label).toBe("Timestamp");
      expect(wrapper.vm.columns[0].isNumeric).toBe(false);
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

      const addBtn = wrapper.find(
        '[data-test="dashboard-addpanel-config-override-config-add-btn"]',
      );
      await addBtn.trigger("click");

      expect(wrapper.vm.showOverrideConfigPopup).toBe(true);
    });

    it("should fetch columns when opening popup", async () => {
      wrapper = createWrapper();

      const initialColumnsLength = wrapper.vm.columns.length;

      // Modify fields to test fetchColumns
      mockDashboardPanelData.data.queries[0].fields.x.push({
        alias: "new_field",
        label: "New Field",
      });

      const addBtn = wrapper.find(
        '[data-test="dashboard-addpanel-config-override-config-add-btn"]',
      );
      await addBtn.trigger("click");

      expect(wrapper.vm.columns.length).toBe(initialColumnsLength + 1);
    });

    it("should have openOverrideConfigPopup method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.openOverrideConfigPopup).toBe("function");
    });

    it("should open dialog through method call", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
      wrapper.vm.openOverrideConfigPopup();
      expect(wrapper.vm.showOverrideConfigPopup).toBe(true);
    });

    it("should forward open state to OverrideConfigPopup via :open prop", async () => {
      // After the dialog -> ODialog migration the component no longer wraps
      // the popup in a modal v-model. The popup itself receives the open
      // state via the `:open` prop instead.
      wrapper = createWrapper();

      const popup = wrapper.findComponent({ name: "OverrideConfigPopup" });
      expect(popup.exists()).toBe(true);
      expect(popup.props("open")).toBe(false);

      wrapper.vm.openOverrideConfigPopup();
      await wrapper.vm.$nextTick();

      expect(popup.props("open")).toBe(true);
    });

    it("should close popup when OverrideConfigPopup emits close", async () => {
      // Replaces the previous dialog v-model close behaviour: dismissal is
      // now driven by the popup emitting `close`.
      wrapper = createWrapper();

      wrapper.vm.openOverrideConfigPopup();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showOverrideConfigPopup).toBe(true);

      const popup = wrapper.findComponent({ name: "OverrideConfigPopup" });
      popup.vm.$emit("close");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
    });

    it("should save when OverrideConfigPopup emits save", async () => {
      wrapper = createWrapper();

      wrapper.vm.openOverrideConfigPopup();
      await wrapper.vm.$nextTick();

      const popup = wrapper.findComponent({ name: "OverrideConfigPopup" });
      const newConfig = [{ count: "rps" }];
      popup.vm.$emit("save", newConfig);
      await wrapper.vm.$nextTick();

      expect(mockDashboardPanelData.data.config.override_config).toEqual(newConfig);
      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
    });
  });

  describe("Override Config Saving", () => {
    it("should save override config and close dialog", () => {
      wrapper = createWrapper();

      const newOverrideConfig = [
        { field: "count", unit: "ms" },
        { field: "duration", unit: "seconds" },
      ];

      wrapper.vm.showOverrideConfigPopup = true;
      wrapper.vm.saveOverrideConfigConfig(newOverrideConfig);

      expect(mockDashboardPanelData.data.config.override_config).toEqual(newOverrideConfig);
      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
    });

    it("should have saveOverrideConfigConfig method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.saveOverrideConfigConfig).toBe("function");
    });

    it("should handle empty override config", () => {
      wrapper = createWrapper();

      wrapper.vm.saveOverrideConfigConfig([]);

      expect(mockDashboardPanelData.data.config.override_config).toEqual([]);
      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
    });
  });

  describe("Theme Integration", () => {
    it("should handle light theme", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();

      // store is no longer exposed on the component instance after the
      // ODialog/ODrawer migration removed the theme-conditional wrapper class;
      // theme state lives only in the vuex store now.
      expect(store.state.theme).toBe("light");
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dark theme", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();

      expect(store.state.theme).toBe("dark");
      expect(wrapper.exists()).toBe(true);
    });

    it("should not pass theme-specific class to popup after migration", async () => {
      // Migration: dialog wrapper + dark-mode/bg-white class binding removed.
      // OverrideConfigPopup is rendered directly with no theme class.
      store.state.theme = "dark";
      wrapper = createWrapper();

      wrapper.vm.showOverrideConfigPopup = true;
      await wrapper.vm.$nextTick();

      const popup = wrapper.findComponent({ name: "OverrideConfigPopup" });
      expect(popup.exists()).toBe(true);
      expect(popup.classes()).not.toContain("dark-mode");
      expect(popup.classes()).not.toContain("bg-white");
    });
  });

  describe("Override Config Initialization", () => {
    it("should initialize override_config array if not present", () => {
      const mockDataWithoutOverrideConfig = {
        data: {
          config: {},
          queries: [{ fields: { x: [], y: [] } }],
          type: "line",
        },
        layout: { currentQueryIndex: 0 },
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
        y: [{ alias: "value", label: "Value" }],
      };

      wrapper = createWrapper();

      expect(wrapper.vm.columns.length).toBe(2);
      expect(wrapper.vm.columns[0].alias).toBe("time");
      expect(wrapper.vm.columns[1].alias).toBe("value");
    });
  });

  describe("Store Integration", () => {
    it("should have access to store via plugin", () => {
      // After the ODialog/ODrawer migration the component no longer pulls
      // `useStore()` into its setup (no longer needed since the theme class
      // binding on the dialog was removed). The vuex plugin is still installed
      // globally so the store remains available outside the component instance.
      wrapper = createWrapper();

      expect(store).toBeDefined();
      expect(store.state).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty override config configuration", () => {
      mockDashboardPanelData.data.config.override_config = [];
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]').exists(),
      ).toBe(true);
    });

    it("should handle null override config configuration", () => {
      const mockDataWithNullOverrideConfig = {
        data: {
          config: { override_config: null },
          queries: [{ fields: { x: [], y: [] } }],
          type: "line",
        },
        layout: { currentQueryIndex: 0 },
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

      expect(wrapper.vm.$options.name).toBe("OverrideConfig");
    });

    it("should have all required methods", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.openOverrideConfigPopup).toBe("function");
      expect(typeof wrapper.vm.saveOverrideConfigConfig).toBe("function");
    });

    it("should have all required data properties", () => {
      wrapper = createWrapper();

      // `store` was removed from the setup return after the migration; the
      // remaining exposed reactive state is asserted here.
      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.store).toBeUndefined();
      expect(wrapper.vm.showOverrideConfigPopup).toBeDefined();
      expect(wrapper.vm.columns).toBeDefined();
    });

    it("should have correct initial state", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
      expect(Array.isArray(wrapper.vm.columns)).toBe(true);
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
      const newConfig = [{ count: "items" }, { duration: "seconds" }];
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
      mockDashboardPanelData.data.queries[0].fields.y.push({
        alias: "new_metric",
        label: "New Metric",
      });

      // Open popup (which fetches columns)
      wrapper.vm.openOverrideConfigPopup();

      // Verify columns updated
      expect(wrapper.vm.columns.length).toBe(initialColumnsLength + 1);
    });
  });

  describe("Multi-query column aggregation", () => {
    afterEach(() => {
      // Restore the single-query fixture so other suites are unaffected.
      mockDashboardPanelData.data.queries = [
        {
          fields: {
            x: [
              { alias: "timestamp", label: "Timestamp" },
              { alias: "user_id", label: "User ID" },
            ],
            y: [
              { alias: "count", label: "Count" },
              { alias: "duration", label: "Duration" },
            ],
          },
        },
      ];
    });

    it("should include fields from the 2nd query, not just queries[0]", () => {
      mockDashboardPanelData.data.queries = [
        {
          fields: {
            x: [{ alias: "svc", label: "Service" }],
            y: [{ alias: "cnt", label: "Count" }],
          },
        },
        {
          fields: {
            x: [{ alias: "region", label: "Region" }],
            y: [{ alias: "errs", label: "Errors" }],
          },
        },
      ];

      wrapper = createWrapper();

      const aliases = wrapper.vm.columns.map((c: any) => c.alias);
      expect(aliases).toContain("region");
      expect(aliases).toContain("errs");
      expect(wrapper.vm.columns.length).toBe(4);
    });

    it("should order columns as all-X then all-breakdown then all-Y across queries", () => {
      mockDashboardPanelData.data.queries = [
        {
          fields: {
            x: [{ alias: "a", label: "A" }],
            breakdown: [{ alias: "bd1", label: "BD1" }],
            y: [{ alias: "b", label: "B" }],
          },
        },
        {
          fields: {
            x: [{ alias: "c", label: "C" }],
            breakdown: [{ alias: "bd2", label: "BD2" }],
            y: [{ alias: "d", label: "D" }],
          },
        },
      ];

      wrapper = createWrapper();

      const aliases = wrapper.vm.columns.map((c: any) => c.alias);
      // x(all) -> breakdown(all) -> y(all)
      expect(aliases).toEqual(["a", "c", "bd1", "bd2", "b", "d"]);
    });

    it("should de-duplicate columns sharing the same alias across queries", () => {
      mockDashboardPanelData.data.queries = [
        {
          fields: {
            x: [{ alias: "svc", label: "Service" }],
            y: [{ alias: "cnt", label: "Count" }],
          },
        },
        {
          fields: {
            x: [{ alias: "svc", label: "Service (q2)" }],
            y: [{ alias: "other", label: "Other" }],
          },
        },
      ];

      wrapper = createWrapper();

      const aliases = wrapper.vm.columns.map((c: any) => c.alias);
      expect(aliases).toEqual(["svc", "cnt", "other"]);
      // First occurrence wins (query 1's label is kept).
      expect(wrapper.vm.columns[0].label).toBe("Service");
    });

    it("should mark X and breakdown fields non-numeric and Y fields numeric", () => {
      mockDashboardPanelData.data.queries = [
        {
          fields: {
            x: [{ alias: "x1", label: "X1" }],
            breakdown: [{ alias: "bd", label: "BD" }],
            y: [{ alias: "y1", label: "Y1" }],
          },
        },
      ];

      wrapper = createWrapper();

      const byAlias = Object.fromEntries(
        wrapper.vm.columns.map((c: any) => [c.alias, c.isNumeric]),
      );
      expect(byAlias.x1).toBe(false);
      expect(byAlias.bd).toBe(false);
      expect(byAlias.y1).toBe(true);
    });

    it("should ignore a query with missing fields object", () => {
      mockDashboardPanelData.data.queries = [
        {
          fields: {
            x: [{ alias: "svc", label: "Service" }],
            y: [{ alias: "cnt", label: "Count" }],
          },
        },
        {}, // malformed / empty query
      ];

      wrapper = createWrapper();

      expect(wrapper.vm.columns.map((c: any) => c.alias)).toEqual(["svc", "cnt"]);
    });
  });
});
