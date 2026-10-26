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
import * as echarts from "echarts";
import { convertMultiSQLData } from "./convertSQLData";
import { convertPromQLData } from "./convertPromQLData";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { getAreaStyleOverride } from "./colorPalette";
import { toSeriesOverrideEntry } from "./seriesOverrides";
import { getLegendSeriesNames } from "@/composables/dashboard/useSeriesFormatting";

// Chart overrides are stored as `series` / `series_regex` entries of override_config.
const seriesEntries = (overrides: any[]) =>
  overrides.map((o) => toSeriesOverrideEntry(o)).filter((e) => e !== null);

const AMBER = "#F59E0B";
const RED = "#EF4444";
const GREEN = "#22C55E";
const OVERRIDE_COLOR = "#123456";
const DISPLAY = "Checkout API";
const STEPS = {
  steps: [
    { value: 500, color: AMBER },
    { value: 1000, color: RED },
  ],
};
// Regex form, so the same entry also proves `/pattern/flags` parsing end to end.
const API_OVERRIDE = {
  matchBy: "regex",
  value: "/^AP/i",
  displayName: DISPLAY,
  unit: "bytes",
  decimals: 2,
  color: OVERRIDE_COLOR,
};

const fmt = (value: number, unit: string, decimals: number) =>
  formatUnitValue(getUnitValue(value, unit, "", decimals));
const apiValue = (value: number) => fmt(value, "bytes", 2);
const panelValue = (value: number) => fmt(value, "milliseconds", 0);

// Functions serialise as a marker, as in the old-panel snapshot spec; their output is checked separately.
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
const serviceX = { label: "Service", alias: "x_axis_1", column: "service", args: [] };
const yField = (label = "Latency") => ({
  label,
  alias: "y_axis_1",
  column: "latency",
  functionName: "avg",
  aggregationFunction: "avg",
  args: [{ type: "field", value: { field: "latency" } }],
});
const breakdown = { label: "Service", alias: "breakdown_1", column: "service", args: [] };

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

const timeRows = () =>
  TIMES.flatMap((t, i) =>
    Object.entries({ api: [100, 600, 1200], web: [50, 300, 900] }).map(([service, values]) => ({
      x_axis_1: t,
      breakdown_1: service,
      y_axis_1: values[i],
    })),
  );
const categoryRows = () =>
  ["/a", "/b"].flatMap((endpoint, i) => [
    { x_axis_1: endpoint, breakdown_1: "api", y_axis_1: [1200, 600][i] },
    { x_axis_1: endpoint, breakdown_1: "web", y_axis_1: [900, 300][i] },
  ]);

const lineSQL = (type: string, config: Record<string, any> = {}) =>
  sqlPanel(type, config, [sqlQuery({ x: [timeX], y: [yField()], breakdown: [breakdown] })]);
const categorySQL = (type: string, config: Record<string, any> = {}) =>
  sqlPanel(type, config, [sqlQuery({ x: [endpointX], y: [yField()], breakdown: [breakdown] })]);

const named = (options: any, name: string) =>
  options.series.find((s: any) => s.name === name && Array.isArray(s.data));
const timePoint = (seriesName: string, value: number) => ({
  seriesName,
  marker: "",
  data: [TIMES[2], value],
  value: [TIMES[2], value],
});
const categoryPoint = (seriesName: string, value: number) => ({
  seriesName,
  marker: "",
  name: "/a",
  data: value,
  value,
});
const visualMapOf = (options: any, series: any) =>
  options.visualMap.find((v: any) => v.seriesIndex === options.series.indexOf(series));
const markers = (options: any) =>
  options.series.filter((s: any) => !s.name && Array.isArray(s.data) && s.data.length === 0);

