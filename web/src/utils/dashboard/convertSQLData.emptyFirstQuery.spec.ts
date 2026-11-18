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
  customQuery: true,
  fields: {
    stream: "default",
    stream_type: "logs",
    x: [{ label: "Time", alias: "x_axis_1", column: "x_axis_1", args: [] }],
    y: [{ label: alias, alias, column: alias, aggregationFunction: "count", args: [] }],
    z: [],
    breakdown: [],
    filter: { conditions: [] },
  },
  config: {},
});

const run = async (data: any[][]) => {
  const panel = {
    id: "p",
    type: "bar",
    queryType: "sql",
    queries: [query("y_axis_1"), query("y_axis_1")],
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
      queries: [0, 1].map((i) => ({
        query: "SELECT 1",
        startTime: 1704067200000000,
        endTime: 1704068400000000,
        timeRangeGap: { seconds: 0, periodAsStr: "" },
        panelQueryIndex: i,
      })),
    },
    { height: "400px" },
    { value: [] },
    false,
  );
  return result.options;
};

const rows = [
  { x_axis_1: "2024-01-01T00:00:00", y_axis_1: 3 },
  { x_axis_1: "2024-01-01T00:01:00", y_axis_1: 5 },
];

describe("multi-query panel whose first query is empty", () => {
  it("builds a time x-axis from the later query's rows", async () => {
    const options = await run([[], rows]);
    expect(options.xAxis[0].type).toBe("time");
  });

  it("matches the axis built when the same rows come first", async () => {
    const first = await run([rows, []]);
    const later = await run([[], rows]);
    expect(later.xAxis[0].type).toBe(first.xAxis[0].type);
  });

  it("keeps the later query's series data", async () => {
    const options = await run([[], rows]);
    const withData = options.series.filter((s: any) => s.name && s.data?.length > 0);
    expect(withData).toHaveLength(1);
    expect(withData[0].data).toHaveLength(2);
  });
});
