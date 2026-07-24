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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ref } from "vue";
import useTraceCorrelation from "@/composables/rum/useTraceCorrelation";
import searchService from "@/services/search";


// The composable now asks the stream schema which trace-id namespaces exist (`_o2_` vs
// `_oo_`) before building SQL, so getStream must be mocked or every call hangs.
// Reports the legacy spelling, matching data ingested before the namespace migration.
const mockGetStream = vi.fn().mockResolvedValue({
  schema: [{ name: "_oo_trace_id" }, { name: "_oo_span_id" }],
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: mockGetStream,
  }),
}));

// Mock search service
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

// Mock vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
    zoConfig: {
      timestamp_column: "_timestamp",
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

/**
 * Factory function to create mock RUM events
 */
function createMockRumEvent(overrides: Record<string, any> = {}) {
  return {
    type: "resource",
    session_id: "session-1",
    resource: {
      duration: 500,
    },
    ...overrides,
  };
}

/**
 * Factory function to create mock backend span
 */
function createMockBackendSpan(overrides: Record<string, any> = {}) {
  return {
    span_id: "span-1",
    duration_ms: 100,
    ...overrides,
  };
}

/**
 * Factory function to create mock search response
 */
function createMockSearchResponse(
  hits: any[] = [],
  total: number = hits.length,
) {
  return {
    data: {
      hits,
      total,
    },
  } as any;
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to mock successful RUM and APM search calls
 */
function mockSuccessfulSearch(
  rumEvents: any[] = [],
  backendSpans: any[] = [],
) {
  vi.mocked(searchService.search)
    .mockResolvedValueOnce(createMockSearchResponse(rumEvents))
    .mockResolvedValueOnce(createMockSearchResponse(backendSpans));
}

/**
 * Helper to mock failed search call
 */
function mockFailedSearch(errorMessage: string = "Network error") {
  vi.mocked(searchService.search).mockRejectedValueOnce(
    new Error(errorMessage),
  );
}

describe("useTraceCorrelation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Initialization", () => {
    it("should initialize with default values", () => {
      const traceId = ref("test-trace-123");
      const {
        correlationData,
        isLoading,
        error,
        hasBackendTrace,
        backendSpanCount,
        performanceData,
      } = useTraceCorrelation(traceId);

      expect(correlationData.value).toBeNull();
      expect(isLoading.value).toBe(false);
      expect(error.value).toBeNull();
      expect(hasBackendTrace.value).toBe(false);
      expect(backendSpanCount.value).toBe(0);
      expect(performanceData.value).toBeNull();
    });

    it("should expose all public API surface members", () => {
      const traceId = ref("test-trace-123");
      const result = useTraceCorrelation(traceId);

      expect(typeof result.fetchCorrelation).toBe("function");
      expect(typeof result.reset).toBe("function");
      expect(result.correlationData.value).toBeNull();
      expect(result.isLoading.value).toBe(false);
      expect(result.error.value).toBeNull();
      expect(result.hasBackendTrace.value).toBe(false);
      expect(result.backendSpanCount.value).toBe(0);
      expect(result.performanceData.value).toBeNull();
    });
  });

  describe("fetchCorrelation", () => {
    it("should not fetch when traceId is empty", async () => {
      const traceId = ref("");
      const { fetchCorrelation } = useTraceCorrelation(traceId);

      await fetchCorrelation();

      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should set loading state while fetching", async () => {
      const traceId = ref("test-trace-123");

      // Mock search service to delay response
      const mockSearchFn = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 100)),
        );
      vi.mocked(searchService.search).mockImplementation(mockSearchFn);

      const { isLoading, fetchCorrelation } = useTraceCorrelation(traceId);

      const fetchPromise = fetchCorrelation();

      // Should be loading immediately after calling fetch
      expect(isLoading.value).toBe(true);

      await fetchPromise;

      // Should not be loading after fetch completes
      expect(isLoading.value).toBe(false);
    });

    it("should fetch RUM data with correct query", async () => {
      const traceId = ref("test-trace-123");

      mockSuccessfulSearch([], []);

      const { fetchCorrelation } = useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "test-org",
          query: expect.objectContaining({
            query: expect.objectContaining({
              sql: expect.stringContaining("test-trace-123"),
            }),
          }),
        }),
        "RUM",
      );
    });

    it("filters on the trace-id column present in the stream schema", async () => {
      const traceId = ref("trace-abc-999");

      mockSuccessfulSearch([], []);

      const { fetchCorrelation } = useTraceCorrelation(traceId);
      await fetchCorrelation();

      const firstCall = vi.mocked(searchService.search).mock.calls[0];
      const sql: string = firstCall[0].query.query.sql;

      // The predicate is built from the stream schema, which this suite mocks as
      // carrying only the legacy namespace — so the query targets _oo_trace_id. A stream
      // holding both spellings yields `_o2_trace_id = .. OR _oo_trace_id = ..`.
      expect(sql).toContain("_oo_trace_id = 'trace-abc-999'");
    });

    it("should fetch trace data after RUM data", async () => {
      const traceId = ref("test-trace-123");

      const rumEvent = createMockRumEvent();
      const backendSpan = createMockBackendSpan();
      mockSuccessfulSearch([rumEvent], [backendSpan]);

      const { fetchCorrelation } = useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(searchService.search).toHaveBeenCalledTimes(2);
      expect(searchService.search).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          org_identifier: "test-org",
        }),
        "APM",
      );
    });

    it("should populate correlationData on successful fetch", async () => {
      const traceId = ref("test-trace-123");

      const mockRumEvents = [createMockRumEvent()];
      const mockBackendSpans = [
        createMockBackendSpan({ span_id: "span-1", duration_ms: 100 }),
        createMockBackendSpan({ span_id: "span-2", duration_ms: 150 }),
      ];

      mockSuccessfulSearch(mockRumEvents, mockBackendSpans);

      const { correlationData, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(correlationData.value).not.toBeNull();
      expect(correlationData.value?.trace_id).toBe("test-trace-123");
      expect(correlationData.value?.session_id).toBe("session-1");
      expect(correlationData.value?.rum_events).toHaveLength(1);
      expect(correlationData.value?.backend_spans).toHaveLength(2);
      expect(correlationData.value?.has_backend_trace).toBe(true);
    });

    it("should handle trace fetch failure gracefully", async () => {
      const traceId = ref("test-trace-123");

      const rumEvent = createMockRumEvent();
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(createMockSearchResponse([rumEvent]))
        .mockRejectedValueOnce(new Error("Trace not found"));

      const { correlationData, hasBackendTrace, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(correlationData.value).not.toBeNull();
      expect(hasBackendTrace.value).toBe(false);
      expect(correlationData.value?.backend_spans).toHaveLength(0);
    });

    it("should handle complete fetch failure", async () => {
      const traceId = ref("test-trace-123");
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockFailedSearch("Network error");

      const { correlationData, error, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(correlationData.value).toBeNull();
      expect(error.value).not.toBeNull();
      expect(error.value?.message).toBe("Network error");
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should reset loading state on error", async () => {
      const traceId = ref("test-trace-123");

      mockFailedSearch("Network error");

      const { isLoading, fetchCorrelation } = useTraceCorrelation(traceId);

      await fetchCorrelation();

      expect(isLoading.value).toBe(false);
    });
  });

  describe("Performance breakdown calculation", () => {
    it("should calculate performance breakdown when resource event exists", async () => {
      const traceId = ref("test-trace-123");

      const mockRumEvents = [createMockRumEvent()];
      const mockBackendSpans = [
        createMockBackendSpan({ span_id: "span-1", duration_ms: 100 }),
        createMockBackendSpan({ span_id: "span-2", duration_ms: 150 }),
      ];

      mockSuccessfulSearch(mockRumEvents, mockBackendSpans);

      const { performanceData, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(performanceData.value).not.toBeNull();
      expect(performanceData.value?.total_duration_ms).toBe(500);
      expect(performanceData.value?.backend_duration_ms).toBe(250);
      expect(performanceData.value?.browser_duration_ms).toBe(250);
      expect(performanceData.value?.network_latency_ms).toBe(50);
    });

    it("should return null performance breakdown when no resource event", async () => {
      const traceId = ref("test-trace-123");

      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any);

      const { performanceData, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(performanceData.value).toBeNull();
    });

    it("should handle resource without duration", async () => {
      const traceId = ref("test-trace-123");

      const mockRumEvents = [
        {
          type: "resource",
          session_id: "session-1",
          resource: {},
        },
      ];

      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: mockRumEvents, total: 1 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any);

      const { performanceData, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(performanceData.value?.total_duration_ms).toBe(0);
    });
  });

  describe("Computed properties", () => {
    it("should compute hasBackendTrace correctly", async () => {
      const traceId = ref("test-trace-123");

      // First call returns RUM data, second call returns backend spans
      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [{ span_id: "span-1" }], total: 1 },
        } as any);

      const { hasBackendTrace, fetchCorrelation } =
        useTraceCorrelation(traceId);

      expect(hasBackendTrace.value).toBe(false);

      await fetchCorrelation();

      expect(hasBackendTrace.value).toBe(true);
    });

    it("should compute backendSpanCount correctly", async () => {
      const traceId = ref("test-trace-123");

      const mockBackendSpans = [
        { span_id: "span-1" },
        { span_id: "span-2" },
        { span_id: "span-3" },
      ];

      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: mockBackendSpans, total: 3 },
        } as any);

      const { backendSpanCount, fetchCorrelation } =
        useTraceCorrelation(traceId);

      expect(backendSpanCount.value).toBe(0);

      await fetchCorrelation();

      expect(backendSpanCount.value).toBe(3);
    });

    it("should update computed values when correlationData changes", async () => {
      const traceId = ref("test-trace-123");

      // First fetch - no backend spans (2 calls: RUM + APM)
      // Second fetch - with backend spans (2 calls: RUM + APM)
      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [{ span_id: "span-1" }], total: 1 },
        } as any);

      const { hasBackendTrace, backendSpanCount, fetchCorrelation } =
        useTraceCorrelation(traceId);

      await fetchCorrelation();

      expect(hasBackendTrace.value).toBe(false);
      expect(backendSpanCount.value).toBe(0);

      // Fetch again with backend spans
      await fetchCorrelation();

      expect(hasBackendTrace.value).toBe(true);
      expect(backendSpanCount.value).toBe(1);
    });
  });

  describe("Reset functionality", () => {
    it("should reset all state when reset is called", async () => {
      const traceId = ref("test-trace-123");

      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: [{ span_id: "span-1" }], total: 1 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any);

      const { correlationData, isLoading, error, fetchCorrelation, reset } =
        useTraceCorrelation(traceId);

      await fetchCorrelation();

      expect(correlationData.value).not.toBeNull();

      reset();

      expect(correlationData.value).toBeNull();
      expect(isLoading.value).toBe(false);
      expect(error.value).toBeNull();
    });
  });

  describe("Multiple fetch scenarios", () => {
    it("should handle multiple consecutive fetches", async () => {
      const traceId = ref("test-trace-123");

      // Mock 6 calls: 2 for each fetch (RUM + APM)
      vi.mocked(searchService.search)
        .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
        .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
        .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
        .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
        .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
        .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any);

      const { fetchCorrelation } = useTraceCorrelation(traceId);

      await fetchCorrelation();
      await fetchCorrelation();
      await fetchCorrelation();

      // Should have called search service 6 times (RUM + APM for each fetch)
      expect(searchService.search).toHaveBeenCalledTimes(6);
    });

    it("should update data on subsequent fetches", async () => {
      const traceId = ref("test-trace-123");

      // First fetch - no backend spans (RUM call + APM call)
      // Second fetch - with backend spans (RUM call + APM call)
      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [{ span_id: "span-1" }], total: 1 },
        } as any);

      const { hasBackendTrace, fetchCorrelation } =
        useTraceCorrelation(traceId);

      await fetchCorrelation();
      expect(hasBackendTrace.value).toBe(false);

      await fetchCorrelation();
      expect(hasBackendTrace.value).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty RUM events array", async () => {
      const traceId = ref("test-trace-123");

      vi.mocked(searchService.search).mockResolvedValue({
        data: { hits: [], total: 0 },
      } as any);

      const { correlationData, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(correlationData.value).not.toBeNull();
      expect(correlationData.value?.rum_events).toHaveLength(0);
      expect(correlationData.value?.session_id).toBeNull();
    });

    it("should handle missing response data structure", async () => {
      const traceId = ref("test-trace-123");

      vi.mocked(searchService.search).mockResolvedValue({
        data: {},
      } as any);

      const { correlationData, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(correlationData.value).not.toBeNull();
      expect(correlationData.value?.rum_events).toHaveLength(0);
      expect(correlationData.value?.backend_spans).toHaveLength(0);
    });

    it("should handle null duration in backend spans", async () => {
      const traceId = ref("test-trace-123");

      const mockRumEvents = [
        {
          type: "resource",
          resource: { duration: 500 },
        },
      ];

      const mockBackendSpans = [
        { span_id: "span-1", duration_ms: null },
        { span_id: "span-2" },
      ];

      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: mockRumEvents, total: 1 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: mockBackendSpans, total: 2 },
        } as any);

      const { performanceData, fetchCorrelation } =
        useTraceCorrelation(traceId);
      await fetchCorrelation();

      // Should handle null duration_ms gracefully (reduce treats null as 0)
      expect(performanceData.value?.backend_duration_ms).toBeDefined();
      expect(performanceData.value?.backend_duration_ms).toBe(0);
    });
  });

  describe("Time range handling", () => {
    it("should query with correct time range", async () => {
      const traceId = ref("test-trace-123");

      // Mock both RUM and APM calls
      vi.mocked(searchService.search)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any)
        .mockResolvedValueOnce({
          data: { hits: [], total: 0 },
        } as any);

      const { fetchCorrelation } = useTraceCorrelation(traceId);
      await fetchCorrelation();

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            query: expect.objectContaining({
              start_time: expect.any(Number),
              end_time: expect.any(Number),
            }),
          }),
        }),
        "RUM",
      );

      const call = vi.mocked(searchService.search).mock.calls[0][0];
      const startTime = call.query.query.start_time;
      const endTime = call.query.query.end_time;

      // Should query last hour (in microseconds)
      expect(endTime - startTime).toBeGreaterThanOrEqual(3600000000);
    });
  });

  // ==========================================================================
  // Optional timeRange argument
  // ==========================================================================

  describe("optional timeRange argument", () => {
    describe("when timeRange is provided", () => {
      it("uses the provided startTime in the RUM query", async () => {
        // Arrange
        const traceId = ref("trace-with-range");
        const timeRange = ref({
          startTime: 1_700_000_000_000_000,
          endTime: 1_700_003_600_000_000,
        });

        vi.mocked(searchService.search)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any);

        const { fetchCorrelation } = useTraceCorrelation(traceId, timeRange);

        // Act
        await fetchCorrelation();

        // Assert — first call is the RUM query
        const rumCall = vi.mocked(searchService.search).mock.calls[0][0];
        expect(rumCall.query.query.start_time).toBe(1_700_000_000_000_000);
      });

      it("uses the provided endTime in the RUM query", async () => {
        // Arrange
        const traceId = ref("trace-with-range");
        const timeRange = ref({
          startTime: 1_700_000_000_000_000,
          endTime: 1_700_003_600_000_000,
        });

        vi.mocked(searchService.search)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any);

        const { fetchCorrelation } = useTraceCorrelation(traceId, timeRange);

        // Act
        await fetchCorrelation();

        // Assert
        const rumCall = vi.mocked(searchService.search).mock.calls[0][0];
        expect(rumCall.query.query.end_time).toBe(1_700_003_600_000_000);
      });

      it("uses the provided startTime in the APM (traces) query", async () => {
        // Arrange
        const traceId = ref("trace-apm-range");
        const timeRange = ref({
          startTime: 1_700_000_000_000_000,
          endTime: 1_700_003_600_000_000,
        });

        vi.mocked(searchService.search)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any);

        const { fetchCorrelation } = useTraceCorrelation(traceId, timeRange);

        // Act
        await fetchCorrelation();

        // Assert — second call is the APM query
        const apmCall = vi.mocked(searchService.search).mock.calls[1][0];
        expect(apmCall.query.query.start_time).toBe(1_700_000_000_000_000);
        expect(apmCall.query.query.end_time).toBe(1_700_003_600_000_000);
      });

      it("picks up a reactive timeRange update on the next fetchCorrelation call", async () => {
        // Arrange
        const traceId = ref("trace-reactive");
        const timeRange = ref({
          startTime: 1_700_000_000_000_000,
          endTime: 1_700_003_600_000_000,
        });

        vi.mocked(searchService.search)
          .mockResolvedValue({ data: { hits: [], total: 0 } } as any);

        const { fetchCorrelation } = useTraceCorrelation(traceId, timeRange);
        await fetchCorrelation();

        // Update the reactive ref
        timeRange.value = {
          startTime: 1_800_000_000_000_000,
          endTime: 1_800_003_600_000_000,
        };
        vi.clearAllMocks();
        vi.mocked(searchService.search)
          .mockResolvedValue({ data: { hits: [], total: 0 } } as any);

        // Act
        await fetchCorrelation();

        // Assert — now uses updated values
        const rumCall = vi.mocked(searchService.search).mock.calls[0][0];
        expect(rumCall.query.query.start_time).toBe(1_800_000_000_000_000);
        expect(rumCall.query.query.end_time).toBe(1_800_003_600_000_000);
      });
    });

    describe("when timeRange is omitted", () => {
      it("falls back to a trailing-hour range with start_time < end_time", async () => {
        // Arrange
        const traceId = ref("trace-no-range");

        vi.mocked(searchService.search)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any);

        const { fetchCorrelation } = useTraceCorrelation(traceId);

        // Act
        await fetchCorrelation();

        // Assert
        const rumCall = vi.mocked(searchService.search).mock.calls[0][0];
        const { start_time, end_time } = rumCall.query.query;
        expect(start_time).toBeLessThan(end_time);
      });

      it("falls back to a range spanning approximately 1 hour (in µs)", async () => {
        // Arrange
        const traceId = ref("trace-no-range-span");

        vi.mocked(searchService.search)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any);

        const { fetchCorrelation } = useTraceCorrelation(traceId);

        const beforeCall = Date.now() * 1000;
        // Act
        await fetchCorrelation();
        const afterCall = Date.now() * 1000;

        // Assert
        const rumCall = vi.mocked(searchService.search).mock.calls[0][0];
        const { start_time, end_time } = rumCall.query.query;

        // end_time should be close to Date.now() * 1000 (within a few ms either side)
        expect(end_time).toBeGreaterThanOrEqual(beforeCall - 5_000);
        expect(end_time).toBeLessThanOrEqual(afterCall + 5_000);

        // Span is 1 hour in µs
        expect(end_time - start_time).toBeGreaterThanOrEqual(3_600_000_000);
        expect(end_time - start_time).toBeLessThanOrEqual(3_600_000_000 + 10_000);
      });
    });

    describe("when timeRange is provided as null ref", () => {
      it("falls back to the trailing-hour default when timeRange.value is null", async () => {
        // Arrange
        const traceId = ref("trace-null-range");
        const timeRange = ref<{ startTime: number; endTime: number } | null>(null);

        vi.mocked(searchService.search)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any)
          .mockResolvedValueOnce({ data: { hits: [], total: 0 } } as any);

        const { fetchCorrelation } = useTraceCorrelation(traceId, timeRange);

        // Act
        await fetchCorrelation();

        // Assert — trailing-hour span
        const rumCall = vi.mocked(searchService.search).mock.calls[0][0];
        const { start_time, end_time } = rumCall.query.query;
        expect(end_time - start_time).toBeGreaterThanOrEqual(3_600_000_000);
      });
    });
  });
});
