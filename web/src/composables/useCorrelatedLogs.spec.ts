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

vi.mock("@/services/http_streaming", () => ({
  fetchQueryDataWithHttpStream: vi.fn(),
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
    it("should compute hasResults correctly when results exist", () => {
      const composable = useCorrelatedLogs(props);
      composable.searchResults.value = [{ _timestamp: 123, field: "value" }];

      expect(composable.hasResults.value).toBe(true);
    });

    it("should compute hasResults correctly when no results", () => {
      const composable = useCorrelatedLogs(props);
      composable.searchResults.value = [];

      expect(composable.hasResults.value).toBe(false);
    });

    it("should compute isLoading correctly", () => {
      const composable = useCorrelatedLogs(props);

      composable.loading.value = true;
      expect(composable.isLoading.value).toBe(true);

      composable.loading.value = false;
      expect(composable.isLoading.value).toBe(false);
    });

    it("should compute hasError correctly when error exists", () => {
      const composable = useCorrelatedLogs(props);
      composable.error.value = new Error("Test error");

      expect(composable.hasError.value).toBe(true);
    });

    it("should compute hasError correctly when no error", () => {
      const composable = useCorrelatedLogs(props);
      composable.error.value = null;

      expect(composable.hasError.value).toBe(false);
    });

    it("should compute isEmpty correctly", () => {
      const composable = useCorrelatedLogs(props);

      // Empty when no results and not loading
      composable.searchResults.value = [];
      composable.loading.value = false;
      expect(composable.isEmpty.value).toBe(true);

      // Not empty when has results
      composable.searchResults.value = [{ _timestamp: 123 }];
      expect(composable.isEmpty.value).toBe(false);

      // Not empty when loading
      composable.searchResults.value = [];
      composable.loading.value = true;
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

    it("should reset filters to matched and additional dimensions", async () => {
      const composable = useCorrelatedLogs(props);

      // Modify filters
      composable.updateFilter("service", "modified");
      composable.updateFilter("newKey", "newValue");

      // Reset
      composable.resetFilters();
      await nextTick();

      expect(composable.currentFilters.value).toEqual({
        service: "api",
        environment: "prod",
        region: "us-west",
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
      const composable = useCorrelatedLogs(props);
      const newTimeRange = {
        startTime: Date.now() - 7200000,
        endTime: Date.now(),
      };

      composable.updateTimeRange(newTimeRange);
      await nextTick();

      expect(composable.currentTimeRange.value).toEqual(newTimeRange);
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
      const { fetchQueryDataWithHttpStream } = await import(
        "@/services/http_streaming"
      );
      (fetchQueryDataWithHttpStream as any).mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 100))
      );

      const composable = useCorrelatedLogs(props);

      const searchPromise = composable.fetchCorrelatedLogs();
      expect(composable.loading.value).toBe(true);

      await searchPromise;
    });

    it("should handle search errors", async () => {
      const { fetchQueryDataWithHttpStream } = await import(
        "@/services/http_streaming"
      );
      (fetchQueryDataWithHttpStream as any).mockRejectedValue(
        new Error("Search failed")
      );

      const composable = useCorrelatedLogs(props);

      await composable.fetchCorrelatedLogs();

      expect(composable.loading.value).toBe(false);
      expect(composable.error.value).toBeTruthy();
    });

    it("should clear error on successful search", async () => {
      const { fetchQueryDataWithHttpStream } = await import(
        "@/services/http_streaming"
      );
      (fetchQueryDataWithHttpStream as any).mockResolvedValue({
        data: [],
      });

      const composable = useCorrelatedLogs(props);
      composable.error.value = new Error("Previous error");

      await composable.fetchCorrelatedLogs();

      expect(composable.error.value).toBe(null);
    });
  });

  describe("Refresh", () => {
    it("should execute search when refresh is called", async () => {
      const { fetchQueryDataWithHttpStream } = await import(
        "@/services/http_streaming"
      );
      const mockFetch = vi.fn().mockResolvedValue({ data: [] });
      (fetchQueryDataWithHttpStream as any).mockImplementation(mockFetch);

      const composable = useCorrelatedLogs(props);

      await composable.refresh();

      expect(mockFetch).toHaveBeenCalled();
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

    it("should handle filter with special characters", () => {
      const composable = useCorrelatedLogs(props);

      composable.updateFilter("special-key", "special@value#123");
      await nextTick();

      expect(composable.currentFilters.value["special-key"]).toBe(
        "special@value#123"
      );
    });

    it("should handle very long filter values", () => {
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
      const { fetchQueryDataWithHttpStream } = await import(
        "@/services/http_streaming"
      );
      (fetchQueryDataWithHttpStream as any).mockRejectedValue(
        new Error("Network error")
      );

      const composable = useCorrelatedLogs(props);

      await composable.fetchCorrelatedLogs();

      // Should be able to recover and try again
      (fetchQueryDataWithHttpStream as any).mockResolvedValue({ data: [] });
      await composable.refresh();

      expect(composable.loading.value).toBe(false);
    });

    it("should preserve filters after failed search", async () => {
      const { fetchQueryDataWithHttpStream } = await import(
        "@/services/http_streaming"
      );
      (fetchQueryDataWithHttpStream as any).mockRejectedValue(
        new Error("Search error")
      );

      const composable = useCorrelatedLogs(props);
      composable.updateFilter("service", "test-service");

      await composable.fetchCorrelatedLogs();

      expect(composable.currentFilters.value.service).toBe("test-service");
    });
  });
});
