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

import { describe, expect, it } from "vitest";
import { promqlRenderer } from "./queryModeller";
import { buildPromqlStepCatalog } from "./index";
import { PromqlBuilderQuery, PromqlStepId, PromqlStepGroup } from "../types";

describe("QueryModeller", () => {
  describe("Label Rendering", () => {
    it("should render single label filter", () => {
      const labels = [{ label: "method", op: "=", value: "GET" }];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{method="GET"}');
    });

    it("should render multiple label filters", () => {
      const labels = [
        { label: "method", op: "=", value: "GET" },
        { label: "status", op: "=", value: "200" },
      ];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{method="GET",status="200"}');
    });

    it("should render regex label filters", () => {
      const labels = [{ label: "path", op: "=~", value: "/api.*" }];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{path=~"/api.*"}');
    });

    it("should render negative label filters", () => {
      const labels = [{ label: "status", op: "!=", value: "500" }];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{status!="500"}');
    });

    it("should render negative regex filters", () => {
      const labels = [{ label: "path", op: "!~", value: "/admin.*" }];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{path!~"/admin.*"}');
    });

    it("should escape quotes in values", () => {
      const labels = [{ label: "msg", op: "=", value: 'Error "critical"' }];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{msg="Error \\"critical\\""}');
    });

    it("should escape backslashes in values", () => {
      const labels = [{ label: "path", op: "=", value: "C:\\Users\\test" }];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{path="C:\\\\Users\\\\test"}');
    });

    it("should escape both backslashes and quotes", () => {
      const labels = [{ label: "path", op: "=", value: 'C:\\path\\"with\\"quotes' }];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{path="C:\\\\path\\\\\\"with\\\\\\"quotes"}');
    });

    it("should handle values with no special characters", () => {
      const labels = [{ label: "status", op: "=", value: "success" }];

      const result = promqlRenderer.renderLabels(labels);

      expect(result).toBe('{status="success"}');
    });

    it("should return empty string for empty labels", () => {
      const result = promqlRenderer.renderLabels([]);

      expect(result).toBe("");
    });
  });

  describe("Rate & range", () => {
    it("should render rate function", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.Rate, params: ["5m"] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("rate(http_requests_total{}[5m])");
    });

    it("should render irate function", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.Irate, params: ["5m"] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("irate(http_requests_total{}[5m])");
    });

    it("should render increase function", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.Increase, params: ["5m"] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("increase(http_requests_total{}[5m])");
    });

    it("should render avg_over_time function", () => {
      const query: PromqlBuilderQuery = {
        metric: "cpu_usage",
        labels: [],
        operations: [{ id: PromqlStepId.AvgOverTime, params: ["5m"] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("avg_over_time(cpu_usage{}[5m])");
    });

    it("should render quantile_over_time function", () => {
      const query: PromqlBuilderQuery = {
        metric: "response_time",
        labels: [],
        operations: [{ id: PromqlStepId.QuantileOverTime, params: [0.95, "5m"] }],
      };

      const result = promqlRenderer.renderQuery(query);

      // quantile_over_time takes the quantile first, then applies the range
      expect(result).toBe("quantile_over_time(0.95, response_time{}[5m])");
    });
  });

  describe("Aggregation", () => {
    it("should render sum without labels", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.Sum, params: [[]] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("sum(http_requests_total{})");
    });

    it("should render sum by single label", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.Sum, params: [["method"]] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("sum by (method) (http_requests_total{})");
    });

    it("should render sum by multiple labels", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.Sum, params: [["method", "status"]] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("sum by (method, status) (http_requests_total{})");
    });

    it("should render avg aggregation", () => {
      const query: PromqlBuilderQuery = {
        metric: "cpu_usage",
        labels: [],
        operations: [{ id: PromqlStepId.Avg, params: [["host"]] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("avg by (host) (cpu_usage{})");
    });

    it("should render topk with labels", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.TopK, params: [10, ["method"]] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("topk by (method) (10, http_requests_total{})");
    });

    it("should render topk without labels", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.TopK, params: [10, []] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("topk(10, http_requests_total{})");
    });

    it("should render quantile aggregation", () => {
      const query: PromqlBuilderQuery = {
        metric: "response_time",
        labels: [],
        operations: [{ id: PromqlStepId.Quantile, params: [0.99, []] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("quantile(0.99, response_time{})");
    });
  });

  describe("Scalar math", () => {
    it("should render addition operation", () => {
      const query: PromqlBuilderQuery = {
        metric: "memory_usage",
        labels: [],
        operations: [{ id: PromqlStepId.Addition, params: [100] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("memory_usage{} + 100");
    });

    it("should render subtraction operation", () => {
      const query: PromqlBuilderQuery = {
        metric: "total_requests",
        labels: [],
        operations: [{ id: PromqlStepId.Subtraction, params: [50] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("total_requests{} - 50");
    });

    it("should render multiplication operation", () => {
      const query: PromqlBuilderQuery = {
        metric: "bytes",
        labels: [],
        operations: [{ id: PromqlStepId.MultiplyBy, params: [2] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("bytes{} * 2");
    });

    it("should render division operation", () => {
      const query: PromqlBuilderQuery = {
        metric: "total_bytes",
        labels: [],
        operations: [{ id: PromqlStepId.DivideBy, params: [1024] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("total_bytes{} / 1024");
    });

    it("should render modulo operation", () => {
      const query: PromqlBuilderQuery = {
        metric: "counter",
        labels: [],
        operations: [{ id: PromqlStepId.Modulo, params: [10] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("counter{} % 10");
    });

    it("should render exponent operation", () => {
      const query: PromqlBuilderQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromqlStepId.Exponent, params: [2] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("value{} ^ 2");
    });
  });

  describe("Math", () => {
    it("should render abs function", () => {
      const query: PromqlBuilderQuery = {
        metric: "temperature",
        labels: [],
        operations: [{ id: PromqlStepId.Abs, params: [] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("abs(temperature{})");
    });

    it("should render ceil function", () => {
      const query: PromqlBuilderQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromqlStepId.Ceil, params: [] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("ceil(value{})");
    });

    it("should render floor function", () => {
      const query: PromqlBuilderQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromqlStepId.Floor, params: [] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("floor(value{})");
    });

    it("should render round function with parameter", () => {
      const query: PromqlBuilderQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromqlStepId.Round, params: [10] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("round(value{}, 10)");
    });

    it("should render sqrt function", () => {
      const query: PromqlBuilderQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromqlStepId.Sqrt, params: [] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("sqrt(value{})");
    });

    it("should render clamp function", () => {
      const query: PromqlBuilderQuery = {
        metric: "value",
        labels: [],
        operations: [{ id: PromqlStepId.Clamp, params: [0, 100] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("clamp(value{}, 0, 100)");
    });

    it("should render histogram_quantile", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_request_duration_seconds_bucket",
        labels: [],
        operations: [{ id: PromqlStepId.HistogramQuantile, params: [0.95] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("histogram_quantile(0.95, http_request_duration_seconds_bucket{})");
    });
  });

  describe("Trigonometric Functions", () => {
    it("should render sin function", () => {
      const query: PromqlBuilderQuery = {
        metric: "angle",
        labels: [],
        operations: [{ id: PromqlStepId.Sin, params: [] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("sin(angle{})");
    });

    it("should render cos function", () => {
      const query: PromqlBuilderQuery = {
        metric: "angle",
        labels: [],
        operations: [{ id: PromqlStepId.Cos, params: [] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("cos(angle{})");
    });

    it("should render tan function", () => {
      const query: PromqlBuilderQuery = {
        metric: "angle",
        labels: [],
        operations: [{ id: PromqlStepId.Tan, params: [] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("tan(angle{})");
    });
  });

  describe("Complex Queries", () => {
    it("should render query with metric and labels", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [
          { label: "method", op: "=", value: "GET" },
          { label: "status", op: "=", value: "200" },
        ],
        operations: [],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe('http_requests_total{method="GET",status="200"}');
    });

    it("should render chained operations", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [{ label: "method", op: "=", value: "GET" }],
        operations: [
          { id: PromqlStepId.Rate, params: ["5m"] },
          { id: PromqlStepId.Sum, params: [["status"]] },
        ],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe('sum by (status) (rate(http_requests_total{method="GET"}[5m]))');
    });

    it("should render complex multi-operation query", () => {
      const query: PromqlBuilderQuery = {
        metric: "node_memory_MemTotal_bytes",
        labels: [],
        operations: [
          { id: PromqlStepId.AvgOverTime, params: ["5m"] },
          { id: PromqlStepId.Sum, params: [["instance"]] },
          { id: PromqlStepId.DivideBy, params: [1048576] },
        ],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe(
        "sum by (instance) (avg_over_time(node_memory_MemTotal_bytes{}[5m])) / 1048576",
      );
    });

    it("should handle query with only metric name", () => {
      const query: PromqlBuilderQuery = {
        metric: "up",
        labels: [],
        operations: [],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("up{}");
    });

    it("should handle empty metric with labels", () => {
      const query: PromqlBuilderQuery = {
        metric: "",
        labels: [{ label: "__name__", op: "=", value: "up" }],
        operations: [],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe('{__name__="up"}');
    });
  });

  describe("Operation Definitions", () => {
    it("should get operation definition by id", () => {
      const opDef = promqlRenderer.getStepSpec(PromqlStepId.Rate);

      expect(opDef).toBeDefined();
      expect(opDef?.id).toBe(PromqlStepId.Rate);
      expect(opDef?.name).toBe("Rate");
    });

    it("should return undefined for unknown operation", () => {
      const opDef = promqlRenderer.getStepSpec("unknown_op");

      expect(opDef).toBeUndefined();
    });

    it("should get operations by category", () => {
      const ops = promqlRenderer.getStepsForGroup(PromqlStepGroup.RateAndRange);

      expect(ops.length).toBeGreaterThan(0);
      expect(ops.some((op) => op.id === PromqlStepId.Rate)).toBe(true);
    });

    it("should get all categories", () => {
      const categories = promqlRenderer.getGroups();

      expect(categories).toContain(PromqlStepGroup.RateAndRange);
      expect(categories).toContain(PromqlStepGroup.Aggregation);
      expect(categories).toContain(PromqlStepGroup.Math);
    });

    it("should get all operations", () => {
      const allOps = promqlRenderer.getAllSteps();

      expect(allOps.length).toBeGreaterThan(0);
      expect(allOps.some((op) => op.id === PromqlStepId.Rate)).toBe(true);
      expect(allOps.some((op) => op.id === PromqlStepId.Sum)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle operation with default params fallback", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [
          { id: PromqlStepId.Rate, params: [] }, // Empty params, should use default
        ],
      };

      const result = promqlRenderer.renderQuery(query);

      // Should use default step from operation definition
      expect(result).toContain("rate");
    });

    it("should handle aggregation with string labels (backward compat)", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.Sum, params: ["method,status"] as any }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("sum by (method, status) (http_requests_total{})");
    });

    it("should filter empty label names from aggregation", () => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: PromqlStepId.Sum, params: [["method", "", " "]] }],
      };

      const result = promqlRenderer.renderQuery(query);

      expect(result).toBe("sum by (method) (http_requests_total{})");
    });
  });

  describe("every step in the catalog renders", () => {
    // The renderer dispatches on a step's GROUP. Regrouping a step therefore
    // risks silently changing the PromQL it produces — and a step that lands in
    // a group with no branch would fall through and render as nothing at all.
    // This walks the whole catalog so no step can be added, or moved, without
    // someone having checked it still renders.
    it("produces a non-empty expression that mentions the metric", () => {
      const steps = buildPromqlStepCatalog();
      const unrenderable: string[] = [];

      for (const step of steps) {
        const rendered = promqlRenderer.renderQuery({
          metric: "m",
          labels: [],
          operations: [{ id: step.id, params: step.defaultParams }],
        });

        if (!rendered || !rendered.includes("m{}")) unrenderable.push(step.id);
      }

      expect(unrenderable).toEqual([]);
    });

    it.each([
      [PromqlStepId.Deg, "deg(m{})"],
      [PromqlStepId.Rad, "rad(m{})"],
    ])("renders %s as a plain function call after its regrouping", (id, expected) => {
      // deg/rad were moved from the Math group to Trigonometry. Neither group
      // has a branch in the renderer, so both must still fall through to the
      // plain `fn(expr)` form — the move is a picker concern, not a query one.
      expect(
        promqlRenderer.renderQuery({
          metric: "m",
          labels: [],
          operations: [{ id, params: [] }],
        }),
      ).toBe(expected);
    });
  });

  describe("panels saved under the previous scalar-math step ids", () => {
    // A dashboard persists `fields.promql_operations[].id` verbatim, so panels
    // saved before these steps were renamed still carry the old ids. They have
    // to keep rendering identically, or a saved panel silently loses its maths.
    const LEGACY_TO_OPERATOR: Array<[string, string]> = [
      ["__addition", "+"],
      ["__subtraction", "-"],
      ["__multiply_by", "*"],
      ["__divide_by", "/"],
      ["__modulo", "%"],
      ["__exponent", "^"],
    ];

    it.each(LEGACY_TO_OPERATOR)("renders a stored %s", (legacyId, operator) => {
      const query: PromqlBuilderQuery = {
        metric: "http_requests_total",
        labels: [],
        operations: [{ id: legacyId, params: [2] }],
      };

      expect(promqlRenderer.renderQuery(query)).toBe(`http_requests_total{} ${operator} 2`);
    });

    it("resolves a stored id to the same spec as its current id", () => {
      const legacy = promqlRenderer.getStepSpec("__multiply_by");
      const current = promqlRenderer.getStepSpec(PromqlStepId.MultiplyBy);

      expect(legacy).toBeDefined();
      expect(legacy).toBe(current);
    });

    it("renders a current id and a stored id identically", () => {
      const build = (id: string): PromqlBuilderQuery => ({
        metric: "m",
        labels: [],
        operations: [{ id, params: [3] }],
      });

      expect(promqlRenderer.renderQuery(build("__divide_by"))).toBe(
        promqlRenderer.renderQuery(build(PromqlStepId.DivideBy)),
      );
    });
  });
});
