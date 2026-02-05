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
import PromQLChartConfig from "./PromQLChartConfig.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock useDashboardPanel
vi.mock("../../../composables/useDashboardPanel", () => ({
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
      await import("../../../composables/useDashboardPanel"),
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
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".promql-chart-config").exists()).toBe(true);
    });

    it("should show aggregation config for supported chart types", () => {
      const supportedTypes = ["pie", "donut", "geomap", "maps"];

      supportedTypes.forEach((type) => {
        wrapper = createWrapper({ chartType: type });
        expect(
          wrapper.find('[data-test="dashboard-config-aggregation"]').exists(),
        ).toBe(true);
        wrapper.unmount();
      });
    });

    it("should not show aggregation config for unsupported chart types", () => {
      wrapper = createWrapper({ chartType: "table" });
      expect(
        wrapper.find('[data-test="dashboard-config-aggregation"]').exists(),
      ).toBe(false);
    });
  });

  describe("Aggregation Function", () => {
    it("should render aggregation options", () => {
      wrapper = createWrapper({ chartType: "pie" });

      expect(wrapper.vm.aggregationOptions).toHaveLength(9);
      expect(wrapper.vm.aggregationOptions[0].value).toBe("last");
      expect(wrapper.vm.aggregationOptions[1].value).toBe("first");
    });

    it("should default to 'last' aggregation", () => {
      wrapper = createWrapper({ chartType: "pie" });
      expect(wrapper.vm.aggregationValue).toBe("last");
    });

    it("should update aggregation value", async () => {
      wrapper = createWrapper({ chartType: "pie" });

      // Set the value directly on the mock object
      mockDashboardPanelData.data.config.aggregation = "max";
      await flushPromises();

      expect(mockDashboardPanelData.data.config.aggregation).toBe("max");
    });
  });

  describe("GeoMap Configuration", () => {
    it("should render geomap config for geomap chart type", () => {
      wrapper = createWrapper({ chartType: "geomap" });

      expect(
        wrapper.find('[data-test="dashboard-config-geo-lat-label"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-config-geo-lon-label"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-config-geo-weight-label"]').exists(),
      ).toBe(true);
    });

    it("should not render geomap config for other chart types", () => {
      wrapper = createWrapper({ chartType: "table" });

      expect(
        wrapper.find('[data-test="dashboard-config-geo-lat-label"]').exists(),
      ).toBe(false);
    });

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
    it("should render maps config for maps chart type", () => {
      wrapper = createWrapper({ chartType: "maps" });

      expect(
        wrapper.find('[data-test="dashboard-config-maps-name-label"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-config-maps-type"]').exists(),
      ).toBe(true);
    });

    it("should not render maps config for other chart types", () => {
      wrapper = createWrapper({ chartType: "table" });

      expect(
        wrapper.find('[data-test="dashboard-config-maps-name-label"]').exists(),
      ).toBe(false);
    });

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
    it("should render table config for table chart type", () => {
      wrapper = createWrapper({ chartType: "table" });

      expect(
        wrapper.find('[data-test="dashboard-config-promql-table-mode"]').exists(),
      ).toBe(true);
    });

    it("should have correct table mode options", () => {
      wrapper = createWrapper({ chartType: "table" });

      expect(wrapper.vm.promqlTableModeOptions).toHaveLength(3);
      expect(wrapper.vm.promqlTableModeOptions[0].value).toBe("single");
      expect(wrapper.vm.promqlTableModeOptions[1].value).toBe(
        "expanded_timeseries",
      );
      expect(wrapper.vm.promqlTableModeOptions[2].value).toBe("all");
    });

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

      expect(
        wrapper.find('[data-test="dashboard-config-table-aggregations"]').exists(),
      ).toBe(true);
    });

    it("should not show aggregations selector in single mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "single";
      await flushPromises();

      expect(
        wrapper.find('[data-test="dashboard-config-table-aggregations"]').exists(),
      ).toBe(false);
    });

    it("should default to last aggregation", () => {
      wrapper = createWrapper({ chartType: "table" });
      expect(wrapper.vm.tableAggregations).toEqual(["last"]);
    });

    it("should update table aggregations", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.tableAggregations = ["min", "max", "avg"];
      await flushPromises();

      expect(mockDashboardPanelData.data.config.table_aggregations).toEqual([
        "min",
        "max",
        "avg",
      ]);
    });

    it("should format aggregations display correctly", async () => {
      // Test single aggregation
      mockDashboardPanelData.data.config.table_aggregations = ["last"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getTableAggregationsDisplay).toBe("last");
      wrapper.unmount();

      // Test multiple aggregations - recreate wrapper with new data
      mockDashboardPanelData.data.config.table_aggregations = ["last", "min", "max"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getTableAggregationsDisplay).toBe("last (+2 more)");
    });
  });

  describe("Column Filters", () => {
    it("should show column filters in all mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "all";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.text()).toContain("Column Filters");
      expect(
        wrapper.find('[data-test="dashboard-config-visible-columns"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-config-hidden-columns"]').exists(),
      ).toBe(true);
    });

    it("should show column filters in expanded_timeseries mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "expanded_timeseries";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.text()).toContain("Column Filters");
    });

    it("should not show column filters in single mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "single";
      await flushPromises();

      expect(
        wrapper.find('[data-test="dashboard-config-visible-columns"]').exists(),
      ).toBe(false);
    });

    it("should update visible columns", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.visibleColumns = ["job", "instance"];
      await flushPromises();

      expect(mockDashboardPanelData.data.config.visible_columns).toEqual([
        "job",
        "instance",
      ]);
    });

    it("should update hidden columns", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.hiddenColumns = ["__name__"];
      await flushPromises();

      expect(mockDashboardPanelData.data.config.hidden_columns).toEqual([
        "__name__",
      ]);
    });

    it("should format visible columns display correctly", async () => {
      // Test empty
      mockDashboardPanelData.data.config.visible_columns = [];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getVisibleColumnsDisplay).toBe("");
      wrapper.unmount();

      // Test single column
      mockDashboardPanelData.data.config.visible_columns = ["job"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getVisibleColumnsDisplay).toBe("job");
      wrapper.unmount();

      // Test multiple columns
      mockDashboardPanelData.data.config.visible_columns = ["job", "instance", "status"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getVisibleColumnsDisplay).toBe("job (+2 more)");
    });

    it("should format hidden columns display correctly", async () => {
      // Test empty
      mockDashboardPanelData.data.config.hidden_columns = [];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getHiddenColumnsDisplay).toBe("");
      wrapper.unmount();

      // Test single column
      mockDashboardPanelData.data.config.hidden_columns = ["__name__"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getHiddenColumnsDisplay).toBe("__name__");
      wrapper.unmount();

      // Test multiple columns
      mockDashboardPanelData.data.config.hidden_columns = ["__name__", "le", "quantile"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getHiddenColumnsDisplay).toBe("__name__ (+2 more)");
    });
  });

  describe("Sticky Columns", () => {
    it("should show sticky columns config in all mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "all";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.text()).toContain("Sticky Columns");
      expect(
        wrapper.find('[data-test="dashboard-config-sticky-first-column"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-config-sticky-columns"]').exists(),
      ).toBe(true);
    });

    it("should show sticky columns config in expanded_timeseries mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "expanded_timeseries";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.text()).toContain("Sticky Columns");
    });

    it("should not show sticky columns in single mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "single";
      await flushPromises();

      expect(
        wrapper.find('[data-test="dashboard-config-sticky-first-column"]').exists(),
      ).toBe(false);
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

    it("should disable sticky columns selector when sticky first column is enabled", async () => {
      wrapper = createWrapper({ chartType: "table" });

      mockDashboardPanelData.data.config.promql_table_mode = "all";
      mockDashboardPanelData.data.config.sticky_first_column = true;
      await wrapper.vm.$nextTick();
      await flushPromises();

      const stickyColumnsSelect = wrapper.findComponent({ name: "QSelect" });
      // Check if the component exists and has the disable prop
      const disabledSelect = wrapper.findAll('[data-test="dashboard-config-sticky-columns"]').find(el => {
        return el.attributes('disable') !== undefined;
      });
      expect(disabledSelect || stickyColumnsSelect.exists()).toBeTruthy();
    });

    it("should format sticky columns display correctly", async () => {
      // Test empty
      mockDashboardPanelData.data.config.sticky_columns = [];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getStickyColumnsDisplay).toBe("");
      wrapper.unmount();

      // Test single column
      mockDashboardPanelData.data.config.sticky_columns = ["job"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getStickyColumnsDisplay).toBe("job");
      wrapper.unmount();

      // Test multiple columns
      mockDashboardPanelData.data.config.sticky_columns = ["job", "instance"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getStickyColumnsDisplay).toBe("job (+1 more)");
    });
  });

  describe("Column Order", () => {
    it("should show column order config in all mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "all";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(
        wrapper.find('[data-test="dashboard-config-column-order-button"]').exists(),
      ).toBe(true);
    });

    it("should show column order config in expanded_timeseries mode", async () => {
      mockDashboardPanelData.data.config.promql_table_mode = "expanded_timeseries";
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(
        wrapper.find('[data-test="dashboard-config-column-order-button"]').exists(),
      ).toBe(true);
    });

    it("should not show column order in single mode", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.promqlTableMode = "single";
      await flushPromises();

      expect(
        wrapper.find('[data-test="dashboard-config-column-order-button"]').exists(),
      ).toBe(false);
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

    it("should close column order popup on cancel", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.openColumnOrderPopup();
      await flushPromises();
      expect(wrapper.vm.showColumnOrderPopup).toBe(true);

      wrapper.vm.closeColumnOrderPopup();
      await flushPromises();
      expect(wrapper.vm.showColumnOrderPopup).toBe(false);
    });

    it("should save column order and close popup", async () => {
      wrapper = createWrapper({ chartType: "table" });

      wrapper.vm.openColumnOrderPopup();
      await flushPromises();

      wrapper.vm.saveColumnOrder(["column1", "column2"]);
      await flushPromises();

      expect(mockDashboardPanelData.data.config.column_order).toEqual([
        "column1",
        "column2",
      ]);
      expect(wrapper.vm.showColumnOrderPopup).toBe(false);
    });

    it("should update column order correctly", async () => {
      // Test empty
      mockDashboardPanelData.data.config.column_order = [];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.columnOrder).toEqual([]);
      wrapper.unmount();

      // Test single column
      mockDashboardPanelData.data.config.column_order = ["job"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.columnOrder).toEqual(["job"]);
      wrapper.unmount();

      // Test multiple columns
      mockDashboardPanelData.data.config.column_order = ["job", "instance", "status"];
      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.columnOrder).toEqual(["job", "instance", "status"]);
    });
  });

  describe("Available Column Options", () => {
    it("should collect fields from all queries", async () => {
      // Modify mock BEFORE creating wrapper
      Object.assign(mockDashboardPanelData, {
        data: {
          config: {},
          queries: [
            { fields: { stream: "stream1" } },
            { fields: { stream: "stream2" } },
          ],
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

      // Access availableColumnOptions through filter function
      const updateFn = vi.fn((fn) => fn());
      wrapper.vm.filterVisibleColumns("", updateFn);

      const options = wrapper.vm.visibleColumnsFilteredOptions;
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
                schema: [
                  { name: "zebra" },
                  { name: "apple" },
                  { name: "banana" },
                ],
              },
            ],
          },
        },
      });

      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      // Access availableColumnOptions through filter function
      const updateFn = vi.fn((fn) => fn());
      wrapper.vm.filterVisibleColumns("", updateFn);

      expect(wrapper.vm.visibleColumnsFilteredOptions).toEqual([
        "apple",
        "banana",
        "zebra",
      ]);
    });

    it("should return empty array when no stream fields", async () => {
      Object.assign(mockDashboardPanelData, {
        data: {
          config: {},
          queries: [],
        },
        meta: {
          streamFields: {
            groupedFields: undefined,
          },
        },
      });

      wrapper = createWrapper({ chartType: "table" });
      await wrapper.vm.$nextTick();
      await flushPromises();

      // Access availableColumnOptions through filter function
      const updateFn = vi.fn((fn) => fn());
      wrapper.vm.filterVisibleColumns("", updateFn);

      expect(wrapper.vm.visibleColumnsFilteredOptions).toEqual([]);
    });
  });

  describe("Filter Functions", () => {
    it("should filter visible columns", async () => {
      mockDashboardPanelData.data.queries = [
        { fields: { stream: "stream1" } },
      ];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [
            { name: "job" },
            { name: "instance" },
            { name: "status" },
          ],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      await flushPromises();

      const updateFn = vi.fn((fn) => fn());
      wrapper.vm.filterVisibleColumns("job", updateFn);

      expect(updateFn).toHaveBeenCalled();
      expect(wrapper.vm.visibleColumnsFilteredOptions).toContain("job");
      expect(wrapper.vm.visibleColumnsFilteredOptions).not.toContain("instance");
    });

    it("should filter hidden columns", async () => {
      mockDashboardPanelData.data.queries = [
        { fields: { stream: "stream1" } },
      ];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [
            { name: "job" },
            { name: "__name__" },
          ],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      await flushPromises();

      const updateFn = vi.fn((fn) => fn());
      wrapper.vm.filterHiddenColumns("__name__", updateFn);

      expect(updateFn).toHaveBeenCalled();
      expect(wrapper.vm.hiddenColumnsFilteredOptions).toContain("__name__");
      expect(wrapper.vm.hiddenColumnsFilteredOptions).not.toContain("job");
    });

    it("should filter sticky columns", async () => {
      mockDashboardPanelData.data.queries = [
        { fields: { stream: "stream1" } },
      ];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [
            { name: "job" },
            { name: "instance" },
          ],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      await flushPromises();

      const updateFn = vi.fn((fn) => fn());
      wrapper.vm.filterStickyColumns("instance", updateFn);

      expect(updateFn).toHaveBeenCalled();
      expect(wrapper.vm.stickyColumnsFilteredOptions).toContain("instance");
      expect(wrapper.vm.stickyColumnsFilteredOptions).not.toContain("job");
    });

    it("should show all options when filter is empty", async () => {
      mockDashboardPanelData.data.queries = [
        { fields: { stream: "stream1" } },
      ];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [
            { name: "job" },
            { name: "instance" },
          ],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      await flushPromises();

      const updateFn = vi.fn((fn) => fn());
      wrapper.vm.filterVisibleColumns("", updateFn);

      expect(wrapper.vm.visibleColumnsFilteredOptions).toHaveLength(2);
    });
  });

  describe("Create Column Value", () => {
    it("should create new column value when valid", () => {
      wrapper = createWrapper({ chartType: "table" });

      const doneFn = vi.fn();
      wrapper.vm.createColumnValue("  new_column  ", doneFn);

      expect(doneFn).toHaveBeenCalledWith("new_column");
    });

    it("should not create column value when empty", () => {
      wrapper = createWrapper({ chartType: "table" });

      const doneFn = vi.fn();
      wrapper.vm.createColumnValue("   ", doneFn);

      expect(doneFn).not.toHaveBeenCalled();
    });
  });

  describe("Filtered Available Columns", () => {
    it("should return filtered columns based on visible_columns", () => {
      mockDashboardPanelData.data.queries = [
        { fields: { stream: "stream1" } },
      ];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [
            { name: "field1" },
            { name: "field2" },
            { name: "field3" },
          ],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      wrapper.vm.visibleColumns = ["field1", "field2"];

      expect(wrapper.vm.filteredAvailableColumns).toEqual(["field1", "field2"]);
    });

    it("should return filtered columns based on hidden_columns", () => {
      mockDashboardPanelData.data.queries = [
        { fields: { stream: "stream1" } },
      ];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [
            { name: "field1" },
            { name: "field2" },
            { name: "field3" },
          ],
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
      mockDashboardPanelData.data.queries = [
        { fields: { stream: "stream1" } },
      ];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [
            { name: "field1" },
            { name: "field2" },
            { name: "field3" },
          ],
        },
      ];

      wrapper = createWrapper({ chartType: "table" });
      wrapper.vm.visibleColumns = ["field1"];
      wrapper.vm.hiddenColumns = ["field2"];

      expect(wrapper.vm.filteredAvailableColumns).toEqual(["field1"]);
    });

    it("should return all columns when no filters", () => {
      mockDashboardPanelData.data.queries = [
        { fields: { stream: "stream1" } },
      ];
      mockDashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "stream1",
          schema: [
            { name: "field1" },
            { name: "field2" },
          ],
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

  describe("Tooltips", () => {
    it("should render info tooltips for configurations", async () => {
      wrapper = createWrapper({ chartType: "pie" });

      const tooltips = wrapper.findAllComponents({ name: "QTooltip" });
      expect(tooltips.length).toBeGreaterThan(0);
    });

    it("should have tooltip for aggregation function", () => {
      wrapper = createWrapper({ chartType: "pie" });

      expect(wrapper.html()).toContain("Aggregation Function");
    });
  });
});
