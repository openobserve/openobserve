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
import { buildTreemapNodes, contrastLabels } from "./convertTreemapData";

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

describe("treemap nodes", () => {
  it("nests by x then breakdown, sums values and sorts tiles largest first", () => {
    const nodes = buildTreemapNodes(
      panel("treemap", { x: [serviceX], y: [count], breakdown: [regionB] }),
      [rows],
    );
    expect(nodes.map((node) => [node.name, node.value])).toEqual([
      ["web", 50],
      ["api", 40],
    ]);
    expect(nodes[1].children).toEqual([
      { name: "eu", value: 30, path: ["api", "eu"] },
      { name: "us", value: 10, path: ["api", "us"] },
    ]);
  });

  it("makes flat tiles without a breakdown", () => {
    const nodes = buildTreemapNodes(panel("treemap", { x: [serviceX], y: [count] }), [rows]);
    expect(nodes).toEqual([
      { name: "web", value: 50, path: ["web"] },
      { name: "api", value: 40, path: ["api"] },
    ]);
  });
});

describe("treemap through convertPanelData", () => {
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
