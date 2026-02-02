import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import useCancelQuery from "./useCancelQuery";
import queryService from "../../services/search";

// Mock dependencies
const mockShowPositiveNotification = vi.fn();
const mockShowErrorNotification = vi.fn();

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: mockShowPositiveNotification,
    showErrorNotification: mockShowErrorNotification,
  }),
}));

vi.mock("../../services/search", () => ({
  default: {
    delete_running_queries: vi.fn(),
  },
}));

const mockQueryService = vi.mocked(queryService);

const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

describe("useCancelQuery", () => {
  let consoleErrorSpy: any;
  let windowDispatchEventSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    windowDispatchEventSpy = vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    windowDispatchEventSpy.mockRestore();
  });

  it("should create useCancelQuery composable with correct properties", () => {
    const composable = useCancelQuery();

    expect(composable).toBeDefined();
    expect(composable.traceIdRef).toBeDefined();
    expect(composable.searchRequestTraceIds).toBeDefined();
    expect(composable.cancelQuery).toBeDefined();
    expect(typeof composable.searchRequestTraceIds).toBe("function");
    expect(typeof composable.cancelQuery).toBe("function");
    expect(composable.traceIdRef.value).toEqual([]);
  });

  describe("searchRequestTraceIds", () => {
    it("should set trace IDs when data is an array", () => {
      const composable = useCancelQuery();
      const traceIds = ["trace1", "trace2", "trace3"];

      composable.searchRequestTraceIds(traceIds);

      expect(composable.traceIdRef.value).toEqual(traceIds);
    });

    it("should convert single value to array", () => {
      const composable = useCancelQuery();
      const singleTraceId = "single-trace";

      composable.searchRequestTraceIds(singleTraceId);

      expect(composable.traceIdRef.value).toEqual([singleTraceId]);
    });

    it("should handle null value", () => {
      const composable = useCancelQuery();

      composable.searchRequestTraceIds(null);

      expect(composable.traceIdRef.value).toEqual([null]);
    });

    it("should handle undefined value", () => {
      const composable = useCancelQuery();

      composable.searchRequestTraceIds(undefined);

      expect(composable.traceIdRef.value).toEqual([undefined]);
    });

    it("should handle number values", () => {
      const composable = useCancelQuery();

      composable.searchRequestTraceIds(123);

      expect(composable.traceIdRef.value).toEqual([123]);
    });

    it("should handle object values", () => {
      const composable = useCancelQuery();
      const objectValue = { id: "test", name: "trace" };

      composable.searchRequestTraceIds(objectValue);

      expect(composable.traceIdRef.value).toEqual([objectValue]);
    });

    it("should handle empty array", () => {
      const composable = useCancelQuery();

      composable.searchRequestTraceIds([]);

      expect(composable.traceIdRef.value).toEqual([]);
    });

    it("should overwrite previous trace IDs", () => {
      const composable = useCancelQuery();

      composable.searchRequestTraceIds(["trace1", "trace2"]);
      expect(composable.traceIdRef.value).toEqual(["trace1", "trace2"]);

      composable.searchRequestTraceIds(["trace3"]);
      expect(composable.traceIdRef.value).toEqual(["trace3"]);
    });
  });

  describe("cancelQuery", () => {
    it("should dispatch cancelQuery event", async () => {
      const mockResponse = { data: [{ is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1"]);

      composable.cancelQuery();

      expect(windowDispatchEventSpy).toHaveBeenCalledWith(new Event("cancelQuery"));
    });

    it("should return early when no trace IDs are set", () => {
      const composable = useCancelQuery();

      composable.cancelQuery();

      expect(windowDispatchEventSpy).toHaveBeenCalledWith(new Event("cancelQuery"));
      expect(mockQueryService.delete_running_queries).not.toHaveBeenCalled();
    });

    it("should return early when trace IDs array is empty", () => {
      const composable = useCancelQuery();
      composable.searchRequestTraceIds([]);

      composable.cancelQuery();

      expect(windowDispatchEventSpy).toHaveBeenCalledWith(new Event("cancelQuery"));
      expect(mockQueryService.delete_running_queries).not.toHaveBeenCalled();
    });

    it("should return early when traceIdRef.value is not an array", () => {
      const composable = useCancelQuery();
      // Manually set to non-array value
      composable.traceIdRef.value = "not-an-array";

      composable.cancelQuery();

      expect(windowDispatchEventSpy).toHaveBeenCalledWith(new Event("cancelQuery"));
      expect(mockQueryService.delete_running_queries).not.toHaveBeenCalled();
    });

    it("should call delete_running_queries with correct parameters", async () => {
      const mockResponse = { data: [{ is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1", "trace2"]);

      composable.cancelQuery();

      expect(mockQueryService.delete_running_queries).toHaveBeenCalledWith(
        "test-org",
        ["trace1", "trace2"]
      );
    });

    it("should show positive notification on successful cancellation", async () => {
      const mockResponse = { data: [{ is_success: true }, { is_success: false }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1", "trace2"]);

      composable.cancelQuery();

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockShowPositiveNotification).toHaveBeenCalledWith(
        "Running query canceled successfully",
        { timeout: 3000 }
      );
    });

    it("should not show notification when no queries were successfully cancelled", async () => {
      const mockResponse = { data: [{ is_success: false }, { is_success: false }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1", "trace2"]);

      composable.cancelQuery();

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockShowPositiveNotification).not.toHaveBeenCalled();
    });

    it("should show notification when at least one query is successfully cancelled", async () => {
      const mockResponse = { data: [{ is_success: false }, { is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1", "trace2"]);

      composable.cancelQuery();

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockShowPositiveNotification).toHaveBeenCalledWith(
        "Running query canceled successfully",
        { timeout: 3000 }
      );
    });

    it("should handle error response with message", async () => {
      const mockError = {
        response: {
          data: {
            message: "Custom error message"
          }
        }
      };
      mockQueryService.delete_running_queries.mockRejectedValue(mockError);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1"]);

      composable.cancelQuery();

      // Wait for promise to reject
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith("delete running queries error", mockError);
      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        "Custom error message",
        { timeout: 3000 }
      );
    });

    it("should handle error response without message", async () => {
      const mockError = {
        response: {
          data: {}
        }
      };
      mockQueryService.delete_running_queries.mockRejectedValue(mockError);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1"]);

      composable.cancelQuery();

      // Wait for promise to reject
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith("delete running queries error", mockError);
      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        "Failed to cancel running query",
        { timeout: 3000 }
      );
    });

    it("should handle error without response", async () => {
      const mockError = new Error("Network error");
      mockQueryService.delete_running_queries.mockRejectedValue(mockError);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1"]);

      composable.cancelQuery();

      // Wait for promise to reject
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith("delete running queries error", mockError);
      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        "Failed to cancel running query",
        { timeout: 3000 }
      );
    });

    it("should remove processed trace IDs from array in finally block", async () => {
      const mockResponse = { data: [{ is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1", "trace2", "trace3"]);

      composable.cancelQuery();

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      // The processed trace IDs should be removed
      expect(composable.traceIdRef.value).toEqual([]);
    });

    it("should remove processed trace IDs even on error", async () => {
      const mockError = new Error("Network error");
      mockQueryService.delete_running_queries.mockRejectedValue(mockError);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1", "trace2"]);

      composable.cancelQuery();

      // Wait for promise to reject
      await new Promise(resolve => setTimeout(resolve, 0));

      // The processed trace IDs should still be removed
      expect(composable.traceIdRef.value).toEqual([]);
    });

    it("should only remove the specific trace IDs that were processed", async () => {
      const mockResponse = { data: [{ is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1", "trace2", "trace3"]);

      // Start the cancel operation
      composable.cancelQuery();

      // Add more trace IDs while the cancel operation is in progress
      composable.searchRequestTraceIds([...composable.traceIdRef.value, "trace4", "trace5"]);

      // Wait for the original promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      // Only the original trace IDs should be removed, new ones should remain
      expect(composable.traceIdRef.value).toEqual(["trace4", "trace5"]);
    });

    it("should handle multiple concurrent cancel operations", async () => {
      const mockResponse = { data: [{ is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      
      composable.searchRequestTraceIds(["trace1", "trace2"]);
      composable.cancelQuery();

      composable.searchRequestTraceIds(["trace3", "trace4"]);
      composable.cancelQuery();

      expect(mockQueryService.delete_running_queries).toHaveBeenCalledTimes(2);
      expect(mockQueryService.delete_running_queries).toHaveBeenNthCalledWith(1, "test-org", ["trace1", "trace2"]);
      expect(mockQueryService.delete_running_queries).toHaveBeenNthCalledWith(2, "test-org", ["trace3", "trace4"]);
    });

    it("should handle empty response data", async () => {
      const mockResponse = { data: [] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1"]);

      composable.cancelQuery();

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockShowPositiveNotification).not.toHaveBeenCalled();
      expect(composable.traceIdRef.value).toEqual([]);
    });

    it("should handle response with no is_success properties", async () => {
      const mockResponse = { data: [{ status: "completed" }, { status: "failed" }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1", "trace2"]);

      composable.cancelQuery();

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockShowPositiveNotification).not.toHaveBeenCalled();
      expect(composable.traceIdRef.value).toEqual([]);
    });
  });

  describe("integration tests", () => {
    it("should work with different organization identifiers", async () => {
      const mockResponse = { data: [{ is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      // Change the organization identifier
      mockStore.state.selectedOrganization.identifier = "different-org";

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1"]);

      composable.cancelQuery();

      expect(mockQueryService.delete_running_queries).toHaveBeenCalledWith(
        "different-org",
        ["trace1"]
      );

      // Reset for other tests
      mockStore.state.selectedOrganization.identifier = "test-org";
    });

    it("should handle rapid successive calls", async () => {
      const mockResponse = { data: [{ is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const composable = useCancelQuery();

      // Set trace IDs and cancel multiple times rapidly
      composable.searchRequestTraceIds(["trace1"]);
      composable.cancelQuery();
      
      composable.searchRequestTraceIds(["trace2"]);
      composable.cancelQuery();
      
      composable.searchRequestTraceIds(["trace3"]);
      composable.cancelQuery();

      expect(mockQueryService.delete_running_queries).toHaveBeenCalledTimes(3);
      expect(windowDispatchEventSpy).toHaveBeenCalledTimes(3);
    });

    it("should work with complex trace ID values", async () => {
      const mockResponse = { data: [{ is_success: true }] };
      mockQueryService.delete_running_queries.mockResolvedValue(mockResponse);

      const complexTraceIds = [
        "trace-with-dashes",
        "trace_with_underscores",
        "TRACE-WITH-CAPS",
        "trace123with456numbers",
        "trace.with.dots",
        "trace@with@symbols",
      ];

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(complexTraceIds);

      composable.cancelQuery();

      expect(mockQueryService.delete_running_queries).toHaveBeenCalledWith(
        "test-org",
        complexTraceIds
      );
    });
  });

  describe("edge cases", () => {
    it("should handle when store state is undefined", async () => {
      // Temporarily modify store state
      const originalState = mockStore.state;
      mockStore.state = { selectedOrganization: undefined };

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1"]);

      // This should throw an error since the code doesn't handle undefined gracefully
      expect(() => {
        composable.cancelQuery();
      }).toThrow();

      // Restore original state
      mockStore.state = originalState;
    });

    it("should handle when selectedOrganization is undefined", async () => {
      // Temporarily modify store state
      const originalOrg = mockStore.state.selectedOrganization;
      mockStore.state.selectedOrganization = undefined;

      const composable = useCancelQuery();
      composable.searchRequestTraceIds(["trace1"]);

      // This should throw an error since the code doesn't handle undefined gracefully
      expect(() => {
        composable.cancelQuery();
      }).toThrow();

      // Restore original state
      mockStore.state.selectedOrganization = originalOrg;
    });
  });

  describe("reactive behavior", () => {
    it("should maintain reactivity of traceIdRef", () => {
      const composable = useCancelQuery();

      // Initial value
      expect(composable.traceIdRef.value).toEqual([]);

      // Change value
      composable.searchRequestTraceIds(["trace1"]);
      expect(composable.traceIdRef.value).toEqual(["trace1"]);

      // Change again
      composable.searchRequestTraceIds(["trace2", "trace3"]);
      expect(composable.traceIdRef.value).toEqual(["trace2", "trace3"]);
    });

    it("should allow direct manipulation of traceIdRef", () => {
      const composable = useCancelQuery();

      // Direct manipulation should work
      composable.traceIdRef.value = ["direct-trace"];
      expect(composable.traceIdRef.value).toEqual(["direct-trace"]);

      composable.traceIdRef.value.push("another-trace");
      expect(composable.traceIdRef.value).toEqual(["direct-trace", "another-trace"]);
    });
  });
});