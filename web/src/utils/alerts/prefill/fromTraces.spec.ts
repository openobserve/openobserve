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

import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/locales";
import {
  ERROR_RATIO_MIN_SPANS,
  ERROR_RATIO_MIN_TRACES,
  buildPrefillFromTraces,
  buildTracesSeedQuery,
  tracesAlertPeriod,
  type TracesPrefillInput,
} from "./fromTraces";
import { isPrefillBlocked, normalizePrefill } from "../alertPrefill";
import { getAlertSource } from "../alertSourceRegistry";
import { resolveTracesFilter } from "@/utils/traces/resolveTracesFilter";

const base = (over: Partial<TracesPrefillInput> = {}): TracesPrefillInput => ({
  streamName: "default",
  filter: "service_name = 'api'",
  view: "spans",
  metric: "matches",
  datetime: { type: "relative", relativeTimePeriod: "15m" },
  ...over,
});

const warningKeys = (input: TracesPrefillInput, seed: number | null) =>
  buildPrefillFromTraces(input, seed).warnings.map((w) => w.key);

describe("buildTracesSeedQuery", () => {
  it("counts matching spans with no HAVING", () => {
    expect(buildTracesSeedQuery(base())).toEqual({
      sql: `SELECT count(*) AS matches FROM "default" WHERE service_name = 'api'`,
      valueColumn: "matches",
    });
  });

  it("counts spans for rate in the Spans view", () => {
    expect(buildTracesSeedQuery(base({ metric: "rate" })).sql).toBe(
      `SELECT count(*) AS spans FROM "default" WHERE service_name = 'api'`,
    );
  });

  it("counts distinct traces for rate in the Traces view", () => {
    expect(buildTracesSeedQuery(base({ metric: "rate", view: "traces" }))).toEqual({
      sql: `SELECT approx_distinct(trace_id) AS traces FROM "default" WHERE service_name = 'api'`,
      valueColumn: "traces",
    });
  });

  it("adds the error predicate to the filter for errors", () => {
    expect(buildTracesSeedQuery(base({ metric: "errors" })).sql).toBe(
      `SELECT count(*) AS errors FROM "default" WHERE (service_name = 'api') AND span_status = 'ERROR'`,
    );
    expect(buildTracesSeedQuery(base({ metric: "errors", view: "traces" })).sql).toBe(
      `SELECT approx_distinct(trace_id) AS errors FROM "default" WHERE (service_name = 'api') AND span_status = 'ERROR'`,
    );
  });

  it("reads the chosen percentile and the span count for duration", () => {
    expect(buildTracesSeedQuery(base({ metric: "duration", percentile: 0.99 }))).toEqual({
      sql: `SELECT approx_percentile_cont(duration, 0.99) AS p99_duration, count(*) AS spans FROM "default" WHERE service_name = 'api'`,
      valueColumn: "p99_duration",
    });
  });

  it("defaults duration to p95", () => {
    expect(buildTracesSeedQuery(base({ metric: "duration" })).valueColumn).toBe("p95_duration");
  });

  it("reads the error percentage and the span count for error_ratio in the Spans view", () => {
    expect(buildTracesSeedQuery(base({ metric: "error_ratio" }))).toEqual({
      sql: `SELECT CAST(SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS DOUBLE) * 100 / count(*) AS error_rate, count(*) AS spans FROM "default" WHERE service_name = 'api'`,
      valueColumn: "error_rate",
    });
  });

  it("reads the error-trace percentage over distinct traces in the Traces view", () => {
    expect(buildTracesSeedQuery(base({ metric: "error_ratio", view: "traces" })).sql).toBe(
      `SELECT CAST(approx_distinct(CASE WHEN span_status = 'ERROR' THEN trace_id END) AS DOUBLE) * 100 / approx_distinct(trace_id) AS error_rate, approx_distinct(trace_id) AS traces FROM "default" WHERE service_name = 'api'`,
    );
  });

  it("drops WHERE for an empty filter, keeping only the error predicate", () => {
    expect(buildTracesSeedQuery(base({ filter: "  " })).sql).toBe(
      `SELECT count(*) AS matches FROM "default"`,
    );
    expect(buildTracesSeedQuery(base({ filter: "", metric: "errors" })).sql).toBe(
      `SELECT count(*) AS errors FROM "default" WHERE span_status = 'ERROR'`,
    );
  });

  it("escapes double quotes in the stream name", () => {
    expect(buildTracesSeedQuery(base({ streamName: 'we"ird', filter: "" })).sql).toBe(
      `SELECT count(*) AS matches FROM "we""ird"`,
    );
  });
});

