import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ErrorEvents from "@/components/rum/errorTracking/view/ErrorEvents.vue";
import i18n from "@/locales";

// ---------------------------------------------------------------------------
// DOM node for attachTo
// ---------------------------------------------------------------------------

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    template: `
      <div data-test="o-table">
        <div v-for="(row, index) in data" :key="index" data-test="table-row">
          <slot name="cell-type" :row="row" />
          <slot name="cell-description" :row="row" />
        </div>
      </div>
    `,
    props: ["data", "columns", "rowKey", "pagination", "showGlobalFilter"],
  },
}));

vi.mock("@/components/rum/errorTracking/view/ErrorEventDescription.vue", () => ({
  default: {
    name: "ErrorEventDescription",
    template: '<div data-test="error-event-description">{{ column.type }}</div>',
    props: ["column"],
  },
}));

vi.mock("@/components/rum/errorTracking/view/ErrorTypeIcons.vue", () => ({
  default: {
    name: "ErrorTypeIcons",
    template: '<div data-test="error-type-icons">{{ column.type }}</div>',
    props: ["column"],
  },
}));

vi.mock("@/components/shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: '<div data-test="no-data" />',
  },
}));

vi.mock("@/utils/date", () => ({
  formatDate: vi.fn((_timestamp: number, _format: string) => "Jan 01, 2024 10:00:00 +0000"),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mountComponent(props: Record<string, any> = {}) {
  return mount(ErrorEvents, {
    attachTo: "#app",
    props: { error: mockError, ...props },
    global: { plugins: [i18n] },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ErrorEvents", () => {
  let wrapper: ReturnType<typeof mountComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Component mounting
  // =========================================================================

  describe("component mounting", () => {
    it("mounts successfully", () => {
      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders OTable component", () => {
      // Assert
      expect(wrapper.find('[data-test="o-table"]').exists()).toBe(true);
    });
  });

  // =========================================================================
  // Title display
  // =========================================================================

  describe("title display", () => {
    it("displays 'Events' title via the tags-title element", () => {
      // Act
      const title = wrapper.find(".tags-title");

      // Assert
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Events");
    });
  });

  // =========================================================================
  // Column configuration
  // =========================================================================

  describe("column configuration", () => {
    it("has exactly 5 columns defined", () => {
      // Assert
      expect(wrapper.vm.columns).toHaveLength(5);
    });

    it("has a 'type' column with cell slot marker", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "type");

      // Assert
      expect(col).toBeDefined();
      expect(col.header).toBe("Type");
      expect(col.cell).toBe(" ");
      expect(col.accessorKey).toBe("type");
    });

    it("has a 'category' column with accessorFn", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "category");

      // Assert
      expect(col).toBeDefined();
      expect(col.header).toBe("Category");
      expect(typeof col.accessorFn).toBe("function");
    });

    it("has a 'description' column with cell slot marker", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "description");

      // Assert
      expect(col).toBeDefined();
      expect(col.header).toBe("Description");
      expect(col.cell).toBe(" ");
    });

    it("has a 'level' column with accessorFn", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "level");

      // Assert
      expect(col).toBeDefined();
      expect(col.header).toBe("Level");
      expect(typeof col.accessorFn).toBe("function");
    });

    it("has a 'timestamp' column with accessorFn", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "timestamp");

      // Assert
      expect(col).toBeDefined();
      expect(col.header).toBe("Timestamp");
      expect(typeof col.accessorFn).toBe("function");
    });
  });

  // =========================================================================
  // Error category logic
  // =========================================================================

  describe("error category logic", () => {
    it("returns error_type for error events", () => {
      // Act
      const result = wrapper.vm.getErrorCategory({ type: "error", error_type: "TypeError" });

      // Assert
      expect(result).toBe("TypeError");
    });

    it("returns 'Error' for error events without error_type", () => {
      // Act
      const result = wrapper.vm.getErrorCategory({ type: "error" });

      // Assert
      expect(result).toBe("Error");
    });

    it("returns resource_type for resource events", () => {
      // Act
      const result = wrapper.vm.getErrorCategory({ type: "resource", resource_type: "xhr" });

      // Assert
      expect(result).toBe("xhr");
    });

    it("returns 'Navigation' for view events with view_loading_type=route_change", () => {
      // Act
      const result = wrapper.vm.getErrorCategory({ type: "view", view_loading_type: "route_change" });

      // Assert
      expect(result).toBe("Navigation");
    });

    it("returns 'Reload' for view events with other view_loading_type", () => {
      // Act
      const result = wrapper.vm.getErrorCategory({ type: "view", view_loading_type: "initial_load" });

      // Assert
      expect(result).toBe("Reload");
    });

    it("returns action_type for action events", () => {
      // Act
      const result = wrapper.vm.getErrorCategory({ type: "action", action_type: "click" });

      // Assert
      expect(result).toBe("click");
    });

    it("returns type field for unknown event types", () => {
      // Act
      const result = wrapper.vm.getErrorCategory({ type: "unknown_type" });

      // Assert
      expect(result).toBe("unknown_type");
    });
  });

  // =========================================================================
  // Column accessor functions
  // =========================================================================

  describe("column accessor functions", () => {
    it("category accessorFn delegates to getErrorCategory", () => {
      // Arrange
      const col = wrapper.vm.columns.find((c: any) => c.id === "category");
      const row = { type: "error", error_type: "ReferenceError" };

      // Act
      const result = col.accessorFn(row);

      // Assert
      expect(result).toBe("ReferenceError");
    });

    it("level accessorFn returns 'error' for error type rows", () => {
      // Arrange
      const col = wrapper.vm.columns.find((c: any) => c.id === "level");

      // Act + Assert
      expect(col.accessorFn({ type: "error" })).toBe("error");
    });

    it("level accessorFn returns 'info' for non-error type rows", () => {
      // Arrange
      const col = wrapper.vm.columns.find((c: any) => c.id === "level");

      // Act + Assert
      expect(col.accessorFn({ type: "view" })).toBe("info");
    });

    it("timestamp accessorFn returns formatted date string", () => {
      // Arrange
      const col = wrapper.vm.columns.find((c: any) => c.id === "timestamp");

      // Act
      const result = col.accessorFn({ _timestamp: 1704110400000000 });

      // Assert
      expect(result).toBe("Jan 01, 2024 10:00:00 +0000");
    });
  });

  // =========================================================================
  // Column metadata
  // =========================================================================

  describe("column metadata", () => {
    it("sets cellClass='error-type' for the type column", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "type");

      // Assert
      expect(col.meta.cellClass).toBe("error-type");
    });

    it("sets cellClass='description-column' for the description column", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "description");

      // Assert
      expect(col.meta.cellClass).toBe("description-column");
    });

    it("sets cellClass='error-level' for the level column", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "level");

      // Assert
      expect(col.meta.cellClass).toBe("error-level");
    });
  });

  // =========================================================================
  // Sortable columns
  // =========================================================================

  describe("sortable columns", () => {
    it("marks type column as sortable", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "type");

      // Assert
      expect(col.sortable).toBe(true);
    });

    it("marks category column as sortable", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "category");

      // Assert
      expect(col.sortable).toBe(true);
    });

    it("marks description column as sortable", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "description");

      // Assert
      expect(col.sortable).toBe(true);
    });

    it("marks timestamp column as sortable", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "timestamp");

      // Assert
      expect(col.sortable).toBe(true);
    });

    it("does not mark level column as sortable", () => {
      // Act
      const col = wrapper.vm.columns.find((c: any) => c.id === "level");

      // Assert
      expect(col.sortable).toBeFalsy();
    });
  });

  // =========================================================================
  // Slot integration
  // =========================================================================

  describe("slot integration", () => {
    it("renders ErrorTypeIcons inside cell-type slot", () => {
      // Assert
      expect(wrapper.findComponent({ name: "ErrorTypeIcons" }).exists()).toBe(true);
    });

    it("renders ErrorEventDescription inside cell-description slot", () => {
      // Assert
      expect(wrapper.findComponent({ name: "ErrorEventDescription" }).exists()).toBe(true);
    });

    it("passes first row data to ErrorTypeIcons via column prop", () => {
      // Act
      const icons = wrapper.findComponent({ name: "ErrorTypeIcons" });

      // Assert
      expect(icons.props("column")).toEqual(mockError.events[0]);
    });

    it("passes first row data to ErrorEventDescription via column prop", () => {
      // Act
      const desc = wrapper.findComponent({ name: "ErrorEventDescription" });

      // Assert
      expect(desc.props("column")).toEqual(mockError.events[0]);
    });
  });

  // =========================================================================
  // Props integration
  // =========================================================================

  describe("props integration", () => {
    it("passes columns to OTable", () => {
      // Act
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("columns")).toEqual(wrapper.vm.columns);
    });

    it("passes events data to OTable", () => {
      // Act
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("data")).toEqual(mockError.events);
    });

    it("passes empty array to OTable when events array is empty", async () => {
      // Act
      await wrapper.setProps({ error: { events: [] } });
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("data")).toEqual([]);
    });

    it("passes empty array to OTable when events property is missing", async () => {
      // Act
      await wrapper.setProps({ error: {} });
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("data")).toEqual([]);
    });

    it("passes empty array to OTable when events is null", async () => {
      // Act
      await wrapper.setProps({ error: { events: null } });
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("data")).toEqual([]);
    });
  });

  // =========================================================================
  // Date formatting
  // =========================================================================

  describe("date formatting", () => {
    it("exposes getFormattedDate as a function", () => {
      // Assert
      expect(typeof wrapper.vm.getFormattedDate).toBe("function");
    });

    it("returns formatted date string from getFormattedDate", () => {
      // Act
      const result = wrapper.vm.getFormattedDate(1704110400);

      // Assert
      expect(result).toBe("Jan 01, 2024 10:00:00 +0000");
    });

    it("handles millisecond timestamps by dividing by 1000", () => {
      // Arrange
      const microseconds = 1704110400000000;
      const milliseconds = microseconds / 1000;

      // Act
      const result = wrapper.vm.getFormattedDate(milliseconds);

      // Assert
      expect(result).toBe("Jan 01, 2024 10:00:00 +0000");
    });
  });

  // =========================================================================
  // Props validation
  // =========================================================================

  describe("props validation", () => {
    it("error prop is required", () => {
      // Assert
      expect((ErrorEvents as any).props?.error?.required).toBe(true);
    });

    it("error prop type is Object", () => {
      // Assert
      expect((ErrorEvents as any).props?.error?.type).toBe(Object);
    });

    it("handles custom error structures (uses events array only)", async () => {
      // Arrange
      const customError = {
        events: [{ type: "custom", custom_field: "value", _timestamp: 1704110500000000 }],
        other_field: "ignored",
      };

      // Act
      await wrapper.setProps({ error: customError });
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("data")).toEqual(customError.events);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("getErrorCategory returns the type itself for incomplete row data", () => {
      // Act
      const result = wrapper.vm.getErrorCategory({ type: "incomplete" });

      // Assert
      expect(result).toBe("incomplete");
    });

    it("timestamp accessorFn does not throw for invalid timestamp", () => {
      // Arrange
      const col = wrapper.vm.columns.find((c: any) => c.id === "timestamp");

      // Act + Assert
      expect(() => col.accessorFn({ _timestamp: "invalid" })).not.toThrow();
    });

    it("category accessorFn throws when row is null (expected behaviour)", () => {
      // Arrange
      const col = wrapper.vm.columns.find((c: any) => c.id === "category");

      // Act + Assert
      expect(() => col.accessorFn(null)).toThrow();
    });
  });

  // =========================================================================
  // Performance
  // =========================================================================

  describe("performance", () => {
    it("handles 1000 events without errors", async () => {
      // Arrange
      const largeEvents = Array.from({ length: 1000 }, (_, i) => ({
        type: i % 2 === 0 ? "error" : "view",
        error_type: "TestError" + i,
        _timestamp: 1704110400000000 + i,
      }));

      // Act
      await wrapper.setProps({ error: { events: largeEvents } });
      const oTable = wrapper.findComponent({ name: "OTable" });

      // Assert
      expect(oTable.props("data")).toHaveLength(1000);
    });
  });

  // =========================================================================
  // Component lifecycle
  // =========================================================================

  describe("component lifecycle", () => {
    it("updates OTable data on rapid prop changes", async () => {
      // Arrange
      const events1 = [{ type: "error", _timestamp: 1 }];
      const events2 = [{ type: "view", _timestamp: 2 }];
      const events3 = [{ type: "action", _timestamp: 3 }];

      // Act + Assert
      for (const events of [events1, events2, events3]) {
        await wrapper.setProps({ error: { events } });
        const oTable = wrapper.findComponent({ name: "OTable" });
        expect(oTable.props("data")).toEqual(events);
      }
    });
  });
});
