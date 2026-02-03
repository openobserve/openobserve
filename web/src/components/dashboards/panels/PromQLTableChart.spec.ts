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

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  }),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  findFirstValidMappedValue: vi.fn().mockReturnValue(null),
}));

import PromQLTableChart from "@/components/dashboards/panels/PromQLTableChart.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockTableData = {
  columns: [
    {
      name: "__legend__",
      label: "Legend",
      field: "__legend__",
      sortable: true,
      align: "left",
    },
    {
      name: "timestamp",
      label: "Timestamp",
      field: "timestamp",
      sortable: true,
      align: "left",
    },
    {
      name: "value",
      label: "Value",
      field: "value",
      sortable: true,
      align: "right",
    },
  ],
  rows: [
    { __legend__: "series1", timestamp: "2023-01-01T00:00:00Z", value: 100 },
    { __legend__: "series1", timestamp: "2023-01-01T00:01:00Z", value: 150 },
    { __legend__: "series2", timestamp: "2023-01-01T00:00:00Z", value: 200 },
    { __legend__: "series2", timestamp: "2023-01-01T00:01:00Z", value: 250 },
    { __legend__: "series3", timestamp: "2023-01-01T00:00:00Z", value: 300 },
  ],
};

const mockConfig = {
  wrap_table_cells: false,
  mappings: [],
  promql_table_mode: "single",
  show_pagination: false,
  rows_per_page: 10,
};

