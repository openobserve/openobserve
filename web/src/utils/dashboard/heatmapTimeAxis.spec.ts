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
import * as echarts from "echarts";
import {
  applyHeatmapTimePointer,
  heatmapColumnAt,
  heatmapHoverTime,
  heatmapSyncPointer,
  heatmapZoomRange,
  heatmapZoomToolbox,
  promqlHeatmapTimeAxis,
  sqlHeatmapTimeAxis,
} from "./heatmapTimeAxis";
import { toChartTimeMs } from "./exemplars/applyExemplarSeries";

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const chart = (ms: number) => toChartTimeMs(ms, "UTC");

describe("sqlHeatmapTimeAxis", () => {
  it("spans each bucket from its start to start + interval, clipped to the query range", () => {
    const axis = sqlHeatmapTimeAxis(
      [T0, T0 + MIN, T0 + 2 * MIN],
      MIN,
      [T0 + 30_000, T0 + 150_000],
      "UTC",
    );
    expect(axis?.endInclusive).toBe(false);
    expect(axis?.columns.map(({ start, end }) => [start, end])).toEqual([
      [chart(T0 + 30_000), chart(T0 + MIN)],
      [chart(T0 + MIN), chart(T0 + 2 * MIN)],
      [chart(T0 + 2 * MIN), chart(T0 + 150_000)],
    ]);
  });

  it("reports each column as the zoned Date a SQL time-series panel plots its bucket at", () => {
    const axis = sqlHeatmapTimeAxis([T0], MIN, [T0, T0 + MIN], "UTC");
    expect(axis?.columns[0].x).toBeInstanceOf(Date);
    expect((axis?.columns[0].x as Date).getTime()).toBe(chart(T0));
  });

  it("has no time axis without columns or a known interval", () => {
    expect(sqlHeatmapTimeAxis([], MIN, [T0, T0 + MIN], "UTC")).toBeNull();
    expect(sqlHeatmapTimeAxis([T0], NaN, [T0, T0 + MIN], "UTC")).toBeNull();
  });
});

describe("promqlHeatmapTimeAxis", () => {
  const sec = T0 / 1000;
  const stamps: Array<[number, string]> = [
    [sec, "a"],
    [sec + 60, "b"],
    [sec + 120, "c"],
  ];

  it("covers the step before each evaluation instant, clipped to the query start", () => {
    const axis = promqlHeatmapTimeAxis(stamps, 60, sec - 30, "UTC");
    expect(axis?.endInclusive).toBe(true);
    expect(axis?.columns.map(({ start, end }) => [start, end])).toEqual([
      [chart(T0 - 30_000), chart(T0)],
      [chart(T0), chart(T0 + MIN)],
      [chart(T0 + MIN), chart(T0 + 2 * MIN)],
    ]);
    expect(axis?.columns.map((column) => column.x)).toEqual(["a", "b", "c"]);
  });

  it("falls back to the smallest gap between instants when the step is unknown", () => {
    const axis = promqlHeatmapTimeAxis(stamps, NaN, NaN, "UTC");
    expect(axis?.columns[1].start).toBe(chart(T0));
  });

  it("has no time axis without instants", () => {
    expect(promqlHeatmapTimeAxis([], 60, sec, "UTC")).toBeNull();
  });
});

