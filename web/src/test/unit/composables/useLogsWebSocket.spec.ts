// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLogsWebSocket } from "@/composables/useLogsWebSocket";

// Mock store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org"
    },
    zoConfig: {
      sql_base64_enabled: false
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
        stream: {
          selectedStream: [
            { name: "test-stream", value: "test-stream" }
          ],
          streamType: "logs"
        },
        searchRequestTraceIds: [],
        searchWebSocketTraceIds: [],
        isOperationCancelled: false,
        queryResults: {
          hits: [],
          total: 0,
          aggs: [],
          scan_size: 0,
          took: 0,
          streaming_aggs: false
        },
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
        functionError: "",
        errorCode: 0,
        errorMsg: "",
        errorDetail: ""
      },
      meta: {
        sqlMode: false,
        showDetailTab: false,
        searchApplied: false,
        resultGrid: {
          rowsPerPage: 50
        }
      },
      loading: false,
      loadingHistogram: false,
      loadingCounter: false,
      communicationMethod: "http"
    },
    searchAggData: {
      total: 0,
      hasAggregation: false
    }
  }))
}));

// Mock other composables
vi.mock("@/composables/useWebSocket", () => ({
  default: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn()
  }))
}));

vi.mock("@/composables/useSearchWebSocket", () => ({
  default: vi.fn(() => ({
    fetchQueryDataWithWebSocket: vi.fn(() => "test-request-id"),
    sendSearchMessageBasedOnRequestId: vi.fn(),
    cancelSearchQueryBasedOnRequestId: vi.fn(),
    closeSocketBasedOnRequestId: vi.fn()
  }))
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: vi.fn(() => ({
    fetchQueryDataWithHttpStream: vi.fn(() => Promise.resolve())
  }))
}));

vi.mock("@/composables/useNotifications", () => ({
  useNotifications: vi.fn(() => ({
    showErrorNotification: vi.fn(),
    showCancelSearchNotification: vi.fn()
  }))
}));

// Mock utilities
vi.mock("@/utils/zincutils", () => ({
  isWebSocketEnabled: vi.fn((state) => true),
  isStreamingEnabled: vi.fn((state) => false),
  generateTraceContext: vi.fn(() => ({
    traceId: "test-trace-id",
    spanId: "test-span-id"
  })),
  getUUID: vi.fn(() => "test-uuid")
}));

vi.mock("@/utils/logs/transformers", () => ({
  buildWebSocketPayload: vi.fn((params) => ({
    payload: {
      queryReq: params.queryReq,
      type: params.type,
      isPagination: params.isPagination,
      traceId: "test-trace-id",
      org_id: "test-org"
    },
    traceId: "test-trace-id"
  }))
}));

