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

import { describe, it, expect, vi } from "vitest";
import { alignShiftedPromQLResults, convertPromQLData } from "./convertPromQLData";

vi.mock("./chartDimensionUtils", () => ({
  calculateOptimalFontSize: vi.fn(() => 14),
  calculateWidthText: vi.fn((text) => (text?.length || 0) * 8),
  calculateDynamicNameGap: vi.fn(() => 25),
  calculateRotatedLabelBottomSpace: vi.fn(() => 0),
  applyMeasuredYAxisLeftInset: vi.fn(),
}));

const START_S = 1_700_000_000;
const STEP_S = 60;
const NOW_S = START_S + 3 * STEP_S;
const grid = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => start + i * STEP_S);

const series = (pod: string, ts: number[]) => ({
  metric: { pod },
  values: ts.map((t) => [t, "1"]),
});
const matrix = (...result: any[]) => ({ resultType: "matrix", result });

const PRIMARY_META = { startTime: START_S * 1e6, endTime: NOW_S * 1e6 };
const FORECAST_META = {
  ...PRIMARY_META,
  seriesRole: "forecast",
  timeRangeGap: { seconds: 0, periodAsStr: "forecast" },
  panelQueryIndex: 0,
};
const metadata = { queries: [PRIMARY_META, FORECAST_META] };
const stepMeta = [[{ step: STEP_S * 1e6 }], [{ step: STEP_S * 1e6 }]];

const current = () => matrix(series("api-1", grid(START_S, 4)), series("api-2", grid(START_S, 4)));
const ahead = (...pods: string[]) => matrix(...pods.map((pod) => series(pod, grid(NOW_S, 3))));

const store = {
  state: { zoConfig: { max_dashboard_series: 100 }, timezone: "UTC", theme: "light" },
};
const panel = {
  id: "p1",
  type: "line",
  queryType: "promql",
  config: {},
  queries: [{ query: "x", fields: {}, config: {} }],
};
const convert = (data: any[], storeOverride = store) =>
  convertPromQLData(
    panel,
    data,
    storeOverride,
    { value: { offsetWidth: 500, offsetHeight: 300 } },
    null,
    [],
    metadata,
    stepMeta,
    false,
  );
const named = (result: any) => (result.options.series ?? []).filter((s: any) => s?.name);

