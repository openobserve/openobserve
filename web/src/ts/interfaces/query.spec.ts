// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import type {
  Query,
  SearchRequestPayload,
  QueryPayload,
  HistogramQueryPayload,
  WebSocketSearchResponse,
  WebSocketSearchPayload,
  WebSocketValuesPayload,
  ErrorContent,
  WebSocketErrorResponse,
  StreamingSource,
  StreamingSearchResponse,
  StreamingSearchEvent,
  StreamingSearchPayload,
  StreamingErrorResponse,
  PromQLStreamingPayload,
  PromQLQueryPayload,
  PromQLStreamingResponse,
} from "./query";

describe("Query Interfaces", () => {
  describe("Query", () => {
    it("should accept valid Query object", () => {
      const query: Query = {
        from: 0,
        size: 100,
        sql: "SELECT * FROM logs",
        track_total_hits: true,
      };

      expect(query.from).toBe(0);
      expect(query.size).toBe(100);
      expect(query.sql).toBe("SELECT * FROM logs");
      expect(query.track_total_hits).toBe(true);
    });

    it("should accept Query without optional track_total_hits", () => {
      const query: Query = {
        from: 0,
        size: 50,
        sql: "SELECT * FROM metrics",
      };

      expect(query.track_total_hits).toBeUndefined();
    });

    it("should handle different from values", () => {
      const queries: Query[] = [
        { from: 0, size: 10, sql: "query1" },
        { from: 10, size: 10, sql: "query2" },
        { from: 100, size: 50, sql: "query3" },
      ];

      expect(queries[0].from).toBe(0);
      expect(queries[1].from).toBe(10);
      expect(queries[2].from).toBe(100);
    });
  });

  describe("QueryPayload", () => {
    it("should accept valid QueryPayload", () => {
      const payload: QueryPayload = {
        sql: "SELECT * FROM traces WHERE service='api'",
        start_time: 1640995200000000,
        end_time: 1640998800000000,
        from: 0,
        size: 100,
      };

      expect(payload.sql).toBeTruthy();
      expect(payload.start_time).toBeGreaterThan(0);
      expect(payload.end_time).toBeGreaterThan(payload.start_time);
    });

    it("should accept QueryPayload with optional fields", () => {
      const payload: QueryPayload = {
        sql: "SELECT * FROM logs",
        start_time: 1640995200000000,
        end_time: 1640998800000000,
        from: 0,
        size: 100,
        query_fn: "transform_function",
        track_total_hits: true,
        action_id: "action-123",
      };

      expect(payload.query_fn).toBe("transform_function");
      expect(payload.track_total_hits).toBe(true);
      expect(payload.action_id).toBe("action-123");
    });
  });

  describe("HistogramQueryPayload", () => {
    it("should accept valid HistogramQueryPayload", () => {
      const histogram: HistogramQueryPayload = {
        histogram: "SELECT histogram(_timestamp, '30 second') FROM logs",
      };

      expect(histogram.histogram).toContain("histogram");
      expect(histogram.histogram).toContain("_timestamp");
    });
  });

  describe("SearchRequestPayload", () => {
    it("should accept complete SearchRequestPayload", () => {
      const request: SearchRequestPayload = {
        query: {
          sql: "SELECT * FROM logs",
          start_time: 1640995200000000,
          end_time: 1640998800000000,
          from: 0,
          size: 100,
        },
        aggs: {
          histogram: "SELECT histogram(_timestamp, '1 minute') FROM logs",
        },
        regions: ["us-west-1", "us-east-1"],
        clusters: ["cluster-1", "cluster-2"],
      };

      expect(request.query).toBeDefined();
      expect(request.aggs).toBeDefined();
      expect(request.regions).toHaveLength(2);
      expect(request.clusters).toHaveLength(2);
    });

    it("should accept SearchRequestPayload without optional fields", () => {
      const request: SearchRequestPayload = {
        query: {
          sql: "SELECT * FROM logs",
          start_time: 1640995200000000,
          end_time: 1640998800000000,
          from: 0,
          size: 100,
        },
      };

      expect(request.aggs).toBeUndefined();
      expect(request.regions).toBeUndefined();
      expect(request.clusters).toBeUndefined();
    });
  });

  describe("WebSocketSearchResponse", () => {
    it("should accept search_response type", () => {
      const response: WebSocketSearchResponse = {
        type: "search_response",
        content: {
          results: {
            hits: [{ id: 1, message: "test" }],
            total: 100,
            took: 50,
          },
          traceId: "trace-123",
        },
      };

      expect(response.type).toBe("search_response");
      expect(response.content.results.hits).toHaveLength(1);
      expect(response.content.traceId).toBe("trace-123");
    });

    it("should accept all valid response types", () => {
      const types: WebSocketSearchResponse["type"][] = [
        "search_response",
        "cancel_response",
        "error",
        "end",
        "progress",
        "search_response_metadata",
        "search_response_hits",
      ];

      types.forEach((type) => {
        const response: WebSocketSearchResponse = {
          type,
          content: {
            results: {
              hits: [],
              total: 0,
              took: 0,
            },
            traceId: "trace-123",
          },
        };

        expect(response.type).toBe(type);
      });
    });

    it("should accept response with optional result fields", () => {
      const response: WebSocketSearchResponse = {
        type: "search_response",
        content: {
          results: {
            hits: [],
            total: 100,
            took: 25,
            function_error: "Transform error",
            new_start_time: 1640995200000000,
            new_end_time: 1640998800000000,
            scan_size: 1024000,
            from: 0,
            aggs: { buckets: [] },
            result_cache_ratio: 0.85,
            order_by: "_timestamp DESC",
            histogram_interval: 60,
            is_histogram_eligible: true,
            converted_histogram_query: "SELECT histogram(...)",
          },
          streaming_aggs: true,
          total: 100,
          time_offset: "-07:00",
          traceId: "trace-456",
          type: "logs",
        },
      };

      expect(response.content.results.function_error).toBe("Transform error");
      expect(response.content.streaming_aggs).toBe(true);
      expect(response.content.time_offset).toBe("-07:00");
    });
  });

  describe("WebSocketSearchPayload", () => {
    it("should accept search type payload", () => {
      const payload: WebSocketSearchPayload = {
        queryReq: {
          query: {
            sql: "SELECT * FROM logs",
            start_time: 1640995200000000,
            end_time: 1640998800000000,
            from: 0,
            size: 100,
          },
        },
        type: "search",
        isPagination: false,
        traceId: "trace-789",
        org_id: "org-123",
      };

      expect(payload.type).toBe("search");
      expect(payload.isPagination).toBe(false);
      expect(payload.org_id).toBe("org-123");
    });

    it("should accept all valid payload types", () => {
      const types: WebSocketSearchPayload["type"][] = [
        "search",
        "histogram",
        "pageCount",
        "values",
      ];

      types.forEach((type) => {
        const payload: WebSocketSearchPayload = {
          queryReq: {
            query: {
              sql: "SELECT * FROM logs",
              start_time: 1640995200000000,
              end_time: 1640998800000000,
              from: 0,
              size: 100,
            },
          },
          type,
          isPagination: false,
          traceId: "trace-123",
          org_id: "org-123",
        };

        expect(payload.type).toBe(type);
      });
    });

    it("should accept payload with meta", () => {
      const payload: WebSocketSearchPayload = {
        queryReq: {
          query: {
            sql: "SELECT * FROM logs",
            start_time: 1640995200000000,
            end_time: 1640998800000000,
            from: 0,
            size: 100,
          },
        },
        type: "search",
        isPagination: true,
        traceId: "trace-123",
        org_id: "org-123",
        meta: {
          dashboardId: "dash-456",
          panelId: "panel-789",
        },
      };

      expect(payload.meta.dashboardId).toBe("dash-456");
      expect(payload.isPagination).toBe(true);
    });
  });

  describe("WebSocketValuesPayload", () => {
    it("should accept values payload", () => {
      const payload: WebSocketValuesPayload = {
        queryReq: {
          query: {
            sql: "SELECT DISTINCT field FROM logs",
            start_time: 1640995200000000,
            end_time: 1640998800000000,
            from: 0,
            size: 1000,
          },
        },
        type: "values",
        traceId: "trace-values-123",
        org_id: "org-123",
      };

      expect(payload.type).toBe("values");
      expect(payload.queryReq.query.sql).toContain("DISTINCT");
    });
  });

  describe("ErrorContent and WebSocketErrorResponse", () => {
    it("should accept basic error content", () => {
      const error: ErrorContent = {
        message: "Query execution failed",
      };

      expect(error.message).toBeTruthy();
    });

    it("should accept error content with all fields", () => {
      const error: ErrorContent = {
        message: "Syntax error in SQL query",
        trace_id: "trace-error-123",
        code: 400,
        error_detail: "Unexpected token at line 1",
        error: "SYNTAX_ERROR",
      };

      expect(error.code).toBe(400);
      expect(error.trace_id).toBe("trace-error-123");
      expect(error.error_detail).toContain("token");
    });

    it("should accept WebSocket error response", () => {
      const response: WebSocketErrorResponse = {
        content: {
          message: "Connection timeout",
          code: 504,
        },
        type: "error",
      };

      expect(response.type).toBe("error");
      expect(response.content.code).toBe(504);
    });
  });

  describe("Streaming Interfaces", () => {
    it("should accept StreamingSource", () => {
      // Mock EventSource for testing since it's not available in test environment
      const mockEventSource = {} as EventSource;

      const source: StreamingSource = {
        "trace-123": mockEventSource,
        "trace-456": mockEventSource,
      };

      expect(Object.keys(source)).toHaveLength(2);
      expect(source["trace-123"]).toBeDefined();
      expect(source["trace-456"]).toBeDefined();
    });

    it("should accept StreamingSearchResponse", () => {
      const response: StreamingSearchResponse = {
        hits: [{ id: 1 }, { id: 2 }],
        total: 1000,
        took: 125,
        function_error: undefined,
        new_start_time: 1640995200000000,
        new_end_time: 1640998800000000,
        scan_size: 2048000,
        time_offset: "+00:00",
        cached_ratio: 0.75,
        streaming_aggs: false,
      };

      expect(response.hits).toHaveLength(2);
      expect(response.total).toBe(1000);
      expect(response.cached_ratio).toBe(0.75);
    });

    it("should accept StreamingSearchEvent", () => {
      const event: StreamingSearchEvent = {
        data: JSON.stringify({ hits: [], total: 0, took: 0 }),
        type: "message",
        lastEventId: "event-123",
      };

      expect(event.type).toBe("message");
      expect(event.data).toBeTruthy();
      expect(JSON.parse(event.data)).toHaveProperty("hits");
    });

    it("should accept all streaming event types", () => {
      const types: StreamingSearchEvent["type"][] = [
        "message",
        "error",
        "open",
        "end",
      ];

      types.forEach((type) => {
        const event: StreamingSearchEvent = {
          data: "{}",
          type,
        };

        expect(event.type).toBe(type);
      });
    });

    it("should accept StreamingSearchPayload", () => {
      const payload: StreamingSearchPayload = {
        queryReq: {
          query: {
            sql: "SELECT * FROM logs",
            start_time: 1640995200000000,
            end_time: 1640998800000000,
            from: 0,
            size: 100,
          },
        },
        type: "search",
        isPagination: false,
        traceId: "stream-trace-123",
        org_id: "org-streaming",
        meta: { streamId: "stream-1" },
      };

      expect(payload.traceId).toContain("stream");
      expect(payload.meta.streamId).toBe("stream-1");
    });

    it("should accept StreamingErrorResponse", () => {
      const error: StreamingErrorResponse = {
        message: "Stream connection lost",
        trace_id: "stream-trace-error",
        code: 503,
        error_detail: "Connection interrupted",
      };

      expect(error.message).toContain("connection");
      expect(error.code).toBe(503);
    });
  });

  describe("PromQL Interfaces", () => {
    it("should accept PromQLQueryPayload", () => {
      const payload: PromQLQueryPayload = {
        query: 'rate(http_requests_total[5m])',
        start_time: 1640995200000000,
        end_time: 1640998800000000,
        step: "30s",
      };

      expect(payload.query).toContain("rate");
      expect(payload.step).toBe("30s");
    });

    it("should accept different step values", () => {
      const steps = ["1s", "15s", "1m", "5m", "1h"];

      steps.forEach((step) => {
        const payload: PromQLQueryPayload = {
          query: "up",
          start_time: 1640995200000000,
          end_time: 1640998800000000,
          step,
        };

        expect(payload.step).toBe(step);
      });
    });

    it("should accept PromQLStreamingPayload", () => {
      const payload: PromQLStreamingPayload = {
        queryReq: {
          query: "sum(rate(cpu_usage[5m])) by (instance)",
          start_time: 1640995200000000,
          end_time: 1640998800000000,
          step: "1m",
        },
        type: "promql",
        traceId: "promql-trace-123",
        org_id: "org-promql",
        meta: { dashboard: "metrics-dashboard" },
      };

      expect(payload.type).toBe("promql");
      expect(payload.queryReq.query).toContain("rate");
    });

    it("should accept PromQLStreamingResponse with vector result", () => {
      const response: PromQLStreamingResponse = {
        result_type: "vector",
        result: [
          {
            metric: { instance: "localhost:9090" },
            value: [1640995200, "1.5"],
          },
        ],
      };

      expect(response.result_type).toBe("vector");
      expect(Array.isArray(response.result)).toBe(true);
    });

    it("should accept PromQLStreamingResponse with matrix result", () => {
      const response: PromQLStreamingResponse = {
        result_type: "matrix",
        result: [
          {
            metric: { job: "api" },
            values: [
              [1640995200, "10"],
              [1640995260, "12"],
              [1640995320, "15"],
            ],
          },
        ],
      };

      expect(response.result_type).toBe("matrix");
      expect(response.result[0].values).toHaveLength(3);
    });
  });

  describe("Type Safety and Integration", () => {
    it("should maintain type safety across nested structures", () => {
      const fullRequest: WebSocketSearchPayload = {
        queryReq: {
          query: {
            sql: "SELECT * FROM logs WHERE level='error'",
            start_time: 1640995200000000,
            end_time: 1640998800000000,
            from: 0,
            size: 100,
            query_fn: "error_parser",
            track_total_hits: true,
          },
          aggs: {
            histogram: "SELECT histogram(_timestamp, '5 minute') FROM logs",
          },
          regions: ["us-west-1"],
          clusters: ["prod-cluster"],
        },
        type: "search",
        isPagination: false,
        traceId: "full-request-123",
        org_id: "org-integration",
        meta: {
          source: "alert-system",
          priority: "high",
        },
      };

      expect(fullRequest.queryReq.query.query_fn).toBe("error_parser");
      expect(fullRequest.queryReq.aggs?.histogram).toContain("histogram");
      expect(fullRequest.meta.priority).toBe("high");
    });

    it("should handle response with all optional fields", () => {
      const response: WebSocketSearchResponse = {
        type: "search_response",
        content: {
          results: {
            hits: [
              { _timestamp: 1640995200, message: "Error occurred" },
              { _timestamp: 1640995300, message: "System recovered" },
            ],
            total: 2,
            took: 45,
            function_error: undefined,
            new_start_time: 1640995000000000,
            new_end_time: 1640999000000000,
            scan_size: 512000,
            from: 0,
            aggs: {
              buckets: [
                { key: "2022-01-01T00:00:00Z", count: 10 },
                { key: "2022-01-01T00:05:00Z", count: 15 },
              ],
            },
            result_cache_ratio: 0.92,
            order_by: "_timestamp DESC",
            histogram_interval: 300,
            is_histogram_eligible: true,
            converted_histogram_query: "SELECT histogram(_timestamp, 300) FROM logs",
          },
          streaming_aggs: true,
          total: 2,
          time_offset: "-08:00",
          traceId: "integration-trace-456",
          type: "logs",
        },
      };

      expect(response.content.results.aggs.buckets).toHaveLength(2);
      expect(response.content.results.result_cache_ratio).toBeGreaterThan(0.9);
      expect(response.content.streaming_aggs).toBe(true);
    });
  });
});