describe("SQL line/area", () => {
  const overrides = { override_config: seriesEntries([API_OVERRIDE]) };

  it("keeps the original series names and applies the override colour", async () => {
    const plain = await runSQL(lineSQL("line"), [timeRows()]);
    const options = await runSQL(lineSQL("line", overrides), [timeRows()]);
    expect(options.series.filter((s: any) => s.name).map((s: any) => s.name)).toEqual([
      "api",
      "web",
    ]);
    expect(named(options, "api").color).toBe(OVERRIDE_COLOR);
    expect(named(options, "web").color).toBe(named(plain, "web").color);
  });

  it("an override colour beats Color by series", async () => {
    const color = {
      mode: "palette-classic-by-series",
      colorBySeries: [{ value: "api", color: GREEN }],
    };
    const options = await runSQL(lineSQL("line", { ...overrides, color }), [timeRows()]);
    expect(named(options, "api").color).toBe(OVERRIDE_COLOR);
  });

  it("tooltip rows show the display name and the override unit; other rows keep the panel unit", async () => {
    const options = await runSQL(lineSQL("line", overrides), [timeRows()]);
    const html = options.tooltip.formatter([timePoint("api", 1200), timePoint("web", 900)]);
    expect(html).toContain(`${DISPLAY} : ${apiValue(1200)}`);
    expect(html).toContain(`web : ${panelValue(900)}`);
    expect(html).not.toContain("api :");
  });

  it("legend entries show the display name; the legend tooltip too", async () => {
    const options = await runSQL(lineSQL("line", overrides), [timeRows()]);
    expect(options.legend.formatter("api")).toBe(`{b|${DISPLAY}}`);
    expect(options.legend.formatter("web")).toBe("{b|web}");
    expect(options.legend.tooltip.formatter({ name: "api" })).toBe(DISPLAY);
  });

  it("data labels use the override unit; the y-axis keeps the panel unit", async () => {
    const plain = await runSQL(lineSQL("line"), [timeRows()]);
    const options = await runSQL(lineSQL("line", overrides), [timeRows()]);
    expect(named(options, "api").label.formatter({ value: [TIMES[2], 1200] })).toBe(apiValue(1200));
    expect(named(options, "web").label.formatter).toBeUndefined();
    expect(options.yAxis.axisLabel.formatter(1000)).toBe(plain.yAxis.axisLabel.formatter(1000));
  });

  it("area: the gradient is rebuilt from the override colour", async () => {
    const options = await runSQL(lineSQL("area", overrides), [timeRows()]);
    const api = named(options, "api");
    const expected = getAreaStyleOverride("area", api.areaStyle, OVERRIDE_COLOR, "api", "light");
    expect(api.areaStyle.color).toEqual(expected.areaStyle?.color);
  });

  it("matches the final name after a multi-query label", async () => {
    const panel = sqlPanel(
      "line",
      {
        override_config: seriesEntries([
          { matchBy: "name", value: "web (q2)", displayName: "Web two" },
        ]),
      },
      [
        sqlQuery({ x: [timeX], y: [yField()], breakdown: [breakdown] }),
        sqlQuery(
          { x: [timeX], y: [yField()], breakdown: [breakdown] },
          { query_label: "{s} (q2)" },
        ),
      ],
    );
    const options = await runSQL(panel, [timeRows(), timeRows()]);
    expect(named(options, "web (q2)")).toBeDefined();
    expect(options.legend.formatter("web (q2)")).toBe("{b|Web two}");
    expect(options.legend.formatter("web")).toBe("{b|web}");
  });

  it("trellis titles take the display name", async () => {
    const panel = lineSQL("line", { ...overrides, trellis: { layout: "auto" } });
    const options = await runSQL(panel, [timeRows()]);
    const titles = options.title.map((t: any) => t.text);
    expect(titles).toContain(DISPLAY);
    expect(titles).toContain("web");
  });
});

