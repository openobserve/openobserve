import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import stream from "@/services/streaming_search";
import http from "@/services/http";

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({
    traceId: "generated-trace-id-abc",
  })),
}));

import { generateTraceContext } from "@/utils/zincutils";

describe("streaming_search service", () => {
  let mockHttpInstance: any;
  const originalWindow = global.window;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);

    global.window = {
      ...originalWindow,
      use_cache: true,
    } as any;
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  describe("searchStreamUrl", () => {
    it("should return correct URL with use_cache=true from window", () => {
      (global.window as any).use_cache = true;

      const url = stream.searchStreamUrl({
        org_identifier: "test-org",
        page_type: "logs",
        traceId: "trace-123",
      });

      expect(url).toBe(
        "/api/test-org/_search_stream?type=logs&search_type=ui&use_cache=true&trace_id=trace-123"
      );
    });

    it("should return correct URL with use_cache=false when window.use_cache is false", () => {
      (global.window as any).use_cache = false;

      const url = stream.searchStreamUrl({
        org_identifier: "test-org",
        page_type: "logs",
        traceId: "trace-456",
      });

      expect(url).toBe(
        "/api/test-org/_search_stream?type=logs&search_type=ui&use_cache=false&trace_id=trace-456"
      );
    });

    it("should default use_cache to true when window.use_cache is undefined", () => {
      delete (global.window as any).use_cache;

      const url = stream.searchStreamUrl({
        org_identifier: "test-org",
        page_type: "traces",
        traceId: "trace-789",
      });

      expect(url).toBe(
        "/api/test-org/_search_stream?type=traces&search_type=ui&use_cache=true&trace_id=trace-789"
      );
    });

    it("should use provided search_type", () => {
      const url = stream.searchStreamUrl({
        org_identifier: "test-org",
        page_type: "logs",
        search_type: "api",
        traceId: "trace-abc",
      });

      expect(url).toBe(
        "/api/test-org/_search_stream?type=logs&search_type=api&use_cache=true&trace_id=trace-abc"
      );
    });
  });

  describe("histogramStreamUrl", () => {
    it("should return correct histogram URL", () => {
      (global.window as any).use_cache = true;

      const url = stream.histogramStreamUrl({
        org_identifier: "test-org",
        page_type: "logs",
        traceId: "trace-hist-1",
      });

      expect(url).toBe(
        "/api/test-org/_search_histogram_stream?type=logs&search_type=ui&use_cache=true&trace_id=trace-hist-1"
      );
    });

    it("should use provided search_type for histogram", () => {
      const url = stream.histogramStreamUrl({
        org_identifier: "test-org",
        page_type: "metrics",
        search_type: "api",
        traceId: "trace-hist-2",
      });

      expect(url).toBe(
        "/api/test-org/_search_histogram_stream?type=metrics&search_type=api&use_cache=true&trace_id=trace-hist-2"
      );
    });

    it("should reflect window.use_cache=false in histogram URL", () => {
      (global.window as any).use_cache = false;

      const url = stream.histogramStreamUrl({
        org_identifier: "test-org",
        page_type: "logs",
        traceId: "trace-hist-3",
      });

      expect(url).toContain("use_cache=false");
    });
  });

  describe("pageCountStreamUrl", () => {
    it("should return correct page count URL", () => {
      (global.window as any).use_cache = true;

      const url = stream.pageCountStreamUrl({
        org_identifier: "test-org",
        page_type: "logs",
        traceId: "trace-pc-1",
      });

      expect(url).toBe(
        "/api/test-org/_search_pagecount_stream?type=logs&search_type=ui&use_cache=true&trace_id=trace-pc-1"
      );
    });

    it("should default use_cache to true when window.use_cache is undefined", () => {
      delete (global.window as any).use_cache;

      const url = stream.pageCountStreamUrl({
        org_identifier: "test-org",
        page_type: "logs",
        traceId: "trace-pc-2",
      });

      expect(url).toContain("use_cache=true");
    });
  });

  describe("fieldValuesStreamUrl", () => {
    it("should return correct field values URL joining fields with comma", () => {
      (global.window as any).use_cache = true;

      const url = stream.fieldValuesStreamUrl({
        org_identifier: "test-org",
        fields: ["status", "method"],
        stream_name: "http-logs",
        page_type: "logs",
        traceId: "trace-fv-1",
      });

      expect(url).toBe(
        "/api/test-org/http-logs/_values_stream?fields=status,method&type=logs&use_cache=true&trace_id=trace-fv-1"
      );
    });

    it("should handle a single field", () => {
      const url = stream.fieldValuesStreamUrl({
        org_identifier: "test-org",
        fields: ["level"],
        stream_name: "app-logs",
        page_type: "logs",
        traceId: "trace-fv-2",
      });

      expect(url).toContain("fields=level");
    });

    it("should reflect window.use_cache=false in field values URL", () => {
      (global.window as any).use_cache = false;

      const url = stream.fieldValuesStreamUrl({
        org_identifier: "test-org",
        fields: ["field1", "field2"],
        stream_name: "my-stream",
        page_type: "logs",
        traceId: "trace-fv-3",
      });

      expect(url).toContain("use_cache=false");
    });
  });

  describe("search", () => {
    it("should make POST request with correct URL and query payload", async () => {
      const query = { sql: "SELECT * FROM logs" };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.search({
        org_identifier: "test-org",
        query,
        page_type: "logs",
        traceId: "trace-s-1",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/_search_stream?type=logs&search_type=ui&use_cache=true&trace_id=trace-s-1&clear_cache=false",
        query
      );
    });

    it("should include clear_cache=true in URL when clear_cache is true", async () => {
      const query = { sql: "SELECT * FROM logs" };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.search({
        org_identifier: "test-org",
        query,
        page_type: "logs",
        traceId: "trace-s-2",
        clear_cache: true,
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/_search_stream?type=logs&search_type=ui&use_cache=true&trace_id=trace-s-2&clear_cache=true",
        query
      );
    });

    it("should generate traceId when not provided", async () => {
      const query = { sql: "SELECT * FROM logs" };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.search({
        org_identifier: "test-org",
        query,
        page_type: "logs",
      });

      expect(generateTraceContext).toHaveBeenCalled();
      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("trace_id=generated-trace-id-abc"),
        query
      );
    });

    it("should use provided search_type", async () => {
      const query = { sql: "SELECT * FROM metrics" };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.search({
        org_identifier: "test-org",
        query,
        page_type: "metrics",
        search_type: "api",
        traceId: "trace-s-3",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("search_type=api"),
        query
      );
    });

    it("should use use_cache=false from window", async () => {
      (global.window as any).use_cache = false;
      const query = { sql: "SELECT * FROM logs" };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.search({
        org_identifier: "test-org",
        query,
        page_type: "logs",
        traceId: "trace-s-4",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("use_cache=false"),
        query
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Search failed"));

      await expect(
        stream.search({
          org_identifier: "test-org",
          query: {},
          page_type: "logs",
          traceId: "trace-err",
        })
      ).rejects.toThrow("Search failed");
    });
  });

  describe("searchMulti", () => {
    it("should make POST request to multi-stream search URL", async () => {
      const query = { queries: [{ sql: "SELECT * FROM stream1" }] };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.searchMulti({
        org_identifier: "test-org",
        query,
        page_type: "logs",
        traceId: "trace-sm-1",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/_search_multi_stream?type=logs&search_type=ui&use_cache=true&trace_id=trace-sm-1",
        query
      );
    });

    it("should generate traceId when not provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.searchMulti({
        org_identifier: "test-org",
        query: {},
        page_type: "logs",
      });

      expect(generateTraceContext).toHaveBeenCalled();
      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("trace_id=generated-trace-id-abc"),
        {}
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Multi search failed"));

      await expect(
        stream.searchMulti({
          org_identifier: "test-org",
          query: {},
          page_type: "logs",
          traceId: "trace-sm-err",
        })
      ).rejects.toThrow("Multi search failed");
    });
  });

  describe("histogram", () => {
    it("should make POST request to histogram stream URL", async () => {
      const query = { sql: "SELECT histogram(_timestamp) FROM logs" };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.histogram({
        org_identifier: "test-org",
        query,
        page_type: "logs",
        traceId: "trace-h-1",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/_search_histogram_stream?type=logs&search_type=ui&use_cache=true&trace_id=trace-h-1",
        query
      );
    });

    it("should generate traceId when not provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.histogram({
        org_identifier: "test-org",
        query: {},
        page_type: "logs",
      });

      expect(generateTraceContext).toHaveBeenCalled();
      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("trace_id=generated-trace-id-abc"),
        {}
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Histogram failed"));

      await expect(
        stream.histogram({
          org_identifier: "test-org",
          query: {},
          page_type: "logs",
          traceId: "trace-h-err",
        })
      ).rejects.toThrow("Histogram failed");
    });
  });

  describe("pageCount", () => {
    it("should make POST request to page count stream URL", async () => {
      const query = { sql: "SELECT count(*) FROM logs" };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.pageCount({
        org_identifier: "test-org",
        query,
        page_type: "logs",
        traceId: "trace-pcc-1",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/_search_pagecount_stream?type=logs&search_type=ui&use_cache=true&trace_id=trace-pcc-1",
        query
      );
    });

    it("should generate traceId when not provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.pageCount({
        org_identifier: "test-org",
        query: {},
        page_type: "logs",
      });

      expect(generateTraceContext).toHaveBeenCalled();
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Page count failed"));

      await expect(
        stream.pageCount({
          org_identifier: "test-org",
          query: {},
          page_type: "logs",
          traceId: "trace-pcc-err",
        })
      ).rejects.toThrow("Page count failed");
    });
  });

  describe("fieldValues", () => {
    it("should make POST request with fields joined by comma", async () => {
      const query = { start_time: 1700000000 };
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.fieldValues({
        org_identifier: "test-org",
        stream_name: "app-logs",
        fields: ["status", "method", "path"],
        query,
        page_type: "logs",
        traceId: "trace-fv-post-1",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/app-logs/_values_stream?fields=status,method,path&type=logs&use_cache=true&trace_id=trace-fv-post-1",
        query
      );
    });

    it("should generate traceId when not provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.fieldValues({
        org_identifier: "test-org",
        stream_name: "logs",
        fields: ["level"],
        query: {},
        page_type: "logs",
      });

      expect(generateTraceContext).toHaveBeenCalled();
      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("trace_id=generated-trace-id-abc"),
        {}
      );
    });

    it("should use use_cache=false from window", async () => {
      (global.window as any).use_cache = false;
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.fieldValues({
        org_identifier: "test-org",
        stream_name: "my-stream",
        fields: ["field1"],
        query: {},
        page_type: "logs",
        traceId: "trace-fv-post-2",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("use_cache=false"),
        {}
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Field values failed"));

      await expect(
        stream.fieldValues({
          org_identifier: "test-org",
          stream_name: "logs",
          fields: ["level"],
          query: {},
          page_type: "logs",
          traceId: "trace-fv-err",
        })
      ).rejects.toThrow("Field values failed");
    });
  });

  describe("cancelStream", () => {
    it("should make PUT request with traceId in array body", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await stream.cancelStream({
        org_identifier: "test-org",
        traceId: "trace-cancel-1",
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/query_manager/cancel",
        ["trace-cancel-1"]
      );
    });

    it("should handle different trace IDs", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      const traceIds = ["abc-123", "uuid-def-456", "long-trace-id-xyz"];
      for (const traceId of traceIds) {
        await stream.cancelStream({ org_identifier: "test-org", traceId });
        expect(mockHttpInstance.put).toHaveBeenCalledWith(
          "/api/test-org/query_manager/cancel",
          [traceId]
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("Cancel failed"));

      await expect(
        stream.cancelStream({
          org_identifier: "test-org",
          traceId: "trace-cancel-err",
        })
      ).rejects.toThrow("Cancel failed");
    });
  });

  describe("promqlQueryRangeStreamUrl", () => {
    it("should return correct PromQL query range stream URL", () => {
      (global.window as any).use_cache = true;

      const url = stream.promqlQueryRangeStreamUrl({
        org_identifier: "test-org",
        traceId: "trace-promql-1",
      });

      expect(url).toBe(
        "/api/test-org/prometheus/api/v1/query_range?use_streaming=true&use_cache=true&trace_id=trace-promql-1"
      );
    });

    it("should reflect window.use_cache=false in PromQL URL", () => {
      (global.window as any).use_cache = false;

      const url = stream.promqlQueryRangeStreamUrl({
        org_identifier: "test-org",
        traceId: "trace-promql-2",
      });

      expect(url).toContain("use_cache=false");
      expect(url).toContain("use_streaming=true");
    });

    it("should default use_cache to true when window.use_cache is undefined", () => {
      delete (global.window as any).use_cache;

      const url = stream.promqlQueryRangeStreamUrl({
        org_identifier: "test-org",
        traceId: "trace-promql-3",
      });

      expect(url).toContain("use_cache=true");
    });
  });

  describe("promqlQueryRange", () => {
    it("should make POST request with correct base URL params", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: "up",
        start_time: 1700000000,
        end_time: 1700003600,
        step: "5m",
        traceId: "trace-pqr-1",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/prometheus/api/v1/query_range?use_streaming=true&use_cache=true&trace_id=trace-pqr-1&start=1700000000&end=1700003600&step=5m&query=up"
      );
    });

    it("should URL-encode the query string", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: 'cpu_usage{instance="server1"}',
        start_time: 1700000000,
        end_time: 1700003600,
        step: "1m",
        traceId: "trace-pqr-2",
      });

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[0]).toContain(
        encodeURIComponent('cpu_usage{instance="server1"}')
      );
    });

    it("should append dashboard_id when provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: "up",
        start_time: 1700000000,
        end_time: 1700003600,
        step: "5m",
        traceId: "trace-pqr-3",
        dashboard_id: "dash-abc",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("&dashboard_id=dash-abc")
      );
    });

    it("should URL-encode dashboard_name when provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: "up",
        start_time: 1700000000,
        end_time: 1700003600,
        step: "5m",
        traceId: "trace-pqr-4",
        dashboard_name: "My Dashboard",
      });

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[0]).toContain(
        "&dashboard_name=" + encodeURIComponent("My Dashboard")
      );
    });

    it("should append folder_id when provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: "up",
        start_time: 1700000000,
        end_time: 1700003600,
        step: "5m",
        traceId: "trace-pqr-5",
        folder_id: "folder-xyz",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("&folder_id=folder-xyz")
      );
    });

    it("should append panel_id and panel_name when provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: "up",
        start_time: 1700000000,
        end_time: 1700003600,
        step: "5m",
        traceId: "trace-pqr-6",
        panel_id: "panel-1",
        panel_name: "CPU Panel",
      });

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[0]).toContain("&panel_id=panel-1");
      expect(callArgs[0]).toContain(
        "&panel_name=" + encodeURIComponent("CPU Panel")
      );
    });

    it("should append run_id when provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: "up",
        start_time: 1700000000,
        end_time: 1700003600,
        step: "5m",
        traceId: "trace-pqr-7",
        run_id: "run-001",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("&run_id=run-001")
      );
    });

    it("should append tab_id and encoded tab_name when provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: "up",
        start_time: 1700000000,
        end_time: 1700003600,
        step: "5m",
        traceId: "trace-pqr-8",
        tab_id: "tab-2",
        tab_name: "Metrics Tab",
      });

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[0]).toContain("&tab_id=tab-2");
      expect(callArgs[0]).toContain(
        "&tab_name=" + encodeURIComponent("Metrics Tab")
      );
    });

    it("should generate traceId when not provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await stream.promqlQueryRange({
        org_identifier: "test-org",
        query: "up",
        start_time: 1700000000,
        end_time: 1700003600,
        step: "5m",
      });

      expect(generateTraceContext).toHaveBeenCalled();
      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("trace_id=generated-trace-id-abc")
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("PromQL failed"));

      await expect(
        stream.promqlQueryRange({
          org_identifier: "test-org",
          query: "up",
          start_time: 1700000000,
          end_time: 1700003600,
          step: "5m",
          traceId: "trace-pqr-err",
        })
      ).rejects.toThrow("PromQL failed");
    });
  });
});
