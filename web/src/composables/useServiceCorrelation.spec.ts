// Copyright 2025 OpenObserve Inc.
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

// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// All vi.mock() calls MUST precede imports.
// ---------------------------------------------------------------------------

// Use vi.hoisted() so mock fn references are initialised before vi.mock
// factories are evaluated (vi.mock is hoisted before all other top-level code).
const {
  mockGetSemanticGroups,
  mockCorrelate,
  mockExtractSemanticDimensions,
  mockGenerateCorrelationQueries,
  mockFindMatchingService,
} = vi.hoisted(() => ({
  mockGetSemanticGroups: vi.fn(),
  mockCorrelate: vi.fn(),
  mockExtractSemanticDimensions: vi.fn(),
  mockGenerateCorrelationQueries: vi.fn(),
  mockFindMatchingService: vi.fn(),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: { identifier: "test-org" },
    },
  })),
}));

vi.mock("@/services/service_streams", () => ({
  default: {
    getSemanticGroups: mockGetSemanticGroups,
    correlate: mockCorrelate,
  },
}));

vi.mock("@/utils/telemetryCorrelation", () => ({
  extractSemanticDimensions: mockExtractSemanticDimensions,
  generateCorrelationQueries: mockGenerateCorrelationQueries,
  findMatchingService: mockFindMatchingService,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  useServiceCorrelation,
  clearSemanticGroupsCaches,
} from "./useServiceCorrelation";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MOCK_GROUPS = [
  {
    group_name: "http",
    fields: [{ field_name: "service_name" }, { field_name: "http_method" }],
  },
];

const MOCK_CORRELATION_RESPONSE = {
  service_name: "api-service",
  matched_dimensions: { service_name: "api-service" },
  related_streams: {
    logs: [{ stream_name: "default", filters: {} }],
    traces: [{ stream_name: "traces", filters: {} }],
    metrics: [],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useServiceCorrelation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level global cache between every test via the
    // clearAllCaches() method exposed by the composable.
    const { clearAllCaches } = useServiceCorrelation();
    clearAllCaches();
  });

  // ─── Return value structure ───────────────────────────────────────────────

  describe("return value structure", () => {
    it("returns all expected properties and methods", () => {
      const result = useServiceCorrelation();
      expect(result).toHaveProperty("error");
      expect(result).toHaveProperty("semanticGroups");
      expect(result).toHaveProperty("findRelatedTelemetry");
      expect(result).toHaveProperty("loadSemanticGroups");
      expect(result).toHaveProperty("clearCache");
      expect(result).toHaveProperty("clearAllCaches");
      expect(result).toHaveProperty("isCorrelationAvailable");
    });

    it("error starts as null", () => {
      const { error } = useServiceCorrelation();
      expect(error.value).toBeNull();
    });

    it("semanticGroups computed starts as empty array", () => {
      const { semanticGroups } = useServiceCorrelation();
      expect(semanticGroups.value).toEqual([]);
    });
  });

  // ─── loadSemanticGroups ───────────────────────────────────────────────────

  describe("loadSemanticGroups", () => {
    it("calls the API and returns the result on first call", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { loadSemanticGroups } = useServiceCorrelation();

      const result = await loadSemanticGroups();

      expect(mockGetSemanticGroups).toHaveBeenCalledWith("test-org");
      expect(result).toEqual(MOCK_GROUPS);
    });

    it("returns cached data on the second call without hitting the API again", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { loadSemanticGroups } = useServiceCorrelation();

      await loadSemanticGroups();
      await loadSemanticGroups();

      expect(mockGetSemanticGroups).toHaveBeenCalledTimes(1);
    });

    it("returns empty array and sets error.value when API throws", async () => {
      mockGetSemanticGroups.mockRejectedValue(new Error("network error"));
      const { loadSemanticGroups, error } = useServiceCorrelation();

      const result = await loadSemanticGroups();

      expect(result).toEqual([]);
      expect(error.value).toContain("Failed to load semantic groups");
    });

    it("updates semanticGroups computed after a successful load", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { loadSemanticGroups, semanticGroups } = useServiceCorrelation();

      await loadSemanticGroups();

      expect(semanticGroups.value).toEqual(MOCK_GROUPS);
    });
  });

  // ─── clearCache ───────────────────────────────────────────────────────────

  describe("clearCache", () => {
    it("forces a fresh API call after clearing the cache for the current org", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { loadSemanticGroups, clearCache } = useServiceCorrelation();

      await loadSemanticGroups(); // prime cache
      clearCache();
      await loadSemanticGroups(); // should hit API again

      expect(mockGetSemanticGroups).toHaveBeenCalledTimes(2);
    });
  });

  // ─── clearAllCaches ───────────────────────────────────────────────────────

  describe("clearAllCaches", () => {
    it("forces a fresh API call after clearing all caches", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { loadSemanticGroups, clearAllCaches } = useServiceCorrelation();

      await loadSemanticGroups();
      clearAllCaches();
      await loadSemanticGroups();

      expect(mockGetSemanticGroups).toHaveBeenCalledTimes(2);
    });

    it("resets semanticGroups computed to empty array", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { loadSemanticGroups, clearAllCaches, semanticGroups } =
        useServiceCorrelation();

      await loadSemanticGroups();
      clearAllCaches();

      expect(semanticGroups.value).toEqual([]);
    });
  });

  // ─── isCorrelationAvailable ───────────────────────────────────────────────

  describe("isCorrelationAvailable", () => {
    it("returns true when semantic groups are loaded", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { isCorrelationAvailable } = useServiceCorrelation();

      const result = await isCorrelationAvailable();
      expect(result).toBe(true);
    });

    it("returns false when semantic groups are empty", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: [] });
      const { isCorrelationAvailable } = useServiceCorrelation();

      const result = await isCorrelationAvailable();
      expect(result).toBe(false);
    });

    it("returns false when the API call fails", async () => {
      mockGetSemanticGroups.mockRejectedValue(new Error("API down"));
      const { isCorrelationAvailable } = useServiceCorrelation();

      const result = await isCorrelationAvailable();
      expect(result).toBe(false);
    });
  });

  // ─── findRelatedTelemetry ─────────────────────────────────────────────────

  describe("findRelatedTelemetry", () => {
    const mockContext = { service_name: "api-service", http_method: "GET" };

    it("returns null and sets error when currentStream is not provided", async () => {
      const { findRelatedTelemetry, error } = useServiceCorrelation();

      const result = await findRelatedTelemetry(mockContext as any, "logs");

      expect(result).toBeNull();
      expect(error.value).toContain("Stream name is required");
    });

    it("returns null and sets error when no semantic groups are available", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: [] });
      const { findRelatedTelemetry, error } = useServiceCorrelation();

      const result = await findRelatedTelemetry(
        mockContext as any,
        "logs",
        5,
        "my-stream"
      );

      expect(result).toBeNull();
      expect(error.value).toContain("No semantic groups available");
    });

    it("returns null and sets error when extractSemanticDimensions returns empty", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      mockExtractSemanticDimensions.mockReturnValue({});
      const { findRelatedTelemetry, error } = useServiceCorrelation();

      const result = await findRelatedTelemetry(
        mockContext as any,
        "logs",
        5,
        "my-stream"
      );

      expect(result).toBeNull();
      expect(error.value).toContain("No recognizable dimensions");
    });

    it("calls the correlate API and returns a result on success", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      mockExtractSemanticDimensions.mockReturnValue({ service_name: "api-service" });
      mockCorrelate.mockResolvedValue({ data: MOCK_CORRELATION_RESPONSE });
      mockGenerateCorrelationQueries.mockReturnValue({ logs: [], traces: [], metrics: [] });

      const { findRelatedTelemetry } = useServiceCorrelation();

      const result = await findRelatedTelemetry(
        mockContext as any,
        "logs",
        5,
        "default"
      );

      expect(mockCorrelate).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          source_stream: "default",
          source_type: "logs",
          available_dimensions: { service_name: "api-service" },
        })
      );
      expect(result).not.toBeNull();
      expect(result!.service.service_name).toBe("api-service");
    });

    it("returns null when correlate API returns null (no matching service)", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      mockExtractSemanticDimensions.mockReturnValue({ service_name: "api-service" });
      mockCorrelate.mockResolvedValue({ data: null });

      const { findRelatedTelemetry, error } = useServiceCorrelation();

      const result = await findRelatedTelemetry(
        mockContext as any,
        "logs",
        5,
        "default"
      );

      expect(result).toBeNull();
      expect(error.value).toContain("No matching service found");
    });

    it("sets enterprise feature error message for 403 response", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      mockExtractSemanticDimensions.mockReturnValue({ service_name: "api-service" });
      mockCorrelate.mockRejectedValue({ response: { status: 403 } });

      const { findRelatedTelemetry, error } = useServiceCorrelation();

      const result = await findRelatedTelemetry(
        mockContext as any,
        "logs",
        5,
        "default"
      );

      expect(result).toBeNull();
      expect(error.value).toContain("enterprise feature");
    });

    it("sets 'no matching service' error message for 404 response", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      mockExtractSemanticDimensions.mockReturnValue({ service_name: "api-service" });
      mockCorrelate.mockRejectedValue({ response: { status: 404 } });

      const { findRelatedTelemetry, error } = useServiceCorrelation();

      const result = await findRelatedTelemetry(
        mockContext as any,
        "logs",
        5,
        "default"
      );

      expect(result).toBeNull();
      expect(error.value).toContain("No matching service found");
    });

    it("includes correlationData in the returned result", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      mockExtractSemanticDimensions.mockReturnValue({ service_name: "api-service" });
      mockCorrelate.mockResolvedValue({ data: MOCK_CORRELATION_RESPONSE });
      mockGenerateCorrelationQueries.mockReturnValue({ logs: [], traces: [], metrics: [] });

      const { findRelatedTelemetry } = useServiceCorrelation();

      const result = await findRelatedTelemetry(
        mockContext as any,
        "traces",
        5,
        "traces"
      );

      expect(result!.correlationData).toEqual(MOCK_CORRELATION_RESPONSE);
    });
  });

  // ─── semanticGroups computed ──────────────────────────────────────────────

  describe("semanticGroups computed", () => {
    it("reflects groups for the current org after loading", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { loadSemanticGroups, semanticGroups } = useServiceCorrelation();

      await loadSemanticGroups();

      expect(semanticGroups.value).toEqual(MOCK_GROUPS);
    });

    it("returns empty array when nothing has been loaded yet", () => {
      const { semanticGroups } = useServiceCorrelation();
      expect(semanticGroups.value).toEqual([]);
    });
  });

  // ─── clearSemanticGroupsCaches (standalone export) ────────────────────────

  describe("clearSemanticGroupsCaches (standalone export)", () => {
    it("is exported and is a function", () => {
      expect(typeof clearSemanticGroupsCaches).toBe("function");
    });

    it("clears all caches so the next loadSemanticGroups call hits the API", async () => {
      mockGetSemanticGroups.mockResolvedValue({ data: MOCK_GROUPS });
      const { loadSemanticGroups } = useServiceCorrelation();

      await loadSemanticGroups(); // prime cache
      clearSemanticGroupsCaches();
      await loadSemanticGroups(); // should hit API again

      expect(mockGetSemanticGroups).toHaveBeenCalledTimes(2);
    });
  });
});
