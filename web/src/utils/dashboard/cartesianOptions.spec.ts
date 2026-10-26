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

import { describe, expect, it, vi } from "vitest";
import { convertPanelData } from "./convertPanelData";
import { convertMultiSQLData } from "./convertSQLData";
import { convertPromQLData } from "./convertPromQLData";
import { applyCartesianOptions, tooltipPointValue } from "./cartesianOptions";
import { toSeriesOverrideEntry } from "./seriesOverrides";

// The custom-chart runner imports the ECharts bundle as a URL, which only resolves in a browser build.
vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const serialize = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "function" ? "[Function]" : v === undefined ? "[undefined]" : v,
  );

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};
const panelRef = () => ({ value: { offsetWidth: 800, offsetHeight: 400 } });

const TIMES = ["2024-01-01T00:00:00", "2024-01-01T00:10:00", "2024-01-01T00:20:00"];
const timeX = {
  label: "Timestamp",
  alias: "x_axis_1",
  column: "_timestamp",
  functionName: "histogram",
  aggregationFunction: "histogram",
  args: [{ type: "field", value: { field: "_timestamp" } }],
};
const endpointX = { label: "Endpoint", alias: "x_axis_1", column: "endpoint", args: [] };
const yField = (alias = "y_axis_1", label = "Latency") => ({
  label,
  alias,
  column: "latency",
  functionName: "avg",
  aggregationFunction: "avg",
  args: [{ type: "field", value: { field: "latency" } }],
});
const breakdown = { label: "Service", alias: "breakdown_1", column: "service", args: [] };

const sqlPanel = (type: string, config: Record<string, any>, fields: Record<string, any>) => ({
  id: "p",
  type,
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: false,
      fields: { stream: "default", stream_type: "logs", z: [], breakdown: [], ...fields },
      config: {},
    },
  ],
  config: { show_legends: true, unit: "milliseconds", decimals: 0, ...config },
});

const sqlMetadata = {
  queries: [
    {
      query: "SELECT 1",
      startTime: 1704067200000000,
      endTime: 1704068400000000,
      timeRangeGap: { seconds: 0, periodAsStr: "" },
      panelQueryIndex: 0,
    },
  ],
};

const timeRows = (values: Record<string, (number | null)[]> = { api: [100, 600, 1200] }) =>
  TIMES.flatMap((t, i) =>
    Object.entries(values).map(([service, v]) => ({
      x_axis_1: t,
      breakdown_1: service,
      y_axis_1: v[i],
    })),
  );
const categoryRows = () => [
  { x_axis_1: "/a", breakdown_1: "api", y_axis_1: 300 },
  { x_axis_1: "/a", breakdown_1: "web", y_axis_1: 100 },
  { x_axis_1: "/b", breakdown_1: "api", y_axis_1: 600 },
  { x_axis_1: "/b", breakdown_1: "web", y_axis_1: 900 },
];
const plainCategoryRows = () => [
  { x_axis_1: "/a", y_axis_1: 100 },
  { x_axis_1: "/b", y_axis_1: 900 },
  { x_axis_1: "/c", y_axis_1: 400 },
];

const viaPanel = async (panel: any, data: any[]) => {
  const result: any = await convertPanelData(
    panel,
    data,
    store,
    panelRef(),
    { value: null },
    { value: [] },
    panel.queryType === "promql" ? null : sqlMetadata,
    { height: "400px" },
    { value: [] },
    false,
  );
  return result.options;
};

const directSQL = async (panel: any, data: any[]) =>
  (
    (await convertMultiSQLData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      sqlMetadata,
      { height: "400px" },
      { value: [] },
      false,
    )) as any
  ).options;

const promTimes = [1704067200, 1704067800, 1704068400];
const promMatrix = (series: Record<string, number[]>) => ({
  resultType: "matrix",
  result: Object.entries(series).map(([service, values]) => ({
    metric: { service },
    values: values.map((v, i) => [promTimes[i], String(v)]),
  })),
});
const promPanel = (type: string, config: Record<string, any> = {}) => ({
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
  config: { show_legends: true, unit: "milliseconds", decimals: 0, ...config },
});
const promData = () => [promMatrix({ api: [100, 600, 1200], web: [50, 300, 900] })];
const directPromQL = async (panel: any, data: any[]) =>
  (
    (await convertPromQLData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      null,
      [],
      false,
    )) as any
  ).options;