describe("buildPrefillFromTraces", () => {
  it("puts the threshold at 1.5× the seed, rounded up, inside HAVING", () => {
    const p = buildPrefillFromTraces(base(), 721);
    expect(p.sql).toBe(
      `SELECT count(*) AS matches FROM "default" WHERE service_name = 'api' HAVING count(*) > 1082`,
    );
    expect(p.meta).toMatchObject({ seed: 721, threshold: 1082, metric: "matches" });
  });

  it("thresholds rate in the Traces view on distinct traces", () => {
    expect(buildPrefillFromTraces(base({ metric: "rate", view: "traces" }), 100).sql).toBe(
      `SELECT approx_distinct(trace_id) AS traces FROM "default" WHERE service_name = 'api' HAVING approx_distinct(trace_id) > 150`,
    );
  });

  it("thresholds rate in the Spans view on spans", () => {
    expect(buildPrefillFromTraces(base({ metric: "rate" }), 100).sql).toBe(
      `SELECT count(*) AS spans FROM "default" WHERE service_name = 'api' HAVING count(*) > 150`,
    );
  });

  it("thresholds errors per view", () => {
    expect(buildPrefillFromTraces(base({ metric: "errors" }), 720).sql).toBe(
      `SELECT count(*) AS errors FROM "default" WHERE (service_name = 'api') AND span_status = 'ERROR' HAVING count(*) > 1080`,
    );
    expect(buildPrefillFromTraces(base({ metric: "errors", view: "traces" }), 10).sql).toBe(
      `SELECT approx_distinct(trace_id) AS errors FROM "default" WHERE (service_name = 'api') AND span_status = 'ERROR' HAVING approx_distinct(trace_id) > 15`,
    );
  });

  it("thresholds duration in µs with a minimum-traffic guard", () => {
    const p = buildPrefillFromTraces(base({ metric: "duration", percentile: 0.95 }), 176976);
    expect(p.sql).toBe(
      `SELECT approx_percentile_cont(duration, 0.95) AS p95_duration, count(*) AS spans FROM "default" WHERE service_name = 'api' HAVING approx_percentile_cont(duration, 0.95) > 265464 AND count(*) >= 20`,
    );
  });

  it("thresholds error_ratio in percent with a span-traffic guard", () => {
    expect(ERROR_RATIO_MIN_SPANS).toBe(100);
    const p = buildPrefillFromTraces(base({ metric: "error_ratio" }), 2);
    expect(p.sql).toBe(
      `SELECT CAST(SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS DOUBLE) * 100 / count(*) AS error_rate, count(*) AS spans FROM "default" WHERE service_name = 'api' HAVING CAST(SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS DOUBLE) * 100 / count(*) > 3 AND count(*) >= 100`,
    );
    expect(p.meta).toMatchObject({
      metric: "error_ratio",
      valueColumn: "error_rate",
      threshold: 3,
    });
    expect(p.name).toBe("traces_default_error_rate");
  });

  it("thresholds error_ratio on distinct traces with a trace-traffic guard", () => {
    expect(ERROR_RATIO_MIN_TRACES).toBe(20);
    const sql = buildPrefillFromTraces(base({ metric: "error_ratio", view: "traces" }), 4).sql;
    expect(sql).toMatch(
      / HAVING CAST\(approx_distinct\(CASE WHEN span_status = 'ERROR' THEN trace_id END\) AS DOUBLE\) \* 100 \/ approx_distinct\(trace_id\) > 6 AND approx_distinct\(trace_id\) >= 20$/,
    );
  });

  it("caps the error_ratio threshold below 100 percent so the alert can still fire", () => {
    const p = buildPrefillFromTraces(base({ metric: "error_ratio" }), 80);
    expect(p.meta?.threshold).toBe(99);
    expect(p.sql).toContain("> 99 AND count(*) >= 100");
  });

  it("seeds error_ratio 0 as threshold 0, still behind the traffic guard", () => {
    const p = buildPrefillFromTraces(base({ metric: "error_ratio" }), 0);
    expect(p.sql).toMatch(/ > 0 AND count\(\*\) >= 100$/);
    expect(p.warnings.map((w) => w.key)).toContain("tracesNoMatches");
  });

  it("states the error_ratio seed in percent and notes the traffic guard", () => {
    const p = buildPrefillFromTraces(base({ metric: "error_ratio" }), 2);
    expect(p.warnings).toContainEqual({
      key: "tracesSeedErrorRatio",
      level: "info",
      params: { minutes: 15, threshold: "3.0", current: "2.0" },
    });
    expect(p.warnings).toContainEqual({
      key: "tracesErrorRatioMinSpans",
      level: "info",
      params: { minimum: 100 },
    });
    expect(
      buildPrefillFromTraces(base({ metric: "error_ratio", view: "traces" }), 2).warnings,
    ).toContainEqual({ key: "tracesErrorRatioMinTraces", level: "info", params: { minimum: 20 } });
  });

  it("uses the same SQL in both views for duration", () => {
    const spans = buildPrefillFromTraces(base({ metric: "duration", percentile: 0.5 }), 1000);
    const traces = buildPrefillFromTraces(
      base({ metric: "duration", percentile: 0.5, view: "traces" }),
      1000,
    );
    expect(traces.sql).toBe(spans.sql);
    expect(spans.sql).toContain("approx_percentile_cont(duration, 0.5) AS p50_duration");
  });

  it("carries a duration filter resolved to µs by the shared helper", async () => {
    const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
    const parser = new mod.default.Parser();
    const filter = resolveTracesFilter("duration > '500ms'", parser, "default");
    const p = buildPrefillFromTraces(base({ filter }), 4);
    expect(p.sql).toBe(
      `SELECT count(*) AS matches FROM "default" WHERE duration > 500000 HAVING count(*) > 6`,
    );
  });

  it("omits WHERE for an empty filter", () => {
    expect(buildPrefillFromTraces(base({ filter: "" }), 2).sql).toBe(
      `SELECT count(*) AS matches FROM "default" HAVING count(*) > 3`,
    );
  });

  it("seeds 0 as threshold 0 and says no spans match yet", () => {
    const p = buildPrefillFromTraces(base({ metric: "errors" }), 0);
    expect(p.sql).toMatch(/HAVING count\(\*\) > 0$/);
    expect(p.warnings).toContainEqual({ key: "tracesNoMatches", level: "info" });
  });

  it("treats a missing seed as 0 and warns that it could not be read", () => {
    const p = buildPrefillFromTraces(base(), null);
    expect(p.sql).toMatch(/HAVING count\(\*\) > 0$/);
    expect(p.warnings.map((w) => w.key)).toContain("tracesSeedUnavailable");
    expect(p.warnings.map((w) => w.key)).not.toContain("tracesNoMatches");
  });

  it("states the seed in the chart's terms", () => {
    expect(buildPrefillFromTraces(base({ metric: "errors" }), 720).warnings).toContainEqual({
      key: "tracesSeedErrorSpans",
      level: "info",
      params: { minutes: 15, threshold: "1,080", current: "720" },
    });
    expect(warningKeys(base({ metric: "errors", view: "traces" }), 5)).toContain(
      "tracesSeedErrorTraces",
    );
    expect(warningKeys(base({ metric: "rate", view: "traces" }), 5)).toContain("tracesSeedTraces");
    expect(warningKeys(base({ metric: "rate" }), 5)).toContain("tracesSeedSpans");
    expect(warningKeys(base(), 5)).toContain("tracesSeedMatches");
  });

  it("states a duration seed in milliseconds", () => {
    const p = buildPrefillFromTraces(base({ metric: "duration", percentile: 0.95 }), 176976);
    expect(p.warnings).toContainEqual({
      key: "tracesSeedDuration",
      level: "info",
      params: { percentile: "p95", minutes: 15, threshold: "265", current: "177" },
    });
  });

  it("keeps sub-10 ms durations to two decimals", () => {
    const p = buildPrefillFromTraces(base({ metric: "duration", percentile: 0.5 }), 1500);
    expect(p.warnings).toContainEqual(
      expect.objectContaining({
        key: "tracesSeedDuration",
        params: { percentile: "p50", minutes: 15, threshold: "2.25", current: "1.5" },
      }),
    );
  });

  it("always notes that counts are of stored spans", () => {
    expect(warningKeys(base(), 5)).toContain("tracesStoredSpans");
  });

  it("fills the alert schedule and fires on one returned row", () => {
    const p = buildPrefillFromTraces(base(), 5);
    expect(p).toMatchObject({
      source: "traces",
      streamType: "traces",
      streamName: "default",
      queryType: "sql",
      periodMinutes: 15,
      frequencyMinutes: 5,
      silenceMinutes: 10,
      thresholdShape: "count",
      triggerThreshold: 1,
      triggerOperator: ">=",
    });
    expect(p.name).toBe("traces_default_matches");
  });

  it("never selects *", () => {
    for (const metric of ["matches", "rate", "errors", "duration", "error_ratio"] as const) {
      expect(buildPrefillFromTraces(base({ metric }), 3).sql).not.toMatch(/select\s+\*/i);
    }
  });

  it("blocks without a stream instead of throwing", () => {
    const p = normalizePrefill(buildPrefillFromTraces(base({ streamName: "" }), 3));
    expect(isPrefillBlocked(p)).toBe(true);
  });

  it("produces an unblocked prefill for a healthy input", () => {
    expect(isPrefillBlocked(normalizePrefill(buildPrefillFromTraces(base(), 3)))).toBe(false);
  });
});

