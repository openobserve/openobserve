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
import { toSeriesOverrideEntry, type SeriesStyle } from "./seriesOverrides";
import { applySeriesStyleOverrides, applyYAxisMinInterval } from "./seriesStyleOverrides";

const storeFor = (theme: string) => ({
  state: {
    theme,
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
});
const store = storeFor("light");
const panelRef = () => ({ value: { offsetWidth: 800, offsetHeight: 400 } });

const styled = (value: string, style: SeriesStyle, matchBy: "name" | "regex" = "name") =>
  toSeriesOverrideEntry({ matchBy, value, style });
const overrides = (...entries: any[]) => ({ override_config: entries });

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
const yField = {
  label: "Latency",
  alias: "y_axis_1",
  column: "latency",
  functionName: "avg",
  aggregationFunction: "avg",
  args: [{ type: "field", value: { field: "latency" } }],
};
const breakdown = { label: "Service", alias: "breakdown_1", column: "service", args: [] };

const sqlPanel = (type: string, config: Record<string, any>, x = timeX) => ({
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
  config: { show_legends: true, unit: "milliseconds", decimals: 0, ...config },
});

const runSQL = async (panel: any, rows: any[], theme = "light") => {
  const result: any = await convertMultiSQLData(
    panel,
    [rows],
    storeFor(theme),
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

const timeRows = (values: Record<string, number[]> = { api: [1, 6, 12], web: [5, 3, 9] }) =>
  TIMES.flatMap((t, i) =>
    Object.entries(values).map(([service, v]) => ({
      x_axis_1: t,
      breakdown_1: service,
      y_axis_1: v[i],
    })),
  );
const categoryRows = () =>
  ["/a", "/b"].flatMap((endpoint, i) => [
    { x_axis_1: endpoint, breakdown_1: "api", y_axis_1: [12, 6][i] },
    { x_axis_1: endpoint, breakdown_1: "web", y_axis_1: [9, 3][i] },
  ]);

const named = (options: any, name: string) =>
  options.series.find((s: any) => s.name === name && Array.isArray(s.data));

const promTimes = [1704067200, 1704067800, 1704068400];
const promPanel = (type: string, config: Record<string, any>) => ({
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
const promData = (series: Record<string, number[]> = { api: [1, 6, 12], web: [5, 3, 9] }) => [
  {
    resultType: "matrix",
    result: Object.entries(series).map(([service, values]) => ({
      metric: { service },
      values: values.map((v, i) => [promTimes[i], String(v)]),
    })),
  },
];
const runPromQL = async (panel: any, data = promData()) => {
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
  const ticks = model
    .getComponent("yAxis", 0)
    .axis.scale.getTicks()
    .map((tick: any) => tick.value);
  chart.dispose();
  return { svg, ticks };
};

describe("SQL line: each style setting", () => {
  it("line style and width apply to the matched series only", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("api", { lineStyle: "dashed", lineWidth: 4 }))),
      timeRows(),
    );
    expect(named(options, "api").lineStyle).toMatchObject({ type: "dashed", width: 4 });
    expect(named(options, "web").lineStyle.type).toBeUndefined();
    expect(named(options, "web").lineStyle.width).toBe(1.5);
  });

  it("dotted line style", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("web", { lineStyle: "dotted" }))),
      timeRows(),
    );
    expect(named(options, "web").lineStyle.type).toBe("dotted");
  });

  it("fill opacity adds a fill to a line and scales an area's gradient", async () => {
    const line = await runSQL(
      sqlPanel("line", overrides(styled("api", { fillOpacity: 40 }))),
      timeRows(),
    );
    expect(named(line, "api").areaStyle).toEqual({ opacity: 0.4 });
    expect(named(line, "web").areaStyle).toBeNull();

    const area = await runSQL(
      sqlPanel("area", overrides(styled("api", { fillOpacity: 0 }))),
      timeRows(),
    );
    expect(named(area, "api").areaStyle.opacity).toBe(0);
    expect(named(area, "api").areaStyle.color).toBeDefined();
    expect(named(area, "web").areaStyle.opacity).toBeUndefined();
  });

  it("fill opacity on bars sets the bar opacity", async () => {
    const options = await runSQL(
      sqlPanel("bar", overrides(styled("api", { fillOpacity: 50 })), endpointX),
      categoryRows(),
    );
    expect(named(options, "api").itemStyle.opacity).toBe(0.5);
  });

  it("show points turns symbols on, and off against a panel that shows them", async () => {
    const on = await runSQL(
      sqlPanel("line", overrides(styled("api", { showPoints: true }))),
      timeRows(),
    );
    expect(named(on, "api").showSymbol).toBe(true);
    expect(named(on, "web").showSymbol).toBe(false);

    const off = await runSQL(
      sqlPanel("line", { show_symbol: true, ...overrides(styled("api", { showPoints: false })) }),
      timeRows(),
    );
    expect(named(off, "api").showSymbol).toBe(false);
    expect(named(off, "web").showSymbol).toBe(true);
  });

  it("draws a series as bars or points on a line chart", async () => {
    const options = await runSQL(
      sqlPanel(
        "line",
        overrides(styled("api", { drawStyle: "bars" }), styled("web", { drawStyle: "points" })),
      ),
      timeRows(),
    );
    expect(named(options, "api").type).toBe("bar");
    expect(named(options, "web").type).toBe("scatter");
    expect(named(options, "web").symbolSize).toBeGreaterThan(0);
  });

  it("draws a bar chart series as a line, which then takes line settings", async () => {
    const options = await runSQL(
      sqlPanel(
        "bar",
        overrides(styled("api", { drawStyle: "line", lineStyle: "dashed" })),
        endpointX,
      ),
      categoryRows(),
    );
    expect(named(options, "api").type).toBe("line");
    expect(named(options, "api").lineStyle.type).toBe("dashed");
    expect(named(options, "web").type).toBe("bar");
  });

  it("line settings do not touch a series drawn as bars", async () => {
    const options = await runSQL(
      sqlPanel("bar", overrides(styled("api", { lineStyle: "dashed", lineWidth: 5 })), endpointX),
      categoryRows(),
    );
    expect(named(options, "api").lineStyle).toEqual({ width: 1.5 });
  });

  it("a stacking group stacks the series together; a group of one leaves the shared stack", async () => {
    const line = await runSQL(
      sqlPanel(
        "line",
        overrides(styled("api", { stackGroup: "g" }), styled("web", { stackGroup: "g" })),
      ),
      timeRows(),
    );
    expect(named(line, "api").stack).toBe("g");
    expect(named(line, "web").stack).toBe("g");

    const stacked = await runSQL(
      sqlPanel("area-stacked", overrides(styled("api", { stackGroup: "alone" }))),
      timeRows(),
    );
    expect(named(stacked, "api").stack).toBe("alone");
    expect(named(stacked, "web").stack).toBe("Total");
  });

  it("a right y-axis adds a second value axis for the matched series", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("api", { yAxis: "right" }))),
      timeRows(),
    );
    expect(Array.isArray(options.yAxis)).toBe(true);
    const [left, right] = options.yAxis;
    expect(left.position).toBeUndefined();
    expect(right).toMatchObject({ type: "value", position: "right", name: "" });
    expect(right.splitLine.show).toBe(false);
    expect(named(options, "api").yAxisIndex).toBe(1);
    expect(named(options, "web").yAxisIndex).toBeUndefined();
    if (options.grid.containLabel !== true) expect(options.grid.right).toBeGreaterThan(20);
  });

  it("left keeps the single axis", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("api", { yAxis: "left" }))),
      timeRows(),
    );
    expect(Array.isArray(options.yAxis)).toBe(false);
  });

  it("h-bar ignores a right y-axis, whose value axis is horizontal", async () => {
    const plain = await runSQL(sqlPanel("h-bar", {}, endpointX), categoryRows());
    const options = await runSQL(
      sqlPanel("h-bar", overrides(styled("api", { yAxis: "right" })), endpointX),
      categoryRows(),
    );
    expect([options.yAxis].flat()).toHaveLength([plain.yAxis].flat().length);
    expect(named(options, "api").yAxisIndex).toBe(named(plain, "api").yAxisIndex);
  });

  it("hide from chart unselects the series in the legend", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("api", { hideFrom: { chart: true } }))),
      timeRows(),
    );
    expect(options.legend.selected).toEqual({ api: false });
    expect(named(options, "api")._hiddenFromChart).toBe(true);
  });

  it("hide from legend drops the legend entry only", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("api", { hideFrom: { legend: true } }))),
      timeRows(),
    );
    expect(options.legend.data).toEqual(["web"]);
    expect(named(options, "api")).toBeDefined();
  });

  it("hide from tooltip drops its tooltip rows", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("api", { hideFrom: { tooltip: true } }))),
      timeRows(),
    );
    expect(named(options, "api").tooltip.show).toBe(false);
    const point = (seriesName: string, value: number) => ({
      seriesName,
      marker: "",
      data: [TIMES[2], value],
      value: [TIMES[2], value],
    });
    const html = options.tooltip.formatter([point("api", 12), point("web", 9)]);
    expect(html).toContain("web");
    expect(html).not.toContain("api");
    expect(options.tooltip.formatter([point("api", 12)])).toBe("");
  });
});

