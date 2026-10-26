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
import { convertMultiSQLData } from "./convertSQLData";
import { convertPromQLData } from "./convertPromQLData";
import { applyLineAreaThresholds, echartsPaletteColor } from "./thresholds";
import { toSeriesOverrideEntry } from "./seriesOverrides";

// Chart overrides are stored as `series` / `series_regex` entries of override_config.
const seriesEntries = (overrides: any[]) =>
  overrides.map((o) => toSeriesOverrideEntry(o)).filter((e) => e !== null);

const AMBER = "#F59E0B";
const RED = "#EF4444";
const GREEN = "#22C55E";
const STEPS = {
  steps: [
    { value: 500, color: AMBER },
    { value: 1000, color: RED },
  ],
};

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
const yField = (label = "Latency") => ({
  label,
  alias: "y_axis_1",
  column: "latency",
  functionName: "avg",
  aggregationFunction: "avg",
  args: [{ type: "field", value: { field: "latency" } }],
});
const breakdown = { label: "Service", alias: "breakdown_1", column: "service", args: [] };
const serviceX = { label: "Service", alias: "x_axis_1", column: "service", args: [] };

const sqlQuery = (fields: Record<string, any>, config: Record<string, any> = {}) => ({
  query: "SELECT 1",
  customQuery: false,
  fields: { stream: "default", stream_type: "logs", z: [], breakdown: [], ...fields },
  config: { min: 0, max: 2000, ...config },
});

const sqlPanel = (type: string, config: Record<string, any>, queries: any[]) => ({
  id: "p",
  type,
  queryType: "sql",
  queries,
  config: { show_legends: true, unit: "milliseconds", decimals: 0, ...config },
});

