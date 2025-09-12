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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify, QTable } from "quasar";
import RunningQueries from "@/components/queries/RunningQueries.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import SearchService from "@/services/search";

// Mock SearchService
vi.mock("@/services/search", () => ({
  default: {
    get_running_queries: vi.fn(),
    delete_running_queries: vi.fn(),
  },
}));

// Mock composables
vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({ isMetaOrg: true }),
}));

installQuasar({
  plugins: [Dialog, Notify],
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("RunningQueries", () => {
  let wrapper: any = null;
  const mockQueries = [
    {
      trace_id: "trace-1",
      user_id: "user@example.com",
      org_id: "org-1",
      search_type: "dashboards",
      search_type_label: "dashboards",
      created_at: 1640995200000000,
      started_at: 1640995200000000,
      status: "running",
      work_group: "default",
      stream_type: "logs",
      query: {
        start_time: 1640995200000000,
        end_time: 1640995260000000,
        sql: "SELECT * FROM logs",
      },
      scan_stats: {
        files: 10,
        records: 100,
        original_size: 1024,
        compressed_size: 512,
      },
      search_event_context: {
        dashboard_name: "MyDashboard",
        dashboard_folder: "MyDashboardFolder",
      }
    },
    {
      trace_id: "trace-2",
      user_id: "user2@example.com",
      org_id: "org-1",
      search_type: "ui",
      search_type_label: "ui",
      created_at: 1640995260000000,
      started_at: 1640995260000000,
      status: "completed",
      work_group: "default",
      stream_type: "metrics",
      query: {
        start_time: 1640995200000000,
        end_time: 1640995320000000,
        sql: "SELECT * FROM metrics",
      },
      scan_stats: {
        files: 5,
        records: 50,
        original_size: 512,
        compressed_size: 256,
      },
    },
    {
      trace_id: "trace-1",
      user_id: "user@example.com",
      org_id: "org-1",
      search_type: "alerts",
      search_type_label: "alerts",
      created_at: 1640995200000000,
      started_at: 1640995200000000,
      status: "running",
      work_group: "default",
      stream_type: "alerts",
      query: {
        start_time: 1640995200000000,
        end_time: 1640995260000000,
        sql: "SELECT * FROM logs",
      },
      scan_stats: {
        files: 10,
        records: 100,
        original_size: 1024,
        compressed_size: 512,
      },
      search_event_context: {
        alert_name: "MyALert",
        alert_key: "/alerts/_meta/logs/default/MyAlert",
      }
    },
  ];

  beforeEach(async () => {
    // Mock the store state
    store.state.zoConfig = {
      ...store.state.zoConfig,
      meta_org: "test-org",
    };

    vi.clearAllMocks();
    
    // Mock successful API response
    (SearchService.get_running_queries as any).mockResolvedValue({
      data: {
        status: mockQueries,
      },
    });

    wrapper = mount(RunningQueries, {
      attachTo: "#app",
      global: {
        plugins: [i18n],
        provide: {
          store: store,
        },
        mocks: {
          $store: store,
          $q: {
            notify: vi.fn(() => vi.fn()), // Returns a dismiss function
          },
        },
        stubs: {
          "q-table": QTable,
          "q-btn": true,
          "q-input": true,
          "q-select": true,
          "q-tab": true,
          "q-tab-panel": true,
          "q-tab-panels": true,
          "q-tabs": true,
          "q-dialog": true,
          "q-card": true,
          "q-card-section": true,
          "q-card-actions": true,
          "q-separator": true,
          "q-icon": true,
          "q-tooltip": true,
          "q-badge": true,
          "q-chip": true,
          "confirm-dialog": true,
          "query-list": true,
          "running-queries-list": true,
          "summary-list": true,
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // Test 1: Component initialization
  it("should initialize component with correct default values", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm.selectedQueryTypeTab).toBe("summary");
    expect(wrapper.vm.selectedSearchType).toBe("dashboards");
    expect(wrapper.vm.selectedSearchField).toBe("all");
    expect(wrapper.vm.selectedPerPage).toBe(20);
    expect(wrapper.vm.filterQuery).toBe("");
  });

  // Test 2: Component props and data
  it("should have correct initial data structure", () => {
    expect(wrapper.vm.selectedRow).toEqual({
      all: [],
      summary: [],
    });
    expect(wrapper.vm.searchFieldOptions).toHaveLength(3);
    expect(wrapper.vm.runningQueryTypes).toHaveLength(2);
    expect(wrapper.vm.perPageOptions).toHaveLength(5);
  });

  // Test 3: refreshData function
  it("should call refreshData and update lastRefreshed", () => {
    // Test that refreshData updates lastRefreshed with a proper time format
    wrapper.vm.refreshData();
    
    expect(wrapper.vm.lastRefreshed).toBeTruthy();
    expect(wrapper.vm.lastRefreshed).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
  });

  // Test 4: getCurrentTime function
  it("should format current time correctly", () => {
    const currentTime = wrapper.vm.getCurrentTime();
    expect(currentTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
  });

  // Test 5: localTimeToMicroseconds function
  it("should convert current time to microseconds", () => {
    const microseconds = wrapper.vm.localTimeToMicroseconds();
    expect(typeof microseconds).toBe("number");
    expect(microseconds).toBeGreaterThan(0);
  });

  // Test 6: getDuration function
  it("should calculate duration correctly", () => {
    const createdAt = Date.now() * 1000 - 5000000; // 5 seconds ago
    const duration = wrapper.vm.getDuration(createdAt);
    
    expect(duration).toHaveProperty("durationInSeconds");
    expect(duration).toHaveProperty("duration");
    expect(duration.durationInSeconds).toBeGreaterThan(0);
  });

  // Test 7: queryRange function
  it("should calculate query range correctly", () => {
    const startTime = 1640995200000000;
    const endTime = 1640995260000000; // 60 seconds later
    const range = wrapper.vm.queryRange(startTime, endTime);
    
    expect(range).toHaveProperty("queryRangeInSeconds");
    expect(range).toHaveProperty("duration");
    expect(range.queryRangeInSeconds).toBe(60);
  });

  // Test 8: getDurationInSeconds function
  it("should calculate average duration for queries array", () => {
    const queries = [
      { createdAt: Date.now() * 1000 - 2000000 },
      { createdAt: Date.now() * 1000 - 4000000 },
    ];
    const avgDuration = wrapper.vm.getDurationInSeconds(queries);
    expect(typeof avgDuration).toBe("string");
  });

  // Test 9: getGroupedQueryRange function
  it("should calculate average query range for queries array", () => {
    const queries = [
      { startTime: 1640995200000000, endTime: 1640995260000000 },
      { startTime: 1640995200000000, endTime: 1640995320000000 },
    ];
    const avgRange = wrapper.vm.getGroupedQueryRange(queries);
    expect(typeof avgRange).toBe("string");
  });

  // Test 10: listSchema function
  it("should open schema dialog with correct data", () => {
    const rowData = { test: "data" };
    wrapper.vm.listSchema(rowData);
    
    expect(wrapper.vm.schemaData).toEqual(rowData);
    expect(wrapper.vm.showListSchemaDialog).toBe(true);
  });

  // Test 11: changePagination function
  it("should update pagination settings", () => {
    const newPagination = { label: "50", value: 50 };
    wrapper.vm.changePagination(newPagination);
    
    expect(wrapper.vm.selectedPerPage).toBe(50);
    expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
  });

  // Test 12: confirmDeleteAction function
  it("should show delete dialog with correct data", () => {
    const row = { trace_id: "test-trace-id" };
    wrapper.vm.confirmDeleteAction(row);
    
    expect(wrapper.vm.deleteDialog.show).toBe(true);
    expect(wrapper.vm.deleteDialog.data).toEqual(["test-trace-id"]);
  });

  // Test 13: onChangeQueryTab function
  it("should change query tab", () => {
    wrapper.vm.onChangeQueryTab("all");
    expect(wrapper.vm.selectedQueryTypeTab).toBe("all");
    
    wrapper.vm.onChangeQueryTab("summary");
    expect(wrapper.vm.selectedQueryTypeTab).toBe("summary");
  });

  // Test 14: onChangeSearchType function
  it("should change search type", () => {
    wrapper.vm.onChangeSearchType("ui");
    expect(wrapper.vm.selectedSearchType).toBe("ui");
    
    wrapper.vm.onChangeSearchType("Others");
    expect(wrapper.vm.selectedSearchType).toBe("Others");
  });

  // Test 15: filterUserQueries function
  it("should filter user queries and update settings", () => {
    const row = {
      user_id: "test@example.com",
      search_type_label: "dashboards",
    };
    wrapper.vm.filterUserQueries(row);
    
    expect(wrapper.vm.selectedQueryTypeTab).toBe("all");
    expect(wrapper.vm.selectedSearchField).toBe("all");
    expect(wrapper.vm.selectedSearchType).toBe("dashboards");
    expect(wrapper.vm.filterQuery).toBe("test@example.com");
  });

  // Test 16: handleMultiQueryCancel function with traceIds
  it("should handle multi query cancel with provided traceIds", () => {
    const traceIds = ["trace1", "trace2"];
    wrapper.vm.handleMultiQueryCancel(traceIds);
    
    expect(wrapper.vm.deleteDialog.show).toBe(true);
    expect(wrapper.vm.deleteDialog.data).toEqual(traceIds);
  });

  // Test 17: handleMultiQueryCancel function without traceIds
  it("should handle multi query cancel without traceIds", () => {
    wrapper.vm.selectedRow.summary = [
      { trace_id: "trace1" },
      { trace_ids: ["trace2", "trace3"] },
    ];
    wrapper.vm.selectedQueryTypeTab = "summary";
    wrapper.vm.handleMultiQueryCancel();
    
    expect(wrapper.vm.deleteDialog.show).toBe(true);
    expect(wrapper.vm.deleteDialog.data).toContain("trace1");
  });

  // Test 18: getRunningQueries success
  it("should fetch running queries successfully", async () => {
    await wrapper.vm.getRunningQueries();
    
    expect(SearchService.get_running_queries).toHaveBeenCalledWith("test-org");
    expect(wrapper.vm.queries).toHaveLength(3);
    expect(wrapper.vm.resultTotal).toBe(3);
  });

  // Test 20: deleteQuery success
  it("should delete query successfully", async () => {
    wrapper.vm.deleteDialog.data = ["trace-1"];
    wrapper.vm.selectedQueryTypeTab = "all";
    (SearchService.delete_running_queries as any).mockResolvedValue({});
    
    await wrapper.vm.deleteQuery();
    
    expect(SearchService.delete_running_queries).toHaveBeenCalledWith(
      "test-org",
      ["trace-1"]
    );
    expect(wrapper.vm.selectedRow.all).toEqual([]);
    expect(wrapper.vm.deleteDialog.show).toBe(false);
  });

  // Test 21: deleteQuery error handling
  it("should handle deleteQuery error", async () => {
    wrapper.vm.deleteDialog.data = ["trace-1"];
    (SearchService.delete_running_queries as any).mockRejectedValue({
      response: { data: { message: "Delete Error" } },
    });
    
    await wrapper.vm.deleteQuery();
    
    expect(wrapper.vm.deleteDialog.show).toBe(false);
  });

  // Test 22: getRunningQueriesSummary function
  it("should generate queries summary correctly", () => {
    wrapper.vm.queries = mockQueries;
    const summary = wrapper.vm.getRunningQueriesSummary();
    
    expect(Array.isArray(summary)).toBe(true);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary[0]).toHaveProperty("user_id");
    expect(summary[0]).toHaveProperty("numOfQueries");
    expect(summary[0]).toHaveProperty("duration");
  });

  // Test 23: getRunningQueriesSummary error handling
  it("should handle getRunningQueriesSummary error", () => {
    wrapper.vm.queries = [{ invalid: "data" }];
    const summary = wrapper.vm.getRunningQueriesSummary();
    expect(summary).toEqual([]);
  });

  // Test 24: baseFilteredQueries computed property
  it("should return correct baseFilteredQueries for summary tab", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.selectedQueryTypeTab = "summary";
    wrapper.vm.runningQueriesSummary = [{ test: "summary" }];
    
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.baseFilteredQueries).toEqual([{ test: "summary" }]);
  });

  // Test 25: baseFilteredQueries computed property for all tab
  it("should return correct baseFilteredQueries for all tab", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.selectedQueryTypeTab = "all";
    
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.baseFilteredQueries).toEqual(mockQueries);
  });

  // Test 26: searchTypeFiltered computed property
  it("should filter by search type correctly", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.selectedQueryTypeTab = "all";
    wrapper.vm.selectedSearchType = "dashboards";
    
    await wrapper.vm.$nextTick();
    const filtered = wrapper.vm.searchTypeFiltered;
    expect(filtered.every((q: any) => q.search_type_label === "dashboards" || q.search_type === "dashboards")).toBe(true);
  });

  // Test 27: fieldFiltered computed property with no filter
  it("should return all queries when no filter is applied", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.filterQuery = "";
    
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.fieldFiltered.length).toBe(wrapper.vm.searchTypeFiltered.length);
  });

  // Test 28: fieldFiltered computed property with filter
  it("should filter queries by user_id", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.filterQuery = "user@example.com";
    
    await wrapper.vm.$nextTick();
    const filtered = wrapper.vm.fieldFiltered;
    expect(filtered.some((q: any) => q.user_id?.includes("user@example.com"))).toBe(true);
  });

  // Test 29: filteredRows computed property with all search field
  it("should return fieldFiltered when selectedSearchField is all", async () => {
    wrapper.vm.selectedSearchField = "all";
    wrapper.vm.queries = mockQueries;
    
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredRows).toEqual(wrapper.vm.fieldFiltered);
  });

  // Test 30: filteredRows computed property with exec_duration filter
  it("should filter by execution duration", async () => {
    wrapper.vm.selectedSearchField = "exec_duration";
    wrapper.vm.filterQuery = "gt_1s";
    wrapper.vm.queries = mockQueries;
    
    await wrapper.vm.$nextTick();
    expect(Array.isArray(wrapper.vm.filteredRows)).toBe(true);
  });

  // Test 31: filteredRows computed property with query_range filter
  it("should filter by query range", async () => {
    wrapper.vm.selectedSearchField = "query_range";
    wrapper.vm.filterQuery = "gt_1m";
    wrapper.vm.queries = mockQueries;
    
    await wrapper.vm.$nextTick();
    expect(Array.isArray(wrapper.vm.filteredRows)).toBe(true);
  });

  // Test 32: otherFieldOptions computed property for exec_duration
  it("should return exec_duration options", async () => {
    wrapper.vm.selectedSearchField = "exec_duration";
    
    await wrapper.vm.$nextTick();
    const options = wrapper.vm.otherFieldOptions;
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveProperty("label");
    expect(options[0]).toHaveProperty("value");
  });

  // Test 33: otherFieldOptions computed property for query_range
  it("should return query_range options", async () => {
    wrapper.vm.selectedSearchField = "query_range";
    
    await wrapper.vm.$nextTick();
    const options = wrapper.vm.otherFieldOptions;
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].label).toContain(">");
  });

  // Test 34: otherFieldOptions computed property for other fields
  it("should return empty array for other fields", async () => {
    wrapper.vm.selectedSearchField = "all";
    
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.otherFieldOptions).toEqual([]);
  });

  // Test 35: summaryRows computed property
  it("should format summary rows correctly", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.runningQueriesSummary = wrapper.vm.getRunningQueriesSummary();
    wrapper.vm.selectedQueryTypeTab = "summary";
    
    await wrapper.vm.$nextTick();
    const rows = wrapper.vm.summaryRows;
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("#");
    }
  });

  // Test 36: rowsQuery computed property
  it("should format query rows correctly", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.selectedQueryTypeTab = "all";
    
    await wrapper.vm.$nextTick();
    const rows = wrapper.vm.rowsQuery;
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("#");
      expect(rows[0]).toHaveProperty("user_id");
      expect(rows[0]).toHaveProperty("duration");
      expect(rows[0]).toHaveProperty("queryRange");
    }
  });

  // Test 37: filterQueryBySearchTypeTab function
  it("should filter query by search type tab", () => {
    const query1 = { search_type: "dashboards", search_type_label: "dashboards" };
    const query2 = { search_type: "ui", search_type_label: "ui" };
    
    wrapper.vm.selectedSearchType = "dashboards";
    expect(wrapper.vm.filterQueryBySearchTypeTab(query1)).toBe(true);
    expect(wrapper.vm.filterQueryBySearchTypeTab(query2)).toBe(false);
  });

  // Test 38: filterQueryCriteria functions
  it("should test all filter query criteria", () => {
    const query = {
      user_id: "test@example.com",
      org_id: "test-org",
      stream_type: "logs",
      status: "running",
      trace_id: "trace-123",
      work_group: "default",
      search_type: "dashboards",
      search_type_label: "dashboards",
    };
    
    expect(wrapper.vm.filterQueryCriteria.user_id(query, "test")).toBe(true);
    expect(wrapper.vm.filterQueryCriteria.org_id(query, "test")).toBe(true);
    expect(wrapper.vm.filterQueryCriteria.stream_type(query, "logs")).toBe(true);
    expect(wrapper.vm.filterQueryCriteria.status(query, "running")).toBe(true);
    expect(wrapper.vm.filterQueryCriteria.trace_id(query, "trace")).toBe(true);
    expect(wrapper.vm.filterQueryCriteria.work_group(query, "default")).toBe(true);
    expect(wrapper.vm.filterQueryCriteria.search_type(query, "dash")).toBe(true);
    expect(wrapper.vm.filterQueryCriteria.search_type_label(query, "dash")).toBe(true);
  });

  // Test 39: Watch selectedSearchField
  it("should reset filterQuery when selectedSearchField changes", async () => {
    wrapper.vm.filterQuery = "test";
    wrapper.vm.selectedSearchField = "exec_duration";
    
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filterQuery).toBe("");
  });

  // Test 40: Watch filterQuery for resultTotal update
  it("should update resultTotal when filterQuery changes", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.filterQuery = "user@example.com";
    
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.resultTotal).toBeGreaterThanOrEqual(0);
  });

  // Test 41: Component columns configuration
  it("should have correct columns configuration", () => {
    const columns = wrapper.vm.columns;
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
    
    const columnNames = columns.map((col: any) => col.name);
    expect(columnNames).toContain("#");
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("actions");
  });

  // Test 42: Search field options
  it("should have correct search field options", () => {
    expect(wrapper.vm.searchFieldOptions).toEqual([
      { label: "All Fields", value: "all" },
      { label: "Exec. Duration", value: "exec_duration" },
      { label: "Query Range", value: "query_range" },
    ]);
  });

  // Test 43: Running query types
  it("should have correct running query types", () => {
    expect(wrapper.vm.runningQueryTypes).toEqual([
      { label: "User Summary", value: "summary" },
      { label: "All Queries", value: "all" },
    ]);
  });

  // Test 44: Search types
  it("should have correct search types", () => {
    expect(wrapper.vm.searchTypes).toEqual(["dashboards", "ui", "Others"]);
  });

  // Test 45: Per page options
  it("should have correct per page options", () => {
    expect(wrapper.vm.perPageOptions).toEqual([
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
    ]);
  });

  // Test 46: Delete dialog initial state
  it("should have correct delete dialog initial state", () => {
    expect(wrapper.vm.deleteDialog).toEqual({
      show: false,
      title: "Delete Running Query",
      message: "Are you sure you want to delete this running query?",
      data: null,
    });
  });

  // Test 47: Component lifecycle - onBeforeMount
  it("should call getRunningQueries on mount", () => {
    expect(SearchService.get_running_queries).toHaveBeenCalled();
  });

  // Test 48: Error handling in getRunningQueriesSummary with empty queries
  it("should handle empty queries in getRunningQueriesSummary", () => {
    wrapper.vm.queries = [];
    const summary = wrapper.vm.getRunningQueriesSummary();
    expect(summary).toEqual([]);
  });

  // Test 49: Time filter with lt_ prefix
  it("should handle lt_ time filters", async () => {
    wrapper.vm.selectedSearchField = "exec_duration";
    wrapper.vm.filterQuery = "lt_1s";
    wrapper.vm.queries = mockQueries;
    
    await wrapper.vm.$nextTick();
    expect(Array.isArray(wrapper.vm.filteredRows)).toBe(true);
  });

  // Test 50: Complex query summary aggregation
  it("should correctly aggregate multiple queries for same user", () => {
    const complexQueries = [
      {
        trace_id: "trace-1",
        user_id: "same_user@example.com",
        search_type: "dashboards",
        search_type_label: "dashboards",
        created_at: 1640995200000000,
        query: { start_time: 1640995200000000, end_time: 1640995260000000 },
      },
      {
        trace_id: "trace-2",
        user_id: "same_user@example.com",
        search_type: "dashboards",
        search_type_label: "dashboards",
        created_at: 1640995260000000,
        query: { start_time: 1640995200000000, end_time: 1640995320000000 },
      },
    ];
    
    wrapper.vm.queries = complexQueries;
    const summary = wrapper.vm.getRunningQueriesSummary();
    
    expect(summary.length).toBe(1);
    expect(summary[0].numOfQueries).toBe(2);
    expect(summary[0].trace_ids).toEqual(["trace-1", "trace-2"]);
  });
});