describe("matching and precedence", () => {
  it("a regex override styles every matching series", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("^(api|web)$", { lineStyle: "dashed" }, "regex"))),
      timeRows(),
    );
    expect(named(options, "api").lineStyle.type).toBe("dashed");
    expect(named(options, "web").lineStyle.type).toBe("dashed");
  });

  it("a later override wins per setting; unset settings keep the earlier override's", async () => {
    const options = await runSQL(
      sqlPanel(
        "line",
        overrides(
          styled("^a", { lineStyle: "dotted", lineWidth: 3, hideFrom: { legend: true } }, "regex"),
          styled("api", { lineStyle: "dashed", hideFrom: { tooltip: true } }),
        ),
      ),
      timeRows(),
    );
    const api = named(options, "api");
    expect(api.lineStyle).toMatchObject({ type: "dashed", width: 3 });
    expect(api.tooltip.show).toBe(false);
    expect(options.legend.data).toEqual(["web"]);
  });

  it("a name rule beats a regex rule listed after it, per setting", async () => {
    const options = await runSQL(
      sqlPanel(
        "line",
        overrides(
          toSeriesOverrideEntry({
            matchBy: "name",
            value: "api",
            color: "#00aa00",
            style: { lineStyle: "dashed" },
          }),
          toSeriesOverrideEntry({
            matchBy: "regex",
            value: "^(api|web)$",
            color: "#ff0000",
            style: { lineStyle: "dotted", lineWidth: 3 },
          }),
        ),
      ),
      timeRows(),
    );
    const api = named(options, "api");
    expect(api.color).toBe("#00aa00");
    expect(api.lineStyle).toMatchObject({ type: "dashed", width: 3 });
    expect(named(options, "web").color).toBe("#ff0000");
    expect(named(options, "web").lineStyle.type).toBe("dotted");
  });

  it("among rules of one kind the later wins", async () => {
    const options = await runSQL(
      sqlPanel(
        "line",
        overrides(
          styled("^a", { lineStyle: "dotted" }, "regex"),
          styled("pi$", { lineStyle: "dashed" }, "regex"),
          styled("web", { lineWidth: 2 }),
          styled("web", { lineWidth: 6 }),
        ),
      ),
      timeRows(),
    );
    expect(named(options, "api").lineStyle.type).toBe("dashed");
    expect(named(options, "web").lineStyle.width).toBe(6);
  });

  it("an override with no style settings leaves the series as the panel draws it", async () => {
    const plain = await runSQL(sqlPanel("line", {}), timeRows());
    const renamed = await runSQL(
      sqlPanel(
        "line",
        overrides(toSeriesOverrideEntry({ matchBy: "name", value: "api", displayName: "API" })),
      ),
      timeRows(),
    );
    for (const name of ["api", "web"]) {
      const before = named(plain, name);
      const after = named(renamed, name);
      for (const key of ["type", "lineStyle", "areaStyle", "showSymbol", "stack", "yAxisIndex"]) {
        expect(after[key]).toEqual(before[key]);
      }
    }
    expect(JSON.stringify(renamed.yAxis)).toBe(JSON.stringify(plain.yAxis));
    expect(renamed.legend.selected).toEqual(plain.legend.selected);
  });

  it("an invalid regex matches nothing", async () => {
    const options = await runSQL(
      sqlPanel("line", overrides(styled("(?=a)", { lineStyle: "dashed" }, "regex"))),
      timeRows(),
    );
    expect(named(options, "api").lineStyle.type).toBeUndefined();
  });
});

