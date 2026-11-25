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
import { NULL_BREAKDOWN_VALUE, OTHERS_BREAKDOWN_VALUE } from "@/utils/dashboard/sqlProcessData";
import {
  correlationConfigured,
  fieldPredicate,
  filtersWhere,
  funnelStageQuery,
  isTimeXField,
  logsAvailability,
  metricsAvailability,
  pointFamily,
  pointGroupFilters,
  promqlDurationUs,
  promqlLookBackUs,
  promqlMetricName,
  promqlPointWindow,
  promqlSelectorOffsetsUs,
  seriesLabelFilters,
  sliceBounds,
  tracesAvailability,
  tracesPageQuery,
  treeOpensPointMenu,
} from "./chartPointExplore";

const builder = (alias: string, field: string, extra: Record<string, unknown> = {}) => ({
  alias,
  args: [{ type: "field", value: { field } }],
  ...extra,
});
const histogramX = builder("x_axis_1", "_timestamp", { functionName: "histogram" });

describe("pointFamily", () => {
  it.each([
    ["line", true, "time"],
    ["area-stacked", true, "time"],
    ["bar", true, "time"],
    ["scatter", true, "time"],
    ["bar", false, "category"],
    ["h-bar", true, "time"],
    ["h-stacked", false, "category"],
    ["pie", false, "category"],
    ["donut", true, "category"],
    ["treemap", false, "category"],
    ["sunburst", false, "category"],
    ["funnel", false, "category"],
    ["heatmap", true, "heatmap"],
    ["metric", true, null],
    ["gauge", false, null],
    ["bar-gauge", false, null],
    ["table", false, null],
    ["sankey", false, null],
    ["custom_chart", false, null],
    ["hostmap", false, null],
    ["geomap", false, null],
    ["state-timeline", true, null],
  ])("%s with a time axis %s is %s", (type, timeAxis, family) => {
    expect(pointFamily(type, timeAxis)).toBe(family);
  });
});

describe("isTimeXField", () => {
  it("is a histogram or a raw read of the timestamp column, never another function", () => {
    expect(isTimeXField(histogramX, "_timestamp")).toBe(true);
    expect(isTimeXField(builder("x", "_timestamp"), "_timestamp")).toBe(true);
    expect(
      isTimeXField(builder("x", "_timestamp", { functionName: "date_part" }), "_timestamp"),
    ).toBe(false);
    expect(isTimeXField(builder("x", "service"), "_timestamp")).toBe(false);
  });
});

