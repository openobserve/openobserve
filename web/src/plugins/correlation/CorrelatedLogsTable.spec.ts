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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import CorrelatedLogsTable from "./CorrelatedLogsTable.vue";
import store from "@/test/unit/helpers/store";
import rootStore from "@/stores";
import { nextTick } from "vue";

// Mock the useCorrelatedLogs composable
vi.mock("@/composables/useCorrelatedLogs", () => ({
  useCorrelatedLogs: vi.fn(() => ({
    loading: { value: false },
    error: { value: null },
    searchResults: { value: [] },
    totalHits: { value: 0 },
    took: { value: 0 },
    currentFilters: { value: {} },
    currentTimeRange: { value: { startTime: 0, endTime: 0 } },
    primaryStream: undefined,
    logStreamsCount: { value: 1 },
    hasResults: { value: false },
    isLoading: { value: false },
    hasError: { value: false },
    isEmpty: { value: true },
    fetchCorrelatedLogs: vi.fn(),
    updateFilter: vi.fn(),
    updateFilters: vi.fn(),
    refresh: vi.fn(),
    isMatchedDimension: vi.fn(() => false),
    isAdditionalDimension: vi.fn(() => false),
  })),
}));

// Mock useServiceCorrelation composable
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: vi.fn(() => ({
    loadKeyFields: vi.fn().mockResolvedValue({}),
  })),
  clearSemanticGroupsCaches: vi.fn(),
  getSemanticGroupsCacheStatus: vi.fn(),
}));

// Mock OTable
vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    template: "<div data-test='tenstack-table'><slot /></div>",
  },
}));

// Mock DimensionFiltersBar component
vi.mock("./DimensionFiltersBar.vue", () => ({
  default: {
    name: "DimensionFiltersBar",
    template: "<div data-test='dimension-filters-bar'><slot /></div>",
  },
}));

const mockTranslations = {
  "search.timestamp": "Timestamp",
  "search.source": "Source",
  "search.showHideColumns": "Show/Hide Columns",
  "correlation.logs.filtersLabel": "Filters",
  "correlation.logs.unstableDimension": "Unstable Dimension",
  "correlation.logs.allValues": "All Values",
  "common.apply": "Apply",
};

const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: {
    en: mockTranslations,
  },
});

