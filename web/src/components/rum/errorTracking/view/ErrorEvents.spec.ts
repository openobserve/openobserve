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
import ErrorEvents from "@/components/rum/errorTracking/view/ErrorEvents.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Mock OTable component
vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    template: `
      <div data-test="o-table">
        <div v-for="(column, index) in columns" :key="index" class="column">
          {{ column.header }}
        </div>
        <div v-for="(row, index) in data" :key="index" class="row-data">
          <slot name="cell-type" :row="row">
            <span>default-type</span>
          </slot>
          <slot name="cell-description" :row="row">
            <span>default-description</span>
          </slot>
          {{ row.type }}
        </div>
      </div>
    `,
    props: ["data", "columns", "rowKey", "pagination"],
  },
}));

// Mock ErrorEventDescription
vi.mock(
  "@/components/rum/errorTracking/view/ErrorEventDescription.vue",
  () => ({
    default: {
      name: "ErrorEventDescription",
      template:
        '<div data-test="error-event-description">{{ column.type }}</div>',
      props: ["column"],
    },
  }),
);

// Mock ErrorTypeIcons
vi.mock("@/components/rum/errorTracking/view/ErrorTypeIcons.vue", () => ({
  default: {
    name: "ErrorTypeIcons",
    template: '<div data-test="error-type-icons">{{ column.type }}</div>',
    props: ["column"],
  },
}));

// Mock date formatting - component uses @/utils/date not quasar
vi.mock("@/utils/date", () => ({
  formatDate: vi.fn((_timestamp, _format) => "Jan 01, 2024 10:00:00 +0000"),
}));

