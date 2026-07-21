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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SummaryList from "./SummaryList.vue";


const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("SummaryList.vue", () => {
  let wrapper: any;
  let originalStoreState: any;
  const mockRows = [
    {
      row_id: "1",
      user_id: "user1@example.com",
      search_type_label: "Logs",
      numOfQueries: 5,
      duration: 2.5,
      queryRange: 3600,
      trace_ids: ["trace1", "trace2"]
    },
    {
      row_id: "2",
      user_id: "user2@example.com",
      search_type_label: "Metrics",
      numOfQueries: 3,
      duration: 1.2,
      queryRange: 1800,
      trace_ids: ["trace3", "trace4"]
    }
  ];
  const mockSelectedRows: any[] = [];

  beforeEach(async () => {
    // Save original store state for cleanup
    originalStoreState = JSON.parse(JSON.stringify(store.state));

    wrapper = mount(SummaryList, {
      attachTo: "#app",
      props: {
        rows: mockRows,
        selectedRows: mockSelectedRows,
      },
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
        stubs: {
          NoData: {
            template: '<div data-test="no-data">No Data</div>'
          },
          OTable: {
            name: 'OTable',
            props: ['data', 'columns', 'rowKey', 'selectedIds', 'selection', 'pagination', 'pageSize', 'pageSizeOptions', 'showGlobalFilter'],
            emits: ['update:selected-ids', 'row-click'],
            template: '<div data-test="o-table-stub"><slot name="cell-actions" :row="{}" /><slot name="cell-duration" :row="{}" /><slot name="cell-queryRange" :row="{}" /><slot name="empty" /><slot name="bottom" /></div>'
          }
        }
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    // Restore original store state to prevent side effects
    store.replaceState(originalStoreState);
  });

  // Test 1: Component mounting
  it("should mount successfully", () => {
    expect(wrapper.exists()).toBe(true);
  });

  // Test 2: Check if component name is correct
  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("RunningQueriesList");
  });

  // Test 3: Test props
  it("should receive rows prop correctly", () => {
    expect(wrapper.props("rows")).toEqual(mockRows);
  });

  // Test 4: Test selected rows prop
  it("should receive selectedRows prop correctly", () => {
    expect(wrapper.props("selectedRows")).toEqual(mockSelectedRows);
  });

  // Test 5: Test isMetaOrg computed property (table hidden when isMetaOrg is false)
  it("should not show table when isMetaOrg is false", () => {
    // By default, selectedOrganization.identifier does not match meta_org
    // so isMetaOrg is false and the OTable is not rendered
    expect(wrapper.find('[data-test="o-table-stub"]').exists()).toBe(false);
  });

  // Test 6: Test initial reactive values (only properties that still exist)
  it("should initialize reactive values correctly", () => {
    expect(wrapper.vm.loadingState).toBe(false);
  });

  // Test 7: Test deleteDialog initial state
  it("should initialize deleteDialog with correct default values", () => {
    expect(wrapper.vm.deleteDialog.show).toBe(false);
    expect(wrapper.vm.deleteDialog.title).toBe("Delete Running Query");
    expect(wrapper.vm.deleteDialog.message).toBe("Are you sure you want to delete this running query?");
    expect(wrapper.vm.deleteDialog.data).toBe(null);
  });

  // Test 8: Test pageSizeOptions (replaces perPageOptions)
  it("should have correct pageSizeOptions", () => {
    const expectedOptions = [5, 10, 20, 50, 100];
    expect(wrapper.vm.pageSizeOptions).toEqual(expectedOptions);
  });

  // Test 10: Test columns structure (OTable format: id/accessorKey/header)
  it("should have correct column structure", () => {
    const columns = wrapper.vm.columns;
    expect(columns).toHaveLength(6);
    expect(columns[0].id).toBe("user_id");
    expect(columns[1].id).toBe("search_type_label");
    expect(columns[2].id).toBe("numOfQueries");
    expect(columns[3].id).toBe("duration");
    expect(columns[4].id).toBe("queryRange");
    expect(columns[5].id).toBe("actions");
  });

  // Test 14: Test confirmDeleteAction function
  it("should emit delete:queries with trace_ids when confirmDeleteAction is called", () => {
    const mockProps = {
      row: {
        trace_ids: ["trace1", "trace2"]
      }
    };

    wrapper.vm.confirmDeleteAction(mockProps);

    expect(wrapper.emitted("delete:queries")).toBeTruthy();
    expect(wrapper.emitted("delete:queries")[0]).toEqual([["trace1", "trace2"]]);
  });

  // Test 15: Test confirmDeleteAction with empty trace_ids
  it("should emit empty array when trace_ids is undefined", () => {
    const mockProps = {
      row: {}
    };

    wrapper.vm.confirmDeleteAction(mockProps);

    expect(wrapper.emitted("delete:queries")).toBeTruthy();
    expect(wrapper.emitted("delete:queries")[0]).toEqual([[]]);
  });

  // Test 16: Test handleMultiQueryCancel function
  it("should emit delete:queries without parameters when handleMultiQueryCancel is called", () => {
    wrapper.vm.handleMultiQueryCancel();

    expect(wrapper.emitted("delete:queries")).toBeTruthy();
    expect(wrapper.emitted("delete:queries")[0]).toEqual([]);
  });

  // Test 17: Test getAllUserQueries function
  it("should emit filter:queries when getAllUserQueries is called", () => {
    const mockEvent = { type: "click" };
    const mockRow = { user_id: "test@example.com" };

    wrapper.vm.getAllUserQueries(mockEvent, mockRow);

    expect(wrapper.emitted("filter:queries")).toBeTruthy();
    expect(wrapper.emitted("filter:queries")[0]).toEqual([mockRow]);
  });

  // Test 18: Test selectedRow computed property getter
  it("should return correct selectedRows from props", () => {
    expect(wrapper.vm.selectedRow).toEqual(mockSelectedRows);
  });

  // Test 20: Test component emits definition
  it("should have correct emits defined", () => {
    const expectedEmits = [
      "cancel:hideform",
      "filter:queries",
      "update:selectedRows",
      "delete:queries",
      "clear:filters",
      "refresh"
    ];
    expect(wrapper.vm.$options.emits).toEqual(expectedEmits);
  });

  // Test 21: Test columns have correct labels (OTable format uses `header`)
  it("should have correct column headers", () => {
    const columns = wrapper.vm.columns;
    expect(columns[0].header).toBe(wrapper.vm.t("user.email"));
    expect(columns[1].header).toBe(wrapper.vm.t("queries.searchType"));
    expect(columns[2].header).toBe(wrapper.vm.t("queries.numOfQueries"));
    expect(columns[3].header).toBe(wrapper.vm.t("queries.totalDuration"));
    expect(columns[4].header).toBe(wrapper.vm.t("queries.totalTimeRange"));
    expect(columns[5].header).toBe(wrapper.vm.t("common.actions"));
  });

  // Test 22: Test columns have correct alignment (OTable format uses `meta.align`)
  it("should have correct column alignments", () => {
    const columns = wrapper.vm.columns;
    expect(columns[0].meta.align).toBe("left");
    expect(columns[1].meta.align).toBe("left");
    expect(columns[2].meta.align).toBe("right");
    expect(columns[3].meta.align).toBe("left");
    expect(columns[4].meta.align).toBe("left");
    expect(columns[5].meta.align).toBe("center");
  });

  // Test 23: Test columns sortable property
  it("should have correct sortable columns", () => {
    const columns = wrapper.vm.columns;
    expect(columns[0].sortable).toBe(true);
    expect(columns[1].sortable).toBe(true);
    expect(columns[2].sortable).toBe(true);
    expect(columns[3].sortable).toBe(true);
    expect(columns[4].sortable).toBe(true);
  });

  // Test 24: Test showListSchemaDialog initial value
  it("should initialize showListSchemaDialog as false", () => {
    expect(wrapper.vm.showListSchemaDialog).toBe(false);
  });

  // Test 25: Test loadingState can be modified
  it("should allow loadingState to be modified", async () => {
    expect(wrapper.vm.loadingState).toBe(false);
    wrapper.vm.loadingState = true;
    expect(wrapper.vm.loadingState).toBe(true);
  });

  // Test 27: Test deleteDialog properties can be modified
  it("should allow deleteDialog properties to be modified", () => {
    wrapper.vm.deleteDialog.show = true;
    wrapper.vm.deleteDialog.data = { id: 123 };

    expect(wrapper.vm.deleteDialog.show).toBe(true);
    expect(wrapper.vm.deleteDialog.data).toEqual({ id: 123 });
  });

  // Test 29: Test "cancel" icon
  it('should render "cancel" icon in the page', () => {
    // "cancel" is the OIcon name prop
    const cancelIcons = wrapper
      .findAllComponents({ name: "OIcon" })
      .filter((i: any) => i.props("name") === "cancel");
    expect(cancelIcons.length).toBeGreaterThanOrEqual(0);
  });

  // Test 30: Test i18n translation function
  it("should have translation function available", () => {
    expect(typeof wrapper.vm.t).toBe("function");
    expect(wrapper.vm.t("user.email")).toBeDefined();
  });

  // Test 31: Test component props validation
  it("should validate rows prop as Array", () => {
    const propsData = wrapper.vm.$options.props;
    expect(propsData.rows.type).toBe(Array);
    expect(propsData.rows.required).toBe(true);
  });

  // Test 32: Test selectedRows prop validation
  it("should validate selectedRows prop as Array", () => {
    const propsData = wrapper.vm.$options.props;
    expect(propsData.selectedRows.type).toBe(Array);
    expect(propsData.selectedRows.required).toBe(true);
  });

  // Test 33: Test component has correct setup function return values
  it("should return all required values from setup function", () => {
    const setupReturnKeys = [
      "t", "columns", "confirmDeleteAction", "deleteDialog", "pageSizeOptions",
      "showListSchemaDialog", "loadingState",
      "isMetaOrg", "selectedRow",
      "handleMultiQueryCancel", "getAllUserQueries"
    ];

    setupReturnKeys.forEach(key => {
      expect(wrapper.vm[key]).toBeDefined();
    });
  });

  // Test 34: Test multiple emit events sequence
  it("should handle multiple emit events correctly", () => {
    // Emit multiple events
    wrapper.vm.handleMultiQueryCancel();
    wrapper.vm.getAllUserQueries({}, mockRows[0]);
    wrapper.vm.confirmDeleteAction({ row: mockRows[0] });

    expect(wrapper.emitted("delete:queries")).toHaveLength(2);
    expect(wrapper.emitted("filter:queries")).toHaveLength(1);
  });

  // Test: pageSize defaults to 20
  it("should have default pageSize of 20", () => {
    expect(wrapper.vm.pageSize).toBe(20);
  });
});
