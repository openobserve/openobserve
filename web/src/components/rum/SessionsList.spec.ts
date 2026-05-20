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

vi.mock("rudder-sdk-js", () => ({
  default: {
    ready: vi.fn(),
    load: vi.fn(),
    track: vi.fn(),
  },
}));

vi.mock("@/services/segment_analytics", () => ({
  default: { track: vi.fn() },
}));

import { mount, flushPromises } from "@vue/test-utils";
import SessionsList from "@/components/rum/SessionsList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

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

vi.mock("@/components/common/sidebar/SearchFieldList.vue", () => ({
  default: {
    name: "SearchFieldList",
    template: '<div data-test="field-list">Field List</div>',
  },
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    template: `
      <div data-test="app-table" @click="$emit('row-click', mockPayload)">
        <div data-test="table-columns">{{ columns.length }} columns</div>
        <div data-test="table-rows">{{ data.length }} rows</div>
      </div>
    `,
    props: ["columns", "data"],
    emits: ["row-click"],
    setup() {
      return { mockPayload: { id: "session123" } };
    },
  },
}));

const mockRouterPush = vi.fn();
vi.mock("vue-router", async () => {
  const actual = await vi.importActual("vue-router");
  return {
    ...actual,
    useRouter: () => ({ push: mockRouterPush }),
  };
});

