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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AssociatedStreamFunction from "./AssociatedStreamFunction.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import i18n from "@/locales";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

installQuasar({ plugins: [Notify] });

// Hoist mocks so they are available when vi.mock factories are hoisted
const {
  mockGetStreams,
  mockJsTransformList,
  mockApplyStreamFunction,
  mockStreamFunction,
  mockRemoveStreamFunction,
} = vi.hoisted(() => ({
  mockGetStreams: vi.fn(),
  mockJsTransformList: vi.fn(),
  mockApplyStreamFunction: vi.fn(),
  mockStreamFunction: vi.fn(),
  mockRemoveStreamFunction: vi.fn(),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
  }),
}));

vi.mock("../../services/jstransform", () => ({
  default: {
    list: mockJsTransformList,
    apply_stream_function: mockApplyStreamFunction,
    stream_function: mockStreamFunction,
    remove_stream_function: mockRemoveStreamFunction,
  },
}));

vi.mock("../../services/stream", () => ({
  default: {
    delete: vi.fn(),
  },
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((url: string) => url),
  verifyOrganizationStatus: vi.fn(),
}));

describe("AssociatedStreamFunction", () => {
  let store: any;
  let router: any;

  const mockStreams = {
    list: [
      {
        name: "stream1",
        stream_type: "logs",
        stats: { doc_num: 1000, storage_size: 100, compressed_size: 50 },
      },
      {
        name: "stream2",
        stream_type: "metrics",
        stats: null,
      },
    ],
  };

  const mockFunctions = {
    data: {
      list: [
        { name: "func1", order: 1, applyBeforeFlattening: false },
        { name: "func2", order: 2, applyBeforeFlattening: true },
      ],
    },
  };

  const mockStreamFunctionResult = {
    data: {
      list: [{ name: "func1", order: 1, applyBeforeFlattening: false }],
    },
  };

  const globalStubs = {
    QTablePagination: true,
    SchemaIndex: true,
    NoData: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetStreams.mockResolvedValue(mockStreams);
    mockJsTransformList.mockResolvedValue(mockFunctions);
    mockStreamFunction.mockResolvedValue(mockStreamFunctionResult);
    mockApplyStreamFunction.mockResolvedValue({});
    mockRemoveStreamFunction.mockResolvedValue({});

    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        userInfo: { email: "test@example.com" },
        theme: "light",
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/streams",
          name: "streams",
          component: { template: "<div>Streams</div>" },
        },
      ],
    });

    router.push("/streams");
  });

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render main stream table", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="log-stream-table"]').exists()).toBe(true);
    });

    it("should render search input", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="stream-association-search-input"]').exists()).toBe(true);
    });

    it("should render refresh stats button", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="log-stream-refresh-stats-btn"]').exists()).toBe(true);
    });
  });

  describe("Data Loading", () => {
    it("should call getStreams on mount", async () => {
      mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(mockGetStreams).toHaveBeenCalledWith("", false);
    });

    it("should call getAllFunctions when streams are loaded", async () => {
      mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(mockJsTransformList).toHaveBeenCalled();
    });

    it("should not call getAllFunctions when stream list is empty", async () => {
      mockGetStreams.mockResolvedValue({ list: [] });

      mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(mockJsTransformList).not.toHaveBeenCalled();
    });

    it("should reload streams on refresh button click", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockGetStreams.mockResolvedValue(mockStreams);

      const refreshBtn = wrapper.find('[data-test="log-stream-refresh-stats-btn"]');
      await refreshBtn.trigger("click");
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalled();
    });
  });

  describe("Stream Data Mapping", () => {
    it("should filter out enrichment_tables streams", async () => {
      mockGetStreams.mockResolvedValue({
        list: [
          { name: "stream1", stream_type: "logs", stats: null },
          { name: "enrich_table", stream_type: "enrichment_tables", stats: null },
        ],
      });

      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.logStream.every((s: any) => s.stream_type !== "enrichment_tables")).toBe(true);
      expect(vm.logStream).toHaveLength(1);
    });

    it("should map stream stats correctly when stats exist", async () => {
      mockGetStreams.mockResolvedValue({
        list: [
          {
            name: "stream1",
            stream_type: "logs",
            stats: { doc_num: 500, storage_size: 200, compressed_size: 100 },
          },
        ],
      });

      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.logStream[0].doc_num).toBe(500);
      expect(vm.logStream[0].storage_size).toBe("200 MB");
      expect(vm.logStream[0].compressed_size).toBe("100 MB");
    });

    it("should use '--' for doc_num and storage_size when stats is null", async () => {
      mockGetStreams.mockResolvedValue({
        list: [{ name: "stream1", stream_type: "logs", stats: null }],
      });

      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.logStream[0].doc_num).toBe("--");
      expect(vm.logStream[0].storage_size).toBe("--");
    });

    it("should format row number with leading zero for first 9 items", async () => {
      mockGetStreams.mockResolvedValue({
        list: Array.from({ length: 10 }, (_, i) => ({
          name: `stream${i + 1}`,
          stream_type: "logs",
          stats: null,
        })),
      });

      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.logStream[0]["#"]).toBe("01");
      expect(vm.logStream[8]["#"]).toBe("09");
    });
  });

  describe("Row Expansion (toggleStreamRow)", () => {
    it("should expand a row when clicked", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.expandedRow.name).toBe("");

      vm.toggleStreamRow({ row: { name: "stream1", stream_type: "logs" } });
      expect(vm.expandedRow.name).toBe("stream1");
      expect(vm.expandedRow.stream_type).toBe("logs");
    });

    it("should collapse row when same row is clicked again", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.toggleStreamRow({ row: { name: "stream1", stream_type: "logs" } });
      expect(vm.expandedRow.name).toBe("stream1");

      vm.toggleStreamRow({ row: { name: "stream1", stream_type: "logs" } });
      expect(vm.expandedRow.name).toBe("");
    });

    it("should fetch stream functions when row is expanded", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockStreamFunction.mockResolvedValue(mockStreamFunctionResult);

      const vm = wrapper.vm as any;
      vm.toggleStreamRow({ row: { name: "stream1", stream_type: "logs" } });

      await flushPromises();
      expect(mockStreamFunction).toHaveBeenCalledWith("test-org", "stream1", "logs");
    });

    it("should reset addFunctionInProgress when expanding a row", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.addFunctionInProgress = true;

      vm.toggleStreamRow({ row: { name: "stream1", stream_type: "logs" } });
      expect(vm.addFunctionInProgress).toBe(false);
    });
  });

  describe("Stream Functions (getStreamFunctions)", () => {
    it("should populate functionsList after fetching", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.expandedRow = { name: "stream1", stream_type: "logs" };

      await vm.getStreamFunctions("stream1", "logs");
      await flushPromises();

      expect(vm.functionsList).toHaveLength(1);
      expect(vm.functionsList[0].name).toBe("func1");
    });

    it("should default applyBeforeFlattening to false if not set", async () => {
      mockStreamFunction.mockResolvedValue({
        data: { list: [{ name: "func1", order: 1 }] },
      });

      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      await vm.getStreamFunctions("stream1", "logs");
      await flushPromises();

      expect(vm.functionsList[0].applyBeforeFlattening).toBe(false);
    });

    it("should reset loadingFunctions to false after fetch", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      await vm.getStreamFunctions("stream1", "logs");
      await flushPromises();

      expect(vm.loadingFunctions).toBe(false);
    });

    it("should handle getStreamFunctions error and reset loadingFunctions", async () => {
      mockStreamFunction.mockRejectedValue({
        response: { data: { error: "Server error" } },
      });

      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.expandedRow = { name: "stream1", stream_type: "logs" };

      await vm.getStreamFunctions("stream1", "logs");
      await flushPromises();

      expect(vm.loadingFunctions).toBe(false);
    });
  });

  describe("Delete Function from Stream", () => {
    it("should call remove_stream_function API", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.expandedRow = { name: "stream1", stream_type: "logs" };

      await vm.deleteFunctionFromStream("func1");
      await flushPromises();

      expect(mockRemoveStreamFunction).toHaveBeenCalledWith(
        "test-org",
        "stream1",
        "logs",
        "func1"
      );
    });

    it("should refresh stream functions after delete", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockRemoveStreamFunction.mockResolvedValue({});
      mockStreamFunction.mockResolvedValue(mockStreamFunctionResult);

      const vm = wrapper.vm as any;
      vm.expandedRow = { name: "stream1", stream_type: "logs" };

      await vm.deleteFunctionFromStream("func1");
      await flushPromises();

      expect(mockStreamFunction).toHaveBeenCalled();
    });
  });

  describe("Update Associated Functions", () => {
    it("should call apply_stream_function API with updated function data", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.expandedRow = { name: "stream1", stream_type: "logs" };

      const func = { name: "func1", order: 1, applyBeforeFlattening: true };
      vm.updateAssociatedFunctions(func);

      await flushPromises();

      expect(mockApplyStreamFunction).toHaveBeenCalledWith(
        "test-org",
        "stream1",
        "logs",
        "func1",
        func
      );
    });

    it("should refresh stream functions after update", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockApplyStreamFunction.mockResolvedValue({});
      mockStreamFunction.mockResolvedValue(mockStreamFunctionResult);

      const vm = wrapper.vm as any;
      vm.expandedRow = { name: "stream1", stream_type: "logs" };

      vm.updateAssociatedFunctions({ name: "func1", order: 1, applyBeforeFlattening: true });
      await flushPromises();

      expect(mockStreamFunction).toHaveBeenCalled();
    });
  });

  describe("Functions Columns (functionsColumns computed)", () => {
    it("should exclude applyBeforeFlattening column for non-logs stream types", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.expandedRow = { name: "stream1", stream_type: "metrics" };

      const columns = vm.functionsColumns;
      const hasCol = columns.some((col: any) => col.name === "applyBeforeFlattening");
      expect(hasCol).toBe(false);
    });

    it("should include applyBeforeFlattening column for logs stream type", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.expandedRow = { name: "stream1", stream_type: "logs" };

      const columns = vm.functionsColumns;
      const hasCol = columns.some((col: any) => col.name === "applyBeforeFlattening");
      expect(hasCol).toBe(true);
    });
  });

  describe("Filter Function (filterFn)", () => {
    it("should filter functions excluding already applied ones", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.allFunctionsList = [{ name: "func1" }, { name: "func2" }, { name: "func3" }];
      vm.functionsList = [{ name: "func1" }];

      const mockUpdate = vi.fn((cb: any) => cb());
      vm.filterFn("func", mockUpdate);

      expect(mockUpdate).toHaveBeenCalled();
      // func1 is already applied; it should be filtered out
      const hasFunc1 = vm.filterFunctions.some((f: any) => f.name === "func1");
      expect(hasFunc1).toBe(false);
    });
  });

  describe("Filter Data (filterData)", () => {
    it("should filter rows by name (case-insensitive)", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const rows = [
        { name: "STREAM_ONE", stream_type: "logs" },
        { name: "stream_two", stream_type: "metrics" },
      ];

      const result = vm.filterData(rows, "stream_one");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("STREAM_ONE");
    });

    it("should filter rows by stream_type", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const rows = [
        { name: "stream1", stream_type: "logs" },
        { name: "stream2", stream_type: "metrics" },
      ];

      const result = vm.filterData(rows, "metrics");
      expect(result).toHaveLength(1);
      expect(result[0].stream_type).toBe("metrics");
    });

    it("should return empty array when no match", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const rows = [{ name: "stream1", stream_type: "logs" }];

      expect(vm.filterData(rows, "xyz_not_found")).toHaveLength(0);
    });
  });

  describe("Pagination", () => {
    it("should change pagination correctly", async () => {
      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.qTable = { setPagination: vi.fn() };

      vm.changePagination({ label: "50", value: 50 });
      expect(vm.selectedPerPage).toBe(50);
      expect(vm.pagination.rowsPerPage).toBe(50);
      expect(vm.qTable.setPagination).toHaveBeenCalledWith({ rowsPerPage: 50 });
    });
  });

  describe("Error Handling", () => {
    it("should handle getLogStream error gracefully", async () => {
      mockGetStreams.mockRejectedValue(new Error("Network error"));

      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle getAllFunctions error gracefully", async () => {
      mockJsTransformList.mockRejectedValue({
        response: { data: { error: "Server error" } },
      });

      const wrapper = mount(AssociatedStreamFunction, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });
});
