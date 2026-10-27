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
import * as echarts from "echarts";
import { convertPanelData } from "./convertPanelData";
import { buildSQLChartQuery } from "./dashboardAutoQueryBuilder";
import { labelColorOn } from "./chartLabelContrast";

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));
// The converter and ECharts must measure text alike, as the browser canvas does for both.
const GLYPH = 7;
vi.mock("./chartDimensionUtils", async (original) => ({
  ...(await original<any>()),
  calculateWidthText: (text: string) => String(text ?? "").length * GLYPH,
}));
(echarts as any).setPlatformAPI({
  measureText: (text: string) => ({
    width: text === "国" ? 12 : String(text ?? "").length * GLYPH,
  }),
});

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};

const field = (alias: string, column: string, functionName: string | null = null) => ({
  label: "",
  alias,
  column,
  functionName,
  args: [{ type: "field", value: { field: column } }],
  isDerived: false,
  havingConditions: [],
});

const panel = (fields: any, config: Record<string, any> = {}) => ({
  id: "p",
  type: "sunburst",
  queryType: "sql",
  queries: [
    {
      query: "",
      customQuery: false,
      fields: {
        stream: "demo_app",
        stream_type: "logs",
        x: [field("x_axis_1", "region")],
        y: [field("y_axis_1", "_timestamp", "count")],
        z: [],
        breakdown: [field("breakdown_1", "service")],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
        ...fields,
      },
      config: { limit: 0 },
      joins: [],
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});

const convert = async (schema: any, data: any[], size = { width: 800, height: 400 }) =>
  (await convertPanelData(
    schema,
    data,
    store,
    { value: { offsetWidth: size.width, offsetHeight: size.height } },
    { value: null },
    { value: [] },
    { queries: [] },
    { height: "400px" },
    { value: [] },
    false,
  )) as any;

const rows = [
  { x_axis_1: "us-east", breakdown_1: "cart", y_axis_1: 40 },
  { x_axis_1: "us-east", breakdown_1: "auth", y_axis_1: 10 },
  { x_axis_1: "eu-west", breakdown_1: "cart", y_axis_1: 30 },
];

describe("sunburst", () => {
  it("builds the grouped builder SQL, one row per ring pair", () => {
    const schema = panel({});
    expect(
      buildSQLChartQuery({
        queryData: schema.queries[0],
        chartType: "sunburst",
        dashboardPanelData: { data: schema, meta: {} },
      }),
    ).toBe(
      'SELECT region as "x_axis_1", count(_timestamp) as "y_axis_1", service as "breakdown_1" FROM "demo_app"  GROUP BY x_axis_1, breakdown_1',
    );
  });

  it("nests the breakdown ring under the x ring and sums values", async () => {
    const out = await convert(panel({}), [rows]);
    const series = out.options.series[0];
    expect(out.chartType).toBe("sunburst");
    expect(series.type).toBe("sunburst");
    expect(series.data.map((node: any) => [node.name, node.value])).toEqual([
      ["us-east", 50],
      ["eu-west", 30],
    ]);
    expect(series.data[0].children.map((node: any) => node.name)).toEqual(["cart", "auth"]);
    expect(series.data[0].itemStyle.color).toBeTruthy();
  });

  it("shows labels and zooms on click by default", async () => {
    const series = (await convert(panel({}), [rows])).options.series[0];
    expect(series.label.show).toBe(true);
    expect(series.nodeClick).toBe("rootToNode");
  });

  it("hides labels when switched off, and leaves the click to a drilldown", async () => {
    const series = (
      await convert(panel({}, { sunburst_show_labels: false, drilldown: [{ name: "d" }] }), [rows])
    ).options.series[0];
    expect(series.label.show).toBe(false);
    expect(series.nodeClick).toBe(false);
  });

  it("draws one ring without a breakdown and nothing without rows", async () => {
    const flat = (await convert(panel({ breakdown: [] }), [rows])).options.series[0];
    expect(flat.data.every((node: any) => !node.children)).toBe(true);
    expect((await convert(panel({}), [[]])).options.series).toEqual([]);
  });

  it("labels each slice in white or black by the colour it is painted, outer ring included", async () => {
    const series = (
      await convert(panel({}, { color: { mode: "fixed", fixedColor: ["#5b8ef0"] } }), [rows])
    ).options.series[0];
    const [usEast] = series.data;
    expect(usEast.label.color).toBe(labelColorOn(usEast.itemStyle.color));
    usEast.children.forEach((child: any) => {
      // The outer ring is the parent colour faded toward the panel surface, so pale slices get dark text.
      expect(child.itemStyle.color).not.toBe(usEast.itemStyle.color);
      expect(child.label.color).toBe(labelColorOn(child.itemStyle.color));
    });
    expect(series.levels[2].itemStyle).toBeUndefined();
    expect(labelColorOn("rgba(206,221,251,1)")).toBe("#000000");
  });

  it("sets a per-ring minimum angle and hides rings too shallow for text", async () => {
    const small = (await convert(panel({}), [rows], { width: 400, height: 250 })).options.series[0];
    const large = (await convert(panel({}), [rows], { width: 1200, height: 500 })).options
      .series[0];
    const [, innerSmall, outerSmall] = small.levels.map((level: any) => level.label);
    // A slice needs a text line of arc at its middle, so the inner ring needs a wider angle.
    expect(innerSmall.minAngle).toBeGreaterThan(outerSmall.minAngle);
    expect(outerSmall.minAngle).toBeGreaterThan(large.levels[2].label.minAngle);
    expect(small.label.overflow).toBeUndefined();
    small.levels.forEach((level: any) => expect(level.label?.width).toBeUndefined());
    const tiny = (await convert(panel({}), [rows], { width: 120, height: 90 })).options.series[0];
    expect(tiny.levels[1].label.show).toBe(false);
    expect(tiny.levels[2].label.show).toBe(false);
  });

  it("draws a label only when its whole name fits the slice, and never cuts one short", async () => {
    const services = ["checkout", "inventory", "payments", "search", "cart", "auth"];
    const mixed = ["us-east", "eu-west", "ap-south"].flatMap((region, i) =>
      services.map((service, j) => ({
        x_axis_1: region,
        breakdown_1: service,
        y_axis_1: 400 + ((i * 5 + j * 11) % 9) * 120,
      })),
    );
    const names = new Set([...services, "us-east", "eu-west", "ap-south"]);
    for (const [width, height] of [
      [246, 220],
      [400, 250],
      [1200, 500],
    ]) {
      const { options } = await convert(panel({}), [mixed], { width, height });
      const chart = echarts.init(null as any, null, { renderer: "svg", ssr: true, width, height });
      chart.setOption({ ...options, animation: false });
      chart.renderToSVGString();
      const drawn: string[] = (chart.getZr() as any).storage
        .getDisplayList(true)
        .filter((el: any) => el.type === "tspan" || el.type === "text")
        .map((el: any) => String(el.style.text));
      chart.dispose();
      expect(drawn.length).toBeGreaterThan(0);
      drawn.forEach((text) => expect(names.has(text), `"${text}" at ${width}`).toBe(true));
    }
  });

  it("formats the tooltip path with the panel unit", async () => {
    const out = await convert(panel({}, { unit: "bytes" }), [rows]);
    const text = out.options.tooltip.formatter({
      data: { path: ["us-east", "cart"] },
      value: 2048,
    });
    expect(text).toBe("us-east / cart: <strong>2KB</strong>");
  });
});
