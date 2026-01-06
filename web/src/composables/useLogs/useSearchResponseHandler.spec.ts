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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSearchResponseHandler } from "./useSearchResponseHandler";
import { searchState } from "./searchState";
import { logsUtils } from "./logsUtils";
import { useHistogram } from "./useHistogram";
import useNotifications from "@/composables/useNotifications";
import useSearchPagination from "@/composables/useLogs/useSearchPagination";
import useStreamFields from "@/composables/useLogs/useStreamFields";

// Create a shared mock state
const createMockState = () => ({
  searchObj: {
    data: {
      queryResults: {
        hits: [],
        aggs: [],
        total: 0,
        scan_size: 0,
        took: 0,
        result_cache_ratio: 0,
      },
      histogram: {
        chartParams: { title: "" },
        errorMsg: "",
        errorCode: 0,
        errorDetail: "",
      },
      errorMsg: "",
      errorCode: 0,
      errorDetail: "",
      countErrorMsg: "",
      functionError: "",
      histogramInterval: 60000,
      customDownloadQueryObj: {
        query: { start_time: 0, end_time: 1000000 },
      },
      datetime: {
        startTime: 0,
        endTime: 1000000,
        type: "relative",
      },
      histogramQuery: {
        query: { start_time: 0, end_time: 1000000 },
      },
      resultGrid: { currentPage: 1 },
      isOperationCancelled: false,
    },
    meta: {
      sqlMode: false,
      refreshInterval: 0,
      resultGrid: { rowsPerPage: 100, showPagination: true },
    },
    loading: false,
    loadingHistogram: false,
  },
  searchObjDebug: {},
  searchAggData: {
    hasAggregation: false,
    total: 0,
  },
  resetQueryData: vi.fn(),
  notificationMsg: { value: "" },
  resetHistogramError: vi.fn(),
  histogramResults: { value: [] },
});

let mockState: ReturnType<typeof createMockState>;

// Create a separate shared searchPartitionMap that persists across the composable and tests
const mockSearchPartitionMap: Record<string, { partition: number; chunks: Record<number, number> }> = {};

// Create shared mock functions
const mockNotifications = {
  showErrorNotification: vi.fn(),
  showCancelSearchNotification: vi.fn(),
};

const mockLogsUtils = {
  fnParsedSQL: vi.fn(() => ({})),
  hasAggregation: vi.fn(() => false),
  removeTraceId: vi.fn(),
  updateUrlQueryParams: vi.fn(),
};

const mockHistogram = {
  getHistogramTitle: vi.fn(() => "Histogram"),
  generateHistogramData: vi.fn(),
  resetHistogramWithError: vi.fn(),
};

const mockSearchPagination = {
  refreshPagination: vi.fn(),
};

const mockStreamFields = {
  updateFieldValues: vi.fn(),
  extractFields: vi.fn(),
  updateGridColumns: vi.fn(),
  filterHitsColumns: vi.fn(),
  resetFieldValues: vi.fn(),
};

const mockLogsHighlighter = {
  clearCache: vi.fn(),
};

// Mock dependencies
vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: { timezone: "UTC" },
  })),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key),
  })),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => mockNotifications),
}));

vi.mock("./searchState", () => ({
  searchState: vi.fn(() => ({
    ...mockState,
    searchPartitionMap: mockSearchPartitionMap,
  })),
}));

vi.mock("./logsUtils", () => ({
  logsUtils: vi.fn(() => mockLogsUtils),
}));

vi.mock("./useHistogram", () => ({
  useHistogram: vi.fn(() => mockHistogram),
}));

vi.mock("./useSearchPagination", () => ({
  default: vi.fn(() => mockSearchPagination),
}));

vi.mock("./useStreamFields", () => ({
  default: vi.fn(() => mockStreamFields),
}));

vi.mock("@/composables/useLogsHighlighter", () => ({
  useLogsHighlighter: vi.fn(() => mockLogsHighlighter),
}));

