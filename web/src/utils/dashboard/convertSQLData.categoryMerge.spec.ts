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

const query = (alias: string) => ({
  query: "SELECT 1",
  customQuery: false,
  fields: {
    stream: "default",
    stream_type: "logs",
    x: [{ label: "Category", alias: "cat", column: "cat", args: [] }],
    y: [{ label: alias, alias, column: alias, aggregationFunction: "count", args: [] }],
    z: [],
    breakdown: [],
    filter: { conditions: [] },
  },
  config: {},
});

const run = async (type: string, data: any[][], periods: string[] = ["", ""]) => {
  const panel = {
    id: "p",
    type,
    queryType: "sql",
    queries: [query("v1"), query("v2")],
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
      expect(await run(type, twoQueries())).toEqual({
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

  it("bar: keeps the alphabetical category order", async () => {
    expect(await run("bar", twoQueries())).toEqual({
      categories: ["a", "b", "c"],
      data: [
        [1, 2, null],
        [10, null, 30],
      ],
    });
  });
});
