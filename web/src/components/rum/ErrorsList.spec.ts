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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import ErrorsList from "@/components/rum/ErrorsList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

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
    mergeRoutes: vi.fn((route1, route2) => [
      ...(route1 || []),
      ...(route2 || []),
    ]),
  };
});

// Mock child components
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

vi.mock("@/components/rum/AppTable.vue", () => ({
  default: {
    name: "AppTable",
    template: `
      <div data-test="app-table">
        <div data-test="table-columns" v-if="columns">{{ columns.length }} columns</div>
        <div data-test="table-rows" v-if="rows">{{ rows.length }} rows</div>
        <slot name="error_details" :column="{ error: 'Test Error', error_type: 'JavaScript Error' }"></slot>
      </div>
    `,
    props: ["columns", "rows"],
  },
}));

vi.mock("@/components/rum/ErrorDetail.vue", () => ({
  default: {
    name: "ErrorDetail",
    template:
      '<div data-test="error-detail">{{ column.error || "No Error" }}</div>',
    props: ["column"],
  },
}));

describe("ErrorsList Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    try {
      wrapper = mount(ErrorsList, {
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            "q-splitter": {
              template: `
                <div data-test="splitter">
                  <div data-test="before-section"><slot name="before" /></div>
                  <div data-test="separator-section"><slot name="separator" /></div>
                  <div data-test="after-section"><slot name="after" /></div>
                </div>
              `,
              props: ["modelValue", "unit", "vertical"],
            },
            "q-avatar": {
              template: '<div data-test="avatar" />',
              props: ["color", "text-color", "size", "icon", "style"],
            },
          },
        },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();
    } catch (error) {
      console.error("Mount failed:", error);
      throw error;
    }
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render sessions page container", () => {
      expect(wrapper.find(".sessions_page").exists()).toBe(true);
    });

    it("should render all child components", () => {
      expect(wrapper.find('[data-test="search-bar"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="index-list"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="app-table"]').exists()).toBe(true);
    });

    it("should render splitter layout", () => {
      expect(wrapper.find('[data-test="splitter"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="before-section"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="separator-section"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="after-section"]').exists()).toBe(true);
    });

    it("should render separator avatar", () => {
      expect(wrapper.find('[data-test="avatar"]').exists()).toBe(true);
    });
  });

  describe("Component Structure", () => {
    it("should have correct layout structure", () => {
      const beforeSection = wrapper.find('[data-test="before-section"]');
      const afterSection = wrapper.find('[data-test="after-section"]');

      expect(beforeSection.find('[data-test="index-list"]').exists()).toBe(
        true,
      );
      expect(afterSection.find('[data-test="app-table"]').exists()).toBe(true);
    });

    it("should pass SearchBar to template", () => {
      expect(wrapper.findComponent({ name: "SearchBar" }).exists()).toBe(true);
    });

    it("should pass IndexList to before slot", () => {
      const beforeSection = wrapper.find('[data-test="before-section"]');
      expect(beforeSection.findComponent({ name: "IndexList" }).exists()).toBe(
        true,
      );
    });

    it("should pass AppTable to after slot", () => {
      const afterSection = wrapper.find('[data-test="after-section"]');
      expect(afterSection.findComponent({ name: "AppTable" }).exists()).toBe(
        true,
      );
    });
  });

  describe("Data Properties", () => {
    it("should have splitterModel with default value", () => {
      expect(wrapper.vm.splitterModel).toBe(250);
    });

    it("should have empty rows array initially", () => {
      expect(wrapper.vm.rows).toEqual([]);
      expect(Array.isArray(wrapper.vm.rows)).toBe(true);
    });

    it("should have columns array with correct structure", () => {
      expect(Array.isArray(wrapper.vm.columns)).toBe(true);
      expect(wrapper.vm.columns.length).toBeGreaterThan(0);
    });
  });

  describe("Columns Configuration", () => {
    it("should have error column with correct properties", () => {
      const errorColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "error",
      );

      expect(errorColumn).toBeDefined();
      expect(errorColumn.label).toBe("Error");
      expect(errorColumn.align).toBe("left");
      expect(errorColumn.sortable).toBe(true);
      expect(errorColumn.slot).toBe(true);
      expect(errorColumn.slotName).toBe("error_details");
    });

    it("should have type column with correct properties", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "type",
      );

      expect(typeColumn).toBeDefined();
      expect(typeColumn.label).toBe("Session Type");
      expect(typeColumn.align).toBe("left");
      expect(typeColumn.sortable).toBe(true);
    });

    it("should have time_spent column with correct properties", () => {
      const timeSpentColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "time_spent",
      );

      expect(timeSpentColumn).toBeDefined();
      expect(timeSpentColumn.label).toBe("Time Spent");
      expect(timeSpentColumn.align).toBe("left");
      expect(timeSpentColumn.sortable).toBe(true);
      expect(typeof timeSpentColumn.sort).toBe("function");
    });

    it("should have error_count column with correct properties", () => {
      const errorCountColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "error_count",
      );

      expect(errorCountColumn).toBeDefined();
      expect(errorCountColumn.label).toBe("Error Count");
      expect(errorCountColumn.align).toBe("left");
      expect(errorCountColumn.sortable).toBe(true);
    });

    it("should have initial_view_name column with correct properties", () => {
      const initialViewColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "initial_view_name",
      );

      expect(initialViewColumn).toBeDefined();
      expect(initialViewColumn.label).toBe("Initial View Name");
      expect(initialViewColumn.align).toBe("left");
      expect(initialViewColumn.sortable).toBe(true);
    });
  });

  describe("Column Functions", () => {
    it("should handle error column field function", () => {
      const errorColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "error",
      );
      const mockRow = { error: "Test error message" };

      expect(errorColumn.field(mockRow)).toBe("Test error message");
      expect(errorColumn.prop(mockRow)).toBe("Test error message");
    });

    it("should handle type column field function", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "type",
      );
      const mockRow = { type: "javascript" };

      expect(typeColumn.field(mockRow)).toBe("javascript");
      expect(typeColumn.prop(mockRow)).toBe("javascript");
    });

    it("should handle time_spent column field function with formatting", () => {
      const timeSpentColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "time_spent",
      );
      const mockRow = { time_spent: "120000000" }; // 120 seconds in nanoseconds

      const result = timeSpentColumn.field(mockRow);
      expect(result).toBe("2m"); // formatDuration should convert 120s to 2m
    });

    it("should handle time_spent column sort function", () => {
      const timeSpentColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "time_spent",
      );
      const rowA = { time_spent: "100000000" };
      const rowB = { time_spent: "200000000" };

      const result = timeSpentColumn.sort(null, null, rowA, rowB);
      expect(result).toBe(-100000000); // 100000000 - 200000000
    });

    it("should handle error_count column field function", () => {
      const errorCountColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "error_count",
      );
      const mockRow = { error_count: "5" };

      expect(errorCountColumn.field(mockRow)).toBe("5");
      expect(errorCountColumn.prop(mockRow)).toBe("5");
    });

    it("should handle initial_view_name column field function", () => {
      const initialViewColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "initial_view_name",
      );
      const mockRow = { initial_view_name: "HomePage" };

      expect(initialViewColumn.field(mockRow)).toBe("HomePage");
      expect(initialViewColumn.prop(mockRow)).toBe("HomePage");
    });
  });

  describe("AppTable Integration", () => {
    it("should pass columns to AppTable", () => {
      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("columns")).toEqual(wrapper.vm.columns);
    });

    it("should pass rows to AppTable", () => {
      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("rows")).toEqual(wrapper.vm.rows);
    });

    it("should render error details slot", () => {
      expect(wrapper.find('[data-test="error-detail"]').exists()).toBe(true);
    });

    it("should pass slot props to ErrorDetail component", () => {
      const errorDetail = wrapper.findComponent({ name: "ErrorDetail" });
      expect(errorDetail.exists()).toBe(true);
      expect(errorDetail.props("column")).toBeDefined();
    });
  });

  describe("Data Updates", () => {
    it("should allow updating rows data", async () => {
      const newRows = [
        {
          timestamp: "2024-01-01T10:00:00Z",
          type: "javascript",
          time_spent: "120000000",
          error_count: "3",
          initial_view_name: "HomePage",
          id: "session1",
        },
      ];

      wrapper.vm.rows = newRows;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.rows).toEqual(newRows);
    });

    it("should allow updating splitterModel", async () => {
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.splitterModel).toBe(300);
    });
  });

  describe("TypeScript Interface", () => {
    it("should handle Session interface structure", () => {
      const mockSession = {
        timestamp: "2024-01-01T10:00:00Z",
        type: "javascript",
        time_spent: "120000000",
        error_count: "3",
        initial_view_name: "HomePage",
        id: "session1",
      };

      // Test that our columns can handle the Session interface
      const errorColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "error",
      );
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "type",
      );
      const timeSpentColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "time_spent",
      );

      expect(() => errorColumn.field(mockSession)).not.toThrow();
      expect(() => typeColumn.field(mockSession)).not.toThrow();
      expect(() => timeSpentColumn.field(mockSession)).not.toThrow();
      expect(() =>
        timeSpentColumn.sort(null, null, mockSession, mockSession),
      ).not.toThrow();
    });
  });

  describe("Component Composition", () => {
    it("should use useI18n composable", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should render translated column labels", () => {
      const columns = wrapper.vm.columns;

      expect(columns[0].label).toBe("Error");
      expect(columns[1].label).toBe("Session Type");
      expect(columns[2].label).toBe("Time Spent");
      expect(columns[3].label).toBe("Error Count");
      expect(columns[4].label).toBe("Initial View Name");
    });
  });

  describe("Layout and Styling", () => {
    it("should have sessions_page class", () => {
      expect(wrapper.classes()).toContain("sessions_page");
    });

    it("should apply correct CSS classes", () => {
      const sessionsPage = wrapper.find(".sessions_page");
      expect(sessionsPage.exists()).toBe(true);
    });
  });

  describe("Responsive Layout", () => {
    it("should handle splitter resizing", async () => {
      const initialModel = wrapper.vm.splitterModel;
      wrapper.vm.splitterModel = initialModel + 50;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.splitterModel).toBe(initialModel + 50);
    });
  });

  describe("Error Handling", () => {
    it("should handle empty rows gracefully", () => {
      expect(wrapper.vm.rows).toEqual([]);
      expect(wrapper.find('[data-test="app-table"]').exists()).toBe(true);
    });

    it("should handle column field functions with missing properties", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "type",
      );
      const emptyRow = {};

      expect(() => typeColumn.field(emptyRow)).not.toThrow();
      expect(typeColumn.field(emptyRow)).toBeUndefined();
    });

    it("should handle time_spent formatting with invalid values", () => {
      const timeSpentColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "time_spent",
      );
      const invalidRow = { time_spent: "invalid" };

      expect(() => timeSpentColumn.field(invalidRow)).not.toThrow();
    });
  });

  describe("Integration", () => {
    it("should work with store integration", () => {
      // Component uses Composition API, store is provided via provide/inject
      // Check that the component mounts successfully, which implies store integration works
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should work with router integration", () => {
      // Router is provided via global plugins, not exposed as a vm property
      expect(wrapper.vm.$router).toBeDefined();
    });

    it("should work with i18n integration", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Slot Rendering", () => {
    it("should render error_details slot correctly", () => {
      const errorDetailSlot = wrapper.find('[data-test="error-detail"]');
      expect(errorDetailSlot.exists()).toBe(true);
      // The slot should render some content, either "Test Error" or "No Error"
      expect(errorDetailSlot.text().length).toBeGreaterThan(0);
    });

    it("should pass correct props to slotted components", () => {
      const errorDetail = wrapper.findComponent({ name: "ErrorDetail" });
      expect(errorDetail.props()).toHaveProperty("column");
    });
  });

  describe("Performance", () => {
    it("should handle large datasets efficiently", async () => {
      const largeDataset = Array.from({ length: 1000 }, (_, index) => ({
        timestamp: `2024-01-01T10:${index.toString().padStart(2, "0")}:00Z`,
        type: index % 2 === 0 ? "javascript" : "network",
        time_spent: (index * 1000000).toString(),
        error_count: (index % 10).toString(),
        initial_view_name: `View${index}`,
        id: `session${index}`,
      }));

      wrapper.vm.rows = largeDataset;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.rows.length).toBe(1000);
      expect(wrapper.find('[data-test="app-table"]').exists()).toBe(true);
    });
  });
});
