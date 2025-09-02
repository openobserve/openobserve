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
import ErrorEvents from "@/components/rum/errorTracking/view/ErrorEvents.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

// Mock AppTable component
vi.mock("@/components/AppTable.vue", () => ({
  default: {
    name: "AppTable",
    template: `
      <div data-test="app-table">
        <div v-for="(column, index) in columns" :key="index" class="column">
          {{ column.label }}
        </div>
        <div v-for="(row, index) in rows" :key="index" class="row-data">
          {{ row.type }}
        </div>
        <template v-for="slot in Object.keys($slots)" :key="slot">
          <div :data-test="'slot-' + slot">
            <slot :name="slot" :column="{ row: mockRowData }" />
          </div>
        </template>
      </div>
    `,
    props: ["columns", "rows"],
    setup() {
      return {
        mockRowData: {
          type: "error",
          error_type: "TypeError",
          _timestamp: 1704110400000000,
        },
      };
    },
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

// Mock date formatting
vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("quasar")>();
  return {
    ...actual,
    date: {
      formatDate: vi.fn((timestamp, format) => {
        if (format === "MMM DD, YYYY HH:mm:ss Z") {
          return "Jan 01, 2024 10:00:00 +0000";
        }
        return "Jan 01, 2024 10:00:00 +0000";
      }),
    },
  };
});

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
      const container = wrapper.find(".q-mt-lg");
      expect(container.exists()).toBe(true);
      expect(container.classes()).toContain("q-mt-lg");
    });

    it("should render AppTable component", () => {
      const appTable = wrapper.find('[data-test="app-table"]');
      expect(appTable.exists()).toBe(true);
    });
  });

  describe("Title Display", () => {
    it("should display 'Events' title", () => {
      const title = wrapper.find(".tags-title");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Events");
    });

    it("should have correct title styling", () => {
      const title = wrapper.find(".tags-title");
      expect(title.classes()).toContain("tags-title");
      expect(title.classes()).toContain("text-bold");
      expect(title.classes()).toContain("q-mb-sm");
      expect(title.classes()).toContain("q-ml-xs");
    });
  });

  describe("Column Configuration", () => {
    it("should have correct number of columns", () => {
      expect(wrapper.vm.columns).toHaveLength(5);
    });

    it("should have type column with slot", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "type",
      );
      expect(typeColumn).toBeDefined();
      expect(typeColumn.label).toBe("Type");
      expect(typeColumn.slot).toBe(true);
      expect(typeColumn.slotName).toBe("error-type");
    });

    it("should have category column with field function", () => {
      const categoryColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "category",
      );
      expect(categoryColumn).toBeDefined();
      expect(categoryColumn.label).toBe("Category");
      expect(typeof categoryColumn.field).toBe("function");
      expect(typeof categoryColumn.prop).toBe("function");
    });

    it("should have description column with slot", () => {
      const descColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "description",
      );
      expect(descColumn).toBeDefined();
      expect(descColumn.label).toBe("Description");
      expect(descColumn.slot).toBe(true);
      expect(descColumn.slotName).toBe("description");
    });

    it("should have level column with field function", () => {
      const levelColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "level",
      );
      expect(levelColumn).toBeDefined();
      expect(levelColumn.label).toBe("Level");
      expect(typeof levelColumn.field).toBe("function");
    });

    it("should have timestamp column with field function", () => {
      const timestampColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "timestamp",
      );
      expect(timestampColumn).toBeDefined();
      expect(timestampColumn.label).toBe("Timestamp");
      expect(typeof timestampColumn.field).toBe("function");
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

  describe("Column Field Functions", () => {
    it("should compute category field correctly", () => {
      const categoryColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "category",
      );
      const mockRow = { type: "error", error_type: "ReferenceError" };

      const fieldResult = categoryColumn.field(mockRow);
      const propResult = categoryColumn.prop(mockRow);

      expect(fieldResult).toBe("ReferenceError");
      expect(propResult).toBe("ReferenceError");
    });

    it("should compute level field correctly for error events", () => {
      const levelColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "level",
      );
      const errorRow = { type: "error" };
      const nonErrorRow = { type: "view" };

      expect(levelColumn.field(errorRow)).toBe("error");
      expect(levelColumn.field(nonErrorRow)).toBe("info");
      expect(levelColumn.prop(errorRow)).toBe("error");
      expect(levelColumn.prop(nonErrorRow)).toBe("info");
    });

    it("should compute timestamp field correctly", () => {
      const timestampColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "timestamp",
      );
      const mockRow = { _timestamp: 1704110400000000 };

      const result = timestampColumn.field(mockRow);
      expect(result).toBe("Jan 01, 2024 10:00:00 +0000");
    });
  });

  describe("Column Styling", () => {
    it("should apply error styling to error rows", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "type",
      );
      const errorRow = { type: "error" };
      const nonErrorRow = { type: "view" };

      const errorStyle = typeColumn.style(errorRow);
      const nonErrorStyle = typeColumn.style(nonErrorRow);

      expect(errorStyle).toBe("border-bottom: 1px solid red");
      expect(nonErrorStyle).toBe("");
    });

    it("should apply error styling to level column with color", () => {
      const levelColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "level",
      );
      const errorRow = { type: "error" };
      const nonErrorRow = { type: "view" };

      const errorStyle = levelColumn.style(errorRow);
      const nonErrorStyle = levelColumn.style(nonErrorRow);

      expect(errorStyle).toBe("color: red; border-bottom: 1px solid red");
      expect(nonErrorStyle).toBe("");
    });

    it("should apply consistent styling across all columns for error rows", () => {
      const errorRow = { type: "error" };
      const nonErrorRow = { type: "view" };

      const columnsWithStyling = wrapper.vm.columns.filter(
        (col: any) => col.style,
      );

      columnsWithStyling.forEach((column: any) => {
        if (column.name === "level") {
          expect(column.style(errorRow)).toContain("color: red");
        } else {
          expect(column.style(errorRow)).toBe("border-bottom: 1px solid red");
        }
        expect(column.style(nonErrorRow)).toBe("");
      });
    });
  });

  describe("Slot Integration", () => {
    it("should render error-type slot", () => {
      const errorTypeSlot = wrapper.find('[data-test="slot-error-type"]');
      expect(errorTypeSlot.exists()).toBe(true);
    });

    it("should render description slot", () => {
      const descriptionSlot = wrapper.find('[data-test="slot-description"]');
      expect(descriptionSlot.exists()).toBe(true);
    });

    it("should pass correct data to error type slot", () => {
      const errorTypeIcons = wrapper.findComponent({ name: "ErrorTypeIcons" });
      expect(errorTypeIcons.exists()).toBe(true);
      expect(errorTypeIcons.props("column")).toEqual({
        type: "error",
        error_type: "TypeError",
        _timestamp: 1704110400000000,
      });
    });

    it("should pass correct data to description slot", () => {
      const errorEventDescription = wrapper.findComponent({
        name: "ErrorEventDescription",
      });
      expect(errorEventDescription.exists()).toBe(true);
      expect(errorEventDescription.props("column")).toEqual({
        type: "error",
        error_type: "TypeError",
        _timestamp: 1704110400000000,
      });
    });
  });

  describe("Props Integration", () => {
    it("should pass columns to AppTable", () => {
      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("columns")).toEqual(wrapper.vm.columns);
    });

    it("should pass events data to AppTable", () => {
      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("rows")).toEqual(mockError.events);
    });

    it("should handle empty events array", async () => {
      await wrapper.setProps({
        error: { events: [] },
      });

      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("rows")).toEqual([]);
    });

    it("should handle missing events property", async () => {
      await wrapper.setProps({
        error: {},
      });

      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("rows")).toEqual([]);
    });

    it("should handle null events", async () => {
      await wrapper.setProps({
        error: { events: null },
      });

      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("rows")).toEqual([]);
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

      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("rows")).toEqual(customError.events);
    });
  });

  describe("Column Classes", () => {
    it("should apply correct CSS classes to columns", () => {
      const typeColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "type",
      );
      const descColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "description",
      );
      const levelColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "level",
      );

      expect(typeColumn.classes).toBe("error-type");
      expect(descColumn.classes).toBe("description-column");
      expect(levelColumn.classes).toBe("error-level");
    });

    it("should mark appropriate columns as sortable", () => {
      const sortableColumns = wrapper.vm.columns.filter(
        (col: any) => col.sortable,
      );
      const sortableNames = sortableColumns.map((col: any) => col.name);

      expect(sortableNames).toContain("type");
      expect(sortableNames).toContain("category");
      expect(sortableNames).toContain("description");
      expect(sortableNames).toContain("timestamp");
      expect(sortableNames).not.toContain("level"); // level is not sortable
    });
  });

  describe("Component Structure", () => {
    it("should have proper element hierarchy", () => {
      const container = wrapper.find(".q-mt-lg");
      const title = container.find(".tags-title");
      const appTable = container.findComponent({ name: "AppTable" });

      expect(container.exists()).toBe(true);
      expect(title.exists()).toBe(true);
      expect(appTable.exists()).toBe(true);
    });

    it("should maintain correct order of elements", () => {
      const container = wrapper.find(".q-mt-lg");
      const children = Array.from(container.element.children);

      expect(children[0].classList.contains("tags-title")).toBe(true);
      expect(children[1].getAttribute("data-test")).toBe("app-table");
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
        (col: any) => col.name === "timestamp",
      );
      const invalidRow = { _timestamp: "invalid" };

      expect(() => timestampColumn.field(invalidRow)).not.toThrow();
    });

    it("should handle null row data", () => {
      const categoryColumn = wrapper.vm.columns.find(
        (col: any) => col.name === "category",
      );

      // The actual component will error on null data - this reflects real behavior
      expect(() => categoryColumn.field(null)).toThrow();
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

      const appTable = wrapper.findComponent({ name: "AppTable" });
      expect(appTable.props("rows")).toHaveLength(1000);
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle rapid prop changes", async () => {
      const events1 = [{ type: "error", _timestamp: 1 }];
      const events2 = [{ type: "view", _timestamp: 2 }];
      const events3 = [{ type: "action", _timestamp: 3 }];

      for (const events of [events1, events2, events3]) {
        await wrapper.setProps({ error: { events } });
        const appTable = wrapper.findComponent({ name: "AppTable" });
        expect(appTable.props("rows")).toEqual(events);
      }
    });
  });
});
