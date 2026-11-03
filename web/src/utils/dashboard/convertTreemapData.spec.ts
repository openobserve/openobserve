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
import { contrastLabels } from "./convertTreemapData";

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

const field = (alias: string, label: string, functionName: string | null = null) => ({
  label,
  alias,
  column: alias,
  functionName,
  args: [{ type: "field", value: { field: alias } }],
});

const panel = (type: string, fields: any, config: Record<string, any> = {}) => ({
  id: "p",
  type,
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: false,
      fields: {
        stream: "demo_app",
        stream_type: "logs",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        ...fields,
      },
      config: {},
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});

const viaPanel = async (schema: any, data: any[]) =>
  (await convertPanelData(
    schema,
    data,
    store,
    { value: { offsetWidth: 800, offsetHeight: 400 } },
    { value: null },
    { value: [] },
    { queries: [] },
    { height: "400px" },
    { value: [] },
    false,
  )) as any;

const serviceX = field("x_axis_1", "Service");
const regionB = field("breakdown_1", "Region");
const count = field("y_axis_1", "Requests", "count");
const rows = [
  { x_axis_1: "api", breakdown_1: "eu", y_axis_1: 30 },
  { x_axis_1: "api", breakdown_1: "us", y_axis_1: 10 },
  { x_axis_1: "web", breakdown_1: "eu", y_axis_1: 50 },
  { x_axis_1: "db", breakdown_1: "eu", y_axis_1: 0 },
  { x_axis_1: "db", breakdown_1: "us", y_axis_1: "bad" },
];

