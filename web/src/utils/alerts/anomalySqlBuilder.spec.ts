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
    expect(toDetectionFunctionSql("some_custom_fn", "col")).toBe(
      "some_custom_fn(col)",
    );
  });

  // ── Percentile functions (unwrapped form) ─────────────────────────────────

  it("converts p50 to approx_percentile_cont", () => {
    expect(toDetectionFunctionSql("p50", "duration")).toBe(
      "approx_percentile_cont(duration, 0.5)",
    );
  });

  it("converts p75 to approx_percentile_cont", () => {
    expect(toDetectionFunctionSql("p75", "duration")).toBe(
      "approx_percentile_cont(duration, 0.75)",
    );
  });

  it("converts p90 to approx_percentile_cont", () => {
    expect(toDetectionFunctionSql("p90", "duration")).toBe(
      "approx_percentile_cont(duration, 0.9)",
    );
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

  it("converts already-wrapped p90(duration) from API", () => {
    expect(toDetectionFunctionSql("p90(duration)", "*")).toBe(
      "approx_percentile_cont(duration, 0.9)",
    );
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
    expect(toDetectionFunctionSql("p50(bytes)", "*")).toBe(
      "approx_percentile_cont(bytes, 0.5)",
    );
  });

  // ── Case insensitivity ────────────────────────────────────────────────────

  it("handles uppercase P90", () => {
    expect(toDetectionFunctionSql("P90", "duration")).toBe(
      "approx_percentile_cont(duration, 0.9)",
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
    expect(toDetectionFunctionSql("p95", "")).toBe(
      "approx_percentile_cont(*, 0.95)",
    );
  });

  it("handles field with special characters", () => {
    expect(toDetectionFunctionSql("max", "end_time")).toBe("max(end_time)");
  });

  it("handles field with quotes", () => {
    expect(toDetectionFunctionSql("avg", '"end_time"')).toBe(
      'avg("end_time")',
    );
  });

  it("handles unknown percentile name like p99_9", () => {
    // only p50/p75/p90/p95/p99 are in the map
    expect(toDetectionFunctionSql("p99_9", "duration")).toBe(
      "p99_9(duration)",
    );
  });

  it("handles percentile with complex field expression", () => {
    expect(toDetectionFunctionSql("p90", "response_time_ms")).toBe(
      "approx_percentile_cont(response_time_ms, 0.9)",
    );
  });

  it("does not treat approx_percentile_cont as needing wrapping", () => {
    // If someone already sends the full function name, wrap it normally
    expect(
      toDetectionFunctionSql("approx_percentile_cont", "duration"),
    ).toBe("approx_percentile_cont(duration)");
  });

  // ── Match existing behavior in alertQueryBuilder.ts ───────────────────────

  it("matches alertQueryBuilder format for p90", () => {
    // alertQueryBuilder produces: approx_percentile_cont(column, 0.9)
    const result = toDetectionFunctionSql("p90", "duration");
    expect(result).toBe("approx_percentile_cont(duration, 0.9)");
  });

  it("matches alertQueryBuilder format for p99", () => {
    const result = toDetectionFunctionSql("p99", "latency");
    expect(result).toBe("approx_percentile_cont(latency, 0.99)");
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

  // ── count (no seasonality) ────────────────────────────────────────────────

  it("generates SQL with count(*) and no seasonality for short training window", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 3,
      histogram_interval: "5m",
    });
    expect(result).toContain("count(*) AS value");
    expect(result).toContain("histogram(_timestamp, '5m') AS time_bucket");
    expect(result).toContain("date_part('hour'");
    expect(result).not.toContain("dow");
    expect(result).toContain("FROM logs");
    expect(result).toContain("GROUP BY time_bucket, hour");
    expect(result).toContain("ORDER BY time_bucket");
  });

  it("generates SQL with seasonality (hour + dow) for training window >= 7 days", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "count",
      training_window_days: 14,
      histogram_interval: "10m",
    });
    expect(result).toContain("count(*) AS value");
    expect(result).toContain("dow");
    expect(result).toContain("GROUP BY time_bucket, hour, dow");
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
    expect(result).toContain(
      "approx_percentile_cont(duration, 0.95) AS value",
    );
  });

  it("generates SQL with p90 as approx_percentile_cont", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "metrics",
      detection_function: "p90",
      detection_function_field: "latency",
      training_window_days: 7,
      histogram_interval: "1m",
    });
    expect(result).toContain(
      "approx_percentile_cont(latency, 0.9) AS value",
    );
  });

  it("generates SQL with p99 as approx_percentile_cont", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "traces",
      detection_function: "p99",
      detection_function_field: "response_time",
      training_window_days: 30,
    });
    expect(result).toContain(
      "approx_percentile_cont(response_time, 0.99) AS value",
    );
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

  it("handles already-wrapped p90(duration) from API", () => {
    const result = buildAnomalyPreviewSql({
      query_mode: "filters",
      stream_name: "logs",
      detection_function: "p90(duration)",
      training_window_days: 7,
      histogram_interval: "10m",
    });
    expect(result).toContain(
      "approx_percentile_cont(duration, 0.9) AS value",
    );
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