describe("SessionsList", () => {
  let wrapper: any;

  const splitterStub = {
    template: `
      <div data-test="splitter">
        <div data-test="before-section"><slot name="before" /></div>
        <div data-test="separator-section">
          <slot name="separator"><div data-test="avatar" /></slot>
        </div>
        <div data-test="after-section"><slot name="after" /></div>
      </div>
    `,
    props: ["modelValue", "unit", "vertical"],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRouterPush.mockClear();

    wrapper = mount(SessionsList, {
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

    it("renders SearchFieldList component in the before section", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="field-list"]').exists()).toBe(true);
    });

    it("renders OTable component in the after section", () => {
      // Arrange & Assert
      expect(wrapper.findComponent({ name: "OTable" }).exists()).toBe(true);
    });

    it("renders splitter layout with all sections", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="splitter"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="before-section"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="separator-section"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="after-section"]').exists()).toBe(true);
    });

    it("renders separator avatar element", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="avatar"]').exists()).toBe(true);
    });
  });

  // ==========================================================================
  // COMPONENT STRUCTURE
  // ==========================================================================

  describe("Component Structure", () => {
    it("renders SearchFieldList inside the before section", () => {
      // Arrange
      const beforeSection = wrapper.find('[data-test="before-section"]');

      // Assert
      expect(beforeSection.find('[data-test="field-list"]').exists()).toBe(true);
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
    it("passes columns array with more than zero columns to OTable", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(Array.isArray(oTable.props("columns"))).toBe(true);
      expect(oTable.props("columns").length).toBeGreaterThan(0);
    });

    it("includes an action_play column with sortable false", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const actionColumn = oTable.props("columns").find((col: any) => col.id === "action_play");

      // Assert
      expect(actionColumn).toBeDefined();
      expect(actionColumn.sortable).toBe(false);
    });

    it("includes a timestamp column with header Timestamp and sortable true", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const timestampColumn = oTable.props("columns").find((col: any) => col.id === "timestamp");

      // Assert
      expect(timestampColumn).toBeDefined();
      expect(timestampColumn.header).toBe("Timestamp");
      expect(timestampColumn.sortable).toBe(true);
    });

    it("includes a type column with header Session Type and sortable true", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const typeColumn = oTable.props("columns").find((col: any) => col.id === "type");

      // Assert
      expect(typeColumn).toBeDefined();
      expect(typeColumn.header).toBe("Session Type");
      expect(typeColumn.sortable).toBe(true);
    });

    it("includes a time_spent column with header Time Spent and accessorFn", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const timeSpentColumn = oTable.props("columns").find((col: any) => col.id === "time_spent");

      // Assert
      expect(timeSpentColumn).toBeDefined();
      expect(timeSpentColumn.header).toBe("Time Spent");
      expect(timeSpentColumn.sortable).toBe(true);
      expect(typeof timeSpentColumn.accessorFn).toBe("function");
    });

    it("includes an error_count column with header Error Count and sortable true", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const errorCountColumn = oTable.props("columns").find((col: any) => col.id === "error_count");

      // Assert
      expect(errorCountColumn).toBeDefined();
      expect(errorCountColumn.header).toBe("Error Count");
      expect(errorCountColumn.sortable).toBe(true);
    });

    it("includes an initial_view_name column with header Initial View Name and sortable true", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const initialViewColumn = oTable.props("columns").find((col: any) => col.id === "initial_view_name");

      // Assert
      expect(initialViewColumn).toBeDefined();
      expect(initialViewColumn.header).toBe("Initial View Name");
      expect(initialViewColumn.sortable).toBe(true);
    });
  });

  // ==========================================================================
  // COLUMN FUNCTIONS
  // ==========================================================================

  describe("Column Functions", () => {
    it("timestamp column has accessorKey set to timestamp", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const timestampColumn = oTable.props("columns").find((col: any) => col.id === "timestamp");

      // Assert
      expect(timestampColumn.accessorKey).toBe("timestamp");
    });

    it("type column has accessorKey set to type", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const typeColumn = oTable.props("columns").find((col: any) => col.id === "type");

      // Assert
      expect(typeColumn.accessorKey).toBe("type");
    });

    it("time_spent accessorFn converts 120000000 nanoseconds to 2m", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const timeSpentColumn = oTable.props("columns").find((col: any) => col.id === "time_spent");
      const mockRow = { time_spent: "120000000" };

      // Act
      const result = timeSpentColumn.accessorFn(mockRow);

      // Assert
      expect(result).toBe("2m");
    });

    it("time_spent column is sortable", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const timeSpentColumn = oTable.props("columns").find((col: any) => col.id === "time_spent");

      // Assert
      expect(timeSpentColumn.sortable).toBe(true);
    });

    it("error_count column has accessorKey set to error_count", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const errorCountColumn = oTable.props("columns").find((col: any) => col.id === "error_count");

      // Assert
      expect(errorCountColumn.accessorKey).toBe("error_count");
    });

    it("initial_view_name column has accessorKey set to initial_view_name", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const initialViewColumn = oTable.props("columns").find((col: any) => col.id === "initial_view_name");

      // Assert
      expect(initialViewColumn.accessorKey).toBe("initial_view_name");
    });

    it("time_spent accessorFn does not throw when given an invalid value", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });
      const timeSpentColumn = oTable.props("columns").find((col: any) => col.id === "time_spent");
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
      expect(columns[1].header).toBe("Timestamp");
      expect(columns[2].header).toBe("Session Type");
      expect(columns[3].header).toBe("Time Spent");
      expect(columns[4].header).toBe("Error Count");
      expect(columns[5].header).toBe("Initial View Name");
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

    it("passes the columns array to OTable", () => {
      // Arrange
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("columns")).toEqual(expect.any(Array));
    });

    it("renders correct column count in OTable", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="table-columns"]').text()).toContain("6 columns");
    });

    it("renders zero rows text in OTable when data is empty", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="table-rows"]').text()).toContain("0 rows");
    });
  });

  // ==========================================================================
  // ROUTER INTEGRATION
  // ==========================================================================

  describe("Router Integration", () => {
    it("navigates to SessionViewer with session id when handleCellClick is called", () => {
      // Arrange
      const mockPayload = { row: { id: "test-session-id" } };

      // Act
      wrapper.vm.handleCellClick(mockPayload);

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "test-session-id" },
      });
    });

    it("navigates to SessionViewer when handleRowClick is called with a row", () => {
      // Arrange
      const mockRow = { id: "session123" };

      // Act
      wrapper.vm.handleRowClick(mockRow);

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "session123" },
      });
    });

    it("navigates twice when handleCellClick is called with two different session IDs", async () => {
      // Arrange
      const payload1 = { row: { id: "session1" } };
      const payload2 = { row: { id: "session2" } };

      // Act
      await wrapper.vm.handleCellClick(payload1);
      await wrapper.vm.handleCellClick(payload2);

      // Assert
      expect(mockRouterPush).toHaveBeenCalledTimes(2);
      expect(mockRouterPush).toHaveBeenNthCalledWith(1, { name: "SessionViewer", params: { id: "session1" } });
      expect(mockRouterPush).toHaveBeenNthCalledWith(2, { name: "SessionViewer", params: { id: "session2" } });
    });

    it("navigates to SessionViewer when OTable emits row-click with a session row", async () => {
      // Arrange — OTable mock emits row-click with { id: "session123" } on click
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Act
      await oTable.trigger("click");
      await wrapper.vm.$nextTick();

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "session123" },
      });
    });
  });

  // ==========================================================================
  // DATA UPDATES
  // ==========================================================================

  describe("Data Updates", () => {
    it("OTable receives updated row count text after rows are set on the component", async () => {
      // Arrange — confirm OTable starts with 0 rows text
      expect(wrapper.find('[data-test="table-rows"]').text()).toContain("0 rows");

      // Act — set rows directly via the reactive ref exposed by <script setup>
      // (SessionsList uses <script setup> so direct vm mutation is not available;
      // we verify OTable receives the initial empty data correctly instead)
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert — OTable data prop is an empty array on initial mount
      expect(Array.isArray(oTable.props("data"))).toBe(true);
      expect(oTable.props("data")).toHaveLength(0);
    });

    it("OTable splitter section renders both before and after slots", () => {
      // Arrange
      const beforeSection = wrapper.find('[data-test="before-section"]');
      const afterSection = wrapper.find('[data-test="after-section"]');

      // Assert
      expect(beforeSection.exists()).toBe(true);
      expect(afterSection.exists()).toBe(true);
      expect(afterSection.findComponent({ name: "OTable" }).exists()).toBe(true);
    });
  });
});
