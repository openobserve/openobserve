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

  it("labels a wide inner slice along its arc when the name is longer than the ring is deep", async () => {
    const regions = [
      { x_axis_1: "north-america-production", breakdown_1: "cart", y_axis_1: 50 },
      { x_axis_1: "north-america-production", breakdown_1: "auth", y_axis_1: 30 },
      { x_axis_1: "europe-west", breakdown_1: "cart", y_axis_1: 20 },
    ];
    const { options } = await convert(panel({}), [regions], { width: 1200, height: 600 });
    expect(options.series[0].data[0].label.rotate).toBe("tangential");
    const chart = echarts.init(null as any, null, {
      renderer: "svg",
      ssr: true,
      width: 1200,
      height: 600,
    });
    chart.setOption({ ...options, animation: false });
    chart.renderToSVGString();
    const drawn: string[] = (chart.getZr() as any).storage
      .getDisplayList(true)
      .filter((el: any) => el.type === "tspan" || el.type === "text")
      .map((el: any) => String(el.style.text));
    chart.dispose();
    expect(drawn).toContain("north-america-production");
  });

  it("keeps every label inside its own ring in a short, wide panel", async () => {
    const days = ["2026-10-27T00:00:00", "2026-10-26T00:00:00", "2026-10-25T00:00:00"];
    const levels = ["info", "warn", "error", "debug"];
    const byDay = days.flatMap((day, i) =>
      levels.map((level, j) => ({
        x_axis_1: day,
        breakdown_1: level,
        y_axis_1: [900, 400, 60][i] * (4 - j),
      })),
    );
    const [width, height] = [926, 262];
    const { options } = await convert(panel({}), [byDay], { width, height });
    const base = Math.min(width, height) / 2;
    // Nested rings split halfway between the 12% hole and the 92% outer edge.
    const ringEdge = (text: string) => (days.includes(text) ? 0.52 : 0.92) * base;
    const chart = echarts.init(null as any, null, { renderer: "svg", ssr: true, width, height });
    chart.setOption({ ...options, animation: false });
    chart.renderToSVGString();
    const labels = (chart.getZr() as any).storage
      .getDisplayList(true)
      .filter((el: any) => (el.type === "tspan" || el.type === "text") && el.style?.text);
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach((el: any) => {
      const rect = el.getBoundingRect().clone();
      rect.applyTransform(el.getComputedTransform());
      const reach = Math.max(
        ...[
          [rect.x, rect.y],
          [rect.x + rect.width, rect.y],
          [rect.x, rect.y + rect.height],
          [rect.x + rect.width, rect.y + rect.height],
        ].map(([x, y]) => Math.hypot(x - width / 2, y - height / 2)),
      );
      const text = String(el.style.text);
      expect(reach, text).toBeLessThanOrEqual(ringEdge(text) + 1);
    });
    chart.dispose();
  });

  it("nests one ring per x field, then the breakdown, and groups the SQL by all of them", async () => {
    const schema = panel({
      x: [field("x_axis_1", "region"), field("x_axis_2", "service")],
      breakdown: [field("breakdown_1", "host")],
    });
    expect(
      buildSQLChartQuery({
        queryData: schema.queries[0],
        chartType: "sunburst",
        dashboardPanelData: { data: schema, meta: {} },
      }),
    ).toContain("GROUP BY x_axis_1, x_axis_2, breakdown_1");
    const deep = [
      { x_axis_1: "us-east", x_axis_2: "cart", breakdown_1: "h1", y_axis_1: 30 },
      { x_axis_1: "us-east", x_axis_2: "cart", breakdown_1: "h2", y_axis_1: 10 },
      { x_axis_1: "us-east", x_axis_2: "auth", breakdown_1: "h1", y_axis_1: 20 },
      { x_axis_1: "eu-west", x_axis_2: "cart", breakdown_1: "h3", y_axis_1: 25 },
    ];
    const series = (await convert(schema, [deep])).options.series[0];
    const usEast = series.data[0];
    expect([usEast.name, usEast.value]).toEqual(["us-east", 60]);
    const cart = usEast.children[0];
    expect([cart.name, cart.value]).toEqual(["cart", 40]);
    expect(cart.children.map((node: any) => [node.name, node.path])).toEqual([
      ["h1", ["us-east", "cart", "h1"]],
      ["h2", ["us-east", "cart", "h2"]],
    ]);
    // A level config per ring, after the root's.
    expect(series.levels).toHaveLength(4);
    // Each ring fades its parent's colour further towards the panel.
    const colours = [usEast, cart, cart.children[0]].map((node: any) => node.itemStyle.color);
    expect(new Set(colours).size).toBe(3);
  });

  it("gives every ring an equal share of the radius and keeps each label inside its ring", async () => {
    const schema = panel({
      x: [field("x_axis_1", "region"), field("x_axis_2", "service")],
      breakdown: [field("breakdown_1", "host")],
    });
    const deep = [
      { x_axis_1: "us-east", x_axis_2: "checkout-service", breakdown_1: "h1", y_axis_1: 60 },
      { x_axis_1: "eu-west", x_axis_2: "cart", breakdown_1: "h2", y_axis_1: 40 },
    ];
    const series = (await convert(schema, [deep], { width: 600, height: 400 })).options.series[0];
    expect(series.radius).toEqual(["12%", "92%"]);
    // A name longer than its ring is deep or wide is hidden, never drawn into the next ring.
    const long = series.data[0].children[0];
    expect(long.label.show === false || ["radial", "tangential"].includes(long.label.rotate)).toBe(
      true,
    );
  });

  it("names the whole path in the tooltip for a three-level slice", async () => {
    const out = await convert(panel({}), [rows]);
    expect(
      out.options.tooltip.formatter({ data: { path: ["us-east", "cart", "h1"] }, value: 5 }),
    ).toBe("us-east / cart / h1: <strong>5</strong>");
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