describe("CorrelatedLogsTable.vue", () => {
  let wrapper: any;

  const defaultProps = {
    matchedDimensions: { service: "api" },
    additionalDimensions: { region: "us-west" },
    logStreams: [{ name: "test-stream", stream_type: "logs" }],
    sourceStream: "logs",
    sourceType: "logs",
    timeRange: {
      startTime: Date.now() - 3600000,
      endTime: Date.now(),
    },
  };

  const createWrapper = (props = {}, options = {}) => {
    return mount(CorrelatedLogsTable, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          OTable: true,
          DimensionFiltersBar: true,
          // Render ODropdown inline so data-test attrs are findable in tests
          ODropdown: {
            name: "ODropdown",
            template:
              '<div class="o-dropdown-stub" v-bind="$attrs"><slot name="trigger" /><slot /></div>',
            emits: ["update:open"],
            props: ["open", "side", "align", "sideOffset"],
          },
          ODropdownItem: {
            name: "ODropdownItem",
            template:
              '<div class="o-dropdown-item-stub" v-bind="$attrs" @click="$emit(\'select\')"><slot /></div>',
            emits: ["select"],
          },
        },
      },
      ...options,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Column Visibility Management", () => {
    it("should initialize visible columns with only timestamp by default", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: {
          value: [{ _timestamp: 1234567890, field1: "value1", field2: "value2" }],
        },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      await nextTick();
      await flushPromises();

      // Initially only timestamp should be visible (key fields mock returns empty)
      expect(wrapper.vm.visibleColumns.has("_timestamp")).toBe(true);
      expect(wrapper.vm.visibleColumns.size).toBe(1);
    });

    it("should include key fields in default columns when they match available fields", async () => {
      // Mock loadKeyFields to return matching key fields for logs
      const mockUseSC = await import("@/composables/useServiceCorrelation");
      vi.mocked(mockUseSC.useServiceCorrelation).mockReturnValue({
        loadKeyFields: vi.fn().mockResolvedValue({
          logs: { fields: ["field1"], groups: [] },
        }),
        clearSemanticGroupsCaches: vi.fn(),
        getSemanticGroupsCacheStatus: vi.fn(),
      } as any);

      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: {
          value: [{ _timestamp: 1234567890, field1: "value1", field2: "value2" }],
        },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      await nextTick();
      await flushPromises();

      expect(wrapper.vm.visibleColumns.has("_timestamp")).toBe(true);
      expect(wrapper.vm.visibleColumns.has("field1")).toBe(true);
      expect(wrapper.vm.visibleColumns.size).toBe(2);
    });

    it("should fall back to source column when no key fields match available fields", async () => {
      // Mock loadKeyFields to return key fields that don't exist in data
      const mockUseSC = await import("@/composables/useServiceCorrelation");
      vi.mocked(mockUseSC.useServiceCorrelation).mockReturnValue({
        loadKeyFields: vi.fn().mockResolvedValue({
          logs: { fields: ["nonexistent_field"], groups: [] },
        }),
        clearSemanticGroupsCaches: vi.fn(),
        getSemanticGroupsCacheStatus: vi.fn(),
      } as any);

      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: {
          value: [{ _timestamp: 1234567890, field1: "value1" }],
        },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      await nextTick();
      await flushPromises();

      // Should only have _timestamp (fallback to source column behavior)
      expect(wrapper.vm.visibleColumns.has("_timestamp")).toBe(true);
      expect(wrapper.vm.visibleColumns.has("field1")).toBe(false);
      expect(wrapper.vm.visibleColumns.size).toBe(1);
    });

    it("should not override user-customized columns when key fields load", async () => {
      const mockUseSC = await import("@/composables/useServiceCorrelation");
      vi.mocked(mockUseSC.useServiceCorrelation).mockReturnValue({
        loadKeyFields: vi.fn().mockResolvedValue({
          logs: { fields: ["field1"], groups: [] },
        }),
        clearSemanticGroupsCaches: vi.fn(),
        getSemanticGroupsCacheStatus: vi.fn(),
      } as any);

      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: {
          value: [{ _timestamp: 123, field1: "a", field2: "b" }],
        },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      // Simulate user having previously customized columns (e.g., from localStorage)
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field2"]);
      await nextTick();
      await flushPromises();

      // Should respect user's customization (field2), not replace with key fields (field1)
      expect(wrapper.vm.visibleColumns.has("_timestamp")).toBe(true);
      expect(wrapper.vm.visibleColumns.has("field2")).toBe(true);
      expect(wrapper.vm.visibleColumns.has("field1")).toBe(false);
    });

    it("should toggle column visibility when toggleColumnVisibility is called", async () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field1"]);

      // Toggle field1 off
      wrapper.vm.toggleColumnVisibility("field1");
      await nextTick();
      expect(wrapper.vm.visibleColumns.has("field1")).toBe(false);

      // Toggle field1 back on
      wrapper.vm.toggleColumnVisibility("field1");
      await nextTick();
      expect(wrapper.vm.visibleColumns.has("field1")).toBe(true);
    });

    it("should not allow hiding timestamp column", async () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      wrapper.vm.toggleColumnVisibility("_timestamp");
      await nextTick();

      // Timestamp should still be visible
      expect(wrapper.vm.visibleColumns.has("_timestamp")).toBe(true);
    });
  });

  describe("Source Column Display", () => {
    it("should show source column when only timestamp is visible", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      const columns = wrapper.vm.tableColumns;
      const sourceColumn = columns.find((col: any) => col.id === "source");

      expect(sourceColumn).toBeDefined();
      expect(sourceColumn.header).toBe("_source");
    });

    it("should not show source column when other fields are visible", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field1"]);

      const columns = wrapper.vm.tableColumns;
      const sourceColumn = columns.find((col: any) => col.id === "source");

      expect(sourceColumn).toBeUndefined();
    });
  });

  describe("Add Field to Table", () => {
    it("should add field to visible columns when handleAddFieldToTable is called", async () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      wrapper.vm.handleAddFieldToTable("newField");
      await nextTick();

      expect(wrapper.vm.visibleColumns.has("newField")).toBe(true);
    });

    it("should show info notification when field already exists", async () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "existingField"]);

      wrapper.vm.handleAddFieldToTable("existingField");
      await nextTick();

      // Field should still be there (not duplicated)
      expect(wrapper.vm.visibleColumns.has("existingField")).toBe(true);
      expect(wrapper.vm.visibleColumns.size).toBe(2);
    });
  });

  describe("Close Column", () => {
    it("should remove column from visible columns when handleCloseColumn is called", async () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field1", "field2"]);

      wrapper.vm.handleCloseColumn({ id: "field1" });
      await nextTick();

      expect(wrapper.vm.visibleColumns.has("field1")).toBe(false);
      expect(wrapper.vm.visibleColumns.has("field2")).toBe(true);
    });

    it("should handle column definition with name property", async () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field1"]);

      wrapper.vm.handleCloseColumn({ name: "field1" });
      await nextTick();

      expect(wrapper.vm.visibleColumns.has("field1")).toBe(false);
    });
  });

  describe("Table Columns Generation", () => {
    it("should generate timestamp column with correct properties", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      const columns = wrapper.vm.tableColumns;
      const timestampColumn = columns.find((col: any) => col.id === "_timestamp");

      expect(timestampColumn).toBeDefined();
      expect(timestampColumn.sortable).toBe(true);
      expect(timestampColumn.enableResizing).toBe(false);
      expect(timestampColumn.meta.closable).toBe(false);
    });
  });

  describe("Dimension Filters", () => {
    it("should call updateFilters when handleApplyFilters is called", async () => {
      const mockUpdateFilters = vi.fn();
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        updateFilters: mockUpdateFilters,
      });

      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { service: "api", region: "us-west" };

      wrapper.vm.handleApplyFilters();
      await nextTick();

      expect(mockUpdateFilters).toHaveBeenCalledWith({
        service: "api",
        region: "us-west",
      });
    });
  });

  describe("Row Expansion", () => {
    it("should expand row when handleExpandRow is called for collapsed row", async () => {
      wrapper = createWrapper();
      const row = { _timestamp: 123, field: "value" };

      wrapper.vm.handleExpandRow(row);
      await nextTick();

      expect(wrapper.vm.expandedRows.length).toBe(1);
      expect(wrapper.vm.expandedRows[0]).toStrictEqual(row);
    });

    it("should collapse row when handleExpandRow is called for expanded row", async () => {
      wrapper = createWrapper();
      const row = { _timestamp: 123, field: "value" };
      wrapper.vm.expandedRows = [row];

      wrapper.vm.handleExpandRow(row);
      await nextTick();

      expect(wrapper.vm.expandedRows).not.toContain(row);
    });
  });

  describe("Computed Properties", () => {
    it("should compute availableFields from search results", async () => {
      const mockResults = [
        { _timestamp: 123, field1: "a", field2: "b" },
        { _timestamp: 456, field1: "c", field3: "d" },
      ];

      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: { value: mockResults },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      await nextTick();

      const fields = wrapper.vm.availableFields;
      expect(fields).toContain("_timestamp");
      expect(fields).toContain("field1");
      expect(fields).toContain("field2");
      expect(fields).toContain("field3");
    });

    it("keeps _timestamp selected after selecting all and deselecting all fields", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: {
          value: [{ _timestamp: 123, field1: "a", field2: "b" }],
        },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      await nextTick();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      wrapper.vm.toggleSelectAll();
      await nextTick();
      expect([...wrapper.vm.visibleColumns].sort()).toEqual(["_timestamp", "field1", "field2"]);

      wrapper.vm.toggleSelectAll();
      await nextTick();
      expect([...wrapper.vm.visibleColumns]).toEqual(["_timestamp"]);
    });
  });

  describe("hasPendingChanges computed", () => {
    it("should be false when pendingFilters matches currentFilters", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        currentFilters: { value: { service: "api" } },
      });

      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { service: "api" };
      await nextTick();

      expect(wrapper.vm.hasPendingChanges).toBe(false);
    });

    it("should be true when pendingFilters differs from currentFilters", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        currentFilters: { value: { service: "api" } },
      });

      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { service: "new-api" };
      await nextTick();

      expect(wrapper.vm.hasPendingChanges).toBe(true);
    });
  });

  describe("highlightQuery computed", () => {
    it("should exclude SELECT_ALL_VALUE (*) from highlight query", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        currentFilters: { value: { service: "_o2_all_", region: "us-west" } },
      });

      wrapper = createWrapper();
      await nextTick();

      const query = wrapper.vm.highlightQuery;
      // service = SELECT_ALL_VALUE should be excluded
      expect(query).not.toContain("service");
    });

    it("should exclude fields starting with underscore from highlight query", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        currentFilters: { value: { _timestamp: "12345", service: "api" } },
      });

      wrapper = createWrapper();
      await nextTick();

      const query = wrapper.vm.highlightQuery;
      expect(query).not.toContain("_timestamp");
    });

    it("should return empty string when all filters are wildcards", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        currentFilters: { value: { service: "_o2_all_" } },
      });

      wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.highlightQuery).toBe("");
    });
  });

  describe("getFilterOptions", () => {
    it("should always include wildcard option", () => {
      wrapper = createWrapper();
      const options = wrapper.vm.getFilterOptions("service", "api");
      expect(options.some((o: any) => o.value === "_o2_all_")).toBe(true);
    });

    it("should include original matched dimension value", () => {
      wrapper = createWrapper({
        matchedDimensions: { service: "api" },
      });
      const options = wrapper.vm.getFilterOptions("service", "api");
      expect(options.some((o: any) => o.value === "api")).toBe(true);
    });

    it("should include current value when different from original", () => {
      wrapper = createWrapper({
        matchedDimensions: { service: "api" },
      });
      const options = wrapper.vm.getFilterOptions("service", "different-api");
      expect(options.some((o: any) => o.value === "different-api")).toBe(true);
    });

    it("should not duplicate values in options", () => {
      wrapper = createWrapper({
        matchedDimensions: { service: "api" },
      });
      const options = wrapper.vm.getFilterOptions("service", "api");
      const values = options.map((o: any) => o.value);
      const uniqueValues = new Set(values);
      expect(values.length).toBe(uniqueValues.size);
    });
  });

  describe("Drag and Drop Column Reordering", () => {
    it("should reorder columns when handleDrop is called", async () => {
      wrapper = createWrapper();
      wrapper.vm.columnOrder = ["_timestamp", "field1", "field2", "field3"];
      wrapper.vm.draggedIndex = 1; // dragging "field1"

      const mockEvent = { preventDefault: vi.fn() } as unknown as DragEvent;
      wrapper.vm.handleDrop(mockEvent, 3); // dropping at index 3
      await nextTick();

      expect(wrapper.vm.columnOrder).toEqual(["_timestamp", "field2", "field3", "field1"]);
    });

    it("should not reorder when draggedIndex is null", async () => {
      wrapper = createWrapper();
      wrapper.vm.columnOrder = ["_timestamp", "field1"];
      wrapper.vm.draggedIndex = null;

      const mockEvent = { preventDefault: vi.fn() } as unknown as DragEvent;
      wrapper.vm.handleDrop(mockEvent, 0);
      await nextTick();

      expect(wrapper.vm.columnOrder).toEqual(["_timestamp", "field1"]);
    });
  });

  describe("Wrap Button", () => {
    it("should toggle wrapTableCells when wrap button is clicked", async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.wrapTableCells).toBe(false);

      // Trigger click directly on the element found by data-test
      const btn = wrapper.find('[data-test="correlated-logs-table-wrap-content-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      await nextTick();

      expect(wrapper.vm.wrapTableCells).toBe(true);
    });
  });

  describe("columnMaxCap computed", () => {
    it("should use the two-column branch when visibleFields has only the timestamp entry", async () => {
      // When visibleFields has only 1 entry (_timestamp), totalCols = 1 + 1 = 2 → no -30
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: { value: [{ _timestamp: 1, fieldA: "x" }] },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      await nextTick();

      // Only timestamp visible → visibleFields = ["_timestamp"], length = 1, totalCols = 2
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);
      await nextTick();

      expect(wrapper.vm.columnMaxCap).toBe(wrapper.vm.containerWidth - 225);
    });

    it("should subtract extra 30px when three or more columns are visible", async () => {
      // visibleFields includes _timestamp + fieldA + fieldB → length 3, totalCols = 4 → -30 branch
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: { value: [{ _timestamp: 1, fieldA: "x", fieldB: "y" }] },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      await nextTick();

      wrapper.vm.visibleColumns = new Set(["_timestamp", "fieldA", "fieldB"]);
      await nextTick();

      expect(wrapper.vm.columnMaxCap).toBe(wrapper.vm.containerWidth - 225 - 30);
    });
  });

  describe("severity spine and the inference kill switch (F3)", () => {
    afterEach(() => {
      rootStore.commit("setConfig", {});
    });

    const statusColorFn = (w: any) => {
      const table = w.findComponent({ name: "OTable" });
      return (table.vm.$attrs["get-row-status-color"] ?? table.vm.$attrs.getRowStatusColor) as (
        row: any,
      ) => string;
    };

    it("paints no inferred spine when /config disables inference before any Logs mount", () => {
      rootStore.commit("setConfig", { ui_logs_severity_inference: false });
      wrapper = createWrapper();
      const colour = statusColorFn(wrapper);
      expect(colour({ message: "[ERROR] x" })).toBe("transparent");
      expect(colour({ level: "error" })).toBe("var(--color-log-severity-error-indicator)");
    });

    it("infers a solid spine when the flag is absent", () => {
      rootStore.commit("setConfig", {});
      wrapper = createWrapper();
      expect(statusColorFn(wrapper)({ message: "[WARN] y" })).toBe(
        "var(--color-log-severity-warning-indicator)",
      );
    });
  });
});
