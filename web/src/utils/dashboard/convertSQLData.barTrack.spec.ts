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
  config: Record<string, any>,
  data: any[][],
  breakdown: any[] = [],
  gaps: number[] = [],
) => {
  // A time-shifted run reuses the panel query, so its rows carry the same alias.
  const aliases = data.map((_, i) => (gaps[i] ? "v1" : `v${i + 1}`));
  const panelQueries = [...new Set(aliases)];
  const panel = {
    id: "p",
    type: "h-bar",
    queryType: "sql",
    queries: panelQueries.map((alias) => query(alias, breakdown)),
    config,
  };
  const result: any = await convertMultiSQLData(
    panel,
    data,
    store,
    { value: { offsetWidth: 800, offsetHeight: 400 } },
    { value: null },
    { value: data.map(() => []) },
    {
      queries: aliases.map((_, i) => ({
        query: "SELECT 1",
        startTime: 1704067200000000,
        endTime: 1704068400000000,
        timeRangeGap: { seconds: gaps[i] ?? 0, periodAsStr: gaps[i] ? "15 Minutes ago" : "" },
        panelQueryIndex: panelQueries.indexOf(aliases[i]),
      })),
    },
    { height: "400px" },
    { value: [] },
    false,
  );
  const { xAxis, series } = result.options;
  return {
    valueAxis: Array.isArray(xAxis) ? xAxis[0] : xAxis,
    valueAxes: [xAxis].flat(),
    options: result.options,
    bars: series.filter((s: any) => s.name),
  };
};

const oneQuery = [
  [
    { cat: "a", v1: 40 },
    { cat: "b", v1: 70 },
  ],
];

describe("SQL h-bar bar track and bar width", () => {
  it("leaves series and axis max as before when both keys are unset", async () => {
    const { valueAxis, bars, options } = await run({}, oneQuery);
    expect(options.toolbox.feature.dataZoom.filterMode).toBeUndefined();
    expect(bars[0].showBackground).toBeUndefined();
    expect(bars[0].barWidth).toBeUndefined();
    expect(valueAxis.max).toBeUndefined();
  });

  it("applies bar_width to every bar series", async () => {
    const { bars } = await run({ bar_width: 12 }, oneQuery);
    expect(bars[0].barWidth).toBe(12);
  });

  it("falls back to auto sizing for an invalid bar_width", async () => {
    for (const width of [-3, 0, 12.6, 5000]) {
      expect((await run({ bar_width: width }, oneQuery)).bars[0].barWidth).toBeUndefined();
    }
  });

  it("draws the track and pins the max to the largest bar when no max is set", async () => {
    const { valueAxis, bars } = await run({ show_bar_track: true, y_axis_max: null }, oneQuery);
    expect(bars[0].showBackground).toBe(true);
    expect(bars[0].backgroundStyle.color).toBeTruthy();
    expect(valueAxis.max).toBe(70);
    expect(valueAxis.axisLabel.hideOverlap).toBe(true);
  });

  it("leaves the axis automatic for all-negative data and pins mixed data to the largest bar", async () => {
    const negative = [
      [
        { cat: "a", v1: -40 },
        { cat: "b", v1: -70 },
      ],
    ];
    expect((await run({ show_bar_track: true }, negative)).valueAxis.max).toBeUndefined();
    const mixed = [
      [
        { cat: "a", v1: -40 },
        { cat: "b", v1: 25 },
      ],
    ];
    expect((await run({ show_bar_track: true }, mixed)).valueAxis.max).toBe(25);
  });

  it("pins a time-shifted track to the largest bar of either period", async () => {
    const shifted = [...oneQuery, [{ cat: "a", v1: 120 }]];
    const { valueAxis, bars } = await run({ show_bar_track: true }, shifted, [], [0, 900]);
    expect(bars.some((bar: any) => bar.name.includes("15 Minutes ago"))).toBe(true);
    expect(valueAxis.max).toBe(120);
  });

  it("pins the max to y_axis_max even below the data, instead of growing to the data", async () => {
    expect((await run({ y_axis_max: 50 }, oneQuery)).valueAxis.max).toBe(70);
    const pinned = await run({ show_bar_track: true, y_axis_max: 50 }, oneQuery);
    expect(pinned.valueAxis.max).toBe(50);
    expect(pinned.options.toolbox.feature.dataZoom.filterMode).toBe("none");
  });

  it("still reaches a limit line above the largest bar", async () => {
    const thresholds = {
      mode: "absolute",
      showAs: "color_line",
      steps: [{ value: 1000, color: "#EF4444" }],
    };
    const { valueAxis } = await run({ show_bar_track: true, thresholds }, oneQuery);
    expect(valueAxis.max).toBe(1500);
    const below = { ...thresholds, steps: [{ value: 20, color: "#EF4444" }] };
    expect((await run({ show_bar_track: true, thresholds: below }, oneQuery)).valueAxis.max).toBe(
      70,
    );
  });

  it("pins every trellis value axis to the largest bar", async () => {
    const rows = [
      [
        { cat: "a", svc: "x", v1: 40 },
        { cat: "b", svc: "y", v1: 70 },
      ],
    ];
    const { valueAxes } = await run({ show_bar_track: true, trellis: { layout: "auto" } }, rows, [
      byService,
    ]);
    expect(valueAxes.length).toBeGreaterThan(1);
    expect(valueAxes.map((axis: any) => axis.max)).toEqual(valueAxes.map(() => 70));
  });

  it("pins a multi-query track to the largest bar of any query", async () => {
    const twoQueries = [...oneQuery, [{ cat: "a", v2: 90 }]];
    const { valueAxis } = await run({ show_bar_track: true }, twoQueries);
    expect(valueAxis.max).toBe(90);
  });
});