describe("tracesAlertPeriod", () => {
  it("uses the page range when it is an hour or less", () => {
    expect(tracesAlertPeriod({ type: "relative", relativeTimePeriod: "30m" })).toEqual({
      minutes: 30,
      warnings: [],
    });
  });

  it("raises a window shorter than the run frequency to the frequency", () => {
    expect(tracesAlertPeriod({ type: "relative", relativeTimePeriod: "1m" })).toEqual({
      minutes: 5,
      warnings: [],
    });
  });

  it("states the raised window for a short absolute range", () => {
    const { minutes, warnings } = tracesAlertPeriod({
      type: "absolute",
      startTime: 60 * 60 * 1_000_000,
      endTime: 62 * 60 * 1_000_000,
    });
    expect(minutes).toBe(5);
    expect(warnings).toEqual([
      { key: "absoluteToRolling", level: "warning", params: { minutes: 5 } },
    ]);
  });

  it("caps the window at 60 minutes and warns", () => {
    const { minutes, warnings } = tracesAlertPeriod({
      type: "relative",
      relativeTimePeriod: "24h",
    });
    expect(minutes).toBe(60);
    expect(warnings).toEqual([
      { key: "tracesPeriodCapped", level: "warning", params: { minutes: 60 } },
    ]);
  });

  it("states the capped window for an absolute range", () => {
    const hour = 60 * 60 * 1_000_000;
    const { minutes, warnings } = tracesAlertPeriod({
      type: "absolute",
      startTime: hour,
      endTime: 4 * hour,
    });
    expect(minutes).toBe(60);
    expect(warnings).toContainEqual({
      key: "absoluteToRolling",
      level: "warning",
      params: { minutes: 60 },
    });
    expect(warnings.map((w) => w.key)).toContain("tracesPeriodCapped");
  });

  it("feeds the capped window into the prefill", () => {
    const p = buildPrefillFromTraces(
      base({ datetime: { type: "relative", relativeTimePeriod: "7d" } }),
      1,
    );
    expect(p.periodMinutes).toBe(60);
    expect(p.warnings.map((w) => w.key)).toContain("tracesPeriodCapped");
  });
});