describe("SQL per-series thresholds", () => {
  const apiSteps = { steps: [{ value: 200, color: GREEN }] };

  it("an override's steps replace the panel steps for that series only", async () => {
    const panel = lineSQL("line", {
      thresholds: STEPS,
      override_config: seriesEntries([{ matchBy: "name", value: "api", thresholds: apiSteps }]),
    });
    const options = await runSQL(panel, [timeRows()]);
    expect(visualMapOf(options, named(options, "api")).pieces[0]).toEqual({
      gte: 200,
      lt: 400,
      color: GREEN,
    });
    expect(visualMapOf(options, named(options, "web")).pieces).toHaveLength(2);
    // Each threshold set is drawn once on the shared grid.
    const lines = markers(options)[0].markLine.data.map((d: any) => d.yAxis);
    expect(lines.sort((a: number, b: number) => a - b)).toEqual([200, 500, 1000]);
  });

  it("series sharing one override's steps draw its lines once, in the override unit", async () => {
    const panel = lineSQL("line", {
      override_config: seriesEntries([
        { matchBy: "regex", value: ".*", thresholds: apiSteps, unit: "bytes" },
      ]),
    });
    const options = await runSQL(panel, [timeRows()]);
    const lines = markers(options)[0].markLine.data;
    expect(lines).toHaveLength(1);
    expect(lines[0].label.formatter()).toBe(fmt(200, "bytes", 0));
  });

  it("names an override's line after its series when it applies to one series only", async () => {
    const panel = lineSQL("line", {
      override_config: seriesEntries([
        {
          matchBy: "name",
          value: "api",
          displayName: "checkout",
          thresholds: apiSteps,
          unit: "bytes",
        },
      ]),
    });
    const options = await runSQL(panel, [timeRows()]);
    const lines = markers(options)[0].markLine.data;
    expect(lines).toHaveLength(1);
    expect(lines[0].label.formatter()).toBe(`checkout ${fmt(200, "bytes", 0)}`);
  });

  it("an empty override step list keeps the panel steps", async () => {
    const panel = lineSQL("line", {
      thresholds: STEPS,
      override_config: seriesEntries([
        { matchBy: "name", value: "api", thresholds: { steps: [] }, color: GREEN },
      ]),
    });
    const options = await runSQL(panel, [timeRows()]);
    expect(visualMapOf(options, named(options, "api")).pieces).toHaveLength(2);
  });

  it("a threshold step outranks the override colour, which stays the base below the first step", async () => {
    const panel = lineSQL("line", {
      thresholds: STEPS,
      override_config: seriesEntries([API_OVERRIDE]),
    });
    const options = await runSQL(panel, [timeRows()]);
    const api = named(options, "api");
    expect(api.color).toBe(OVERRIDE_COLOR);
    expect(visualMapOf(options, api).pieces[0]).toEqual({ gte: 500, lt: 1000, color: AMBER });
  });
});

describe.each(["bar", "h-bar", "stacked", "h-stacked", "scatter", "area-stacked"])(
  "SQL %s",
  (type) => {
    const overrides = { override_config: seriesEntries([API_OVERRIDE]) };

    it("colours, renames and formats the matched series only", async () => {
      const options = await runSQL(categorySQL(type, overrides), [categoryRows()]);
      const api = named(options, "api");
      expect(api.color).toBe(OVERRIDE_COLOR);
      expect(api.label.formatter({ value: 1200 })).toBe(apiValue(1200));
      expect(named(options, "web").label.formatter).toBeUndefined();
      const html = options.tooltip.formatter([
        categoryPoint("api", 1200),
        categoryPoint("web", 900),
      ]);
      expect(html).toContain(`${DISPLAY} : ${apiValue(1200)}`);
      expect(html).toContain(`web : ${panelValue(900)}`);
      expect(options.legend.formatter("api")).toBe(`{b|${DISPLAY}}`);
    });
  },
);

