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
import {
  barGaugeBands,
  barGaugeDrilldownSeries,
  barGaugeFraction,
  barGaugeItems,
  convertBarGaugeData,
} from "./convertBarGaugeData";
import { calculateWidthText } from "./chartDimensionUtils";
import { chartColor } from "@/utils/chartTheme";
import {
  getLegendSeriesNames,
  readOriginalNames,
} from "@/composables/dashboard/useSeriesFormatting";

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};
const panelRef = () => ({ value: { offsetWidth: 800, offsetHeight: 400 } });
const metadata = {
  queries: [
    {
      query: "SELECT 1",
      startTime: 1704067200000000,
      endTime: 1704070800000000,
      timeRangeGap: { seconds: 0, periodAsStr: "" },
      panelQueryIndex: 0,
    },
  ],
};

const xField = { label: "Endpoint", alias: "x_axis_1", column: "endpoint", args: [] };
const yField = {
  label: "Requests",
  alias: "y_axis_1",
  column: "requests",
  functionName: "count",
  aggregationFunction: "count",
  args: [{ type: "field", value: { field: "requests" } }],
};

const sqlPanel = (
  type: string,
  config: Record<string, any> = {},
  fields: any = {},
  queryConfig: Record<string, any> = {},
) => ({
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
        x: [xField],
        y: [yField],
        z: [],
        breakdown: [],
        ...fields,
      },
      config: { min: 0, max: 100, ...queryConfig },
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});
const fixedRange = { range_mode: "fixed" };

const rows = () => [
  { x_axis_1: "/a", y_axis_1: 70 },
  { x_axis_1: "/b", y_axis_1: 25 },
  { x_axis_1: "/c", y_axis_1: 3 },
  { x_axis_1: "/d", y_axis_1: 2 },
];

const twoQueryMetadata = {
  queries: [0, 1].map((panelQueryIndex) => ({ ...metadata.queries[0], panelQueryIndex })),
};
const viaTwoQueries = async (panel: any, data: any[][]) =>
  (
    (await convertPanelData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      twoQueryMetadata,
      { height: "400px" },
      { value: [] },
      false,
    )) as any
  ).options;
const withSecondQuery = (panel: any, query: Record<string, any>) => {
  panel.queries.push({ ...panel.queries[0], ...query });
  return panel;
};

const viaPanel = async (panel: any, data: any[]) =>
  (
    (await convertPanelData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      panel.queryType === "promql" ? null : metadata,
      { height: "400px" },
      { value: [] },
      false,
    )) as any
  ).options;

