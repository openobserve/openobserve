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
import { buildFoldedStackTree, convertFlameGraphPanelData } from "./convertFlameGraphPanelData";

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

const panel = (config: Record<string, any> = {}) => ({
  id: "p",
  type: "flame-graph",
  queryType: "sql",
  queries: [
    {
      query: 'SELECT stack, sum(samples) AS value FROM "demo_app" GROUP BY stack',
      customQuery: true,
      fields: { x: [], y: [] },
      config: {},
    },
  ],
  config,
});

// Rows as the local backend returns them for the query above.
const rows = [
  { stack: "main;worker;batch;upload", value: 60750 },
  { stack: "main;worker;batch;compress", value: 60998 },
  { stack: "main;http;handler;db_query", value: 61285 },
  { stack: "main;gc", value: 62341 },
  { stack: "main;http;handler;render", value: 61002 },
  { stack: "main;http;handler", value: 1000 },
];

const child = (node: any, name: string) => node.children.find((c: any) => c.name === name);

describe("convertFlameGraphPanelData", () => {
  it("is routed by convertPanelData and merges equal paths into one tree", async () => {
    const result = await convert(panel(), [rows]);
    expect(result.chartType).toBe("flame-graph");
    expect(result.stackField).toBe("stack");
    expect(result.valueField).toBe("value");
    const root = result.root;
    expect(root.name).toBe("root");
    expect(root.total).toBe(307376);
    const main = child(root, "main");
    expect(main.total).toBe(307376);
    const handler = child(child(main, "http"), "handler");
    expect(handler.total).toBe(61285 + 61002 + 1000);
    expect(handler.children.map((c: any) => c.name).sort()).toEqual(["db_query", "render"]);
    expect(child(main, "gc").children).toBeUndefined();
  });

  it("detects the columns from the raw demo_app fields", () => {
    const raw = [
      { _timestamp: 1, level: "info", stack: "main;gc", samples: 13 },
      { _timestamp: 2, level: "warn", stack: "main;gc", samples: 4 },
    ];
    const result = convertFlameGraphPanelData(panel(), [raw]);
    expect(result).toMatchObject({ stackField: "stack", valueField: "samples" });
    expect(result.root?.total).toBe(17);
  });

  it("uses the configured columns", () => {
    const raw = [
      { path: "a;b", weight: "3" },
      { path: "a;c", weight: 2 },
    ];
    const result = convertFlameGraphPanelData(
      panel({ flame_graph_stack_field: "path", flame_graph_value_field: "weight" }),
      [raw],
    );
    expect(result.root?.total).toBe(5);
    expect(child(result.root, "a").children.map((c: any) => c.total)).toEqual([3, 2]);
  });

  it("finds a folded column by its separator when no name matches", () => {
    const result = convertFlameGraphPanelData(panel(), [[{ trace: "x;y", n: 2 }]]);
    expect(result).toMatchObject({ stackField: "trace", valueField: "n" });
  });

  it("counts each row once when there is no value column", () => {
    const result = convertFlameGraphPanelData(panel(), [[{ stack: "a;b" }, { stack: "a" }]]);
    expect(result.valueField).toBeNull();
    expect(result.root?.total).toBe(2);
  });

  it("skips empty stacks and non-positive values, and gives no tree when nothing is left", () => {
    const tree = buildFoldedStackTree(
      [
        { s: "", v: 1 },
        { s: "a", v: 0 },
        { s: "a", v: "x" },
        { s: " ; ", v: 4 },
      ],
      "s",
      "v",
    );
    expect(tree).toEqual({ root: null, skipped: 4 });
  });

  it("gives no tree when the rows carry no stack column", async () => {
    const result = await convert(panel(), [[{ a: 1 }]]);
    expect(result.root).toBeNull();
    expect(result.stackField).toBeNull();
  });
});
