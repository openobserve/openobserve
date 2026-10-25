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
import { stackTotalRows } from "./stackTotals";
import { createSeriesOverrideLookup, toSeriesOverrideEntry } from "./seriesOverrides";
import { convertMultiSQLData } from "./convertSQLData";
import { convertPromQLData } from "./convertPromQLData";

const config = { unit: "milliseconds", decimals: 0 };
const lookup = createSeriesOverrideLookup(config);
const param = (seriesIndex: number, seriesName: string, value: unknown) => ({
  seriesIndex,
  seriesName,
  value,
});
const rows = (type: string, params: any[], series: any[], cfg: any = config) =>
  stackTotalRows(type, params, series, createSeriesOverrideLookup(cfg), (p) => p.value);

describe("stackTotalRows", () => {
  const twoInOneStack = [{ stack: "s" }, { stack: "s" }];

  it.each(["area-stacked", "stacked", "h-stacked"])("%s: one total for one stack", (type) => {
    expect(rows(type, [param(0, "a", 200), param(1, "b", 300)], twoInOneStack)).toEqual([
      "<strong>Total : 500ms</strong>",
    ]);
  });

  it.each(["line", "area", "bar", "h-bar", "scatter"])("%s: no total", (type) => {
    expect(rows(type, [param(0, "a", 200), param(1, "b", 300)], twoInOneStack)).toEqual([]);
  });

  it("skips nulls and missing points, and counts every row, not only the shown ones", () => {
    const series = Array.from({ length: 30 }, () => ({ stack: "s" }));
    const params = series.map((_, i) => param(i, `s${i}`, i < 25 ? 10 : i === 25 ? "-" : null));
    expect(rows("stacked", params, series)).toEqual(["<strong>Total : 250ms</strong>"]);
  });

  it("reads numeric strings, as PromQL samples are", () => {
    expect(rows("stacked", [param(0, "a", "1.5"), param(1, "b", "2")], twoInOneStack)).toEqual([
      "<strong>Total : 4ms</strong>",
    ]);
  });

  it("sums positive and negative values together", () => {
    expect(rows("stacked", [param(0, "a", 100), param(1, "b", -40)], twoInOneStack)).toEqual([
      "<strong>Total : 60ms</strong>",
    ]);
  });

  it("no total for a single-series stack, an all-null stack or series without a stack", () => {
    expect(rows("stacked", [param(0, "a", 1)], [{ stack: "s" }])).toEqual([]);
    expect(rows("stacked", [param(0, "a", null), param(1, "b", null)], twoInOneStack)).toEqual([]);
    expect(rows("stacked", [param(0, "a", 1), param(1, "b", 2)], [{}, {}])).toEqual([]);
  });

  it("labels each stack by the suffix its series names share, in series order", () => {
    const series = [{ stack: "q0" }, { stack: "q0" }, { stack: "q1" }, { stack: "q1" }];
    const params = [
      param(2, "a (1d ago)", 5),
      param(0, "a", 1),
      param(1, "b", 2),
      param(3, "b (1d ago)", 6),
    ];
    expect(rows("area-stacked", params, series)).toEqual([
      "<strong>Total : 3ms</strong>",
      "<strong>Total (1d ago) : 11ms</strong>",
    ]);
  });

  it("numbers the stacks when their labels would read the same", () => {
    const series = [{ stack: "q0" }, { stack: "q0" }, { stack: "q1" }, { stack: "q1" }];
    const params = [param(0, "a", 1), param(1, "b", 2), param(2, "c", 3), param(3, "d", 4)];
    expect(rows("stacked", params, series)).toEqual([
      "<strong>Total #1 : 3ms</strong>",
      "<strong>Total #2 : 7ms</strong>",
    ]);
  });

  it("formats with a unit the stack's series share through an override, and skips mixed units", () => {
    const override = (value: string) =>
      toSeriesOverrideEntry({ matchBy: "name", value, unit: "bytes", decimals: 0 });
    const both = { ...config, override_config: [override("a"), override("b")] };
    expect(
      rows("stacked", [param(0, "a", 1024), param(1, "b", 1024)], twoInOneStack, both),
    ).toEqual(["<strong>Total : 2KB</strong>"]);
    const one = { ...config, override_config: [override("a")] };
    expect(rows("stacked", [param(0, "a", 1), param(1, "b", 2)], twoInOneStack, one)).toEqual([]);
  });

  it("escapes the label and value", () => {
    const custom = { unit: "custom", unit_custom: "<b>", decimals: 0 };
    expect(rows("stacked", [param(0, "a", 1), param(1, "b", 2)], twoInOneStack, custom)).toEqual([
      "<strong>Total : 3&lt;b&gt;</strong>",
    ]);
  });

  it("returns nothing for missing params or series", () => {
    expect(stackTotalRows("stacked", undefined, [], lookup, (p) => p.value)).toEqual([]);
    expect(stackTotalRows("stacked", [], undefined, lookup, (p) => p.value)).toEqual([]);
  });
});

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};
const panelRef = () => ({ value: { offsetWidth: 800, offsetHeight: 400 } });
const TIMES = ["2024-01-01T00:00:00", "2024-01-01T00:10:00"];
const timeX = {
  label: "Timestamp",
  alias: "x_axis_1",
  column: "_timestamp",
  functionName: "histogram",
  aggregationFunction: "histogram",
  args: [{ type: "field", value: { field: "_timestamp" } }],
};
const endpointX = { label: "Endpoint", alias: "x_axis_1", column: "endpoint", args: [] };
const yField = {
  label: "Latency",
  alias: "y_axis_1",
  column: "latency",
  functionName: "avg",
  aggregationFunction: "avg",
  args: [{ type: "field", value: { field: "latency" } }],
};
const breakdown = { label: "Service", alias: "breakdown_1", column: "service", args: [] };
const sqlPanel = (type: string, x: any) => ({
  id: "p",
  type,
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: false,
      fields: {
        stream: "default",
        stream_type: "logs",
        x: [x],
        y: [yField],
        z: [],
        breakdown: [breakdown],
      },
      config: {},
    },
  ],
  config: { show_legends: true, unit: "milliseconds", decimals: 0 },
});
const runSQL = async (panel: any, data: any[]) => {
  const result: any = await convertMultiSQLData(
    panel,
    [data],
    store,
    panelRef(),
    { value: null },
    { value: [] },
    {
      queries: [
        {
          query: "SELECT 1",
          startTime: 1704067200000000,
          endTime: 1704068400000000,
          timeRangeGap: { seconds: 0, periodAsStr: "" },
          panelQueryIndex: 0,
        },
      ],
    },
    { height: "400px" },
    { value: [] },
    false,
  );
  return result.options;
};
const stackRows = (xs: string[]) =>
  xs.flatMap((x, i) => [
    { x_axis_1: x, breakdown_1: "api", y_axis_1: [200, 30][i] },
    { x_axis_1: x, breakdown_1: "web", y_axis_1: [300, 90][i] },
  ]);