describe("pointGroupFilters", () => {
  const line = { type: "line", config: {} };

  it("time chart: the clicked series' breakdown value, never the time bucket", () => {
    const query = { fields: { x: [histogramX], breakdown: [builder("breakdown_1", "service")] } };
    expect(pointGroupFilters(query, line, "time", { name: "t", seriesValue: "cart" }, [])).toEqual([
      { field: "service", value: "cart" },
    ]);
  });

  it("time chart without a breakdown has no group filters", () => {
    const query = { fields: { x: [histogramX], breakdown: [] } };
    expect(pointGroupFilters(query, line, "time", { seriesValue: undefined }, [])).toEqual([]);
  });

  it("category bar: the x category and the breakdown value, typed from the rows", () => {
    const query = {
      fields: { x: [builder("x_axis_1", "status")], breakdown: [builder("breakdown_1", "region")] },
    };
    const rows = [{ x_axis_1: 500, breakdown_1: "eu", y_axis_1: 3 }];
    expect(
      pointGroupFilters(
        query,
        { type: "bar" },
        "category",
        { name: "500", seriesValue: "eu" },
        rows,
      ),
    ).toEqual([
      { field: "status", value: 500 },
      { field: "region", value: "eu" },
    ]);
  });

  it("pie: the clicked slice; an empty slice is a null value", () => {
    const query = { fields: { x: [builder("x_axis_1", "service")], breakdown: [] } };
    const pie = { type: "pie" };
    expect(pointGroupFilters(query, pie, "category", { name: "cart" }, [])).toEqual([
      { field: "service", value: "cart" },
    ]);
    expect(pointGroupFilters(query, pie, "category", { name: "" }, [])).toEqual([
      { field: "service", value: null },
    ]);
  });

  it("treemap and sunburst: every level of the clicked tile's path", () => {
    const query = {
      fields: { x: [builder("x_axis_1", "namespace")], breakdown: [builder("b", "service")] },
    };
    for (const type of ["treemap", "sunburst"]) {
      expect(
        pointGroupFilters(query, { type }, "category", { path: ["checkout", "cart"] }, []),
      ).toEqual([
        { field: "namespace", value: "checkout" },
        { field: "service", value: "cart" },
      ]);
      expect(pointGroupFilters(query, { type }, "category", { path: ["checkout"] }, [])).toEqual([
        { field: "namespace", value: "checkout" },
      ]);
    }
  });

  it("heatmap: the row value, and the column only when the x axis is not time", () => {
    const query = {
      fields: { x: [builder("x_axis_1", "host")], y: [builder("y_axis_1", "service")] },
    };
    const heatmap = { type: "heatmap", config: {} };
    expect(pointGroupFilters(query, heatmap, "heatmap", { heatmapRow: "cart" }, [])).toEqual([
      { field: "service", value: "cart" },
    ]);
    expect(
      pointGroupFilters(query, heatmap, "heatmap", { heatmapRow: "cart", heatmapColumn: "h1" }, []),
    ).toEqual([
      { field: "service", value: "cart" },
      { field: "host", value: "h1" },
    ]);
  });

  it("heatmap: a bucketed row is a range, so it is no filter", () => {
    const query = { fields: { x: [histogramX], y: [builder("y_axis_1", "latency")] } };
    const bucketed = { type: "heatmap", config: { heatmap_y_bucket: { mode: "size", size: 10 } } };
    expect(pointGroupFilters(query, bucketed, "heatmap", { heatmapRow: 20 }, [])).toEqual([]);
  });

  it("drops computed fields and the top-N 'others' aggregate", () => {
    const query = {
      fields: {
        x: [builder("x_axis_1", "service", { functionName: "lower" })],
        breakdown: [builder("breakdown_1", "region")],
      },
    };
    const panel = { type: "bar", config: { top_results_others: true } };
    expect(
      pointGroupFilters(
        query,
        panel,
        "category",
        { name: "cart", seriesValue: OTHERS_BREAKDOWN_VALUE },
        [],
      ),
    ).toEqual([]);
  });

  it("a breakdown series named 'others' is a real value; a NULL series filters IS NULL", () => {
    const query = {
      fields: {
        x: [builder("x_axis_1", "service")],
        breakdown: [builder("breakdown_1", "region")],
      },
    };
    const panel = { type: "bar", config: { top_results_others: true } };
    expect(
      pointGroupFilters(query, panel, "category", { name: "cart", seriesValue: "others" }, []),
    ).toEqual([
      { field: "service", value: "cart" },
      { field: "region", value: "others" },
    ]);
    const nullSeries = pointGroupFilters(
      query,
      panel,
      "category",
      { name: "cart", seriesValue: NULL_BREAKDOWN_VALUE },
      [],
    );
    expect(nullSeries).toEqual([
      { field: "service", value: "cart" },
      { field: "region", value: null },
    ]);
    expect(filtersWhere("", nullSeries)).toBe("service = 'cart' AND region IS NULL");
  });

  it("custom SQL: resolves each alias to the column the query reads, skipping unknown ones", () => {
    const query = {
      customQuery: true,
      fields: { x: [{ alias: "ns" }], breakdown: [{ alias: "svc" }] },
    };
    const columns = new Map([["ns", "k8s_namespace"]]);
    expect(
      pointGroupFilters(
        query,
        { type: "bar" },
        "category",
        { name: "checkout", seriesValue: "cart" },
        [],
        columns,
      ),
    ).toEqual([{ field: "k8s_namespace", value: "checkout" }]);
  });

  it("legacy fields with a plain column still filter", () => {
    const query = { fields: { x: [{ alias: "x", column: "service" }], breakdown: [] } };
    expect(pointGroupFilters(query, { type: "pie" }, "category", { name: "cart" }, [])).toEqual([
      { field: "service", value: "cart" },
    ]);
  });
});

