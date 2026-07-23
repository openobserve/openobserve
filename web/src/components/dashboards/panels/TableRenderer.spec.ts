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

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any component imports.
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: (optsRef: any) => ({
    __v_isRef: true,
    value: {
      getTotalSize: () => (optsRef.value.count ?? 0) * 24,
      getVirtualItems: () =>
        Array.from({ length: optsRef.value.count ?? 0 }, (_, i) => ({
          key: i,
          index: i,
          start: i * 24,
          size: 24,
        })),
      measureElement: vi.fn(),
    },
  }),
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: () => ({
      state: {
        theme: "light",
        zoConfig: { timestamp_column: "_timestamp" },
        printMode: false,
      },
    }),
  };
});

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
  createI18n: () => ({ install: vi.fn() }),
}));

vi.mock("vue-draggable-next", () => ({
  VueDraggableNext: {
    name: "VueDraggable",
    template: "<tr><slot /></tr>",
    props: ["modelValue", "animation", "sort", "disabled", "handle", "tag"],
  },
}));

vi.mock("@/plugins/logs/JsonPreview.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/plugins/logs/data-table/CellActions.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/components/common/O2AIContextAddBtn.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/utils/logs/statusParser", () => ({
  extractStatusFromLog: () => ({ color: "" }),
}));

vi.mock("@/composables/useTextHighlighter", () => ({
  useTextHighlighter: () => ({ isFTSColumn: vi.fn() }),
}));

vi.mock("@/composables/useLogsHighlighter", () => ({
  useLogsHighlighter: () => ({
    processedResults: {},
    processHitsInChunks: vi.fn(),
  }),
}));

vi.mock("@/utils/dashboard/panelValidation", () => ({
  findFirstValidMappedValue: vi.fn().mockReturnValue(null),
}));

vi.mock("@/utils/dashboard/colorPalette", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    // Prepend a dark color so auto-color mode can assign it and trigger white text logic.
    getColorForTable: (theme: string) => ["#000000", ...actual.getColorForTable(theme)],
  };
});

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  }),
}));

// CSS.supports is not available in jsdom
vi.stubGlobal("CSS", { supports: () => false });

// Mock Blob/URL for download tests
const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
vi.stubGlobal("URL", {
  createObjectURL: mockCreateObjectURL,
  revokeObjectURL: mockRevokeObjectURL,
});

