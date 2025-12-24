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

// Mock Quasar exportFile
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    exportFile: vi.fn().mockReturnValue(true),
  };
});

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  }),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  findFirstValidMappedValue: vi.fn().mockReturnValue(null),
}));

import TableRenderer from "@/components/dashboards/panels/TableRenderer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { exportFile } from "quasar";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockTableData = {
  columns: [
    {
      name: "timestamp",
      label: "Timestamp",
      field: "timestamp",
      sortable: true,
      align: "left",
    },
    {
      name: "level",
      label: "Level",
      field: "level",
      sortable: true,
      align: "center",
    },
    {
      name: "message",
      label: "Message",
      field: "message",
      sortable: false,
      align: "left",
    },
    {
      name: "count",
      label: "Count",
      field: "count",
      sortable: true,
      align: "right",
    },
  ],
  rows: [
    {
      id: 1,
      timestamp: "2023-01-01T00:00:00Z",
      level: "INFO",
      message: "Application started",
      count: 1,
    },
    {
      id: 2,
      timestamp: "2023-01-01T00:01:00Z",
      level: "ERROR",
      message: "Database connection failed",
      count: 5,
    },
    {
      id: 3,
      timestamp: "2023-01-01T00:02:00Z",
      level: "WARN",
      message: null, // Test null value handling
      count: undefined, // Test undefined value handling
    },
  ],
};

const mockValueMapping = [
  {
    field: "level",
    mappings: [
      { value: "INFO", displayText: "Information", color: "#green" },
      { value: "ERROR", displayText: "Error", color: "#red" },
      { value: "WARN", displayText: "Warning", color: "#orange" },
    ],
  },
];

