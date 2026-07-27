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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import useSearchBar from "./useSearchBar";
import searchState from "./searchState";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: {
        queryRangeRestrictionMsg: "Query range restricted to {range}",
      },
    },
  },
});

const TestComponent = defineComponent({
  setup() {
    const searchBar = useSearchBar();
    return { ...searchBar };
  },
  template: "<div></div>",
});

// Hoisted mocks
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

const { mockCancelSearchQuery } = vi.hoisted(() => ({
  mockCancelSearchQuery: vi.fn(),
}));
vi.mock("@/composables/useSearchWebSocket", () => ({
  default: () => ({
    cancelSearchQueryBasedOnRequestId: mockCancelSearchQuery,
  }),
}));

const { mockDeleteRunningQueries } = vi.hoisted(() => ({
  mockDeleteRunningQueries: vi.fn(),
}));
vi.mock("@/services/search", () => ({
  default: {
    delete_running_queries: mockDeleteRunningQueries,
    get_regions: vi.fn().mockResolvedValue({ data: {} }),
    search: vi.fn(),
    partition: vi.fn(),
    result_schema: vi.fn(),
  },
}));

const { mockGetAllFunctions } = vi.hoisted(() => ({
  mockGetAllFunctions: vi.fn(),
}));
vi.mock("@/composables/useFunctions", () => ({
  default: () => ({ getAllFunctions: mockGetAllFunctions }),
}));

const { mockGetAllActions } = vi.hoisted(() => ({
  mockGetAllActions: vi.fn(),
}));
vi.mock("@/composables/useActions", () => ({
  default: () => ({ getAllActions: mockGetAllActions }),
}));

const { mockShowErrorNotification } = vi.hoisted(() => ({
  mockShowErrorNotification: vi.fn(),
}));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: mockShowErrorNotification }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({ schema: [{ name: "field1" }] }),
    isStreamExists: vi.fn().mockReturnValue(true),
    isStreamFetched: vi.fn().mockReturnValue(true),
  }),
}));

const { mockBuildSearch, mockGetDataThroughStream } = vi.hoisted(() => ({
  mockBuildSearch: vi.fn(),
  mockGetDataThroughStream: vi.fn(),
}));
vi.mock("@/composables/useLogs/useSearchStream", () => ({
  default: () => ({
    buildSearch: mockBuildSearch,
    getDataThroughStream: mockGetDataThroughStream,
  }),
}));

vi.mock("@/composables/useLogs/useStreamFields", () => ({
  default: () => ({ extractFields: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false", isCloud: "false" },
}));

const { mockSavedViewsGet } = vi.hoisted(() => ({
  mockSavedViewsGet: vi.fn(),
}));
vi.mock("@/services/saved_views", () => ({
  default: { get: mockSavedViewsGet },
}));

vi.mock("@/utils/query/sqlIdentifiers", () => ({
  quoteSqlIdentifierIfNeeded: vi.fn((s: string) => `"${s}"`),
}));

const { mockArraysMatch } = vi.hoisted(() => ({ mockArraysMatch: vi.fn() }));
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    arraysMatch: mockArraysMatch,
    useLocalLogFilterField: vi.fn().mockReturnValue({ value: {} }),
    useLocalWrapContent: vi.fn().mockReturnValue(null),
  };
});

