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
import {
  EXEMPLAR_SERIES_ID,
  applyExemplarSeries,
  clampToExtent,
  seriesValueExtent,
  toChartTimeMs,
} from "./applyExemplarSeries";
import { buildExemplarMarkers } from "./buildExemplarMarkers";
import type { ExemplarMarker } from "@/ts/interfaces/exemplars";

const marker = (over: Partial<ExemplarMarker> = {}): ExemplarMarker => ({
  id: over.id ?? "m1",
  queryIndexes: over.queryIndexes ?? [0],
  tsMs: over.tsMs ?? 1_000,
  value: over.value ?? 5,
  labels: over.labels ?? { trace_id: "t1" },
  seriesLabels: over.seriesLabels ?? {},
  traceId: "traceId" in over ? over.traceId : "t1",
  spanId: over.spanId,
});

const baseOptions = () => ({
  legend: { show: true },
  tooltip: {
    trigger: "axis",
    formatter: (params: { seriesId?: string }[]) => params.map((p) => p.seriesId).join(","),
  },
  xAxis: { type: "time" },
  yAxis: { type: "value", min: 0, max: 10 },
  series: [
    { name: "a", type: "line", itemStyle: { color: "red" }, data: [] },
    { name: "b", type: "line", itemStyle: { color: "blue" }, data: [] },
  ],
});

const ctx = {
  yExtent: [0, 10] as [number, number],
  xExtent: [0, 5_000] as [number, number],
  queryColors: ["red", "blue"],
  haloColor: "white",
};

const exemplarSeries = (options: any) =>
  options.series.find((s: { id?: string }) => s.id === EXEMPLAR_SERIES_ID);

describe("clampToExtent", () => {
  it("keeps an in-range value", () => {
    expect(clampToExtent(4, [0, 10])).toEqual({ y: 4, clamped: false });
  });
  it("clamps above and below", () => {
    expect(clampToExtent(40, [0, 10])).toEqual({ y: 10, clamped: "top" });
    expect(clampToExtent(-1, [0, 10])).toEqual({ y: 0, clamped: "bottom" });
  });
});

