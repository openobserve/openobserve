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
import type { ExemplarMarker } from "@/ts/interfaces/exemplars";
import { promqlHeatmapTimeAxis } from "../heatmapTimeAxis";
import { HeatmapConverter } from "../promql/convertPromQLHeatmapChart";
import { processPromQLData } from "../promql/shared/dataProcessor";
import { EXEMPLAR_SERIES_ID, isExemplarSeriesId, toChartTimeMs } from "./applyExemplarSeries";
import {
  applyHeatmapExemplarSeries,
  cachedHeatmapExemplarPlacement,
  heatmapExemplarPlacer,
  placeHeatmapExemplars,
  type HeatmapExemplarLayout,
} from "./heatmapExemplars";

const T0 = Date.UTC(2026, 0, 1, 10, 0, 0) / 1000;
// Columns end at T0, T0+60 and T0+120, each covering the minute before it.
const axis = promqlHeatmapTimeAxis(
  [
    [T0, "a"],
    [T0 + 60, "b"],
    [T0 + 120, "c"],
  ],
  60,
  T0 - 60,
  "UTC",
)!;
const toChartX = (ms: number) => toChartTimeMs(ms, "UTC");

const marker = (overrides: Partial<ExemplarMarker> = {}): ExemplarMarker => ({
  id: "m1",
  queryIndexes: [0],
  tsMs: (T0 + 30) * 1000,
  value: 0.3,
  labels: { trace_id: "t1" },
  seriesLabels: { __name__: "lat_bucket", pod: "a", le: "0.5" },
  traceId: "t1",
  ...overrides,
});

describe("heatmapExemplarPlacer in generic mode", () => {
  const layout: HeatmapExemplarLayout = {
    mode: "series",
    rows: [
      { queryIndex: 0, labels: { pod: "b" } },
      { queryIndex: 0, labels: { pod: "a" } },
      null,
      { queryIndex: 1, labels: { pod: "a" } },
    ],
  };
  const place = heatmapExemplarPlacer(layout, axis, toChartX);

  it("puts a marker in the column holding its time and the row of its series", () => {
    expect(place(marker())).toEqual({ grid: 0, seriesId: EXEMPLAR_SERIES_ID, value: [1, 1] });
    expect(place(marker({ tsMs: (T0 + 120) * 1000 }))).toMatchObject({ value: [2, 1] });
  });

  it("matches only rows of a query that fetched the marker", () => {
    expect(place(marker({ queryIndexes: [1] }))).toMatchObject({ value: [1, 3] });
  });

  it("matches a hidden-query panel's rows by the panel query index the converter records", async () => {
    // Query A is hidden, so the data holds B and C, which the executor's metadata names as panel queries 1 and 2.
    const result = (labels: Record<string, string>) => ({
      result: [{ metric: labels, values: [[T0 + 60, "1"]] }],
    });
    const panelSchema = { id: "p", type: "heatmap", config: {}, queries: [{}, {}, {}] };
    const store = { state: { timezone: "UTC" } };
    const processed = await processPromQLData(
      [result({ pod: "a" }), result({ pod: "a" })] as any,
      panelSchema,
      store,
      { parentQueryIndex: [1, 2] },
    );
    const extras: any = { legends: [] };
    new HeatmapConverter().convert(processed, panelSchema, store, extras, undefined, {
      metadata: { queries: [{ startTime: T0 * 1e6, endTime: (T0 + 120) * 1e6 }] },
      stepSeconds: 60,
    } as any);
    const hidden = heatmapExemplarPlacer(
      extras.heatmapExemplarLayout,
      extras.heatmapTimeAxis,
      toChartX,
    );
    expect(hidden(marker({ queryIndexes: [1] }))).toMatchObject({ value: [1, 0] });
    expect(hidden(marker({ queryIndexes: [2] }))).toMatchObject({ value: [1, 1] });
    expect(hidden(marker({ queryIndexes: [0] }))).toBeNull();
  });

  it("prefers the most specific row when several match", () => {
    const nested = heatmapExemplarPlacer(
      {
        mode: "series",
        rows: [
          { queryIndex: 0, labels: {} },
          { queryIndex: 0, labels: { pod: "a" } },
        ],
      },
      axis,
      toChartX,
    );
    expect(nested(marker())).toMatchObject({ value: [1, 1] });
  });

  it("skips markers outside the drawn columns or with no drawn row", () => {
    expect(place(marker({ tsMs: (T0 - 90) * 1000 }))).toBeNull();
    expect(place(marker({ tsMs: (T0 + 121) * 1000 }))).toBeNull();
    expect(place(marker({ seriesLabels: { pod: "z" } }))).toBeNull();
    expect(place(marker({ queryIndexes: [2] }))).toBeNull();
  });
});

