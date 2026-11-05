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
  correlationConfigured,
  fieldPredicate,
  filtersWhere,
  isTimeXField,
  logsAvailability,
  pointFamily,
  pointGroupFilters,
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
      pointGroupFilters(query, panel, "category", { name: "cart", seriesValue: "others" }, []),
    ).toEqual([]);
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
    ["a metrics treemap without correlation", tree("metrics"), ctx, false],
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
    ["a PromQL treemap", { ...tree("metrics"), queryType: "promql" }, ctx, false],
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
    [
      { queryType: "sql", streamType: "metrics" },
      { kind: "blocked", reason: "logsNeedLogsStream" },
    ],
    [
      { queryType: "sql", streamType: "traces" },
      { kind: "blocked", reason: "logsNeedLogsStream" },
    ],
    [
      { queryType: "promql", streamType: "metrics" },
      { kind: "blocked", reason: "logsNeedLogsStream" },
    ],
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
    [
      { streamType: "metrics", queryType: "promql", hasGroupValues: false },
      { kind: "blocked", reason: "noServiceField" },
    ],
    [
      { streamType: "logs", hasGroupValues: false },
      { kind: "blocked", reason: "noServiceField" },
    ],
    [
      { streamType: "logs", correlationEnabled: false },
      { kind: "blocked", reason: "noTraceCorrelation" },
    ],
    [{ streamType: "enrichment_tables" }, { kind: "blocked", reason: "noTraceCorrelation" }],
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
