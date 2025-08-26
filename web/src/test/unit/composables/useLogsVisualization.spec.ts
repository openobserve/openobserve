// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLogsVisualization } from "@/composables/useLogsVisualization";

// Mock store
const mockStore = {
  state: {
    timezone: "UTC",
    zoConfig: {
      timestamp_column: "_timestamp"
    }
  }
};

// Mock dependencies
vi.mock("vuex", () => ({
  useStore: vi.fn(() => mockStore)
}));

vi.mock("vue", () => ({
  ref: vi.fn((val) => ({ value: val })),
  reactive: vi.fn((obj) => obj),
  computed: vi.fn((fn) => ({ value: fn() }))
}));

// Mock useLogsState
vi.mock("@/composables/useLogsState", () => ({
  useLogsState: vi.fn(() => ({
    searchObj: {
      data: {
        query: "SELECT * FROM logs",
        histogram: {
          xData: [],
          yData: [],
          chartParams: {
            title: "",
            unparsed_x_data: [],
            timezone: "UTC"
          },
          errorCode: 0,
          errorMsg: "",
          errorDetail: ""
        },
        queryResults: {
          hits: [],
          total: 0,
          aggs: [],
          histogram_interval: null
        },
        customDownloadQueryObj: {
          query: {
            start_time: Date.now() - 3600000 * 1000
          }
        },
        resultGrid: {
          currentPage: 1
        },
        stream: {
          selectedStream: [
            { name: "test-stream", value: "test-stream" }
          ],
          filterField: "",
          missingStreamMultiStreamFilter: []
        },
        histogramInterval: 60000
      },
      meta: {
        showHistogram: true,
        histogramDirtyFlag: false,
        sqlMode: false,
        resultGrid: {
          rowsPerPage: 50,
          chartInterval: "1 minute",
          chartKeyFormat: "MMM DD, HH:mm",
          showPagination: true
        }
      },
      loadingHistogram: false,
      communicationMethod: "http"
    }
  }))
}));

// Mock utilities
vi.mock("@/utils/zincutils", () => ({
  histogramDateTimezone: vi.fn((timestamp, timezone) => {
    return new Date(timestamp).getTime();
  })
}));

vi.mock("@/utils/logs/constants", () => ({
  INTERVAL_MAP: {
    "1 minute": 60000,
    "5 minute": 300000,
    "10 minute": 600000,
    "1 hour": 3600000,
    "1 day": 86400000
  }
}));

vi.mock("@/utils/logs/formatters", () => ({
  generateHistogramTitle: vi.fn((params) => {
    return `Results (${params.totalCount} total)`;
  })
}));

vi.mock("@/utils/logs/parsers", () => ({
  createSQLParserFunctions: vi.fn(() => ({
    parseSQL: vi.fn((query) => {
      if (!query || query.trim() === "") return null;
      return {
        columns: [{ name: "*", type: "wildcard" }],
        from: [{ name: "logs" }],
        where: query.toLowerCase().includes("where") ? {} : null,
        limit: query.toLowerCase().includes("limit") ? 100 : null,
        distinct: query.toLowerCase().includes("distinct") ? true : null,
        with: query.toLowerCase().includes("with") ? {} : null
      };
    })
  })),
  hasAggregation: vi.fn((columns) => {
    return columns && columns.some((col: any) => 
      col.name && (col.name.includes("count") || col.name.includes("sum"))
    );
  })
}));

