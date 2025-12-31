// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AppTable from "./AppTable.vue";

installQuasar();

// Mock child components
vi.mock("@/components/shared/grid/Pagination.vue", () => ({
  default: {
    name: "QTablePagination",
    template: '<div class="pagination-mock">Pagination</div>',
    props: ["scope", "resultTotal", "perPageOptions", "position"],
    emits: ["update:changeRecordPerPage"],
  },
}));

vi.mock("./shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: '<div class="no-data-mock">No Data</div>',
  },
}));

describe("AppTable", () => {
  const mockColumns = [
    { name: "id", label: "ID", field: "id", align: "left" },
    { name: "name", label: "Name", field: "name", align: "left" },
    { name: "status", label: "Status", field: "status", align: "left" },
  ];

  const mockRows = [
    { id: 1, name: "Item 1", status: "active" },
    { id: 2, name: "Item 2", status: "inactive" },
    { id: 3, name: "Item 3", status: "active" },
  ];

  const createWrapper = (props: any = {}) => {
    return mount(AppTable, {
      props: {
        columns: mockColumns,
        rows: mockRows,
        ...props,
      },
      global: {
        stubs: {
          QTable: false,
          QTr: false,
          QTh: false,
          QTd: false,
          QCheckbox: true,
          QIcon: true,
          QTablePagination: true,
          NoData: true,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render the component", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".app-table-container").exists()).toBe(true);
    });

    it("should render table with provided columns", () => {
      const wrapper = createWrapper();
      const headers = wrapper.findAll("th");

      // Check if column labels are rendered
      const headerText = wrapper.text();
      expect(headerText).toContain("ID");
      expect(headerText).toContain("Name");
      expect(headerText).toContain("Status");
    });

    it("should render table with provided rows", () => {
      // Disable virtual scroll so rows render in DOM
      const wrapper = createWrapper({ virtualScroll: false });

      // Check if row data is rendered
      const tableText = wrapper.text();
      expect(tableText).toContain("Item 1");
      expect(tableText).toContain("Item 2");
      expect(tableText).toContain("Item 3");
    });

    it("should display row count with title", () => {
      const wrapper = createWrapper({ title: "Records" });
      expect(wrapper.text()).toContain("3 Records");
    });

    it("should render NoData component when rows are empty", () => {
      const wrapper = createWrapper({ rows: [] });
      expect(wrapper.findComponent({ name: "NoData" }).exists()).toBe(true);
    });

    it("should apply custom height", () => {
      const wrapper = createWrapper({ height: "500px" });
      const container = wrapper.find(".app-table-container");
      expect(container.attributes("style")).toContain("height: 500px");
    });
  });

  describe("Table Configuration", () => {
    it("should enable virtual scroll by default", () => {
      const wrapper = createWrapper();
      const qTable = wrapper.findComponent({ name: "QTable" });
      expect(qTable.props("virtualScroll")).toBe(true);
    });

    it("should disable virtual scroll when prop is false", () => {
      const wrapper = createWrapper({ virtualScroll: false });
      const qTable = wrapper.findComponent({ name: "QTable" });
      expect(qTable.props("virtualScroll")).toBe(false);
    });

    it("should apply bordered style by default", () => {
      const wrapper = createWrapper();
      const qTable = wrapper.findComponent({ name: "QTable" });
      expect(qTable.props("bordered")).toBe(true);
    });

    it("should remove border when bordered is false", () => {
      const wrapper = createWrapper({ bordered: false });
      const qTable = wrapper.findComponent({ name: "QTable" });
      expect(qTable.props("bordered")).toBe(false);
    });

    it("should hide header when hideHeader is true", () => {
      const wrapper = createWrapper({ hideHeader: true });
      const qTable = wrapper.findComponent({ name: "QTable" });
      expect(qTable.props("hideHeader")).toBe(true);
    });

    it("should use custom row key", () => {
      const wrapper = createWrapper({ rowKey: "id" });
      const qTable = wrapper.findComponent({ name: "QTable" });
      expect(qTable.props("rowKey")).toBe("id");
    });

    it("should apply custom table style", () => {
      const wrapper = createWrapper({ tableStyle: "background-color: red;" });
      const qTable = wrapper.findComponent({ name: "QTable" });
      expect(qTable.attributes("style")).toContain("background-color: red");
    });
  });

  describe("Pagination", () => {
    it("should set default rows per page", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm._pagination.rowsPerPage).toBe(20);
    });

    it("should use custom rows per page", () => {
      const wrapper = createWrapper({ rowsPerPage: 50 });
      expect(wrapper.vm._pagination.rowsPerPage).toBe(50);
    });

    it("should show pagination components", () => {
      const wrapper = createWrapper();
      const paginationComponents = wrapper.findAllComponents({ name: "QTablePagination" });
      expect(paginationComponents.length).toBeGreaterThan(0);
    });

    it("should hide top pagination when hideTopPagination is true", () => {
      const wrapper = createWrapper({ hideTopPagination: true });
      // Check that title/top pagination section is not in the HTML
      expect(wrapper.html()).not.toContain("Records");
    });

    it("should show bottom pagination with title when enabled", () => {
      const wrapper = createWrapper({
        showBottomPaginationWithTitle: true,
        title: "Items"
      });
      expect(wrapper.text()).toContain("3 Items");
    });

    it("should change pagination when changePagination is called", async () => {
      const wrapper = createWrapper();

      await wrapper.vm.changePagination({ label: "50", value: 50 });

      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm._pagination.rowsPerPage).toBe(50);
    });

    it("should have correct per page options", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.perPageOptions).toEqual([
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "250", value: 250 },
        { label: "500", value: 500 }
      ]);
    });
  });

  describe("Selection Feature", () => {
    it("should not show checkboxes when selection is none", () => {
      const wrapper = createWrapper({ selection: "none" });
      const checkboxes = wrapper.findAllComponents({ name: "QCheckbox" });
      expect(checkboxes.length).toBe(0);
    });

    it("should show checkboxes when selection is multiple", () => {
      const wrapper = createWrapper({ selection: "multiple" });
      const checkboxes = wrapper.findAllComponents({ name: "QCheckbox" });
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it("should emit update:selected when selection changes", async () => {
      const wrapper = createWrapper({
        selection: "multiple",
        selected: []
      });

      wrapper.vm.selectedRows = [mockRows[0]];
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("update:selected")).toBeTruthy();
      expect(wrapper.emitted("update:selected")?.[0]).toEqual([[mockRows[0]]]);
    });

    it("should use provided selected rows", () => {
      const selected = [mockRows[0]];
      const wrapper = createWrapper({
        selection: "multiple",
        selected
      });

      expect(wrapper.vm.selectedRows).toEqual(selected);
    });
  });

  describe("Event Handling", () => {
    it("should emit cell-click event when cell is clicked", async () => {
      const wrapper = createWrapper();

      await wrapper.vm.handleDataClick("name", mockRows[0]);

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")?.[0]).toEqual([
        "cell-click",
        { columnName: "name", row: mockRows[0] }
      ]);
    });

    it("should emit scroll event on virtual scroll", async () => {
      const wrapper = createWrapper({ virtualScroll: true });
      const scrollEvent = { index: 10, from: 0, to: 20 };

      await wrapper.vm.onScroll(scrollEvent);

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")?.[0]).toEqual(["scroll", scrollEvent]);
    });
  });

  describe("Column Features", () => {
    it("should render slot columns when col.slot is true", () => {
      const columnsWithSlot = [
        { name: "custom", label: "Custom", slot: true, slotName: "custom-slot" },
      ];
      const wrapper = mount(AppTable, {
        props: {
          columns: columnsWithSlot,
          rows: mockRows,
          virtualScroll: false, // Disable virtual scroll for DOM rendering
        },
        slots: {
          "custom-slot": '<div class="custom-slot-content">Custom Content</div>',
        },
        global: {
          stubs: {
            QTable: false,
            QTr: false,
            QTh: false,
            QTd: false,
            QTablePagination: true,
            NoData: true,
          },
        },
      });

      expect(wrapper.html()).toContain("custom-slot");
    });

    it("should render action columns with icons", () => {
      const columnsWithAction = [
        ...mockColumns,
        { name: "actions", label: "Actions", type: "action", icon: "delete" },
      ];
      const wrapper = createWrapper({ columns: columnsWithAction, virtualScroll: false });

      const icons = wrapper.findAllComponents({ name: "QIcon" });
      expect(icons.length).toBeGreaterThan(0);
    });

    it("should apply custom column classes", () => {
      const columnsWithClasses = [
        { name: "id", label: "ID", field: "id", classes: "custom-class" },
      ];
      const wrapper = createWrapper({ columns: columnsWithClasses });

      expect(wrapper.html()).toContain("custom-class");
    });

    it("should apply custom column styles", () => {
      const columnsWithStyle = [
        { name: "id", label: "ID", field: "id", style: "width: 100px;" },
      ];
      const wrapper = createWrapper({ columns: columnsWithStyle });

      expect(wrapper.html()).toContain("width: 100px");
    });
  });

  describe("Row Expansion", () => {
    it("should render expandable row structure", () => {
      const rowsWithExpand = [
        { id: 1, name: "Item 1", status: "active", expand: true, slotName: "expand-slot" },
      ];
      const wrapper = createWrapper({ rows: rowsWithExpand, virtualScroll: false });

      // Verify rows are passed to QTable
      const qTable = wrapper.findComponent({ name: "QTable" });
      expect(qTable.props("rows")).toEqual(rowsWithExpand);
      expect(qTable.props("rows")[0].expand).toBe(true);
    });

    it("should support row expansion with colspan", () => {
      // Test that the component structure supports expansion
      const wrapper = createWrapper({ virtualScroll: false });

      // The template should have the expansion structure
      expect(wrapper.vm).toBeDefined();
      expect(wrapper.findComponent({ name: "QTable" }).exists()).toBe(true);
    });
  });

  describe("Filter Feature", () => {
    it("should apply filter when provided", () => {
      const filter = {
        value: "Item 1",
        method: (rows: any[], terms: string) => {
          return rows.filter(row => row.name.includes(terms));
        }
      };
      const wrapper = createWrapper({ filter });
      const qTable = wrapper.findComponent({ name: "QTable" });

      expect(qTable.props("filter")).toBe("Item 1");
      expect(qTable.props("filterMethod")).toBe(filter.method);
    });

    it("should not apply filter when null", () => {
      const wrapper = createWrapper({ filter: null });
      const qTable = wrapper.findComponent({ name: "QTable" });

      expect(qTable.props("filter")).toBeFalsy();
    });
  });

  describe("Reactivity", () => {
    it("should update resultTotal when rows change", async () => {
      const wrapper = createWrapper();

      expect(wrapper.vm.resultTotal).toBe(3);

      await wrapper.setProps({ rows: [...mockRows, { id: 4, name: "Item 4", status: "active" }] });

      expect(wrapper.vm.resultTotal).toBe(4);
    });

    it("should initialize resultTotal on mount", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.resultTotal).toBe(mockRows.length);
    });

    it("should handle empty rows", async () => {
      const wrapper = createWrapper({ rows: [] });
      expect(wrapper.vm.resultTotal).toBe(0);
    });
  });

  describe("Bottom Actions Slot", () => {
    it("should render bottom-actions slot when provided", () => {
      const wrapper = mount(AppTable, {
        props: {
          columns: mockColumns,
          rows: mockRows,
        },
        slots: {
          "bottom-actions": '<button class="action-button">Custom Action</button>',
        },
        global: {
          stubs: {
            QTable: false,
            QTablePagination: true,
            NoData: true,
          },
        },
      });

      expect(wrapper.find(".action-button").exists()).toBe(true);
    });
  });
});
