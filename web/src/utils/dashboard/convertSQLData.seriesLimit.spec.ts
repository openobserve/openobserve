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

import { beforeAll, describe, expect, it } from "vitest";
import type { SeriesLimitInfo } from "./panelDiagnostics";

type ChartResult = {
  extras?: { seriesLimit?: SeriesLimitInfo; limitNumberOfSeriesWarningMessage?: string };
};

let convertMultiSQLData: typeof import("./convertSQLData").convertMultiSQLData;

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 100 },
    selectedOrganization: { identifier: "default" },
  },
};

const query = () => ({
  query: "SELECT 1",
  customQuery: true,
  fields: {
    stream: "default",
    stream_type: "logs",
    x: [{ label: "Time", alias: "x_axis_1", column: "x_axis_1", args: [] }],
    y: [{ label: "cnt", alias: "y_axis_1", column: "y_axis_1", args: [] }],
    z: [],
    breakdown: [{ label: "key", alias: "breakdown_1", column: "breakdown_1", args: [] }],
    filter: { conditions: [] },
  },
  config: {},
});

const rowsFor = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    x_axis_1: "2024-01-01T00:00:00",
    breakdown_1: `${prefix}${i}`,
    y_axis_1: count - i,
  }));

const run = async (data: Record<string, unknown>[][], timeShift = false): Promise<ChartResult> => {
  const panel = {
    id: "p",
    type: "line",
    queryType: "sql",
    queries: timeShift ? [query()] : [query(), query()],
    config: {},
  };
  return convertMultiSQLData(
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
        timeRangeGap:
          timeShift && i ? { seconds: 3600, periodAsStr: "1h" } : { seconds: 0, periodAsStr: "" },
        panelQueryIndex: timeShift ? 0 : i,
      })),
    },
    { height: "400px" },
    { value: [] },
    false,
  );
};

// The converter's first run loads a large module graph, which can outlast one test's timeout.
beforeAll(async () => {
  ({ convertMultiSQLData } = await import("./convertSQLData"));
  await run([[], []]);
}, 60_000);

describe("multi-query series limit", () => {
  const svc = rowsFor("svc", 15);
  const host = rowsFor("host", 150);

  it.each([
    ["the capped query second", [svc, host]],
    ["the capped query first", [host, svc]],
  ])("counts every query's series with %s", async (_order, data) => {
    const result = await run(data);
    expect(result.extras?.seriesLimit).toEqual({
      shown: 115,
      total: 165,
      cap: 100,
      perQuery: true,
    });
    expect(result.extras?.limitNumberOfSeriesWarningMessage).toBe(
      "Showing 115 of 165 series to keep the chart fast",
    );
  });

  it("keeps the per-query cap when several queries dropped series", async () => {
    const result = await run([host, rowsFor("pod", 120)]);
    expect(result.extras?.seriesLimit).toEqual({
      shown: 200,
      total: 270,
      cap: 100,
      perQuery: true,
    });
  });

  it("states one chart-wide cap for the time-shift copies of a single query", async () => {
    const result = await run([host, host], true);
    expect(result.extras?.seriesLimit).toEqual({ shown: 200, total: 300, cap: 200 });
  });

  it("reports no limit when no query dropped series", async () => {
    const result = await run([svc, rowsFor("pod", 20)]);
    expect(result.extras?.seriesLimit).toBeUndefined();
  });
});

describe("h-bar breakdown axis", () => {
  it("labels a NULL breakdown category (null), never its stand-in value", async () => {
    const panel = {
      id: "p",
      type: "h-bar",
      queryType: "sql",
      queries: [query()],
      config: {},
    };
    const result = (await convertMultiSQLData(
      panel,
      [
        [
          { x_axis_1: "checkout", breakdown_1: null, y_axis_1: 8 },
          { x_axis_1: "checkout", breakdown_1: "", y_axis_1: 4 },
        ],
      ],
      store,
      { value: { offsetWidth: 800, offsetHeight: 400 } },
      { value: null },
      { value: [[]] },
      { queries: [{ query: "SELECT 1", startTime: 1, endTime: 2, panelQueryIndex: 0 }] },
      { height: "400px" },
      { value: [] },
      false,
    )) as { options: { yAxis: { data?: unknown[] }[] } };
    const categories = result.options.yAxis.flatMap((axis) => axis.data ?? []);
    expect(categories).toContain("(null)");
    expect(categories).not.toContain("\u0000null");
  });
});