describe("applyExemplarSeries", () => {
  it("returns the options untouched when there are no markers", () => {
    const options = baseOptions();
    expect(applyExemplarSeries(options, [], ctx)).toBe(options);
  });

  it("appends exactly one scatter series with one data item per marker at x = tsMs", () => {
    const markers = [marker({ id: "a", tsMs: 1_000 }), marker({ id: "b", tsMs: 2_000 })];
    const out = applyExemplarSeries(baseOptions(), markers, ctx)!;
    const series = out.series.filter((s: { id?: string }) => s.id === EXEMPLAR_SERIES_ID);
    expect(series).toHaveLength(1);
    expect(series[0].type).toBe("scatter");
    expect(series[0].data.map((d: { value: number[] }) => d.value[0])).toEqual([1_000, 2_000]);
    expect(out.series[out.series.length - 1].id).toBe(EXEMPLAR_SERIES_ID);
  });

  it("draws markers above the lines with a diamond, halo, enlarged hover and no ECharts tooltip", () => {
    const out = applyExemplarSeries(baseOptions(), [marker()], ctx)!;
    const s = exemplarSeries(out);
    const lineZ = Math.max(
      ...out.series.filter((x: any) => x.type === "line").map((x: any) => x.z ?? 2),
    );
    expect(s.z).toBeGreaterThan(lineZ);
    expect(s.symbolSize).toBe(10);
    expect(10 * s.emphasis.scale).toBeCloseTo(14);
    expect(s.itemStyle).toEqual({ borderColor: "white", borderWidth: 1.5, opacity: 1 });
    expect(s.tooltip.show).toBe(false);
    expect(s.data[0].symbol).toBe("diamond");
  });

  it("draws a contrasting edge ring when one is given, since palette colours miss 3:1 on the surface", () => {
    const out = applyExemplarSeries(baseOptions(), [marker()], { ...ctx, edgeColor: "black" })!;
    expect(exemplarSeries(out).itemStyle).toMatchObject({
      borderColor: "white",
      opacity: 1,
      shadowColor: "black",
      shadowBlur: 2,
    });
  });

  it("colours a marker by the first query that returned it", () => {
    const out = applyExemplarSeries(
      baseOptions(),
      [marker({ id: "x", queryIndexes: [1] }), marker({ id: "y", queryIndexes: [0, 1] })],
      ctx,
    )!;
    expect(exemplarSeries(out).data.map((d: any) => d.itemStyle.color)).toEqual(["blue", "red"]);
  });

  it("draws a p99+p50 pair over one selector once per distinct exemplar", () => {
    const shared = {
      status: "success",
      data: [
        {
          seriesLabels: {},
          exemplars: [
            { labels: { trace_id: "a" }, value: "1", timestamp: 1 },
            { labels: { trace_id: "b" }, value: "2", timestamp: 2 },
          ],
        },
      ],
    };
    const markers = buildExemplarMarkers(
      [
        { queryIndex: 0, query: "p99", response: shared },
        { queryIndex: 1, query: "p50", response: shared },
      ],
      { startMs: 0, endMs: 10_000 },
    );
    const out = applyExemplarSeries(baseOptions(), markers, ctx)!;
    expect(exemplarSeries(out).data).toHaveLength(2);
    expect(exemplarSeries(out).data[0].exemplar.queryIndexes).toEqual([0, 1]);
  });

  it("never touches the primary axes and clamps out-of-extent values with an edge triangle", () => {
    const options = baseOptions();
    const primaryY = { ...options.yAxis };
    const primaryX = { ...options.xAxis };
    const out = applyExemplarSeries(
      options,
      [marker({ id: "hi", value: 500 }), marker({ id: "lo", value: -3, tsMs: 2_000 })],
      ctx,
    )!;
    expect(out.yAxis[0]).toEqual(primaryY);
    expect(out.xAxis[0]).toEqual(primaryX);
    expect(out.yAxis[1]).toMatchObject({ show: false, min: 0, max: 10 });
    expect(out.xAxis[1]).toMatchObject({
      show: false,
      min: 0,
      max: 5_000,
      axisPointer: { show: false, triggerTooltip: false },
    });
    const [hi, lo] = exemplarSeries(out).data;
    expect(hi.value[1]).toBe(10);
    expect(hi.symbol).toBe("triangle");
    expect(hi.exemplar).toMatchObject({ value: 500, clamped: "top" });
    expect(lo.value[1]).toBe(0);
    expect(lo.symbolRotate).toBe(180);
    expect(lo.exemplar.clamped).toBe("bottom");
    expect(exemplarSeries(out).yAxisIndex).toBe(1);
    expect(exemplarSeries(out).xAxisIndex).toBe(1);
  });

  it("places a line-mode marker on its query's line and keeps its true value", () => {
    const out = applyExemplarSeries(baseOptions(), [marker({ value: 500 })], {
      ...ctx,
      placeY: () => 3,
    })!;
    const [datum] = exemplarSeries(out).data;
    expect(datum.value[1]).toBe(3);
    expect(datum.symbol).toBe("diamond");
    expect(datum.exemplar).toMatchObject({ value: 500, clamped: false, placement: "line" });
  });

  it("falls back to value placement when the line has no value", () => {
    const out = applyExemplarSeries(baseOptions(), [marker({ value: 500 })], {
      ...ctx,
      placeY: () => null,
    })!;
    expect(exemplarSeries(out).data[0].exemplar).toMatchObject({
      clamped: "top",
      placement: "value",
    });
  });

  it("keeps the exemplar series out of the legend", () => {
    const options = { ...baseOptions(), legend: { data: ["a", "b", EXEMPLAR_SERIES_ID] } };
    const out = applyExemplarSeries(options, [marker()], ctx)!;
    expect(out.legend.data).toEqual(["a", "b"]);
    expect(exemplarSeries(out).name).toBeUndefined();
  });

  it("drops the exemplar series from the axis tooltip", () => {
    const out = applyExemplarSeries(baseOptions(), [marker()], ctx)!;
    expect(out.tooltip.formatter([{ seriesId: "a" }, { seriesId: EXEMPLAR_SERIES_ID }])).toBe("a");
  });

  it("does not mutate the input options", () => {
    const options = baseOptions();
    applyExemplarSeries(options, [marker()], ctx);
    expect(options.series).toHaveLength(2);
    expect(Array.isArray(options.yAxis)).toBe(false);
  });
});

describe("seriesValueExtent", () => {
  const data = [
    {
      result: [
        {
          values: [
            [1, "2"],
            [2, "8"],
            [3, "NaN"],
          ] as [unknown, unknown][],
        },
      ],
    },
  ];

  it("spans every finite sample", () => {
    expect(seriesValueExtent(data)).toEqual([2, 8]);
  });

  it("widens to configured bounds outside the data", () => {
    expect(seriesValueExtent(data, -5, 20)).toEqual([-5, 20]);
  });

  it("never narrows to configured bounds inside the data", () => {
    expect(seriesValueExtent(data, 4, 6)).toEqual([2, 8]);
  });

  it("ignores unset bounds", () => {
    expect(seriesValueExtent(data, null, undefined)).toEqual([2, 8]);
  });
});

describe("toChartTimeMs", () => {
  it("maps into the same zoned space the series use", () => {
    const ts = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(toChartTimeMs(ts, "UTC")).toBe(new Date("2026-01-01T12:00:00.000").getTime());
  });
});
