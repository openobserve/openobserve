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
import {
  anomalyWhereClause,
  toDetectionFunctionSql,
  buildAnomalyPreviewSql,
} from "./anomalySqlBuilder";

// ─── toDetectionFunctionSql ──────────────────────────────────────────────────

describe("toDetectionFunctionSql", () => {
  // ── Non-percentile functions ──────────────────────────────────────────────

  it("converts count to count(*)", () => {
    expect(toDetectionFunctionSql("count", "duration")).toBe("count(*)");
  });

  it("wraps avg with field", () => {
    expect(toDetectionFunctionSql("avg", "duration")).toBe("avg(duration)");
  });

  it("wraps sum with field", () => {
    expect(toDetectionFunctionSql("sum", "bytes")).toBe("sum(bytes)");
  });

  it("wraps min with field", () => {
    expect(toDetectionFunctionSql("min", "latency")).toBe("min(latency)");
  });

  it("wraps max with field", () => {
    expect(toDetectionFunctionSql("max", "latency")).toBe("max(latency)");
  });

  it("wraps unknown function with field", () => {
    expect(toDetectionFunctionSql("some_custom_fn", "col")).toBe("some_custom_fn(col)");
  });

  // ── Percentile functions (unwrapped form) ─────────────────────────────────

  it("converts p50 to approx_percentile_cont", () => {
    expect(toDetectionFunctionSql("p50", "duration")).toBe("approx_percentile_cont(duration, 0.5)");
  });

  // p75/p90 are not DetectionFunction variants, so they must not expand into a query the API rejects.
  it("leaves p75 unexpanded — the backend has no such detection function", () => {
    expect(toDetectionFunctionSql("p75", "duration")).toBe("p75(duration)");
  });

  it("leaves p90 unexpanded — the backend has no such detection function", () => {
    expect(toDetectionFunctionSql("p90", "duration")).toBe("p90(duration)");
  });

  it("converts p95 to approx_percentile_cont", () => {
    expect(toDetectionFunctionSql("p95", "duration")).toBe(
      "approx_percentile_cont(duration, 0.95)",
    );
  });

  it("converts p99 to approx_percentile_cont", () => {
    expect(toDetectionFunctionSql("p99", "duration")).toBe(
      "approx_percentile_cont(duration, 0.99)",
    );
  });

  // ── Already-wrapped forms (API returns parenthesized) ─────────────────────

  it("leaves an already-wrapped p90(duration) alone", () => {
    expect(toDetectionFunctionSql("p90(duration)", "*")).toBe("p90(duration)");
  });

  it("converts already-wrapped p95(latency) from API", () => {
    expect(toDetectionFunctionSql("p95(latency)", "*")).toBe(
      "approx_percentile_cont(latency, 0.95)",
    );
  });

  it("passes through already-wrapped non-percentile avg(field) from API", () => {
    expect(toDetectionFunctionSql("avg(size)", "*")).toBe("avg(size)");
  });

  it("passes through already-wrapped count(*) from API", () => {
    expect(toDetectionFunctionSql("count(*)", "anything")).toBe("count(*)");
  });

  it("passes through already-wrapped sum(amount) from API", () => {
    expect(toDetectionFunctionSql("sum(amount)", "*")).toBe("sum(amount)");
  });

  it("converts already-wrapped p50(bytes) from API", () => {
    expect(toDetectionFunctionSql("p50(bytes)", "*")).toBe("approx_percentile_cont(bytes, 0.5)");
  });

  // ── Case insensitivity ────────────────────────────────────────────────────

  it("handles uppercase P99", () => {
    expect(toDetectionFunctionSql("P99", "duration")).toBe(
      "approx_percentile_cont(duration, 0.99)",
    );
  });

  it("handles mixed-case P95(Duration) from API", () => {
    expect(toDetectionFunctionSql("P95(Duration)", "*")).toBe(
      "approx_percentile_cont(Duration, 0.95)",
    );
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("falls back to * when field is empty", () => {
    expect(toDetectionFunctionSql("avg", "")).toBe("avg(*)");
  });

  it("uses * when field is missing for percentile", () => {
    expect(toDetectionFunctionSql("p95", "")).toBe("approx_percentile_cont(*, 0.95)");
  });

  it("handles field with special characters", () => {
    expect(toDetectionFunctionSql("max", "end_time")).toBe("max(end_time)");
  });

  it("handles field with quotes", () => {
    expect(toDetectionFunctionSql("avg", '"end_time"')).toBe('avg("end_time")');
  });

  it("handles unknown percentile name like p99_9", () => {
    // only p50/p95/p99 are in the map
    expect(toDetectionFunctionSql("p99_9", "duration")).toBe("p99_9(duration)");
  });

  it("handles percentile with complex field expression", () => {
    expect(toDetectionFunctionSql("p95", "response_time_ms")).toBe(
      "approx_percentile_cont(response_time_ms, 0.95)",
    );
  });

  it("does not treat approx_percentile_cont as needing wrapping", () => {
    // If someone already sends the full function name, wrap it normally
    expect(toDetectionFunctionSql("approx_percentile_cont", "duration")).toBe(
      "approx_percentile_cont(duration)",
    );
  });

  // ── Match existing behavior in alertQueryBuilder.ts ───────────────────────

  it("matches alertQueryBuilder format for p95", () => {
    // alertQueryBuilder produces: approx_percentile_cont(column, 0.95)
    const result = toDetectionFunctionSql("p95", "duration");
    expect(result).toBe("approx_percentile_cont(duration, 0.95)");
  });

  it("matches alertQueryBuilder format for p99", () => {
    const result = toDetectionFunctionSql("p99", "latency");
    expect(result).toBe("approx_percentile_cont(latency, 0.99)");
  });
});

// ─── Detection function coverage ─────────────────────────────────────────────

// The backend DetectionFunction enum is the contract; a name the dropdown cannot
// offer must never be expanded into SQL, or the preview would show a query the
// API rejects on save.
describe("detection function coverage", () => {
  const BACKEND_PERCENTILES: Record<string, string> = {
    p50: "0.5",
    p95: "0.95",
    p99: "0.99",
  };

  it.each(Object.entries(BACKEND_PERCENTILES))(
    "expands %s, which the backend accepts",
    (fn, fraction) => {
      expect(toDetectionFunctionSql(fn, "duration")).toBe(
        `approx_percentile_cont(duration, ${fraction})`,
      );
    },
  );

  it.each(["p25", "p75", "p90", "p999"])(
    "leaves %s unexpanded, since the backend rejects it",
    (fn) => {
      expect(toDetectionFunctionSql(fn, "duration")).toBe(`${fn}(duration)`);
    },
  );

  it.each(["count", "avg", "sum", "min", "max"])("passes %s through as a plain aggregate", (fn) => {
    const expected = fn === "count" ? "count(*)" : `${fn}(duration)`;
    expect(toDetectionFunctionSql(fn, "duration")).toBe(expected);
  });
});

// ─── buildAnomalyPreviewSql ─────────────────────────────────────────────────

describe("buildAnomalyPreviewSql", () => {
  // ── Empty / no config ─────────────────────────────────────────────────────

  it("returns empty string for null config", () => {
    expect(buildAnomalyPreviewSql(null)).toBe("");
  });

  it("returns empty string for undefined config", () => {
    expect(buildAnomalyPreviewSql(undefined)).toBe("");
  });

  it("returns empty string for empty object", () => {
    expect(buildAnomalyPreviewSql({})).toBe("");
  });

  // ── custom_sql mode ───────────────────────────────────────────────────────

  it("returns user SQL for custom_sql mode", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "custom_sql",
      custom_sql: "SELECT * FROM logs WHERE status = 500",
    });
    expect(result).toBe("SELECT * FROM logs WHERE status = 500");
  });

  it("returns empty string for custom_sql with no SQL", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "custom_sql",
    });
    expect(result).toBe("");
  });

  // ── Missing stream name ───────────────────────────────────────────────────

  it("returns empty string when no stream_name", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      detection_function: "count",
    });
    expect(result).toBe("");
  });

  // ── count ─────────────────────────────────────────────────────────────────

  it("generates SQL with count(*) grouped by the time bucket alone", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 3,
      histogram_interval: "5m",
    });
    expect(result).toContain("count(*) AS value");
    expect(result).toContain("histogram(_timestamp, '5m') AS time_bucket");
    expect(result).toContain("FROM logs");
    expect(result).toContain("GROUP BY time_bucket\n");
    expect(result).toContain("ORDER BY time_bucket");
  });

  // The backend training query no longer selects hour/dow, so neither may the preview.
  it("adds no seasonality columns at any training window", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 14,
      histogram_interval: "10m",
    });
    expect(result).toContain("count(*) AS value");
    expect(result).not.toContain("date_part");
    expect(result).not.toContain("dow");
    expect(result).toContain("GROUP BY time_bucket\n");
  });

  // ── Default function when none provided ──────────────────────────────────

  it("defaults to count when detection_function is missing", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      training_window_days: 1,
    });
    expect(result).toContain("count(*) AS value");
  });

  // ── Percentile functions ──────────────────────────────────────────────────

  it("generates SQL with p95 as approx_percentile_cont", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "p95",
      detection_function_field: "duration",
      training_window_days: 14,
      histogram_interval: "5m",
    });
    expect(result).toContain("approx_percentile_cont(duration, 0.95) AS value");
  });

  it("generates SQL with p50 as approx_percentile_cont", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "metrics",
      detection_function: "p50",
      detection_function_field: "latency",
      training_window_days: 7,
      histogram_interval: "1m",
    });
    expect(result).toContain("approx_percentile_cont(latency, 0.5) AS value");
  });

  it("generates SQL with p99 as approx_percentile_cont", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "traces",
      detection_function: "p99",
      detection_function_field: "response_time",
      training_window_days: 30,
    });
    expect(result).toContain("approx_percentile_cont(response_time, 0.99) AS value");
  });

  // ── Regular aggregation functions ─────────────────────────────────────────

  it("generates SQL with avg aggregation", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "metrics",
      detection_function: "avg",
      detection_function_field: "cpu_usage",
      training_window_days: 1,
    });
    expect(result).toContain("avg(cpu_usage) AS value");
  });

  it("generates SQL with sum aggregation", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "billing",
      detection_function: "sum",
      detection_function_field: "cost",
      training_window_days: 14,
    });
    expect(result).toContain("sum(cost) AS value");
  });

  // ── Filters ───────────────────────────────────────────────────────────────

  it("includes filter expressions in WHERE clause", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 1,
      filters: [
        { field: "status", operator: "=", value: "500" },
        { field: "method", operator: "=", value: "POST" },
      ],
    });
    expect(result).toContain("WHERE");
    expect(result).toContain("status = '500'");
    expect(result).toContain("method = 'POST'");
  });

  it("skips filters with empty fields", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 1,
      filters: [
        { field: "", operator: "=", value: "500" },
        { field: "status", operator: "=", value: "200" },
      ],
    });
    expect(result).toContain("status = '200'");
    // should not have empty-field filter
    expect(result).not.toContain("= '500'");
  });

  it("handles no filters at all", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 1,
    });
    expect(result).not.toContain("WHERE");
  });

  // ── Histogram interval formats ────────────────────────────────────────────

  it("uses combined histogram_interval format", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 1,
      histogram_interval: "15m",
    });
    expect(result).toContain("histogram(_timestamp, '15m')");
  });

  it("composes histogram_interval from value + unit", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 1,
      histogram_interval_value: 30,
      histogram_interval_unit: "m",
    });
    expect(result).toContain("histogram(_timestamp, '30m')");
  });

  it("defaults histogram interval to 5m", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 1,
    });
    expect(result).toContain("histogram(_timestamp, '5m')");
  });

  // ── Already-wrapped function from API ─────────────────────────────────────

  it("handles already-wrapped count(*) from API", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count(*)",
      training_window_days: 1,
      histogram_interval: "5m",
    });
    expect(result).toContain("count(*) AS value");
  });

  it("handles already-wrapped p99(duration) from API", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "p99(duration)",
      training_window_days: 7,
      histogram_interval: "10m",
    });
    expect(result).toContain("approx_percentile_cont(duration, 0.99) AS value");
  });

  // ── Full SQL structure ────────────────────────────────────────────────────

  it("produces SQL starting with SELECT histogram", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 1,
    });
    expect(result).toMatch(/^SELECT histogram/);
  });

  it("ends with ORDER BY time_bucket", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 1,
    });
    expect(result).toMatch(/ORDER BY time_bucket$/m);
  });
});

