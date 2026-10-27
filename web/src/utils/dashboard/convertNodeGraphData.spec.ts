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
import { sankeyChartQuery } from "./dashboardAutoQueryBuilder";
import { buildGraph, circularPositions, forcePositions } from "./convertNodeGraphData";

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

const field = (alias: string, column: string, functionName: string | null = null) => ({
  label: "",
  alias,
  column,
  functionName,
  args: [{ type: "field", value: { field: column } }],
  isDerived: false,
  havingConditions: [],
});

const panel = (config: Record<string, any> = {}) => ({
  id: "p",
  type: "node-graph",
  queryType: "sql",
  queries: [
    {
      query: "",
      customQuery: false,
      fields: {
        stream: "demo_app",
        stream_type: "logs",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        source: field("source", "source_service"),
        target: field("target", "target_service"),
        value: field("value", "_timestamp", "count"),
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
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
  { source: "web", target: "api", value: 30 },
  { source: "web", target: "api", value: 10 },
  { source: "api", target: "db", value: 25 },
  { source: "api", target: "", value: 5 },
  { source: "cache", target: "db", value: "bad" },
];

describe("node graph", () => {
  it("builds the sankey source, target and value SQL", () => {
    const schema = panel();
    expect(sankeyChartQuery({ data: schema, meta: {}, layout: { currentQueryIndex: 0 } })).toBe(
      'SELECT source_service as "source", target_service as "target", count(_timestamp) as "value" FROM "demo_app"  GROUP BY source, target',
    );
  });

  it("sums repeated pairs into one edge and sizes nodes by the traffic through them", () => {
    const { nodes, edges } = buildGraph(panel(), [rows]);
    expect(edges.map((edge) => [edge.source, edge.target, edge.value])).toEqual([
      ["web", "api", 40],
      ["api", "db", 25],
    ]);
    expect(nodes.map((node) => [node.name, node.value])).toEqual([
      ["web", 40],
      ["api", 40],
      ["db", 25],
    ]);
  });

  it("defaults to a force layout with directed edges and no edge labels", async () => {
    const out = await convert(panel(), [rows]);
    const series = out.options.series[0];
    expect(out.chartType).toBe("node-graph");
    expect(series).toMatchObject({ type: "graph", layout: "none", draggable: true });
    expect(series.edgeSymbol).toEqual(["none", "arrow"]);
    expect(series.edgeLabel.show).toBe(false);
    const [web, , db] = series.data;
    expect(web.symbolSize).toBeGreaterThan(db.symbolSize);
    expect(series.links[0].lineStyle.width).toBeGreaterThan(series.links[1].lineStyle.width);
    expect(series.links[0].lineStyle.color).toBe(web.itemStyle.color);
  });

  it("lays nodes on a circle and labels edges when asked", async () => {
    const out = await convert(
      panel({ node_graph_layout: "circular", node_graph_show_edge_labels: true, unit: "bytes" }),
      [rows],
    );
    const series = out.options.series[0];
    expect(series.layout).toBe("none");
    // Pixel positions whose bounding box is exactly the inset plot of the 800 × 400 panel.
    const xs = series.data.map((node: any) => node.x);
    const ys = series.data.map((node: any) => node.y);
    expect(Math.min(...xs)).toBeCloseTo(series.left);
    expect(Math.max(...xs)).toBeCloseTo(800 - series.right);
    expect(Math.min(...ys)).toBeCloseTo(series.top);
    expect(Math.max(...ys)).toBeCloseTo(400 - series.bottom);
    expect(series.edgeLabel.show).toBe(true);
    expect(series.edgeLabel.formatter({ value: 2048 })).toBe("2KB");
  });

  it("names the edge in its tooltip and the node in its own", async () => {
    const { formatter } = (await convert(panel(), [rows])).options.tooltip;
    expect(formatter({ dataType: "edge", data: { source: "web", target: "api" }, value: 40 })).toBe(
      "web → api: <strong>40</strong>",
    );
    expect(formatter({ dataType: "node", name: "db", value: 25 })).toBe("db: <strong>25</strong>");
  });

  it("places every node at a finite position inside an inset plot, at small and large sizes", async () => {
    const mesh = ["web", "api", "db", "cache", "queue", "auth"].flatMap((source, i, all) =>
      all.filter((target) => target !== source).map((target) => ({ source, target, value: i + 1 })),
    );
    for (const size of [
      { width: 400, height: 250 },
      { width: 1200, height: 500 },
    ]) {
      const series = (await convert(panel(), [mesh], size)).options.series[0];
      expect(series.layout).toBe("none");
      series.data.forEach((node: any) => {
        expect(node.x).toBeGreaterThanOrEqual(series.left);
        expect(node.x).toBeLessThanOrEqual(size.width - series.right);
        expect(node.y).toBeGreaterThanOrEqual(series.top);
        expect(node.y).toBeLessThanOrEqual(size.height - series.bottom);
      });
      // The inset leaves room for the largest node and the label under it.
      expect(series.top).toBeGreaterThanOrEqual(20);
      expect(series.bottom).toBeGreaterThanOrEqual(series.top);
      expect(series.left).toBeGreaterThanOrEqual(48);
      expect(series.label.position).toBe("bottom");
    }
  });

  it("lays out the same graph the same way every time, with no two nodes on top of each other", () => {
    const { nodes, edges } = buildGraph(panel(), [rows]);
    const first = forcePositions(nodes, edges);
    expect(forcePositions(nodes, edges)).toEqual(first);
    expect(circularPositions(4)[0]).toEqual([expect.closeTo(0), -1]);
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `n${i}`, value: 1 }));
    const ring = many.map((node, i) => ({
      source: node.name,
      target: `n${(i + 1) % 8}`,
      value: 1,
    }));
    const points = forcePositions(many, ring);
    points.forEach((a, i) =>
      points
        .slice(i + 1)
        .forEach((b) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(0.05)),
    );
  });

  it("keeps edge values only where they fit and shows the rest on hover", async () => {
    const mesh = ["web", "api", "db", "cache", "queue", "auth"].flatMap((source, i, all) =>
      all
        .filter((target) => target !== source)
        .map((target) => ({ source, target, value: 1000 + i })),
    );
    const schema = panel({ node_graph_layout: "circular", node_graph_show_edge_labels: true });
    const small = (await convert(schema, [mesh], { width: 400, height: 250 })).options.series[0];
    const large = (await convert(schema, [mesh], { width: 1200, height: 500 })).options.series[0];
    const shown = (series: any) => series.links.filter((link: any) => link.label.show).length;
    expect(shown(small)).toBeGreaterThan(0);
    expect(shown(small)).toBeLessThan(small.links.length);
    expect(shown(large)).toBeGreaterThanOrEqual(shown(small));
    small.links.forEach((link: any) => expect(link.emphasis.label.show).toBe(true));
    expect(small.emphasis.edgeLabel.show).toBe(true);
  });

  it("leaves edges unlabelled when edge values are off", async () => {
    const series = (await convert(panel(), [rows])).options.series[0];
    series.links.forEach((link: any) => expect(link.label).toBeUndefined());
    expect(series.emphasis.edgeLabel.show).toBe(false);
  });

  it("draws nothing without complete edges", async () => {
    expect(
      (await convert(panel(), [[{ source: "a", target: null, value: 1 }]])).options.series,
    ).toEqual([]);
  });
});