const dataSeries = (options: any) =>
  options.series.filter((s: any) => s.name && Array.isArray(s.data));
const named = (options: any, name: string) => dataSeries(options).find((s: any) => s.name === name);
const yOf = (point: any) => tooltipPointValue(point);
const overrides = (...entries: any[]) => ({
  override_config: entries.map((e) => toSeriesOverrideEntry({ matchBy: "name", ...e })),
});

const timePoint = (seriesName: string, value: number, seriesIndex = 0, dataIndex = 2) => ({
  seriesName,
  seriesIndex,
  dataIndex,
  marker: "",
  data: [TIMES[2], value],
  value: [TIMES[2], value],
});

describe("absent keys render exactly as today", () => {
  const SQL_CASES: [string, () => any, () => any[]][] = [
    [
      "line",
      () => sqlPanel("line", {}, { x: [timeX], y: [yField()], breakdown: [breakdown] }),
      () => [timeRows({ api: [1, 2, 3], web: [4, 5, 6] })],
    ],
    [
      "area-stacked",
      () => sqlPanel("area-stacked", {}, { x: [timeX], y: [yField()], breakdown: [breakdown] }),
      () => [timeRows({ api: [1, 2, 3], web: [4, 5, 6] })],
    ],
    [
      "bar",
      () => sqlPanel("bar", {}, { x: [endpointX], y: [yField()] }),
      () => [plainCategoryRows()],
    ],
    [
      "h-bar",
      () => sqlPanel("h-bar", {}, { x: [endpointX], y: [yField()] }),
      () => [plainCategoryRows()],
    ],
    [
      "stacked",
      () => sqlPanel("stacked", {}, { x: [endpointX], y: [yField()], breakdown: [breakdown] }),
      () => [categoryRows()],
    ],
    [
      "h-stacked",
      () => sqlPanel("h-stacked", {}, { x: [endpointX], y: [yField()], breakdown: [breakdown] }),
      () => [categoryRows()],
    ],
    [
      "scatter",
      () => sqlPanel("scatter", {}, { x: [endpointX], y: [yField(), yField("y_axis_2", "Size")] }),
      () => [plainCategoryRows().map((r) => ({ ...r, y_axis_2: 5 }))],
    ],
  ];

  it.each(SQL_CASES)("SQL %s", async (_type, panel, data) => {
    const converted = await viaPanel(panel(), data());
    const today = await directSQL(panel(), data());
    expect(serialize(converted)).toBe(serialize(today));
    const points = [timePoint("api", 10), timePoint("web", 20, 1)];
    expect(converted.tooltip.formatter([...points])).toBe(today.tooltip.formatter([...points]));
    expect(converted.tooltip.trigger).toBe(today.tooltip.trigger);
  });

  it.each(["line", "area", "area-stacked", "bar", "scatter", "h-bar", "stacked", "h-stacked"])(
    "PromQL %s",
    async (type) => {
      const converted = await viaPanel(promPanel(type), promData());
      const today = await directPromQL(promPanel(type), promData());
      expect(serialize(converted)).toBe(serialize(today));
    },
  );

  it("applyCartesianOptions leaves options untouched when no key is set", () => {
    const formatter = () => "x";
    const options = {
      tooltip: { trigger: "axis", formatter },
      xAxis: [{ type: "category", data: ["a", "b"] }],
      yAxis: { type: "value", min: 1 },
      series: [{ name: "s", type: "bar", stack: "t", data: [1, 2] }],
      grid: { left: 10, right: 20 },
    };
    const before = serialize(options);
    applyCartesianOptions(options, { type: "stacked", config: {} });
    expect(serialize(options)).toBe(before);
    expect(options.tooltip.formatter).toBe(formatter);
  });

  it("ignores non-cartesian charts", () => {
    const options = { series: [{ name: "a", data: [{ value: 1 }] }], tooltip: {} };
    applyCartesianOptions(options, { type: "pie", config: { tooltip_mode: "hidden" } });
    expect(options.tooltip).toEqual({});
  });
});