const indexOf = (options: any, name: string) =>
  options.series.findIndex((s: any) => s.name === name);

describe("tooltip totals in rendered options", () => {
  it.each(["stacked", "h-stacked"])("SQL %s on categories", async (type) => {
    const options = await runSQL(sqlPanel(type, endpointX), stackRows(["/a", "/b"]));
    const point = (name: string, value: number) => ({
      seriesName: name,
      seriesIndex: indexOf(options, name),
      name: "/a",
      marker: "",
      value,
      data: value,
    });
    const html = options.tooltip.formatter([point("api", 200), point("web", 300)]);
    expect(html).toBe("/a <br/> <strong>Total : 500ms</strong><br/> web : 300ms<br/> api : 200ms");
  });

  it.each(["stacked", "area-stacked"])("SQL %s on time", async (type) => {
    const options = await runSQL(sqlPanel(type, timeX), stackRows(TIMES));
    const point = (name: string, value: number) => ({
      seriesName: name,
      seriesIndex: indexOf(options, name),
      marker: "",
      data: [TIMES[0], value],
      value: [TIMES[0], value],
    });
    const html = options.tooltip.formatter([point("api", 200), point("web", 300)]);
    expect(html).toContain("<strong>Total : 500ms</strong>");
  });

  it("SQL bar on time: no total", async () => {
    const options = await runSQL(sqlPanel("bar", timeX), stackRows(TIMES));
    const html = options.tooltip.formatter([
      { seriesName: "api", seriesIndex: 0, marker: "", data: [TIMES[0], 200], value: [] },
      { seriesName: "web", seriesIndex: 1, marker: "", data: [TIMES[0], 300], value: [] },
    ]);
    expect(html).not.toContain("Total");
  });

  const promTimes = [1704067200, 1704067800];
  const promData = () => [
    {
      resultType: "matrix",
      result: Object.entries({ api: [200, 30], web: [300, 90] }).map(([service, values]) => ({
        metric: { service },
        values: values.map((v, i) => [promTimes[i], String(v)]),
      })),
    },
  ];
  const promPanel = (type: string) => ({
    id: "pq",
    type,
    queryType: "promql",
    queries: [
      {
        query: "rate(latency[5m])",
        customQuery: true,
        fields: { stream: "latency", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
        config: { promql_legend: "{service}" },
      },
    ],
    config: { show_legends: true, unit: "milliseconds", decimals: 0 },
  });
  const runPromQL = async (type: string) => {
    const result: any = await convertPromQLData(
      promPanel(type),
      promData(),
      store,
      panelRef(),
      { value: null },
      { value: [] },
      null,
      [],
      false,
    );
    return result.options;
  };

  it.each(["stacked", "h-stacked"])("PromQL %s", async (type) => {
    const options = await runPromQL(type);
    const html = options.tooltip.formatter([
      { seriesName: "api", seriesIndex: indexOf(options, "api"), axisValue: "t", value: 200 },
      { seriesName: "web", seriesIndex: indexOf(options, "web"), axisValue: "t", value: 300 },
    ]);
    expect(html.split("<br/>").slice(0, 2)).toEqual(["t", "<strong>Total : 500ms</strong>"]);
  });

  it("PromQL area-stacked", async () => {
    const options = await runPromQL("area-stacked");
    const point = (name: string, value: number) => ({
      seriesName: name,
      seriesIndex: indexOf(options, name),
      marker: "",
      data: [promTimes[0] * 1000, value],
      value: [promTimes[0] * 1000, value],
    });
    const html = options.tooltip.formatter([point("api", 200), point("web", 300)]);
    expect(html).toContain("<strong>Total : 500ms</strong>");
  });
});