describe("treemap through convertPanelData", () => {
  it("nests three group fields into three levels, with the full path in the tooltip", async () => {
    const regionX = field("x_axis_1", "Region");
    const serviceX2 = field("x_axis_2", "Service");
    const hostX = field("x_axis_3", "Host");
    const deep = [
      { x_axis_1: "eu", x_axis_2: "api", x_axis_3: "h1", y_axis_1: 5 },
      { x_axis_1: "eu", x_axis_2: "api", x_axis_3: "h2", y_axis_1: 3 },
      { x_axis_1: "eu", x_axis_2: "web", x_axis_3: "h3", y_axis_1: 4 },
      { x_axis_1: "us", x_axis_2: "api", x_axis_3: "h4", y_axis_1: 2 },
    ];
    const { options } = await viaPanel(
      panel("treemap", { x: [regionX, serviceX2, hostX], y: [count] }),
      [deep],
    );
    const [eu] = options.series[0].data;
    expect(eu.name).toBe("eu");
    expect(eu.value).toBe(12);
    const api = eu.children.find((node: any) => node.name === "api");
    expect(api.children.map((node: any) => [node.name, node.value])).toEqual([
      ["h1", 5],
      ["h2", 3],
    ]);
    const tooltip = options.tooltip.formatter({ data: api.children[0], value: 5 });
    expect(tooltip).toContain("eu / api / h1");
    // Every level below the first gets a readable label colour, not only the direct children.
    expect(api.children[0].label?.color).toBeTruthy();
    expect(api.upperLabel?.color).toBeTruthy();
  });

  it("draws every level when a drilldown blocks zooming, and two at a time otherwise", async () => {
    const levels = {
      x: [field("x_axis_1", "Region"), field("x_axis_2", "Service"), field("x_axis_3", "Host")],
      y: [count],
    };
    const deep = [{ x_axis_1: "eu", x_axis_2: "api", x_axis_3: "h1", y_axis_1: 5 }];
    const zooming = (await viaPanel(panel("treemap", levels), [deep])).options.series[0];
    expect(zooming.leafDepth).toBe(2);
    expect(zooming.nodeClick).toBe("zoomToNode");
    const drilling = (
      await viaPanel(panel("treemap", levels, { drilldown: [{ name: "logs" }] }), [deep])
    ).options.series[0];
    expect(drilling.nodeClick).toBe(false);
    expect(drilling.leafDepth).toBeUndefined();
  });

  it("renders one treemap series with a breadcrumb that zooms on click", async () => {
    const { options, chartType } = await viaPanel(
      panel("treemap", { x: [serviceX], y: [count], breakdown: [regionB] }),
      [rows],
    );
    expect(chartType).toBe("treemap");
    const [series] = options.series;
    expect(series.type).toBe("treemap");
    expect(series.breadcrumb.show).toBe(true);
    expect(series.nodeClick).toBe("zoomToNode");
    expect(series.upperLabel.show).toBe(true);
    expect(series.data[0].itemStyle.color).toEqual(expect.any(String));
    expect(options.tooltip.formatter({ data: { path: ["api", "eu"] }, value: 30 })).toContain(
      "api / eu",
    );
  });

  it("hides the label of a tile too small to read it", async () => {
    const { options } = await viaPanel(panel("treemap", { x: [serviceX], y: [count] }), [rows]);
    const { labelLayout } = options.series[0];
    expect(labelLayout({ rect: { width: 20, height: 40 }, text: "a\n1" }).fontSize).toBe(0);
    expect(labelLayout({ rect: { width: 80, height: 10 }, text: "a\n1" }).fontSize).toBe(0);
    expect(labelLayout({ rect: { width: 80, height: 40 }, text: "a\n1" }).fontSize).toBeUndefined();
  });

  it("hides a label that would not fit whole instead of truncating it to a fragment", async () => {
    const { options } = await viaPanel(panel("treemap", { x: [serviceX], y: [count] }), [rows]);
    const { label, labelLayout } = options.series[0];
    expect(label.overflow).toBe("none");
    // ECharts clamps labelRect to the tile, so only the text itself shows a narrow tile is too small.
    const narrow = { width: 40, height: 40 };
    const tileSized = { width: 40, height: 40 };
    expect(
      labelLayout({ rect: narrow, labelRect: tileSized, text: "checkout\n513.00" }).fontSize,
    ).toBe(0);
    expect(
      labelLayout({ rect: { width: 90, height: 40 }, text: "checkout\n513.00" }).fontSize,
    ).toBeUndefined();
    expect(
      labelLayout({ rect: { width: 90, height: 20 }, text: "checkout\n513.00" }).fontSize,
    ).toBe(0);
  });

  it("names only the view root in the breadcrumb until the user zooms in", async () => {
    const { options } = await viaPanel(
      panel("treemap", { x: [serviceX], y: [count], breakdown: [regionB] }, { title: "" }),
      [rows],
    );
    const chart = echarts.init(null as any, null, {
      renderer: "svg",
      ssr: true,
      width: 800,
      height: 400,
    });
    chart.setOption({ ...options, animation: false });
    const crumbs = () =>
      (chart as any)._chartsViews[0]._breadcrumb.group
        .children()
        .map((item: any) => item.style.text);
    expect(crumbs()).toHaveLength(1);
    chart.dispatchAction({ type: "treemapZoomToNode", targetNodeId: "api" });
    expect(crumbs()).toHaveLength(2);
    chart.dispose();
  });

  it("hides the breadcrumb when switched off and keeps tiles in place when a drilldown is set", async () => {
    const { options } = await viaPanel(
      panel(
        "treemap",
        { x: [serviceX], y: [count] },
        { treemap_show_breadcrumb: false, drilldown: [{ name: "logs" }] },
      ),
      [rows],
    );
    expect(options.series[0].breadcrumb.show).toBe(false);
    expect(options.series[0].nodeClick).toBe(false);
    expect(options.series[0].upperLabel.show).toBe(false);
  });

  it("gives each tile the label colour that reads on it, with no halo, and the root the body colour", async () => {
    const { options } = await viaPanel(
      panel("treemap", { x: [serviceX], y: [count], breakdown: [regionB] }),
      [rows],
    );
    const [series] = options.series;
    series.data.forEach((node: any) => {
      expect(["#ffffff", "#000000"]).toContain(node.label.color);
      expect(node.upperLabel.color).toBe(node.label.color);
      (node.children ?? []).forEach((child: any) =>
        expect(["#ffffff", "#000000"]).toContain(child.label.color),
      );
    });
    expect(series.label.textBorderWidth).toBe(0);
    expect(series.upperLabel.textBorderWidth).toBe(0);
    expect(series.levels[0].upperLabel.color).toBe("#404040");
  });

  it("puts white on dark tiles and black on light ones, following the children's lightness", () => {
    const nodes: any[] = [
      {
        name: "dark",
        value: 30,
        path: ["dark"],
        itemStyle: { color: "#7f1d1d" },
        children: [
          { name: "a", value: 20, path: ["dark", "a"] },
          { name: "b", value: 10, path: ["dark", "b"] },
        ],
      },
      { name: "light", value: 10, path: ["light"], itemStyle: { color: "#fde68a" } },
    ];
    contrastLabels(nodes);
    expect(nodes[0].label.color).toBe("#ffffff");
    expect(nodes[1].label.color).toBe("#000000");
    // The smallest child is drawn at lightness 0.35 (dark), the largest at 0.6 (light).
    expect(nodes[0].children[1].label.color).toBe("#ffffff");
    expect(nodes[0].children[0].label.color).toBe("#000000");
  });

  it("returns an empty series list without rows", async () => {
    const { options } = await viaPanel(panel("treemap", { x: [serviceX], y: [count] }), [[]]);
    expect(options.series).toEqual([]);
  });
});