vi.mock("@/utils/common", () => ({
  logsErrorMessage: vi.fn((code: number) => {
    if (code === 20009) return "search.searchCancelled";
    return null;
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getFunctionErrorMessage: vi.fn(() => "Function error message"),
}));

vi.mock("@/utils/date", () => ({
  convertDateToTimestamp: vi.fn(() => ({ timestamp: 1000000 })),
}));

describe("useSearchResponseHandler", () => {
  let responseHandler: ReturnType<typeof useSearchResponseHandler>;

  beforeEach(() => {
    mockState = createMockState();

    // Clear the shared searchPartitionMap
    Object.keys(mockSearchPartitionMap).forEach(key => delete mockSearchPartitionMap[key]);

    vi.clearAllMocks();

    // Reset all shared mock functions
    mockNotifications.showErrorNotification.mockClear();
    mockNotifications.showCancelSearchNotification.mockClear();
    mockLogsUtils.fnParsedSQL.mockReturnValue({});
    mockLogsUtils.hasAggregation.mockReturnValue(false);
    mockLogsUtils.removeTraceId.mockClear();
    mockLogsUtils.updateUrlQueryParams.mockClear();
    mockHistogram.getHistogramTitle.mockReturnValue("Histogram");
    mockHistogram.generateHistogramData.mockClear();
    mockHistogram.resetHistogramWithError.mockClear();
    mockSearchPagination.refreshPagination.mockClear();
    mockStreamFields.updateFieldValues.mockClear();
    mockStreamFields.extractFields.mockClear();
    mockStreamFields.updateGridColumns.mockClear();
    mockStreamFields.filterHitsColumns.mockClear();
    mockStreamFields.resetFieldValues.mockClear();
    mockLogsHighlighter.clearCache.mockClear();

    responseHandler = useSearchResponseHandler();
  });

  describe("constructErrorMessage", () => {
    it("should construct error message with default message", () => {
      const result = responseHandler.constructErrorMessage({
        defaultMessage: "Default error",
      });
      expect(result).toBe("Default error");
    });

    it("should use provided message over default", () => {
      const result = responseHandler.constructErrorMessage({
        message: "Custom error",
        defaultMessage: "Default error",
      });
      expect(result).toBe("Custom error");
    });

    it("should append trace_id to error message", () => {
      const result = responseHandler.constructErrorMessage({
        message: "Error occurred",
        trace_id: "trace-123",
        defaultMessage: "Default error",
      });
      expect(result).toContain("Error occurred");
      expect(result).toContain("TraceID: trace-123");
    });

    it("should use custom message for known error codes", () => {
      const result = responseHandler.constructErrorMessage({
        code: 20009,
        trace_id: "trace-456",
        defaultMessage: "Default error",
      });
      expect(result).toContain("search.searchCancelled");
      expect(result).toContain("TraceID: trace-456");
    });
  });

  describe("setCancelSearchError", () => {
    it("should initialize hits array if missing", () => {
      // Use mockState directly
      delete (mockState.searchObj.data.queryResults as any).hits;

      responseHandler.setCancelSearchError();

      expect(Array.isArray(mockState.searchObj.data.queryResults.hits)).toBe(true);
    });

    it("should clear error when no hits", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.hits = [];
      mockState.searchObj.data.errorMsg = "Previous error";
      mockState.searchObj.data.errorCode = 500;

      responseHandler.setCancelSearchError();

      expect(mockState.searchObj.data.errorMsg).toBe("");
      expect(mockState.searchObj.data.errorCode).toBe(0);
    });

    it("should set histogram error when hits exist but no aggs", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.hits = [{ id: 1 }];
      mockState.searchObj.data.queryResults.aggs = [];

      responseHandler.setCancelSearchError();

      expect(mockState.searchObj.data.histogram.errorMsg).toBe(
        "Histogram search query was cancelled"
      );
    });
  });

  describe("handleSearchError", () => {
    it("should handle generic search error", () => {
      // Use mockState directly
      const notifications = useNotifications();

      const request = { type: "search" };
      const error = {
        content: {
          message: "Search failed",
          trace_id: "trace-789",
          code: 500,
          error_detail: "Internal server error",
          error: "server_error",
        },
      };

      responseHandler.handleSearchError(request, error as any);

      expect(mockState.searchObj.loading).toBe(false);
      expect(mockState.searchObj.loadingHistogram).toBe(false);
      expect(mockState.searchObj.data.errorMsg).toContain("Search failed");
    });

    it("should handle cancelled search error", () => {
      // Use mockState directly
      const notifications = useNotifications();

      const request = { type: "search" };
      const error = {
        content: {
          message: "Search cancelled",
          code: 20009,
          error: "cancelled",
        },
      };

      responseHandler.handleSearchError(request, error as any);

      expect(notifications.showCancelSearchNotification).toHaveBeenCalled();
    });

    it("should handle rate limit error", () => {
      // Use mockState directly

      const request = { type: "search" };
      const error = {
        content: {
          message: "Rate limit exceeded",
          error: "rate_limit_exceeded",
        },
      };

      responseHandler.handleSearchError(request, error as any);

      expect(mockState.searchObj.data.errorMsg).toBe("Rate limit exceeded");
    });

    it("should handle pageCount error", () => {
      // Use mockState directly

      const request = { type: "pageCount" };
      const error = {
        content: {
          message: "Page count failed",
          trace_id: "trace-pc",
        },
      };

      responseHandler.handleSearchError(request, error as any);

      expect(mockState.searchObj.data.countErrorMsg).toContain(
        "Error while retrieving total events"
      );
      expect(mockState.searchObj.data.countErrorMsg).toContain("TraceID: trace-pc");
    });

    it("should handle histogram error", () => {
      // Use mockState directly

      const request = { type: "histogram" };
      const error = {
        content: {
          message: "Histogram failed",
          code: 404,
          error_detail: "Data not found",
        },
      };

      responseHandler.handleSearchError(request, error as any);

      expect(mockState.searchObj.data.histogram.errorMsg).toContain(
        "Histogram failed"
      );
      expect(mockState.searchObj.data.histogram.errorCode).toBe(404);
      expect(mockState.searchObj.data.histogram.errorDetail).toBe("Data not found");
    });
  });

  describe("handleSearchResponse", () => {
    beforeEach(() => {
      // The shared mockSearchPartitionMap is already cleared in the main beforeEach
    });

    it("should handle search_response_hits", () => {
      // First call metadata to initialize the partition map
      const metadataPayload = {
        type: "search",
        traceId: "trace-1",
        isPagination: false,
        queryReq: { query: { from: 0, size: 100 } },
      };

      const metadataResponse = {
        type: "search_response_metadata",
        content: {
          results: {
            total: 100,
            took: 10,
            scan_size: 1000,
          },
        },
      };

      responseHandler.handleSearchResponse(metadataPayload as any, metadataResponse as any);

      // Now test the hits response
      const payload = {
        type: "search",
        traceId: "trace-1",
        isPagination: false,
        queryReq: { query: { from: 0, size: 100 } },
      };

      const response = {
        type: "search_response_hits",
        content: {
          results: {
            hits: [{ id: 1 }, { id: 2 }],
          },
        },
      };

      responseHandler.handleSearchResponse(payload as any, response as any);

      expect(mockSearchPartitionMap["trace-1"].chunks[1]).toBe(1);
    });

    it("should handle search_response_metadata", () => {
      // Use mockState directly

      const payload = {
        type: "search",
        traceId: "trace-2",
        isPagination: false,
        queryReq: { query: { from: 0, size: 100 } },
      };

      const response = {
        type: "search_response_metadata",
        content: {
          results: {
            total: 1000,
            took: 50,
            scan_size: 5000,
          },
        },
      };

      responseHandler.handleSearchResponse(payload as any, response as any);

      expect(mockSearchPartitionMap["trace-2"]).toBeDefined();
      expect(mockSearchPartitionMap["trace-2"].partition).toBe(1);
    });

    it("should handle histogram_response_hits", () => {
      const payload = {
        type: "histogram",
        traceId: "trace-3",
        isPagination: false,
        queryReq: { query: {} },
      };

      const response = {
        type: "search_response_hits",
        content: {
          results: {
            hits: [
              { zo_sql_key: "2024-01-01T00:00:00", zo_sql_num: 100 },
            ],
          },
        },
      };

      responseHandler.handleSearchResponse(payload as any, response as any);

      // Use mockState directly
      expect(mockState.searchObj.loading).toBe(false);
    });

    it("should handle cancel_response", () => {
      // Use mockState directly
      const notifications = useNotifications();
      mockState.searchObj.loading = true;
      mockState.searchObj.loadingHistogram = true;

      const payload = {
        type: "search",
        traceId: "trace-cancel",
      };

      const response = {
        type: "cancel_response",
      };

      responseHandler.handleSearchResponse(payload as any, response as any);

      expect(mockState.searchObj.loading).toBe(false);
      expect(mockState.searchObj.loadingHistogram).toBe(false);
      expect(notifications.showCancelSearchNotification).toHaveBeenCalled();
    });
  });

  describe("handleFunctionError", () => {
    it("should set function error when present", () => {
      // Use mockState directly

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            function_error: "Invalid function syntax",
          },
        },
      };

      responseHandler.handleFunctionError(queryReq as any, response);

      expect(mockState.searchObj.data.functionError).toBe("Invalid function syntax");
    });

    it("should update datetime when function error has new time range", () => {
      // Use mockState directly
      const utils = logsUtils();

      const queryReq = {
        query: {
          start_time: 0,
          end_time: 1000000,
        },
      };
      const response = {
        content: {
          results: {
            function_error: "Time range error",
            new_start_time: 1000,
            new_end_time: 2000,
          },
        },
      };

      responseHandler.handleFunctionError(queryReq as any, response);

      expect(mockState.searchObj.data.datetime.startTime).toBe(1000);
      expect(mockState.searchObj.data.datetime.endTime).toBe(2000);
      expect(mockState.searchObj.data.datetime.type).toBe("absolute");
      expect(utils.updateUrlQueryParams).toHaveBeenCalled();
    });
  });

  describe("handleAggregation", () => {
    it("should set hasAggregation flag for SQL mode with aggregation", () => {
      // Use mockState directly
      mockState.searchObj.meta.sqlMode = true;

      const utils = logsUtils();
      vi.mocked(utils.fnParsedSQL).mockReturnValue({
        columns: [{ name: "COUNT(*)" }],
        groupby: ["field1"],
      });
      vi.mocked(utils.hasAggregation).mockReturnValue(true);

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            total: 500,
          },
        },
      };

      responseHandler.handleAggregation(queryReq as any, response);

      expect(mockState.searchAggData.hasAggregation).toBe(true);
      expect(mockState.searchObj.meta.resultGrid.showPagination).toBe(false);
    });

    it("should handle streaming aggs total", () => {
      // Use mockState directly
      mockState.searchObj.meta.sqlMode = true;

      const utils = logsUtils();
      vi.mocked(utils.fnParsedSQL).mockReturnValue({
        columns: [{ name: "COUNT(*)" }],
        groupby: null,
      });
      vi.mocked(utils.hasAggregation).mockReturnValue(true);

      const queryReq = { query: {} };
      const response = {
        content: {
          streaming_aggs: true,
          results: {
            total: 1000,
          },
        },
      };

      responseHandler.handleAggregation(queryReq as any, response);

      expect(mockState.searchAggData.total).toBe(1000);
    });
  });

  describe("updatePageCountTotal", () => {
    it("should update page count when at page boundary", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 2;

      const queryReq = { query: { size: 100, from: 100 } };

      responseHandler.updatePageCountTotal(queryReq as any, 100, 100);

      expect(mockState.searchObj.data.queryResults.pageCountTotal).toBe(201);
    });

    it("should update page count when not at page boundary", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 2;

      const queryReq = { query: { size: 100, from: 100 } };

      responseHandler.updatePageCountTotal(queryReq as any, 75, 75);

      expect(mockState.searchObj.data.queryResults.pageCountTotal).toBe(175);
    });
  });

  describe("trimPageCountExtraHit", () => {
    it("should trim last hit when at page boundary", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.hits = [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ];

      const queryReq = { query: { size: 3, from: 0 } };

      responseHandler.trimPageCountExtraHit(queryReq as any, 3);

      expect(mockState.searchObj.data.queryResults.hits.length).toBe(2);
    });

    it("should not trim when not at page boundary", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.hits = [{ id: 1 }, { id: 2 }];

      const queryReq = { query: { size: 3, from: 0 } };

      responseHandler.trimPageCountExtraHit(queryReq as any, 2);

      expect(mockState.searchObj.data.queryResults.hits.length).toBe(2);
    });
  });
});
