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
import { buildGraph } from "./convertNodeGraphData";

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

const convert = async (schema: any, data: any[]) =>
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
    expect(series).toMatchObject({ type: "graph", layout: "force", draggable: true });
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
    expect(series).toMatchObject({ layout: "circular", draggable: false });
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

  it("draws nothing without complete edges", async () => {
    expect(
      (await convert(panel(), [[{ source: "a", target: null, value: 1 }]])).options.series,
    ).toEqual([]);
  });
});
