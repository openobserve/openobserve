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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SummaryList from "./SummaryList.vue";

installQuasar({
  plugins: [Dialog, Notify],
});

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
      duration: "2.5s",
      queryRange: "1h",
      trace_ids: ["trace1", "trace2"]
    },
    {
      row_id: "2", 
      user_id: "user2@example.com",
      search_type_label: "Metrics",
      numOfQueries: 3,
      duration: "1.2s",
      queryRange: "30m",
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

  // Test 5: Test isMetaOrg computed property
  it("should show table when isMetaOrg is true", async () => {
    // Use commit to properly update store state
    store.commit('setConfig', {
      ...store.state.zoConfig,
      meta_org: "default"
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="running-queries-table"]').exists()).toBe(true);
  });

  // Test 6: Test initial reactive values
  it("should initialize reactive values correctly", () => {
    expect(wrapper.vm.resultTotal).toBe(0);
    expect(wrapper.vm.loadingState).toBe(false);
    expect(wrapper.vm.selectedPerPage).toBe(20);
  });

  // Test 7: Test deleteDialog initial state
  it("should initialize deleteDialog with correct default values", () => {
    expect(wrapper.vm.deleteDialog.show).toBe(false);
    expect(wrapper.vm.deleteDialog.title).toBe("Delete Running Query");
    expect(wrapper.vm.deleteDialog.message).toBe("Are you sure you want to delete this running query?");
    expect(wrapper.vm.deleteDialog.data).toBe(null);
  });

  // Test 8: Test perPageOptions
  it("should have correct perPageOptions", () => {
    const expectedOptions = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
    ];
    expect(wrapper.vm.perPageOptions).toEqual(expectedOptions);
  });

  // Test 9: Test initial pagination state
  it("should initialize pagination correctly", () => {
    expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
  });

  // Test 10: Test columns structure
  it("should have correct column structure", () => {
    const columns = wrapper.vm.columns;
    expect(columns).toHaveLength(7);
    expect(columns[0].name).toBe("#");
    expect(columns[1].name).toBe("user_id");
    expect(columns[2].name).toBe("search_type_label");
    expect(columns[3].name).toBe("numOfQueries");
    expect(columns[4].name).toBe("duration");
    expect(columns[5].name).toBe("queryRange");
    expect(columns[6].name).toBe("actions");
  });

  // Test 11: Test changePagination function
  it("should update pagination when changePagination is called", async () => {
    const mockQTable = {
      setPagination: vi.fn()
    };
    wrapper.vm.qTable = mockQTable;
    
    const newPaginationValue = { label: "50", value: 50 };
    wrapper.vm.changePagination(newPaginationValue);
    
    expect(wrapper.vm.selectedPerPage).toBe(50);
    expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    expect(mockQTable.setPagination).toHaveBeenCalledWith(wrapper.vm.pagination);
  });

  // Test 12: Test changePagination with different values
  it("should handle different pagination values", async () => {
    const mockQTable = {
      setPagination: vi.fn()
    };
    wrapper.vm.qTable = mockQTable;
    
    const testValues = [
      { label: "5", value: 5 },
      { label: "100", value: 100 }
    ];
    
    for (const val of testValues) {
      wrapper.vm.changePagination(val);
      expect(wrapper.vm.selectedPerPage).toBe(val.value);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(val.value);
    }
  });

  // Test 13: Test changePagination when qTable is null
  it("should handle changePagination when qTable is null", () => {
    wrapper.vm.qTable = null;
    const newPaginationValue = { label: "10", value: 10 };
    
    expect(() => {
      wrapper.vm.changePagination(newPaginationValue);
    }).not.toThrow();
    
    expect(wrapper.vm.selectedPerPage).toBe(10);
    expect(wrapper.vm.pagination.rowsPerPage).toBe(10);
  });

  // Test 14: Test confirmDeleteAction function
  it("should emit delete:queries when confirmDeleteAction is called", () => {
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

  // Test 19: Test selectedRow computed property setter
  it("should emit update:selectedRows when selectedRow is set", () => {
    const newSelectedRows = [mockRows[0]];
    wrapper.vm.selectedRow = newSelectedRows;
    
    expect(wrapper.emitted("update:selectedRows")).toBeTruthy();
    expect(wrapper.emitted("update:selectedRows")[0]).toEqual([newSelectedRows]);
  });

  // Test 20: Test component emits definition
  it("should have correct emits defined", () => {
    const expectedEmits = [
      "cancel:hideform",
      "filter:queries", 
      "update:selectedRows",
      "delete:queries"
    ];
    expect(wrapper.vm.$options.emits).toEqual(expectedEmits);
  });

  // Test 21: Test columns have correct labels
  it("should have correct column labels", () => {
    const columns = wrapper.vm.columns;
    expect(columns[1].label).toBe(wrapper.vm.t("user.email"));
    expect(columns[2].label).toBe(wrapper.vm.t("queries.searchType"));
    expect(columns[3].label).toBe(wrapper.vm.t("queries.numOfQueries"));
    expect(columns[4].label).toBe(wrapper.vm.t("queries.totalDuration"));
    expect(columns[5].label).toBe(wrapper.vm.t("queries.totalTimeRange"));
    expect(columns[6].label).toBe(wrapper.vm.t("common.actions"));
  });

  // Test 22: Test columns have correct alignment
  it("should have correct column alignments", () => {
    const columns = wrapper.vm.columns;
    expect(columns[0].align).toBe("left");
    expect(columns[1].align).toBe("left");
    expect(columns[2].align).toBe("left");
    expect(columns[3].align).toBe("left");
    expect(columns[4].align).toBe("left");
    expect(columns[5].align).toBe("left");
    expect(columns[6].align).toBe("center");
  });

  // Test 23: Test columns sortable property
  it("should have correct sortable columns", () => {
    const columns = wrapper.vm.columns;
    expect(columns[1].sortable).toBe(true);
    expect(columns[2].sortable).toBe(true);
    expect(columns[3].sortable).toBe(true);
    expect(columns[4].sortable).toBe(true);
    expect(columns[5].sortable).toBe(true);
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

  // Test 26: Test resultTotal can be modified
  it("should allow resultTotal to be modified", () => {
    expect(wrapper.vm.resultTotal).toBe(0);
    wrapper.vm.resultTotal = 100;
    expect(wrapper.vm.resultTotal).toBe(100);
  });

  // Test 27: Test deleteDialog properties can be modified
  it("should allow deleteDialog properties to be modified", () => {
    wrapper.vm.deleteDialog.show = true;
    wrapper.vm.deleteDialog.data = { id: 123 };
    
    expect(wrapper.vm.deleteDialog.show).toBe(true);
    expect(wrapper.vm.deleteDialog.data).toEqual({ id: 123 });
  });

  // Test 28: Test qTable ref assignment
  it("should allow qTable ref to be assigned", () => {
    const mockTable = { test: "table" };
    wrapper.vm.qTable = mockTable;
    expect(wrapper.vm.qTable).toEqual(mockTable);
  });

  // Test 29: Test outlinedCancel icon
  it("should have outlinedCancel icon available", () => {
    expect(wrapper.vm.outlinedCancel).toBeDefined();
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
      "t", "columns", "confirmDeleteAction", "deleteDialog", "perPageOptions",
      "showListSchemaDialog", "changePagination", "outlinedCancel", "loadingState",
      "isMetaOrg", "resultTotal", "selectedPerPage", "qTable", "selectedRow",
      "handleMultiQueryCancel", "pagination", "getAllUserQueries"
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

  // Test 35: Test pagination object structure
  it("should have correct pagination object structure", () => {
    const pagination = wrapper.vm.pagination;
    expect(typeof pagination).toBe("object");
    expect(pagination.rowsPerPage).toBe(20);
  });
});