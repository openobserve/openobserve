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

const storeIn = (timezone: string) => ({
  state: {
    theme: "light",
    timezone,
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 100 },
    selectedOrganization: { identifier: "default" },
  },
});

const timeX = {
  label: "Timestamp",
  alias: "x_axis_1",
  column: "_timestamp",
  functionName: "histogram",
  aggregationFunction: "histogram",
  args: [{ type: "field", value: { field: "_timestamp" } }],
};
const categoryX = { label: "Level", alias: "x_axis_1", column: "level", args: [] };

const sliceNames = async (
  type: "pie" | "donut",
  x: any,
  rows: Record<string, unknown>[],
  timezone: string,
  customQuery = false,
) => {
  const panelQuery = {
    query: "SELECT 1",
    customQuery,
    fields: {
      stream: "default",
      stream_type: "logs",
      x: [x],
      y: [{ label: "n", alias: "y_axis_1", column: "n", aggregationFunction: "count", args: [] }],
      z: [],
      breakdown: [],
      filter: { conditions: [] },
    },
    config: {},
  };
  const result: any = await convertMultiSQLData(
    { id: "p", type, queryType: "sql", queries: [panelQuery], config: { show_legends: true } },
    [rows],
    storeIn(timezone),
    { value: { offsetWidth: 400, offsetHeight: 300 } },
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
    { height: "300px" },
    { value: [] },
    false,
  );
  return result.options.series[0].data;
};
const namesOf = async (...args: Parameters<typeof sliceNames>) =>
  (await sliceNames(...args)).map((d: any) => d.name);

const bucketRows = [
  { x_axis_1: "2026-11-18T10:51:30", y_axis_1: 4 },
  { x_axis_1: "2026-11-18T10:52:00", y_axis_1: 6 },
];

describe("pie and donut time-bucket slice names", () => {
  for (const type of ["pie", "donut"] as const) {
    it(`${type}: shows the user's timezone, not raw UTC`, async () => {
      const names = await namesOf(type, timeX, bucketRows, "Asia/Kolkata");
      expect(names).toEqual(["2026-11-18 16:21:30", "2026-11-18 16:22:00"]);
    });

    it(`${type}: keeps UTC times as they are when the timezone is UTC`, async () => {
      const names = await namesOf(type, timeX, bucketRows, "UTC");
      expect(names).toEqual(["2026-11-18 10:51:30", "2026-11-18 10:52:00"]);
    });

    it(`${type}: converts a custom query's ISO bucket column too`, async () => {
      const names = await namesOf(
        type,
        { ...timeX, functionName: undefined },
        bucketRows,
        "Asia/Kolkata",
        true,
      );
      expect(names).toEqual(["2026-11-18 16:21:30", "2026-11-18 16:22:00"]);
    });

    it(`${type}: keeps the raw bucket value on each slice so a drilldown still matches its row`, async () => {
      const slices = await sliceNames(type, timeX, bucketRows, "Asia/Kolkata");
      expect(slices.map((d: any) => d.rawName)).toEqual([
        "2026-11-18T10:51:30",
        "2026-11-18T10:52:00",
      ]);
    });

    it(`${type}: leaves category names alone`, async () => {
      const names = await namesOf(
        type,
        categoryX,
        [
          { x_axis_1: "info", y_axis_1: 4 },
          { x_axis_1: "warn", y_axis_1: 6 },
        ],
        "Asia/Kolkata",
      );
      expect(names).toEqual(["info", "warn"]);
    });
  }
});