describe("tooltip_mode", () => {
  const panel = (config: any) =>
    sqlPanel("line", config, { x: [timeX], y: [yField()], breakdown: [breakdown] });
  const data = () => [timeRows({ api: [1, 2, 3], web: [4, 5, 6] })];

  it("single uses an item tooltip whose formatter takes one row", async () => {
    const options = await viaPanel(panel({ tooltip_mode: "single" }), data());
    expect(options.tooltip.trigger).toBe("item");
    expect(options.tooltip.formatter(timePoint("api", 7))).toContain("api : ");
  });

  it("all keeps the axis tooltip", async () => {
    const options = await viaPanel(panel({ tooltip_mode: "all" }), data());
    expect(options.tooltip.trigger).toBe("axis");
  });

  it("hidden turns the tooltip off (PromQL too)", async () => {
    expect((await viaPanel(panel({ tooltip_mode: "hidden" }), data())).tooltip.show).toBe(false);
    const prom = await viaPanel(promPanel("line", { tooltip_mode: "hidden" }), promData());
    expect(prom.tooltip.show).toBe(false);
  });

  it("the state-timeline value is ignored by cartesian charts", async () => {
    const options = await viaPanel(panel({ tooltip_mode: "all_rows" }), data());
    expect(options.tooltip.trigger).toBe("axis");
    expect(options.tooltip.show).not.toBe(false);
  });
});

describe("tooltip_sort", () => {
  const rows = (options: any, points: any[]) =>
    String(options.tooltip.formatter(points))
      .split("<br/>")
      .slice(1)
      .map((row) => row.trim().split(" : ")[0]);
  const points = () => [timePoint("low", 1), timePoint("high", 9, 1), timePoint("mid", 5, 2)];

  it("defaults to value descending", async () => {
    const options = await viaPanel(
      sqlPanel("line", {}, { x: [timeX], y: [yField()], breakdown: [breakdown] }),
      [timeRows({ low: [1, 1, 1], high: [9, 9, 9], mid: [5, 5, 5] })],
    );
    expect(rows(options, points())).toEqual(["high", "mid", "low"]);
    expect(options.tooltip.order).toBeUndefined();
  });

  it("asc and none reorder SQL rows and set the ECharts order", async () => {
    const panel = (tooltip_sort: string) =>
      sqlPanel("line", { tooltip_sort }, { x: [timeX], y: [yField()], breakdown: [breakdown] });
    const data = () => [timeRows({ low: [1, 1, 1], high: [9, 9, 9], mid: [5, 5, 5] })];
    const asc = await viaPanel(panel("asc"), data());
    expect(rows(asc, points())).toEqual(["low", "mid", "high"]);
    expect(asc.tooltip.order).toBe("valueAsc");
    const none = await viaPanel(panel("none"), data());
    expect(rows(none, points())).toEqual(["low", "high", "mid"]);
    expect(none.tooltip.order).toBe("seriesAsc");
  });

  it("asc reorders PromQL rows", async () => {
    const options = await viaPanel(promPanel("line", { tooltip_sort: "asc" }), promData());
    const point = (name: string, value: number, index: number) => ({
      ...timePoint(name, value, index),
      data: [promTimes[2] * 1000, value],
      value: [promTimes[2] * 1000, value],
    });
    const html = String(options.tooltip.formatter([point("api", 1200, 0), point("web", 900, 1)]));
    expect(html.indexOf("web")).toBeLessThan(html.indexOf("api"));
  });
});