describe("PromQL", () => {
  it("line: style, width, points, right axis and hidden legend entry", async () => {
    const options = await runPromQL(
      promPanel(
        "line",
        overrides(
          styled("api", {
            lineStyle: "dashed",
            lineWidth: 4,
            showPoints: true,
            yAxis: "right",
            hideFrom: { legend: true },
          }),
        ),
      ),
    );
    const api = named(options, "api");
    expect(api.lineStyle).toMatchObject({ type: "dashed", width: 4 });
    expect(api.showSymbol).toBe(true);
    expect(api.yAxisIndex).toBe(1);
    expect(options.yAxis).toHaveLength(2);
    expect(options.legend.data).toEqual(["web"]);
    expect(named(options, "web").lineStyle.type).toBeUndefined();
  });

  it("area: fill opacity and draw as bars", async () => {
    const options = await runPromQL(
      promPanel(
        "area",
        overrides(styled("api", { fillOpacity: 20 }), styled("web", { drawStyle: "bars" })),
      ),
    );
    expect(named(options, "api").areaStyle.opacity).toBe(0.2);
    expect(named(options, "web").type).toBe("bar");
  });

  it("stacked: a stacking group and a series drawn as a line", async () => {
    const options = await runPromQL(
      promPanel(
        "stacked",
        overrides(styled("api", { stackGroup: "own", drawStyle: "line", lineStyle: "dotted" })),
      ),
    );
    const api = named(options, "api");
    expect(api.stack).toBe("own");
    expect(api.type).toBe("line");
    expect(api.lineStyle.type).toBe("dotted");
    expect(named(options, "web").stack).not.toBe("own");
  });

  it("hide from chart and tooltip", async () => {
    const options = await runPromQL(
      promPanel("line", overrides(styled("web", { hideFrom: { chart: true, tooltip: true } }))),
    );
    expect(options.legend.selected).toMatchObject({ web: false });
    expect(named(options, "web").tooltip.show).toBe(false);
  });
});

