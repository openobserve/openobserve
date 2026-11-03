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
import { mount, flushPromises } from "@vue/test-utils";
import PromQLChartConfig from "./PromQLChartConfig.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mock useDashboardPanel
vi.mock("../../../composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: {
      data: {
        config: {},
        queries: [],
      },
      meta: {
        streamFields: {
          groupedFields: [],
        },
      },
    },
  })),
}));

describe("PromQLChartConfig", () => {
  let wrapper: any;
  let mockDashboardPanelData: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock data
    mockDashboardPanelData = {
      data: {
        config: {},
        queries: [],
      },
      meta: {
        streamFields: {
          groupedFields: [],
        },
      },
    };

    // Setup mock to return the mock data
    const useDashboardPanel = vi.mocked(
      await import("../../../composables/dashboard/useDashboardPanel"),
    ).default;
    useDashboardPanel.mockReturnValue({
      dashboardPanelData: mockDashboardPanelData,
    } as any);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(PromQLChartConfig, {
      props: {
        chartType: "table",
        ...props,
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key,
        },
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should show aggregation config for supported chart types", () => {
      const supportedTypes = [
        "pie",
        "donut",
        "geomap",
        "maps",
        "metric",
        "gauge",
        "bar-gauge",
        "h-bar",
      ];

      supportedTypes.forEach((type) => {
        wrapper = createWrapper({ chartType: type });
        expect(wrapper.find('[data-test="dashboard-config-aggregation"]').exists()).toBe(true);
        wrapper.unmount();
      });
    });

    it("should not show aggregation config for unsupported chart types", () => {
      wrapper = createWrapper({ chartType: "table" });
      expect(wrapper.find('[data-test="dashboard-config-aggregation"]').exists()).toBe(false);
    });

    it("hides the pie and donut aggregation only when every query is instant", () => {
      const instant = { config: { query_type: "instant" } };
      const range = { config: { query_type: "range" } };
      const cases: Array<[string, any[], boolean]> = [
        ["pie", [instant, instant], false],
        ["donut", [instant], false],
        ["pie", [instant, range], true],
        ["donut", [instant, {}], true],
        ["pie", [], true],
        ["metric", [instant], false],
      ];
      for (const [chartType, queries, shown] of cases) {
        mockDashboardPanelData.data.queries = queries;
        mockDashboardPanelData.layout = { hiddenQueries: [] };
        wrapper = createWrapper({ chartType });
        expect(wrapper.find('[data-test="dashboard-config-aggregation"]').exists()).toBe(shown);
        wrapper.unmount();
      }
      wrapper = null;
    });

    it("ignores hidden queries when deciding the pie aggregation is moot", () => {
      mockDashboardPanelData.data.queries = [
        { config: { query_type: "instant" } },
        { config: { query_type: "range", hide: true } },
      ];
      mockDashboardPanelData.layout = { hiddenQueries: [1] };
      wrapper = createWrapper({ chartType: "pie" });
      expect(wrapper.find('[data-test="dashboard-config-aggregation"]').exists()).toBe(false);
    });

    it("hides the metric aggregation only when every query is instant", async () => {
      const aggregation = () => wrapper.find('[data-test="dashboard-config-aggregation"]').exists();
      mockDashboardPanelData.data.queries = [
        { config: { query_type: "instant" } },
        { config: { query_type: "range" } },
      ];
      wrapper = createWrapper({ chartType: "metric" });
      expect(aggregation()).toBe(true);

      mockDashboardPanelData.data.queries[1].config.query_type = "instant";
      wrapper.unmount();
      wrapper = createWrapper({ chartType: "metric" });
      expect(aggregation()).toBe(false);

      wrapper.unmount();
      wrapper = createWrapper({ chartType: "gauge" });
      expect(aggregation()).toBe(true);
    });

    it("ignores a hidden range query when deciding the metric is all instant", () => {
      mockDashboardPanelData.data.queries = [
        { config: { query_type: "instant" } },
        { config: { query_type: "range" } },
      ];
      mockDashboardPanelData.layout = { hiddenQueries: [1] };
      wrapper = createWrapper({ chartType: "metric" });
      expect(wrapper.find('[data-test="dashboard-config-aggregation"]').exists()).toBe(false);
    });
  });

  describe("GeoMap Configuration", () => {
    it("should default geomap labels", () => {
      wrapper = createWrapper({ chartType: "geomap" });

      expect(wrapper.vm.geoLatLabel).toBe("latitude");
      expect(wrapper.vm.geoLonLabel).toBe("longitude");
      expect(wrapper.vm.geoWeightLabel).toBe("weight");
    });

    it("should update geomap labels", async () => {
      wrapper = createWrapper({ chartType: "geomap" });

      wrapper.vm.geoLatLabel = "lat";
      wrapper.vm.geoLonLabel = "lon";
      wrapper.vm.geoWeightLabel = "w";
      await flushPromises();

      expect(mockDashboardPanelData.data.config.lat_label).toBe("lat");
      expect(mockDashboardPanelData.data.config.lon_label).toBe("lon");
      expect(mockDashboardPanelData.data.config.weight_label).toBe("w");
    });
  });

  describe("Maps Configuration", () => {
    it("should default maps configuration", () => {
      wrapper = createWrapper({ chartType: "maps" });

      expect(wrapper.vm.mapsNameLabel).toBe("name");
      expect(wrapper.vm.mapsMapType).toBe("world");
    });

    it("should update maps configuration", async () => {
      wrapper = createWrapper({ chartType: "maps" });

      wrapper.vm.mapsNameLabel = "country";
      await flushPromises();

      expect(mockDashboardPanelData.data.config.name_label).toBe("country");
    });
  });

  describe("Table Configuration - PromQL Table Mode", () => {
    it("should default to 'single' mode", () => {
      wrapper = createWrapper({ chartType: "table" });
      expect(wrapper.vm.promqlTableMode).toBe("single");
    });

    it("should update table mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "all";
      await flushPromises();

      expect(mockDashboardPanelData.data.config.promql_table_mode).toBe("all");
    });
  });

  describe("Table Aggregations", () => {
    it("should show aggregations selector in all mode", async () => {
      // Set mode BEFORE creating wrapper
      mockDashboardPanelData.data.config.promql_table_mode = "all";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-config-table-aggregations"]').exists()).toBe(true);
    });

    it("should not show aggregations selector in single mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "single";
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-config-table-aggregations"]').exists()).toBe(
        false,
      );
    });

    it("should update table aggregations", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.tableAggregations = ["min", "max", "avg"];
      await flushPromises();

      expect(mockDashboardPanelData.data.config.table_aggregations).toEqual(["min", "max", "avg"]);
    });
  });

  describe("Column Filters", () => {
    it("should show column filters in all mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "all";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.text()).toContain("Column Filters");
      expect(wrapper.find('[data-test="dashboard-config-visible-columns"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-config-hidden-columns"]').exists()).toBe(true);
    });

    it("should not show column filters in single mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "single";
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-config-visible-columns"]').exists()).toBe(false);
    });

    it("should update visible columns", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.visibleColumns = ["job", "instance"];
      await flushPromises();

      expect(mockDashboardPanelData.data.config.visible_columns).toEqual(["job", "instance"]);
    });

    it("should update hidden columns", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.hiddenColumns = ["__name__"];
      await flushPromises();

      expect(mockDashboardPanelData.data.config.hidden_columns).toEqual(["__name__"]);
    });
  });

  describe("Sticky Columns", () => {
    it("should show sticky columns config in all mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "all";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.text()).toContain("Sticky Columns");
      expect(wrapper.find('[data-test="dashboard-config-sticky-first-column"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="dashboard-config-sticky-columns"]').exists()).toBe(true);
    });

    it("should not show sticky columns in single mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "single";
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-config-sticky-first-column"]').exists()).toBe(
        false,
      );
    });

    it("should update sticky first column", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.stickyFirstColumn = true;
      await flushPromises();

      expect(mockDashboardPanelData.data.config.sticky_first_column).toBe(true);
    });

    it("should clear sticky columns when sticky first column is enabled", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.stickyColumns = ["job", "instance"];
      wrapper.vm.stickyFirstColumn = true;
      await flushPromises();

      expect(mockDashboardPanelData.data.config.sticky_columns).toBeUndefined();
    });

    it("should update sticky columns", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.stickyColumns = ["job"];
      await flushPromises();

      expect(mockDashboardPanelData.data.config.sticky_columns).toEqual(["job"]);
    });
  });

  describe("Column Order", () => {
    it("should show column order config in all mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "all";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-config-column-order-button"]').exists()).toBe(
        true,
      );
    });

    it("should not show column order in single mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "single";
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-config-column-order-button"]').exists()).toBe(
        false,
      );
    });

    it("should open column order popup when button is clicked", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "all";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      const button = wrapper.find('[data-test="dashboard-config-column-order-button"]');
      await button.trigger("click");
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.vm.showColumnOrderPopup).toBe(true);
    });

    it("should save column order and close popup", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.openColumnOrderPopup();
      await flushPromises();

      wrapper.vm.saveColumnOrder(["column1", "column2"]);
      await flushPromises();

      expect(mockDashboardPanelData.data.config.column_order).toEqual(["column1", "column2"]);
      expect(wrapper.vm.showColumnOrderPopup).toBe(false);
    });
  });

  describe("Available Column Options", () => {
    it("should collect fields from all queries", async () => {
      // Modify mock BEFORE creating wrapper
      Object.assign(mockDashboardPanelData, {
        data: {
          config: {},
          queries: [{ fields: { stream: "stream1" } }, { fields: { stream: "stream2" } }],
        },
        meta: {
          streamFields: {
            groupedFields: [
              {
                name: "stream1",
                schema: [{ name: "field1" }, { name: "field2" }],
              },
              {
                name: "stream2",
                schema: [{ name: "field2" }, { name: "field3" }],
              },
            ],
          },
        },
      });

      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      const options = wrapper.vm.availableColumnOptions;
      expect(options).toContain("field1");
      expect(options).toContain("field2");
      expect(options).toContain("field3");
      // Should have unique fields
      expect(options.filter((f: string) => f === "field2").length).toBe(1);
    });

    it("should return sorted field names", async () => {
      // Update mockDashboardPanelData before creating wrapper
      Object.assign(mockDashboardPanelData, {
        data: {
          config: {},
          queries: [{ fields: { stream: "stream1" } }],
        },
        meta: {
          streamFields: {
            groupedFields: [
              {
                name: "stream1",
                schema: [{ name: "zebra" }, { name: "apple" }, { name: "banana" }],
              },
            ],
          },
        },
      });

      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.vm.availableColumnOptions).toEqual(["apple", "banana", "zebra"]);
    });
  });

  describe("Create Column Value", () => {
    it("should create new column value when valid", () => {
      // addToVisibleColumns adds a new value to the visibleColumns list
      mockDashboardPanelData.data.config.visible_columns = [];
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.addToVisibleColumns("new_column");

      expect(mockDashboardPanelData.data.config.visible_columns).toContain("new_column");
    });

    it("should not create column value when empty", () => {
      // addToVisibleColumns deduplicates — calling it twice with the same value
      // should only result in one entry in the list
      mockDashboardPanelData.data.config.visible_columns = [];
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.addToVisibleColumns("existing");
      wrapper.vm.addToVisibleColumns("existing");

      expect(
        mockDashboardPanelData.data.config.visible_columns.filter((v: string) => v === "existing")
          .length,
      ).toBe(1);
    });
  });

  describe("Filtered Available Columns", () => {
    it("should return filtered columns based on visible_columns", () => {
      mockDashboardPanelData.data.queries = [{ fields: { stream: "stream1" } }];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [{ name: "field1" }, { name: "field2" }, { name: "field3" }],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      wrapper.vm.visibleColumns = ["field1", "field2"];

      expect(wrapper.vm.filteredAvailableColumns).toEqual(["field1", "field2"]);
    });

    it("should return filtered columns based on hidden_columns", () => {
      mockDashboardPanelData.data.queries = [{ fields: { stream: "stream1" } }];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [{ name: "field1" }, { name: "field2" }, { name: "field3" }],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      wrapper.vm.hiddenColumns = ["field3"];

      const filtered = wrapper.vm.filteredAvailableColumns;
      expect(filtered).toContain("field1");
      expect(filtered).toContain("field2");
      expect(filtered).not.toContain("field3");
    });

    it("should prioritize visible_columns over hidden_columns", () => {
      mockDashboardPanelData.data.queries = [{ fields: { stream: "stream1" } }];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [{ name: "field1" }, { name: "field2" }, { name: "field3" }],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      wrapper.vm.visibleColumns = ["field1"];
      wrapper.vm.hiddenColumns = ["field2"];

      expect(wrapper.vm.filteredAvailableColumns).toEqual(["field1"]);
    });

    it("should return all columns when no filters", () => {
      mockDashboardPanelData.data.queries = [{ fields: { stream: "stream1" } }];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [{ name: "field1" }, { name: "field2" }],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });

      expect(wrapper.vm.filteredAvailableColumns).toEqual(["field1", "field2"]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined config", () => {
      mockDashboardPanelData.data.config = undefined;

      wrapper = createWrapper({ chartType: "table" });

      // Should not throw errors
      expect(wrapper.vm.promqlTableMode).toBe("single");
    });

    it("should initialize config when setting values", async () => {
      mockDashboardPanelData.data.config = undefined;

      wrapper = createWrapper({ chartType: "pie" });

      wrapper.vm.aggregationValue = "max";
      await flushPromises();

      expect(mockDashboardPanelData.data.config).toBeDefined();
      expect(mockDashboardPanelData.data.config.aggregation).toBe("max");
    });

    it("should clear values when set to empty array", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.visibleColumns = ["field1"];
      await flushPromises();
      expect(mockDashboardPanelData.data.config.visible_columns).toEqual(["field1"]);

      wrapper.vm.visibleColumns = [];
      await flushPromises();
      expect(mockDashboardPanelData.data.config.visible_columns).toBeUndefined();
    });
  });

  describe("ODialog Migration", () => {
    // After migration the dialog wrapper around ColumnOrderPopUp was removed.
    // ColumnOrderPopUp now owns its own ODialog and accepts `:open` from the
    // parent. These tests verify the new contract: prop wiring (open,
    // column-order, available-columns) and event handler wiring (@cancel,
    // @save). The child is rendered into a stub via findComponent so the
    // actual ODialog system does not need to mount in jsdom.

    const setupAllModeWrapper = async (overrides: any = {}) => {
      mockDashboardPanelData.data.config = {
        promql_table_mode: "all",
        column_order: ["field1", "field2"],
        ...overrides,
      };
      mockDashboardPanelData.data.queries = [{ fields: { stream: "stream1" } }];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [{ name: "field1" }, { name: "field2" }, { name: "field3" }],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();
      return wrapper;
    };

    it("should propagate showColumnOrderPopup=true to the :open prop after openColumnOrderPopup()", async () => {
      await setupAllModeWrapper();

      wrapper.vm.openColumnOrderPopup();
      await wrapper.vm.$nextTick();
      await flushPromises();

      const popup = wrapper.findComponent({ name: "ColumnOrderPopUp" });
      expect(popup.exists()).toBe(true);
      expect(wrapper.vm.showColumnOrderPopup).toBe(true);
      expect(popup.props("open")).toBe(true);
    });

    it("should respect visible_columns filter when forwarding available-columns", async () => {
      await setupAllModeWrapper({
        promql_table_mode: "all",
        visible_columns: ["field1"],
        column_order: [],
      });

      const popup = wrapper.findComponent({ name: "ColumnOrderPopUp" });
      expect(popup.props("availableColumns")).toEqual(["field1"]);
    });

    it("should close popup when ColumnOrderPopUp emits @cancel", async () => {
      await setupAllModeWrapper();

      wrapper.vm.openColumnOrderPopup();
      await wrapper.vm.$nextTick();
      await flushPromises();

      const popup = wrapper.findComponent({ name: "ColumnOrderPopUp" });
      expect(popup.exists()).toBe(true);
      expect(wrapper.vm.showColumnOrderPopup).toBe(true);

      await popup.vm.$emit("cancel");
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.vm.showColumnOrderPopup).toBe(false);
      const popupAfter = wrapper.findComponent({ name: "ColumnOrderPopUp" });
      expect(popupAfter.props("open")).toBe(false);
    });

    it("should save column order and close popup when ColumnOrderPopUp emits @save", async () => {
      await setupAllModeWrapper();

      wrapper.vm.openColumnOrderPopup();
      await wrapper.vm.$nextTick();
      await flushPromises();

      const popup = wrapper.findComponent({ name: "ColumnOrderPopUp" });
      expect(popup.exists()).toBe(true);

      const newOrder = ["field3", "field1", "field2"];
      await popup.vm.$emit("save", newOrder);
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(mockDashboardPanelData.data.config.column_order).toEqual(newOrder);
      expect(wrapper.vm.showColumnOrderPopup).toBe(false);
    });

    it("should not render ColumnOrderPopUp in single mode (template guarded)", async () => {
      mockDashboardPanelData.data.config = { promql_table_mode: "single" };
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      const popup = wrapper.findComponent({ name: "ColumnOrderPopUp" });
      // The popup lives inside the v-if=(all|expanded_timeseries) block,
      // so it must not be in the DOM when promql_table_mode === 'single'.
      expect(popup.exists()).toBe(false);
    });
  });
});
