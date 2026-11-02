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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import RunningQueries from "@/components/queries/RunningQueries.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import SearchService from "@/services/search";

// Mock SearchService
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_running_queries: vi.fn(),
      delete_running_queries: vi.fn(),
      cancel_running_queries: vi.fn(),
    },
  });
});

// Mock composables
vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({ isMetaOrg: true }),
}));

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
      },
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
      },
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
        },
        stubs: {
          OIcon: true,
          "confirm-dialog": true,
          "query-list": true,
          "running-queries-list": true,
          "summary-list": true,
          ODrawer: {
            name: "ODrawer",
            props: [
              "open",
              "size",
              "showClose",
              "title",
              "subTitle",
              "width",
              "persistent",
              "primaryButtonLabel",
              "secondaryButtonLabel",
              "neutralButtonLabel",
            ],
            emits: ["update:open", "close", "click:primary", "click:secondary", "click:neutral"],
            template: '<div data-test="o-drawer-stub" v-if="open"><slot /></div>',
          },
          ODialog: {
            name: "ODialog",
            props: [
              "open",
              "size",
              "showClose",
              "title",
              "subTitle",
              "width",
              "persistent",
              "primaryButtonLabel",
              "secondaryButtonLabel",
              "neutralButtonLabel",
            ],
            emits: ["update:open", "close", "click:primary", "click:secondary", "click:neutral"],
            template: '<div data-test="o-dialog-stub" v-if="open"><slot /></div>',
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should calculate query range correctly", () => {
    const startTime = 1640995200000000;
    const endTime = 1640995260000000; // 60 seconds later
    const range = wrapper.vm.queryRange(startTime, endTime);

    expect(range).toHaveProperty("queryRangeInSeconds");
    expect(range).toHaveProperty("duration");
    expect(range.queryRangeInSeconds).toBe(60);
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
      { trace_id: "trace1", org_id: "a" },
      {
        queries: [
          { trace_id: "trace2", org_id: "b" },
          { trace_id: "trace3", org_id: "c" },
        ],
      },
    ];
    wrapper.vm.selectedQueryTypeTab = "summary";
    wrapper.vm.handleMultiQueryCancel();

    expect(wrapper.vm.deleteDialog.show).toBe(true);
    expect(wrapper.vm.deleteDialog.data).toEqual([
      { trace_id: "trace1", org_id: "a" },
      { trace_id: "trace2", org_id: "b" },
      { trace_id: "trace3", org_id: "c" },
    ]);
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
    wrapper.vm.deleteDialog.data = [{ trace_id: "trace-1", org_id: "org-1" }];
    wrapper.vm.selectedQueryTypeTab = "all";
    (SearchService.cancel_running_queries as any).mockResolvedValue({});

    await wrapper.vm.deleteQuery();

    expect(SearchService.cancel_running_queries).toHaveBeenCalledWith("test-org", [
      { trace_id: "trace-1", org_id: "org-1" },
    ]);
    expect(wrapper.vm.selectedRow.all).toEqual([]);
    expect(wrapper.vm.deleteDialog.show).toBe(false);
  });

  it("should cancel a trace id shared by two orgs only in the org of the chosen row", async () => {
    (SearchService.cancel_running_queries as any).mockResolvedValue({});

    wrapper.vm.confirmDeleteAction({ trace_id: "t", org_id: "org-a" });
    await wrapper.vm.deleteQuery();

    expect(SearchService.cancel_running_queries).toHaveBeenCalledWith("test-org", [
      { trace_id: "t", org_id: "org-a" },
    ]);
  });

  // Test 21: deleteQuery error handling
  it("should handle deleteQuery error", async () => {
    wrapper.vm.deleteDialog.data = [{ trace_id: "trace-1", org_id: "org-1" }];
    (SearchService.cancel_running_queries as any).mockRejectedValue({
      response: { data: { message: "Delete Error" } },
    });

    await wrapper.vm.deleteQuery();

    expect(wrapper.vm.deleteDialog.show).toBe(false);
  });

  // Test 22: getRunningQueriesSummary function
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
    expect(
      filtered.every(
        (q: any) => q.search_type_label === "dashboards" || q.search_type === "dashboards",
      ),
    ).toBe(true);
  });

  // Test 28: fieldFiltered computed property with filter
  it("should filter queries by user_id", async () => {
    wrapper.vm.queries = mockQueries;
    wrapper.vm.filterQuery = "user@example.com";

    await wrapper.vm.$nextTick();
    const filtered = wrapper.vm.fieldFiltered;
    expect(filtered.some((q: any) => q.user_id?.includes("user@example.com"))).toBe(true);
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

  // Test 48: Error handling in getRunningQueriesSummary with empty queries
  it("should handle empty queries in getRunningQueriesSummary", () => {
    wrapper.vm.queries = [];
    const summary = wrapper.vm.getRunningQueriesSummary();
    expect(summary).toEqual([]);
  });

  // ODrawer: schema drawer should appear after listSchema()
  it("should render schema ODrawer when listSchema is called", async () => {
    wrapper.vm.listSchema({ stream_name: "logs" });
    await wrapper.vm.$nextTick();
    await flushPromises();

    expect(wrapper.vm.showListSchemaDialog).toBe(true);
    const drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.exists()).toBe(true);
    expect(drawer.props("open")).toBe(true);
  });

  // ODrawer: should close drawer when ODrawer emits 'close'
  it("should close schema drawer when ODrawer emits close", async () => {
    wrapper.vm.listSchema({ stream_name: "logs" });
    await flushPromises();

    const drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.exists()).toBe(true);

    await drawer.vm.$emit("close");
    await flushPromises();

    expect(wrapper.vm.showListSchemaDialog).toBe(false);
  });

  // ODrawer: should sync v-model:open when drawer emits update:open
  it("should sync showListSchemaDialog when ODrawer emits update:open(false)", async () => {
    wrapper.vm.listSchema({ stream_name: "logs" });
    await flushPromises();

    const drawer = wrapper.findComponent({ name: "ODrawer" });
    await drawer.vm.$emit("update:open", false);
    await flushPromises();

    expect(wrapper.vm.showListSchemaDialog).toBe(false);
  });

  // Test 50: Complex query summary aggregation
  it("should correctly aggregate multiple queries for same user", () => {
    const complexQueries = [
      {
        trace_id: "trace-1",
        org_id: "org-a",
        user_id: "same_user@example.com",
        search_type: "dashboards",
        search_type_label: "dashboards",
        created_at: 1640995200000000,
        query: { start_time: 1640995200000000, end_time: 1640995260000000 },
      },
      {
        trace_id: "trace-2",
        org_id: "org-b",
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
    expect(summary[0].queries).toEqual([
      { trace_id: "trace-1", org_id: "org-a" },
      { trace_id: "trace-2", org_id: "org-b" },
    ]);
  });
});