describe.each(["pie", "donut"])("SQL %s", (type) => {
  const piePanel = (config: Record<string, any>, queries = 1) =>
    sqlPanel(
      type,
      config,
      Array.from({ length: queries }, () => sqlQuery({ x: [serviceX], y: [yField()] })),
    );
  const rows = [
    { x_axis_1: "api", y_axis_1: 600 },
    { x_axis_1: "web", y_axis_1: 300 },
  ];
  const overrides = { override_config: seriesEntries([{ ...API_OVERRIDE, decimals: 1 }]) };

  it("colours the slice, keeps its name and formats its label and tooltip", async () => {
    const options = await runSQL(piePanel(overrides), [rows]);
    const [api, web] = options.series[0].data;
    expect(api.name).toBe("api");
    expect(api.itemStyle.color).toBe(OVERRIDE_COLOR);
    expect(api.label.formatter()).toBe("66.7%");
    expect(web.label).toBeUndefined();
    const html = options.tooltip.formatter({ marker: "", name: "api", value: 600 });
    expect(html).toContain(`${DISPLAY} : <b>${fmt(600, "bytes", 1)}</b>`);
    expect(options.tooltip.formatter({ marker: "", name: "web", value: 300 })).toContain(
      `web : <b>${panelValue(300)}</b>`,
    );
    expect(options.legend.formatter("api")).toBe(`{b|${DISPLAY}}`);
  });

  it("multi-query: applies to the merged slices", async () => {
    const options = await runSQL(piePanel(overrides, 2), [rows, rows]);
    const apis = options.series[0].data.filter((d: any) => d.name === "api");
    expect(apis).toHaveLength(2);
    expect(apis.every((d: any) => d.itemStyle.color === OVERRIDE_COLOR)).toBe(true);
  });
});

describe("SQL gauge", () => {
  const gaugePanel = (config: Record<string, any>) =>
    sqlPanel("gauge", config, [sqlQuery({ x: [serviceX], y: [yField()] })]);
  const rows = [
    { x_axis_1: "api", y_axis_1: 640 },
    { x_axis_1: "web", y_axis_1: 1500 },
  ];
  const overrides = { override_config: seriesEntries([API_OVERRIDE]) };

  it("colours and formats the gauge; the data item keeps its original name", async () => {
    const options = await runSQL(gaugePanel(overrides), [rows]);
    const [api, web] = options.series;
    expect(api.data[0].name).toBe("api");
    expect(api.data[0].itemStyle.color).toBe(OVERRIDE_COLOR);
    const unit = getUnitValue(640, "bytes", "", 2);
    expect(api.data[0].detail.formatter(640)).toBe(unit.value + unit.unit);
    expect(api.tooltip.formatter({ marker: "", value: 640 })).toBe(
      ` ${DISPLAY} : <b>${apiValue(640)}</b>`,
    );
    expect(web.tooltip).toBeUndefined();
    expect(web.data[0].title).toBeUndefined();
  });

  it("shows the display name through a silent title-only gauge on top", async () => {
    const options = await runSQL(gaugePanel(overrides), [rows]);
    expect(options.series).toHaveLength(3);
    const [api, , title] = options.series;
    expect(api.data[0].title.show).toBe(false);
    expect(title).toMatchObject({
      type: "gauge",
      silent: true,
      center: api.center,
      radius: api.radius,
      pointer: { show: false },
      progress: { show: false },
      detail: { show: false },
      data: [{ name: DISPLAY }],
    });
  });

  it("per-series thresholds band the matched gauge only", async () => {
    const config = {
      thresholds: STEPS,
      override_config: seriesEntries([
        { matchBy: "name", value: "api", thresholds: { steps: [{ value: 100, color: GREEN }] } },
      ]),
    };
    const options = await runSQL(gaugePanel(config), [rows]);
    expect(options.series[0].data[0].itemStyle.color).toBe(GREEN);
    expect(options.series[1].data[0].itemStyle.color).toBe(RED);
  });

  it("multi-query grid: the title gauge follows its gauge's cell", async () => {
    const panel = sqlPanel("gauge", overrides, [
      sqlQuery({ x: [serviceX], y: [yField()] }),
      sqlQuery({ x: [serviceX], y: [yField("Other")] }),
    ]);
    const options = await runSQL(panel, [[rows[0]], [rows[1]]]);
    expect(options.series).toHaveLength(3);
    expect(options.series[2].center).toEqual(options.series[0].center);
    expect(options.series[2].radius).toBe(options.series[0].radius);
  });
});

