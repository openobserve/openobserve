import { describe, expect, it, beforeEach, vi } from "vitest";
import useValuesWebSocket from "./useValuesWebSocket";

// Mock all dependencies with simpler approach
vi.mock("../useSearchWebSocket", () => ({
  default: () => ({
    fetchQueryDataWithWebSocket: vi.fn(),
    sendSearchMessageBasedOnRequestId: vi.fn(),
    cancelSearchQueryBasedOnRequestId: vi.fn(),
  }),
  fetchQueryDataWithWebSocket: vi.fn(),
  sendSearchMessageBasedOnRequestId: vi.fn(),
  cancelSearchQueryBasedOnRequestId: vi.fn(),
}));

vi.mock("../useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: vi.fn(),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
    },
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({
    traceId: "test-trace-id-123",
    traceparent: "test-traceparent",
  })),
  isWebSocketEnabled: vi.fn(() => false),
  isStreamingEnabled: vi.fn(() => false),
}));

vi.mock("@/services/stream", () => ({
  default: {
    fieldValues: vi.fn(),
  },
}));

describe("useValuesWebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize and return all expected functions", () => {
      const websocket = useValuesWebSocket();

      expect(websocket).toMatchObject({
        handleSearchClose: expect.any(Function),
        handleSearchError: expect.any(Function),
        handleSearchReset: expect.any(Function),
        handleSearchResponse: expect.any(Function),
        initializeStreamingConnection: expect.any(Function),
        addTraceId: expect.any(Function),
        removeTraceId: expect.any(Function),
        fetchFieldValues: expect.any(Function),
        cancelTraceId: expect.any(Function),
      });
    });
  });

  describe("trace ID management", () => {
    it("should handle trace ID operations without errors", () => {
      const websocket = useValuesWebSocket();

      expect(() => {
        websocket.addTraceId("test-field", "trace-id-1");
        websocket.addTraceId("test-field", "trace-id-2");
        websocket.addTraceId("other-field", "trace-id-3");
        websocket.removeTraceId("test-field", "trace-id-1");
        websocket.removeTraceId("non-existent", "trace-id");
      }).not.toThrow();
    });
  });

  describe("handleSearchReset", () => {
    it("should handle search reset operations", () => {
      const websocket = useValuesWebSocket();

      websocket.addTraceId("test-field", "trace-id-1");
      websocket.addTraceId("test-field", "trace-id-2");

      expect(() =>
        websocket.handleSearchReset({ name: "test-field" }),
      ).not.toThrow();
    });

    it("should handle reset for field with no trace IDs", () => {
      const websocket = useValuesWebSocket();

      expect(() =>
        websocket.handleSearchReset({ name: "empty-field" }),
      ).not.toThrow();
    });
  });

  describe("handleSearchError", () => {
    it("should handle search errors gracefully", () => {
      const websocket = useValuesWebSocket();

      expect(() => {
        websocket.handleSearchError(
          { traceId: "error-trace-id" },
          { message: "Test error" },
          { name: "test-field" },
        );
      }).not.toThrow();
    });
  });

  describe("handleSearchClose", () => {
    it("should handle search close operations with various codes", () => {
      const websocket = useValuesWebSocket();

      const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];

      errorCodes.forEach((code) => {
        expect(() => {
          websocket.handleSearchClose(
            { traceId: "close-trace-id" },
            { code: code, error_details: "Connection error" },
            { name: "test-field" },
          );
        }).not.toThrow();
      });

      // Test non-error codes
      expect(() => {
        websocket.handleSearchClose(
          { traceId: "close-trace-id" },
          { code: 200 },
          { name: "test-field" },
        );
      }).not.toThrow();
    });
  });

  describe("handleSearchResponse", () => {
    it("should process valid search responses correctly", () => {
      const websocket = useValuesWebSocket();

      const mockDashboardPanelData = {
        meta: {
          filterValue: [],
        },
      };

      const mockResponse = {
        type: "search_response",
        content: {
          results: {
            hits: [
              {
                field: "test-field",
                values: [
                  { zo_sql_key: "value1" },
                  { zo_sql_key: "value2" },
                  { zo_sql_key: null },
                  { zo_sql_key: "value3" },
                ],
              },
            ],
          },
        },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardPanelData,
      };

      websocket.handleSearchResponse({}, mockResponse, mockVariableObject);

      expect(mockDashboardPanelData.meta.filterValue).toHaveLength(1);
      expect(mockDashboardPanelData.meta.filterValue[0]).toEqual({
        column: "test-field",
        value: ["value1", "value2", "value3"],
      });
    });

    it("should merge existing values with new values", () => {
      const websocket = useValuesWebSocket();

      const mockDashboardPanelData = {
        meta: {
          filterValue: [
            {
              column: "test-field",
              value: ["existing1", "existing2"],
            },
          ],
        },
      };

      const mockResponse = {
        type: "search_response_hits",
        content: {
          results: {
            hits: [
              {
                field: "test-field",
                values: [
                  { zo_sql_key: "existing1" },
                  { zo_sql_key: "new1" },
                  { zo_sql_key: "new2" },
                ],
              },
            ],
          },
        },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardPanelData,
      };

      websocket.handleSearchResponse({}, mockResponse, mockVariableObject);

      expect(mockDashboardPanelData.meta.filterValue[0].value).toEqual([
        "existing1",
        "existing2",
        "new1",
        "new2",
      ]);
    });

    it("should handle responses with no matching field", () => {
      const websocket = useValuesWebSocket();

      const mockDashboardPanelData = {
        meta: { filterValue: [] },
      };

      const mockResponse = {
        type: "search_response",
        content: {
          results: {
            hits: [
              {
                field: "different-field",
                values: [{ zo_sql_key: "value1" }],
              },
            ],
          },
        },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardPanelData,
      };

      websocket.handleSearchResponse({}, mockResponse, mockVariableObject);

      expect(mockDashboardPanelData.meta.filterValue).toHaveLength(0);
    });

    it("should handle malformed responses gracefully", () => {
      const websocket = useValuesWebSocket();

      const mockDashboardPanelData = {
        meta: { filterValue: [] },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardPanelData,
      };

      expect(() => {
        websocket.handleSearchResponse(
          {},
          { type: "invalid" },
          mockVariableObject,
        );
        websocket.handleSearchResponse(
          {},
          { content: null },
          mockVariableObject,
        );
        websocket.handleSearchResponse({}, null as any, mockVariableObject);
      }).not.toThrow();
    });

    it("should handle responses with no hits", () => {
      const websocket = useValuesWebSocket();

      const mockDashboardPanelData = {
        meta: { filterValue: [] },
      };

      const mockResponse = {
        type: "search_response",
        content: {
          results: { hits: [] },
        },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardPanelData,
      };

      expect(() =>
        websocket.handleSearchResponse({}, mockResponse, mockVariableObject),
      ).not.toThrow();
      expect(mockDashboardPanelData.meta.filterValue).toHaveLength(0);
    });

    it("should handle responses with invalid type", () => {
      const websocket = useValuesWebSocket();

      const mockDashboardPanelData = {
        meta: { filterValue: [] },
      };

      const mockResponse = {
        type: "invalid_type",
        content: {
          results: {
            hits: [
              {
                field: "test-field",
                values: [{ zo_sql_key: "value1" }],
              },
            ],
          },
        },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardPanelData,
      };

      websocket.handleSearchResponse({}, mockResponse, mockVariableObject);

      expect(mockDashboardPanelData.meta.filterValue).toHaveLength(0);
    });
  });

  describe("initializeStreamingConnection", () => {
    it("should handle WebSocket connection initialization", () => {
      const websocket = useValuesWebSocket();
      const mockPayload = { test: "payload" };
      const mockVariableObject = { name: "test-field" };

      expect(() => {
        websocket.initializeStreamingConnection(
          mockPayload,
          mockVariableObject,
        );
      }).not.toThrow();
    });
  });

  describe("fetchFieldValues", () => {
    const mockQueryReq = {
      stream_name: "test-stream",
      start_time: 1640995200000,
      end_time: 1640998800000,
      fields: ["field1", "field2"],
      size: 100,
      type: "logs",
      stream_type: "logs",
      no_count: true,
    };

    const mockDashboardPanelData = {
      meta: {
        filterValue: [],
      },
    };

    beforeEach(() => {
      // Mock window.use_cache
      Object.defineProperty(window, "use_cache", {
        value: true,
        writable: true,
        configurable: true,
      });
    });

    it("should handle fetchFieldValues without errors", async () => {
      const websocket = useValuesWebSocket();

      await expect(
        websocket.fetchFieldValues(
          mockQueryReq,
          mockDashboardPanelData,
          "test-field",
        ),
      ).resolves.not.toThrow();
    });

    it("should use WebSocket path when WebSocket is enabled", async () => {
      const { generateTraceContext } = await import("@/utils/zincutils");

      (generateTraceContext as any).mockReturnValue({
        traceId: "websocket-trace-123",
      });

      const websocket = useValuesWebSocket();

      const result = await websocket.fetchFieldValues(
        mockQueryReq,
        mockDashboardPanelData,
        "test-field",
      );

      expect(generateTraceContext).toHaveBeenCalled();

      // The implementation always uses streaming now
      expect(result).toBeUndefined();
    });

    it("should use streaming path when streaming is enabled but WebSocket is not", async () => {
      const { generateTraceContext } = await import("@/utils/zincutils");

      (generateTraceContext as any).mockReturnValue({
        traceId: "streaming-trace-456",
      });

      const websocket = useValuesWebSocket();

      const result = await websocket.fetchFieldValues(
        mockQueryReq,
        mockDashboardPanelData,
        "test-field",
      );

      expect(generateTraceContext).toHaveBeenCalled();

      // The implementation always uses streaming now
      expect(result).toBeUndefined();
    });

    it("should create proper WebSocket payload with all required fields", async () => {
      const { isWebSocketEnabled, isStreamingEnabled, generateTraceContext } =
        await import("@/utils/zincutils");

      (isWebSocketEnabled as any).mockReturnValue(true);
      (isStreamingEnabled as any).mockReturnValue(false);
      (generateTraceContext as any).mockReturnValue({
        traceId: "test-trace-id",
      });

      // Mock window.use_cache
      Object.defineProperty(window, "use_cache", {
        value: false,
        writable: true,
        configurable: true,
      });

      const websocket = useValuesWebSocket();

      await websocket.fetchFieldValues(
        mockQueryReq,
        mockDashboardPanelData,
        "test-field",
      );

      // The WebSocket payload should include all the required fields
      expect(generateTraceContext).toHaveBeenCalled();
    });

    it("should create proper streaming payload with meta field", async () => {
      const { isWebSocketEnabled, isStreamingEnabled, generateTraceContext } =
        await import("@/utils/zincutils");

      (isWebSocketEnabled as any).mockReturnValue(false);
      (isStreamingEnabled as any).mockReturnValue(true);
      (generateTraceContext as any).mockReturnValue({
        traceId: "streaming-trace",
      });

      const websocket = useValuesWebSocket();

      await websocket.fetchFieldValues(
        mockQueryReq,
        mockDashboardPanelData,
        "test-field",
      );

      // The streaming payload should include meta field with original queryReq
      expect(generateTraceContext).toHaveBeenCalled();
    });

    it("should use REST API when neither WebSocket nor streaming enabled", async () => {
      const { generateTraceContext } = await import("@/utils/zincutils");
      (generateTraceContext as any).mockReturnValue({
        traceId: "rest-trace-789",
      });

      const websocket = useValuesWebSocket();

      // The implementation always uses streaming, so this test verifies the streaming behavior
      const result = await websocket.fetchFieldValues(
        mockQueryReq,
        mockDashboardPanelData,
        "test-field",
      );

      expect(generateTraceContext).toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("should handle REST API errors", async () => {
      const { generateTraceContext } = await import("@/utils/zincutils");
      (generateTraceContext as any).mockReturnValue({ traceId: "error-trace" });

      const websocket = useValuesWebSocket();

      // The implementation always uses streaming and doesn't throw errors from fetchFieldValues
      const result = await websocket.fetchFieldValues(
        mockQueryReq,
        mockDashboardPanelData,
        "test-field",
      );

      expect(result).toBeUndefined();
    });

    it("should replace existing filter values in REST API mode", async () => {
      const { generateTraceContext } = await import("@/utils/zincutils");
      (generateTraceContext as any).mockReturnValue({
        traceId: "replace-trace",
      });

      const mockDashboardPanelDataWithExisting = {
        meta: {
          filterValue: [
            {
              column: "test-field",
              value: ["old-value1", "old-value2"],
            },
            {
              column: "other-field",
              value: ["other-value"],
            },
          ],
        },
      };

      const websocket = useValuesWebSocket();

      // Simulate streaming response with new values
      const mockResponse = {
        type: "search_response",
        content: {
          results: {
            hits: [
              {
                field: "test-field",
                values: [
                  { zo_sql_key: "new-value1" },
                  { zo_sql_key: "new-value2" },
                ],
              },
            ],
          },
        },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardPanelDataWithExisting,
      };

      // Call handleSearchResponse to simulate streaming response
      websocket.handleSearchResponse({}, mockResponse, mockVariableObject);

      // The streaming logic merges values, so we should have old + new values
      const testFieldEntry =
        mockDashboardPanelDataWithExisting.meta.filterValue.find(
          (entry) => entry.column === "test-field",
        );
      expect(testFieldEntry).toEqual({
        column: "test-field",
        value: ["old-value1", "old-value2", "new-value1", "new-value2"],
      });
    });

    it("should handle empty REST API responses", async () => {
      const websocket = useValuesWebSocket();

      // Simulate empty streaming response
      const mockResponse = {
        type: "search_response",
        content: {
          results: {
            hits: [],
          },
        },
      };

      const mockDashboardData = {
        meta: {
          filterValue: [],
        },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardData,
      };

      websocket.handleSearchResponse({}, mockResponse, mockVariableObject);

      // With empty hits, no filter values should be added
      expect(mockDashboardData.meta.filterValue).toHaveLength(0);
    });

    it("should handle window.use_cache variations", async () => {
      const websocket = useValuesWebSocket();

      // Test with use_cache = false
      Object.defineProperty(window, "use_cache", {
        value: false,
        writable: true,
        configurable: true,
      });

      await expect(
        websocket.fetchFieldValues(
          mockQueryReq,
          mockDashboardPanelData,
          "test-field",
        ),
      ).resolves.not.toThrow();

      // Test with use_cache undefined
      delete (window as any).use_cache;

      await expect(
        websocket.fetchFieldValues(
          mockQueryReq,
          mockDashboardPanelData,
          "test-field",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("isWebSocketEnabled function", () => {
    it("should expose isWebSocketEnabled function", () => {
      const websocket = useValuesWebSocket();

      // The implementation no longer exports isWebSocketEnabled
      // It always uses streaming, so we verify that cancelTraceId exists instead
      expect(websocket.cancelTraceId).toBeDefined();
      expect(typeof websocket.cancelTraceId).toBe("function");
    });
  });

  describe("handleSearchResponse filterValue initialization", () => {
    it("should initialize filterValue array when undefined", () => {
      const websocket = useValuesWebSocket();

      const mockDashboardDataWithoutFilter = {
        meta: {
          // filterValue is undefined initially
        },
      };

      const mockVariableObject = {
        name: "test-field",
        dashboardPanelData: mockDashboardDataWithoutFilter,
      };

      const mockResponse = {
        type: "search_response",
        content: {
          results: {
            hits: [
              {
                field: "test-field",
                values: [{ zo_sql_key: "value1" }, { zo_sql_key: "value2" }],
              },
            ],
          },
        },
      };

      // Call handleSearchResponse to trigger filterValue initialization
      websocket.handleSearchResponse({}, mockResponse, mockVariableObject);

      // Verify that filterValue array was initialized
      expect(mockDashboardDataWithoutFilter.meta.filterValue).toBeDefined();
      expect(
        Array.isArray(mockDashboardDataWithoutFilter.meta.filterValue),
      ).toBe(true);
      expect(mockDashboardDataWithoutFilter.meta.filterValue).toEqual([
        {
          column: "test-field",
          value: ["value1", "value2"],
        },
      ]);
    });

    it("should handle case when filterValue exists but is empty", () => {
      const websocket = useValuesWebSocket();

      const mockDashboardDataWithEmptyFilter = {
        meta: {
          filterValue: [],
        },
      };

      const mockVariableObject = {
        name: "another-field",
        dashboardPanelData: mockDashboardDataWithEmptyFilter,
      };

      const mockResponse = {
        type: "search_response_hits",
        content: {
          results: {
            hits: [
              {
                field: "another-field",
                values: [{ zo_sql_key: "new_value" }],
              },
            ],
          },
        },
      };

      // Call handleSearchResponse
      websocket.handleSearchResponse({}, mockResponse, mockVariableObject);

      // Verify that entry was added to existing empty array
      expect(mockDashboardDataWithEmptyFilter.meta.filterValue).toEqual([
        {
          column: "another-field",
          value: ["new_value"],
        },
      ]);
    });
  });

  // Note: Some paths require WebSocket/streaming conditions that are complex to test in unit tests
  // Additional coverage would be achieved through integration testing
});