describe("pointGroupFilters with several x and breakdown fields", () => {
  const query = {
    fields: {
      x: [builder("x_axis_1", "namespace"), builder("x_axis_2", "service")],
      breakdown: [builder("breakdown_1", "region"), builder("breakdown_2", "zone")],
    },
  };

  it("category: every field, from the values read off the clicked row", () => {
    const fieldValues = new Map<string, unknown>([
      ["x_axis_1", "checkout"],
      ["x_axis_2", "cart"],
      ["breakdown_1", "eu"],
      ["breakdown_2", "eu-1a"],
    ]);
    expect(
      pointGroupFilters(
        query,
        { type: "bar" },
        "category",
        { name: "checkout", seriesValue: "eu", fieldValues },
        [],
      ),
    ).toEqual([
      { field: "namespace", value: "checkout" },
      { field: "service", value: "cart" },
      { field: "region", value: "eu" },
      { field: "zone", value: "eu-1a" },
    ]);
  });

  it("without the row's values, only what the click itself names, never a guess", () => {
    expect(
      pointGroupFilters(
        query,
        { type: "bar" },
        "category",
        { name: "checkout", seriesValue: "eu" },
        [],
      ),
    ).toEqual([
      { field: "namespace", value: "checkout" },
      { field: "region", value: "eu" },
    ]);
  });

  it("time chart: the bucket field is never a filter; unresolved fields are left out", () => {
    const timed = { fields: { ...query.fields, x: [histogramX, builder("x_axis_2", "service")] } };
    expect(pointGroupFilters(timed, { type: "line" }, "time", { seriesValue: "eu" }, [])).toEqual([
      { field: "region", value: "eu" },
    ]);
  });
});

describe("funnelStageQuery", () => {
  const stageQuery = (alias: string, extra: Record<string, unknown> = {}) => ({
    fields: { x: [{ alias }] },
    ...extra,
  });
  const schema = { queries: [stageQuery("x_axis_1"), stageQuery("x_axis_1")] };

  it("returns the one query whose rows name the stage", () => {
    const data = [[{ x_axis_1: "Visited" }], [{ x_axis_1: "Purchased" }]];
    expect(funnelStageQuery(schema, data, "Purchased")).toBe(1);
    expect(funnelStageQuery(schema, data, "Visited")).toBe(0);
  });

  it("returns null when several queries or none name the stage", () => {
    const data = [[{ x_axis_1: "Visited" }], [{ x_axis_1: "Visited" }]];
    expect(funnelStageQuery(schema, data, "Visited")).toBeNull();
    expect(funnelStageQuery(schema, data, "Missing")).toBeNull();
  });

  it("ignores a hidden query, whose stages the funnel does not draw", () => {
    const hidden = {
      queries: [stageQuery("x_axis_1"), stageQuery("x_axis_1", { config: { hide: true } })],
    };
    const data = [[{ x_axis_1: "Visited" }], [{ x_axis_1: "Visited" }]];
    expect(funnelStageQuery(hidden, data, "Visited")).toBe(0);
  });

  it("matches a numeric stage the way the funnel names it", () => {
    expect(
      funnelStageQuery({ queries: [stageQuery("x_axis_1")] }, [[{ x_axis_1: 404 }]], "404"),
    ).toBe(0);
  });
});