describe("SQL metric", () => {
  const metricPanel = (config: Record<string, any>, queries = 1) =>
    sqlPanel(
      "metric",
      config,
      Array.from({ length: queries }, (_, i) =>
        sqlQuery({ x: [], y: [yField(i ? "Other" : "Latency")] }),
      ),
    );
  const background = { type: "single", value: { color: "#1e40af" } };
  const latency = {
    matchBy: "name",
    value: "Latency",
    unit: "bytes",
    decimals: 1,
    color: OVERRIDE_COLOR,
  };

  it("formats the value in the override unit; the override colour replaces the Background", async () => {
    const options = await runSQL(
      metricPanel({ background, override_config: seriesEntries([latency]) }),
      [[{ y_axis_1: 1200 }]],
    );
    expect(options.series[0]._metricText).toBe(fmt(1200, "bytes", 1));
    expect(options.backgroundColor).toBe(OVERRIDE_COLOR);
  });

  it("a threshold step outranks the override colour; below the first step the override colour shows", async () => {
    const config = { background, thresholds: STEPS, override_config: seriesEntries([latency]) };
    const high = await runSQL(metricPanel(config), [[{ y_axis_1: 1200 }]]);
    expect(high.backgroundColor).toBe(RED);
    const low = await runSQL(metricPanel(config), [[{ y_axis_1: 10 }]]);
    expect(low.backgroundColor).toBe(OVERRIDE_COLOR);
  });

  it("multi-query grid: each cell takes its own override", async () => {
    const other = { matchBy: "name", value: "Other", displayName: "Second", unit: "bytes" };
    const options = await runSQL(
      metricPanel({ background, override_config: seriesEntries([other]) }, 2),
      [[{ y_axis_1: 1200 }], [{ y_axis_1: 2048 }]],
    );
    expect(options.series.map((s: any) => s._metricLabel)).toEqual(["Latency", "Second"]);
    expect(options.series[0]._metricText).toBe(panelValue(1200));
    expect(options.series[1]._metricText).toBe(fmt(2048, "bytes", 0));
  });

  it("the series picker lists original names while the drawn label shows the display name", async () => {
    const renamed = { matchBy: "name", value: "Latency", displayName: "Checkout" };
    const single = await runSQL(metricPanel({ override_config: seriesEntries([renamed]) }), [
      [{ y_axis_1: 1200 }],
    ]);
    expect(single.series[0]._metricLabel).toBe("Checkout");
    expect(getLegendSeriesNames(single, "metric")).toEqual(["Latency"]);
    const grid = await runSQL(metricPanel({ override_config: seriesEntries([renamed]) }, 2), [
      [{ y_axis_1: 1200 }],
      [{ y_axis_1: 2048 }],
    ]);
    expect(grid.series.map((s: any) => s._metricLabel)).toEqual(["Checkout", "Other"]);
    expect(getLegendSeriesNames(grid, "metric")).toEqual(["Latency", "Other"]);
  });
});