const runSQL = async (panel: any, data: any[]) => {
  const result: any = await convertMultiSQLData(
    panel,
    data,
    store,
    panelRef(),
    { value: null },
    { value: [] },
    {
      queries: data.map((_, i) => ({
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
  return result.options;
};

const breakdownRows = (services: Record<string, number[]>) =>
  TIMES.flatMap((t, i) =>
    Object.entries(services).map(([service, values]) => ({
      x_axis_1: t,
      breakdown_1: service,
      y_axis_1: values[i],
    })),
  );

const lineSQL = (type: string, thresholds: any, config: Record<string, any> = {}) =>
  sqlPanel(type, { thresholds, ...config }, [
    sqlQuery({ x: [timeX], y: [yField()], breakdown: [breakdown] }),
  ]);

const dataSeries = (options: any) => options.series.filter((s: any) => s.name);
const markers = (options: any) =>
  options.series.filter((s: any) => !s.name && Array.isArray(s.data) && s.data.length === 0);

describe("SQL line/area", () => {
  const rows = () => [breakdownRows({ api: [100, 600, 1200], web: [50, 300, 900] })];

  it("adds one visualMap per series, indexed into the final series list", async () => {
    const options = await runSQL(lineSQL("line", STEPS), rows());
    const named = dataSeries(options);
    expect(named.map((s: any) => s.name)).toEqual(["api", "web"]);
    expect(options.visualMap.map((v: any) => v.seriesIndex)).toEqual(
      named.map((s: any) => options.series.indexOf(s)),
    );
    expect(options.visualMap[0]).toMatchObject({ show: false, dimension: 1 });
  });

  it("draws the limit lines once, on a marker series after the data series", async () => {
    const options = await runSQL(lineSQL("line", STEPS), rows());
    const found = markers(options);
    expect(found).toHaveLength(1);
    expect(options.series.indexOf(found[0])).toBe(options.series.length - 1);
    const lines = found[0].markLine.data;
    expect(lines.map((d: any) => [d.yAxis, d.lineStyle.color])).toEqual([
      [500, AMBER],
      [1000, RED],
    ]);
    expect(lines[0].label.formatter()).toBe("500ms");
    expect(dataSeries(options).every((s: any) => s.markLine.data.length === 0)).toBe(true);
  });

  it("area: the fill follows the steps instead of the series gradient", async () => {
    const plain = await runSQL(lineSQL("area", undefined), rows());
    expect(dataSeries(plain)[0].areaStyle.color).toBeDefined();
    const options = await runSQL(lineSQL("area", STEPS), rows());
    expect(dataSeries(options)[0].areaStyle.color).toBeUndefined();
  });

  it("area-stacked keeps its colours and gets limit lines only", async () => {
    const options = await runSQL(lineSQL("area-stacked", STEPS), rows());
    expect(options.visualMap).toBeUndefined();
    expect(dataSeries(options)[0].areaStyle.color).toBeDefined();
    expect(markers(options)[0].markLine.data).toHaveLength(2);
  });

  it("color_band adds bands once", async () => {
    const options = await runSQL(lineSQL("line", { ...STEPS, showAs: "color_band" }), rows());
    expect(markers(options)[0].markArea.data).toHaveLength(2);
  });

  it("stacked bar panels ignore thresholds", async () => {
    const options = await runSQL(lineSQL("stacked", STEPS), rows());
    expect(options.visualMap).toBeUndefined();
  });

  it("multi-query: every merged series is coloured by its final index", async () => {
    const panel = sqlPanel("line", { thresholds: STEPS }, [
      sqlQuery({ x: [timeX], y: [yField()] }),
      sqlQuery({ x: [timeX], y: [yField("Other")] }),
    ]);
    const single = TIMES.map((t, i) => ({ x_axis_1: t, y_axis_1: [100, 700, 1100][i] }));
    const options = await runSQL(panel, [single, single]);
    const named = dataSeries(options);
    expect(named).toHaveLength(2);
    expect(options.visualMap.map((v: any) => v.seriesIndex)).toEqual(
      named.map((s: any) => options.series.indexOf(s)),
    );
  });

  it("axis tooltip marks rows at or above a step and stretches the axis to the limits", async () => {
    const options = await runSQL(lineSQL("line", STEPS), rows());
    const point = (seriesName: string, v: number, i: number) => ({
      seriesName,
      marker: `<i id="${i}"></i>`,
      data: [new Date(0), v],
      value: [new Date(0), v],
    });
    const html = options.tooltip.formatter([point("api", 1200, 0), point("web", 300, 1)]);
    expect(html).toContain("api : 1s · over 1s");
    expect(html).toContain("web : 300ms");
    expect(options.yAxis.max({ min: 0, max: 400 })).toBeGreaterThan(1000);
  });

  it("percentage steps resolve against the y-axis range", async () => {
    const pct = { mode: "percentage", steps: [{ value: 50, color: RED }] };
    const panel = lineSQL("line", pct, { y_axis_min: 0, y_axis_max: 3000 });
    const options = await runSQL(panel, rows());
    expect(options.visualMap[0].pieces[0]).toEqual({ gte: 1500, lt: 3000, color: RED });
  });
});

describe("SQL gauge", () => {
  const gaugePanel = (thresholds: any, color?: any) =>
    sqlPanel("gauge", { thresholds, color }, [sqlQuery({ x: [serviceX], y: [yField()] })]);
  const rows = [
    { x_axis_1: "api", y_axis_1: 640 },
    { x_axis_1: "web", y_axis_1: 1500 },
  ];

  it("bands the arc and colours progress by the value's step", async () => {
    const fixed = { mode: "fixed", fixedColor: ["#112233"] };
    const options = await runSQL(gaugePanel(STEPS, fixed), [rows]);
    const [api, web] = options.series;
    expect(api.data[0].itemStyle.color).toBe(AMBER);
    expect(web.data[0].itemStyle.color).toBe(RED);
    expect(api.axisLine.lineStyle.color).toEqual([
      [0.25, "rgba(17, 34, 51, 0.28)"],
      [0.5, "rgba(245, 158, 11, 0.28)"],
      [1, "rgba(239, 68, 68, 0.28)"],
    ]);
  });

  it("percentage steps use the gauge min..max", async () => {
    const pct = { mode: "percentage", steps: [{ value: 50, color: RED }] };
    const options = await runSQL(gaugePanel(pct), [rows]);
    expect(options.series[0].data[0].itemStyle.color).not.toBe(RED);
    expect(options.series[1].data[0].itemStyle.color).toBe(RED);
    expect(options.series[0].axisLine.lineStyle.color[0][0]).toBe(0.5);
  });

  it("multi-query grid keeps the bands and step colours", async () => {
    const panel = sqlPanel("gauge", { thresholds: { ...STEPS, baseColor: GREEN } }, [
      sqlQuery({ x: [], y: [yField()] }, { min: 0, max: 1000 }),
      sqlQuery({ x: [], y: [yField("Other")] }, { min: 0, max: 3000 }),
    ]);
    const options = await runSQL(panel, [[{ y_axis_1: 200 }], [{ y_axis_1: 2500 }]]);
    expect(options.series).toHaveLength(2);
    expect(options.series[0].data[0].itemStyle.color).toBe(GREEN);
    expect(options.series[1].data[0].itemStyle.color).toBe(RED);
    expect(options.series[0].axisLine.lineStyle.color[0]).toEqual([0.5, "rgba(34, 197, 94, 0.28)"]);
    expect(options.series[1].axisLine.lineStyle.width).toBeDefined();
  });

  it("multi-query dials below the first step keep their own palette colour", async () => {
    const classic = { mode: "palette-classic" };
    const panel = sqlPanel(
      "gauge",
      { thresholds: { steps: [{ value: 90, color: RED }] }, color: classic },
      [
        sqlQuery({ x: [serviceX], y: [yField()] }, { min: 0, max: 100 }),
        sqlQuery({ x: [serviceX], y: [yField("Other")] }, { min: 0, max: 100 }),
      ],
    );
    const options = await runSQL(panel, [
      [{ x_axis_1: "alpha", y_axis_1: 30 }],
      [{ x_axis_1: "beta", y_axis_1: 50 }],
    ]);
    expect(options.series[0].data[0].itemStyle.color).toBe(echartsPaletteColor(0));
    expect(options.series[1].data[0].itemStyle.color).toBe(echartsPaletteColor(1));
  });
});

describe("SQL metric", () => {
  const metricPanel = (config: Record<string, any>, queries = 1) =>
    sqlPanel(
      "metric",
      config,
      Array.from({ length: queries }, () => sqlQuery({ x: [], y: [yField()] })),
    );
  const background = { type: "single", value: { color: "#1e40af" } };

  it("takes the step colour as background", async () => {
    const options = await runSQL(metricPanel({ thresholds: STEPS, background }), [
      [{ y_axis_1: 640 }],
    ]);
    expect(options.backgroundColor).toBe(AMBER);
  });

  it("falls back to the Background colour below the first step", async () => {
    const options = await runSQL(metricPanel({ thresholds: STEPS, background }), [
      [{ y_axis_1: 10 }],
    ]);
    expect(options.backgroundColor).toBe("#1e40af");
  });

  it("uses the base colour below the first step when set", async () => {
    const config = { thresholds: { ...STEPS, baseColor: GREEN }, background };
    const options = await runSQL(metricPanel(config), [[{ y_axis_1: 10 }]]);
    expect(options.backgroundColor).toBe(GREEN);
  });

  it("a value mapping colour wins over the step", async () => {
    const mappings = [{ type: "value", value: "1200", color: "#e02f44", text: "High" }];
    const options = await runSQL(metricPanel({ thresholds: STEPS, mappings }), [
      [{ y_axis_1: 1200 }],
    ]);
    expect(options.backgroundColor).toBe("#e02f44");
  });

  it("ignores percentage mode (absolute)", async () => {
    const options = await runSQL(metricPanel({ thresholds: { ...STEPS, mode: "percentage" } }), [
      [{ y_axis_1: 640 }],
    ]);
    expect(options.backgroundColor).toBe(AMBER);
  });

  it("multi-query grid paints each cell in its own step colour", async () => {
    const options = await runSQL(metricPanel({ thresholds: STEPS, background }, 2), [
      [{ y_axis_1: 640 }],
      [{ y_axis_1: 1500 }],
    ]);
    expect(options.series.map((s: any) => s._metricBgColor)).toEqual([AMBER, RED]);
    expect(options.backgroundColor).toBe("#1e40af");
  });
});

const promTimes = [1704067200, 1704067800, 1704068400];
const promMatrix = (series: Record<string, number[]>) => ({
  resultType: "matrix",
  result: Object.entries(series).map(([service, values]) => ({
    metric: { service },
    values: values.map((v, i) => [promTimes[i], String(v)]),
  })),
});
const promPanel = (type: string, config: Record<string, any>, queries = 1) => ({
  id: "pq",
  type,
  queryType: "promql",
  queries: Array.from({ length: queries }, (_, i) => ({
    query: `rate(latency_${i}[5m])`,
    customQuery: true,
    fields: { stream: "latency", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
    config: { promql_legend: "{service}", min: 0, max: 2000 },
  })),
  config: { show_legends: true, unit: "milliseconds", decimals: 0, ...config },
});
const runPromQL = async (panel: any, data: any[]) => {
  const result: any = await convertPromQLData(
    panel,
    data,
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

describe("PromQL", () => {
  const two = () => [promMatrix({ api: [100, 600, 1200], web: [50, 300, 900] })];

  it("line: visualMap per series and limit lines once", async () => {
    const options = await runPromQL(promPanel("line", { thresholds: STEPS }), two());
    const named = dataSeries(options);
    expect(options.visualMap.map((v: any) => v.seriesIndex)).toEqual(
      named.map((s: any) => options.series.indexOf(s)),
    );
    expect(markers(options)).toHaveLength(1);
    expect(markers(options)[0].markLine.data).toHaveLength(2);
  });

  it("area: fill follows the steps; area-stacked is not recoloured", async () => {
    const area = await runPromQL(promPanel("area", { thresholds: STEPS }), two());
    expect(dataSeries(area)[0].areaStyle.color).toBeUndefined();
    const stacked = await runPromQL(promPanel("area-stacked", { thresholds: STEPS }), two());
    expect(stacked.visualMap).toBeUndefined();
    expect(dataSeries(stacked)[0].areaStyle.color).toBeDefined();
  });

  it("gauge: bands and step colour per gauge, palette colour as the base", async () => {
    const options = await runPromQL(promPanel("gauge", { thresholds: STEPS }), two());
    const [api, web] = options.series;
    expect(api.data[0].itemStyle.color).toBe(RED);
    expect(web.data[0].itemStyle.color).toBe(AMBER);
    expect(api.axisLine.lineStyle.color).toHaveLength(3);
  });

  it("gauge: multi-query keeps thresholds on every gauge", async () => {
    const panel = promPanel("gauge", { thresholds: STEPS }, 2);
    const options = await runPromQL(panel, [
      promMatrix({ api: [1, 2, 300] }),
      promMatrix({ web: [1, 2, 1300] }),
    ]);
    expect(options.series.map((s: any) => s.data[0].itemStyle.color)).toEqual([
      expect.any(String),
      RED,
    ]);
    expect(options.series[0].axisLine.lineStyle.color).toHaveLength(3);
  });

  it("line: axis tooltip marks rows at or above a step", async () => {
    const options = await runPromQL(promPanel("line", { thresholds: STEPS }), two());
    const point = (seriesName: string, v: string, i: number) => ({
      seriesName,
      seriesIndex: i,
      dataIndex: 2,
      marker: `<i id="${i}"></i>`,
      data: [0, v],
      value: [0, v],
    });
    const html = options.tooltip.formatter([point("api", "1200", 0), point("web", "900", 1)]);
    expect(html).toContain("api : 1s · over 1s");
    expect(html).toContain("web : 900ms · over 500ms");
  });

  it("metric: step colour, mapping wins, background below", async () => {
    const background = { type: "single", value: { color: "#1e40af" } };
    const data = (v: number) => [promMatrix({ api: [1, 2, v] })];
    const step = await runPromQL(promPanel("metric", { thresholds: STEPS, background }), data(700));
    expect(step.backgroundColor).toBe(AMBER);
    const below = await runPromQL(promPanel("metric", { thresholds: STEPS, background }), data(7));
    expect(below.backgroundColor).toBe("#1e40af");
    const mappings = [{ type: "value", value: "700", color: "#e02f44" }];
    const mapped = await runPromQL(promPanel("metric", { thresholds: STEPS, mappings }), data(700));
    expect(mapped.backgroundColor).toBe("#e02f44");
  });
});

describe("gauge dial range for the 0.0-1.0 percent unit", () => {
  const rows = [
    { x_axis_1: "api", y_axis_1: 0.8 },
    { x_axis_1: "web", y_axis_1: 0.4 },
  ];
  const gauge = (config: Record<string, any>, queryConfig: Record<string, any>) =>
    sqlPanel("gauge", config, [sqlQuery({ x: [serviceX], y: [yField()] }, queryConfig)]);
  const ranges = (options: any) => options.series.map((s: any) => [s.min, s.max]);

  it("reads 0..1 when min/max are unset", async () => {
    const options = await runSQL(gauge({ unit: "percent-1" }, { min: undefined, max: undefined }), [
      rows,
    ]);
    expect(ranges(options)).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it("reads 0..1 when min/max are still the 0/100 defaults", async () => {
    const options = await runSQL(gauge({ unit: "percent-1" }, { min: 0, max: 100 }), [rows]);
    expect(ranges(options)[0]).toEqual([0, 1]);
  });

  it("keeps a user-chosen min/max", async () => {
    const options = await runSQL(gauge({ unit: "percent-1" }, { min: 0, max: 50 }), [rows]);
    expect(ranges(options)[0]).toEqual([0, 50]);
  });

  it("leaves other units on 0..100", async () => {
    const options = await runSQL(gauge({ unit: "percent" }, { min: undefined, max: undefined }), [
      rows,
    ]);
    expect(ranges(options)[0]).toEqual([0, 100]);
  });

  it("follows a series override unit per gauge in a multi-gauge grid", async () => {
    const config = {
      unit: "milliseconds",
      override_config: seriesEntries([{ matchBy: "name", value: "api", unit: "percent-1" }]),
    };
    const options = await runSQL(gauge(config, { min: undefined, max: undefined }), [rows]);
    expect(ranges(options)).toEqual([
      [0, 1],
      [0, 100],
    ]);
  });

  it("puts 70% / 90% thresholds at 0.7 / 0.9 of the 0..1 dial", async () => {
    const thresholds = {
      mode: "percentage",
      steps: [
        { value: 70, color: AMBER },
        { value: 90, color: RED },
      ],
    };
    const options = await runSQL(
      gauge({ unit: "percent-1", thresholds }, { min: undefined, max: undefined }),
      [rows],
    );
    const [api, web] = options.series;
    expect(api.axisLine.lineStyle.color.map((stop: any) => stop[0])).toEqual([0.7, 0.9, 1]);
    expect(api.data[0].itemStyle.color).toBe(AMBER);
    expect(web.data[0].itemStyle.color).not.toBe(AMBER);
  });

  it("PromQL gauges use the same rule", async () => {
    const panel = promPanel("gauge", { unit: "percent-1" });
    panel.queries[0].config = { promql_legend: "{service}" } as any;
    const options = await runPromQL(panel, [promMatrix({ api: [0.1, 0.5, 0.8] })]);
    expect([options.series[0].min, options.series[0].max]).toEqual([0, 1]);
  });
});

describe("bar, h-bar and scatter", () => {
  const categoryRows = [
    { x_axis_1: "api", y_axis_1: 1200 },
    { x_axis_1: "web", y_axis_1: 300 },
    { x_axis_1: "db", y_axis_1: 700 },
  ];
  const categoryPanel = (type: string, config: Record<string, any> = {}) =>
    sqlPanel(type, config, [sqlQuery({ x: [serviceX], y: [yField()] })]);
  const vmOf = (options: any) => options.visualMap ?? [];
  const axisOf = (axes: any) => (Array.isArray(axes) ? axes[0] : axes);
  const timeBreakdown = () => [breakdownRows({ api: [100, 600, 1200], web: [50, 300, 900] })];

  describe("panels without thresholds render as before", () => {
    for (const type of ["bar", "h-bar"]) {
      it(`SQL ${type}: no visualMap, no marker series, axis and tooltip untouched`, async () => {
        const options = await runSQL(categoryPanel(type), [categoryRows]);
        expect(options.visualMap).toBeUndefined();
        expect(markers(options)).toHaveLength(0);
        const valueAxis = axisOf(type === "h-bar" ? options.xAxis : options.yAxis);
        expect(typeof valueAxis.max).not.toBe("function");
        expect(options.series.every((s: any) => !s.markArea)).toBe(true);
      });
    }

    it("SQL scatter: no visualMap and no marker series", async () => {
      const options = await runSQL(lineSQL("scatter", undefined), timeBreakdown());
      expect(options.visualMap).toBeUndefined();
      expect(markers(options)).toHaveLength(0);
      expect(typeof axisOf(options.yAxis).max).not.toBe("function");
    });

    for (const type of ["bar", "h-bar", "scatter"]) {
      it(`PromQL ${type}: no visualMap, no marker series, item colours kept`, async () => {
        const data = [promMatrix({ api: [100, 600, 1200], web: [50, 300, 900] })];
        const plain = await runPromQL(promPanel(type, {}), data);
        expect(plain.visualMap).toBeUndefined();
        expect(markers(plain)).toHaveLength(0);
        const colours = (o: any) =>
          JSON.stringify(o.series.map((s: any) => s.data?.map((d: any) => d?.itemStyle?.color)));
        const again = await runPromQL(promPanel(type, { thresholds: undefined }), data);
        expect(colours(again)).toBe(colours(plain));
      });
    }
  });

  it("SQL bar: each bar takes its step colour via a visualMap on the y value", async () => {
    const options = await runSQL(categoryPanel("bar", { thresholds: STEPS }), [categoryRows]);
    expect(vmOf(options)).toHaveLength(1);
    expect(vmOf(options)[0]).toMatchObject({ dimension: 1, seriesIndex: 0 });
    const lines = markers(options)[0].markLine.data;
    expect(lines.map((d: any) => d.yAxis)).toEqual([500, 1000]);
  });

  it("SQL bar: tooltip rows at or above a step get the cue", async () => {
    const options = await runSQL(categoryPanel("bar", { thresholds: STEPS }), [categoryRows]);
    const html = options.tooltip.formatter([
      { seriesName: "Latency", name: "api", marker: "<i></i>", value: 1200, data: 1200 },
    ]);
    expect(html).toContain("Latency : 1s · over 1s");
  });

  it("SQL h-bar: colours on the x value, vertical limit lines, value axis stretched", async () => {
    const high = { steps: [{ value: 2000, color: RED }] };
    const options = await runSQL(categoryPanel("h-bar", { thresholds: high }), [categoryRows]);
    expect(vmOf(options)[0]).toMatchObject({ dimension: 0 });
    const [line] = markers(options)[0].markLine.data;
    expect(line.xAxis).toBe(2000);
    expect(line.yAxis).toBeUndefined();
    expect(line.label.position).toBe(axisOf(options.yAxis).inverse ? "start" : "end");
    const plain = await runSQL(categoryPanel("h-bar"), [categoryRows]);
    expect(options.grid.top).toBe(plain.grid.top + 16);
    expect(axisOf(options.xAxis).max({ min: 0, max: 1200 })).toBe(2500);
  });

  it("SQL h-bar: color_band draws bands along the x axis", async () => {
    const panel = categoryPanel("h-bar", { thresholds: { ...STEPS, showAs: "color_band" } });
    const options = await runSQL(panel, [categoryRows]);
    const bands = markers(options)[0].markArea.data;
    expect(bands.map((b: any) => [b[0].xAxis, b[1].xAxis])).toEqual([
      [500, 1000],
      [1000, Infinity],
    ]);
  });

  it("SQL h-bar: percentage steps resolve against the value range of the data", async () => {
    const pct = { mode: "percentage", steps: [{ value: 50, color: RED }] };
    const options = await runSQL(categoryPanel("h-bar", { thresholds: pct }), [categoryRows]);
    // values 300..1200, so 50% is 750
    expect(markers(options)[0].markLine.data[0].xAxis).toBe(750);
  });

  it("showAs line on a bar draws lines without colouring", async () => {
    const panel = categoryPanel("bar", { thresholds: { ...STEPS, showAs: "line" } });
    const options = await runSQL(panel, [categoryRows]);
    expect(options.visualMap).toBeUndefined();
    expect(markers(options)[0].markLine.data).toHaveLength(2);
  });

  it("showAs color on a bar colours without lines", async () => {
    const panel = categoryPanel("bar", { thresholds: { ...STEPS, showAs: "color" } });
    const options = await runSQL(panel, [categoryRows]);
    expect(vmOf(options)).toHaveLength(1);
    expect(markers(options)).toHaveLength(0);
  });

  it("SQL scatter: points coloured by step with limit lines", async () => {
    const options = await runSQL(lineSQL("scatter", STEPS), timeBreakdown());
    expect(vmOf(options).map((v: any) => v.dimension)).toEqual([1, 1]);
    expect(markers(options)[0].markLine.data).toHaveLength(2);
  });

  it("a series override's steps apply to that bar series only", async () => {
    const config = {
      thresholds: STEPS,
      override_config: seriesEntries([
        { matchBy: "name", value: "api", thresholds: { steps: [{ value: 200, color: GREEN }] } },
      ]),
    };
    const options = await runSQL(lineSQL("bar", undefined, config), timeBreakdown());
    const pieces = (name: string) =>
      vmOf(options).find(
        (v: any) => v.seriesIndex === options.series.findIndex((s: any) => s.name === name),
      ).pieces;
    expect(pieces("api")[0]).toMatchObject({ gte: 200, color: GREEN });
    expect(pieces("web")[0]).toMatchObject({ gte: 500, color: AMBER });
  });

  for (const type of ["bar", "scatter"]) {
    it(`PromQL ${type}: visualMap per series and one set of limit lines`, async () => {
      const data = [promMatrix({ api: [100, 600, 1200], web: [50, 300, 900] })];
      const options = await runPromQL(promPanel(type, { thresholds: STEPS }), data);
      expect(vmOf(options).map((v: any) => v.dimension)).toEqual([1, 1]);
      expect(markers(options)[0].markLine.data.map((d: any) => d.yAxis)).toEqual([500, 1000]);
    });
  }

  it("PromQL h-bar: each bar item is recoloured by its step, lines on x, tooltip cue", async () => {
    const data = [promMatrix({ api: [100, 600, 1200], web: [50, 300, 400] })];
    const options = await runPromQL(promPanel("h-bar", { thresholds: STEPS }), data);
    expect(options.visualMap).toBeUndefined();
    const bars = options.series.find((s: any) => s.type === "bar" && !s.name);
    const values = bars.data.map((d: any) => d.value);
    const colours = bars.data.map((d: any) => d.itemStyle?.color);
    expect(colours[values.indexOf(1200)]).toBe(RED);
    expect(colours[values.indexOf(400)]).not.toBe(RED);
    expect(colours[values.indexOf(400)]).not.toBe(AMBER);
    expect(markers(options)[0].markLine.data.map((d: any) => d.xAxis)).toEqual([500, 1000]);
    const html = options.tooltip.formatter([
      { seriesName: "series0", name: "api", marker: "<i></i>", value: 1200, data: bars.data[0] },
    ]);
    expect(html).toContain("over 1s");
  });
});

describe("percentage steps on stacked areas use the stacked totals", () => {
  const pct80 = { mode: "percentage", steps: [{ value: 80, color: RED }] };
  const three = { a: [0, 50, 100], b: [0, 50, 100], c: [0, 50, 100] };
  const limit = (options: any) => markers(options)[0].markLine.data[0].yAxis;

  it("SQL area-stacked: 3 series of 0..100 put 80% at 240", async () => {
    const options = await runSQL(lineSQL("area-stacked", pct80), [breakdownRows(three)]);
    expect(limit(options)).toBe(240);
  });

  it("PromQL area-stacked: 3 series of 0..100 put 80% at 240", async () => {
    const options = await runPromQL(promPanel("area-stacked", { thresholds: pct80 }), [
      promMatrix(three),
    ]);
    expect(limit(options)).toBe(240);
  });

  for (const type of ["line", "area", "bar"]) {
    it(`SQL ${type} keeps the per-series range (80% at 80)`, async () => {
      const options = await runSQL(lineSQL(type, pct80), [breakdownRows(three)]);
      expect(limit(options)).toBe(80);
    });
  }

  it("a configured y-axis range still wins on stacked areas", async () => {
    const panel = lineSQL("area-stacked", pct80, { y_axis_min: 0, y_axis_max: 1000 });
    const options = await runSQL(panel, [breakdownRows(three)]);
    expect(limit(options)).toBe(800);
  });
});

describe("performance", () => {
  it("builds options for 100 series with 3 steps", async () => {
    const services: Record<string, number[]> = {};
    for (let i = 0; i < 100; i++) services[`svc-${i}`] = [i * 10, i * 20, i * 30];
    const thresholds = {
      steps: [
        { value: 300, color: GREEN },
        { value: 1000, color: AMBER },
        { value: 2000, color: RED },
      ],
    };
    const data = [promMatrix(services)];
    const built = await runPromQL(promPanel("line", { thresholds }), data);
    expect(built.visualMap).toHaveLength(100);
    const base = await runPromQL(promPanel("line", {}), data);
    const start = performance.now();
    applyLineAreaThresholds(base, promPanel("line", { thresholds }));
    const pass = performance.now() - start;
    expect(base.visualMap).toHaveLength(100);
    // Measured about 2 ms here; the bound only catches an accidental quadratic pass.
    expect(pass).toBeLessThan(500);
  }, 120000);
});
