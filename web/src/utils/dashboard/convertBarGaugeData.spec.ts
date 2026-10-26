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
import { barGaugeBands, barGaugeItems, convertBarGaugeData } from "./convertBarGaugeData";
import { chartColor } from "@/utils/chartTheme";

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

const sqlPanel = (type: string, config: Record<string, any> = {}, fields: any = {}) => ({
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
      config: { min: 0, max: 100 },
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});

const rows = () => [
  { x_axis_1: "/a", y_axis_1: 70 },
  { x_axis_1: "/b", y_axis_1: 25 },
  { x_axis_1: "/c", y_axis_1: 3 },
  { x_axis_1: "/d", y_axis_1: 2 },
];

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
      sqlPanel("bar-gauge"),
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

  it("returns no series when there are no dials", () => {
    expect(convertBarGaugeData({ series: [] }, sqlPanel("bar-gauge"))).toEqual({ series: [] });
  });
});

describe("bar gauge through convertPanelData", () => {
  it("SQL: one horizontal gradient bar per label on the query's min..max, with the unfilled track", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge"), [rows()]);
    const [bar] = bars(options);
    expect(bar.data.map((d: any) => [d.name, d.value])).toEqual([
      ["/a", 70],
      ["/b", 25],
      ["/c", 3],
      ["/d", 2],
    ]);
    expect(options.yAxis).toMatchObject({ type: "category", inverse: true });
    expect(options.xAxis).toMatchObject({ type: "value", min: 0, max: 100, show: false });
    expect(bar.showBackground).toBe(true);
    expect(bar.data[0].itemStyle.color).toMatchObject({ type: "linear", x2: 1, y2: 0 });
    expect(bar.label.formatter({ dataIndex: 0 })).toBe("70");
    expect(cells(options)).toHaveLength(0);
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
    const options = await viaPanel(sqlPanel("bar-gauge", { bar_gauge_mode: "lcd", thresholds }), [
      rows(),
    ]);
    const series = cells(options);
    expect(series).toHaveLength(4);
    expect(series[0].data[0].itemStyle.color).toBe(chartColor("--color-border-subtle"));
    const lit = series.slice(1);
    expect(lit.map((s: any) => s.z)).toEqual([6, 5, 4]);
    expect(lit.map((s: any) => s.data[0].value)).toEqual([20, 60, 70]);
    expect(lit[2].data[1]).toBe("-");
    expect(lit.every((s: any) => s.symbolClip && s.symbolBoundingData === 100)).toBe(true);
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
    expect(bar.label.position).toBe("top");
    expect(bar.data[0].itemStyle.color).toMatchObject({ x2: 0, y: 1 });
  });

  it("shows the no-value text for an empty result", async () => {
    const options = await viaPanel(sqlPanel("bar-gauge", { no_value_replacement: "n/a" }), [[]]);
    expect(bars(options)[0].label.formatter({ dataIndex: 0 })).toBe("n/a");
  });

  it("PromQL: one bar per series with its legend name and latest value", async () => {
    const options = await viaPanel(promPanel("bar-gauge"), promData());
    expect(bars(options)[0].data.map((d: any) => [d.name, d.value])).toEqual([
      ["api", 70],
      ["web", 25],
      ["db", 3],
      ["cache", 2],
    ]);
    expect(options.tooltip.formatter({ dataIndex: 1 })).toContain("web");
  });
});