describe("panels without series overrides", () => {
  const staleTable = [
    {
      field: { matchBy: "name", value: "api" },
      config: [
        { type: "unit", value: { unit: "bytes", customUnit: "" } },
        { type: "unique_value_color", autoColor: true },
      ],
    },
  ];

  it.each(["line", "bar", "pie", "gauge", "metric"])(
    "%s: stale table override_config and an empty list change nothing",
    async (type) => {
      const build = (config: Record<string, any>) =>
        type === "line"
          ? lineSQL(type, config)
          : sqlPanel(type, config, [sqlQuery({ x: [serviceX], y: [yField()] })]);
      const rows =
        type === "line"
          ? timeRows()
          : [
              { x_axis_1: "api", y_axis_1: 600 },
              { x_axis_1: "web", y_axis_1: 300 },
            ];
      const plain = await runSQL(build({}), [rows]);
      const stale = await runSQL(build({ override_config: staleTable }), [rows]);
      const empty = await runSQL(build({ override_config: seriesEntries([]) }), [rows]);
      expect(serialize(stale)).toBe(serialize(plain));
      expect(serialize(empty)).toBe(serialize(plain));
      if (type === "line") {
        const points = [timePoint("api", 1200), timePoint("web", 900)];
        expect(stale.tooltip.formatter([...points])).toBe(plain.tooltip.formatter([...points]));
      }
    },
  );
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
const two = () => [promMatrix({ api: [100, 600, 1200], web: [50, 300, 900] })];
const promOverrides = { override_config: seriesEntries([API_OVERRIDE]) };

describe("PromQL line/area", () => {
  it("colours, renames and formats the matched series; names stay original", async () => {
    const options = await runPromQL(promPanel("line", promOverrides), two());
    const api = named(options, "api");
    expect(api.itemStyle.color).toBe(OVERRIDE_COLOR);
    expect(api._panelQueryIndex).toBe(0);
    expect(api.label.formatter({ value: ["t", 1200] })).toBe(apiValue(1200));
    const point = (seriesName: string, value: number, seriesIndex: number) => ({
      ...timePoint(seriesName, value),
      data: [promTimes[2] * 1000, value],
      seriesIndex,
    });
    const html = options.tooltip.formatter([point("api", 1200, 0), point("web", 900, 1)]);
    expect(html).toContain(`${DISPLAY} : ${apiValue(1200)}`);
    expect(html).toContain(`web : ${panelValue(900)}`);
    expect(options.legend.formatter("api")).toBe(`{b|${DISPLAY}}`);
  });

  it("per-series thresholds: the override's steps for the match, the panel's for the rest", async () => {
    const panel = promPanel("area", {
      thresholds: STEPS,
      override_config: seriesEntries([
        { matchBy: "name", value: "web", thresholds: { steps: [{ value: 10, color: GREEN }] } },
      ]),
    });
    const options = await runPromQL(panel, two());
    expect(visualMapOf(options, named(options, "web")).pieces[0]).toEqual({
      gte: 10,
      lt: 20,
      color: GREEN,
    });
    expect(visualMapOf(options, named(options, "api")).pieces).toHaveLength(2);
  });
});

describe.each(["pie", "donut"])("PromQL %s", (type) => {
  it("colours, renames and formats the slice; its data name stays original", async () => {
    const options = await runPromQL(promPanel(type, promOverrides), two());
    const api = options.series[0].data.find((d: any) => d.name === "api");
    expect(api.itemStyle.color).toBe(OVERRIDE_COLOR);
    const label = options.series[0].label.formatter({ name: "api", value: 1200, percent: 57.14 });
    expect(label).toBe(`${DISPLAY}: ${apiValue(1200)} (57.1%)`);
    const html = options.tooltip.formatter({
      seriesName: "s",
      name: "api",
      value: 1200,
      marker: "",
    });
    expect(html).toBe(` ${DISPLAY}: ${apiValue(1200)}`);
    expect(options.legend.formatter("api")).toBe(`{b|${DISPLAY}}`);
  });
});

describe("PromQL bars", () => {
  it("h-bar: categories are the series, so colour, label, axis and tooltip follow the category", async () => {
    const options = await runPromQL(promPanel("h-bar", promOverrides), two());
    const [api, web] = options.series[0].data;
    expect(api.itemStyle.color).toBe(OVERRIDE_COLOR);
    expect(web.itemStyle?.color).not.toBe(OVERRIDE_COLOR);
    expect(options.series[0].label.formatter({ name: "api", value: 1200 })).toBe(apiValue(1200));
    expect(options.series[0].label.formatter({ name: "web", value: 900 })).toBe(panelValue(900));
    expect(options.yAxis.axisLabel.formatter("api")).toBe(DISPLAY);
    const html = options.tooltip.formatter([{ seriesName: "s", name: "api", value: 1200 }]);
    expect(html).toContain(`${DISPLAY}: ${apiValue(1200)}`);
  });

  it.each(["stacked", "h-stacked"])(
    "%s: the series takes colour, label unit and display name",
    async (type) => {
      const options = await runPromQL(promPanel(type, promOverrides), two());
      const api = named(options, "api");
      expect(api.color).toBe(OVERRIDE_COLOR);
      expect(api.label.formatter({ value: 1200 })).toBe(apiValue(1200));
      const html = options.tooltip.formatter([
        { seriesName: "api", name: "00:20:00", value: 1200 },
        { seriesName: "web", name: "00:20:00", value: 900 },
      ]);
      expect(html).toContain(`${DISPLAY}: ${apiValue(1200)}`);
      expect(html).toContain(`web: ${panelValue(900)}`);
    },
  );
});

describe("PromQL gauge and metric", () => {
  it("gauge: colour, unit, tooltip and title gauge; the data name stays original", async () => {
    const options = await runPromQL(promPanel("gauge", promOverrides), two());
    const [api, web, title] = options.series;
    expect(api.data[0].name).toBe("api");
    expect(api.data[0].itemStyle.color).toBe(OVERRIDE_COLOR);
    const unit = getUnitValue(1200, "bytes", "", 2);
    expect(api.data[0].detail.formatter(1200)).toBe(unit.value + unit.unit);
    expect(api.tooltip.formatter({ marker: "", value: 1200 })).toContain(DISPLAY);
    expect(web.tooltip).toBeUndefined();
    expect(title.data[0].name).toBe(DISPLAY);
  });

  it("metric: override unit for the value and override colour as its background", async () => {
    const options = await runPromQL(promPanel("metric", promOverrides), [
      promMatrix({ api: [1, 2, 1200] }),
    ]);
    expect(options.series[0]._metricText).toBe(apiValue(1200));
    expect(options.backgroundColor).toBe(OVERRIDE_COLOR);
  });
});

describe("rendered by ECharts", () => {
  const render = (options: any) => {
    const chart = echarts.init(null as any, null, {
      renderer: "svg",
      ssr: true,
      width: 800,
      height: 400,
    });
    chart.setOption({ animation: false, ...options });
    const svg = chart.renderToSVGString();
    const model: any = chart.getModel();
    const seriesNames = model.getSeries().map((s: any) => s.name);
    const dataNames = model.getSeries().map((s: any) => s.getData().getName(0));
    chart.dispose();
    return { svg, seriesNames, dataNames };
  };

  it("line: the legend reads the display name while the series keeps the original for events", async () => {
    const options = await runSQL(
      lineSQL("line", { override_config: seriesEntries([API_OVERRIDE]) }),
      [timeRows()],
    );
    const { svg, seriesNames } = render(options);
    expect(svg).toContain(`>${DISPLAY}<`);
    expect(svg).not.toContain(">api<");
    expect(svg).toContain(">web<");
    // Click and context-menu params carry `seriesName` from the series model.
    expect(seriesNames.slice(0, 2)).toEqual(["api", "web"]);
  });

  it("line: below the first step the line keeps the override colour", async () => {
    const panel = lineSQL("line", {
      thresholds: STEPS,
      override_config: seriesEntries([API_OVERRIDE]),
    });
    const { svg } = render(await runSQL(panel, [timeRows()]));
    const stops = [...svg.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
    expect(stops).toEqual(expect.arrayContaining([OVERRIDE_COLOR, AMBER, RED]));
  });

  it("line: single-step panel and override thresholds render", async () => {
    const panel = lineSQL("line", {
      thresholds: { steps: [{ value: 500, color: AMBER }] },
      override_config: seriesEntries([
        { ...API_OVERRIDE, thresholds: { steps: [{ value: 800, color: RED }] } },
      ]),
    });
    const { svg } = render(await runSQL(panel, [timeRows()]));
    const stops = [...svg.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
    expect(stops).toEqual(expect.arrayContaining([OVERRIDE_COLOR, RED, AMBER]));
  });

  it("gauge: the title shows the display name; the data item a click reports keeps the original", async () => {
    const panel = sqlPanel("gauge", { override_config: seriesEntries([API_OVERRIDE]) }, [
      sqlQuery({ x: [serviceX], y: [yField()] }),
    ]);
    const rows = [
      { x_axis_1: "api", y_axis_1: 640 },
      { x_axis_1: "web", y_axis_1: 1500 },
    ];
    const { svg, dataNames } = render(await runSQL(panel, [rows]));
    expect(svg).toContain(`>${DISPLAY}<`);
    expect(svg).not.toContain(">api<");
    expect(svg).toContain(">web<");
    expect(dataNames.slice(0, 2)).toEqual(["api", "web"]);
  });
});
