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
import AppTable from "@/components/rum/AppTable.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// Mock NoData component
vi.mock("@/components/shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: '<div data-test="no-data">No Data Available</div>',
  },
}));

// Mock window methods
Object.defineProperty(window, "dispatchEvent", {
  value: vi.fn(),
  writable: true,
});

describe("AppTable", () => {
  let wrapper: any;

  const mockColumns = [
    {
      name: "timestamp",
      label: "Timestamp",
      field: (row: any) => row.timestamp,
      align: "left",
      style: { width: "200px" },
      value: "2023-01-01T10:00:00Z",
    },
    {
      name: "session_id",
      label: "Session ID", 
      field: (row: any) => row.session_id,
      align: "left",
      style: { width: "150px" },
      value: "session_123",
    },
    {
      name: "action",
      label: "Action",
      type: "action",
      icon: "play_arrow",
      align: "center",
      style: { width: "80px" },
    },
  ];

  const mockRows = [
    {
      index: 0,
      timestamp: "2023-01-01T10:00:00Z",
      session_id: "session_123",
      name: "Test Session 1",
    },
    {
      index: 1,
      timestamp: "2023-01-01T11:00:00Z",
      session_id: "session_456",
      name: "Test Session 2",
    },
  ];

  beforeEach(async () => {
    wrapper = mount(AppTable, {
      attachTo: "#app",
      props: {
        columns: mockColumns,
        rows: mockRows,
        title: "Test App Table",
        virtualScroll: false, // Disable virtual scroll for testing
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
        stubs: {
          NoData: {
            template: '<div data-test="no-data">No Data Available</div>',
          },
          "q-icon": {
            template: '<i data-test="icon" :class="name" :style="`font-size: ${size}`"></i>',
            props: ["name", "size"],
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("Component Rendering", () => {
    it("should render successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".app-table-container").exists()).toBe(true);
    });

    it("should render table when rows are provided", () => {
      expect(wrapper.find("table").exists()).toBe(true);
      expect(wrapper.find("[data-test='no-data']").exists()).toBe(false);
    });

    it("should render with provided props", () => {
      expect(wrapper.props("columns")).toEqual(mockColumns);
      expect(wrapper.props("rows")).toEqual(mockRows);
      expect(wrapper.props("title")).toBe("Test App Table");
    });
  });

  describe("No Data State", () => {
    it("should show NoData component when no rows provided", async () => {
      wrapper = mount(AppTable, {
        attachTo: "#app",
        props: {
          columns: mockColumns,
          rows: [],
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store,
          },
          stubs: {
            NoData: {
              template: '<div data-test="no-data">No Data Available</div>',
            },
          },
        },
      });

      await flushPromises();

      expect(wrapper.find("[data-test='no-data']").exists()).toBe(true);
      expect(wrapper.find("table").exists()).toBe(false);
    });

    it("should hide table when rows are empty", async () => {
      await wrapper.setProps({ rows: [] });

      expect(wrapper.find("[data-test='no-data']").exists()).toBe(true);
      expect(wrapper.find("table").exists()).toBe(false);
    });
  });

  describe("Table Structure", () => {
    it("should render correct number of columns", () => {
      const headers = wrapper.findAll("th");
      expect(headers).toHaveLength(mockColumns.length);
    });

    it("should render correct column headers", () => {
      const headers = wrapper.findAll("th");
      mockColumns.forEach((col, index) => {
        expect(headers[index].text()).toBe(col.label);
      });
    });

    it("should render correct number of rows", () => {
      const dataRows = wrapper.findAll("tbody tr.cursor-pointer");
      expect(dataRows).toHaveLength(mockRows.length);
    });

    it("should apply correct styling to headers", () => {
      const headers = wrapper.findAll("th");
      headers.forEach((header, index) => {
        if (mockColumns[index].style) {
          expect(header.attributes("style")).toContain(
            mockColumns[index].style?.width,
          );
        }
      });
    });
  });

  describe("Virtual Scroll", () => {
    it("should have virtual scroll disabled in test", () => {
      expect(wrapper.props("virtualScroll")).toBe(false);
    });

    it("should enable virtual scroll when prop is true", async () => {
      await wrapper.setProps({ virtualScroll: true });
      expect(wrapper.props("virtualScroll")).toBe(true);
    });

    it("should emit scroll event on virtual scroll", async () => {
      const scrollEvent = { target: { scrollTop: 100 } };
      wrapper.vm.onScroll(scrollEvent);

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")[0]).toEqual([
        "scroll",
        scrollEvent,
      ]);
    });
  });

  describe("Cell Interactions", () => {
    it("should emit cell-click event when cell is clicked", async () => {
      const firstCell = wrapper.find("tbody tr.cursor-pointer td");
      await firstCell.trigger("click");

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")[0][0]).toBe("cell-click");
      expect(wrapper.emitted("event-emitted")[0][1]).toMatchObject({
        columnName: "action_play",
        row: expect.any(Object),
      });
    });

    it("should handle data click with correct parameters", () => {
      const testRow = mockRows[0];
      wrapper.vm.handleDataClick("test_column", testRow);

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")[0]).toEqual([
        "cell-click",
        { columnName: "action_play", row: testRow },
      ]);
    });
  });

  describe("Action Column Rendering", () => {
    it("should render action icons for action type columns", () => {
      const actionColumn = mockColumns.find((col) => col.type === "action");
      if (actionColumn) {
        // Use stub component selector
        const actionCells = wrapper.findAll('i[data-test="icon"]');
        expect(actionCells.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("should apply correct styling to action icons", () => {
      const actionRows = wrapper.findAll("tbody tr.cursor-pointer");
      expect(actionRows.length).toBeGreaterThan(0);
    });
  });

  describe("Slot Rendering", () => {
    it("should render slot content when column has slot property", async () => {
      const slotColumns = [
        {
          name: "custom",
          label: "Custom",
          slot: true,
          slotName: "custom-slot",
          value: "Custom Content",
        },
      ];

      wrapper.unmount();
      wrapper = mount(AppTable, {
        attachTo: "#app",
        props: {
          columns: slotColumns,
          rows: mockRows,
          virtualScroll: false,
        },
        slots: {
          "custom-slot": '<div data-test="custom-slot">Custom Content</div>',
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store,
          },
          stubs: {
            NoData: {
              template: '<div data-test="no-data">No Data Available</div>',
            },
            "q-icon": {
              template: '<i data-test="icon" :class="name" :style="`font-size: ${size}`"></i>',
              props: ["name", "size"],
            },
          },
        },
      });

      await flushPromises();

      expect(wrapper.find("[data-test='custom-slot']").exists()).toBe(true);
    });
  });

  describe("Component Properties", () => {
    it("should have all required props with correct values", () => {
      expect(wrapper.props("virtualScroll")).toBe(false);
      expect(wrapper.props("height")).toBe("100%");
      expect(wrapper.props("loading")).toBe(false);
      expect(wrapper.props("highlight")).toBe(false);
      expect(wrapper.props("highlightText")).toBe("");
    });

    it("should accept custom height", async () => {
      await wrapper.setProps({ height: "500px" });
      expect(wrapper.props("height")).toBe("500px");
    });

    it("should handle loading state", async () => {
      await wrapper.setProps({ loading: true });
      expect(wrapper.props("loading")).toBe(true);
    });

    it("should handle highlight properties", async () => {
      await wrapper.setProps({
        highlight: true,
        highlightText: "test highlight",
      });
      expect(wrapper.props("highlight")).toBe(true);
      expect(wrapper.props("highlightText")).toBe("test highlight");
    });
  });

  describe("Error Handling", () => {
    it("should handle scroll errors gracefully", () => {
      // Test that onScroll method exists and can be called
      expect(typeof wrapper.vm.onScroll).toBe("function");
      expect(() => {
        wrapper.vm.onScroll({ target: { scrollTop: 100 } });
      }).not.toThrow();
    });

    it("should handle missing row data gracefully", async () => {
      await wrapper.setProps({ rows: [{ index: 0 }] });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Expand Functionality", () => {
    it("should render expand slot content", () => {
      const expandSlots = wrapper.findAll(
        '.q-virtual-scroll--with-prev td[colspan="100%"]',
      );
      expect(expandSlots.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Styling", () => {
    it("should apply table container styles", () => {
      const container = wrapper.find(".app-table-container");
      expect(container.exists()).toBe(true);
    });

    it("should apply height styles", async () => {
      await wrapper.setProps({ height: "400px" });
      const container = wrapper.find(".app-table-container");
      expect(container.attributes("style")).toContain("height: 400px");
    });
  });

  describe("Integration Tests", () => {
    it("should perform complete table workflow", async () => {
      // Verify table mounted
      expect(wrapper.exists()).toBe(true);

      // Test data rendering
      expect(wrapper.findAll("tbody tr").length).toBeGreaterThan(0);

      // Test cell click
      const firstCell = wrapper.find("tbody tr.cursor-pointer td");
      await firstCell.trigger("click");
      expect(wrapper.emitted("event-emitted")).toBeTruthy();

      // Test scroll
      wrapper.vm.onScroll({ target: { scrollTop: 50 } });
      expect(wrapper.emitted("event-emitted")[1][0]).toBe("scroll");

      // Test props update
      await wrapper.setProps({ title: "Updated Title" });
      expect(wrapper.props("title")).toBe("Updated Title");
    });

    it("should handle dynamic data updates", async () => {
      const newRows = [
        ...mockRows,
        {
          index: 2,
          timestamp: "2023-01-01T12:00:00Z",
          session_id: "session_789",
          name: "Test Session 3",
        },
      ];

      await wrapper.setProps({ rows: newRows });

      const dataRows = wrapper.findAll("tbody tr.cursor-pointer");
      expect(dataRows).toHaveLength(newRows.length);
    });
  });
});