describe("y-axis minimum interval", () => {
  it("sets minInterval on the SQL and PromQL value axis; unset leaves it out", async () => {
    const sql = await runSQL(sqlPanel("line", { y_axis_min_interval: 1 }), timeRows());
    expect(sql.yAxis.minInterval).toBe(1);
    const prom = await runPromQL(promPanel("line", { y_axis_min_interval: 1 }));
    expect(prom.yAxis.minInterval).toBe(1);
    const plain = await runSQL(sqlPanel("line", {}), timeRows());
    expect(plain.yAxis.minInterval).toBeUndefined();
  });

  it("h-bar takes it on the horizontal value axis", async () => {
    const options = await runSQL(
      sqlPanel("h-bar", { y_axis_min_interval: 2 }, endpointX),
      categoryRows(),
    );
    const valueAxis = [options.xAxis].flat().find((axis: any) => axis.type === "value");
    expect(valueAxis.minInterval).toBe(2);
  });

  it("ignores zero, negative and non-numeric values", () => {
    for (const value of [0, -1, "abc", null, ""]) {
      const options = { yAxis: { type: "value" } } as any;
      applyYAxisMinInterval(options, { type: "line", config: { y_axis_min_interval: value } });
      expect(options.yAxis.minInterval).toBeUndefined();
    }
  });

  it("a 0/1 count series with minimum interval 1 draws ticks 0 and 1 only", async () => {
    const counts = { links: [0, 1, 0] };
    const without = await runSQL(sqlPanel("line", {}), timeRows(counts));
    expect(render(without).ticks.length).toBeGreaterThan(2);
    const options = await runSQL(sqlPanel("line", { y_axis_min_interval: 1 }), timeRows(counts));
    expect(render(options).ticks).toEqual([0, 1]);
    const prom = await runPromQL(
      promPanel("line", { y_axis_min_interval: 1 }),
      promData({ links: [0, 1, 0] }),
    );
    expect(render(prom).ticks).toEqual([0, 1]);
  });

  it("whole-number ticks keep 0 decimals in the axis labels", async () => {
    const options = await runSQL(
      sqlPanel("line", { y_axis_min_interval: 1, decimals: 0, unit: "default" }),
      timeRows({ links: [0, 1, 0] }),
    );
    expect(options.yAxis.axisLabel.formatter(1)).toBe("1");
  });
});

