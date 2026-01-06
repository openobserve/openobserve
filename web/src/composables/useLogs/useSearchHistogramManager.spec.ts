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
import { useSearchHistogramManager } from "./useSearchHistogramManager";
import { searchState } from "./searchState";
import { logsUtils } from "./logsUtils";
import { useHistogram } from "./useHistogram";

// Create a shared mock state
const createMockState = () => ({
  searchObj: {
    data: {
      stream: { selectedStream: ["stream1"] },
      queryResults: { hits: [], aggs: [], histogram_interval: 0 },
      histogramQuery: { query: { sql: "SELECT * FROM stream1" } },
      histogramInterval: 60000,
      customDownloadQueryObj: {
        query: { start_time: 0, end_time: 1000000 },
      },
    },
    meta: {
      sqlMode: false,
      refreshHistogram: false,
      resultGrid: { chartInterval: "1m" },
      histogramDirtyFlag: false,
    },
    loading: false,
    loadingHistogram: false,
  },
  searchObjDebug: {},
  resetHistogramError: vi.fn(),
});

let mockState: ReturnType<typeof createMockState>;

// Create shared mock functions for useHistogram
const mockHistogramFunctions = {
  resetHistogramWithError: vi.fn(),
  generateHistogramSkeleton: vi.fn(),
  setMultiStreamHistogramQuery: vi.fn(() => "mocked SQL"),
  isHistogramEnabled: vi.fn(() => true),
};

// Mock dependencies
vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    currentRoute: { value: { query: {} } },
  })),
}));

vi.mock("./searchState", () => ({
  searchState: vi.fn(() => mockState),
}));

vi.mock("./logsUtils", () => ({
  logsUtils: vi.fn(() => ({
    fnParsedSQL: vi.fn(() => ({})),
    isDistinctQuery: vi.fn(() => false),
    isWithQuery: vi.fn(() => false),
    isLimitQuery: vi.fn(() => false),
    addTraceId: vi.fn(),
    isNonAggregatedSQLMode: vi.fn(() => true),
  })),
}));

vi.mock("./useHistogram", () => ({
  useHistogram: vi.fn(() => mockHistogramFunctions),
}));

vi.mock("@/utils/date", () => ({
  convertDateToTimestamp: vi.fn(() => ({ timestamp: 1000000 })),
}));

