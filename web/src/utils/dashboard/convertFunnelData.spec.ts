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

  it("measures percent against the largest stage in query order too, so no stage passes 100%", () => {
    const stages = buildFunnelStages(panel({ funnel_sort: "none" }), [rows]);
    expect(stages.map((stage) => stage.percent)).toEqual([25, 100, 5]);
  });

  it("defaults to a descending vertical funnel without percent", async () => {
    const out = await convert(panel(), [rows]);
    const series = out.options.series[0];
    expect(out.chartType).toBe("funnel");
    expect(series).toMatchObject({ type: "funnel", sort: "descending", orient: "vertical" });
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
    const search = series.data[0];
    expect(search.labelInside).toBe(true);
    expect(series.label.formatter({ name: "search", value: 50, data: search })).toBe(
      "search\n50 (25%)",
    );
    expect(out.options.tooltip.formatter({ name: "paid", value: 10, data: series.data[2] })).toBe(
      "paid: <strong>10 (5%)</strong>",
    );
  });

  // The shape of T2's demo_app funnel: one wide stage and a long thin tail.
  const tail = [
    { x_axis_1: "visit", y_axis_1: 6316 },
    { x_axis_1: "search", y_axis_1: 3309 },
    { x_axis_1: "product", y_axis_1: 1816 },
    { x_axis_1: "cart", y_axis_1: 939 },
    { x_axis_1: "paid", y_axis_1: 594 },
    { x_axis_1: "checkout", y_axis_1: 506 },
  ];
  const byName = (series: any) =>
    Object.fromEntries(series.data.map((stage: any) => [stage.name, stage]));

  it("moves the labels of thin horizontal stages outside, alternating sides, at small and large sizes", async () => {
    const schema = panel({ funnel_orient: "horizontal", funnel_show_percent: true });
    const large = (await convert(schema, [tail], { width: 1200, height: 500 })).options.series[0];
    const big = byName(large);
    expect(big.visit.labelInside).toBe(true);
    expect(big.visit.label.position).toBe("inside");
    expect(big.checkout.labelInside).toBe(false);
    expect(big.checkout.labelLine.show).toBe(true);
    expect(large.label.formatter({ name: "checkout", value: 506, data: big.checkout })).toBe(
      "checkout  506 (8%)",
    );

    // At 400 wide no slot holds a label, so every stage labels outside and the plot makes room.
    const small = (await convert(schema, [tail], { width: 400, height: 250 })).options.series[0];
    small.data.forEach((stage: any) => {
      expect(stage.labelInside).toBe(false);
      expect(["top", "bottom"]).toContain(stage.label.position);
      expect(stage.label.width).toBeLessThanOrEqual(2 * 60);
    });
    const sides = small.data.map((stage: any) => stage.label.position);
    sides.slice(1).forEach((side: string, i: number) => expect(side).not.toBe(sides[i]));
    // visit spans the full height and labels on top, so only the top inset grows.
    expect(small.top).toBeGreaterThan(16);
    expect(small.bottom).toBe(16);
  });

  it("bounds every outside vertical label to the room beside the funnel", async () => {
    for (const size of [
      { width: 400, height: 250 },
      { width: 1200, height: 500 },
    ]) {
      const series = (await convert(panel({ funnel_show_percent: true }), [tail], size)).options
        .series[0];
      series.data
        .filter((stage: any) => !stage.labelInside)
        .forEach((stage: any) => {
          expect(stage.label.position).toBe("right");
          expect(stage.label.width).toBeLessThan(size.width / 2);
        });
      expect(series.label.overflow).toBe("truncate");
      expect(series.left).toBe("4%");
    }
  });

  it("picks white or black inside-label text by stage colour, with no halo", async () => {
    const series = (await convert(panel(), [tail])).options.series[0];
    const inside = series.data.filter((stage: any) => stage.labelInside);
    expect(inside.length).toBeGreaterThan(0);
    inside.forEach((stage: any) => expect(["#ffffff", "#000000"]).toContain(stage.label.color));
    expect(series.label.textBorderWidth).toBe(0);
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