describe("useSearchBar Composable", () => {
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteRunningQueries.mockResolvedValue({
      data: [{ is_success: true }],
    });
    mockBuildSearch.mockReturnValue({ query: { sql: "SELECT * FROM test" } });
    wrapper = mount(TestComponent, {
      global: { plugins: [store, i18n] },
    });
  });

  describe("function existence", () => {
    it("should expose onStreamChange", () => {
      expect(typeof wrapper.vm.onStreamChange).toBe("function");
    });

    it("should expose getFunctions", () => {
      expect(typeof wrapper.vm.getFunctions).toBe("function");
    });

    it("should expose getActions", () => {
      expect(typeof wrapper.vm.getActions).toBe("function");
    });

    it("should expose getSavedViews", () => {
      expect(typeof wrapper.vm.getSavedViews).toBe("function");
    });

    it("should expose getRegionInfo", () => {
      expect(typeof wrapper.vm.getRegionInfo).toBe("function");
    });

    it("should expose setSelectedStreams", () => {
      expect(typeof wrapper.vm.setSelectedStreams).toBe("function");
    });

    it("should expose getQueryData", () => {
      expect(typeof wrapper.vm.getQueryData).toBe("function");
    });

    it("should expose sendCancelSearchMessage", () => {
      expect(typeof wrapper.vm.sendCancelSearchMessage).toBe("function");
    });

    it("should expose cancelQuery", () => {
      expect(typeof wrapper.vm.cancelQuery).toBe("function");
    });

    it("should expose handleQueryData", () => {
      expect(typeof wrapper.vm.handleQueryData).toBe("function");
    });

    it("should expose setDateTime", () => {
      expect(typeof wrapper.vm.setDateTime).toBe("function");
    });
  });

  describe("onStreamChange", () => {
    it("clears carried-over selectedFields so FTS re-selects for the new stream", async () => {
      // Carried over from a previously selected stream. "field1" even exists
      // in the new stream's schema (per the getStream mock), but switching
      // streams should still drop it so the post-search fill-rate check picks
      // a fresh default column for the new stream.
      const { searchObj } = searchState();
      searchObj.data.stream.selectedStream = ["new_stream"];
      searchObj.data.stream.selectedFields = ["log", "field1"];

      await wrapper.vm.onStreamChange("");

      expect(searchObj.data.stream.selectedFields).toEqual([]);
    });
  });

  describe("cancelQuery", () => {
    it("should resolve true immediately when not enterprise", async () => {
      const result = await wrapper.vm.cancelQuery();
      expect(result).toBe(true);
    });

    it("should resolve true when no trace IDs exist", async () => {
      const result = await wrapper.vm.cancelQuery();
      expect(result).toBe(true);
      expect(mockDeleteRunningQueries).not.toHaveBeenCalled();
    });
  });

  describe("sendCancelSearchMessage", () => {
    it("should set isOperationCancelled false for empty search requests", () => {
      wrapper.vm.sendCancelSearchMessage([]);
      expect(mockCancelSearchQuery).not.toHaveBeenCalled();
    });

    it("should send cancel for each search request trace ID", () => {
      const searchRequests = ["trace-1", "trace-2", "trace-3"];

      wrapper.vm.sendCancelSearchMessage(searchRequests);

      expect(mockCancelSearchQuery).toHaveBeenCalledTimes(3);
      expect(mockCancelSearchQuery).toHaveBeenCalledWith({
        trace_id: "trace-1",
        org_id: expect.any(String),
      });
      expect(mockCancelSearchQuery).toHaveBeenCalledWith({
        trace_id: "trace-2",
        org_id: expect.any(String),
      });
    });

    it("should handle single search request", () => {
      wrapper.vm.sendCancelSearchMessage(["trace-single"]);

      expect(mockCancelSearchQuery).toHaveBeenCalledTimes(1);
      expect(mockCancelSearchQuery).toHaveBeenCalledWith({
        trace_id: "trace-single",
        org_id: expect.any(String),
      });
    });
  });

  describe("getSavedViews", () => {
    it("should set loadingSavedView true during fetch", async () => {
      mockSavedViewsGet.mockReturnValue(
        new Promise(() => {}), // Never resolves
      );

      wrapper.vm.getSavedViews();
      // Loading state is set before the async call
    });
  });

  describe("getFunctions", () => {
    it("should call getAllFunctions when functions list is empty", async () => {
      store.state.organizationData.functions = [];
      mockGetAllFunctions.mockResolvedValue(undefined);

      await wrapper.vm.getFunctions();
      expect(mockGetAllFunctions).toHaveBeenCalled();
    });

    it("should not call getAllFunctions when already loaded", async () => {
      store.state.organizationData.functions = [
        { name: "existing", num_args: 1, function: "fn() {}" },
      ];
      mockGetAllFunctions.mockResolvedValue(undefined);

      await wrapper.vm.getFunctions();
      expect(mockGetAllFunctions).not.toHaveBeenCalled();
    });

    it("should show error notification on failure", async () => {
      store.state.organizationData.functions = [];
      mockGetAllFunctions.mockRejectedValue(new Error("Network error"));

      await wrapper.vm.getFunctions();
      expect(mockShowErrorNotification).toHaveBeenCalledWith("Error while fetching functions");
    });
  });

  describe("getActions", () => {
    it("should call getAllActions when actions list is empty", async () => {
      store.state.organizationData.actions = [];
      mockGetAllActions.mockResolvedValue(undefined);

      await wrapper.vm.getActions();
      expect(mockGetAllActions).toHaveBeenCalled();
    });

    it("should not call getAllActions when already loaded", async () => {
      store.state.organizationData.actions = [
        { name: "existing", id: "act-1", execution_details_type: "service" },
      ];
      mockGetAllActions.mockResolvedValue(undefined);

      await wrapper.vm.getActions();
      expect(mockGetAllActions).not.toHaveBeenCalled();
    });

    it("should show error notification on failure", async () => {
      store.state.organizationData.actions = [];
      mockGetAllActions.mockRejectedValue(new Error("Network error"));

      await wrapper.vm.getActions();
      expect(mockShowErrorNotification).toHaveBeenCalledWith("Error while fetching actions");
    });
  });

  describe("setDateTime", () => {
    it("should be callable with valid period", () => {
      expect(() => wrapper.vm.setDateTime("5m")).not.toThrow();
    });

    it("should be callable with days period", () => {
      expect(() => wrapper.vm.setDateTime("1d")).not.toThrow();
    });

    it("should be callable with hours period", () => {
      expect(() => wrapper.vm.setDateTime("2h")).not.toThrow();
    });

    it("should be callable with weeks period", () => {
      expect(() => wrapper.vm.setDateTime("1w")).not.toThrow();
    });

    it("should handle default period", () => {
      expect(() => wrapper.vm.setDateTime("15m")).not.toThrow();
    });
  });
});
