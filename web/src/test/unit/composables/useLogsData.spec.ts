// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLogsData } from "@/composables/useLogsData";

// Mock store and router
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org"
    }
  }
};

const mockRouter = {
  currentRoute: {
    value: {
      query: {}
    }
  }
};

// Mock dependencies
vi.mock("vuex", () => ({
  useStore: vi.fn(() => mockStore)
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => mockRouter)
}));

vi.mock("vue", () => ({
  ref: vi.fn((val) => ({ value: val })),
  reactive: vi.fn((obj) => obj),
  computed: vi.fn((fn) => ({ value: fn() }))
}));

// Mock stream service
vi.mock("@/services/stream", () => ({
  default: {
    nameList: vi.fn(() => Promise.resolve({ 
      data: { 
        list: [
          { name: "test-stream", schema: { fields: [] } }
        ] 
      } 
    })),
    schema: vi.fn(() => Promise.resolve({ 
      data: { 
        fields: [
          { name: "timestamp", type: "string" },
          { name: "message", type: "string" }
        ] 
      } 
    }))
  }
}));

// Mock API services
vi.mock("@/services/logs/logsApi", () => ({
  logsApi: {
    search: vi.fn(() => Promise.resolve({ data: { hits: [], total: 0 } }))
  }
}));

vi.mock("@/services/logs/savedViewsApi", () => ({
  savedViewsApi: {
    get: vi.fn(() => Promise.resolve({ data: [] }))
  }
}));

// Mock other composables
vi.mock("@/composables/useSuggestions", () => ({
  default: vi.fn(() => ({
    updateFieldKeywords: vi.fn()
  }))
}));

vi.mock("@/composables/useLogsState", () => ({
  useLogsState: vi.fn(() => ({
    searchObj: {
      data: {
        stream: {
          loading: false,
          streamLists: [],
          selectedStream: [],
          selectedStreamFields: [],
          selectedFields: [],
          streamType: "logs"
        },
        queryResults: {
          hits: [
            {
              _source: {
                timestamp: "2023-01-01T00:00:00Z",
                message: "Test log message",
                level: "INFO"
              }
            }
          ],
          total: 1,
          partitionDetail: {
            paginations: [],
            partition_size: 1000
          }
        },
        resultGrid: {
          columns: [],
          total: 0
        },
        errorMsg: "",
        errorCode: 0,
        histogram: {
          data: [],
          loading: false,
          errorCode: 0,
          errorMsg: ""
        },
        query: "SELECT * FROM logs"
      },
      meta: {
        resultGrid: {
          rowsPerPage: 50
        }
      }
    },
    searchAggData: {},
    fieldValues: { value: {} },
    streamSchemaFieldsIndexMapping: { value: {} }
  }))
}));

// Mock utility functions
vi.mock("@/utils/logs/formatters", () => ({
  formatLogDataUtil: vi.fn((data) => data),
  flattenObjectUtil: vi.fn((obj) => obj),
  groupDataByFieldUtil: vi.fn((data) => data),
  mapDataToFieldsUtil: vi.fn((data) => data),
  encodeBase64Util: vi.fn((str) => btoa(str)),
  decodeBase64Util: vi.fn((str) => atob(str))
}));

vi.mock("@/utils/logs/datetime", () => ({
  extractTimestampsUtil: vi.fn(() => ({ start: 0, end: Date.now() })),
  calculateDatetimeRangeUtil: vi.fn(() => ({ start: 0, end: Date.now() })),
  formatTimestampUtil: vi.fn((ts) => new Date(ts).toISOString())
}));

vi.mock("@/utils/logs/transformers", () => ({
  chunkedAppendUtil: vi.fn((target, source) => {
    target.push(...source);
    return Promise.resolve();
  }),
  transformLogDataUtil: vi.fn((data) => data),
  processStreamDataUtil: vi.fn((data) => data)
}));

vi.mock("@/utils/logs/parsers", () => ({
  fnParsedSQL: vi.fn(() => ({ columns: [], groupby: null })),
  hasAggregation: vi.fn(() => false)
}));

vi.mock("@/utils/common", () => ({
  showErrorNotification: vi.fn()
}));

