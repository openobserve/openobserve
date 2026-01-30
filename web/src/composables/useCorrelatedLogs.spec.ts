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
import { nextTick } from "vue";
import { useCorrelatedLogs } from "./useCorrelatedLogs";
import type { CorrelatedLogsProps } from "./useCorrelatedLogs";

// Mock dependencies
vi.mock("@/utils/commons", () => ({
  getQueryPartitions: vi.fn().mockResolvedValue([]),
}));

const mockFetchQueryDataWithHttpStream = vi.fn();
const mockCancelStreamQueryBasedOnRequestId = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: vi.fn(() => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQueryBasedOnRequestId,
  })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
      zoConfig: {
        timestamp_column: "_timestamp",
        query_on_stream_selection: false,
      },
    },
  })),
}));

describe("useCorrelatedLogs", () => {
  let props: CorrelatedLogsProps;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation that does nothing (tests will override as needed)
    mockFetchQueryDataWithHttpStream.mockImplementation(
      (_params: any, callbacks: any) => {
        // Default: just complete without any data
        if (callbacks?.complete) {
          callbacks.complete(null);
        }
        return Promise.resolve();
      }
    );

    props = {
      matchedDimensions: {
        service: "api",
        environment: "prod",
      },
      additionalDimensions: {
        region: "us-west",
      },
      logStreams: [
        { name: "app-logs", stream_type: "logs" },
        { name: "system-logs", stream_type: "logs" },
      ],
      sourceStream: "app-logs",
      sourceType: "logs",
      timeRange: {
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
      },
      availableDimensions: {
        region: ["us-west", "us-east", "eu-west"],
      },
      ftsFields: ["message", "error"],
    };
  });

  describe("Initialization", () => {
    it("should initialize with default values", () => {
      const composable = useCorrelatedLogs(props);

      expect(composable.loading.value).toBe(false);
      expect(composable.error.value).toBe(null);
      expect(composable.searchResults.value).toEqual([]);
      expect(composable.totalHits.value).toBe(0);
      expect(composable.took.value).toBe(0);
    });

    it("should initialize currentFilters with matched and additional dimensions", () => {
      const composable = useCorrelatedLogs(props);

      expect(composable.currentFilters.value).toEqual({
        service: "api",
        environment: "prod",
        region: "us-west",
      });
    });

    it("should initialize with correct time range", () => {
      const composable = useCorrelatedLogs(props);

      expect(composable.currentTimeRange.value).toEqual(props.timeRange);
    });

    it("should set primaryStream correctly", () => {
      const composable = useCorrelatedLogs(props);

      expect(composable.primaryStream.value).toBe("app-logs");
    });
  });

  describe("Computed Properties", () => {
    it("should compute hasResults correctly when results exist", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          // Simulate metadata event
          callbacks.data(null, {
            type: 'search_response_metadata',
            content: { results: { total: 1, took: 10 } }
          });
          // Simulate hits event
          callbacks.data(null, {
            type: 'search_response_hits',
            content: { results: { hits: [{ _timestamp: 123, field: "value" }] } }
          });
          // Simulate complete
          callbacks.complete(null);
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);
      await composable.fetchCorrelatedLogs();

      expect(composable.hasResults.value).toBe(true);
    });

    it("should compute hasResults correctly when no results", () => {
      const composable = useCorrelatedLogs(props);

      expect(composable.hasResults.value).toBe(false);
    });

    it("should compute isLoading correctly", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          // Simulate metadata and complete
          callbacks.data(null, {
            type: 'search_response_metadata',
            content: { results: { total: 0, took: 5 } }
          });
          callbacks.complete(null);
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);

      const searchPromise = composable.fetchCorrelatedLogs();
      expect(composable.isLoading.value).toBe(true);

      await searchPromise;
      expect(composable.isLoading.value).toBe(false);
    });

    it("should compute hasError correctly when error exists", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.error(null, {
            content: { message: "Test error" }
          });
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);
      await composable.fetchCorrelatedLogs();

      expect(composable.hasError.value).toBe(true);
    });

    it("should compute hasError correctly when no error", () => {
      const composable = useCorrelatedLogs(props);

      expect(composable.hasError.value).toBe(false);
    });

    it("should compute isEmpty correctly", () => {
      const composable = useCorrelatedLogs(props);

      // Empty when no results and not loading
      expect(composable.isEmpty.value).toBe(true);
    });

    it("should compute isEmpty correctly when has results", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.data(null, {
            type: 'search_response_hits',
            content: { results: { hits: [{ _timestamp: 123 }] } }
          });
          callbacks.complete(null);
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);
      await composable.fetchCorrelatedLogs();

      expect(composable.isEmpty.value).toBe(false);
    });
  });

  describe("Filter Management", () => {
    it("should update single filter", async () => {
      const composable = useCorrelatedLogs(props);

      composable.updateFilter("service", "new-api");
      await nextTick();

      expect(composable.currentFilters.value.service).toBe("new-api");
    });

    it("should update multiple filters at once", async () => {
      const composable = useCorrelatedLogs(props);

      composable.updateFilters({
        service: "updated-api",
        region: "us-east",
      });
      await nextTick();

      expect(composable.currentFilters.value.service).toBe("updated-api");
      expect(composable.currentFilters.value.region).toBe("us-east");
    });

    it("should remove filter", async () => {
      const composable = useCorrelatedLogs(props);

      composable.removeFilter("region");
      await nextTick();

      expect(composable.currentFilters.value.region).toBeUndefined();
    });

    it("should reset filters to matched dimensions only", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.complete(null);
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);

      // Modify filters
      composable.updateFilter("service", "modified");
      composable.updateFilter("newKey", "newValue");

      // Reset - should only keep matched dimensions, not additional ones
      composable.resetFilters();
      await nextTick();

      expect(composable.currentFilters.value).toEqual({
        service: "api",
        environment: "prod",
      });
    });
  });

  describe("Dimension Helpers", () => {
    it("should identify matched dimensions correctly", () => {
      const composable = useCorrelatedLogs(props);

      expect(composable.isMatchedDimension("service")).toBe(true);
      expect(composable.isMatchedDimension("environment")).toBe(true);
      expect(composable.isMatchedDimension("region")).toBe(false);
      expect(composable.isMatchedDimension("unknown")).toBe(false);
    });

    it("should identify additional dimensions correctly", () => {
      const composable = useCorrelatedLogs(props);

      expect(composable.isAdditionalDimension("region")).toBe(true);
      expect(composable.isAdditionalDimension("service")).toBe(false);
      expect(composable.isAdditionalDimension("unknown")).toBe(false);
    });

    it("should handle undefined additionalDimensions", () => {
      const propsWithoutAdditional = {
        ...props,
        additionalDimensions: undefined,
      };
      const composable = useCorrelatedLogs(propsWithoutAdditional);

      expect(composable.isAdditionalDimension("region")).toBe(false);
    });
  });

  describe("Time Range Management", () => {
    it("should update time range", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.complete(null);
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);
      const newStartTime = Date.now() - 7200000;
      const newEndTime = Date.now();

      composable.updateTimeRange(newStartTime, newEndTime);
      await nextTick();

      expect(composable.currentTimeRange.value.startTime).toBe(newStartTime);
      expect(composable.currentTimeRange.value.endTime).toBe(newEndTime);
    });
  });

  describe("Query Building", () => {
    it("should build basic query from props", () => {
      const composable = useCorrelatedLogs(props);

      // Access internal query builder if exposed or test via side effects
      expect(composable.primaryStream.value).toBe("app-logs");
    });
  });

  describe("Search Execution", () => {
    it("should set loading state during search", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        async (_params: any, callbacks: any) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          callbacks.complete(null);
        }
      );

      const composable = useCorrelatedLogs(props);

      const searchPromise = composable.fetchCorrelatedLogs();
      expect(composable.loading.value).toBe(true);

      await searchPromise;
      expect(composable.loading.value).toBe(false);
    });

    it("should handle search errors", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.error(null, { content: { message: "Search failed" } });
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);

      await composable.fetchCorrelatedLogs();

      expect(composable.loading.value).toBe(false);
      expect(composable.error.value).toBeTruthy();
    });

    it("should clear error on successful search after previous error", async () => {
      // First, cause an error
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.error(null, { content: { message: "Previous error" } });
          return Promise.resolve();
        }
      );
      const composable = useCorrelatedLogs(props);
      await composable.fetchCorrelatedLogs();
      expect(composable.hasError.value).toBe(true);

      // Then succeed
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.data(null, {
            type: 'search_response_metadata',
            content: { results: { total: 0, took: 5 } }
          });
          callbacks.complete(null);
          return Promise.resolve();
        }
      );
      await composable.fetchCorrelatedLogs();

      expect(composable.error.value).toBe(null);
      expect(composable.hasError.value).toBe(false);
    });
  });

  describe("Refresh", () => {
    it("should execute search when refresh is called", async () => {
      const composable = useCorrelatedLogs(props);

      // Clear call history but keep the implementation
      mockFetchQueryDataWithHttpStream.mockClear();

      await composable.refresh();

      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
    });
  });

  describe("Props Reactivity", () => {
    it("should reset filters when matchedDimensions prop changes", async () => {
      const composable = useCorrelatedLogs(props);

      // Modify filters
      composable.updateFilter("service", "modified");

      // Simulate prop change by creating new composable
      const newProps = {
        ...props,
        matchedDimensions: {
          service: "new-api",
          environment: "dev",
        },
      };
      const newComposable = useCorrelatedLogs(newProps);

      expect(newComposable.currentFilters.value.service).toBe("new-api");
      expect(newComposable.currentFilters.value.environment).toBe("dev");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty logStreams array", () => {
      const propsWithEmptyStreams = {
        ...props,
        logStreams: [],
      };

      const composable = useCorrelatedLogs(propsWithEmptyStreams);
      // When logStreams is empty but sourceStream is provided and sourceType is 'logs',
      // primaryStream returns sourceStream
      expect(composable.primaryStream.value).toBe("app-logs");
    });

    it("should return empty string when logStreams is empty and no sourceStream", () => {
      const propsWithNoStreams = {
        ...props,
        logStreams: [],
        sourceStream: "",
        sourceType: "traces",
      };

      const composable = useCorrelatedLogs(propsWithNoStreams);
      expect(composable.primaryStream.value).toBe("");
    });

    it("should handle missing ftsFields", () => {
      const propsWithoutFts = {
        ...props,
        ftsFields: undefined,
      };

      const composable = useCorrelatedLogs(propsWithoutFts);
      expect(composable).toBeDefined();
    });

    it("should handle missing availableDimensions", () => {
      const propsWithoutAvailable = {
        ...props,
        availableDimensions: undefined,
      };

      const composable = useCorrelatedLogs(propsWithoutAvailable);
      expect(composable).toBeDefined();
    });

    it("should handle filter with special characters", async () => {
      const composable = useCorrelatedLogs(props);

      composable.updateFilter("special-key", "special@value#123");
      await nextTick();

      expect(composable.currentFilters.value["special-key"]).toBe(
        "special@value#123"
      );
    });

    it("should handle very long filter values", async () => {
      const composable = useCorrelatedLogs(props);
      const longValue = "a".repeat(10000);

      composable.updateFilter("longField", longValue);
      await nextTick();

      expect(composable.currentFilters.value.longField).toBe(longValue);
    });
  });

  describe("Multiple Filter Operations", () => {
    it("should handle rapid filter updates", async () => {
      const composable = useCorrelatedLogs(props);

      composable.updateFilter("key1", "value1");
      composable.updateFilter("key2", "value2");
      composable.updateFilter("key3", "value3");

      await nextTick();

      expect(composable.currentFilters.value.key1).toBe("value1");
      expect(composable.currentFilters.value.key2).toBe("value2");
      expect(composable.currentFilters.value.key3).toBe("value3");
    });

    it("should preserve unmodified filters when updating", () => {
      const composable = useCorrelatedLogs(props);

      composable.updateFilter("service", "new-service");

      expect(composable.currentFilters.value.environment).toBe("prod");
      expect(composable.currentFilters.value.region).toBe("us-west");
    });
  });

  describe("State Consistency", () => {
    it("should maintain consistent state after error", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.error(null, { content: { message: "Network error" } });
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);

      await composable.fetchCorrelatedLogs();
      await nextTick();
      expect(composable.hasError.value).toBe(true);

      // Should be able to recover and try again
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.data(null, {
            type: 'search_response_metadata',
            content: { results: { total: 0, took: 5 } }
          });
          callbacks.complete(null);
          return Promise.resolve();
        }
      );

      const refreshPromise = composable.refresh();
      await nextTick();
      await refreshPromise;
      await nextTick();

      expect(composable.loading.value).toBe(false);
      expect(composable.error.value).toBe(null);
    });

    it("should preserve filters after failed search", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_params: any, callbacks: any) => {
          callbacks.error(null, { content: { message: "Search error" } });
          return Promise.resolve();
        }
      );

      const composable = useCorrelatedLogs(props);
      composable.updateFilter("service", "test-service");

      await composable.fetchCorrelatedLogs();

      expect(composable.currentFilters.value.service).toBe("test-service");
    });
  });
});