describe("y_axis_scale log", () => {
  it("SQL line: log axis with the chosen base; values at or below 0 become gaps", async () => {
    const options = await viaPanel(
      sqlPanel(
        "line",
        { y_axis_scale: "log", y_axis_log_base: 2 },
        { x: [timeX], y: [yField()], breakdown: [breakdown] },
      ),
      [timeRows({ api: [0, 4, 8] })],
    );
    expect(options.yAxis.type).toBe("log");
    expect(options.yAxis.logBase).toBe(2);
    expect(named(options, "api").data.map(yOf)).toEqual([null, 4, 8]);
  });

  it("h-bar puts the log scale on the x value axis", async () => {
    const options = await viaPanel(
      sqlPanel("h-bar", { y_axis_scale: "log" }, { x: [endpointX], y: [yField()] }),
      [plainCategoryRows()],
    );
    expect(options.xAxis.type).toBe("log");
    expect(options.xAxis.logBase).toBe(10);
  });

  it("PromQL line", async () => {
    const options = await viaPanel(promPanel("line", { y_axis_scale: "log" }), promData());
    expect(options.yAxis.type).toBe("log");
  });
});

describe("y_axis_label", () => {
  it("names the SQL value axis in the middle and widens the left inset", async () => {
    const panel = (config: any) =>
      sqlPanel("line", config, {
        x: [timeX],
        y: [yField(), yField("y_axis_2", "Other")],
      });
    const rows = [TIMES.map((t, i) => ({ x_axis_1: t, y_axis_1: i, y_axis_2: i * 2 }))].flat();
    const plain = await viaPanel(panel({}), [rows]);
    const options = await viaPanel(panel({ y_axis_label: "Requests" }), [rows]);
    expect(options.yAxis.name).toBe("Requests");
    expect(options.yAxis.nameLocation).toBe("middle");
    expect(options.yAxis.nameGap).toBeGreaterThan(0);
    expect(options.grid.left).toBeGreaterThan(plain.grid.left);
  });

  it("names the x value axis on h-bar and the PromQL y axis", async () => {
    const hbar = await viaPanel(
      sqlPanel("h-bar", { y_axis_label: "Count" }, { x: [endpointX], y: [yField()] }),
      [plainCategoryRows()],
    );
    expect(hbar.xAxis.name).toBe("Count");
    const prom = await viaPanel(promPanel("line", { y_axis_label: "Rate" }), promData());
    expect(prom.yAxis.name).toBe("Rate");
    expect(prom.yAxis.nameGap).toBeGreaterThan(0);
  });
});

describe("y_axis_soft_min / soft_max", () => {
  const panel = (config: any) =>
    sqlPanel("line", config, { x: [timeX], y: [yField()], breakdown: [breakdown] });

  it("extends the extent but never shrinks it", async () => {
    const options = await viaPanel(panel({ y_axis_soft_min: -10, y_axis_soft_max: 500 }), [
      timeRows(),
    ]);
    expect(options.yAxis.min({ min: 0, max: 100 })).toBe(-10);
    expect(options.yAxis.max({ min: 0, max: 100 })).toBe(500);
    expect(options.yAxis.max({ min: 0, max: 900 })).toBe(900);
  });

  it("a hard min/max wins", async () => {
    const options = await viaPanel(
      panel({ y_axis_soft_min: -10, y_axis_min: 0, y_axis_soft_max: 500, y_axis_max: 2000 }),
      [timeRows()],
    );
    expect(typeof options.yAxis.min).not.toBe("function");
    expect(typeof options.yAxis.max).not.toBe("function");
  });

  it("applies to PromQL", async () => {
    const options = await viaPanel(promPanel("line", { y_axis_soft_max: 5000 }), promData());
    expect(options.yAxis.max({ min: 0, max: 1200 })).toBe(5000);
  });
});

describe("line_style", () => {
  it("dashes every line series; a series override wins", async () => {
    const panel = sqlPanel(
      "line",
      { line_style: "dashed", ...overrides({ value: "web", lineStyle: "dotted" }) },
      { x: [timeX], y: [yField()], breakdown: [breakdown] },
    );
    const options = await viaPanel(panel, [timeRows({ api: [1, 2, 3], web: [4, 5, 6] })]);
    expect(named(options, "api").lineStyle.type).toBe("dashed");
    expect(named(options, "web").lineStyle.type).toBe("dotted");
  });

  it("PromQL line", async () => {
    const options = await viaPanel(promPanel("area", { line_style: "dotted" }), promData());
    expect(dataSeries(options).every((s: any) => s.lineStyle.type === "dotted")).toBe(true);
  });
});

