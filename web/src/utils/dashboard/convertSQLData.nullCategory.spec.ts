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

const run = async (
  type: string,
  rows: Record<string, unknown>[],
  breakdown: (typeof byService)[] = [],
) => {
  const panel = {
    id: "p",
    type,
    queryType: "sql",
    queries: [
      {
        query: "SELECT k, count(*) AS v",
        customQuery: false,
        fields: {
          stream: "default",
          stream_type: "logs",
          x: [{ label: "K", alias: "k", column: "k", args: [] }],
          y: [{ label: "V", alias: "v", column: "v", aggregationFunction: "count", args: [] }],
          z: [],
          breakdown,
          filter: { conditions: [] },
        },
        config: {},
      },
    ],
    config: {},
  };
  const result = await convertMultiSQLData(
    panel,
    [rows],
    store,
    { value: { offsetWidth: 800, offsetHeight: 400 } },
    { value: null },
    { value: [[]] },
    {
      queries: [
        {
          query: "SELECT 1",
          startTime: 1704067200000000,
          endTime: 1704068400000000,
          timeRangeGap: { seconds: 0, periodAsStr: "" },
          panelQueryIndex: 0,
        },
      ],
    },
    { height: "400px" },
    { value: [] },
    false,
  );
  return result.options;
};

// The NULL row omits its key, as a search hit does for a missing field.
const rows = [{ k: "alpha", v: 1169 }, { k: "beta", v: 1168 }, { v: 429 }, { k: "", v: 234 }];

describe("SQL charts keep the NULL and empty x-axis groups", () => {
  it.each(["pie", "donut"])("%s: draws a labelled slice for each group", async (type) => {
    const options = await run(type, rows);
    const slices = options.series[0].data;
    expect(slices).toEqual([
      { name: "alpha", value: 1169 },
      { name: "beta", value: 1168 },
      { name: "(null)", value: 429 },
      { name: "(empty)", value: 234 },
    ]);
    const total = slices.reduce((sum: number, slice: { value: number }) => sum + slice.value, 0);
    expect(total).toBe(3000);
  });

  it("bar: draws a labelled category for each group", async () => {
    const options = await run("bar", rows);
    expect(options.xAxis[0].data).toEqual(["alpha", "beta", "(null)", "(empty)"]);
    expect(options.series[0].data).toEqual([1169, 1168, 429, 234]);
  });

  it("bar with a breakdown: places each series' value on the NULL and empty categories", async () => {
    const options = await run(
      "bar",
      [
        { k: null, svc: "api", v: 5 },
        { k: "", svc: "api", v: 6 },
        { k: "alpha", svc: "web", v: 7 },
      ],
      [byService],
    );
    expect(options.xAxis[0].data).toEqual(["(null)", "(empty)", "alpha"]);
    const api = options.series.find((s: { name: string }) => s.name === "api");
    expect(api.data).toEqual([5, 6, null]);
  });
});
