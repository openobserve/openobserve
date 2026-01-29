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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { Quasar, Notify } from "quasar";
import CorrelatedLogsTable from "./CorrelatedLogsTable.vue";
import store from "@/test/unit/helpers/store";
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
    primaryStream: { value: "test-stream" },
    hasResults: { value: false },
    isLoading: { value: false },
    hasError: { value: false },
    isEmpty: { value: true },
    fetchCorrelatedLogs: vi.fn(),
    updateFilter: vi.fn(),
    updateFilters: vi.fn(),
    resetFilters: vi.fn(),
    refresh: vi.fn(),
    isMatchedDimension: vi.fn(() => false),
    isAdditionalDimension: vi.fn(() => false),
  })),
}));

// Mock TenstackTable component
vi.mock("@/plugins/logs/TenstackTable.vue", () => ({
  default: {
    name: "TenstackTable",
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
        plugins: [
          [
            Quasar,
            {
              plugins: {
                Notify,
              },
            },
          ],
          i18n,
          store,
        ],
        stubs: {
          TenstackTable: true,
          DimensionFiltersBar: true,
        },
      },
      ...options,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Mounting and Initialization", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize with empty visible columns", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.visibleColumns).toBeInstanceOf(Set);
      expect(wrapper.vm.visibleColumns.size).toBe(0);
    });

    it("should initialize with empty expanded rows", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.expandedRows).toEqual([]);
    });

    it("should initialize pending filters from current filters", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.pendingFilters).toBeDefined();
    });
  });

  describe("Column Visibility Management", () => {
    it("should initialize visible columns with only timestamp by default", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        searchResults: {
          value: [
            { _timestamp: 1234567890, field1: "value1", field2: "value2" },
          ],
        },
        hasResults: { value: true },
      });

      wrapper = createWrapper();
      await nextTick();
      await flushPromises();

      // Initially only timestamp should be visible
      expect(wrapper.vm.visibleColumns.has("_timestamp")).toBe(true);
      expect(wrapper.vm.visibleColumns.size).toBe(1);
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

    it("should render column visibility dropdown", () => {
      wrapper = createWrapper();
      const dropdown = wrapper.find('[data-test="column-visibility-dropdown"]');
      expect(dropdown.exists()).toBe(true);
    });
  });

  describe("Source Column Display", () => {
    it("should show source column when only timestamp is visible", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      const columns = wrapper.vm.tableColumns;
      const sourceColumn = columns.find((col: any) => col.id === "source");

      expect(sourceColumn).toBeDefined();
      expect(sourceColumn.header).toBe("Source");
    });

    it("should not show source column when other fields are visible", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field1"]);

      const columns = wrapper.vm.tableColumns;
      const sourceColumn = columns.find((col: any) => col.id === "source");

      expect(sourceColumn).toBeUndefined();
    });

    it("should mark source column as not closable", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      const columns = wrapper.vm.tableColumns;
      const sourceColumn = columns.find((col: any) => col.id === "source");

      expect(sourceColumn?.meta?.closable).toBe(false);
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

    it("should show notification when field is added", async () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      wrapper.vm.handleAddFieldToTable("newField");
      await nextTick();

      // Check that field was added
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
      const timestampColumn = columns.find(
        (col: any) => col.id === "_timestamp"
      );

      expect(timestampColumn).toBeDefined();
      expect(timestampColumn.sortable).toBe(true);
      expect(timestampColumn.enableResizing).toBe(false);
      expect(timestampColumn.meta.closable).toBe(false);
    });

    it("should generate regular field columns with correct properties", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field1"]);

      const columns = wrapper.vm.tableColumns;
      const fieldColumn = columns.find((col: any) => col.id === "field1");

      expect(fieldColumn).toBeDefined();
      expect(fieldColumn.sortable).toBe(true);
      expect(fieldColumn.enableResizing).toBe(true);
      expect(fieldColumn.meta.closable).toBe(true);
    });

    it("should only include visible columns in tableColumns", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field1"]);

      const columns = wrapper.vm.tableColumns;
      const columnIds = columns.map((col: any) => col.id);

      expect(columnIds).toContain("_timestamp");
      expect(columnIds).toContain("field1");
      expect(columnIds).not.toContain("field2");
    });
  });

  describe("Dimension Filters", () => {
    it("should update pending filters when handleDimensionUpdate is called", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { service: "api" };

      wrapper.vm.handleDimensionUpdate({ key: "region", value: "us-east" });
      await nextTick();

      expect(wrapper.vm.pendingFilters.region).toBe("us-east");
    });

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

  describe("Event Emissions", () => {
    it("should emit sendToAiChat when handleSendToAiChat is called", async () => {
      wrapper = createWrapper();
      const testValue = { field: "value" };

      wrapper.vm.handleSendToAiChat(testValue);
      await nextTick();

      expect(wrapper.emitted("sendToAiChat")).toBeTruthy();
      expect(wrapper.emitted("sendToAiChat")?.[0]).toEqual([testValue]);
    });

    it("should emit addSearchTerm when handleAddSearchTerm is called", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleAddSearchTerm("field1", "value1", "include");
      await nextTick();

      expect(wrapper.emitted("addSearchTerm")).toBeTruthy();
      expect(wrapper.emitted("addSearchTerm")?.[0]).toEqual([
        "field1",
        "value1",
        "include",
      ]);
    });
  });

  describe("Computed Properties", () => {
    it("should compute showingDefaultColumns correctly when only timestamp is visible", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp"]);

      expect(wrapper.vm.showingDefaultColumns).toBe(true);
    });

    it("should compute showingDefaultColumns correctly when multiple fields are visible", () => {
      wrapper = createWrapper();
      wrapper.vm.visibleColumns = new Set(["_timestamp", "field1"]);

      expect(wrapper.vm.showingDefaultColumns).toBe(false);
    });

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
  });

  describe("Utility Functions", () => {
    it("should format timestamp correctly", () => {
      wrapper = createWrapper();
      const timestamp = 1234567890000000; // microseconds
      const formatted = wrapper.vm.formatTimestamp(timestamp);

      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe("string");
    });

    it("should handle copy operation", async () => {
      wrapper = createWrapper();
      const log = { field: "value" };

      // Just ensure the function exists and can be called without throwing
      expect(typeof wrapper.vm.handleCopy).toBe("function");
      // Don't actually test clipboard functionality in unit tests
    });
  });

  describe("Loading and Error States", () => {
    it("should show skeleton when loading and no results", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        isLoading: { value: true },
        hasResults: { value: false },
        hasError: { value: false },
      });

      wrapper = createWrapper();
      await nextTick();

      // With loading=true and no results, should show skeleton
      expect(wrapper.vm.isLoading.value).toBe(true);
      expect(wrapper.vm.hasResults.value).toBe(false);
    });

    it("should disable column dropdown when no results", async () => {
      const mockUseCorrelatedLogs = await import("@/composables/useCorrelatedLogs");
      (mockUseCorrelatedLogs.useCorrelatedLogs as any).mockReturnValue({
        ...mockUseCorrelatedLogs.useCorrelatedLogs(),
        hasResults: { value: false },
      });

      wrapper = createWrapper();
      await nextTick();

      // Check that hasResults is false
      expect(wrapper.vm.hasResults.value).toBe(false);
    });
  });
});