describe("stack_mode percent", () => {
  it("SQL stacked: each bucket sums to 100, axis is 0-100 and the tooltip shows share and raw", async () => {
    const options = await viaPanel(
      sqlPanel(
        "stacked",
        { stack_mode: "percent" },
        { x: [endpointX], y: [yField()], breakdown: [breakdown] },
      ),
      [categoryRows()],
    );
    const api = named(options, "api");
    const web = named(options, "web");
    api.data.forEach((point: any, i: number) => {
      expect((yOf(point) ?? 0) + (yOf(web.data[i]) ?? 0)).toBeCloseTo(100);
    });
    expect(options.yAxis.max).toBe(100);
    expect(options.yAxis.min).toBe(0);
    expect(options.yAxis.axisLabel.formatter(50)).toBe("50%");
    const apiIndex = options.series.indexOf(api);
    const html = options.tooltip.formatter([
      {
        seriesName: "api",
        seriesIndex: apiIndex,
        dataIndex: 0,
        marker: "",
        name: "/a",
        value: yOf(api.data[0]),
      },
    ]);
    expect(html).toContain("75%");
    expect(html).toContain("300");
  });

  it("SQL area-stacked over time and PromQL area-stacked", async () => {
    const sql = await viaPanel(
      sqlPanel(
        "area-stacked",
        { stack_mode: "percent" },
        { x: [timeX], y: [yField()], breakdown: [breakdown] },
      ),
      [timeRows({ api: [1, 1, 3], web: [3, 1, 1] })],
    );
    expect(named(sql, "api").data.map(yOf)).toEqual([25, 50, 75]);
    const prom = await viaPanel(promPanel("area-stacked", { stack_mode: "percent" }), promData());
    const api = named(prom, "api").data.map(yOf);
    const web = named(prom, "web").data.map(yOf);
    api.forEach((v: number, i: number) => expect(v + web[i]).toBeCloseTo(100));
  });

  it("PromQL stacked (modular converter)", async () => {
    const prom = await viaPanel(promPanel("stacked", { stack_mode: "percent" }), promData());
    expect(prom.yAxis.max).toBe(100);
    expect(yOf(named(prom, "api").data[0]) + yOf(named(prom, "web").data[0])).toBeCloseTo(100);
  });

  it("normal stacking is untouched", async () => {
    const panel = (config: any) =>
      sqlPanel("stacked", config, { x: [endpointX], y: [yField()], breakdown: [breakdown] });
    const today = await viaPanel(panel({}), [categoryRows()]);
    const normal = await viaPanel(panel({ stack_mode: "normal" }), [categoryRows()]);
    expect(serialize(normal)).toBe(serialize(today));
  });
});

describe("connect_nulls_threshold", () => {
  const times = [
    "2024-01-01T00:00:00",
    "2024-01-01T00:10:00",
    "2024-01-01T00:20:00",
    "2024-01-01T01:00:00",
  ];
  const rows = () =>
    times.map((t, i) => ({ x_axis_1: t, breakdown_1: "api", y_axis_1: [1, null, 3, 4][i] }));
  const panel = (config: any) =>
    sqlPanel("line", config, { x: [timeX], y: [yField()], breakdown: [breakdown] });

  it("bridges short gaps and breaks long ones", async () => {
    const options = await viaPanel(panel({ connect_nulls: true, connect_nulls_threshold: 1500 }), [
      rows(),
    ]);
    const api = named(options, "api");
    expect(api.connectNulls).toBe(false);
    const ys = api.data.map(yOf);
    // The 20-minute gap is bridged; the 40-minute one gets a single null break.
    expect(ys.filter((y: any) => y === null)).toHaveLength(1);
    expect(ys.slice(0, 2)).toEqual([1, 3]);
  });

  it("does nothing while connect nulls is off", async () => {
    const today = await viaPanel(panel({ connect_nulls: false }), [rows()]);
    const options = await viaPanel(panel({ connect_nulls: false, connect_nulls_threshold: 1500 }), [
      rows(),
    ]);
    expect(serialize(options)).toBe(serialize(today));
  });

  it("applies to PromQL lines", async () => {
    const data = [
      {
        resultType: "matrix",
        result: [
          {
            metric: { service: "api" },
            values: [
              [1704067200, "1"],
              [1704067260, "2"],
              [1704070800, "3"],
            ],
          },
        ],
      },
    ];
    const options = await viaPanel(
      promPanel("line", { connect_nulls: true, connect_nulls_threshold: 600 }),
      data,
    );
    const ys = named(options, "api").data.map(yOf);
    expect(ys.filter((y: any) => y === null)).toHaveLength(1);
  });
});