describe("treeOpensPointMenu", () => {
  const tree = (streamType: string, queries: any[] = [{}]) => ({
    type: "treemap",
    queryType: "sql",
    queries: queries.map((q) => ({ fields: { stream_type: streamType }, ...q })),
  });
  const ctx = { correlationEnabled: false, isLocked: () => false };

  it.each([
    ["a logs treemap", tree("logs"), ctx, true],
    ["a traces treemap", tree("traces"), ctx, true],
    // A metrics treemap opens View metrics on its own stream, correlation or not.
    ["a metrics treemap without correlation", tree("metrics"), ctx, true],
    [
      "a metrics treemap with metrics locked",
      tree("metrics"),
      { ...ctx, isLocked: (k: string) => k === "metrics" },
      false,
    ],
    [
      "a metrics treemap with correlation",
      tree("metrics"),
      { ...ctx, correlationEnabled: true },
      true,
    ],
    [
      "a logs treemap with logs locked",
      tree("logs"),
      { ...ctx, isLocked: (k: string) => k === "logs" },
      false,
    ],
    ["a two-query treemap", tree("logs", [{}, {}]), ctx, false],
    [
      "a two-query treemap with one hidden",
      tree("logs", [{ config: { hide: true } }, {}]),
      ctx,
      true,
    ],
    ["a PromQL treemap", { ...tree("metrics"), queryType: "promql" }, ctx, true],
    ["a pie, which never zooms", { ...tree("logs"), type: "pie" }, ctx, false],
  ])("%s: %s", (_name, schema, context, expected) => {
    expect(treeOpensPointMenu(schema, context)).toBe(expected);
  });
});

describe("correlationConfigured", () => {
  it("needs an enterprise build and service streams left on", () => {
    expect(correlationConfigured("true", {})).toBe(true);
    expect(correlationConfigured("true", { service_streams_enabled: false })).toBe(false);
    expect(correlationConfigured("false", {})).toBe(false);
  });
});

describe("fieldPredicate / filtersWhere", () => {
  it("escapes quotes, leaves numbers bare and turns empty into IS NULL", () => {
    expect(fieldPredicate({ field: "user", value: "o'brien" })).toBe("user = 'o''brien'");
    expect(fieldPredicate({ field: "code", value: 500 })).toBe("code = 500");
    expect(fieldPredicate({ field: "svc", value: null })).toBe("svc IS NULL");
    expect(fieldPredicate({ field: "svc", value: "" })).toBe("svc IS NULL");
  });

  it("wraps the panel WHERE and ANDs every condition after it", () => {
    const filters = [
      { field: "ns", value: "checkout" },
      { field: "code", value: 500 },
    ];
    expect(filtersWhere("a = 1 OR b = 2", filters)).toBe(
      "(a = 1 OR b = 2) AND ns = 'checkout' AND code = 500",
    );
    expect(filtersWhere("", filters)).toBe("ns = 'checkout' AND code = 500");
    expect(filtersWhere(undefined, [])).toBe("");
  });
});

describe("logsAvailability", () => {
  const unlocked = () => false;

  it.each([
    [{ queryType: "sql", streamType: "logs" }, { kind: "enabled" }],
    [{ queryType: "sql", streamType: undefined }, { kind: "enabled" }],
    [{ queryType: "sql", streamType: "metrics" }, { kind: "blocked" }],
    [{ queryType: "sql", streamType: "traces" }, { kind: "blocked" }],
    [{ queryType: "promql", streamType: "metrics" }, { kind: "blocked" }],
    [{ queryType: "sql", streamType: "logs", joinsStreams: true }, { kind: "blocked" }],
    [{ queryType: "sql", streamType: "logs", joinsStreams: false }, { kind: "enabled" }],
  ])("%o gives %o", (input, expected) => {
    expect(logsAvailability({ ...input, isLocked: unlocked })).toEqual(expected);
  });

  it("is locked while logs is license-locked", () => {
    expect(
      logsAvailability({ queryType: "sql", streamType: "logs", isLocked: (k) => k === "logs" }),
    ).toEqual({ kind: "locked", feature: "logs" });
  });
});