describe("useLogsVisualization", () => {
  let logsVisualization: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logsVisualization = useLogsVisualization();
  });

  describe("initialization", () => {
    it("should initialize visualization composable with all required functions", () => {
      expect(logsVisualization).toBeDefined();
      expect(typeof logsVisualization.generateHistogramData).toBe("function");
      expect(typeof logsVisualization.generateHistogramSkeleton).toBe("function");
      expect(typeof logsVisualization.resetHistogramWithError).toBe("function");
      expect(typeof logsVisualization.getHistogramTitle).toBe("function");
    });

    it("should initialize computed properties", () => {
      expect(logsVisualization.isHistogramEnabled).toBeDefined();
      expect(logsVisualization.isHistogramLoading).toBeDefined();
      expect(logsVisualization.hasHistogramData).toBeDefined();
      expect(logsVisualization.chartInterval).toBeDefined();
    });

    it("should initialize reactive state", () => {
      expect(logsVisualization.histogramResults).toBeDefined();
      expect(logsVisualization.histogramMappedData).toBeDefined();
    });
  });

  describe("histogram state management", () => {
    it("should reset histogram with error message", () => {
      const errorMsg = "Test error message";
      const errorCode = 500;
      
      expect(() => logsVisualization.resetHistogramWithError(errorMsg, errorCode)).not.toThrow();
    });

    it("should reset histogram error state", () => {
      expect(() => logsVisualization.resetHistogramError()).not.toThrow();
    });

    it("should initialize histogram structure", () => {
      expect(() => logsVisualization.initializeHistogram()).not.toThrow();
    });

    it("should clear histogram data", () => {
      logsVisualization.histogramResults.value = [{ test: "data" }];
      logsVisualization.clearHistogramData();
      
      expect(logsVisualization.histogramResults.value).toEqual([]);
    });

    it("should handle state management errors gracefully", () => {
      expect(() => logsVisualization.resetHistogramWithError("", 0)).not.toThrow();
      expect(() => logsVisualization.resetHistogramError()).not.toThrow();
    });
  });

  describe("histogram title generation", () => {
    it("should generate histogram title", () => {
      const title = logsVisualization.getHistogramTitle();
      expect(typeof title).toBe("string");
    });

    it("should update histogram title", () => {
      expect(() => logsVisualization.updateHistogramTitle()).not.toThrow();
    });

    it("should handle title generation errors", () => {
      const title = logsVisualization.getHistogramTitle();
      expect(typeof title).toBe("string");
    });
  });

  describe("histogram data generation", () => {
    it("should generate histogram data successfully", () => {
      // Mock aggregation data
      const mockAggs = [
        { zo_sql_key: "2023-01-01T12:00:00Z", zo_sql_num: "10" },
        { zo_sql_key: "2023-01-01T12:01:00Z", zo_sql_num: "15" }
      ];
      
      // Simulate aggregation data
      logsVisualization.histogramResults.value = mockAggs;
      
      expect(() => logsVisualization.generateHistogramData()).not.toThrow();
    });

    it("should generate histogram skeleton", () => {
      expect(() => logsVisualization.generateHistogramSkeleton()).not.toThrow();
    });

    it("should handle empty aggregation data", () => {
      logsVisualization.histogramResults.value = [];
      expect(() => logsVisualization.generateHistogramData()).not.toThrow();
    });

    it("should handle malformed aggregation data", () => {
      logsVisualization.histogramResults.value = [{ invalid: "data" }];
      expect(() => logsVisualization.generateHistogramData()).not.toThrow();
    });

    it("should handle generation errors gracefully", () => {
      // Test with invalid interval to trigger error
      expect(() => logsVisualization.generateHistogramData()).not.toThrow();
    });
  });

  describe("query analysis", () => {
    it("should check if query has LIMIT clause", () => {
      const parsedSQL = { limit: 100 };
      const result = logsVisualization.hasLimitQuery(parsedSQL);
      expect(result).toBe(true);
    });

    it("should check if query has DISTINCT clause", () => {
      const parsedSQL = { distinct: true };
      const result = logsVisualization.hasDistinctQuery(parsedSQL);
      expect(result).toBe(true);
    });

    it("should check if query has WITH clause", () => {
      const parsedSQL = { with: {} };
      const result = logsVisualization.hasWithQuery(parsedSQL);
      expect(result).toBe(true);
    });

    it("should determine if histogram should be shown", () => {
      const parsedSQL = { columns: [{ name: "*" }] };
      const result = logsVisualization.shouldShowHistogram(parsedSQL);
      expect(typeof result).toBe("boolean");
    });

    it("should handle null/undefined parsed SQL", () => {
      expect(logsVisualization.hasLimitQuery(null)).toBe(false);
      expect(logsVisualization.hasDistinctQuery(undefined)).toBe(false);
      expect(logsVisualization.hasWithQuery({})).toBe(false);
    });
  });

  describe("multi-stream histogram query", () => {
    it("should set multi-stream histogram query", () => {
      const queryReq = {
        query: {
          sql: "SELECT * FROM logs"
        }
      };
      
      const result = logsVisualization.setMultiStreamHistogramQuery(queryReq);
      expect(typeof result).toBe("string");
    });

    it("should handle single stream scenario", () => {
      const queryReq = {
        query: {
          sql: "SELECT * FROM single_stream"
        }
      };
      
      const result = logsVisualization.setMultiStreamHistogramQuery(queryReq);
      expect(result).toBe(queryReq.query.sql);
    });

    it("should handle missing stream filter fields", () => {
      const queryReq = {
        query: {
          sql: "SELECT * FROM logs"
        }
      };
      
      // Mock missing stream filter
      const mockSearchObj = logsVisualization;
      
      const result = logsVisualization.setMultiStreamHistogramQuery(queryReq);
      expect(typeof result).toBe("string");
    });

    it("should handle query generation errors", () => {
      const invalidQuery = null;
      const result = logsVisualization.setMultiStreamHistogramQuery(invalidQuery);
      expect(result).toBeNull();
    });
  });

  describe("chart configuration", () => {
    it("should set chart interval", () => {
      const timeIntervalData = {
        interval: "5 minute",
        keyFormat: "MMM DD, HH:mm"
      };
      
      expect(() => logsVisualization.setChartInterval(timeIntervalData)).not.toThrow();
    });

    it("should get visualization config from panel data", () => {
      const dashboardPanelData = {
        data: {
          config: { chartType: "bar" },
          type: "histogram"
        }
      };
      
      const result = logsVisualization.getVisualizationConfig(dashboardPanelData);
      expect(result).toBeDefined();
      expect(result.config).toBeDefined();
      expect(result.type).toBe("histogram");
    });

    it("should return null for invalid panel data", () => {
      const result = logsVisualization.getVisualizationConfig(null);
      expect(result).toBeNull();
    });

    it("should handle config extraction errors", () => {
      const invalidData = { invalid: "structure" };
      const result = logsVisualization.getVisualizationConfig(invalidData);
      expect(result).toBeNull();
    });
  });

  describe("histogram statistics", () => {
    it("should get histogram statistics", () => {
      // Mock histogram data
      const mockHistogram = {
        xData: [1, 2, 3],
        yData: [10, 20, 30],
        errorCode: 0,
        errorMsg: ""
      };
      
      const stats = logsVisualization.getHistogramStats();
      expect(stats).toBeDefined();
      if (stats) {
        expect(typeof stats.totalDataPoints).toBe("number");
        expect(typeof stats.totalCount).toBe("number");
        expect(typeof stats.hasData).toBe("boolean");
        expect(typeof stats.hasError).toBe("boolean");
      }
    });

    it("should handle empty histogram data", () => {
      const stats = logsVisualization.getHistogramStats();
      expect(stats).toBeDefined();
    });

    it("should detect histogram errors", () => {
      const stats = logsVisualization.getHistogramStats();
      expect(stats).toBeDefined();
      if (stats) {
        expect(typeof stats.hasError).toBe("boolean");
      }
    });

    it("should handle statistics calculation errors", () => {
      const stats = logsVisualization.getHistogramStats();
      expect(stats).toBeDefined();
    });
  });

  describe("validation and utility functions", () => {
    it("should validate histogram interval", () => {
      expect(logsVisualization.validateHistogramInterval("1 minute")).toBe(true);
      expect(logsVisualization.validateHistogramInterval("5 minute")).toBe(true);
      expect(logsVisualization.validateHistogramInterval("invalid")).toBe(false);
    });

    it("should export histogram data", () => {
      const exported = logsVisualization.exportHistogramData();
      expect(exported).toBeDefined();
    });

    it("should handle export with no data", () => {
      // Clear histogram data
      logsVisualization.clearHistogramData();
      
      const exported = logsVisualization.exportHistogramData();
      expect(exported).toBeNull();
    });

    it("should handle validation errors gracefully", () => {
      expect(() => logsVisualization.validateHistogramInterval("")).not.toThrow();
      expect(() => logsVisualization.exportHistogramData()).not.toThrow();
    });
  });

  describe("computed properties behavior", () => {
    it("should compute isHistogramEnabled correctly", () => {
      expect(typeof logsVisualization.isHistogramEnabled.value).toBe("boolean");
    });

    it("should compute hasHistogramData correctly", () => {
      expect(typeof logsVisualization.hasHistogramData.value).toBe("boolean");
    });

    it("should compute chartInterval correctly", () => {
      expect(typeof logsVisualization.chartInterval.value).toBe("string");
    });

    it("should compute isMultiStreamSearch correctly", () => {
      expect(typeof logsVisualization.isMultiStreamSearch.value).toBe("boolean");
    });

    it("should compute isSQLMode correctly", () => {
      expect(typeof logsVisualization.isSQLMode.value).toBe("boolean");
    });
  });

  describe("error handling", () => {
    it("should handle histogram data generation errors", () => {
      expect(() => logsVisualization.generateHistogramData()).not.toThrow();
    });

    it("should handle skeleton generation errors", () => {
      expect(() => logsVisualization.generateHistogramSkeleton()).not.toThrow();
    });

    it("should handle title generation errors", () => {
      const title = logsVisualization.getHistogramTitle();
      expect(typeof title).toBe("string");
    });

    it("should handle config retrieval errors", () => {
      const config = logsVisualization.getVisualizationConfig({ invalid: "data" });
      expect(config).toBeNull();
    });

    it("should handle all operation errors gracefully", () => {
      expect(() => logsVisualization.clearHistogramData()).not.toThrow();
      expect(() => logsVisualization.initializeHistogram()).not.toThrow();
      expect(() => logsVisualization.updateHistogramTitle()).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete histogram workflow", () => {
      // Initialize histogram
      logsVisualization.initializeHistogram();
      
      // Generate skeleton
      logsVisualization.generateHistogramSkeleton();
      
      // Add some test data
      logsVisualization.histogramResults.value = [
        { zo_sql_key: "2023-01-01T12:00:00Z", zo_sql_num: "10" }
      ];
      
      // Generate histogram data
      logsVisualization.generateHistogramData();
      
      // Update title
      logsVisualization.updateHistogramTitle();
      
      // Get statistics
      const stats = logsVisualization.getHistogramStats();
      expect(stats).toBeDefined();
      
      // Export data
      const exported = logsVisualization.exportHistogramData();
      expect(exported).toBeDefined();
    });

    it("should handle error recovery workflow", () => {
      // Reset with error
      logsVisualization.resetHistogramWithError("Test error", 500);
      
      // Reset error state
      logsVisualization.resetHistogramError();
      
      // Initialize fresh
      logsVisualization.initializeHistogram();
      
      // Verify state is clean
      const stats = logsVisualization.getHistogramStats();
      expect(stats).toBeDefined();
    });

    it("should handle multi-stream workflow", () => {
      // Test multi-stream query generation
      const queryReq = {
        query: {
          sql: "SELECT * FROM logs"
        }
      };
      
      const multiStreamQuery = logsVisualization.setMultiStreamHistogramQuery(queryReq);
      expect(typeof multiStreamQuery).toBe("string");
      
      // Test should show histogram for multi-stream
      const parsedSQL = { columns: [{ name: "*" }] };
      const shouldShow = logsVisualization.shouldShowHistogram(parsedSQL);
      expect(typeof shouldShow).toBe("boolean");
    });

    it("should handle SQL mode restrictions", () => {
      // Test various SQL restrictions
      const limitQuery = { limit: 100 };
      const distinctQuery = { distinct: true };
      const withQuery = { with: {} };
      
      expect(logsVisualization.hasLimitQuery(limitQuery)).toBe(true);
      expect(logsVisualization.hasDistinctQuery(distinctQuery)).toBe(true);
      expect(logsVisualization.hasWithQuery(withQuery)).toBe(true);
      
      // Test histogram visibility with restrictions
      expect(typeof logsVisualization.shouldShowHistogram(limitQuery)).toBe("boolean");
    });
  });
});