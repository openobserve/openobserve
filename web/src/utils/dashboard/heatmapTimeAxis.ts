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

import { toZonedTime } from "date-fns-tz";
import { dataZoomBrushStyle } from "@/utils/chartTheme";
import { toChartTimeMs } from "./exemplars/applyExemplarSeries";

/** A column's span in the zoned wall-clock ms that time-series panels plot at, and the x a time-series panel would report for it. */
export interface HeatmapTimeColumn {
  start: number;
  end: number;
  x: unknown;
}

/** A heatmap's time x axis, columns ascending; `endInclusive` columns cover (start, end], the others [start, end). */
export interface HeatmapTimeAxis {
  columns: HeatmapTimeColumn[];
  endInclusive: boolean;
}

/** SQL `histogram(_timestamp)` buckets, each covering [bucket start, start + interval) clipped to the query range. */
export function sqlHeatmapTimeAxis(
  bucketStartsMs: number[],
  intervalMs: number,
  rangeMs: [number, number],
  timezone: string,
): HeatmapTimeAxis | null {
  if (!bucketStartsMs.length || !(intervalMs > 0)) return null;
  const [rangeStart, rangeEnd] = rangeMs;
  return {
    endInclusive: false,
    columns: bucketStartsMs.map((ms) => {
      const start = Number.isFinite(rangeStart) ? Math.max(ms, rangeStart) : ms;
      const end = Number.isFinite(rangeEnd) ? Math.min(ms + intervalMs, rangeEnd) : ms + intervalMs;
      return {
        start: toChartTimeMs(start, timezone),
        end: toChartTimeMs(Math.max(end, start), timezone),
        x: toZonedTime(ms, timezone),
      };
    }),
  };
}

/** PromQL evaluation instants; a sample at `ts` covers the step before it, (ts - step, ts], clipped to the query start. */
export function promqlHeatmapTimeAxis(
  timestamps: Array<[any, any]>,
  stepSec: number,
  rangeStartSec: number,
  timezone: string,
): HeatmapTimeAxis | null {
  if (!timestamps.length) return null;
  const step = stepSec > 0 ? stepSec : smallestGap(timestamps.map(([ts]) => Number(ts)));
  return {
    endInclusive: true,
    columns: timestamps.map(([ts, formatted]) => {
      const end = Number(ts);
      const start = Number.isFinite(rangeStartSec)
        ? Math.max(end - step, rangeStartSec)
        : end - step;
      return {
        start: toChartTimeMs(Math.min(start, end) * 1000, timezone),
        end: toChartTimeMs(end * 1000, timezone),
        x: formatted,
      };
    }),
  };
}

export function heatmapColumnAt(axis: HeatmapTimeAxis | null | undefined, t: number): number {
  const columns = axis?.columns ?? [];
  if (!Number.isFinite(t) || !columns.length) return -1;
  let lo = 0;
  let hi = columns.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const after = axis!.endInclusive ? columns[mid].end >= t : columns[mid].end > t;
    if (after) {
      found = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  if (found < 0) return -1;
  const { start, end } = columns[found];
  const inside = axis!.endInclusive ? t > start || t === end : t >= start;
  return inside ? found : -1;
}

/** A zoom box's category indices as the time range from the start of its first column to the end of its last. */
export function heatmapZoomRange(
  axis: HeatmapTimeAxis | null | undefined,
  startIndex: number,
  endIndex: number,
): { start: number; end: number } | null {
  const count = axis?.columns.length ?? 0;
  if (!count || !Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return null;
  const clamp = (index: number) => Math.min(Math.max(Math.round(index), 0), count - 1);
  const first = clamp(Math.min(startIndex, endIndex));
  const last = clamp(Math.max(startIndex, endIndex));
  return { start: axis!.columns[first].start, end: axis!.columns[last].end };
}

/** The one time axis every tile shares, or null when any tile has none or its columns differ. */
export function sharedHeatmapTimeAxis(
  axes: Array<HeatmapTimeAxis | null | undefined>,
): HeatmapTimeAxis | null {
  const [first, ...rest] = axes;
  if (!first) return null;
  const same = (axis: HeatmapTimeAxis | null | undefined) =>
    !!axis &&
    axis.endInclusive === first.endInclusive &&
    axis.columns.length === first.columns.length &&
    axis.columns.every(
      (column, index) =>
        column.start === first.columns[index].start && column.end === first.columns[index].end,
    );
  return rest.every(same) ? first : null;
}

/** The x a time-series panel would report for the hovered heatmap cell, or undefined off a heatmap cell. */
export function heatmapHoverTime(
  axis: HeatmapTimeAxis | null | undefined,
  params: { seriesType?: string; value?: unknown },
): unknown {
  if (!axis || params?.seriesType !== "heatmap" || !Array.isArray(params.value)) return undefined;
  return axis.columns[Number(params.value[0])]?.x;
}

/** The axis-pointer action that draws the cursor at the column holding the time another panel hovers; a tooltip would show an empty box there. */
export function heatmapSyncPointer(
  axis: HeatmapTimeAxis | null | undefined,
  hoveredTime: unknown,
  pixelOfColumn: (column: number) => number[] | null | undefined,
): Record<string, unknown> {
  const column = heatmapColumnAt(axis, new Date(hoveredTime as any).getTime());
  const pixel = column < 0 ? null : pixelOfColumn(column);
  if (!pixel || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) {
    return { type: "updateAxisPointer", currTrigger: "leave" };
  }
  return { type: "updateAxisPointer", currTrigger: "mousemove", x: pixel[0], y: pixel[1] };
}

/** Puts the hover cursor on the x axes only, linked across stacked grids, as a bare line; a pointer label snaps by pixel and can name a different cell than the tooltip. */
export function applyHeatmapTimePointer(options: any): void {
  if (options.tooltip) delete options.tooltip.axisPointer;
  const xAxes = Array.isArray(options.xAxis) ? options.xAxis : [options.xAxis];
  for (const axis of xAxes) {
    if (!axis) continue;
    axis.axisPointer = {
      show: true,
      // Its own canvas layer, so moving the cursor line does not repaint every cell under it.
      zlevel: 1,
      type: "line",
      triggerTooltip: false,
      label: { show: false },
    };
  }
  if (xAxes.length > 1) options.axisPointer = { link: [{ xAxisIndex: "all" }] };
  // Otherwise every pointer move scans each cell of every series on a category axis for a snap target the line never uses.
  for (const series of [options.series ?? []].flat()) {
    if (series) series.axisPointer = { show: false };
  }
}

/** The hidden toolbox that arms drag-to-zoom along x, as the time-series panels configure it. */
export function heatmapZoomToolbox(): Record<string, unknown> {
  return {
    orient: "vertical",
    show: true,
    showTitle: false,
    tooltip: { show: false },
    itemSize: 0,
    itemGap: 0,
    bottom: "100%",
    feature: {
      dataZoom: {
        brushStyle: dataZoomBrushStyle(),
        filterMode: "none",
        yAxisIndex: "none",
      },
    },
  };
}

function smallestGap(timestamps: number[]): number {
  let gap = Infinity;
  for (let i = 1; i < timestamps.length; i++) {
    const delta = timestamps[i] - timestamps[i - 1];
    if (delta > 0 && delta < gap) gap = delta;
  }
  return Number.isFinite(gap) ? gap : 0;
}