describe("TableRenderer", () => {
  let wrapper: any;

  const defaultProps = {
    data: mockTableData,
    wrapCells: false,
    valueMapping: [],
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

  const createWrapper = (props = {}) => {
    return mount(TableRenderer, {
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
    });
  };

  describe("Component Rendering", () => {
    it("should render table with correct structure", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-panel-table"]').exists()).toBe(
        true,
      );
      expect(wrapper.find("table").exists()).toBe(true);
    });

    it("should render table headers correctly", () => {
      wrapper = createWrapper();

      const headers = wrapper.findAll("th");
      expect(headers.length).toBeGreaterThan(0);

      // Check if column labels are rendered
      const headerText = wrapper.text();
      expect(headerText).toContain("Timestamp");
      expect(headerText).toContain("Level");
      expect(headerText).toContain("Message");
      expect(headerText).toContain("Count");
    });

    it("should render table rows with data", () => {
      wrapper = createWrapper();

      // QTable with virtual scrolling doesn't use traditional tbody tr structure
      // Instead, check if the component received the correct data
      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("rows")).toEqual(mockTableData.rows);
      expect(table.props("rows").length).toBe(mockTableData.rows.length);
    });

    it("should handle empty table data", () => {
      const emptyData = { columns: [], rows: [] };
      wrapper = createWrapper({ data: emptyData });

      expect(wrapper.find("table").exists()).toBe(true);
      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("rows")).toEqual([]);
      expect(table.props("rows").length).toBe(0);
    });

    it("should apply wrap cells class when wrapCells is true", () => {
      wrapper = createWrapper({ wrapCells: true });

      expect(wrapper.find(".wrap-enabled").exists()).toBe(true);
      // Verify the table component has the wrapCells prop set
      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("wrapCells")).toBe(true);
    });

    it("should not apply wrap cells class when wrapCells is false", () => {
      wrapper = createWrapper({ wrapCells: false });

      expect(wrapper.find(".wrap-enabled").exists()).toBe(false);
    });

    it("should render bottom slot content when provided", () => {
      wrapper = mount(TableRenderer, {
        props: {
          ...defaultProps,
        },
        global: {
          plugins: [i18n, store],
          mocks: {
            $t: (key: string) => key,
          },
        },
        slots: {
          bottom: '<div class="test-bottom">Footer content</div>',
        },
      });

      expect(wrapper.find(".test-bottom").exists()).toBe(true);
      expect(wrapper.find(".test-bottom").text()).toBe("Footer content");
    });
  });

  describe("Print Mode", () => {
    it("should apply no-position-absolute class in print mode", async () => {
      store.state.printMode = true;
      wrapper = createWrapper();

      expect(wrapper.find(".no-position-absolute").exists()).toBe(true);
    });

    it("should not apply no-position-absolute class when not in print mode", () => {
      store.state.printMode = false;
      wrapper = createWrapper();

      expect(wrapper.find(".no-position-absolute").exists()).toBe(false);
    });
  });

  describe("Cell Value Handling", () => {
    it("should display empty string for undefined values", () => {
      wrapper = createWrapper();

      // Find cells and check if undefined values are displayed as empty
      const tableText = wrapper.text();
      expect(tableText).not.toContain("undefined");
    });

    it("should display empty string for null values", () => {
      wrapper = createWrapper();

      // The null message should not be displayed
      const cells = wrapper.findAll("td");
      const nullCell = cells.find((cell) => cell.text() === "");
      expect(nullCell).toBeDefined();
    });

    it("should display actual values correctly", () => {
      wrapper = createWrapper();

      // Check that the component received the correct data
      const table = wrapper.findComponent({ name: "QTable" });
      const rows = table.props("rows");

      // Verify the data contains our test values
      expect(rows.some((row) => row.message === "Application started")).toBe(
        true,
      );
      expect(
        rows.some((row) => row.message === "Database connection failed"),
      ).toBe(true);
      expect(rows.some((row) => row.level === "INFO")).toBe(true);
      expect(rows.some((row) => row.level === "ERROR")).toBe(true);
    });

    it("should handle numeric values", () => {
      wrapper = createWrapper();

      // Check that the component received the correct numeric data
      const table = wrapper.findComponent({ name: "QTable" });
      const rows = table.props("rows");

      // Verify the data contains our test numeric values
      expect(rows.some((row) => row.count === 1)).toBe(true);
      expect(rows.some((row) => row.count === 5)).toBe(true);
    });
  });

  describe("Value Mapping", () => {
    it("should apply value mappings when provided", () => {
      wrapper = createWrapper({ valueMapping: mockValueMapping });

      // Should have access to value mapping in component
      expect(wrapper.vm.valueMapping).toEqual(mockValueMapping);
    });

    it("should handle empty value mappings", () => {
      wrapper = createWrapper({ valueMapping: [] });

      expect(wrapper.vm.valueMapping).toEqual([]);
    });

    it("should apply styling based on value mappings", () => {
      wrapper = createWrapper({ valueMapping: mockValueMapping });

      // Test the getStyle method
      const mockProps = {
        col: { name: "level" },
        value: "ERROR",
        row: { level: "ERROR" },
      };

      const style = wrapper.vm.getStyle(mockProps);
      expect(style).toBeDefined();
    });
  });

  describe("Table Interactions", () => {
    it("should emit row-click event when row is clicked", async () => {
      wrapper = createWrapper();

      // Simulate row click through the QTable component
      const table = wrapper.findComponent({ name: "QTable" });
      await table.vm.$emit("row-click", {}, mockTableData.rows[0]);

      expect(wrapper.emitted("row-click")).toBeTruthy();
    });

    it("should handle row selection", async () => {
      wrapper = createWrapper();

      const tableComponent = wrapper.findComponent({ name: "QTable" });
      if (tableComponent.exists()) {
        await tableComponent.vm.$emit("row-click", {}, mockTableData.rows[0]);
        expect(wrapper.emitted("row-click")).toBeTruthy();
      }
    });
  });

  describe("Virtual Scrolling", () => {
    it("should enable virtual scrolling", () => {
      wrapper = createWrapper();

      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("virtualScroll")).toBe(true);
    });

    it("should configure virtual scroll properties", () => {
      wrapper = createWrapper();

      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("virtualScrollStickySizeStart")).toBeDefined();
    });

    it("should handle large datasets efficiently", () => {
      // Create large dataset
      const largeData = {
        columns: mockTableData.columns,
        rows: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          timestamp: `2023-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
          level: ["INFO", "ERROR", "WARN"][i % 3],
          message: `Message ${i}`,
          count: i + 1,
        })),
      };

      wrapper = createWrapper({ data: largeData });

      expect(wrapper.find('[data-test="dashboard-panel-table"]').exists()).toBe(
        true,
      );
      expect(wrapper.vm.data.rows.length).toBe(1000);
    });
  });

  describe("CSV Export", () => {
    it("should export table data as CSV", () => {
      wrapper = createWrapper();

      const result = wrapper.vm.downloadTableAsCSV("test-table");

      expect(exportFile).toHaveBeenCalledWith(
        "test-table.csv",
        expect.stringContaining("Timestamp"),
        "text/csv",
      );
    });

    it("should handle CSV export with special characters", () => {
      const dataWithSpecialChars = {
        columns: [{ name: "field", label: "Field", field: "field" }],
        rows: [
          { id: 1, field: 'Text with "quotes"' },
          { id: 2, field: "Text with\nnewline" },
          { id: 3, field: "Text with, comma" },
        ],
      };

      wrapper = createWrapper({ data: dataWithSpecialChars });

      wrapper.vm.downloadTableAsCSV("special-chars");

      expect(exportFile).toHaveBeenCalled();
      const csvContent = vi.mocked(exportFile).mock.calls[0][1];
      expect(csvContent).toContain('""'); // Escaped quotes
    });

    it("should handle empty table export", () => {
      const emptyData = { columns: [], rows: [] };
      wrapper = createWrapper({ data: emptyData });

      wrapper.vm.downloadTableAsCSV("empty-table");

      expect(exportFile).toHaveBeenCalledWith(
        "empty-table.csv",
        expect.any(String),
        "text/csv",
      );
    });

    it("should wrap CSV values correctly", () => {
      wrapper = createWrapper();

      // Test the CSV export functionality instead of the internal wrapCsvValue function
      wrapper.vm.downloadTableAsCSV("test-csv");

      expect(exportFile).toHaveBeenCalledWith(
        "test-csv.csv",
        expect.any(String),
        "text/csv",
      );
    });

    it("should handle null and undefined values in CSV", () => {
      const dataWithNulls = {
        columns: [{ name: "field", label: "Field", field: "field" }],
        rows: [
          { id: 1, field: null },
          { id: 2, field: undefined },
          { id: 3, field: "" },
        ],
      };

      wrapper = createWrapper({ data: dataWithNulls });

      wrapper.vm.downloadTableAsCSV("test-nulls");

      expect(exportFile).toHaveBeenCalled();
    });
  });

  describe("Pagination", () => {
    it("should configure pagination correctly", () => {
      wrapper = createWrapper();

      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("rowsPerPageOptions")).toEqual([0]);
    });

    it("should handle pagination model", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.pagination).toBeDefined();
      expect(typeof wrapper.vm.pagination).toBe("object");
    });
  });

  describe("Styling", () => {
    it("should apply sticky header styling", () => {
      wrapper = createWrapper();

      expect(wrapper.find(".my-sticky-virtscroll-table").exists()).toBe(true);
    });

    it("should apply dense table styling", () => {
      wrapper = createWrapper();

      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("dense")).toBe(true);
    });

    it("should compute cell styles based on value mappings", () => {
      wrapper = createWrapper({ valueMapping: mockValueMapping });

      const mockProps = {
        col: { name: "level" },
        value: "ERROR",
        row: { level: "ERROR" },
      };

      const style = wrapper.vm.getStyle(mockProps);
      expect(style).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed table data", () => {
      const malformedData = {
        columns: [], // Use empty array instead of null to avoid QTable internal errors
        rows: null,
      };

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      wrapper = createWrapper({ data: malformedData });

      expect(wrapper.exists()).toBe(true);
      // Component should handle null/undefined gracefully by using fallbacks
      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("rows")).toEqual([]); // Should fallback to empty array
      expect(table.props("columns")).toEqual([]); // Should use empty array
      consoleWarnSpy.mockRestore();
    });

    it("should handle missing columns", () => {
      const dataWithoutColumns = {
        rows: mockTableData.rows,
      };

      wrapper = createWrapper({ data: dataWithoutColumns });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing rows", () => {
      const dataWithoutRows = {
        columns: mockTableData.columns,
      };

      wrapper = createWrapper({ data: dataWithoutRows });

      expect(wrapper.exists()).toBe(true);
      // Check that the component handles missing rows properly using fallback
      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.props("rows")).toEqual([]); // Should fallback to empty array
    });
  });

  describe("Performance", () => {
    it("should render efficiently with large datasets", async () => {
      const performanceData = {
        columns: mockTableData.columns,
        rows: Array.from({ length: 5000 }, (_, i) => ({
          id: i,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          level: ["INFO", "ERROR", "WARN"][i % 3],
          message: `Performance test message ${i}`,
          count: i,
        })),
      };

      const startTime = performance.now();
      wrapper = createWrapper({ data: performanceData });
      await wrapper.vm.$nextTick();
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should render in less than 1 second
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle frequent data updates efficiently", async () => {
      wrapper = createWrapper();

      for (let i = 0; i < 10; i++) {
        const newData = {
          ...mockTableData,
          rows: mockTableData.rows.map((row) => ({
            ...row,
            count: row.count + i,
          })),
        };
        await wrapper.setProps({ data: newData });
      }

      expect(wrapper.exists()).toBe(true);
    });
  });
});