describe("anomalyWhereClause", () => {
  const leaf = (column: string, operator: string, value: unknown, logicalOperator = "AND") => ({
    filterType: "condition",
    column,
    operator,
    value,
    logicalOperator,
  });
  const group = (conditions: unknown[], logicalOperator = "AND") => ({
    filterType: "group",
    logicalOperator,
    conditions,
  });

  it("renders saved rows exactly as main did", () => {
    const rows = [
      { field: "level", operator: "=", value: "error" },
      { field: "", operator: "=", value: "x" },
      { field: "code", operator: "IN", value: "'a', 'b'" },
      { field: "msg", operator: "Contains", value: "" },
      { field: "host", operator: "Is Null", value: "" },
    ];
    expect(anomalyWhereClause(rows)).toBe(
      "WHERE\n  level = 'error'\n  AND code IN ('a', 'b')\n  AND host IS NULL",
    );
  });

  it("reads null, undefined and a non-object as no WHERE", () => {
    expect(anomalyWhereClause(null)).toBe("");
    expect(anomalyWhereClause(undefined)).toBe("");
    expect(anomalyWhereClause("level = 'error'")).toBe("");
  });

  it("renders an AND-only V2 group one part per line", () => {
    const filters = group([
      leaf("level", "=", "error"),
      leaf("code", "!=", 500),
      leaf("host", "is_null", null),
    ]);
    expect(anomalyWhereClause(filters)).toBe(
      "WHERE\n  level = 'error'\n  AND code <> '500'\n  AND host IS NULL",
    );
  });

  it("renders OR and nested groups with parentheses", () => {
    const filters = group([
      leaf("a", "=", "1"),
      leaf("b", "=", "2", "OR"),
      group([leaf("c", "=", "3"), leaf("d", "=", "4", "OR")], "OR"),
    ]);
    expect(anomalyWhereClause(filters)).toBe(
      "WHERE\n  a = '1'\n  OR b = '2'\n  OR (c = '3' OR d = '4')",
    );
  });

  it.each([
    ["contains", "x", false, "str_match(f, 'x')"],
    ["contains", "x", true, "str_match_ignore_case(f, 'x')"],
    ["Contains", "x", true, "str_match_ignore_case(f, 'x')"],
    ["not_contains", "x", false, "f NOT LIKE '%x%'"],
    ["Not Contains", "x", false, "f NOT LIKE '%x%'"],
    ["in", ["a", "b"], false, "f IN ('a', 'b')"],
    ["not_in", '["a"]', false, "f NOT IN ('a')"],
    ["IN", ["a"], false, "f IN ('a')"],
    ["starts_with", "x", false, "f LIKE 'x%'"],
    ["ends_with", "x", false, "f LIKE '%x'"],
    ["regex", "^a", false, "re_match(f, '^a')"],
    ["not_regex", "^a", false, "re_not_match(f, '^a')"],
    ["IsNotNull", null, false, "f IS NOT NULL"],
  ])("maps the engine operator %s", (operator, value, caseInsensitive, expected) => {
    const filters = group([{ ...leaf("f", operator, value), case_insensitive: caseInsensitive }]);
    expect(anomalyWhereClause(filters)).toBe(`WHERE\n  ${expected}`);
  });

  it("skips leaves it cannot render and the connector before them", () => {
    const filters = group([
      leaf("a", "is_empty", null),
      leaf("b", "=", "2", "OR"),
      group([]),
      leaf("c", "in", []),
    ]);
    expect(anomalyWhereClause(filters)).toBe("WHERE\n  b = '2'");
  });

  it("builds the preview from an API-written V2 group instead of throwing", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      histogram_interval: "5m",
      filters: group([leaf("level", "=", "error"), leaf("code", ">", "499")]),
    });
    expect(result).toContain("WHERE\n  level = 'error'\n  AND code > '499'\n");
  });

  it("builds the preview with an OR group instead of dropping it", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      histogram_interval: "5m",
      filters: group([leaf("a", "=", "1"), leaf("b", "=", "2", "OR")]),
    });
    expect(result).toContain("FROM logs\nWHERE\n  a = '1'\n  OR b = '2'\nGROUP BY");
  });
});