describe("traces alert source and text", () => {
  let t: (key: string) => string;
  beforeAll(() => {
    t = (key) => i18n.global.t(key);
  });

  it("is registered with a count threshold", () => {
    const source = getAlertSource("traces");
    expect(source.id).toBe("traces");
    expect(source.defaultThreshold).toBe("count");
    expect(t(source.labelKey)).toBe("Create alert");
    expect(t(source.toastKey)).toBe("Query imported from your traces search");
  });

  it("has English text for every warning it emits", () => {
    const keys = new Set<string>();
    const inputs: [TracesPrefillInput, number | null][] = [
      [base(), 0],
      [base(), null],
      [base({ metric: "rate" }), 1],
      [base({ metric: "rate", view: "traces" }), 1],
      [base({ metric: "errors" }), 1],
      [base({ metric: "errors", view: "traces" }), 1],
      [base({ metric: "error_ratio" }), 1],
      [base({ metric: "error_ratio", view: "traces" }), 1],
      [base({ metric: "duration", datetime: { type: "relative", relativeTimePeriod: "2h" } }), 1],
    ];
    for (const [input, seed] of inputs) {
      buildPrefillFromTraces(input, seed).warnings.forEach((w) => keys.add(w.key));
    }
    for (const key of keys) {
      const path = `alerts.prefill.warnings.${key}`;
      expect(t(path), key).not.toBe(path);
    }
  });

  it("has a pick-a-stream reason", () => {
    const path = "alerts.prefill.sources.traces.noStream";
    expect(t(path)).toBe("Pick a stream first");
  });
});