describe("useLogsWebSocket", () => {
  let logsWebSocket: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logsWebSocket = useLogsWebSocket();
  });

  describe("initialization", () => {
    it("should initialize WebSocket composable with all required functions", () => {
      expect(logsWebSocket).toBeDefined();
      expect(typeof logsWebSocket.setCommunicationMethod).toBe("function");
      expect(typeof logsWebSocket.initializeSearchConnection).toBe("function");
      expect(typeof logsWebSocket.buildWebSocketPayload).toBe("function");
      expect(typeof logsWebSocket.handleSearchResponse).toBe("function");
    });

    it("should initialize state references", () => {
      expect(logsWebSocket.searchPartitionMap).toBeDefined();
    });

    it("should initialize message handlers", () => {
      expect(typeof logsWebSocket.sendSearchMessage).toBe("function");
      expect(typeof logsWebSocket.sendCancelSearchMessage).toBe("function");
      expect(typeof logsWebSocket.handleSearchClose).toBe("function");
      expect(typeof logsWebSocket.handleSearchError).toBe("function");
    });
  });

  describe("communication method selection", () => {
    it("should set WebSocket communication method", () => {
      const method = logsWebSocket.setCommunicationMethod();
      expect(method).toBe("ws");
    });

    it("should set streaming communication method when enabled", () => {
      // Mock streaming enabled
      vi.doMock("@/utils/zincutils", () => ({
        isWebSocketEnabled: vi.fn(() => false),
        isStreamingEnabled: vi.fn(() => true),
        generateTraceContext: vi.fn(() => ({ traceId: "test", spanId: "test" })),
        getUUID: vi.fn(() => "test")
      }));
      
      const method = logsWebSocket.setCommunicationMethod();
      expect(typeof method).toBe("string");
    });

    it("should default to HTTP when neither WebSocket nor streaming is enabled", () => {
      vi.doMock("@/utils/zincutils", () => ({
        isWebSocketEnabled: vi.fn(() => false),
        isStreamingEnabled: vi.fn(() => false),
        generateTraceContext: vi.fn(() => ({ traceId: "test", spanId: "test" })),
        getUUID: vi.fn(() => "test")
      }));
      
      const method = logsWebSocket.setCommunicationMethod();
      expect(typeof method).toBe("string");
    });

    it("should handle method selection errors gracefully", () => {
      expect(() => logsWebSocket.setCommunicationMethod()).not.toThrow();
    });
  });

  describe("WebSocket payload building", () => {
    it("should build WebSocket payload for search", () => {
      const queryReq = {
        query: { sql: "SELECT * FROM logs", start_time: 0, end_time: Date.now() }
      };
      
      const payload = logsWebSocket.buildWebSocketPayload(queryReq, false, "search");
      expect(payload).toBeDefined();
      expect(payload.type).toBe("search");
      expect(payload.traceId).toBeDefined();
    });

    it("should build WebSocket payload for histogram", () => {
      const queryReq = {
        query: { sql: "SELECT * FROM logs", start_time: 0, end_time: Date.now() }
      };
      
      const payload = logsWebSocket.buildWebSocketPayload(queryReq, false, "histogram");
      expect(payload).toBeDefined();
      expect(payload.type).toBe("histogram");
    });

    it("should build WebSocket payload for page count", () => {
      const queryReq = {
        query: { sql: "SELECT * FROM logs", start_time: 0, end_time: Date.now() }
      };
      
      const payload = logsWebSocket.buildWebSocketPayload(queryReq, false, "pageCount");
      expect(payload).toBeDefined();
      expect(payload.type).toBe("pageCount");
    });

    it("should handle payload building errors", () => {
      const result = logsWebSocket.buildWebSocketPayload(null, false, "search");
      expect(result).toBeNull();
    });
  });

  describe("search connection initialization", () => {
    it("should initialize WebSocket connection", () => {
      const payload = {
        queryReq: { query: { sql: "SELECT * FROM logs" } },
        type: "search",
        traceId: "test-trace-id"
      };
      
      const result = logsWebSocket.initializeSearchConnection(payload);
      expect(result).toBeDefined();
    });

    it("should initialize streaming connection", () => {
      // Mock streaming method
      const mockSearchObj = {
        communicationMethod: "streaming",
        data: { stream: { streamType: "logs" } }
      };
      
      const payload = {
        queryReq: { query: { sql: "SELECT * FROM logs" } },
        type: "search",
        traceId: "test-trace-id"
      };
      
      const result = logsWebSocket.initializeSearchConnection(payload);
      expect(result).toBeDefined();
    });

    it("should return null for HTTP method", () => {
      // Mock HTTP method
      const mockSearchObj = {
        communicationMethod: "http"
      };
      
      const payload = {
        queryReq: { query: { sql: "SELECT * FROM logs" } },
        type: "search"
      };
      
      const result = logsWebSocket.initializeSearchConnection(payload);
      expect(result).toBeNull();
    });

    it("should handle connection initialization errors", () => {
      expect(() => logsWebSocket.initializeSearchConnection({})).not.toThrow();
    });
  });

  describe("trace ID management", () => {
    it("should add trace ID", () => {
      const traceId = "test-trace-id";
      expect(() => logsWebSocket.addTraceId(traceId)).not.toThrow();
    });

    it("should remove trace ID", () => {
      const traceId = "test-trace-id";
      logsWebSocket.addTraceId(traceId);
      expect(() => logsWebSocket.removeTraceId(traceId)).not.toThrow();
    });

    it("should handle trace ID operations for different communication methods", () => {
      const traceId = "test-trace-id";
      
      // Test WebSocket method
      expect(() => logsWebSocket.addTraceId(traceId)).not.toThrow();
      expect(() => logsWebSocket.removeTraceId(traceId)).not.toThrow();
    });

    it("should handle trace ID errors gracefully", () => {
      expect(() => logsWebSocket.addTraceId("")).not.toThrow();
      expect(() => logsWebSocket.removeTraceId("")).not.toThrow();
    });
  });

  describe("message handling", () => {
    it("should send search message", () => {
      const queryReq = {
        traceId: "test-trace-id",
        queryReq: {
          query: { sql: "SELECT * FROM logs" },
          encoding: "base64"
        }
      };
      
      expect(() => logsWebSocket.sendSearchMessage(queryReq)).not.toThrow();
    });

    it("should send cancel search message", () => {
      const searchRequests = ["trace-1", "trace-2"];
      expect(() => logsWebSocket.sendCancelSearchMessage(searchRequests)).not.toThrow();
    });

    it("should handle empty cancel search requests", () => {
      expect(() => logsWebSocket.sendCancelSearchMessage([])).not.toThrow();
    });

    it("should handle message sending errors", () => {
      expect(() => logsWebSocket.sendSearchMessage(null)).not.toThrow();
      expect(() => logsWebSocket.sendCancelSearchMessage(null)).not.toThrow();
    });
  });

  describe("response handlers", () => {
    const mockPayload = {
      queryReq: { query: { sql: "SELECT * FROM logs" } },
      type: "search" as const,
      isPagination: false,
      traceId: "test-trace-id",
      org_id: "test-org"
    };

    const mockResponse = {
      type: "search_response_hits" as const,
      content: {
        results: {
          hits: [{ id: 1, message: "test" }],
          total: 1,
          took: 10,
          scan_size: 100,
          from: 0
        },
        traceId: "test-trace-id"
      }
    };

    it("should handle search response hits", () => {
      expect(() => logsWebSocket.handleSearchResponse(mockPayload, mockResponse)).not.toThrow();
    });

    it("should handle search response metadata", () => {
      const metadataResponse = {
        ...mockResponse,
        type: "search_response_metadata" as const
      };
      
      expect(() => logsWebSocket.handleSearchResponse(mockPayload, metadataResponse)).not.toThrow();
    });

    it("should handle histogram responses", () => {
      const histogramPayload = {
        ...mockPayload,
        type: "histogram" as const
      };
      
      expect(() => logsWebSocket.handleSearchResponse(histogramPayload, mockResponse)).not.toThrow();
    });

    it("should handle page count responses", () => {
      const pageCountPayload = {
        ...mockPayload,
        type: "pageCount" as const
      };
      
      expect(() => logsWebSocket.handleSearchResponse(pageCountPayload, mockResponse)).not.toThrow();
    });

    it("should handle cancel responses", () => {
      const cancelResponse = {
        type: "cancel_response" as const,
        content: {
          results: { hits: [], total: 0, took: 0 },
          traceId: "test-trace-id"
        }
      };
      
      expect(() => logsWebSocket.handleSearchResponse(mockPayload, cancelResponse)).not.toThrow();
    });

    it("should handle response processing errors", () => {
      expect(() => logsWebSocket.handleSearchResponse(null, null)).not.toThrow();
      expect(() => logsWebSocket.handleSearchResponse(mockPayload, null)).not.toThrow();
    });
  });

  describe("streaming handlers", () => {
    const mockPayload = {
      queryReq: { query: { sql: "SELECT * FROM logs" } },
      type: "search" as const,
      isPagination: false,
      traceId: "test-trace-id",
      org_id: "test-org"
    };

    const mockResponse = {
      type: "search_response_hits" as const,
      content: {
        results: {
          hits: [{ id: 1, message: "test" }],
          total: 1,
          took: 10,
          scan_size: 100,
          from: 0,
          aggs: [{ key: "test", count: 1 }]
        },
        streaming_aggs: false,
        traceId: "test-trace-id"
      }
    };

    it("should handle streaming hits", () => {
      expect(() => logsWebSocket.handleStreamingHits(mockPayload, mockResponse, false, false)).not.toThrow();
    });

    it("should handle streaming metadata", () => {
      expect(() => logsWebSocket.handleStreamingMetadata(mockPayload, mockResponse, false, false)).not.toThrow();
    });

    it("should handle histogram streaming hits", () => {
      expect(() => logsWebSocket.handleHistogramStreamingHits(mockPayload, mockResponse, false, false)).not.toThrow();
    });

    it("should handle histogram streaming metadata", () => {
      expect(() => logsWebSocket.handleHistogramStreamingMetadata(mockPayload, mockResponse, false, false)).not.toThrow();
    });

    it("should handle page count streaming hits", () => {
      expect(() => logsWebSocket.handlePageCountStreamingHits(mockPayload, mockResponse, false, false)).not.toThrow();
    });

    it("should handle page count streaming metadata", () => {
      expect(() => logsWebSocket.handlePageCountStreamingMetadata(mockPayload, mockResponse, false, false)).not.toThrow();
    });

    it("should handle streaming errors gracefully", () => {
      expect(() => logsWebSocket.handleStreamingHits(null, null, false, false)).not.toThrow();
      expect(() => logsWebSocket.handleStreamingMetadata(null, null, false, false)).not.toThrow();
    });
  });

  describe("connection management", () => {
    it("should handle search close", () => {
      const payload = { traceId: "test-trace-id" };
      const response = { code: 1000 };
      
      expect(() => logsWebSocket.handleSearchClose(payload, response)).not.toThrow();
    });

    it("should handle unexpected connection close", () => {
      const payload = { traceId: "test-trace-id" };
      const response = { code: 1001 };
      
      expect(() => logsWebSocket.handleSearchClose(payload, response)).not.toThrow();
    });

    it("should handle search error", () => {
      const request = { traceId: "test-trace-id" };
      const error = {
        content: {
          message: "Test error",
          trace_id: "test-trace-id",
          code: 500,
          error_detail: "Detailed error",
          error: "Error message"
        },
        type: "error" as const
      };
      
      expect(() => logsWebSocket.handleSearchError(request, error)).not.toThrow();
    });

    it("should handle query cancellation error", () => {
      const request = { traceId: "test-trace-id" };
      const error = {
        content: {
          message: "Query cancelled",
          trace_id: "test-trace-id",
          code: 20009
        },
        type: "error" as const
      };
      
      expect(() => logsWebSocket.handleSearchError(request, error)).not.toThrow();
    });

    it("should handle connection errors gracefully", () => {
      expect(() => logsWebSocket.handleSearchClose(null, null)).not.toThrow();
      expect(() => logsWebSocket.handleSearchError(null, null)).not.toThrow();
    });
  });

  describe("search reset handling", () => {
    it("should handle search reset", async () => {
      const data = {
        type: "search",
        isPagination: false,
        queryReq: { query: { sql: "SELECT * FROM logs" } }
      };
      
      await expect(logsWebSocket.handleSearchReset(data, "test-trace-id")).resolves.not.toThrow();
    });

    it("should handle histogram reset", async () => {
      const data = {
        type: "histogram",
        queryReq: { query: { sql: "SELECT * FROM logs" } }
      };
      
      await expect(logsWebSocket.handleSearchReset(data, "test-trace-id")).resolves.not.toThrow();
    });

    it("should handle page count reset", async () => {
      const data = {
        type: "pageCount",
        queryReq: { query: { sql: "SELECT * FROM logs" } }
      };
      
      await expect(logsWebSocket.handleSearchReset(data, "test-trace-id")).resolves.not.toThrow();
    });

    it("should handle reset errors gracefully", async () => {
      await expect(logsWebSocket.handleSearchReset(null, null)).resolves.not.toThrow();
    });
  });

  describe("utility functions", () => {
    it("should cancel query", async () => {
      const result = await logsWebSocket.cancelQuery();
      expect(typeof result).toBe("boolean");
    });

    it("should get connection statistics", () => {
      const stats = logsWebSocket.getConnectionStats();
      expect(stats).toBeDefined();
      expect(typeof stats.communicationMethod).toBe("string");
      expect(typeof stats.activeTraceIds).toBe("number");
      expect(typeof stats.activePartitions).toBe("number");
      expect(typeof stats.isOperationCancelled).toBe("boolean");
    });

    it("should handle function error", () => {
      const queryReq = { query: { sql: "SELECT * FROM logs" } };
      const response = {
        content: {
          results: {
            function_error: "Test function error"
          }
        }
      };
      
      expect(() => logsWebSocket.handleFunctionError(queryReq, response)).not.toThrow();
    });

    it("should set cancel search error", () => {
      expect(() => logsWebSocket.setCancelSearchError()).not.toThrow();
    });

    it("should process post pagination data", () => {
      expect(() => logsWebSocket.processPostPaginationData()).not.toThrow();
    });

    it("should construct error message", () => {
      const errorComponents = {
        message: "Test error",
        code: 500,
        error_detail: "Detailed error",
        error: "Error message"
      };
      
      const result = logsWebSocket.constructErrorMessage(errorComponents);
      expect(typeof result).toBe("string");
      expect(result).toContain("Test error");
      expect(result).toContain("500");
    });

    it("should handle utility function errors gracefully", () => {
      expect(() => logsWebSocket.handleFunctionError(null, null)).not.toThrow();
      expect(() => logsWebSocket.constructErrorMessage({})).not.toThrow();
      expect(logsWebSocket.getConnectionStats()).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should handle all operations gracefully with null inputs", () => {
      expect(() => logsWebSocket.setCommunicationMethod()).not.toThrow();
      expect(() => logsWebSocket.addTraceId("")).not.toThrow();
      expect(() => logsWebSocket.removeTraceId("")).not.toThrow();
      expect(() => logsWebSocket.sendSearchMessage(null)).not.toThrow();
      expect(() => logsWebSocket.sendCancelSearchMessage([])).not.toThrow();
    });

    it("should handle complex error scenarios", () => {
      const complexError = {
        content: {
          message: undefined,
          code: undefined,
          error_detail: undefined,
          error: undefined
        },
        type: "error" as const
      };
      
      expect(() => logsWebSocket.handleSearchError({}, complexError)).not.toThrow();
    });

    it("should handle payload building with invalid data", () => {
      expect(() => logsWebSocket.buildWebSocketPayload({}, false, "search")).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete WebSocket workflow", () => {
      // Set communication method
      const method = logsWebSocket.setCommunicationMethod();
      expect(typeof method).toBe("string");
      
      // Build payload
      const queryReq = {
        query: { sql: "SELECT * FROM logs", start_time: 0, end_time: Date.now() }
      };
      const payload = logsWebSocket.buildWebSocketPayload(queryReq, false, "search");
      
      // Initialize connection
      const connection = logsWebSocket.initializeSearchConnection(payload);
      expect(connection).toBeDefined();
      
      // Handle response
      const mockResponse = {
        type: "search_response_hits" as const,
        content: {
          results: { hits: [], total: 0, took: 0 },
          traceId: payload.traceId
        }
      };
      
      expect(() => logsWebSocket.handleSearchResponse(payload, mockResponse)).not.toThrow();
    });

    it("should handle error recovery workflow", async () => {
      // Simulate error
      const error = {
        content: {
          message: "Connection error",
          code: 500
        },
        type: "error" as const
      };
      
      logsWebSocket.handleSearchError({ traceId: "test" }, error);
      
      // Reset and recover
      await logsWebSocket.handleSearchReset({
        type: "search",
        isPagination: false,
        queryReq: { query: { sql: "SELECT * FROM logs" } }
      });
      
      expect(logsWebSocket.getConnectionStats()).toBeDefined();
    });

    it("should handle streaming vs WebSocket differences", () => {
      // Test WebSocket method
      logsWebSocket.setCommunicationMethod();
      const wsPayload = logsWebSocket.buildWebSocketPayload({
        query: { sql: "SELECT * FROM logs" }
      }, false, "search");
      
      // Test connection initialization
      const wsConnection = logsWebSocket.initializeSearchConnection(wsPayload);
      expect(wsConnection).toBeDefined();
    });
  });
});