describe("ErrorEvents Component", () => {
  let wrapper: any;

  const mockError = {
    events: [
      {
        type: "error",
        error_type: "TypeError",
        error_message: "Cannot read property 'foo' of undefined",
        _timestamp: 1704110400000000,
      },
      {
        type: "resource",
        resource_type: "xhr",
        resource_url: "https://api.example.com/data",
        _timestamp: 1704110410000000,
      },
      {
        type: "view",
        view_loading_type: "route_change",
        view_url: "/dashboard",
        _timestamp: 1704110420000000,
      },
      {
        type: "action",
        action_type: "click",
        _oo_action_target_text: "Submit Button",
        _timestamp: 1704110430000000,
      },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorEvents, {
      attachTo: "#app",
      props: {
        error: mockError,
      },
      global: {
        plugins: [i18n],
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
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

    it("should render main container with correct classes", () => {
      // Component uses tw:mt-4 (Tailwind) not q-mt-lg (Quasar)
      const container = wrapper.find('[class*="tw:mt-4"]');
      expect(container.exists()).toBe(true);
    });

    it("should render OTable component", () => {
      const oTable = wrapper.find('[data-test="o-table"]');
      expect(oTable.exists()).toBe(true);
    });
  });

  describe("Title Display", () => {
    it("should display 'Events' title", () => {
      const title = wrapper.find(".tags-title");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Events");
    });

    it("should have correct title styling", () => {
      // Component uses tw:font-bold tw:mb-2 tw:ml-1 (Tailwind) not Quasar classes
      const title = wrapper.find(".tags-title");
      expect(title.classes()).toContain("tags-title");
      expect(title.classes()).toContain("tw:font-bold");
    });
  });

  describe("Column Configuration", () => {
    it("should have correct number of columns", () => {
      expect(wrapper.vm.columns).toHaveLength(5);
    });

    it("should have type column with cell slot", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "type",
      );
      expect(typeColumn).toBeDefined();
      expect(typeColumn.header).toBe("Type");
      expect(typeColumn.cell).toBe(" ");
      expect(typeColumn.accessorKey).toBe("type");
    });

    it("should have category column with accessorFn", () => {
      const categoryColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "category",
      );
      expect(categoryColumn).toBeDefined();
      expect(categoryColumn.header).toBe("Category");
      expect(typeof categoryColumn.accessorFn).toBe("function");
    });

    it("should have description column with cell slot", () => {
      const descColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "description",
      );
      expect(descColumn).toBeDefined();
      expect(descColumn.header).toBe("Description");
      expect(descColumn.cell).toBe(" ");
    });

    it("should have level column with accessorFn", () => {
      const levelColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "level",
      );
      expect(levelColumn).toBeDefined();
      expect(levelColumn.header).toBe("Level");
      expect(typeof levelColumn.accessorFn).toBe("function");
    });

    it("should have timestamp column with accessorFn", () => {
      const timestampColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "timestamp",
      );
      expect(timestampColumn).toBeDefined();
      expect(timestampColumn.header).toBe("Timestamp");
      expect(typeof timestampColumn.accessorFn).toBe("function");
    });
  });

  describe("Error Category Logic", () => {
    it("should return error type for error events", () => {
      const mockRow = { type: "error", error_type: "TypeError" };
      const result = wrapper.vm.getErrorCategory(mockRow);
      expect(result).toBe("TypeError");
    });

    it("should return 'Error' for error events without error_type", () => {
      const mockRow = { type: "error" };
      const result = wrapper.vm.getErrorCategory(mockRow);
      expect(result).toBe("Error");
    });

    it("should return resource type for resource events", () => {
      const mockRow = { type: "resource", resource_type: "xhr" };
      const result = wrapper.vm.getErrorCategory(mockRow);
      expect(result).toBe("xhr");
    });

    it("should return 'Navigation' for route change views", () => {
      const mockRow = { type: "view", view_loading_type: "route_change" };
      const result = wrapper.vm.getErrorCategory(mockRow);
      expect(result).toBe("Navigation");
    });

    it("should return 'Reload' for non-route change views", () => {
      const mockRow = { type: "view", view_loading_type: "initial_load" };
      const result = wrapper.vm.getErrorCategory(mockRow);
      expect(result).toBe("Reload");
    });

    it("should return action type for action events", () => {
      const mockRow = { type: "action", action_type: "click" };
      const result = wrapper.vm.getErrorCategory(mockRow);
      expect(result).toBe("click");
    });

    it("should return type for unknown event types", () => {
      const mockRow = { type: "unknown_type" };
      const result = wrapper.vm.getErrorCategory(mockRow);
      expect(result).toBe("unknown_type");
    });
  });

  describe("Column Accessor Functions", () => {
    it("should compute category via accessorFn", () => {
      const categoryColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "category",
      );
      const mockRow = { type: "error", error_type: "ReferenceError" };

      const result = categoryColumn.accessorFn(mockRow);
      expect(result).toBe("ReferenceError");
    });

    it("should compute level via accessorFn for error events", () => {
      const levelColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "level",
      );
      const errorRow = { type: "error" };
      const nonErrorRow = { type: "view" };

      expect(levelColumn.accessorFn(errorRow)).toBe("error");
      expect(levelColumn.accessorFn(nonErrorRow)).toBe("info");
    });

    it("should compute timestamp via accessorFn", () => {
      const timestampColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "timestamp",
      );
      const mockRow = { _timestamp: 1704110400000000 };

      const result = timestampColumn.accessorFn(mockRow);
      expect(result).toBe("Jan 01, 2024 10:00:00 +0000");
    });
  });

  describe("Column Metadata", () => {
    it("should set correct cellClass for type column", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "type",
      );
      expect(typeColumn.meta.cellClass).toBe("error-type");
    });

    it("should set correct cellClass for description column", () => {
      const descColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "description",
      );
      expect(descColumn.meta.cellClass).toBe("description-column");
    });

    it("should set correct cellClass for level column", () => {
      const levelColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "level",
      );
      expect(levelColumn.meta.cellClass).toBe("error-level");
    });
  });

  describe("Slot Integration", () => {
    it("should render ErrorTypeIcons inside cell-type slot", () => {
      const errorTypeIcons = wrapper.findComponent({ name: "ErrorTypeIcons" });
      expect(errorTypeIcons.exists()).toBe(true);
    });

    it("should render ErrorEventDescription inside cell-description slot", () => {
      const errorEventDescription = wrapper.findComponent({
        name: "ErrorEventDescription",
      });
      expect(errorEventDescription.exists()).toBe(true);
    });

    it("should pass row data directly to ErrorTypeIcons via column prop", () => {
      const errorTypeIcons = wrapper.findComponent({ name: "ErrorTypeIcons" });
      expect(errorTypeIcons.props("column")).toEqual({
        type: "error",
        error_type: "TypeError",
        error_message: "Cannot read property 'foo' of undefined",
        _timestamp: 1704110400000000,
      });
    });

    it("should pass row data directly to ErrorEventDescription via column prop", () => {
      const errorEventDescription = wrapper.findComponent({
        name: "ErrorEventDescription",
      });
      expect(errorEventDescription.props("column")).toEqual({
        type: "error",
        error_type: "TypeError",
        error_message: "Cannot read property 'foo' of undefined",
        _timestamp: 1704110400000000,
      });
    });
  });

  describe("Props Integration", () => {
    it("should pass columns to OTable", () => {
      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("columns")).toEqual(wrapper.vm.columns);
    });

    it("should pass events data to OTable", () => {
      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("data")).toEqual(mockError.events);
    });

    it("should handle empty events array", async () => {
      await wrapper.setProps({
        error: { events: [] },
      });

      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("data")).toEqual([]);
    });

    it("should handle missing events property", async () => {
      await wrapper.setProps({
        error: {},
      });

      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("data")).toEqual([]);
    });

    it("should handle null events", async () => {
      await wrapper.setProps({
        error: { events: null },
      });

      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("data")).toEqual([]);
    });
  });

  describe("Date Formatting", () => {
    it("should have getFormattedDate function", () => {
      expect(typeof wrapper.vm.getFormattedDate).toBe("function");
    });

    it("should format timestamps correctly", () => {
      const result = wrapper.vm.getFormattedDate(1704110400);
      expect(result).toBe("Jan 01, 2024 10:00:00 +0000");
    });

    it("should handle different timestamp formats", () => {
      const microseconds = 1704110400000000;
      const milliseconds = microseconds / 1000;

      const result = wrapper.vm.getFormattedDate(milliseconds);
      expect(result).toBe("Jan 01, 2024 10:00:00 +0000");
    });
  });

  describe("Props Validation", () => {
    it("should require error prop", () => {
      expect(ErrorEvents.props?.error?.required).toBe(true);
      expect(ErrorEvents.props?.error?.type).toBe(Object);
    });

    it("should handle different error structures", async () => {
      const customError = {
        events: [
          {
            type: "custom",
            custom_field: "value",
            _timestamp: 1704110500000000,
          },
        ],
        other_field: "ignored",
      };

      await wrapper.setProps({ error: customError });

      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("data")).toEqual(customError.events);
    });
  });

  describe("Column Classes", () => {
    it("should apply correct CSS classes to columns via meta", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "type",
      );
      const descColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "description",
      );
      const levelColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "level",
      );

      expect(typeColumn.meta.cellClass).toBe("error-type");
      expect(descColumn.meta.cellClass).toBe("description-column");
      expect(levelColumn.meta.cellClass).toBe("error-level");
    });

    it("should mark appropriate columns as sortable", () => {
      const sortableColumns = wrapper.vm.columns.filter(
        (col: any) => col.sortable,
      );
      const sortableIds = sortableColumns.map((col: any) => col.id);

      expect(sortableIds).toContain("type");
      expect(sortableIds).toContain("category");
      expect(sortableIds).toContain("description");
      expect(sortableIds).toContain("timestamp");
      expect(sortableIds).not.toContain("level"); // level is not sortable
    });
  });

  describe("Component Structure", () => {
    it("should have proper element hierarchy", () => {
      // Component uses tw:mt-4 (Tailwind) not q-mt-lg (Quasar)
      const title = wrapper.find(".tags-title");
      const oTable = wrapper.findComponent({ name: "OTable" });

      expect(title.exists()).toBe(true);
      expect(oTable.exists()).toBe(true);
    });

    it("should maintain correct order of elements", () => {
      // Component uses tw:mt-4 (Tailwind) not q-mt-lg (Quasar)
      const container = wrapper.find('[class*="tw:mt-4"]');
      const children = Array.from(container.element.children);

      expect(children[0].classList.contains("tags-title")).toBe(true);
      expect(children[1].getAttribute("data-test")).toBe("o-table");
    });
  });

  describe("Edge Cases", () => {
    it("should handle events with missing fields", () => {
      const incompleteRow = { type: "incomplete" };

      const categoryResult = wrapper.vm.getErrorCategory(incompleteRow);
      expect(categoryResult).toBe("incomplete");
    });

    it("should handle malformed timestamps", () => {
      const timestampColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "timestamp",
      );
      const invalidRow = { _timestamp: "invalid" };

      expect(() => timestampColumn.accessorFn(invalidRow)).not.toThrow();
    });

    it("should handle null row data", () => {
      const categoryColumn = wrapper.vm.columns.find(
        (col: any) => col.id === "category",
      );

      expect(() => categoryColumn.accessorFn(null)).toThrow();
    });
  });

  describe("Performance", () => {
    it("should efficiently handle large event arrays", async () => {
      const largeEvents = Array.from({ length: 1000 }, (_, index) => ({
        type: index % 2 === 0 ? "error" : "view",
        error_type: "TestError" + index,
        _timestamp: 1704110400000000 + index,
      }));

      await wrapper.setProps({
        error: { events: largeEvents },
      });

      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("data")).toHaveLength(1000);
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle rapid prop changes", async () => {
      const events1 = [{ type: "error", _timestamp: 1 }];
      const events2 = [{ type: "view", _timestamp: 2 }];
      const events3 = [{ type: "action", _timestamp: 3 }];

      for (const events of [events1, events2, events3]) {
        await wrapper.setProps({ error: { events } });
        const oTable = wrapper.findComponent({ name: "OTable" });
        expect(oTable.props("data")).toEqual(events);
      }
    });
  });
});