describe("heatmapColumnAt", () => {
  const sqlAxis = sqlHeatmapTimeAxis([T0, T0 + MIN], MIN, [T0, T0 + 2 * MIN], "UTC");
  const promAxis = promqlHeatmapTimeAxis(
    [
      [T0 / 1000, "a"],
      [T0 / 1000 + 60, "b"],
    ],
    60,
    T0 / 1000 - 60,
    "UTC",
  );

  it("puts a SQL bucket's start in that bucket and its end in the next", () => {
    expect(heatmapColumnAt(sqlAxis, chart(T0))).toBe(0);
    expect(heatmapColumnAt(sqlAxis, chart(T0 + MIN - 1))).toBe(0);
    expect(heatmapColumnAt(sqlAxis, chart(T0 + MIN))).toBe(1);
  });

  it("puts a PromQL instant in its own column and the moment after it in the next", () => {
    expect(heatmapColumnAt(promAxis, chart(T0))).toBe(0);
    expect(heatmapColumnAt(promAxis, chart(T0 + 1))).toBe(1);
    expect(heatmapColumnAt(promAxis, chart(T0 + MIN))).toBe(1);
  });

  it("finds no column outside the drawn ones", () => {
    expect(heatmapColumnAt(sqlAxis, chart(T0 - 1))).toBe(-1);
    expect(heatmapColumnAt(sqlAxis, chart(T0 + 2 * MIN))).toBe(-1);
    expect(heatmapColumnAt(promAxis, chart(T0 - MIN))).toBe(-1);
    expect(heatmapColumnAt(promAxis, chart(T0 + MIN + 1))).toBe(-1);
    expect(heatmapColumnAt(null, chart(T0))).toBe(-1);
    expect(heatmapColumnAt(sqlAxis, NaN)).toBe(-1);
  });
});

describe("heatmapZoomRange", () => {
  const axis = sqlHeatmapTimeAxis([T0, T0 + MIN, T0 + 2 * MIN], MIN, [T0, T0 + 3 * MIN], "UTC");

  it("maps selected column indices to the first column's start and the last column's end", () => {
    expect(heatmapZoomRange(axis, 1, 2)).toEqual({
      start: chart(T0 + MIN),
      end: chart(T0 + 3 * MIN),
    });
  });

  it("rounds fractional indices, clamps them to the columns and accepts a reversed box", () => {
    expect(heatmapZoomRange(axis, 2.4, -3)).toEqual({ start: chart(T0), end: chart(T0 + 3 * MIN) });
    expect(heatmapZoomRange(axis, 0.6, 0.6)).toEqual({
      start: chart(T0 + MIN),
      end: chart(T0 + 2 * MIN),
    });
  });

  it("has no range without time columns", () => {
    expect(heatmapZoomRange(undefined, 0, 1)).toBeNull();
    expect(heatmapZoomRange(axis, NaN, 1)).toBeNull();
  });
});

describe("cursor sync", () => {
  const axis = promqlHeatmapTimeAxis(
    [
      [T0 / 1000, "a"],
      [T0 / 1000 + 60, "b"],
    ],
    60,
    T0 / 1000 - 60,
    "UTC",
  );

  it("reports the hovered heatmap cell's column time, and nothing for another series", () => {
    expect(heatmapHoverTime(axis, { seriesType: "heatmap", value: [1, 0, 5] })).toBe("b");
    expect(heatmapHoverTime(axis, { seriesType: "scatter", value: [1, 0] })).toBeUndefined();
    expect(heatmapHoverTime(null, { seriesType: "heatmap", value: [1, 0, 5] })).toBeUndefined();
  });

  it("moves the axis pointer to the column holding the hovered time, as a Date or a zone-less string", () => {
    const pixelOf = (column: number) => [column * 10 + 5, 50];
    expect(heatmapSyncPointer(axis, new Date(chart(T0 + MIN)), pixelOf)).toEqual({
      type: "updateAxisPointer",
      currTrigger: "mousemove",
      x: 15,
      y: 50,
    });
    expect(heatmapSyncPointer(axis, "2026-01-01T10:00:00.000", pixelOf)).toMatchObject({ x: 5 });
  });

  it("clears the pointer off the drawn columns or while the chart cannot place it", () => {
    const leave = { type: "updateAxisPointer", currTrigger: "leave" };
    expect(heatmapSyncPointer(axis, new Date(chart(T0 + 5 * MIN)), () => [1, 1])).toEqual(leave);
    expect(heatmapSyncPointer(axis, new Date(chart(T0)), () => undefined)).toEqual(leave);
    expect(heatmapSyncPointer(axis, new Date(chart(T0)), () => [NaN, 1])).toEqual(leave);
  });
});

