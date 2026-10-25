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
import { fitAxisBoundsToStacks, stackTotalRows } from "./stackTotals";
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

  it("names the stacks by their panel query when their names share no suffix", () => {
    const series = [
      { stack: "stack-0", _panelQueryIndex: 0 },
      { stack: "stack-0", _panelQueryIndex: 0 },
      { stack: "q1-stack-0", _panelQueryIndex: 1 },
      { stack: "q1-stack-0", _panelQueryIndex: 1 },
    ];
    const params = [param(0, "a", 1), param(1, "b", 2), param(2, "a", 3), param(3, "b", 4)];
    expect(rows("h-stacked", params, series)).toEqual([
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
    const withNull = [param(2, "c", null), param(0, "a", 1024), param(1, "b", 1024)];
    const threeInOneStack = [{ stack: "s" }, { stack: "s" }, { stack: "s" }];
    expect(rows("stacked", withNull, threeInOneStack, both)).toEqual([
      "<strong>Total : 2KB</strong>",
    ]);
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

  it("SQL area-stacked on categories", async () => {
    const options = await runSQL(sqlPanel("area-stacked", endpointX), stackRows(["/a", "/b"]));
    const point = (name: string, value: number) => ({
      seriesName: name,
      seriesIndex: indexOf(options, name),
      name: "/a",
      marker: "",
      value,
      data: value,
    });
    const html = options.tooltip.formatter([point("api", 200), point("web", 300)]);
    expect(html).toContain("<strong>Total : 500ms</strong>");
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

  it("PromQL stacked: an unset decimals formats the total like the rows", async () => {
    const result: any = await convertPromQLData(
      { ...promPanel("stacked"), config: { show_legends: true, decimals: null } },
      promData(),
      store,
      panelRef(),
      { value: null },
      { value: [] },
      null,
      [],
      false,
    );
    const options = result.options;
    const html = options.tooltip.formatter([
      { seriesName: "api", seriesIndex: indexOf(options, "api"), axisValue: "t", value: 200 },
      { seriesName: "web", seriesIndex: indexOf(options, "web"), axisValue: "t", value: 300 },
    ]);
    expect(html).toContain("<strong>Total : 500.00</strong>");
    expect(html).toContain("api: 200.00");
  });

  it("PromQL area-stacked: the total counts the rows past the tooltip row cap", async () => {
    const values: Record<string, number[]> = {};
    for (let i = 1; i <= 12; i++) values[`s${i}`] = [i, i];
    const data = [
      {
        resultType: "matrix",
        result: Object.entries(values).map(([service, v]) => ({
          metric: { service },
          values: v.map((x, i) => [promTimes[i], String(x)]),
        })),
      },
    ];
    const result: any = await convertPromQLData(
      promPanel("area-stacked"),
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      null,
      [],
      false,
    );
    const options = result.options;
    const params = Object.keys(values).map((name, i) => ({
      seriesName: name,
      seriesIndex: indexOf(options, name),
      marker: "",
      data: [promTimes[0] * 1000, i + 1],
      value: [promTimes[0] * 1000, i + 1],
    }));
    const html = options.tooltip.formatter(params);
    expect(html).toContain("<strong>Total : 78ms</strong>");
    expect(html).toContain("+2 more");
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

describe("fitAxisBoundsToStacks", () => {
  const fit = (yAxis: any, series: any[]) => {
    const options = { yAxis, series };
    fitAxisBoundsToStacks(options);
    return options.yAxis;
  };

  it("raises a user max to the tallest positive stack and lowers a user min to the deepest negative one", () => {
    const series = [
      { name: "a", stack: "s", data: [200, -50] },
      { name: "b", stack: "s", data: [300, -70] },
    ];
    expect(fit({ min: -10, max: 100 }, series)).toEqual({ min: -120, max: 500 });
  });

  it("stacks positives and negatives apart in one bucket", () => {
    const series = [
      { name: "a", stack: "s", data: [100] },
      { name: "b", stack: "s", data: [-40] },
      { name: "c", stack: "s", data: [60] },
    ];
    expect(fit({ min: 0, max: 10 }, series)).toEqual({ min: -40, max: 160 });
  });

  it("sums time-axis points by time, per stack", () => {
    const t0 = new Date(1704067200000);
    const t1 = new Date(1704067800000);
    const series = [
      {
        name: "a",
        stack: "s0",
        data: [
          [t0, 200],
          [t1, 30],
        ],
      },
      {
        name: "b",
        stack: "s0",
        data: [
          [new Date(t0.getTime()), 300],
          [t1, 90],
        ],
      },
      { name: "c", stack: "s1", data: [[t0, 450]] },
    ];
    expect(fit({ max: 100 }, series).max).toBe(500);
  });

  it("counts an unstacked series on its own and skips unnamed and null points", () => {
    const series = [
      { name: "a", data: [70, null, "-"] },
      { name: "b", data: [80] },
      { type: "line", data: [[0, 9999]] },
    ];
    expect(fit({ max: 50 }, series).max).toBe(80);
  });

  it("keeps a user bound that already clears every stack", () => {
    const series = [
      { name: "a", stack: "s", data: [1] },
      { name: "b", stack: "s", data: [2] },
    ];
    expect(fit({ min: -5, max: 1000 }, series)).toEqual({ min: -5, max: 1000 });
  });

  it("leaves unset bounds alone", () => {
    expect(fit({}, [{ name: "a", stack: "s", data: [500] }])).toEqual({});
  });
});

describe("SQL stacked y-axis bounds", () => {
  const withBounds = (type: string, x: any, bounds: any) => {
    const panel = sqlPanel(type, x);
    panel.config = { ...panel.config, ...bounds };
    return panel;
  };

  it.each([
    ["categories", endpointX, ["/a", "/b"]],
    ["time", timeX, TIMES],
  ])("stacked on %s: a y max below the stack top rises to the stack sum", async (_, x, xs) => {
    const options = await runSQL(withBounds("stacked", x, { y_axis_max: 100 }), stackRows(xs));
    expect(options.yAxis.max).toBe(500);
  });

  it("stacked: a y min above the deepest negative stack drops to its sum", async () => {
    const rows = stackRows(["/a", "/b"]).map((row) => ({ ...row, y_axis_1: -row.y_axis_1 }));
    const options = await runSQL(withBounds("stacked", endpointX, { y_axis_min: -10 }), rows);
    expect(options.yAxis.min).toBe(-500);
  });

  it("stacked without user bounds keeps the automatic extent", async () => {
    const options = await runSQL(sqlPanel("stacked", endpointX), stackRows(["/a", "/b"]));
    expect(options.yAxis.max).toBeUndefined();
    expect(options.yAxis.min).toBeUndefined();
  });

  it("bar keeps today's single-value bound", async () => {
    const options = await runSQL(
      withBounds("bar", endpointX, { y_axis_max: 100 }),
      stackRows(["/a", "/b"]),
    );
    expect(options.yAxis.max).toBe(300);
  });

  it("stacked multi-query: a later query's taller stack lifts the bound", async () => {
    const panel = withBounds("stacked", endpointX, { y_axis_max: 100 });
    panel.queries = [panel.queries[0], panel.queries[0]];
    const tall = stackRows(["/a", "/b"]).map((row) => ({ ...row, y_axis_1: row.y_axis_1 * 4 }));
    const result: any = await convertMultiSQLData(
      panel,
      [stackRows(["/a", "/b"]), tall],
      store,
      panelRef(),
      { value: null },
      { value: [[], []] },
      {
        queries: [0, 1].map((i) => ({
          query: "SELECT 1",
          startTime: 1704067200000000,
          endTime: 1704068400000000,
          timeRangeGap: { seconds: 0, periodAsStr: "" },
          panelQueryIndex: i,
        })),
      },
      { height: "400px" },
      { value: [] },
      false,
    );
    expect(result.options.yAxis.max).toBe(2000);
  });
});