describe("heatmapExemplarPlacer in histogram mode", () => {
  const layout: HeatmapExemplarLayout = {
    mode: "histogram",
    groups: [
      { queryIndex: 0, labels: { pod: "b" }, bounds: [0.1, 0.5, 1, Infinity] },
      { queryIndex: 0, labels: { pod: "a" }, bounds: [0.1, 0.5, 1] },
    ],
  };
  const place = heatmapExemplarPlacer(layout, axis, toChartX);

  it("puts a marker in the bucket whose (previous le, le] holds its value, in its own histogram", () => {
    expect(place(marker({ value: 0.3 }))).toEqual({
      grid: 1,
      seriesId: `${EXEMPLAR_SERIES_ID}:1`,
      value: [1, 1],
    });
    expect(place(marker({ value: 0.5 }))).toMatchObject({ value: [1, 1] });
    expect(place(marker({ value: 0.05 }))).toMatchObject({ value: [1, 0] });
    expect(place(marker({ value: 0.51 }))).toMatchObject({ value: [1, 2] });
  });

  it("puts a value above every finite bound in the +Inf bucket", () => {
    const podB = { __name__: "lat_bucket", pod: "b", le: "+Inf" };
    expect(place(marker({ value: 7, seriesLabels: podB }))).toEqual({
      grid: 0,
      seriesId: EXEMPLAR_SERIES_ID,
      value: [1, 3],
    });
  });

  it("skips a value above the top bucket, a non-finite value and an unmatched histogram", () => {
    expect(place(marker({ value: 7 }))).toBeNull();
    expect(place(marker({ value: NaN }))).toBeNull();
    expect(place(marker({ seriesLabels: { pod: "c" } }))).toBeNull();
  });
});

describe("applyHeatmapExemplarSeries", () => {
  const layout: HeatmapExemplarLayout = {
    mode: "histogram",
    groups: [
      { queryIndex: 0, labels: { pod: "b" }, bounds: [1, Infinity] },
      { queryIndex: 0, labels: { pod: "a" }, bounds: [1, Infinity] },
    ],
  };
  const place = heatmapExemplarPlacer(layout, axis, toChartX);
  const style = { queryColors: ["red"], haloColor: "white", edgeColor: "black" };
  const options = { series: [{ type: "heatmap" }, { type: "heatmap" }], xAxis: [{}, {}] };

  it("adds one marker series per grid with markers, on that grid's own axes", () => {
    const out = applyHeatmapExemplarSeries(
      options,
      [
        marker({ id: "a", value: 0.5 }),
        marker({ id: "b", value: 3, seriesLabels: { pod: "b" } }),
        marker({ id: "skipped", tsMs: 0 }),
      ],
      place,
      style,
    )!;
    const added = out.series.slice(2);
    expect(added.map((s: any) => [s.id, s.xAxisIndex, s.yAxisIndex])).toEqual([
      [`${EXEMPLAR_SERIES_ID}:1`, 1, 1],
      [EXEMPLAR_SERIES_ID, 0, 0],
    ]);
    expect(added[0].data).toEqual([
      expect.objectContaining({
        value: [1, 0],
        symbol: "diamond",
        itemStyle: { color: "red" },
        exemplar: expect.objectContaining({ id: "a", traceId: "t1", clamped: false }),
      }),
    ]);
    expect(added[0].tooltip).toEqual({ show: false });
    expect(added.every((s: any) => isExemplarSeriesId(s.id))).toBe(true);
    expect(options.series).toHaveLength(2);
  });

  it("limits the colour bar to the heatmap series, so dragging it never hides a marker", () => {
    const withMap = { ...options, visualMap: { min: 0, max: 5 } };
    const out = applyHeatmapExemplarSeries(withMap, [marker({ value: 0.5 })], place, style)!;
    expect(out.visualMap).toEqual({ min: 0, max: 5, seriesIndex: [0, 1] });
    const listed = applyHeatmapExemplarSeries(
      { ...options, visualMap: [{ min: 0 }, { seriesIndex: 1 }] },
      [marker({ value: 0.5 })],
      place,
      style,
    )!;
    expect(listed.visualMap).toEqual([{ min: 0, seriesIndex: [0, 1] }, { seriesIndex: 1 }]);
    expect(withMap.visualMap).toEqual({ min: 0, max: 5 });
  });

  it("returns the options untouched when no marker lands on a cell", () => {
    expect(applyHeatmapExemplarSeries(options, [marker({ tsMs: 0 })], place, style)).toBe(options);
    expect(applyHeatmapExemplarSeries(options, [], place, style)).toBe(options);
  });
});

