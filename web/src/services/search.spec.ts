// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import search from "./search";

// Mock dependencies
vi.mock("./http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock("./stream", () => ({
  default: {},
}));

vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({
    traceparent: "00-test-trace-parent-01",
  })),
  getWebSocketUrl: vi.fn(() => "ws://localhost:3000"),
}));

import http from "./http";
import { generateTraceContext } from "@/utils/zincutils";

describe("Search Service", () => {
  let mockHttp: any;
  const originalWindow = global.window;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(mockHttp);

    // Mock window object
    global.window = {
      ...originalWindow,
      use_cache: true,
    } as any;
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  describe("search", () => {
    it("should build correct URL for basic search", async () => {
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
      };

      await search.search(params);

      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "00-test-trace-parent-01" },
      });
      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search?type=logs&search_type=ui&use_cache=true",
        params.query
      );
    });

    it("should add dashboard parameters to URL", async () => {
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
        dashboard_id: "dash-123",
        folder_id: "folder-456",
        panel_id: "panel-789",
        panel_name: "Test Panel",
        run_id: "run-001",
        tab_id: "tab-1",
        tab_name: "Test Tab",
      };

      await search.search(params);

      const expectedUrl = 
        "/api/test-org/_search?type=logs&search_type=ui&use_cache=true" +
        "&dashboard_id=dash-123" +
        "&folder_id=folder-456" +
        "&panel_id=panel-789" +
        "&panel_name=Test%20Panel" +
        "&run_id=run-001" +
        "&tab_id=tab-1" +
        "&tab_name=Test%20Tab";

      expect(mockHttp.post).toHaveBeenCalledWith(expectedUrl, params.query);
    });

    it("should add is_ui_histogram parameter when provided", async () => {
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
        is_ui_histogram: true,
      };

      await search.search(params, "ui", false);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search?type=logs&search_type=ui&use_cache=true&is_ui_histogram=true",
        params.query
      );
    });

    it("should add is_multi_stream_search parameter when provided", async () => {
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
      };

      await search.search(params, "ui", true);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search?type=logs&search_type=ui&use_cache=true&is_multi_stream_search=true",
        params.query
      );
    });

    it("should use multi endpoint when query.query.sql is not a string", async () => {
      const params = {
        org_identifier: "test-org",
        query: { 
          query: { sql: ["SELECT * FROM logs1", "SELECT * FROM logs2"] },
        },
        page_type: "logs",
      };

      await search.search(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search_multi?type=logs&search_type=ui&use_cache=true",
        params.query.query
      );
    });

    it("should handle multi endpoint with aggs", async () => {
      const params = {
        org_identifier: "test-org",
        query: { 
          query: { sql: ["SELECT * FROM logs1", "SELECT * FROM logs2"] },
          aggs: { some: "aggregation" },
        },
        page_type: "logs",
      };

      await search.search(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search_multi?type=logs&search_type=ui&use_cache=true",
        { ...params.query.query, aggs: params.query.aggs }
      );
    });

    it("should use custom traceparent when provided", async () => {
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
        traceparent: "custom-trace-parent",
      };

      await search.search(params);

      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "custom-trace-parent" },
      });
    });

    it("should respect window.use_cache setting", async () => {
      global.window = { ...originalWindow, use_cache: false } as any;

      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
      };

      await search.search(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search?type=logs&search_type=ui&use_cache=false",
        params.query
      );
    });

    it("should default to use_cache=true when window.use_cache is undefined", async () => {
      global.window = { ...originalWindow } as any;
      delete (global.window as any).use_cache;

      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
      };

      await search.search(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search?type=logs&search_type=ui&use_cache=true",
        params.query
      );
    });
  });

  describe("result_schema", () => {
    it("should build correct URL for result schema", async () => {
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
      };

      await search.result_schema(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/result_schema?type=logs&search_type=ui&use_cache=true&is_streaming=false",
        params.query
      );
    });

    it("should add dashboard parameters to result schema URL", async () => {
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
        dashboard_id: "dash-123",
        folder_id: "folder-456",
        is_streaming: true,
      };

      await search.result_schema(params);

      const expectedUrl = 
        "/api/test-org/result_schema?type=logs&search_type=ui&use_cache=true&is_streaming=true" +
        "&dashboard_id=dash-123" +
        "&folder_id=folder-456";

      expect(mockHttp.post).toHaveBeenCalledWith(expectedUrl, params.query);
    });

    it("should use multi endpoint for result schema when needed", async () => {
      const params = {
        org_identifier: "test-org",
        query: { 
          query: { sql: ["SELECT * FROM logs1", "SELECT * FROM logs2"] },
        },
        page_type: "logs",
      };

      await search.result_schema(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/result_schema_multi?type=logs&search_type=ui&use_cache=true",
        params.query.query
      );
    });

    it("should handle result schema multi endpoint with aggs", async () => {
      const params = {
        org_identifier: "test-org",
        query: { 
          query: { sql: ["SELECT * FROM logs1", "SELECT * FROM logs2"] },
          aggs: { some: "aggregation" },
        },
        page_type: "logs",
      };

      await search.result_schema(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/result_schema_multi?type=logs&search_type=ui&use_cache=true",
        { ...params.query.query, aggs: params.query.aggs }
      );
    });
  });

  describe("search_around", () => {
    it("should build correct URL for search around", async () => {
      const params = {
        org_identifier: "test-org",
        index: "logs",
        key: "key123",
        size: "10",
        query_context: "SELECT * FROM logs",
        query_fn: "",
        stream_type: "logs",
        regions: "",
        clusters: "",
        is_multistream: false,
        traceparent: "trace-123",
        body: { filter: "test" },
        action_id: "",
      };

      await search.search_around(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/logs/_around?key=key123&size=10&sql=SELECT * FROM logs&type=logs",
        params.body
      );
      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "trace-123" },
      });
    });

    it("should use multistream endpoint when is_multistream is true", async () => {
      const params = {
        org_identifier: "test-org",
        index: "logs",
        key: "key123",
        size: "10",
        query_context: "SELECT * FROM logs",
        query_fn: "",
        stream_type: "logs",
        regions: "",
        clusters: "",
        is_multistream: true,
        traceparent: "trace-123",
        body: { filter: "test" },
        action_id: "",
      };

      await search.search_around(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/logs/_around_multi?key=key123&size=10&sql=SELECT * FROM logs&type=logs",
        params.body
      );
    });

    it("should add query_fn parameter when provided", async () => {
      const params = {
        org_identifier: "test-org",
        index: "logs",
        key: "key123",
        size: "10",
        query_context: "SELECT * FROM logs",
        query_fn: "custom_function",
        stream_type: "logs",
        regions: "",
        clusters: "",
        is_multistream: false,
        traceparent: "trace-123",
        body: { filter: "test" },
        action_id: "",
      };

      await search.search_around(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/logs/_around?key=key123&size=10&sql=SELECT * FROM logs&type=logs&query_fn=custom_function",
        params.body
      );
    });

    it("should add action_id parameter when provided", async () => {
      const params = {
        org_identifier: "test-org",
        index: "logs",
        key: "key123",
        size: "10",
        query_context: "SELECT * FROM logs",
        query_fn: "",
        stream_type: "logs",
        regions: "",
        clusters: "",
        is_multistream: false,
        traceparent: "trace-123",
        body: { filter: "test" },
        action_id: "action123",
      };

      await search.search_around(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/logs/_around?key=key123&size=10&sql=SELECT * FROM logs&type=logs&action_id=action123",
        params.body
      );
    });

    it("should add regions and clusters parameters when provided", async () => {
      const params = {
        org_identifier: "test-org",
        index: "logs",
        key: "key123",
        size: "10",
        query_context: "SELECT * FROM logs",
        query_fn: "",
        stream_type: "logs",
        regions: "us-east-1",
        clusters: "cluster1",
        is_multistream: false,
        traceparent: "trace-123",
        body: { filter: "test" },
        action_id: "",
      };

      await search.search_around(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/logs/_around?key=key123&size=10&sql=SELECT * FROM logs&type=logs&regions=us-east-1&clusters=cluster1",
        params.body
      );
    });
  });

  describe("metrics_query_range", () => {
    it("should build correct URL for metrics query range", async () => {
      const params = {
        org_identifier: "test-org",
        query: "up",
        start_time: 1609459200,
        end_time: 1609545600,
        step: "5m",
      };

      await search.metrics_query_range(params);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/prometheus/api/v1/query_range?use_cache=true&start=1609459200&end=1609545600&step=5m&query=up"
      );
    });

    it("should add dashboard parameters to metrics query range URL", async () => {
      const params = {
        org_identifier: "test-org",
        query: "cpu_usage{instance='server1'}",
        start_time: 1609459200,
        end_time: 1609545600,
        step: "1m",
        dashboard_id: "dash-123",
        folder_id: "folder-456",
        panel_id: "panel-789",
        panel_name: "CPU Usage",
        run_id: "run-001",
        tab_id: "tab-1",
        tab_name: "Metrics Tab",
      };

      await search.metrics_query_range(params);

      const expectedUrl = 
        "/api/test-org/prometheus/api/v1/query_range?use_cache=true&start=1609459200&end=1609545600&step=1m&query=cpu_usage%7Binstance%3D'server1'%7D" +
        "&dashboard_id=dash-123" +
        "&folder_id=folder-456" +
        "&panel_id=panel-789" +
        "&panel_name=CPU%20Usage" +
        "&run_id=run-001" +
        "&tab_id=tab-1" +
        "&tab_name=Metrics%20Tab";

      expect(mockHttp.get).toHaveBeenCalledWith(expectedUrl);
    });
  });

  describe("metrics_query", () => {
    it("should build correct URL for metrics query", async () => {
      const params = {
        org_identifier: "test-org",
        query: "up",
        start_time: 1609459200,
        end_time: 1609545600,
      };

      await search.metrics_query(params);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/prometheus/api/v1/query?time=1609545600&query=up"
      );
    });
  });

  describe("get_promql_series", () => {
    it("should build correct URL for PromQL series", async () => {
      const params = {
        org_identifier: "test-org",
        labels: "up",
        start_time: 1609459200,
        end_time: 1609545600,
      };

      await search.get_promql_series(params);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/prometheus/api/v1/series?match[]=up&start=1609459200&end=1609545600"
      );
    });
  });

  describe("get_traces", () => {
    it("should build correct URL for getting traces", async () => {
      const params = {
        org_identifier: "test-org",
        filter: "service_name='webapp'",
        start_time: 1609459200,
        end_time: 1609545600,
        from: 0,
        size: 100,
        stream_name: "traces",
      };

      await search.get_traces(params);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/traces/traces/latest?filter=service_name='webapp'&start_time=1609459200&end_time=1609545600&from=0&size=100"
      );
    });
  });

  describe("partition", () => {
    it("should build correct URL for partition search", async () => {
      const params = {
        org_identifier: "test-org",
        query: { sql: "SELECT * FROM logs" },
        page_type: "logs",
        traceparent: "trace-123",
        enable_align_histogram: true,
      };

      await search.partition(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search_partition?type=logs&enable_align_histogram=true",
        params.query
      );
      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "trace-123" },
      });
    });

    it("should use multi endpoint when query.sql is not a string", async () => {
      const params = {
        org_identifier: "test-org",
        query: { sql: ["SELECT * FROM logs1", "SELECT * FROM logs2"] },
        page_type: "logs",
        traceparent: "trace-123",
        enable_align_histogram: false,
      };

      await search.partition(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search_partition_multi?type=logs&enable_align_histogram=true",
        params.query
      );
    });
  });

  describe("get_running_queries", () => {
    it("should get running queries", async () => {
      await search.get_running_queries("test-org");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/query_manager/status");
    });
  });

  describe("delete_running_queries", () => {
    it("should delete running queries", async () => {
      const traceIDs = ["trace1", "trace2"];

      await search.delete_running_queries("test-org", traceIDs);

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/test-org/query_manager/cancel",
        traceIDs
      );
    });
  });

  describe("get_regions", () => {
    it("should get regions/clusters", async () => {
      await search.get_regions();

      expect(mockHttp.get).toHaveBeenCalledWith("/api/clusters");
    });
  });

  describe("get_history", () => {
    it("should get search history with basic parameters", async () => {
      await search.get_history("test-org");

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search_history",
        {
          stream_type: "logs",
          org_identifier: "test-org",
          user_email: null,
        }
      );
    });

    it("should get search history with start and end time", async () => {
      await search.get_history("test-org", 1609459200, 1609545600);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search_history",
        {
          stream_type: "logs",
          org_identifier: "test-org",
          user_email: null,
          start_time: 1609459200,
          end_time: 1609545600,
        }
      );
    });

    it("should get search history with only start time", async () => {
      await search.get_history("test-org", 1609459200, null);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/_search_history",
        {
          stream_type: "logs",
          org_identifier: "test-org",
          user_email: null,
          start_time: 1609459200,
        }
      );
    });
  });

  describe("schedule_search", () => {
    it("should schedule search with default parameters", async () => {
      const params = {
        org_identifier: "test-org",
        query: { sql: "SELECT * FROM logs" },
        page_type: "logs",
      };

      await search.schedule_search(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/search_jobs?type=logs&search_type=ui&use_cache=true",
        params.query
      );
      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "00-test-trace-parent-01" },
      });
    });

    it("should schedule search with custom traceparent", async () => {
      const params = {
        org_identifier: "test-org",
        query: { sql: "SELECT * FROM logs" },
        page_type: "logs",
        traceparent: "custom-trace",
      };

      await search.schedule_search(params, "api");

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/search_jobs?type=logs&search_type=api&use_cache=true",
        params.query
      );
      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "custom-trace" },
      });
    });
  });

  describe("cancel_scheduled_search", () => {
    it("should cancel scheduled search", async () => {
      const params = {
        org_identifier: "test-org",
        jobId: "job-123",
      };

      await search.cancel_scheduled_search(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/search_jobs/job-123/cancel"
      );
    });
  });

  describe("retry_scheduled_search", () => {
    it("should retry scheduled search", async () => {
      const params = {
        org_identifier: "test-org",
        jobId: "job-123",
      };

      await search.retry_scheduled_search(params);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/search_jobs/job-123/retry"
      );
    });
  });

  describe("delete_scheduled_search", () => {
    it("should delete scheduled search", async () => {
      const params = {
        org_identifier: "test-org",
        jobId: "job-123",
      };

      await search.delete_scheduled_search(params);

      expect(mockHttp.delete).toHaveBeenCalledWith(
        "/api/test-org/search_jobs/job-123"
      );
    });
  });

  describe("get_scheduled_search_list", () => {
    it("should get scheduled search list", async () => {
      const params = {
        org_identifier: "test-org",
        page_type: "logs",
      };

      await search.get_scheduled_search_list(params);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/search_jobs?type=logs&search_type=ui&use_cache=true"
      );
    });
  });

  describe("get_scheduled_search_result", () => {
    it("should get scheduled search result", async () => {
      const params = {
        org_identifier: "test-org",
        jobId: "job-123",
        page_type: "logs",
        query: { query: { size: 100, from: 0 } },
      };

      await search.get_scheduled_search_result(params);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/search_jobs/job-123/result?type=logs&search_type=ui&use_cache=true&size=100&from=0"
      );
    });
  });

  describe("trace context generation", () => {
    it("should generate trace context when not provided", async () => {
      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
      };

      await search.search(params);

      expect(generateTraceContext).toHaveBeenCalled();
      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "00-test-trace-parent-01" },
      });
    });

    it("should not generate trace context when already provided", async () => {
      (generateTraceContext as any).mockClear();

      const params = {
        org_identifier: "test-org",
        query: { query: { sql: "SELECT * FROM logs" } },
        page_type: "logs",
        traceparent: "existing-trace",
      };

      await search.search(params);

      expect(generateTraceContext).not.toHaveBeenCalled();
      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "existing-trace" },
      });
    });
  });
});