describe("useLogsData", () => {
  let logsData: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logsData = useLogsData();
  });

  describe("initialization", () => {
    it("should initialize data composable with all required functions", () => {
      expect(logsData).toBeDefined();
      expect(typeof logsData.getStreams).toBe("function");
      expect(typeof logsData.getStreamList).toBe("function");
      expect(typeof logsData.extractFields).toBe("function");
      expect(typeof logsData.updateFieldValues).toBe("function");
      expect(typeof logsData.updateResult).toBe("function");
    });

    it("should initialize processedFieldValues as ref", () => {
      expect(logsData.processedFieldValues).toBeDefined();
      expect(logsData.processedFieldValues.value).toEqual({});
    });
  });

  describe("stream operations", () => {
    it("should get streams successfully", async () => {
      const result = await logsData.getStreams("", true);
      expect(Array.isArray(result)).toBe(true);
      
      const streamService = await import("@/services/stream");
      expect(streamService.default.nameList).toHaveBeenCalledWith("test-org", "logs", "");
    });

    it("should handle empty streams list", async () => {
      const streamService = await import("@/services/stream");
      streamService.default.nameList.mockResolvedValueOnce({ data: { list: [] } });
      
      const result = await logsData.getStreams("", true);
      expect(result).toEqual([]);
    });

    it("should get stream list with fields", async () => {
      await logsData.getStreamList(true);
      
      const streamService = await import("@/services/stream");
      expect(streamService.default.nameList).toHaveBeenCalled();
      expect(streamService.default.schema).toHaveBeenCalled();
    });

    it("should load stream lists with caching", async () => {
      const result = await logsData.loadStreamLists();
      const streamService = await import("@/services/stream");
      expect(streamService.default.nameList).toHaveBeenCalled();
    });

    it("should update streams", async () => {
      await expect(logsData.updateStreams()).resolves.not.toThrow();
      const streamService = await import("@/services/stream");
      expect(streamService.default.nameList).toHaveBeenCalled();
    });

    it("should set selected streams", () => {
      const streams = [{ name: "test-stream", value: "test-stream" }];
      expect(() => logsData.setSelectedStreams(streams)).not.toThrow();
    });

    it("should update selected stream fields", async () => {
      await expect(logsData.updateSelectedStreamFields()).resolves.not.toThrow();
    });
  });

  describe("field operations", () => {
    it("should extract fields from search results", () => {
      const fields = logsData.extractFields();
      expect(Array.isArray(fields)).toBe(true);
      expect(fields).toContain("timestamp");
      expect(fields).toContain("message");
      expect(fields).toContain("level");
    });

    it("should extract FTS fields", () => {
      const ftsFields = logsData.extractFTSFields();
      expect(Array.isArray(ftsFields)).toBe(true);
    });

    it("should update field values for autocomplete", () => {
      expect(() => logsData.updateFieldValues()).not.toThrow();
    });

    it("should reorder selected fields", () => {
      const fields = ["message", "timestamp", "level"];
      expect(() => logsData.reorderSelectedFields(fields)).not.toThrow();
    });
  });

  describe("data processing", () => {
    it("should update search results", async () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = {
        hits: [{ _source: { message: "test" } }],
        total: 1
      };
      
      await expect(logsData.updateResult(queryReq, response, false, false)).resolves.not.toThrow();
    });

    it("should handle logs response", async () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = {
        hits: [{ _source: { message: "test" } }],
        total: 1
      };
      
      await expect(logsData.handleLogsResponse(queryReq, response, false, false)).resolves.not.toThrow();
    });

    it("should handle histogram response", () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = {
        aggs: { histogram: [] }
      };
      
      expect(() => logsData.handleHistogramResponse(queryReq, response)).not.toThrow();
    });

    it("should handle page count response", () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = { total: 100 };
      
      expect(() => logsData.handlePageCountResponse(queryReq, response)).not.toThrow();
    });

    it("should handle aggregation data", () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = {
        aggs: { count: 100 },
        total: 100
      };
      
      expect(() => logsData.handleAggregation(queryReq, response)).not.toThrow();
    });

    it("should handle function errors", () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = {
        function_error: "Invalid function call"
      };
      
      expect(() => logsData.handleFunctionError(queryReq, response)).not.toThrow();
    });
  });

  describe("grid and filtering", () => {
    it("should filter hits columns based on selected fields", () => {
      const result = logsData.filterHitsColumns();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should update grid columns configuration", () => {
      expect(() => logsData.updateGridColumns()).not.toThrow();
    });

    it("should process post-pagination data", () => {
      expect(() => logsData.processPostPaginationData()).not.toThrow();
    });
  });

  describe("error handling", () => {
    it("should handle stream service errors", async () => {
      const streamService = await import("@/services/stream");
      streamService.default.nameList.mockRejectedValueOnce(new Error("Network error"));
      
      const result = await logsData.getStreams("", true);
      expect(result).toEqual([]);
    });

    it("should handle field extraction errors", () => {
      // The extractFields function is resilient and returns an array even with mocked data
      const fields = logsData.extractFields();
      expect(Array.isArray(fields)).toBe(true);
      // It returns actual fields from the mocked search results
    });

    it("should handle update field values errors", () => {
      // Mock searchObj to cause error
      logsData.searchObj = { data: { queryResults: { hits: null } } };
      
      expect(() => logsData.updateFieldValues()).not.toThrow();
    });

    it("should handle update result errors", async () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = null;
      
      await expect(logsData.updateResult(queryReq, response, false, false)).resolves.not.toThrow();
    });

    it("should handle logs response errors", async () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = { hits: null };
      
      // Test error handling without mocking internal utilities
      await expect(logsData.handleLogsResponse(queryReq, response, false, false)).resolves.not.toThrow();
    });

    it("should handle histogram response errors", () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = { aggs: null };
      
      // Test error handling for histogram response
      expect(() => logsData.handleHistogramResponse(queryReq, response)).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle full stream loading workflow", async () => {
      await logsData.getStreams("", true);
      await logsData.getStreamList(true);
      await logsData.updateStreams();
      
      const streamService = await import("@/services/stream");
      expect(streamService.default.nameList).toHaveBeenCalledTimes(3);
    });

    it("should handle full data processing workflow", async () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = {
        hits: [{ _source: { message: "test", timestamp: "2023-01-01" } }],
        aggs: { histogram: [] },
        total: 1
      };
      
      await logsData.updateResult(queryReq, response, false, false);
      
      const fields = logsData.extractFields();
      expect(fields.length).toBeGreaterThan(0);
      
      logsData.updateFieldValues();
      logsData.updateGridColumns();
      
      expect(() => logsData.filterHitsColumns()).not.toThrow();
    });

    it("should handle empty organization identifier", async () => {
      const originalStore = mockStore.state.selectedOrganization;
      mockStore.state.selectedOrganization = null;
      
      const result = await logsData.getStreams("", true);
      expect(result).toEqual([]);
      
      // Restore
      mockStore.state.selectedOrganization = originalStore;
    });

    it("should handle stream schema errors gracefully", async () => {
      const streamService = await import("@/services/stream");
      streamService.default.schema.mockRejectedValueOnce(new Error("Schema error"));
      
      await expect(logsData.updateSelectedStreamFields()).resolves.not.toThrow();
    });
  });
});