const promPanel = (type: string, config: Record<string, any> = {}) => ({
  id: "pq",
  type,
  queryType: "promql",
  queries: [
    {
      query: "sum by (job) (up)",
      customQuery: true,
      fields: { stream: "up", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
      config: { promql_legend: "{job}", min: 0, max: 100 },
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});
const promData = () => [
  {
    resultType: "matrix",
    result: [
      { metric: { job: "api" }, values: [[1704067200, "70"]] },
      { metric: { job: "web" }, values: [[1704067200, "25"]] },
      { metric: { job: "db" }, values: [[1704067200, "3"]] },
      { metric: { job: "cache" }, values: [[1704067200, "2"]] },
    ],
  },
];
const bars = (options: any) => options.series.filter((s: any) => s.type === "bar");
const valueLabels = (options: any) => options.series.at(-1);
const cells = (options: any) => options.series.filter((s: any) => s.type === "pictorialBar");
const thresholds = {
  mode: "absolute",
  showAs: "color",
  baseColor: "#00aa00",
  steps: [
    { value: 20, color: "#ffaa00" },
    { value: 60, color: "#ff0000" },
  ],
};

describe("bar gauge items", () => {
  it("reads one item per gauge dial and falls back to the value field name", () => {
    const items = barGaugeItems(
      {
        series: [
          {
            type: "gauge",
            min: 0,
            max: 50,
            data: [{ name: "", value: 7, detail: { formatter: (v: number) => `${v} ms` } }],
          },
          { type: "line", data: [] },
        ],
      },
      sqlPanel("bar-gauge", {}, { x: [] }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Requests", value: 7, min: 0, max: 50, text: "7 ms" });
  });

  it("splits the range at the steps inside it and keeps the base colour below the first", () => {
    const item = { name: "a", value: 50, min: 0, max: 100, color: "#123456", text: "50" };
    expect(barGaugeBands(item, null, 0)).toEqual([{ from: 0, to: 100, color: "#123456" }]);
    expect(barGaugeBands(item, thresholds as any, 0)).toEqual([
      { from: 0, to: 20, color: "#00aa00" },
      { from: 20, to: 60, color: "#ffaa00" },
      { from: 60, to: 100, color: "#ff0000" },
    ]);
    const narrow = { ...item, min: 30, max: 50 };
    expect(barGaugeBands(narrow, thresholds as any, 0)).toEqual([
      { from: 30, to: 50, color: "#ffaa00" },
    ]);
  });

  it("names an empty group (empty) so Series formatting lists it, while drilldown keeps the blank value", async () => {
    const data = [
      { x_axis_1: "api", y_axis_1: 7 },
      { x_axis_1: "", y_axis_1: 88 },
    ];
    const overrides = {
      override_config: [
        {
          field: { matchBy: "series", value: "(empty)" },
          config: [
            { type: "display_name", value: "No container" },
            { type: "series_color", value: "#123456" },
          ],
        },
      ],
    };
    const options = await viaPanel(sqlPanel("bar-gauge", overrides, {}, fixedRange), [data]);
    const [bar] = bars(options);
    expect(bar.data.map((d: any) => [d.name, d.rawName])).toEqual([
      ["(empty)", ""],
      ["api", undefined],
    ]);
    expect(getLegendSeriesNames(options, "bar-gauge")).toEqual(["(empty)", "api"]);
    expect(options.yAxis.axisLabel.formatter("(empty)", 0)).toBe("No container");
    expect(bar.data[0].itemStyle.color.colorStops.at(-1).color).toBe("#123456");
    expect(barGaugeDrilldownSeries({ name: "(empty)", data: bar.data[0] })).toEqual({
      __name: "",
      __value: 88,
      __axisValue: "",
    });

    const plain = await viaPanel(sqlPanel("bar-gauge", {}, {}, fixedRange), [data]);
    expect(plain.yAxis.axisLabel.formatter("(empty)", 0)).toBe("(empty)");
    const unlabelled = await viaPanel(sqlPanel("bar-gauge", {}, { x: [] }, fixedRange), [
      [{ y_axis_1: 5 }],
    ]);
    expect(bars(unlabelled)[0].data[0].name).toBe("Requests");
  });

  it("labels a panel with a label field but no rows by its value field, not as an empty group", () => {
    const items = barGaugeItems(
      { series: [{ type: "gauge", min: 0, max: 100, data: [{ name: "", value: null }] }] },
      sqlPanel("bar-gauge"),
    );
    expect(items[0]).toMatchObject({ name: "Requests", label: "Requests" });
  });

  it("names a whitespace-only group (empty) too, keeping its own value for drilldown", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge", {}, {}, fixedRange), [
      [{ x_axis_1: "  ", y_axis_1: 3 }],
    ]);
    expect(bars(options)[0].data[0]).toMatchObject({ name: "(empty)", rawName: "  " });
    expect(getLegendSeriesNames(options, "bar-gauge")).toEqual(["(empty)"]);
  });

  it("labels a whitespace name (empty) so the bar is never blank", () => {
    const items = barGaugeItems(
      { series: [{ type: "gauge", min: 0, max: 50, data: [{ name: "  ", value: 3 }] }] },
      sqlPanel("bar-gauge"),
    );
    expect(items[0]).toMatchObject({ name: "  ", label: "(empty)" });
  });

  it("finds only a top-level ORDER BY, so a sort inside a subquery, window, literal or comment still gets name order", () => {
    const gauge = (name: string) => ({
      type: "gauge",
      min: 0,
      max: 100,
      data: [{ name, value: 1 }],
    });
    const series = [gauge("c"), gauge("a"), gauge("b")];
    const order = (sql: string) => {
      const panel = sqlPanel("bar-gauge");
      Object.assign(panel.queries[0], { customQuery: true, query: sql });
      return barGaugeItems({ series }, panel).map((item) => item.name);
    };
    const base = "SELECT x_axis_1, y_axis_1 FROM";
    expect(order(`${base} (SELECT * FROM t ORDER BY y LIMIT 10) GROUP BY x_axis_1`)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(order(`SELECT 'order by' AS s, x_axis_1 FROM t GROUP BY x_axis_1`)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(order(`${base} t GROUP BY x_axis_1 -- order by y`)).toEqual(["a", "b", "c"]);
    expect(order(`SELECT row_number() OVER (ORDER BY y) AS r FROM t`)).toEqual(["a", "b", "c"]);
    expect(order(`${base} t GROUP BY x_axis_1 ORDER BY y_axis_1`)).toEqual(["c", "a", "b"]);
  });

  it("ignores sortBy on a derived builder field and sorts numeric names by value", () => {
    const gauge = (name: string) => ({
      type: "gauge",
      min: 0,
      max: 100,
      data: [{ name, value: 1 }],
    });
    const derived = sqlPanel(
      "bar-gauge",
      {},
      { y: [{ ...yField, sortBy: "DESC", isDerived: true }] },
    );
    const names = ["10", "9", "-5", "1.5", "-10"].map(gauge);
    expect(barGaugeItems({ series: names }, derived).map((item) => item.name)).toEqual([
      "-10",
      "-5",
      "1.5",
      "9",
      "10",
    ]);
  });

  it("places a value on its own range, clamped to the track, and drills down with the real value", () => {
    expect(barGaugeFraction(500, 0, 1000)).toBe(0.5);
    expect(barGaugeFraction(-4184, -39912, 48088)).toBeCloseTo(35728 / 88000);
    expect(barGaugeFraction(2000, 0, 1000)).toBe(1);
    expect(barGaugeFraction(-5, 0, 1000)).toBe(0);
    expect(barGaugeFraction(null, 0, 1000)).toBe(0);
    expect(barGaugeDrilldownSeries({ name: "api", data: { rawValue: null } }).__value).toBe("");
    expect(barGaugeDrilldownSeries({ name: "api", data: { rawValue: 500 } })).toEqual({
      __name: "api",
      __value: 500,
      __axisValue: "api",
    });
  });

  it("orders bars by name when no query sorts, whatever order the rows came back in", () => {
    const gauge = (name: string, value: number) => ({
      type: "gauge",
      min: 0,
      max: 100,
      data: [{ name, value }],
    });
    const names = (series: any[], panel: any) =>
      barGaugeItems({ series }, panel).map((item) => item.name);
    const first = [gauge("pod-10", 5), gauge("pod-2", 90), gauge("api", 40)];
    const second = [gauge("api", 40), gauge("pod-2", 90), gauge("pod-10", 5)];
    const unsorted = sqlPanel("bar-gauge");
    expect(names(first, unsorted)).toEqual(["api", "pod-2", "pod-10"]);
    expect(names(second, unsorted)).toEqual(["api", "pod-2", "pod-10"]);

    const builderSort = sqlPanel("bar-gauge", {}, { y: [{ ...yField, sortBy: "DESC" }] });
    expect(names(first, builderSort)).toEqual(["pod-10", "pod-2", "api"]);
    const custom = sqlPanel("bar-gauge");
    custom.queries[0].customQuery = true;
    expect(names(first, custom)).toEqual(["api", "pod-2", "pod-10"]);
    custom.queries[0].query = "SELECT a FROM t GROUP BY a\n ORDER  BY y_axis_1 DESC";
    expect(names(first, custom)).toEqual(["pod-10", "pod-2", "api"]);
    expect(names(first, promPanel("bar-gauge"))).toEqual(["pod-10", "pod-2", "api"]);
  });

  it("returns no series when there are no dials", () => {
    expect(convertBarGaugeData({ series: [] }, sqlPanel("bar-gauge"))).toEqual({ series: [] });
  });
});

describe("bar gauge through convertPanelData", () => {
  it("SQL: one horizontal gradient bar per label on the query's fixed min..max, with the unfilled track", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge", {}, {}, fixedRange), [rows()]);
    const [bar] = bars(options);
    expect(bar.data.map((d: any) => [d.name, d.value, d.rawValue])).toEqual([
      ["/a", 0.7, 70],
      ["/b", 0.25, 25],
      ["/c", 0.03, 3],
      ["/d", 0.02, 2],
    ]);
    expect(options.yAxis).toMatchObject({ type: "category", inverse: true });
    expect(options.xAxis).toMatchObject({ type: "value", min: 0, max: 1, show: false });
    expect(bar.showBackground).toBe(true);
    expect(bar.data[0].itemStyle.color).toMatchObject({ type: "linear", x2: 1, y2: 0 });
    expect(valueLabels(options).label.formatter({ dataIndex: 0 })).toBe("70");
    expect(cells(options)).toHaveLength(0);
  });

  it("scales to the data when no range is picked, so large counts do not all fill the track", async () => {
    const big = rows().map((row) => ({ ...row, y_axis_1: row.y_axis_1 * 1000 }));
    const options = await viaPanel(sqlPanel("bar-gauge"), [big]);
    expect(bars(options)[0].data.map((d: any) => d.value)).toEqual([
      1,
      25000 / 70000,
      3000 / 70000,
      2000 / 70000,
    ]);
  });

  it("reserves a name gutter as wide as the widest label, capped, so names truncate instead of clipping at the edge", async () => {
    const short = await viaPanel(sqlPanel("bar-gauge", {}, {}, fixedRange), [rows()]);
    expect(short.grid.containLabel).toBe(false);
    expect(short.grid.left).toBe(8 + short.yAxis.axisLabel.width + 8);
    expect(short.yAxis.axisLabel).toMatchObject({ overflow: "truncate", margin: 8 });

    const long = rows().map((row, i) => ({
      ...row,
      x_axis_1: `/${"very-long-endpoint-".repeat(12)}${i}`,
    }));
    const capped = await viaPanel(sqlPanel("bar-gauge", {}, {}, fixedRange), [long]);
    expect(capped.yAxis.axisLabel.width).toBe(160);
    expect(capped.grid.left).toBe(176);
    expect(short.yAxis.axisLabel.width).toBeLessThan(160);
  });

  it("fills each bar by its own query's fixed range, not one shared scale", () => {
    const panel = sqlPanel("bar-gauge", {}, {}, { ...fixedRange, min: 0, max: 40000 });
    panel.queries.push({
      ...panel.queries[0],
      config: { ...fixedRange, min: 0, max: 1000 },
    });
    const gauges = {
      series: [
        { type: "gauge", min: 0, max: 40000, data: [{ name: "big", value: 35000 }] },
        { type: "gauge", min: 0, max: 1000, data: [{ name: "half", value: 500 }] },
      ],
    };
    const options: any = convertBarGaugeData(gauges, panel, 800);
    const [bar] = bars(options);
    expect(bar.data.map((d: any) => [d.name, d.value])).toEqual([
      ["big", 35000 / 40000],
      ["half", 0.5],
    ]);
    expect(valueLabels(options).label.formatter({ dataIndex: 1 })).toBe("500");
  });

  it("draws negative values from the start of the track, so a higher value is always longer", async () => {
    const negative = [
      { x_axis_1: "a", y_axis_1: -39912 },
      { x_axis_1: "b", y_axis_1: -4184 },
      { x_axis_1: "c", y_axis_1: 48088 },
    ];
    const options = await viaPanel(sqlPanel("bar-gauge", { bar_gauge_mode: "basic" }), [negative]);
    const lengths = bars(options)[0].data.map((d: any) => d.value);
    expect(lengths[0]).toBe(0);
    expect(lengths[0]).toBeLessThan(lengths[1]);
    expect(lengths[1]).toBeLessThan(lengths[2]);
    expect(lengths.every((value: number) => value >= 0 && value <= 1)).toBe(true);
    expect(options.xAxis).toMatchObject({ min: 0, max: 1 });
  });

  it("sizes the value gutter to the widest value text, capped, and truncates past it", async () => {
    const long = rows().map((row) => ({ ...row, y_axis_1: row.y_axis_1 * 123456789012 }));
    const options = await viaPanel(sqlPanel("bar-gauge"), [long]);
    const label = valueLabels(options).label;
    const widest = Math.max(
      ...[0, 1, 2, 3].map((i) => calculateWidthText(label.formatter({ dataIndex: i }))),
    );
    expect(label).toMatchObject({ overflow: "truncate", width: widest + 2 });
    expect(options.grid.right).toBe(8 + widest + 2 + label.distance);

    const twenty = "12345678901234567890";
    const huge: any = convertBarGaugeData(
      {
        series: [
          {
            type: "gauge",
            min: 0,
            max: 1,
            data: [{ name: "a", value: 1, detail: { formatter: () => twenty.repeat(10) } }],
          },
        ],
      },
      sqlPanel("bar-gauge"),
      800,
    );
    expect(valueLabels(huge).label.width).toBe(160);
    expect(huge.grid.right).toBeGreaterThanOrEqual(calculateWidthText(twenty));
  });

  it("vertical names and values truncate to the width each bar gets, narrower as bars are added", () => {
    const gauges = (count: number) => ({
      series: Array.from({ length: count }, (_unused, i) => ({
        type: "gauge",
        min: 0,
        max: 100,
        data: [{ name: `kube-prometheus-stack-operator-pod-${i}`, value: i }],
      })),
    });
    const panel = sqlPanel("bar-gauge", { bar_gauge_orientation: "vertical" });
    const few: any = convertBarGaugeData(gauges(4), panel, 800);
    const many: any = convertBarGaugeData(gauges(16), panel, 800);
    expect(few.xAxis.axisLabel).toMatchObject({ overflow: "truncate", interval: 0 });
    expect(typeof few.xAxis.axisLabel.width).toBe("number");
    expect(many.xAxis.axisLabel.width).toBeLessThan(few.xAxis.axisLabel.width);
    expect(few.xAxis.axisLabel.width).toBe((800 - 16) / 4 - 4);
    expect(valueLabels(many).label.width).toBe(many.xAxis.axisLabel.width);
    expect(many.tooltip.formatter({ dataIndex: 3 })).toContain(
      "kube-prometheus-stack-operator-pod-3",
    );
  });

  it("two SQL queries keep their own fixed ranges, their own label fields and their own order", async () => {
    const panel = withSecondQuery(sqlPanel("bar-gauge", {}, {}, { ...fixedRange, max: 40000 }), {
      fields: { ...sqlPanel("bar-gauge").queries[0].fields, x: [] },
      config: { ...fixedRange, min: 0, max: 1000 },
    });
    const options = await viaTwoQueries(panel, [
      [
        { x_axis_1: "zeta", y_axis_1: 35000 },
        { x_axis_1: "", y_axis_1: 88 },
        { x_axis_1: "alpha", y_axis_1: 4000 },
      ],
      [{ y_axis_1: 500 }],
    ]);
    const [bar] = bars(options);
    expect(bar.data.map((d: any) => [d.name, d.value])).toEqual([
      ["(empty)", 88 / 40000],
      ["alpha", 0.1],
      ["zeta", 35000 / 40000],
      ["Requests", 0.5],
    ]);
    expect(options.yAxis.axisLabel.formatter("(empty)", 0)).toBe("(empty)");
    expect(bar.data[0].rawName).toBe("");
    expect(valueLabels(options).label.formatter({ dataIndex: 3 })).toBe("500");
  });

  it("gradient stops of a value past max sit where the steps fall on the full track", () => {
    const gauges = {
      series: [{ type: "gauge", min: 0, max: 1000, data: [{ name: "a", value: 1500 }] }],
    };
    const steps = {
      ...thresholds,
      steps: [
        { value: 300, color: "#ff0000" },
        { value: 700, color: "#00ff00" },
      ],
    };
    const options: any = convertBarGaugeData(
      gauges,
      sqlPanel("bar-gauge", { thresholds: steps }),
      800,
    );
    const offsets = bars(options)[0].data[0].itemStyle.color.colorStops.map(
      (stop: any) => stop.offset,
    );
    expect(offsets).toEqual([0, 0.3, 0.7, 1]);
  });

  it("caps both horizontal gutters by a share of a narrow panel, so the track keeps its room", () => {
    const gauges = {
      series: [
        {
          type: "gauge",
          min: 0,
          max: 1,
          data: [{ name: "n".repeat(400), value: 1, detail: { formatter: () => "9".repeat(400) } }],
        },
      ],
    };
    const options: any = convertBarGaugeData(gauges, sqlPanel("bar-gauge"), 300);
    expect(options.yAxis.axisLabel.width).toBe(90);
    expect(valueLabels(options).label.width).toBe(75);
    expect(300 - options.grid.left - options.grid.right).toBeGreaterThan(100);
  });

  it("vertical labels thin out once a bar's slot is too narrow for an ellipsis, and value text hides", () => {
    const gauges = {
      series: Array.from({ length: 40 }, (_unused, i) => ({
        type: "gauge",
        min: 0,
        max: 100,
        data: [{ name: `pod-${i}`, value: i }],
      })),
    };
    const panel = sqlPanel("bar-gauge", { bar_gauge_orientation: "vertical" });
    const crowded: any = convertBarGaugeData(gauges, panel, 400);
    expect(crowded.xAxis.axisLabel).toMatchObject({ interval: "auto", width: 24 });
    expect(valueLabels(crowded).label.show).toBe(false);
    const roomy: any = convertBarGaugeData(gauges, panel, 4000);
    expect(roomy.xAxis.axisLabel.interval).toBe(0);
    expect(valueLabels(roomy).label.show).toBe(true);
  });

  it("puts the value text past the end of the track, never on the fill", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge", {}, {}, fixedRange), [rows()]);
    const labels = valueLabels(options);
    expect(labels.data).toEqual([1, 1, 1, 1]);
    expect(labels.itemStyle.color).toBe("transparent");
    expect(labels.label.position).toBe("right");
    expect(bars(options)[0].label).toBeUndefined();
  });

  it("basic mode colours each bar by the step its value reaches", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge", { bar_gauge_mode: "basic", thresholds }), [
      rows(),
    ]);
    expect(bars(options)[0].data.map((d: any) => d.itemStyle.color)).toEqual([
      "#ff0000",
      "#ffaa00",
      "#00aa00",
      "#00aa00",
    ]);
  });

  it("gradient mode blends the step colours up to the value", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge", { thresholds }), [rows()]);
    const stops = bars(options)[0].data[0].itemStyle.color.colorStops;
    expect(stops.map((stop: any) => stop.color)).toEqual([
      "#00aa00",
      "#ffaa00",
      "#ff0000",
      "#ff0000",
    ]);
    expect(stops[1].offset).toBeCloseTo(20 / 70);
  });

  it("LCD mode draws one cell series per band, lowest on top, behind a transparent label bar", async () => {
    const options = await viaPanel(
      sqlPanel("bar-gauge", { bar_gauge_mode: "lcd", thresholds }, {}, fixedRange),
      [rows()],
    );
    const series = cells(options);
    expect(series).toHaveLength(4);
    expect(series[0].data[0].itemStyle.color).toBe(chartColor("--color-border-subtle"));
    const lit = series.slice(1);
    expect(lit.map((s: any) => s.z)).toEqual([6, 5, 4]);
    expect(lit.map((s: any) => s.data[0].value)).toEqual([0.2, 0.6, 0.7]);
    expect(lit[2].data[1]).toBe("-");
    expect(series[0].data[0].value).toBe(1);
    expect(lit.every((s: any) => s.symbolClip && s.symbolBoundingData === 1)).toBe(true);
    expect(bars(options)[0].data[0].itemStyle.color).toBe("transparent");
    expect(bars(options)[0].showBackground).toBeUndefined();
  });

  it("vertical orientation and no unfilled track", async () => {
    const options = await viaPanel(
      sqlPanel("bar-gauge", { bar_gauge_orientation: "vertical", bar_gauge_show_unfilled: false }),
      [rows()],
    );
    expect(options.xAxis.type).toBe("category");
    expect(options.yAxis.type).toBe("value");
    const [bar] = bars(options);
    expect(bar.showBackground).toBeUndefined();
    expect(valueLabels(options).label.position).toBe("top");
    expect(bar.data[0].itemStyle.color).toMatchObject({ x2: 0, y: 1 });
  });

  it("shows the no-value text for an empty result", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge", { no_value_replacement: "n/a" }), [[]]);
    expect(valueLabels(options).label.formatter({ dataIndex: 0 })).toBe("n/a");
  });

  it("a display-name override renames its bar instead of adding a second one", async () => {
    const renamed = {
      override_config: [
        {
          field: { matchBy: "series", value: "/a" },
          config: [{ type: "display_name", value: "API" }],
        },
      ],
    };
    const options = await viaPanel(sqlPanel("bar-gauge", renamed, {}, fixedRange), [rows()]);
    const [bar] = bars(options);
    expect(bar.data.map((d: any) => d.name)).toEqual(["/a", "/b", "/c", "/d"]);
    expect(options.yAxis.axisLabel.formatter("/a", 0)).toBe("API");
    expect(options.yAxis.axisLabel.formatter("/b", 1)).toBe("/b");
    expect(options.tooltip.formatter({ dataIndex: 0 })).toContain("API");

    const prom = await viaPanel(
      promPanel("bar-gauge", {
        override_config: [
          {
            field: { matchBy: "series", value: "api" },
            config: [{ type: "display_name", value: "API" }],
          },
        ],
      }),
      promData(),
    );
    expect(bars(prom)[0].data.map((d: any) => d.name)).toEqual(["api", "web", "db", "cache"]);
    expect(prom.yAxis.axisLabel.formatter("api", 0)).toBe("API");
  });

  it("lists every bar for Series formatting and Color by series", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge", {}, {}, fixedRange), [rows()]);
    expect(getLegendSeriesNames(options, "bar-gauge")).toEqual(["/a", "/b", "/c", "/d"]);
    const prom = await viaPanel(promPanel("bar-gauge"), promData());
    expect(getLegendSeriesNames(prom, "bar-gauge")).toEqual(["api", "web", "db", "cache"]);
  });

  it("Series formatting lists every bar, (empty) included, for Gauge and Bar gauge", async () => {
    const data = [
      { x_axis_1: "api", y_axis_1: 7 },
      { x_axis_1: "", y_axis_1: 88 },
    ];
    for (const type of ["bar-gauge", "gauge"]) {
      const source = { panelSchema: sqlPanel(type, {}, {}, fixedRange), data: [data], metadata };
      const names = await readOriginalNames(source as any, type, store);
      expect(names.sort()).toEqual(["(empty)", "api"]);
    }
  });

  it("PromQL: one bar per series with its legend name and latest value", async () => {
    const options = await viaPanel(promPanel("bar-gauge"), promData());
    expect(bars(options)[0].data.map((d: any) => [d.name, d.rawValue])).toEqual([
      ["api", 70],
      ["web", 25],
      ["db", 3],
      ["cache", 2],
    ]);
    expect(options.tooltip.formatter({ dataIndex: 1 })).toContain("web");
  });
});