describe("PromQLTableChart", () => {
  let wrapper: any;

  const defaultProps = {
    data: mockTableData,
    config: mockConfig,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.printMode = false;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}, options = {}) => {
    return mount(PromQLTableChart, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key,
        },
      },
      ...options,
    });
  };

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = createWrapper();

      expect(wrapper.find(".promql-table-chart").exists()).toBe(true);
    });

    it("should render TableRenderer component", () => {
      wrapper = createWrapper();

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.exists()).toBe(true);
    });

    it("should pass correct props to TableRenderer", () => {
      wrapper = createWrapper();

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("wrapCells")).toBe(false);
      expect(tableRenderer.props("valueMapping")).toEqual([]);
    });

    it("should pass data to TableRenderer", () => {
      wrapper = createWrapper();

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      const data = tableRenderer.props("data");
      expect(data.columns).toEqual(mockTableData.columns);
    });
  });

  describe("Table Columns", () => {
    it("should extract columns from data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.tableColumns).toEqual(mockTableData.columns);
    });

    it("should return empty array when no columns in data", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      wrapper = createWrapper({ data: { rows: [] } });

      expect(wrapper.vm.tableColumns).toEqual([]);
      consoleSpy.mockRestore();
    });

    it("should handle null columns gracefully", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      wrapper = createWrapper({ data: { columns: null, rows: [] } });

      expect(wrapper.vm.tableColumns).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("Table Rows", () => {
    it("should extract rows from data with IDs", () => {
      wrapper = createWrapper();

      const rows = wrapper.vm.tableRows;
      expect(rows.length).toBe(5);
      expect(rows[0].id).toBe("row_0");
      expect(rows[1].id).toBe("row_1");
    });

    it("should return empty array when no rows in data", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      wrapper = createWrapper({ data: { columns: mockTableData.columns } });

      expect(wrapper.vm.tableRows).toEqual([]);
      consoleSpy.mockRestore();
    });

    it("should preserve original row data", () => {
      wrapper = createWrapper();

      const rows = wrapper.vm.tableRows;
      expect(rows[0].__legend__).toBe("series1");
      expect(rows[0].value).toBe(100);
    });
  });

  describe("Legend Options", () => {
    it("should extract unique legend names from rows", () => {
      wrapper = createWrapper();

      const options = wrapper.vm.legendOptions;
      expect(options.length).toBe(3); // series1, series2, series3
    });

    it("should create options with label and value", () => {
      wrapper = createWrapper();

      const options = wrapper.vm.legendOptions;
      expect(options[0]).toHaveProperty("label");
      expect(options[0]).toHaveProperty("value");
    });

    it("should handle rows without __legend__ field", () => {
      const dataWithoutLegend = {
        columns: [{ name: "value", label: "Value", field: "value" }],
        rows: [{ value: 100 }, { value: 200 }],
      };
      wrapper = createWrapper({ data: dataWithoutLegend });

      expect(wrapper.vm.legendOptions).toEqual([]);
    });

    it("should add 'All series' option in 'all' mode", () => {
      wrapper = createWrapper({
        config: { ...mockConfig, promql_table_mode: "all" },
      });

      const options = wrapper.vm.legendOptions;
      expect(options[0].value).toBe("__all__");
      expect(options[0].label).toBe("All series");
    });
  });

  describe("Selected Legend", () => {
    it("should default to first legend option in single mode", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.selectedLegend).toBe("series1");
    });

    it("should default to __all__ in 'all' mode", async () => {
      wrapper = createWrapper({
        config: { ...mockConfig, promql_table_mode: "all" },
      });
      await flushPromises();

      expect(wrapper.vm.selectedLegend).toBe("__all__");
    });

    it("should preserve selected legend when data changes if still valid", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.selectedLegend = "series2";
      await wrapper.vm.$nextTick();

      // Update data but keep series2
      const newData = {
        ...mockTableData,
        rows: [
          ...mockTableData.rows,
          { __legend__: "series4", timestamp: "2023-01-01", value: 400 },
        ],
      };
      await wrapper.setProps({ data: newData });
      await flushPromises();

      expect(wrapper.vm.selectedLegend).toBe("series2");
    });
  });

  describe("Filtered Table Rows", () => {
    it("should filter rows by selected legend in single mode", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.selectedLegend = "series1";
      await wrapper.vm.$nextTick();

      const filteredRows = wrapper.vm.filteredTableRows;
      expect(filteredRows.every((row: any) => row.__legend__ === "series1")).toBe(true);
    });

    it("should show all rows when __all__ is selected", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.selectedLegend = "__all__";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredTableRows.length).toBe(5);
    });

    it("should show all rows in 'all' mode regardless of selection", async () => {
      wrapper = createWrapper({
        config: { ...mockConfig, promql_table_mode: "all" },
      });
      await flushPromises();

      wrapper.vm.selectedLegend = "series1";
      await wrapper.vm.$nextTick();

      // In "all" mode, filtering is disabled
      expect(wrapper.vm.filteredTableRows.length).toBe(5);
    });

    it("should return all rows when no legend is selected", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.selectedLegend = "";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredTableRows.length).toBe(5);
    });
  });

  describe("Show Legend Footer", () => {
    it("should show legend footer in single mode", () => {
      wrapper = createWrapper({
        config: { ...mockConfig, promql_table_mode: "single" },
      });

      expect(wrapper.vm.showLegendFooter).toBe(true);
    });

    it("should show legend footer in expanded_timeseries mode", () => {
      wrapper = createWrapper({
        config: { ...mockConfig, promql_table_mode: "expanded_timeseries" },
      });

      expect(wrapper.vm.showLegendFooter).toBe(true);
    });

    it("should hide legend footer in 'all' mode", () => {
      wrapper = createWrapper({
        config: { ...mockConfig, promql_table_mode: "all" },
      });

      expect(wrapper.vm.showLegendFooter).toBe(false);
    });

    it("should default to single mode when promql_table_mode is not set", () => {
      wrapper = createWrapper({
        config: { ...mockConfig, promql_table_mode: undefined },
      });

      expect(wrapper.vm.showLegendFooter).toBe(true);
    });
  });

  describe("Pagination Props to TableRenderer", () => {
    it("should pass show_pagination to TableRenderer", () => {
      wrapper = createWrapper({
        config: { ...mockConfig, show_pagination: true },
      });

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("showPagination")).toBe(true);
    });

    it("should pass rows_per_page to TableRenderer", () => {
      wrapper = createWrapper({
        config: { ...mockConfig, show_pagination: true, rows_per_page: 25 },
      });

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("rowsPerPage")).toBe(25);
    });

    it("should default showPagination to false when not in config", () => {
      wrapper = createWrapper({
        config: { wrap_table_cells: false, mappings: [] },
      });

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("showPagination")).toBeFalsy();
    });
  });

  describe("Event Handling", () => {
    it("should emit row-click when TableRenderer emits row-click", async () => {
      wrapper = createWrapper();

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      await tableRenderer.vm.$emit("row-click", mockTableData.rows[0]);

      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")[0]).toEqual([mockTableData.rows[0]]);
    });
  });

  describe("Config Reactivity", () => {
    it("should update when config changes", async () => {
      wrapper = createWrapper({
        config: { ...mockConfig, wrap_table_cells: false },
      });

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("wrapCells")).toBe(false);

      await wrapper.setProps({
        config: { ...mockConfig, wrap_table_cells: true },
      });

      expect(tableRenderer.props("wrapCells")).toBe(true);
    });

    it("should update pagination when show_pagination changes", async () => {
      wrapper = createWrapper({
        config: { ...mockConfig, show_pagination: false },
      });

      let tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("showPagination")).toBe(false);

      await wrapper.setProps({
        config: { ...mockConfig, show_pagination: true },
      });

      tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("showPagination")).toBe(true);
    });
  });

  describe("Value Mapping", () => {
    it("should pass value mappings to TableRenderer", () => {
      const mappings = [
        { from: 0, to: 100, text: "Low", color: "#green" },
        { from: 101, to: 200, text: "High", color: "#red" },
      ];
      wrapper = createWrapper({
        config: { ...mockConfig, mappings },
      });

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("valueMapping")).toEqual(mappings);
    });

    it("should default to empty array when no mappings", () => {
      wrapper = createWrapper({
        config: { wrap_table_cells: false },
      });

      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("valueMapping")).toEqual([]);
    });
  });

  describe("Empty Data Handling", () => {
    it("should handle empty rows", () => {
      wrapper = createWrapper({
        data: { columns: mockTableData.columns, rows: [] },
      });

      expect(wrapper.vm.tableRows).toEqual([]);
      expect(wrapper.vm.filteredTableRows).toEqual([]);
    });

    it("should handle empty columns", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      wrapper = createWrapper({
        data: { columns: [], rows: mockTableData.rows },
      });

      expect(wrapper.vm.tableColumns).toEqual([]);
      consoleSpy.mockRestore();
    });

    it("should handle completely empty data", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      wrapper = createWrapper({
        data: {},
      });

      expect(wrapper.vm.tableColumns).toEqual([]);
      expect(wrapper.vm.tableRows).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("Legend Footer Slot Content", () => {
    it("should render legend selector in footer when showLegendFooter is true", async () => {
      wrapper = createWrapper({
        config: { ...mockConfig, promql_table_mode: "single" },
      });
      await flushPromises();

      // The footer should be rendered through the slot
      expect(wrapper.vm.showLegendFooter).toBe(true);
    });

    it("should show pagination controls when pagination is enabled", async () => {
      wrapper = createWrapper({
        config: { ...mockConfig, show_pagination: true, promql_table_mode: "single" },
      });
      await flushPromises();

      // Check that pagination config is passed correctly
      const tableRenderer = wrapper.findComponent({ name: "TableRenderer" });
      expect(tableRenderer.props("showPagination")).toBe(true);
    });
  });

  describe("Performance", () => {
    it("should handle large datasets", () => {
      const largeData = {
        columns: mockTableData.columns,
        rows: Array.from({ length: 10000 }, (_, i) => ({
          __legend__: `series${i % 10}`,
          timestamp: `2023-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
          value: i * 10,
        })),
      };

      const startTime = performance.now();
      wrapper = createWrapper({ data: largeData });
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(1000);
      expect(wrapper.vm.tableRows.length).toBe(10000);
    });

    it("should efficiently filter large datasets", async () => {
      const largeData = {
        columns: mockTableData.columns,
        rows: Array.from({ length: 5000 }, (_, i) => ({
          __legend__: `series${i % 5}`,
          timestamp: `2023-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
          value: i * 10,
        })),
      };

      wrapper = createWrapper({ data: largeData });
      await flushPromises();

      wrapper.vm.selectedLegend = "series0";
      await wrapper.vm.$nextTick();

      const startTime = performance.now();
      const filtered = wrapper.vm.filteredTableRows;
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100);
      expect(filtered.length).toBe(1000); // 5000 / 5 series
    });
  });
});