describe("forecast entries", () => {
  it("are suffixed, kept on their own timestamps, and limited to the primary's label sets", () => {
    // Off the primary's step grid, as a range end T and a horizon end T + H usually are.
    const times = [NOW_S + 17, NOW_S + 17 + STEP_S, NOW_S + 100];
    const forecast = matrix(series("api-1", times), series("api-9", times));
    const { data, nameSuffixes } = alignShiftedPromQLResults(
      [current(), forecast],
      metadata,
      stepMeta,
    );

    expect(nameSuffixes).toEqual(["", "forecast"]);
    expect(data[1].result.map((s: any) => s.metric.pod)).toEqual(["api-1"]);
    expect(data[1].result[0].values.map((v: any) => v[0])).toEqual(times);
  });

  it("are dropped when the primary has no series to continue", () => {
    const { data } = alignShiftedPromQLResults([matrix(), ahead("api-1")], metadata, stepMeta);
    expect(data[1].result).toEqual([]);
  });

  it("match primaries that keep their metric name, which predict_linear drops", () => {
    const named = matrix({
      metric: { __name__: "rpc_latency", quantile: "0.99" },
      values: [[START_S, "1"]],
    });
    const forecast = matrix({ metric: { quantile: "0.99" }, values: [[NOW_S, "2"]] });
    const { data } = alignShiftedPromQLResults([named, forecast], metadata, stepMeta);

    expect(data[1].result).toEqual([
      { metric: { __name__: "rpc_latency", quantile: "0.99" }, values: [[NOW_S, "2"]] },
    ]);
  });

  it("draw dashed in their primary's colour, tagged as forecasts of its query", async () => {
    const result = await convert([current(), ahead("api-1", "api-2")]);
    const byName = Object.fromEntries(named(result).map((s: any) => [s.name, s]));

    expect(Object.keys(byName)).toEqual(["api-1", "api-2", "api-1 (forecast)", "api-2 (forecast)"]);
    const twin = byName["api-1 (forecast)"];
    expect(twin.lineStyle.type).toBe("dashed");
    expect(twin.itemStyle.color).toBe(byName["api-1"].itemStyle.color);
    expect(twin._seriesRole).toBe("forecast");
    expect(twin._panelQueryIndex).toBe(0);
    expect(twin._queryIndex).toBeUndefined();
    expect(byName["api-1"]._seriesRole).toBe("primary");
  });

  it("carry each point's timestamp and the series' value at the range end, for a right-click", async () => {
    const rising = (pod: string) => ({
      metric: { pod },
      values: grid(NOW_S, 3).map((t, k) => [t, String(10 + k)]),
    });
    const now = matrix({
      metric: { pod: "api-1" },
      values: grid(START_S, 4).map((t, k) => [t, String(k)]),
    });
    const result = await convert([now, matrix(rising("api-1"))]);
    const twin = named(result).find((s: any) => s.name === "api-1 (forecast)");
    expect(twin._timestamps).toHaveLength(twin.data.length);
    const at = (t: number) => twin.data[twin._timestamps.indexOf(t)][1];
    expect([NOW_S, NOW_S + STEP_S, NOW_S + 2 * STEP_S].map(at)).toEqual(["10", "11", "12"]);
    expect(at(NOW_S - STEP_S)).toBeNull();
    expect(twin._rangeEndValue).toBe(3);
    expect(named(result)[0]._timestamps).toBeUndefined();
  });

  it("start each at its own primary's last drawn sample, on the fitted line rather than at that sample", async () => {
    const at = (values: Array<[number, string]>) => ({ values });
    const now = matrix(
      {
        metric: { pod: "api-1" },
        ...at([
          [START_S, "0"],
          [START_S + STEP_S, "2"],
        ]),
      },
      { metric: { pod: "api-2" }, ...at([[NOW_S - STEP_S, "5"]]) },
    );
    // api-1's fit rises one per step from 10 at the range end; api-2's falls one per step from 20.
    const fit = matrix(
      { metric: { pod: "api-1" }, values: grid(NOW_S, 3).map((t, k) => [t, String(10 + k)]) },
      { metric: { pod: "api-2" }, values: grid(NOW_S, 3).map((t, k) => [t, String(20 - k)]) },
    );
    const result = await convert([now, fit]);
    const twinOf = (pod: string) => named(result).find((s: any) => s.name === `${pod} (forecast)`);
    const valueAt = (twin: any, t: number) => twin.data[twin._timestamps.indexOf(t)][1];

    const one = twinOf("api-1");
    expect(valueAt(one, START_S)).toBeNull();
    expect(Number(valueAt(one, START_S + STEP_S))).toBeCloseTo(8);
    expect(Number(valueAt(one, NOW_S - STEP_S))).toBeCloseTo(9);
    expect(valueAt(one, NOW_S)).toBe("10");
    expect(one._fitStartIndex).toBe(one._timestamps.indexOf(NOW_S));
    expect(one._rangeEndValue).toBe(2);

    const two = twinOf("api-2");
    expect(valueAt(two, START_S + STEP_S)).toBeNull();
    expect(Number(valueAt(two, NOW_S - STEP_S))).toBeCloseTo(21);
    expect(valueAt(two, NOW_S)).toBe("20");
    expect(two._rangeEndValue).toBe(5);
  });

  it("label their points fitted in the tooltip", async () => {
    const result = await convert([current(), ahead("api-1")]);
    const all = result.options.series;
    const row = (name: string) => {
      const seriesIndex = all.findIndex((s: any) => s.name === name);
      const point = { data: ["2023-11-14T22:16:00", 1], value: ["2023-11-14T22:16:00", 1] };
      return result.options.tooltip.formatter([
        { ...point, seriesIndex, seriesName: name, marker: "" },
      ]);
    };
    expect(row("api-1 (forecast)")).toContain("fitted");
    expect(row("api-1")).not.toContain("fitted");
  });

  it("never take a primary's place at the series cap", async () => {
    const tight = { state: { ...store.state, zoConfig: { max_dashboard_series: 2 } } };
    const result = await convert([current(), ahead("api-1", "api-2")], tight);

    expect(named(result).map((s: any) => s.name)).toEqual([
      "api-1",
      "api-2",
      "api-1 (forecast)",
      "api-2 (forecast)",
    ]);
  });
});