describe("tracesAvailability", () => {
  const base = {
    queryType: "sql",
    hasGroupValues: true,
    correlationEnabled: true,
    isLocked: () => false,
  };

  it.each([
    [{ streamType: "traces" }, { kind: "tracesStream" }],
    [{ streamType: "logs" }, { kind: "correlate" }],
    [{ streamType: "metrics" }, { kind: "correlate" }],
    [{ streamType: "metrics", queryType: "promql", hasGroupValues: false }, { kind: "blocked" }],
    [{ streamType: "logs", hasGroupValues: false }, { kind: "blocked" }],
    [{ streamType: "logs", correlationEnabled: false }, { kind: "blocked" }],
    [{ streamType: "enrichment_tables" }, { kind: "blocked" }],
  ])("%o gives %o", (input, expected) => {
    expect(tracesAvailability({ ...base, ...input })).toEqual(expected);
  });

  it("is locked while traces or correlation is license-locked", () => {
    expect(
      tracesAvailability({ ...base, streamType: "traces", isLocked: (k) => k === "traces" }),
    ).toEqual({ kind: "locked", feature: "traces" });
    expect(
      tracesAvailability({ ...base, streamType: "logs", isLocked: (k) => k === "correlation" }),
    ).toEqual({ kind: "locked", feature: "correlation" });
  });
});

describe("metricsAvailability", () => {
  const base = {
    queryType: "sql",
    hasGroupValues: true,
    correlationEnabled: true,
    isLocked: () => false,
  };

  it.each([
    [{ streamType: "metrics" }, { kind: "metricsStream" }],
    [{ streamType: "metrics", correlationEnabled: false }, { kind: "metricsStream" }],
    [
      { queryType: "promql", streamType: "metrics", hasGroupValues: false },
      { kind: "metricsStream" },
    ],
    [{ queryType: "promql", streamType: undefined }, { kind: "metricsStream" }],
    [{ streamType: "logs" }, { kind: "correlate" }],
    [{ streamType: "traces" }, { kind: "correlate" }],
    [{ streamType: undefined }, { kind: "correlate" }],
    [{ streamType: "logs", correlationEnabled: false }, { kind: "blocked" }],
    [{ streamType: "logs", hasGroupValues: false }, { kind: "blocked" }],
    [{ streamType: "enrichment_tables" }, { kind: "blocked" }],
  ])("%o gives %o", (input, expected) => {
    expect(metricsAvailability({ ...base, ...input })).toEqual(expected);
  });

  it.each([
    ["metrics on a metrics chart", { streamType: "metrics" }, "metrics", "metrics"],
    ["metrics on a correlated logs chart", { streamType: "logs" }, "metrics", "metrics"],
    [
      "correlation on a correlated logs chart",
      { streamType: "logs" },
      "correlation",
      "correlation",
    ],
  ])("locks %s", (_name, input, locked, feature) => {
    expect(metricsAvailability({ ...base, ...input, isLocked: (k) => k === locked })).toEqual({
      kind: "locked",
      feature,
    });
  });

  it("shows no lock where the item could not open even with the licence", () => {
    const allLocked = () => true;
    expect(
      metricsAvailability({
        ...base,
        streamType: "logs",
        correlationEnabled: false,
        isLocked: allLocked,
      }),
    ).toEqual({ kind: "blocked" });
    expect(
      metricsAvailability({
        ...base,
        streamType: "logs",
        hasGroupValues: false,
        isLocked: allLocked,
      }),
    ).toEqual({ kind: "blocked" });
    // Correlation is no part of a metrics chart's own path, so its lock does not apply there.
    expect(
      metricsAvailability({ ...base, streamType: "metrics", isLocked: (k) => k === "correlation" }),
    ).toEqual({ kind: "metricsStream" });
  });
});

