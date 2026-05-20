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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ErrorsList from "@/components/rum/ErrorsList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock zincutils
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return {
    ...actual,
    formatDuration: vi.fn((duration) => {
      if (duration < 60) return `${duration}s`;
      if (duration < 3600) return `${Math.floor(duration / 60)}m`;
      return `${Math.floor(duration / 3600)}h`;
    }),
    mergeRoutes: vi.fn((route1: any, route2: any) => [
      ...(route1 || []),
      ...(route2 || []),
    ]),
  };
});

vi.mock("@/components/rum/SearchBar.vue", () => ({
  default: {
    name: "SearchBar",
    template: '<div data-test="search-bar">Search Bar</div>',
  },
}));

vi.mock("@/plugins/traces/IndexList.vue", () => ({
  default: {
    name: "IndexList",
    template: '<div data-test="index-list">Index List</div>',
  },
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    template: `
      <div data-test="app-table">
        <div data-test="table-columns" v-if="columns">{{ columns.length }} columns</div>
        <div data-test="table-rows" v-if="data">{{ data.length }} rows</div>
        <slot name="cell-error" :row="{ error: 'Test Error', error_type: 'JavaScript Error' }"></slot>
      </div>
    `,
    props: ["columns", "data"],
  },
}));

vi.mock("@/components/rum/ErrorDetail.vue", () => ({
  default: {
    name: "ErrorDetail",
    template: '<div data-test="error-detail">{{ column.error || "No Error" }}</div>',
    props: ["column"],
  },
}));