describe("bar_radius", () => {
  it("rounds every plain bar and only the top of a stack", async () => {
    const bar = await viaPanel(
      sqlPanel("bar", { bar_radius: 4 }, { x: [endpointX], y: [yField()] }),
      [plainCategoryRows()],
    );
    expect(dataSeries(bar)[0].itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
    const stacked = await viaPanel(
      sqlPanel(
        "stacked",
        { bar_radius: 6 },
        { x: [endpointX], y: [yField()], breakdown: [breakdown] },
      ),
      [categoryRows()],
    );
    const [bottom, top] = dataSeries(stacked);
    expect(bottom.itemStyle?.borderRadius).toBeUndefined();
    expect(top.itemStyle.borderRadius).toEqual([6, 6, 0, 0]);
  });

  it("rounds the right end of horizontal bars (PromQL h-stacked)", async () => {
    const options = await viaPanel(promPanel("h-stacked", { bar_radius: 3 }), promData());
    const series = dataSeries(options);
    expect(series[series.length - 1].itemStyle.borderRadius).toEqual([0, 3, 3, 0]);
    expect(series[0].itemStyle?.borderRadius).toBeUndefined();
  });
});

describe("sort_order", () => {
  it("sorts SQL bar categories by value", async () => {
    const desc = await viaPanel(
      sqlPanel("bar", { sort_order: "desc" }, { x: [endpointX], y: [yField()] }),
      [plainCategoryRows()],
    );
    expect(desc.xAxis[0].data).toEqual(["/b", "/c", "/a"]);
    expect(dataSeries(desc)[0].data).toEqual([900, 400, 100]);
    const asc = await viaPanel(
      sqlPanel("h-bar", { sort_order: "asc" }, { x: [endpointX], y: [yField()] }),
      [plainCategoryRows()],
    );
    expect(asc.yAxis[0].data).toEqual(["/a", "/c", "/b"]);
  });

  it("sorts PromQL h-bar categories", async () => {
    const options = await viaPanel(promPanel("h-bar", { sort_order: "asc" }), promData());
    expect(options.yAxis.data).toEqual(["web", "api"]);
  });

  it("leaves time-series bars alone", async () => {
    const panel = (config: any) =>
      sqlPanel("bar", config, { x: [timeX], y: [yField()], breakdown: [breakdown] });
    const today = await viaPanel(panel({}), [timeRows()]);
    const sorted = await viaPanel(panel({ sort_order: "desc" }), [timeRows()]);
    expect(serialize(sorted)).toBe(serialize(today));
  });
});

describe("mark_area", () => {
  it("adds a nameless helper series carrying the bands", async () => {
    const options = await viaPanel(
      sqlPanel(
        "line",
        {
          mark_area: [
            { name: "SLO", axis: "y", from: "100", to: "500", color: "#00ff00" },
            { axis: "x", from: "", to: "x" },
          ],
        },
        { x: [timeX], y: [yField()], breakdown: [breakdown] },
      ),
      [timeRows()],
    );
    const helper = options.series[options.series.length - 1];
    expect(helper.name).toBeUndefined();
    expect(helper.data).toEqual([]);
    expect(helper.markArea.data).toEqual([
      [{ name: "SLO", yAxis: 100, itemStyle: { color: "#00ff00", opacity: 0.18 } }, { yAxis: 500 }],
    ]);
  });

  it("PromQL keeps x values as given", async () => {
    const options = await viaPanel(
      promPanel("line", {
        mark_area: [{ axis: "x", from: "2024-01-01 00:00:00", to: "2024-01-01 00:10:00" }],
      }),
      promData(),
    );
    const helper = options.series[options.series.length - 1];
    expect(helper.markArea.data[0][0].xAxis).toBe("2024-01-01 00:00:00");
  });
});

describe("scatter size and color fields", () => {
  it("folds the size/color series into the plotted one", async () => {
    const panel = sqlPanel(
      "scatter",
      {
        scatter_size_field: "y_axis_2",
        scatter_color_field: "y_axis_3",
        scatter_size_min: 2,
        scatter_size_max: 10,
      },
      { x: [endpointX], y: [yField(), yField("y_axis_2", "Size"), yField("y_axis_3", "Heat")] },
    );
    const rows = plainCategoryRows().map((r, i) => ({
      ...r,
      y_axis_2: [1, 5, 3][i],
      y_axis_3: [0, 50, 100][i],
    }));
    const options = await viaPanel(panel, [rows]);
    const series = dataSeries(options);
    expect(series).toHaveLength(1);
    expect(series[0].data[1]).toEqual([1, 900, 5, 50]);
    expect(series[0].symbolSize(series[0].data[0])).toBe(2);
    expect(series[0].symbolSize(series[0].data[1])).toBe(10);
    expect(options.visualMap).toMatchObject({ dimension: 3, min: 0, max: 100, seriesIndex: [0] });
    const html = options.tooltip.formatter([
      {
        seriesName: series[0].name,
        marker: "",
        name: "/b",
        data: series[0].data[1],
        value: series[0].data[1],
      },
    ]);
    expect(html).toContain("900");
  });
});

describe("series override styles", () => {
  const panel = (type: string, ...entries: any[]) =>
    sqlPanel(type, overrides(...entries), { x: [timeX], y: [yField()], breakdown: [breakdown] });
  const data = () => [timeRows({ api: [1, 2, 3], web: [40, 50, 60] })];

  it("axis_placement right adds a right axis; hidden adds an invisible one", async () => {
    const options = await viaPanel(
      panel(
        "line",
        { value: "web", axisPlacement: "right" },
        { value: "api", axisPlacement: "hidden" },
      ),
      data(),
    );
    expect(options.yAxis).toHaveLength(3);
    expect(options.yAxis[1]).toMatchObject({ position: "right", show: true });
    expect(options.yAxis[2].show).toBe(false);
    expect(named(options, "web").yAxisIndex).toBe(1);
    expect(named(options, "api").yAxisIndex).toBe(2);
  });

  it("transform negative_y negates data but shows magnitudes", async () => {
    const options = await viaPanel(
      panel("line", { value: "web", transform: "negative_y" }),
      data(),
    );
    expect(named(options, "web").data.map(yOf)).toEqual([-40, -50, -60]);
    const html = options.tooltip.formatter([timePoint("web", -60)]);
    expect(html).toContain("60");
    expect(html).not.toContain("-60");
    expect(options.yAxis.axisLabel.formatter(-50)).toBe(options.yAxis.axisLabel.formatter(50));
  });

  it("draw_style switches the series type", async () => {
    const options = await viaPanel(
      panel("area", { value: "web", drawStyle: "bars" }, { value: "api", drawStyle: "points" }),
      data(),
    );
    expect(named(options, "web").type).toBe("bar");
    expect(named(options, "web").areaStyle).toBeUndefined();
    expect(named(options, "api").type).toBe("scatter");
  });

  it("applies on PromQL lines", async () => {
    const options = await viaPanel(
      promPanel("line", overrides({ value: "web", axisPlacement: "right", drawStyle: "bars" })),
      promData(),
    );
    expect(Array.isArray(options.yAxis)).toBe(true);
    expect(named(options, "web")).toMatchObject({ yAxisIndex: 1, type: "bar" });
  });
});