describe("seriesLabelFilters / promqlMetricName", () => {
  it("turns every label but __name__ into a condition", () => {
    expect(seriesLabelFilters({ __name__: "up", job: "api", code: "" })).toEqual([
      { field: "job", value: "api" },
      { field: "code", value: null },
    ]);
    expect(seriesLabelFilters({})).toEqual([]);
  });

  it("PromQL points take the series labels instead of builder fields", () => {
    const query = { fields: { x: [histogramX], breakdown: [builder("b", "svc")] } };
    expect(
      pointGroupFilters(query, { type: "line" }, "time", { seriesLabels: { pod: "p-1" } }, []),
    ).toEqual([{ field: "pod", value: "p-1" }]);
  });

  it.each([
    ["the series' __name__ first", "rate(x[5m])", { __name__: "up" }, "up"],
    ["a bare selector", "http_requests_total", {}, "http_requests_total"],
    [
      "inside functions and ranges",
      'sum by (service) (rate(http_requests_total{code=~"5.."}[5m]))',
      {},
      "http_requests_total",
    ],
    [
      "a quantile over a histogram",
      "histogram_quantile(0.99, sum by (le) (rate(req_bucket[5m])))",
      {},
      "req_bucket",
    ],
    ["a recording rule", "job:http_requests:rate5m", {}, "job:http_requests:rate5m"],
    ["the first of a binary expression", "errors_total / requests_total", {}, "errors_total"],
    ["no selector at all", "vector(1)", {}, ""],
    ["no expression", undefined, undefined, ""],
  ])("names %s", (_name, expression, labels, expected) => {
    expect(promqlMetricName(expression, labels)).toBe(expected);
  });
});

describe("PromQL look-back", () => {
  const MIN = 60_000_000;

  it.each([
    ["30s", 30_000_000],
    ["10m", 10 * MIN],
    ["2h", 120 * MIN],
    ["1d", 1440 * MIN],
    ["1h30m", 90 * MIN],
    ["500ms", 500_000],
    ["5x", 0],
    ["", 0],
  ])("reads %s as %i µs", (text, expected) => {
    expect(promqlDurationUs(text)).toBe(expected);
  });

  it.each([
    ["no range vector: the default five minutes", "up", 5 * MIN],
    ["a narrower range keeps the default", "rate(x[1m])", 5 * MIN],
    ["the widest range vector", "rate(a[10m]) / rate(b[2m])", 10 * MIN],
    ["a subquery's range, not its step", "max_over_time(rate(x[1m])[30m:15m])", 30 * MIN],
    ["no expression", undefined, 5 * MIN],
  ])("uses %s", (_name, expression, expected) => {
    expect(promqlLookBackUs(expression)).toBe(expected);
  });

  it("ends the window at the point itself when nothing is offset", () => {
    expect(promqlPointWindow(100 * MIN, "rate(x[10m])")).toEqual({
      startTime: 90 * MIN,
      endTime: 100 * MIN,
    });
  });

  it.each([
    ["no offset", 'sum(rate(x{a="b"}[5m])) by (job)', [0]],
    ["an offset on a range selector", "rate(http_requests_total[5m] offset 1h)", [60 * MIN]],
    ["an offset with no range (look-back)", "up offset 30m", [30 * MIN]],
    ["an offset after a label set", 'up{job="api"} offset 1h30m', [90 * MIN]],
    ["a negative offset reads later", "up offset -1d", [-1440 * MIN]],
    ["each selector its own", "rate(a[5m] offset 1h) / rate(b[5m])", [60 * MIN, 0]],
    [
      "a subquery's offset adds to the ones inside",
      "max_over_time(rate(x[1m] offset 5m)[30m:1m] offset 1h)",
      [65 * MIN],
    ],
    [
      "label lists and functions are not selectors",
      "sum without (pod) (rate(x[5m])) / on (job) group_left (env) y",
      [0, 0],
    ],
    ["offset text in a string is not an offset", 'up{note="x offset 1h"}', [0]],
    ["the @ modifier is skipped", "up @ 1700000000 offset 10m", [10 * MIN]],
  ])("selector offsets: %s", (_name, expression, expected) => {
    expect(promqlSelectorOffsetsUs(expression)).toEqual(expected);
  });

  it("moves the window back by the offset, as the engine does", () => {
    // Engine: [point − range − offset, point − offset].
    expect(promqlPointWindow(600 * MIN, "rate(http_requests_total[5m] offset 1h)")).toEqual({
      startTime: 535 * MIN,
      endTime: 540 * MIN,
    });
    expect(promqlPointWindow(600 * MIN, "rate(x[10m] offset 30m)")).toMatchObject({
      startTime: 560 * MIN,
      endTime: 570 * MIN,
    });
    expect(promqlPointWindow(600 * MIN, "up offset -1h")).toMatchObject({
      startTime: 655 * MIN,
      endTime: 660 * MIN,
    });
  });

  it("several offsets give the span covering them all", () => {
    expect(promqlPointWindow(600 * MIN, "rate(a[5m] offset 1h) - rate(a[5m] offset 1d)")).toEqual({
      startTime: 600 * MIN - 1440 * MIN - 5 * MIN,
      endTime: 540 * MIN,
    });
  });
});

