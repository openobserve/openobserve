// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { logsApi } from "@/services/logs/logsApi";

// Mock dependencies
vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({ traceparent: "test-trace-parent" }))
}));

vi.mock("@/services/http", () => {
  const httpMock = {
    post: vi.fn(() => Promise.resolve({ data: { test: "response" } })),
    get: vi.fn(() => Promise.resolve({ data: { test: "response" } })),
    delete: vi.fn(() => Promise.resolve({ data: { test: "response" } }))
  };
  return {
    default: vi.fn(() => httpMock)
  };
});

describe("Logs API Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.use_cache
    Object.defineProperty(window, "use_cache", {
      value: true,
      writable: true
    });
  });

  describe("search", () => {
    it("should make a search request with basic parameters", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs"
      };

      await logsApi.search(params);

      expect(mockHttp.default).toHaveBeenCalledWith({
        headers: { traceparent: "test-trace-parent" }
      });
      expect(mockHttp.default().post).toHaveBeenCalledWith(
        "/api/test-org/_search?type=logs&search_type=ui&use_cache=true",
        params.query
      );
    });

    it("should handle multi-stream queries", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        query: { 
          query: { sql: ["SELECT * FROM logs1", "SELECT * FROM logs2"] },
          aggs: { test: "aggregation" }
        },
        page_type: "logs"
      };

      await logsApi.search(params);

      expect(mockHttp.default().post).toHaveBeenCalledWith(
        "/api/test-org/_search_multi?type=logs&search_type=ui&use_cache=true",
        { ...params.query.query, aggs: params.query.aggs }
      );
    });

    it("should include optional parameters in URL", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
        dashboard_id: "dash-123",
        panel_id: "panel-456",
        is_ui_histogram: true
      };

      await logsApi.search(params, "ui", true);

      expect(mockHttp.default().post).toHaveBeenCalledWith(
        "/api/test-org/_search?type=logs&search_type=ui&use_cache=true&dashboard_id=dash-123&panel_id=panel-456&is_ui_histogram=true&is_multi_stream_search=true",
        params.query
      );
    });
  });

  describe("partition", () => {
    it("should make a partition request", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
        enable_align_histogram: true
      };

      await logsApi.partition(params);

      expect(mockHttp.default().post).toHaveBeenCalledWith(
        "/api/test-org/partition?type=logs&use_cache=true&enable_align_histogram=true",
        params.query
      );
    });
  });

  describe("searchAround", () => {
    it("should make a search around request", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        index: "logs",
        key: "test-key",
        size: 10,
        body: { test: "body" },
        stream_type: "logs",
        query_context: "SELECT * FROM logs",
        regions: ["us-east-1"]
      };

      await logsApi.searchAround(params);

      expect(mockHttp.default().post).toHaveBeenCalledWith(
        "/api/test-org/logs/_around?key=test-key&size=10&stream_type=logs&sql=SELECT%20*%20FROM%20logs&regions=us-east-1",
        params.body
      );
    });
  });

  describe("scheduleSearch", () => {
    it("should schedule a search", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs"
      };

      await logsApi.scheduleSearch(params);

      expect(mockHttp.default().post).toHaveBeenCalledWith(
        "/api/test-org/_search_jobs?type=logs&search_type=ui",
        params.query
      );
    });
  });

  describe("getScheduledSearchResult", () => {
    it("should get scheduled search results", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        jobId: "job-123",
        page_type: "logs"
      };

      await logsApi.getScheduledSearchResult(params);

      expect(mockHttp.default().post).toHaveBeenCalledWith(
        "/api/test-org/_search_job_result/job-123?type=logs&search_type=ui&use_cache=true",
        params.query
      );
    });
  });

  describe("getRunningQueries", () => {
    it("should get running queries", async () => {
      const mockHttp = await import("@/services/http");

      await logsApi.getRunningQueries("test-org");

      expect(mockHttp.default().get).toHaveBeenCalledWith("/api/test-org/_queries");
    });
  });

  describe("cancelRunningQueries", () => {
    it("should cancel running queries", async () => {
      const mockHttp = await import("@/services/http");
      const traceIDs = ["trace1", "trace2"];

      await logsApi.cancelRunningQueries("test-org", traceIDs);

      expect(mockHttp.default().delete).toHaveBeenCalledWith(
        "/api/test-org/_queries",
        { data: { trace_ids: traceIDs } }
      );
    });
  });

  describe("getRegions", () => {
    it("should get available regions", async () => {
      const mockHttp = await import("@/services/http");

      await logsApi.getRegions();

      expect(mockHttp.default().get).toHaveBeenCalledWith("/api/clusters");
    });
  });
});