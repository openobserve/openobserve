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
import { buildSQLChartQuery } from "./dashboardAutoQueryBuilder";
import { buildFunnelStages } from "./convertFunnelData";

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

const panel = (config: Record<string, any> = {}, x = [field("x_axis_1", "stage")]) => ({
  id: "p",
  type: "funnel",
  queryType: "sql",
  queries: [
    {
      query: "",
      customQuery: false,
      fields: {
        stream: "demo_app",
        stream_type: "logs",
        x,
        y: [field("y_axis_1", "_timestamp", "count")],
        z: [],
        breakdown: [],
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

// Query order: search arrives before visit, as an unordered GROUP BY may return it.
const rows = [
  { x_axis_1: "search", y_axis_1: 50 },
  { x_axis_1: "visit", y_axis_1: 200 },
  { x_axis_1: "paid", y_axis_1: 10 },
  { x_axis_1: "visit", y_axis_1: "bad" },
];

describe("funnel", () => {
  it("builds the grouped builder SQL, one row per stage", () => {
    const schema = panel();
    expect(
      buildSQLChartQuery({
        queryData: schema.queries[0],
        chartType: "funnel",
        dashboardPanelData: { data: schema, meta: {} },
      }),
    ).toBe(
      'SELECT stage as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "demo_app"  GROUP BY x_axis_1',
    );
  });

  it("sums each stage and measures percent against the widest stage when sorted", () => {
    const stages = buildFunnelStages(panel(), [rows]);
    expect(stages.map((stage) => [stage.name, stage.value, stage.percent])).toEqual([
      ["search", 50, 25],
      ["visit", 200, 100],
      ["paid", 10, 5],
    ]);
  });

  it("measures percent against the first row in query order", () => {
    const stages = buildFunnelStages(panel({ funnel_sort: "none" }), [rows]);
    expect(stages.map((stage) => stage.percent)).toEqual([100, 400, 20]);
  });

  it("defaults to a descending vertical funnel without percent", async () => {
    const out = await convert(panel(), [rows]);
    const series = out.options.series[0];
    expect(out.chartType).toBe("funnel");
    expect(series).toMatchObject({ type: "funnel", sort: "descending", orient: "vertical" });
    expect(series.label.position).toBe("right");
    expect(series.label.formatter({ name: "visit", value: 200, data: series.data[1] })).toBe(
      "visit  200",
    );
  });

  it("applies sort, orientation and percent labels", async () => {
    const out = await convert(
      panel({ funnel_sort: "ascending", funnel_orient: "horizontal", funnel_show_percent: true }),
      [rows],
    );
    const series = out.options.series[0];
    expect(series).toMatchObject({ sort: "ascending", orient: "horizontal" });
    expect(series.label.position).toBe("inside");
    expect(series.label.formatter({ name: "search", value: 50, data: series.data[0] })).toBe(
      "search\n50 (25%)",
    );
    expect(out.options.tooltip.formatter({ name: "paid", value: 10, data: series.data[2] })).toBe(
      "paid: <strong>10 (5%)</strong>",
    );
  });

  it("falls back to the defaults for values it does not know", async () => {
    const series = (
      await convert(panel({ funnel_sort: "random", funnel_orient: "diagonal" }), [rows])
    ).options.series[0];
    expect(series).toMatchObject({ sort: "descending", orient: "vertical" });
  });

  it("draws nothing without a stage field or rows", async () => {
    expect((await convert(panel({}, []), [rows])).options.series).toEqual([]);
    expect((await convert(panel(), [[]])).options.series).toEqual([]);
  });
});