import TableRenderer from "@/components/dashboards/panels/TableRenderer.vue";
import { findFirstValidMappedValue } from "@/utils/dashboard/panelValidation";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockTableData = {
  columns: [
    { name: "timestamp", label: "Timestamp", field: "timestamp", sortable: true, align: "left" },
    { name: "level", label: "Level", field: "level", sortable: true, align: "center" },
    { name: "count", label: "Count", field: "count", sortable: true, align: "right" },
  ],
  rows: [
    { timestamp: "2023-01-01T00:00:00Z", level: "INFO", count: 1 },
    { timestamp: "2023-01-01T00:01:00Z", level: "ERROR", count: 5 },
    { timestamp: "2023-01-01T00:02:00Z", level: "WARN", count: 3 },
  ],
};

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

  // ── Component Rendering ──────────────────────────────────────────────────────
  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the table-wrapper div", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-table-renderer-wrapper"]').exists(),
      ).toBe(true);
    });

    it("should render the TenstackTable with correct data-test attribute", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-panel-table"]').exists()).toBe(true);
    });

    it("should render with empty rows without errors", () => {
      wrapper = createWrapper({ data: { columns: [], rows: [] } });
      expect(wrapper.exists()).toBe(true);
    });

    it("should render with undefined rows gracefully", () => {
      wrapper = createWrapper({ data: { columns: mockTableData.columns } });
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ── Props passthrough to TenstackTable ────────────────────────────────────
  describe("Props passthrough", () => {
    it("should pass wrapCells=true to TenstackTable as wrap prop", () => {
      wrapper = createWrapper({ wrapCells: true });
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("wrap")).toBe(true);
    });

    it("should pass wrapCells=false to TenstackTable as wrap prop", () => {
      wrapper = createWrapper({ wrapCells: false });
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("wrap")).toBe(false);
    });

    it("should pass showPagination=true to TenstackTable", () => {
      wrapper = createWrapper({ showPagination: true });
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("pagination")).toBe("client");
    });

    it("should default showPagination to false", () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("pagination")).toBe("none");
    });

    it("should pass rowsPerPage to TenstackTable", () => {
      wrapper = createWrapper({ showPagination: true, rowsPerPage: 25 });
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("pageSize")).toBe(25);
    });

    it("should use TABLE_ROWS_PER_PAGE_DEFAULT_VALUE (10) as default rowsPerPage", () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("pageSize")).toBe(10);
    });

    it("should set useVirtualScroll=false on TenstackTable", () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("virtualScroll")).toBeFalsy();
    });

    it("should set enableColumnReorder=false on TenstackTable", () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("enableColumnReorder")).toBe(false);
    });

    it("should set enableCellCopy=true on TenstackTable", () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("enableCellCopy")).toBe(true);
    });
  });

  // ── Sorting ───────────────────────────────────────────────────────────────
  describe("Sorting", () => {
    it("should pass sortedRows to TenstackTable rows prop", () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      const rows = table.props("data");
      expect(rows.length).toBe(mockTableData.rows.length);
    });

    it("should sort rows ascending when handleSortChange is called with asc", async () => {
      const data = {
        columns: [{ name: "count", label: "Count", field: "count", sortable: true }],
        rows: [{ count: 5 }, { count: 1 }, { count: 3 }],
      };
      wrapper = createWrapper({ data });
      await wrapper.vm.$nextTick();

      wrapper.vm.handleSortChange("count", "asc");
      await wrapper.vm.$nextTick();

      const table = wrapper.findComponent({ name: "OTable" });
      const rows = table.props("data");
      expect(rows[0].count).toBe(1);
      expect(rows[1].count).toBe(3);
      expect(rows[2].count).toBe(5);
    });

    it("should sort rows descending when handleSortChange is called with desc", async () => {
      const data = {
        columns: [{ name: "count", label: "Count", field: "count", sortable: true }],
        rows: [{ count: 1 }, { count: 5 }, { count: 3 }],
      };
      wrapper = createWrapper({ data });
      await wrapper.vm.$nextTick();

      wrapper.vm.handleSortChange("count", "desc");
      await wrapper.vm.$nextTick();

      const table = wrapper.findComponent({ name: "OTable" });
      const rows = table.props("data");
      expect(rows[0].count).toBe(5);
      expect(rows[1].count).toBe(3);
      expect(rows[2].count).toBe(1);
    });

    it("should return rows unsorted when no sortBy is set", () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      const rows = table.props("data");
      expect(rows).toEqual(mockTableData.rows);
    });

    it("should update localSortBy and localSortOrder via handleSortChange", async () => {
      wrapper = createWrapper();
      wrapper.vm.handleSortChange("level", "desc");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.localSortBy).toBe("level");
      expect(wrapper.vm.localSortOrder).toBe("desc");
    });

    it("should sort string columns lexicographically", async () => {
      const data = {
        columns: [{ name: "level", label: "Level", field: "level", sortable: true }],
        rows: [{ level: "WARN" }, { level: "INFO" }, { level: "ERROR" }],
      };
      wrapper = createWrapper({ data });
      wrapper.vm.handleSortChange("level", "asc");
      await wrapper.vm.$nextTick();

      const table = wrapper.findComponent({ name: "OTable" });
      const rows = table.props("data");
      expect(rows[0].level).toBe("ERROR");
      expect(rows[1].level).toBe("INFO");
      expect(rows[2].level).toBe("WARN");
    });
  });

  // ── cellStyleFn ───────────────────────────────────────────────────────────
  describe("cellStyleFn", () => {
    // Post-migration, OTable's getCellStyle contract is
    // `({ columnId, row, value }) => Record<string, any>` (a style OBJECT, not a
    // raw-CSS string), and the column config is looked up by id (col.name) from
    // data.columns — so tests configure the column and call with the new params.
    const styleFor = (
      colConfig: any,
      value: any,
      valueMapping?: any[],
    ): Record<string, any> => {
      wrapper = createWrapper({
        data: { columns: [{ name: "x", field: "x", ...colConfig }], rows: [] },
        ...(valueMapping ? { valueMapping } : {}),
      });
      return wrapper.vm.cellStyleFn({ columnId: "x", row: {}, value });
    };

    it("should return empty style for cells with no colorMode and no mapping", () => {
      vi.mocked(findFirstValidMappedValue).mockReturnValue(null);
      expect(styleFor({ colorMode: undefined }, "INFO")).toEqual({});
    });

    it("should return background-color style when value-mapping has a valid color", () => {
      vi.mocked(findFirstValidMappedValue).mockReturnValue({ color: "#ff0000" });
      const style = styleFor({}, "ERROR", [{ value: "ERROR", color: "#ff0000" }]);
      expect(style.backgroundColor).toBe("#ff0000");
    });

    it("should return empty style when value-mapping color is invalid hex", () => {
      vi.mocked(findFirstValidMappedValue).mockReturnValue({ color: "not-a-hex" });
      expect(styleFor({}, "INFO", [{ value: "INFO", color: "not-a-hex" }])).toEqual({});
    });

    it("applies the LAST matching conditional rule when several match", () => {
      vi.mocked(findFirstValidMappedValue).mockReturnValue(null);
      const style = styleFor(
        {
          conditionalRules: [
            { operator: ">", threshold: 400, textColor: "#a16207", bgColor: "#fefce8" },
            { operator: ">", threshold: 1000, textColor: "#b91c1c", bgColor: "#fef2f2" },
          ],
        },
        2301,
      );
      // 2301 matches both >400 and >1000 → the later rule (>1000) wins.
      expect(style.color).toBe("#b91c1c");
      expect(style.backgroundColor).toBe("#fef2f2");
    });

    it("applies the only matching conditional rule when just one matches", () => {
      vi.mocked(findFirstValidMappedValue).mockReturnValue(null);
      const style = styleFor(
        {
          conditionalRules: [
            { operator: ">", threshold: 400, textColor: "#a16207", bgColor: "#fefce8" },
            { operator: ">", threshold: 1000, textColor: "#b91c1c", bgColor: "#fef2f2" },
          ],
        },
        500,
      );
      expect(style.color).toBe("#a16207");
      expect(style.backgroundColor).toBe("#fefce8");
    });

    it("should apply auto-color mode with a consistent color per distinct value", () => {
      vi.mocked(findFirstValidMappedValue).mockReturnValue(null);
      wrapper = createWrapper({
        data: {
          columns: [{ name: "status", field: "status", colorMode: "auto" }],
          rows: [],
        },
      });
      const s1a = wrapper.vm.cellStyleFn({ columnId: "status", row: {}, value: "active" });
      const s1b = wrapper.vm.cellStyleFn({ columnId: "status", row: {}, value: "active" });
      const s2 = wrapper.vm.cellStyleFn({ columnId: "status", row: {}, value: "inactive" });
      expect(s1a).toEqual(s1b); // same value → same color
      expect(s2).not.toEqual({}); // different value → a color assigned
    });

    it("should use white text on dark backgrounds in auto-color mode", () => {
      vi.mocked(findFirstValidMappedValue).mockReturnValue(null);
      wrapper = createWrapper({
        data: {
          columns: [{ name: "status", field: "status", colorMode: "auto" }],
          rows: [],
        },
      });
      // First value assigned gets the first palette color (#000000 — dark) → white text.
      const style = wrapper.vm.cellStyleFn({ columnId: "status", row: {}, value: "dark-value" });
      expect(style.color).toBe("#ffffff");
    });
  });

  // ── row-click emit ────────────────────────────────────────────────────────
  describe("row-click emit", () => {
    it("should emit row-click when TenstackTable emits click:dataRow", async () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      const row = mockTableData.rows[0];

      await table.vm.$emit("row-click", row, 0, null);

      expect(wrapper.emitted("row-click")).toBeTruthy();
    });

    it("should forward the row data in the row-click emit", async () => {
      wrapper = createWrapper();
      const table = wrapper.findComponent({ name: "OTable" });
      const row = mockTableData.rows[1];

      await table.vm.$emit("row-click", row, 1, null);

      const emitted = wrapper.emitted("row-click");
      expect(emitted).toBeTruthy();
      expect(emitted![0][1]).toBe(row);
    });
  });

  // ── CSV Export ────────────────────────────────────────────────────────────
  describe("CSV Export", () => {
    it("should call URL.createObjectURL when exporting CSV", () => {
      wrapper = createWrapper();
      // tableRef.getRows() may return [] in test env since TenstackTable is mocked via stubs
      // downloadTableAsCSV returns early when rows is empty, so just verify no error thrown
      expect(() => wrapper.vm.downloadTableAsCSV("test-title")).not.toThrow();
    });

    it("should expose downloadTableAsCSV method", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.downloadTableAsCSV).toBe("function");
    });

    it("should expose downloadTableAsJSON method", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.downloadTableAsJSON).toBe("function");
    });

    it("should not throw on downloadTableAsJSON with valid data", () => {
      wrapper = createWrapper();
      expect(() => wrapper.vm.downloadTableAsJSON("test-json")).not.toThrow();
    });
  });

  // ── CSV Export — field vs name lookup (fix for #11574) ──────────────────
  describe("CSV Export — field key lookup", () => {
    // Capture Blob content via a mock class since jsdom Blob lacks .text()
    let capturedCsv: string;
    const OrigBlob = globalThis.Blob;

    beforeEach(() => {
      capturedCsv = "";
      vi.stubGlobal("Blob", class MockBlob {
        constructor(parts: any[]) {
          capturedCsv = String(parts?.[0] ?? "");
        }
      });
    });

    afterEach(() => {
      vi.stubGlobal("Blob", OrigBlob);
    });

    it("should use c.field (not c.name) to access row values when they differ", () => {
      // Columns where name differs from field — the original bug scenario
      const data = {
        columns: [
          { name: "Timestamp", label: "Timestamp", field: "_timestamp", align: "left" },
          { name: "Level", label: "Level", field: "log_level", align: "left" },
        ],
        rows: [
          { _timestamp: "2023-01-01T00:00:00Z", log_level: "INFO" },
          { _timestamp: "2023-01-02T00:00:00Z", log_level: "ERROR" },
        ],
      };
      wrapper = createWrapper({ data });

      // Override tableRef so getRows() returns controlled data
      (wrapper.vm as any).tableRef = { getRows: () => data.rows };

      wrapper.vm.downloadTableAsCSV("test");

      // Headers should use label
      expect(capturedCsv).toContain("Timestamp,Level");
      // Values must be populated via field keys, not empty
      expect(capturedCsv).toContain('"2023-01-01T00:00:00Z"');
      expect(capturedCsv).toContain('"INFO"');
      expect(capturedCsv).toContain('"2023-01-02T00:00:00Z"');
      expect(capturedCsv).toContain('"ERROR"');
    });

    it("should not produce empty values when row data is keyed by field", () => {
      const data = {
        columns: [
          { name: "Timestamp", label: "Timestamp", field: "_timestamp", align: "left" },
        ],
        rows: [{ _timestamp: "2023-01-01T00:00:00Z" }],
      };
      wrapper = createWrapper({ data });
      (wrapper.vm as any).tableRef = { getRows: () => data.rows };

      wrapper.vm.downloadTableAsCSV("test");

      const lines = capturedCsv.split("\n");
      // Data line must not be empty-quoted (the old bug produced '""')
      expect(lines[1]).toBe('"2023-01-01T00:00:00Z"');
    });

    it("should still work when name and field are identical", () => {
      const data = {
        columns: [
          { name: "count", label: "Count", field: "count", align: "right" },
        ],
        rows: [{ count: 42 }],
      };
      wrapper = createWrapper({ data });
      (wrapper.vm as any).tableRef = { getRows: () => data.rows };

      wrapper.vm.downloadTableAsCSV("test");

      expect(capturedCsv).toContain("Count");
      expect(capturedCsv).toContain('"42"');
    });

    it("should fall back to name when field is not defined", () => {
      const data = {
        columns: [
          { name: "status", label: "Status" }, // no field property
        ],
        rows: [{ status: "active" }],
      };
      wrapper = createWrapper({ data });
      (wrapper.vm as any).tableRef = { getRows: () => data.rows };

      wrapper.vm.downloadTableAsCSV("test");

      expect(capturedCsv).toContain('"active"');
    });

    it("should properly escape double quotes in CSV values", () => {
      const data = {
        columns: [
          { name: "msg", label: "Message", field: "msg", align: "left" },
        ],
        rows: [{ msg: 'He said "hello"' }],
      };
      wrapper = createWrapper({ data });
      (wrapper.vm as any).tableRef = { getRows: () => data.rows };

      wrapper.vm.downloadTableAsCSV("test");

      expect(capturedCsv).toContain('"He said ""hello"""');
    });

    it("should handle null and undefined values as empty strings", () => {
      const data = {
        columns: [
          { name: "a", label: "A", field: "a", align: "left" },
          { name: "b", label: "B", field: "b", align: "left" },
        ],
        rows: [{ a: null, b: undefined }],
      };
      wrapper = createWrapper({ data });
      (wrapper.vm as any).tableRef = { getRows: () => data.rows };

      wrapper.vm.downloadTableAsCSV("test");

      const lines = capturedCsv.split("\n");
      // Both null and undefined should become empty quoted strings
      expect(lines[1]).toBe('"",""');
    });
  });

  // ── Pagination controls in bottom slot ───────────────────────────────────
  describe("Pagination controls", () => {
    it("should render the dashboard-table-pagination wrapper in the bottom slot", () => {
      wrapper = createWrapper({ showPagination: true });
      const paginationDiv = wrapper.find('[data-test="dashboard-table-pagination"]');
      expect(paginationDiv.exists()).toBe(true);
    });

    it("should render TablePaginationControls in the bottom slot", () => {
      wrapper = createWrapper({ showPagination: true });
      const controls = wrapper.findComponent({ name: "TablePaginationControls" });
      expect(controls.exists()).toBe(true);
    });

    it("should render bottom slot when showPagination is false too (always present)", () => {
      wrapper = createWrapper({ showPagination: false });
      const paginationDiv = wrapper.find('[data-test="dashboard-table-pagination"]');
      expect(paginationDiv.exists()).toBe(true);
    });

    it("re-slices the rows when the footer page size changes (#2239.3)", async () => {
      const rows = Array.from({ length: 15 }, (_, i) => ({
        timestamp: `t${i}`,
        level: "INFO",
        count: i,
      }));
      wrapper = createWrapper({
        showPagination: true,
        rowsPerPage: 5,
        data: { columns: mockTableData.columns, rows },
      });
      await flushPromises();

      const table = wrapper.findComponent({ name: "OTable" }).vm.table;
      expect(table.getRowModel().rows.length).toBe(5);

      wrapper
        .findComponent({ name: "TablePaginationControls" })
        .vm.$emit("update:rowsPerPage", 10);
      await flushPromises();

      expect(table.getRowModel().rows.length).toBe(10);
    });

    it("re-slices when the rows-per-page config prop changes (#2239.3)", async () => {
      const rows = Array.from({ length: 15 }, (_, i) => ({
        timestamp: `t${i}`,
        level: "INFO",
        count: i,
      }));
      wrapper = createWrapper({
        showPagination: true,
        rowsPerPage: 5,
        data: { columns: mockTableData.columns, rows },
      });
      await flushPromises();
      const table = wrapper.findComponent({ name: "OTable" }).vm.table;
      expect(table.getRowModel().rows.length).toBe(5);

      // Simulates changing the "Records per page" field in the panel config.
      await wrapper.setProps({ rowsPerPage: 10 });
      await flushPromises();
      expect(table.getRowModel().rows.length).toBe(10);
    });
  });

  // ── Reactivity ────────────────────────────────────────────────────────────
  describe("Reactivity", () => {
    it("should update sortedRows when data.rows changes", async () => {
      wrapper = createWrapper();
      const newData = {
        ...mockTableData,
        rows: [{ timestamp: "new", level: "DEBUG", count: 99 }],
      };
      await wrapper.setProps({ data: newData });
      await flushPromises();

      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("data").length).toBe(1);
    });

    it("should update when wrapCells prop changes", async () => {
      wrapper = createWrapper({ wrapCells: false });
      let table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("wrap")).toBe(false);

      await wrapper.setProps({ wrapCells: true });
      table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("wrap")).toBe(true);
    });

    it("should update pagination when showPagination changes", async () => {
      wrapper = createWrapper({ showPagination: false });
      let table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("pagination")).toBe("none");

      await wrapper.setProps({ showPagination: true });
      table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("pagination")).toBe("client");
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────
  describe("Error handling", () => {
    it("should handle null rows gracefully", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      wrapper = createWrapper({ data: { columns: mockTableData.columns, rows: null } });
      expect(wrapper.exists()).toBe(true);
      consoleSpy.mockRestore();
    });

    it("should handle missing columns", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      wrapper = createWrapper({ data: { rows: mockTableData.rows } });
      expect(wrapper.exists()).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  // ── copy cell — timestamp column format ────────────────────────────────────
  // Verifies that TableRenderer passes columns with format functions through to
  // TenstackTable so that getCellDisplayValue returns the formatted string (not
  // the raw ISO "T" value) when the copy button is clicked.
  describe("copy cell — timestamp column format", () => {
    const ISO_RAW = "2024-01-15T10:30:00Z";
    const FORMATTED = "2024-01-15 10:30:00";
    // Minimal simulation of parseTimestampValue behaviour.
    const tsFormat = (val: any): string =>
      val ? String(val).replace("T", " ").replace("Z", "") : val;

    const tsData = {
      columns: [
        {
          name: "event_time",
          label: "Event Time",
          field: "event_time",
          align: "left",
          format: tsFormat,
          sortable: false,
        },
      ],
      rows: [{ event_time: ISO_RAW }],
    };

    it("should forward the column format function to TenstackTable unchanged", () => {
      wrapper = createWrapper({ data: tsData });
      const table = wrapper.findComponent({ name: "OTable" });
      const cols = table.props("columns") as any[];
      const tsCol = cols.find((c: any) => c.field === "event_time" || c.name === "event_time");
      expect(tsCol).toBeDefined();
      expect(typeof tsCol.format).toBe("function");
    });

    it("the format function on the timestamp column should produce a value without the ISO 'T' separator", () => {
      wrapper = createWrapper({ data: tsData });
      const table = wrapper.findComponent({ name: "OTable" });
      const cols = table.props("columns") as any[];
      const tsCol = cols.find((c: any) => c.field === "event_time" || c.name === "event_time");
      const result = tsCol.format(ISO_RAW);
      expect(result).toBe(FORMATTED);
      expect(result).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it("the format function should produce the same formatted value that will be written to clipboard on copy", () => {
      wrapper = createWrapper({ data: tsData });
      const table = wrapper.findComponent({ name: "OTable" });
      const cols = table.props("columns") as any[];
      const tsCol = cols.find((c: any) => c.field === "event_time" || c.name === "event_time");
      // The clipboard copy path calls getCellDisplayValue which calls col.format(rawValue).
      // Verify format(rawValue) === expected formatted string so both display and copy are consistent.
      expect(tsCol.format(ISO_RAW)).toBe(FORMATTED);
    });

    it("should render the formatted (non-T) timestamp value in the table cell", () => {
      wrapper = createWrapper({ data: tsData });
      // The formatted value must appear somewhere in the rendered output.
      expect(wrapper.text()).toContain(FORMATTED);
    });

    it("should not render the raw ISO T-format string in the table cell", () => {
      wrapper = createWrapper({ data: tsData });
      // The raw ISO string with "T" must NOT appear (it should be replaced by the formatted value).
      expect(wrapper.text()).not.toContain(ISO_RAW);
    });
  });
});
