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

import { describe, expect, it } from "vitest";
import { promQueryModeller } from "./queryModeller";
import {
  PromVisualQuery,
  PromOperationId,
  PromVisualQueryOperationCategory,
} from "../types";

describe("QueryModeller", () => {
  describe("Label Rendering", () => {
    it("should render single label filter", () => {
      const labels = [{ label: "method", op: "=", value: "GET" }];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{method="GET"}');
    });

    it("should render multiple label filters", () => {
      const labels = [
        { label: "method", op: "=", value: "GET" },
        { label: "status", op: "=", value: "200" },
      ];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{method="GET",status="200"}');
    });

    it("should render regex label filters", () => {
      const labels = [{ label: "path", op: "=~", value: "/api.*" }];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{path=~"/api.*"}');
    });

    it("should render negative label filters", () => {
      const labels = [{ label: "status", op: "!=", value: "500" }];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{status!="500"}');
    });

    it("should render negative regex filters", () => {
      const labels = [{ label: "path", op: "!~", value: "/admin.*" }];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{path!~"/admin.*"}');
    });

    it("should escape quotes in values", () => {
      const labels = [{ label: "msg", op: "=", value: 'Error "critical"' }];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{msg="Error \\"critical\\""}');
    });

    it("should escape backslashes in values", () => {
      const labels = [{ label: "path", op: "=", value: 'C:\\Users\\test' }];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{path="C:\\\\Users\\\\test"}');
    });

    it("should escape both backslashes and quotes", () => {
      const labels = [{ label: "path", op: "=", value: 'C:\\path\\"with\\"quotes' }];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{path="C:\\\\path\\\\\\"with\\\\\\"quotes"}');
    });

    it("should handle values with no special characters", () => {
      const labels = [{ label: "status", op: "=", value: "success" }];

      const result = promQueryModeller.renderLabels(labels);

      expect(result).toBe('{status="success"}');
    });

    it("should return empty string for empty labels", () => {
      const result = promQueryModeller.renderLabels([]);

      expect(result).toBe("");
    });
  });

  describe("Range Functions", () => {
    it("should render rate function", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromOperationId.Rate, params: ["5m"] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("rate(http_requests_total{}[5m])");
    });

    it("should render irate function", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromOperationId.Irate, params: ["5m"] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("irate(http_requests_total{}[5m])");
    });

    it("should render increase function", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromOperationId.Increase, params: ["5m"] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("increase(http_requests_total{}[5m])");
    });

    it("should render avg_over_time function", () => {
      const query: PromVisualQuery = {
        metric: "cpu_usage",
        labels: [],
        operations: [{ id: PromOperationId.AvgOverTime, params: ["5m"] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("avg_over_time(cpu_usage{}[5m])");
    });

    it("should render quantile_over_time function", () => {
      const query: PromVisualQuery = {
        metric: "response_time",
        labels: [],
        operations: [
          { id: PromOperationId.QuantileOverTime, params: [0.95, "5m"] },
        ],
      };

      const result = promQueryModeller.renderQuery(query);

      // quantile_over_time takes the quantile first, then applies the range
      expect(result).toBe("quantile_over_time(0.95, response_time{}[5m])");
    });
  });

  describe("Aggregations", () => {
    it("should render sum without labels", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromOperationId.Sum, params: [[]] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("sum(http_requests_total{})");
    });

    it("should render sum by single label", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromOperationId.Sum, params: [["method"]] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("sum by (method) (http_requests_total{})");
    });

    it("should render sum by multiple labels", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [
          { id: PromOperationId.Sum, params: [["method", "status"]] },
        ],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("sum by (method, status) (http_requests_total{})");
    });

    it("should render avg aggregation", () => {
      const query: PromVisualQuery = {
        metric: "cpu_usage",
        labels: [],
        operations: [{ id: PromOperationId.Avg, params: [["host"]] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("avg by (host) (cpu_usage{})");
    });

    it("should render topk with labels", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromOperationId.TopK, params: [10, ["method"]] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("topk by (method) (10, http_requests_total{})");
    });

    it("should render topk without labels", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromOperationId.TopK, params: [10, []] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("topk(10, http_requests_total{})");
    });

    it("should render quantile aggregation", () => {
      const query: PromVisualQuery = {
        metric: "response_time",
        labels: [],
        operations: [{ id: PromOperationId.Quantile, params: [0.99, []] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("quantile(0.99, response_time{})");
    });
  });

  describe("Binary Operations", () => {
    it("should render addition operation", () => {
      const query: PromVisualQuery = {
        metric: "memory_usage",
        labels: [],
        operations: [{ id: PromOperationId.Addition, params: [100] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("memory_usage{} + 100");
    });

    it("should render subtraction operation", () => {
      const query: PromVisualQuery = {
        metric: "total_requests",
        labels: [],
        operations: [{ id: PromOperationId.Subtraction, params: [50] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("total_requests{} - 50");
    });

    it("should render multiplication operation", () => {
      const query: PromVisualQuery = {
        metric: "bytes",
        labels: [],
        operations: [{ id: PromOperationId.MultiplyBy, params: [2] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("bytes{} * 2");
    });

    it("should render division operation", () => {
      const query: PromVisualQuery = {
        metric: "total_bytes",
        labels: [],
        operations: [{ id: PromOperationId.DivideBy, params: [1024] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("total_bytes{} / 1024");
    });

    it("should render modulo operation", () => {
      const query: PromVisualQuery = {
        metric: "counter",
        labels: [],
        operations: [{ id: PromOperationId.Modulo, params: [10] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("counter{} % 10");
    });

    it("should render exponent operation", () => {
      const query: PromVisualQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromOperationId.Exponent, params: [2] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("value{} ^ 2");
    });
  });

  describe("Functions", () => {
    it("should render abs function", () => {
      const query: PromVisualQuery = {
        metric: "temperature",
        labels: [],
        operations: [{ id: PromOperationId.Abs, params: [] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("abs(temperature{})");
    });

    it("should render ceil function", () => {
      const query: PromVisualQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromOperationId.Ceil, params: [] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("ceil(value{})");
    });

    it("should render floor function", () => {
      const query: PromVisualQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromOperationId.Floor, params: [] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("floor(value{})");
    });

    it("should render round function with parameter", () => {
      const query: PromVisualQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromOperationId.Round, params: [10] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("round(value{}, 10)");
    });

    it("should render sqrt function", () => {
      const query: PromVisualQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromOperationId.Sqrt, params: [] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("sqrt(value{})");
    });

    it("should render clamp function", () => {
      const query: PromVisualQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromOperationId.Clamp, params: [0, 100] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("clamp(value{}, 0, 100)");
    });

    it("should render histogram_quantile", () => {
      const query: PromVisualQuery = {
        metric: "http_request_duration_seconds_bucket",
        labels: [],
        operations: [{ id: PromOperationId.HistogramQuantile, params: [0.95] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe(
        "histogram_quantile(0.95, http_request_duration_seconds_bucket{})",
      );
    });
  });

  describe("Trigonometric Functions", () => {
    it("should render sin function", () => {
      const query: PromVisualQuery = {
        metric: "angle",
        labels: [],
        operations: [{ id: PromOperationId.Sin, params: [] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("sin(angle{})");
    });

    it("should render cos function", () => {
      const query: PromVisualQuery = {
        metric: "angle",
        labels: [],
        operations: [{ id: PromOperationId.Cos, params: [] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("cos(angle{})");
    });

    it("should render tan function", () => {
      const query: PromVisualQuery = {
        metric: "angle",
        labels: [],
        operations: [{ id: PromOperationId.Tan, params: [] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("tan(angle{})");
    });
  });

  describe("Complex Queries", () => {
    it("should render query with metric and labels", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [
          { label: "method", op: "=", value: "GET" },
          { label: "status", op: "=", value: "200" },
        ],
        operations: [],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe('http_requests_total{method="GET",status="200"}');
    });

    it("should render chained operations", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [{ label: "method", op: "=", value: "GET" }],
        operations: [
          { id: PromOperationId.Rate, params: ["5m"] },
          { id: PromOperationId.Sum, params: [["status"]] },
        ],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe(
        'sum by (status) (rate(http_requests_total{method="GET"}[5m]))',
      );
    });

    it("should render complex multi-operation query", () => {
      const query: PromVisualQuery = {
        metric: "node_memory_MemTotal_bytes",
        labels: [],
        operations: [
          { id: PromOperationId.AvgOverTime, params: ["5m"] },
          { id: PromOperationId.Sum, params: [["instance"]] },
          { id: PromOperationId.DivideBy, params: [1048576] },
        ],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe(
        "sum by (instance) (avg_over_time(node_memory_MemTotal_bytes{}[5m])) / 1048576",
      );
    });

    it("should handle query with only metric name", () => {
      const query: PromVisualQuery = {
        metric: "up",
        labels: [],
        operations: [],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("up{}");
    });

    it("should handle empty metric with labels", () => {
      const query: PromVisualQuery = {
        metric: "",
        labels: [{ label: "__name__", op: "=", value: "up" }],
        operations: [],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe('{__name__="up"}');
    });
  });

  describe("Operation Definitions", () => {
    it("should get operation definition by id", () => {
      const opDef = promQueryModeller.getOperationDef(PromOperationId.Rate);

      expect(opDef).toBeDefined();
      expect(opDef?.id).toBe(PromOperationId.Rate);
      expect(opDef?.name).toBe("Rate");
    });

    it("should return undefined for unknown operation", () => {
      const opDef = promQueryModeller.getOperationDef("unknown_op");

      expect(opDef).toBeUndefined();
    });

    it("should get operations by category", () => {
      const ops = promQueryModeller.getOperationsForCategory(
        PromVisualQueryOperationCategory.RangeFunctions,
      );

      expect(ops.length).toBeGreaterThan(0);
      expect(ops.some((op) => op.id === PromOperationId.Rate)).toBe(true);
    });

    it("should get all categories", () => {
      const categories = promQueryModeller.getCategories();

      expect(categories).toContain(
        PromVisualQueryOperationCategory.RangeFunctions,
      );
      expect(categories).toContain(
        PromVisualQueryOperationCategory.Aggregations,
      );
      expect(categories).toContain(PromVisualQueryOperationCategory.Functions);
    });

    it("should get all operations", () => {
      const allOps = promQueryModeller.getAllOperations();

      expect(allOps.length).toBeGreaterThan(0);
      expect(allOps.some((op) => op.id === PromOperationId.Rate)).toBe(true);
      expect(allOps.some((op) => op.id === PromOperationId.Sum)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle operation with default params fallback", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [
          { id: PromOperationId.Rate, params: [] }, // Empty params, should use default
        ],
      };

      const result = promQueryModeller.renderQuery(query);

      // Should use default step from operation definition
      expect(result).toContain("rate");
    });

    it("should handle aggregation with string labels (backward compat)", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [
          { id: PromOperationId.Sum, params: ["method,status"] as any },
        ],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("sum by (method, status) (http_requests_total{})");
    });

    it("should filter empty label names from aggregation", () => {
      const query: PromVisualQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromOperationId.Sum, params: [["method", "", " "]] }],
      };

      const result = promQueryModeller.renderQuery(query);

      expect(result).toBe("sum by (method) (http_requests_total{})");
    });
  });
});
