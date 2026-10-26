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
import { buildTreemapNodes } from "./convertTreemapData";

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

  it("returns an empty series list without rows", async () => {
    const { options } = await viaPanel(panel("treemap", { x: [serviceX], y: [count] }), [[]]);
    expect(options.series).toEqual([]);
  });
});