describe("with main's stacked-chart behaviour", () => {
  const rows = () =>
    ["/a", "/b"].flatMap((endpoint, i) =>
      Object.entries({ api: [12, 6], web: [9, 3], db: [4, 2] }).map(([service, v]) => ({
        x_axis_1: endpoint,
        breakdown_1: service,
        y_axis_1: v[i],
      })),
    );
  const stackedPanel = (config: Record<string, any>) => sqlPanel("area-stacked", config);
  const timeStackRows = () =>
    TIMES.flatMap((t, i) =>
      Object.entries({ api: [12, 6, 8], web: [9, 3, 5], db: [4, 2, 1] }).map(([service, v]) => ({
        x_axis_1: t,
        breakdown_1: service,
        y_axis_1: v[i],
      })),
    );
  const params = (options: any) =>
    ["api", "web", "db"].map((name) => {
      const series = named(options, name);
      const point = series.data[2];
      return {
        seriesName: name,
        seriesIndex: options.series.indexOf(series),
        marker: "",
        name: TIMES[2],
        data: point,
        value: point,
      };
    });

  it("stack totals follow a stacking group", async () => {
    const options = await runSQL(
      stackedPanel(overrides(styled("db", { stackGroup: "own" }))),
      timeStackRows(),
    );
    const html = options.tooltip.formatter(params(options));
    // api + web stay in the shared stack; db alone in its group adds no total row.
    expect(html).toContain("Total #1 : 13ms");
    expect(html).not.toContain(": 14ms");
    expect(named(options, "db").stack).toBe("own");
    expect(rows().length).toBe(6);
  });

  it("a series hidden from the tooltip is left out of its rows and of the stack total", async () => {
    const options = await runSQL(
      stackedPanel(overrides(styled("db", { hideFrom: { tooltip: true } }))),
      timeStackRows(),
    );
    const html = options.tooltip.formatter(params(options));
    expect(html).toContain("Total : 13");
    expect(html).not.toContain("db");
  });

  it("threshold lines still draw on a stacked chart with a stacking group and a hidden series", async () => {
    const options = await runSQL(
      stackedPanel({
        thresholds: { steps: [{ value: 10, color: "#ff0000" }] },
        ...overrides(
          styled("db", { stackGroup: "own" }),
          styled("web", { hideFrom: { chart: true, legend: true } }),
        ),
      }),
      timeStackRows(),
    );
    const marker = options.series.find((s: any) => !s.name && s.markLine?.data?.length);
    expect(marker).toBeDefined();
    expect(options.legend.selected).toMatchObject({ web: false });
  });

  it("a user y max widens to the stacks of its own axis after a series moves right", async () => {
    const options = await runSQL(
      stackedPanel({ y_axis_max: 5, ...overrides(styled("db", { yAxis: "right" })) }),
      timeStackRows(),
    );
    const [left, right] = options.yAxis;
    expect(left.max).toBe(21);
    expect(right.max).toBe(5);
    expect(right.min).toBeUndefined();
  });

  it("a series override's fill opacity wins over the panel fill opacity; others keep the panel's", async () => {
    const options = await runSQL(
      sqlPanel("area", { fill_opacity: 60, ...overrides(styled("api", { fillOpacity: 10 })) }),
      timeRows(),
    );
    expect(named(options, "api").areaStyle.opacity).toBe(0.1);
    expect(named(options, "web").areaStyle.opacity).toBe(0.6);
  });

  it("a series override's line width wins over the panel line thickness", async () => {
    const options = await runSQL(
      sqlPanel("line", { line_thickness: 3, ...overrides(styled("api", { lineWidth: 6 })) }),
      timeRows(),
    );
    expect(named(options, "api").lineStyle.width).toBe(6);
    expect(named(options, "web").lineStyle.width).toBe(3);
  });

  it("thinner than the panel's own line thickness raises the line", async () => {
    const options = await runSQL(
      sqlPanel("line", { line_thickness: 4, ...overrides(styled("api", { lineWidth: 2 })) }),
      timeRows(),
    );
    expect(named(options, "api").z).toBe(3.5);
  });
});

