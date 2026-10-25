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

import { describe, expect, it } from "vitest";
import { convertMultiSQLData } from "./convertSQLData";

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 100 },
    selectedOrganization: { identifier: "default" },
  },
};

const byService = { label: "Service", alias: "svc", column: "svc", args: [] };

const query = (alias: string, breakdown: any[] = []) => ({
  query: "SELECT 1",
  customQuery: false,
  fields: {
    stream: "default",
    stream_type: "logs",
    x: [{ label: "Category", alias: "cat", column: "cat", args: [] }],
    y: [{ label: alias, alias, column: alias, aggregationFunction: "count", args: [] }],
    z: [],
    breakdown,
    filter: { conditions: [] },
  },
  config: {},
});

const run = async (
  type: string,
  data: any[][],
  periods: string[] = ["", ""],
  breakdown: any[] = [],
) => {
  const panel = {
    id: "p",
    type,
    queryType: "sql",
    queries: [query("v1", breakdown), query("v2", breakdown)],
    config: {},
  };
  const result: any = await convertMultiSQLData(
    panel,
    data,
    store,
    { value: { offsetWidth: 800, offsetHeight: 400 } },
    { value: null },
    { value: [[], []] },
    {
      queries: periods.map((periodAsStr, i) => ({
        query: "SELECT 1",
        startTime: 1704067200000000,
        endTime: 1704068400000000,
        timeRangeGap: { seconds: 0, periodAsStr },
        panelQueryIndex: i,
      })),
    },
    { height: "400px" },
    { value: [] },
    false,
  );
  const options = result.options;
  const axes = type === "bar" ? options.xAxis : options.yAxis;
  const series = options.series.filter((s: any) => s.name);
  return {
    categories: (Array.isArray(axes) ? axes[0] : axes).data,
    data: series.map((s: any) => s.data),
    axes,
    options,
  };
};

const twoQueries = () => [
  [
    { cat: "b", v1: 2 },
    { cat: "a", v1: 1 },
  ],
  [
    { cat: "a", v2: 10 },
    { cat: "c", v2: 30 },
  ],
];

describe("multi-query category merge", () => {
  it.each(["h-bar", "h-stacked"])(
    "%s: aligns every query to one row per category, in query 1's order",
    async (type) => {
      expect(await run(type, twoQueries())).toMatchObject({
        categories: ["b", "a", "c"],
        data: [
          [2, 1, null],
          [null, 10, 30],
        ],
      });
    },
  );

  it("h-bar: a time-shifted twin lands on the rows of its own categories", async () => {
    const shifted = await run("h-bar", twoQueries(), ["", "1d ago"]);
    expect(shifted.categories).toEqual(["b", "a", "c"]);
    expect(shifted.data[1]).toEqual([null, 10, 30]);
  });

  it("h-bar with a breakdown: leaves query 1's two category axes aligned", async () => {
    const withService = [
      [
        { cat: "b", svc: "x", v1: 2 },
        { cat: "a", svc: "x", v1: 1 },
        { cat: "a", svc: "y", v1: 3 },
      ],
      [{ cat: "c", svc: "x", v2: 30 }],
    ];
    const { axes, categories } = await run("h-bar", withService, ["", ""], [byService]);
    expect(axes).toHaveLength(2);
    expect(categories).toHaveLength(axes[1].data.length);
  });

  it("h-stacked: a time-shifted twin lands on the rows of its own categories", async () => {
    const shifted = await run("h-stacked", twoQueries(), ["", "1d ago"]);
    expect(shifted.categories).toEqual(["b", "a", "c"]);
    expect(shifted.data[1]).toEqual([null, 10, 30]);
  });

  it("h-stacked with a breakdown: one stack total per query on the merged rows", async () => {
    const withService = [
      [
        { cat: "a", svc: "x", v1: 1 },
        { cat: "a", svc: "y", v1: 2 },
      ],
      [
        { cat: "a", svc: "x", v2: 10 },
        { cat: "a", svc: "y", v2: 20 },
        { cat: "c", svc: "x", v2: 30 },
      ],
    ];
    const { options, categories } = await run("h-stacked", withService, ["", ""], [byService]);
    expect(categories).toEqual(["a", "c"]);
    const params = options.series
      .map((s: any, seriesIndex: number) => ({ s, seriesIndex }))
      .filter(({ s }: any) => s.name)
      .map(({ s, seriesIndex }: any) => ({
        seriesName: s.name,
        seriesIndex,
        name: "a",
        marker: "",
        value: s.data[0],
        data: s.data[0],
      }));
    const html = options.tooltip.formatter(params);
    expect(html).toContain("<strong>Total #1 : 3.00</strong>");
    expect(html).toContain("<strong>Total #2 : 30.00</strong>");
  });

  it("bar: keeps the alphabetical category order", async () => {
    expect(await run("bar", twoQueries())).toMatchObject({
      categories: ["a", "b", "c"],
      data: [
        [1, 2, null],
        [10, null, 30],
      ],
    });
  });
});