describe("useSearchHistogramManager", () => {
  let histogramManager: ReturnType<typeof useSearchHistogramManager>;

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    // Reset mock functions
    mockHistogramFunctions.resetHistogramWithError.mockClear();
    mockHistogramFunctions.generateHistogramSkeleton.mockClear();
    mockHistogramFunctions.setMultiStreamHistogramQuery.mockClear();
    mockHistogramFunctions.isHistogramEnabled.mockReturnValue(true);
    histogramManager = useSearchHistogramManager();
  });

  describe("isHistogramDataMissing", () => {
    it("should return true when aggs array is empty", () => {
      const searchObj = {
        data: {
          queryResults: {
            aggs: [],
          },
        },
      };
      expect(histogramManager.isHistogramDataMissing(searchObj)).toBe(true);
    });

    it("should return false when aggs array has data", () => {
      const searchObj = {
        data: {
          queryResults: {
            aggs: [{ zo_sql_key: "2024-01-01", zo_sql_num: 100 }],
          },
        },
      };
      expect(histogramManager.isHistogramDataMissing(searchObj)).toBe(false);
    });

    it("should return true when queryResults is undefined", () => {
      const searchObj = { data: {} };
      expect(histogramManager.isHistogramDataMissing(searchObj)).toBe(true);
    });
  });

  describe("shouldShowHistogram", () => {
    it("should return true for single stream non-SQL mode", () => {
      // Use mockState directly
      mockState.searchObj.data.stream.selectedStream = ["stream1"];
      mockState.searchObj.meta.sqlMode = false;

      const parsedSQL = {};
      const result = histogramManager.shouldShowHistogram(parsedSQL);
      expect(result).toBe(true);
    });

    it("should return true for multi-stream non-SQL mode", () => {
      // Use mockState directly
      mockState.searchObj.data.stream.selectedStream = ["stream1", "stream2"];
      mockState.searchObj.meta.sqlMode = false;

      const parsedSQL = {};
      const result = histogramManager.shouldShowHistogram(parsedSQL);
      expect(result).toBe(true);
    });
  });

  describe("resetHistogramResults", () => {
    it("should clear histogram results", () => {
      histogramManager.resetHistogramResults();
      expect(histogramManager.getHistogramResults()).toEqual([]);
    });
  });

  describe("getHistogramResults", () => {
    it("should return current histogram results", () => {
      histogramManager.resetHistogramResults();
      const results = histogramManager.getHistogramResults();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("shouldGetPageCount", () => {
    it("should return false when histogram should be shown", () => {
      const queryReq = { query: { from: 0, size: 100 } };
      const parsedSQL = {};

      const utils = logsUtils();
      vi.mocked(utils.isLimitQuery).mockReturnValue(false);

      const result = histogramManager.shouldGetPageCount(queryReq, parsedSQL);
      expect(result).toBe(false);
    });

    it("should return false for SQL mode with LIMIT query", () => {
      // Use mockState directly
      mockState.searchObj.meta.sqlMode = true;

      const queryReq = { query: { from: 0, size: 100 } };
      const parsedSQL = { limit: 100 };

      const utils = logsUtils();
      vi.mocked(utils.isLimitQuery).mockReturnValue(true);

      const result = histogramManager.shouldGetPageCount(queryReq, parsedSQL);
      expect(result).toBe(false);
    });
  });

  describe("handleHistogramResponse", () => {
    it("should process histogram response correctly", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults = {
        aggs: [],
        scan_size: 0,
        took: 0,
        result_cache_ratio: 0,
        hits: [],
        histogram_interval: 0,
      };

      const queryReq = { query: { from: 0, size: 100 } };
      const response = {
        content: {
          results: {
            hits: [
              { zo_sql_key: "2024-01-01T00:00:00", zo_sql_num: 100 },
              { zo_sql_key: "2024-01-01T01:00:00", zo_sql_num: 150 },
            ],
            scan_size: 1000,
            took: 50,
            result_cache_ratio: 0.5,
          },
        },
      };

      const refreshPagination = vi.fn();

      histogramManager.handleHistogramResponse(
        queryReq,
        "trace-123",
        response,
        {},
        refreshPagination
      );

      expect(mockState.searchObj.loading).toBe(false);
      expect(mockState.searchObj.data.queryResults.aggs.length).toBe(2);
      expect(mockState.searchObj.data.queryResults.scan_size).toBe(1000);
      expect(mockState.searchObj.data.queryResults.took).toBe(50);
    });

    it("should initialize aggs array if null", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults = {
        aggs: null as any,
        scan_size: 0,
        took: 0,
        result_cache_ratio: 0,
        hits: [],
        histogram_interval: 0,
      };

      const queryReq = { query: { from: 0, size: 100 } };
      const response = {
        content: {
          results: {
            hits: [],
            scan_size: 0,
            took: 0,
            result_cache_ratio: 0,
          },
        },
      };

      histogramManager.handleHistogramResponse(
        queryReq,
        "trace-123",
        response,
        {},
        vi.fn()
      );

      expect(Array.isArray(mockState.searchObj.data.queryResults.aggs)).toBe(true);
    });

    it("should not call refreshPagination when isHistogramOnly is true", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults = {
        aggs: [],
        scan_size: 0,
        took: 0,
        result_cache_ratio: 0,
        hits: [],
        histogram_interval: 0,
      };

      const queryReq = { query: { from: 0, size: 100 } };
      const response = {
        content: {
          results: {
            hits: [],
            scan_size: 0,
            took: 0,
            result_cache_ratio: 0,
          },
        },
      };

      const refreshPagination = vi.fn();

      histogramManager.handleHistogramResponse(
        queryReq,
        "trace-123",
        response,
        { isHistogramOnly: true },
        refreshPagination
      );

      // The refreshPagination call happens in an async IIFE, so we need to wait
      // In this case, it shouldn't be called due to isHistogramOnly
      setTimeout(() => {
        expect(refreshPagination).not.toHaveBeenCalled();
      }, 10);
    });
  });

  describe("processHistogramRequest", () => {
    it("should return early if no query results hits", async () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults = { hits: [] };

      const queryReq = { query: { from: 0, size: 100 } };
      const buildWebSocketPayload = vi.fn();
      const initializeSearchConnection = vi.fn();

      await histogramManager.processHistogramRequest(
        queryReq,
        buildWebSocketPayload,
        initializeSearchConnection
      );

      expect(buildWebSocketPayload).not.toHaveBeenCalled();
      expect(initializeSearchConnection).not.toHaveBeenCalled();
    });

    it("should show error for multi-stream SQL mode", async () => {
      // Use mockState directly
      mockState.searchObj.data.stream.selectedStream = ["stream1", "stream2"];
      mockState.searchObj.meta.sqlMode = true;
      mockState.searchObj.data.queryResults = {
        hits: [{ id: 1 }],
        aggs: [],
        histogram_interval: 0,
      };

      const queryReq = { query: { from: 0, size: 100 } };
      const buildWebSocketPayload = vi.fn();
      const initializeSearchConnection = vi.fn();

      await histogramManager.processHistogramRequest(
        queryReq,
        buildWebSocketPayload,
        initializeSearchConnection
      );

      expect(mockHistogramFunctions.resetHistogramWithError).toHaveBeenCalledWith(
        "Histogram is not available for multi-stream SQL mode search.",
        0
      );
    });

    it("should process histogram request with callbacks", async () => {
      // Use mockState directly
      mockState.searchObj.data.stream.selectedStream = ["stream1"];
      mockState.searchObj.meta.sqlMode = false;
      mockState.searchObj.data.queryResults = {
        hits: [{ id: 1 }],
        aggs: [],
        histogram_interval: 0,
      };

      const queryReq = { query: { from: 0, size: 100 } };
      const mockPayload = {
        queryReq: { query: { sql: "SELECT * [INTERVAL]" } },
        traceId: "trace-123",
      };
      const buildWebSocketPayload = vi.fn(() => mockPayload);
      const initializeSearchConnection = vi.fn(() => "req-123");

      const callbacks = {
        onData: vi.fn(),
        onError: vi.fn(),
        onComplete: vi.fn(),
        onReset: vi.fn(),
      };

      // Ensure isHistogramEnabled returns true for this test
      mockHistogramFunctions.isHistogramEnabled.mockReturnValue(true);

      await histogramManager.processHistogramRequest(
        queryReq,
        buildWebSocketPayload,
        initializeSearchConnection,
        callbacks
      );

      expect(mockHistogramFunctions.generateHistogramSkeleton).toHaveBeenCalled();
      expect(buildWebSocketPayload).toHaveBeenCalled();
      expect(initializeSearchConnection).toHaveBeenCalled();
    });
  });

  describe("getPageCountThroughSocket", () => {
    it("should return early if total exceeds current page", async () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults = { total: 500 };

      const queryReq = { query: { from: 0, size: 100 } };
      const buildWebSocketPayload = vi.fn();
      const initializeSearchConnection = vi.fn();

      await histogramManager.getPageCountThroughSocket(
        queryReq,
        buildWebSocketPayload,
        initializeSearchConnection
      );

      expect(buildWebSocketPayload).not.toHaveBeenCalled();
    });

    it("should make page count request with correct modifications", async () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults = { total: 50 };

      const queryReq = {
        query: {
          from: 0,
          size: 100,
          quick_mode: true,
          action_id: "action-123",
        },
      };
      const mockPayload = { traceId: "trace-456" };
      const buildWebSocketPayload = vi.fn(() => mockPayload);
      const initializeSearchConnection = vi.fn(() => "req-456");

      await histogramManager.getPageCountThroughSocket(
        queryReq,
        buildWebSocketPayload,
        initializeSearchConnection
      );

      expect(queryReq.query.size).toBe(0);
      expect(queryReq.query.track_total_hits).toBe(true);
      expect(queryReq.query.from).toBeUndefined();
      expect(queryReq.query.quick_mode).toBeUndefined();
      expect(queryReq.query.action_id).toBeUndefined();
      expect(buildWebSocketPayload).toHaveBeenCalled();
      expect(initializeSearchConnection).toHaveBeenCalled();
      expect(mockState.searchObj.loadingHistogram).toBe(true);
    });

    it("should use time_offset when available", async () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults = {
        total: 50,
        time_offset: {
          start_time: 1000,
          end_time: 2000,
        },
      };

      const queryReq = {
        query: {
          from: 0,
          size: 100,
          start_time: 0,
          end_time: 5000,
        },
      };
      const mockPayload = { traceId: "trace-789" };
      const buildWebSocketPayload = vi.fn(() => mockPayload);
      const initializeSearchConnection = vi.fn(() => "req-789");

      await histogramManager.getPageCountThroughSocket(
        queryReq,
        buildWebSocketPayload,
        initializeSearchConnection
      );

      expect(queryReq.query.start_time).toBe(1000);
      expect(queryReq.query.end_time).toBe(2000);
    });
  });
});