describe("overlapping series", () => {
  const same = { "leaf-spine": [10, 40, 25], "spine-leaf": [10, 40, 25] };

  it("a dashed line goes above a thick solid twin without a colour change", async () => {
    const options = await runSQL(
      sqlPanel(
        "line",
        overrides(
          styled("leaf-spine", { lineWidth: 5 }),
          styled("spine-leaf", { lineStyle: "dashed" }),
        ),
      ),
      timeRows(same),
    );
    expect(named(options, "spine-leaf").z).toBe(3.5);
    expect(named(options, "leaf-spine").z).toBeUndefined();
  });

  it("a line thinner than the panel width goes on top; solid and default lines stay put", async () => {
    const options = await runSQL(
      sqlPanel(
        "line",
        overrides(
          styled("leaf-spine", { lineWidth: 1 }),
          styled("spine-leaf", { lineStyle: "solid", lineWidth: 1.5 }),
        ),
      ),
      timeRows(same),
    );
    expect(named(options, "leaf-spine").z).toBe(3.5);
    expect(named(options, "spine-leaf").z).toBeUndefined();
  });

  it("bars are not raised", async () => {
    const options = await runSQL(
      sqlPanel("bar", overrides(styled("api", { lineStyle: "dashed" })), endpointX),
      categoryRows(),
    );
    expect(named(options, "api").z).toBeUndefined();
  });

  it.each(["light", "dark"])(
    "%s: the dashed line is painted after the thick one in the same colour",
    async (theme) => {
      const sameColour = { mode: "fixed", fixedColor: ["#5470c6"] };
      const options = await runSQL(
        sqlPanel("line", {
          color: sameColour,
          ...overrides(
            styled("leaf-spine", { lineStyle: "dashed", lineWidth: 2 }),
            styled("spine-leaf", { lineWidth: 5 }),
          ),
        }),
        timeRows(same),
        theme,
      );
      // The dashed series comes first, so without raising it the thick one would paint over it.
      expect(options.series.findIndex((s: any) => s.name === "leaf-spine")).toBe(0);
      const { svg } = render(options);
      const thick = svg.search(/<path [^>]*stroke-width="5"/);
      const dashed = svg.search(/<path [^>]*stroke-width="2"[^>]*stroke-dasharray/);
      expect(thick).toBeGreaterThan(-1);
      expect(dashed).toBeGreaterThan(thick);
    },
  );
});

describe("PromQL overlap", () => {
  it("the dashed twin is raised on a PromQL line", async () => {
    const options = await runPromQL(
      promPanel(
        "line",
        overrides(styled("api", { lineWidth: 5 }), styled("web", { lineStyle: "dashed" })),
      ),
      promData({ api: [10, 40, 25], web: [10, 40, 25] }),
    );
    expect(named(options, "web").z).toBe(3.5);
    expect(named(options, "api").z).toBeUndefined();
  });
});

describe("rendered by ECharts", () => {
  it.each(["light", "dark"])(
    "%s: two identical series both show when one is dashed and the other thicker",
    async (theme) => {
      const same = { "leaf-spine": [10, 40, 25], "spine-leaf": [10, 40, 25] };
      const options = await runSQL(
        sqlPanel(
          "line",
          overrides(
            styled("leaf-spine", { lineWidth: 5 }),
            styled("spine-leaf", { lineStyle: "dashed", lineWidth: 2 }),
          ),
        ),
        timeRows(same),
        theme,
      );
      const { svg } = render(options);
      const paths = [...svg.matchAll(/<path [^>]*stroke-width="([\d.]+)"[^>]*>/g)];
      const widths = paths.map((m) => m[1]);
      expect(widths).toContain("5");
      const dashed = paths.filter((m) => m[0].includes("stroke-dasharray") && m[1] === "2");
      expect(dashed.length).toBeGreaterThan(0);
    },
  );
});

describe("applySeriesStyleOverrides", () => {
  it("does nothing for chart types without series styles", () => {
    const options = { series: [{ name: "api", type: "pie", data: [] }] } as any;
    applySeriesStyleOverrides(options, {
      type: "pie",
      config: overrides(styled("api", { lineStyle: "dashed" })),
    });
    expect(options.series[0].lineStyle).toBeUndefined();
  });

  it("hide from chart without a legend adds a hidden one", () => {
    const options = { series: [{ name: "api", type: "line", data: [] }] } as any;
    applySeriesStyleOverrides(options, {
      type: "line",
      config: overrides(styled("api", { hideFrom: { chart: true } })),
    });
    expect(options.legend).toEqual({ show: false, selected: { api: false } });
  });
});