describe("ErrorsList", () => {
  let wrapper: any;

  const splitterStub = {
    template: `
      <div data-test="splitter">
        <div data-test="before-section"><slot name="before" /></div>
        <div data-test="separator-section"><slot name="separator" /></div>
        <div data-test="after-section"><slot name="after" /></div>
      </div>
    `,
    props: ["modelValue", "unit", "vertical"],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorsList, {
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: { OSplitter: splitterStub },
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // COMPONENT MOUNTING
  // ==========================================================================

  describe("Component Mounting", () => {
    it("mounts successfully without errors", () => {
      // Arrange & Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders SearchBar component in the layout", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="search-bar"]').exists()).toBe(true);
    });

    it("renders IndexList component in the before slot", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="index-list"]').exists()).toBe(true);
    });

    it("renders OTable component in the after slot", () => {
      // Arrange & Assert
      expect(wrapper.findComponent({ name: "OTable" }).exists()).toBe(true);
    });

    it("renders splitter layout with before, separator and after sections", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="splitter"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="before-section"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="separator-section"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="after-section"]').exists()).toBe(true);
    });

    it("renders the drag grip element in the separator slot", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="errors-list-splitter-drag-grip"]').exists()).toBe(true);
    });
  });

  // ==========================================================================
  // COMPONENT STRUCTURE
  // ==========================================================================

  describe("Component Structure", () => {
    it("renders IndexList inside the before section", () => {
      // Arrange
      const beforeSection = wrapper.find('[data-test="before-section"]');

      // Assert
      expect(beforeSection.find('[data-test="index-list"]').exists()).toBe(true);
    });

    it("renders OTable inside the after section", () => {
      // Arrange
      const afterSection = wrapper.find('[data-test="after-section"]');

      // Assert
      expect(afterSection.findComponent({ name: "OTable" }).exists()).toBe(true);
    });

    it("renders SearchBar component in the component tree", () => {
      // Arrange & Assert
      expect(wrapper.findComponent({ name: "SearchBar" }).exists()).toBe(true);
    });
  });

  // ==========================================================================
  // TABLE COLUMNS CONFIGURATION
  // ==========================================================================

  describe("Columns Configuration", () => {
    it("passes an array of columns to OTable with more than zero columns", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(Array.isArray(oTable.props("columns"))).toBe(true);
      expect(oTable.props("columns").length).toBeGreaterThan(0);
    });

    it("includes an error column with header Error and sortable true", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");

      // Assert
      const errorColumn = columns.find((col: any) => col.id === "error");
      expect(errorColumn).toBeDefined();
      expect(errorColumn.header).toBe("Error");
      expect(errorColumn.sortable).toBe(true);
    });

    it("includes a type column with header Session Type and sortable true", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");

      // Assert
      const typeColumn = columns.find((col: any) => col.id === "type");
      expect(typeColumn).toBeDefined();
      expect(typeColumn.header).toBe("Session Type");
      expect(typeColumn.sortable).toBe(true);
    });

    it("includes a time_spent column with header Time Spent and accessorFn", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");

      // Assert
      const timeSpentColumn = columns.find((col: any) => col.id === "time_spent");
      expect(timeSpentColumn).toBeDefined();
      expect(timeSpentColumn.header).toBe("Time Spent");
      expect(timeSpentColumn.sortable).toBe(true);
      expect(typeof timeSpentColumn.accessorFn).toBe("function");
    });

    it("includes an error_count column with header Error Count and sortable true", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");

      // Assert
      const errorCountColumn = columns.find((col: any) => col.id === "error_count");
      expect(errorCountColumn).toBeDefined();
      expect(errorCountColumn.header).toBe("Error Count");
      expect(errorCountColumn.sortable).toBe(true);
    });

    it("includes an initial_view_name column with header Initial View Name and sortable true", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");

      // Assert
      const initialViewColumn = columns.find((col: any) => col.id === "initial_view_name");
      expect(initialViewColumn).toBeDefined();
      expect(initialViewColumn.header).toBe("Initial View Name");
      expect(initialViewColumn.sortable).toBe(true);
    });

    it("error column has accessorKey set to error", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");
      const errorColumn = columns.find((col: any) => col.id === "error");

      // Assert
      expect(errorColumn.accessorKey).toBe("error");
    });

    it("type column has accessorKey set to type", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");
      const typeColumn = columns.find((col: any) => col.id === "type");

      // Assert
      expect(typeColumn.accessorKey).toBe("type");
    });

    it("time_spent column accessorFn converts 120 seconds of nanoseconds to 2m", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");
      const timeSpentColumn = columns.find((col: any) => col.id === "time_spent");
      const mockRow = { time_spent: "120000000" };

      // Act
      const result = timeSpentColumn.accessorFn(mockRow);

      // Assert
      expect(result).toBe("2m");
    });

    it("error_count column has accessorKey set to error_count", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");
      const errorCountColumn = columns.find((col: any) => col.id === "error_count");

      // Assert
      expect(errorCountColumn.accessorKey).toBe("error_count");
    });

    it("initial_view_name column has accessorKey set to initial_view_name", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");
      const initialViewColumn = columns.find((col: any) => col.id === "initial_view_name");

      // Assert
      expect(initialViewColumn.accessorKey).toBe("initial_view_name");
    });
  });

  // ==========================================================================
  // OTABLE INTEGRATION
  // ==========================================================================

  describe("OTable Integration", () => {
    it("passes an empty array as data to OTable on initial mount", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("data")).toEqual([]);
    });

    it("renders ErrorDetail component inside the error cell slot", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="error-detail"]').exists()).toBe(true);
    });

    it("passes column prop to ErrorDetail component in cell slot", () => {
      // Arrange
      const errorDetail = wrapper.findComponent({ name: "ErrorDetail" });

      // Assert
      expect(errorDetail.exists()).toBe(true);
      expect(errorDetail.props("column")).toBeDefined();
    });

    it("renders correct column count text in OTable when columns are set", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="table-columns"]').text()).toContain("5 columns");
    });

    it("renders zero rows text in OTable when data is empty", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="table-rows"]').text()).toContain("0 rows");
    });
  });

  // ==========================================================================
  // COLUMN FUNCTIONS
  // ==========================================================================

  describe("Column Functions", () => {
    it("time_spent accessorFn does not throw when given invalid value", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");
      const timeSpentColumn = columns.find((col: any) => col.id === "time_spent");
      const invalidRow = { time_spent: "invalid" };

      // Assert
      expect(() => timeSpentColumn.accessorFn(invalidRow)).not.toThrow();
    });
  });

  // ==========================================================================
  // TRANSLATED LABELS
  // ==========================================================================

  describe("Column Label Translation", () => {
    it("renders all expected column headers in correct order", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const columns = oTable.props("columns");

      // Assert
      expect(columns[0].header).toBe("Error");
      expect(columns[1].header).toBe("Session Type");
      expect(columns[2].header).toBe("Time Spent");
      expect(columns[3].header).toBe("Error Count");
      expect(columns[4].header).toBe("Initial View Name");
    });
  });

  // ==========================================================================
  // SLOT RENDERING
  // ==========================================================================

  describe("Slot Rendering", () => {
    it("renders error-detail slot with non-empty content", () => {
      // Arrange
      const errorDetailSlot = wrapper.find('[data-test="error-detail"]');

      // Assert
      expect(errorDetailSlot.exists()).toBe(true);
      expect(errorDetailSlot.text().length).toBeGreaterThan(0);
    });

    it("passes column prop to the slotted ErrorDetail component", () => {
      // Arrange
      const errorDetail = wrapper.findComponent({ name: "ErrorDetail" });

      // Assert
      expect(errorDetail.props()).toHaveProperty("column");
    });
  });

  // ==========================================================================
  // DATA UPDATES
  // ==========================================================================

  describe("Data Updates", () => {
    it("OTable data prop is an empty array on initial mount", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(Array.isArray(oTable.props("data"))).toBe(true);
      expect(oTable.props("data")).toHaveLength(0);
    });

    it("OTable columns prop is a non-empty array on initial mount", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(Array.isArray(oTable.props("columns"))).toBe(true);
      expect(oTable.props("columns").length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // SPLITTER LAYOUT
  // ==========================================================================

  describe("Splitter Layout", () => {
    it("renders IndexList inside the before section", () => {
      // Arrange
      const beforeSection = wrapper.find('[data-test="before-section"]');

      // Assert
      expect(beforeSection.findComponent({ name: "IndexList" }).exists()).toBe(true);
    });

    it("renders OTable inside the after section", () => {
      // Arrange
      const afterSection = wrapper.find('[data-test="after-section"]');

      // Assert
      expect(afterSection.findComponent({ name: "OTable" }).exists()).toBe(true);
    });

    it("renders drag grip element inside the separator slot", () => {
      // Arrange
      const separatorSection = wrapper.find('[data-test="separator-section"]');

      // Assert
      expect(separatorSection.find('[data-test="errors-list-splitter-drag-grip"]').exists()).toBe(true);
    });
  });
});