describe("heatmapZoomToolbox", () => {
  it("arms the x-only zoom brush with its buttons hidden", () => {
    const toolbox = heatmapZoomToolbox() as any;
    expect(toolbox.show).toBe(true);
    expect(toolbox.itemSize).toBe(0);
    expect(toolbox.feature.dataZoom.yAxisIndex).toBe("none");
  });
});

describe("applyHeatmapTimePointer", () => {
  it("draws the cursor on every x axis only, linked across grids, without a tooltip cross", () => {
    const options: any = {
      tooltip: { axisPointer: { type: "cross" }, formatter: () => "" },
      xAxis: [{ type: "category" }, { type: "category" }],
      yAxis: [{ type: "category" }, { type: "category" }],
    };
    applyHeatmapTimePointer(options);
    expect(options.tooltip.axisPointer).toBeUndefined();
    expect(
      options.xAxis.map((a: any) => [a.axisPointer.show, a.axisPointer.triggerTooltip]),
    ).toEqual([
      [true, false],
      [true, false],
    ]);
    expect(options.yAxis.every((a: any) => a.axisPointer === undefined)).toBe(true);
    expect(options.axisPointer).toEqual({ link: [{ xAxisIndex: "all" }] });
  });

  it("draws the cursor on a layer of its own, so moving it does not repaint the cells", () => {
    const options: any = { tooltip: {}, xAxis: [{}, {}], yAxis: {} };
    applyHeatmapTimePointer(options);
    expect(options.xAxis.map((a: any) => a.axisPointer.zlevel)).toEqual([1, 1]);
  });

  it("links nothing for a single grid", () => {
    const options: any = { tooltip: {}, xAxis: [{}], yAxis: {} };
    applyHeatmapTimePointer(options);
    expect(options.axisPointer).toBeUndefined();
  });

  it("moves the cursor line on every grid without scanning the cells of any series", () => {
    const columns = Array.from({ length: 120 }, (_unused, index) => `c${index}`);
    const cells = Array.from({ length: 120 * 10 }, (_unused, index) => [
      index % 120,
      Math.floor(index / 120),
      1,
    ]);
    const render = (scanSeries: boolean) => {
      const options: any = {
        animation: false,
        visualMap: { show: false, min: 0, max: 1 },
        grid: [
          { top: 0, height: 100 },
          { top: 120, height: 100 },
        ],
        xAxis: [0, 1].map((gridIndex) => ({ type: "category", gridIndex, data: columns })),
        yAxis: [0, 1].map((gridIndex) => ({
          type: "category",
          gridIndex,
          data: [...Array(10).keys()],
        })),
        series: [0, 1].map((index) => ({
          type: "heatmap",
          xAxisIndex: index,
          yAxisIndex: index,
          data: cells,
        })),
      };
      applyHeatmapTimePointer(options);
      if (scanSeries) for (const series of options.series) delete series.axisPointer;
      const chart = echarts.init(null as any, null, {
        renderer: "svg",
        ssr: true,
        width: 600,
        height: 240,
      });
      chart.setOption(options);
      const model = (chart as any).getModel();
      const scans = [0, 1].map((index) =>
        vi.spyOn(model.getSeriesByIndex(index), "indicesOfNearest"),
      );
      chart.dispatchAction({ type: "updateAxisPointer", currTrigger: "mousemove", x: 300, y: 50 });
      const axesInfo = model.getComponent("axisPointer").coordSysAxesInfo.axesInfo;
      const pointers = Object.values(axesInfo).map(
        (info: any) => info.axisPointerModel.option.status,
      );
      const scanned = scans.reduce((count, scan) => count + scan.mock.calls.length, 0);
      chart.dispose();
      return { pointers, scanned };
    };

    expect(render(true).scanned).toBeGreaterThan(0);
    expect(render(false)).toEqual({ pointers: ["show", "show"], scanned: 0 });
  });
});