describe("placeHeatmapExemplars", () => {
  const layout: HeatmapExemplarLayout = {
    mode: "series",
    rows: [{ queryIndex: 0, labels: { pod: "a" } }],
  };

  it("places each marker once however often the chart asks", () => {
    const place = vi.fn(heatmapExemplarPlacer(layout, axis, toChartX));
    const m = marker();
    const placed = placeHeatmapExemplars([m], place);
    for (let i = 0; i < 5; i++) expect(placed(m)).toMatchObject({ value: [1, 0] });
    expect(place).toHaveBeenCalledTimes(1);
  });

  it("keeps only the topmost, last-drawn marker of a cell, and no marker it was not given", () => {
    const first = marker({ id: "first" });
    const last = marker({ id: "last", tsMs: (T0 + 50) * 1000 });
    const other = marker({ id: "other", tsMs: (T0 + 90) * 1000 });
    const placed = placeHeatmapExemplars(
      [first, last, other, marker({ id: "off", tsMs: 0 })],
      heatmapExemplarPlacer(layout, axis, toChartX),
    );
    expect(placed(first)).toBeNull();
    expect(placed(last)).toMatchObject({ value: [1, 0] });
    expect(placed(other)).toMatchObject({ value: [2, 0] });
    expect(placed(marker({ id: "first" }))).toBeNull();
    const out = applyHeatmapExemplarSeries(
      { series: [{ type: "heatmap" }] },
      [first, last, other],
      placed,
      { queryColors: ["red"], haloColor: "white" },
    )!;
    expect(out.series[1].data.map((d: any) => d.exemplar.id)).toEqual(["last", "other"]);
  });
});

describe("cachedHeatmapExemplarPlacement", () => {
  const layout: HeatmapExemplarLayout = {
    mode: "series",
    rows: [{ queryIndex: 0, labels: { pod: "a" } }],
  };

  it("reuses the placement until the layout, axis or markers change", () => {
    const toX = vi.fn(toChartX);
    const placement = cachedHeatmapExemplarPlacement(toX);
    const markers = [marker()];
    const first = placement(layout, axis, markers);
    expect(placement(layout, axis, markers)).toBe(first);
    expect(toX).toHaveBeenCalledTimes(1);
    expect(placement(layout, axis, [...markers])).not.toBe(first);
    expect(placement({ ...layout }, axis, markers)).not.toBe(first);
    expect(placement(layout, { ...axis }, markers)(markers[0])).toMatchObject({ value: [1, 0] });
  });
});

describe("isExemplarSeriesId", () => {
  it("recognises the plain and per-grid marker series and nothing else", () => {
    expect(isExemplarSeriesId(EXEMPLAR_SERIES_ID)).toBe(true);
    expect(isExemplarSeriesId(`${EXEMPLAR_SERIES_ID}:2`)).toBe(true);
    expect(isExemplarSeriesId(`${EXEMPLAR_SERIES_ID}x`)).toBe(false);
    expect(isExemplarSeriesId("series-0")).toBe(false);
    expect(isExemplarSeriesId(undefined)).toBe(false);
  });
});