describe("tracesPageQuery", () => {
  // The Traces page shows a handoff `filter` in its query bar; a `query` only filters the results.
  it("opens the stream over the slice with the filter as the visible handoff filter", () => {
    const query = tracesPageQuery({
      org: "default",
      stream: "default",
      startTime: 1_000_000,
      endTime: 2_000_000,
      filter: "service_name = 'cart'",
    });
    expect(query).toEqual({
      org_identifier: "default",
      stream: "default",
      from: "1000000",
      to: "2000000",
      filter: "service_name = 'cart'",
    });
  });
});

describe("sliceBounds", () => {
  const at = (h: number, m: number, sec = 0, day = 5) => Date.UTC(2026, 10, day, h, m, sec) * 1000;

  it.each([
    ["a 30 s bucket", at(12, 28, 30), at(12, 29), "12:28:30", "12:29:00"],
    ["a 30 s bucket on the minute", at(12, 0), at(12, 0, 30), "12:00:00", "12:00:30"],
    ["a 1 min bucket", at(12, 28), at(12, 29), "12:28", "12:29"],
    ["a 5 min bucket", at(10, 5), at(10, 10), "10:05", "10:10"],
    ["a 1 h bucket", at(10, 0), at(11, 0), "10:00", "11:00"],
    ["a bucket across midnight", at(23, 30), at(0, 30, 0, 6), "Nov 5 23:30", "Nov 6 00:30"],
    [
      "a 30 s bucket across midnight",
      at(23, 59, 30),
      at(0, 0, 0, 6),
      "Nov 5 23:59:30",
      "Nov 6 00:00:00",
    ],
  ])("%s", (_name, startTime, endTime, start, end) => {
    expect(sliceBounds(startTime, endTime, "UTC")).toEqual({ start, end });
  });

  it("shows minutes in the dashboard timezone, and the date only across days", () => {
    const t0 = Date.UTC(2026, 10, 5, 10, 5) * 1000;
    expect(sliceBounds(t0, t0 + 300_000_000, "UTC")).toEqual({ start: "10:05", end: "10:10" });
    expect(sliceBounds(t0, t0 + 300_000_000, "Asia/Kolkata")).toEqual({
      start: "15:35",
      end: "15:40",
    });
    expect(sliceBounds(t0, t0 + 86_400_000_000, "UTC")).toEqual({
      start: "Nov 5 10:05",
      end: "Nov 6 10:05",
    });
  });
});
