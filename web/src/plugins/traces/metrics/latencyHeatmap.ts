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

import { DateTime } from "luxon";
import type { MetricsRangeFilter, TraceSearchMode } from "@/ts/interfaces/traces/trace.types";

// Integer bounds keep every bucket exactly expressible as `duration >= lo AND duration < hi`.
export const DURATION_BOUNDS_US: readonly number[] = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000,
  500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000,
  200_000_000, 500_000_000, 1_000_000_000,
];

export const TOP_BUCKET = DURATION_BOUNDS_US.length;

export const HEATMAP_ROW_LIMIT = 20000;

export interface LatencyHeatmapHit {
  x_axis: string;
  duration_bucket: number;
  span_count: number;
}

export interface LatencyHeatmapGrid {
  colStartUs: number[];
  intervalUs: number;
  rangeStartUs: number;
  rangeEndUs: number;
  rows: number[];
  cells: [number, number, number, number][];
  colorMin: number;
  colorMax: number;
}

export interface LatencyHeatmapSelection {
  timeStartUs: number;
  timeEndUs: number;
  durationLoUs: number;
  durationHiUs: number | null;
}

export interface HeatmapBox {
  start: number;
  end: number;
  start1: number;
  end1: number;
}

export function bucketBounds(k: number): { lo: number; hi: number | null } {
  return {
    lo: k === 0 ? 0 : DURATION_BOUNDS_US[k - 1],
    hi: k === TOP_BUCKET ? null : DURATION_BOUNDS_US[k],
  };
}

export function formatDurationBound(us: number): string {
  if (us > 0 && us % 1_000_000 === 0) return `${us / 1_000_000}s`;
  if (us > 0 && us % 1_000 === 0) return `${us / 1_000}ms`;
  return `${us}us`;
}

export function buildLatencyHeatmapSql(streamName: string, filters: string[]): string {
  const whens = DURATION_BOUNDS_US.map((bound, k) => `WHEN duration < ${bound} THEN ${k}`).join(
    " ",
  );
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  return (
    `SELECT histogram(_timestamp) AS x_axis, CASE ${whens} ELSE ${TOP_BUCKET} END AS duration_bucket, ` +
    `count(*) AS span_count FROM "${streamName}"${where} ` +
    `GROUP BY x_axis, duration_bucket LIMIT ${HEATMAP_ROW_LIMIT}`
  );
}

// The histogram x_axis is a zone-less UTC timestamp string.
const parseBucketUs = (xAxis: string): number => new Date(`${xAxis}Z`).getTime() * 1000;

export function buildHeatmapGrid(
  hits: LatencyHeatmapHit[],
  intervalSec: number,
  rangeStartUs: number,
  rangeEndUs: number,
): LatencyHeatmapGrid | null {
  if (!hits.length) return null;

  const intervalUs = intervalSec * 1_000_000;
  const anchorUs = parseBucketUs(hits[0].x_axis);
  const firstUs = anchorUs + Math.floor((rangeStartUs - anchorUs) / intervalUs) * intervalUs;
  const colStartUs: number[] = [];
  for (let t = firstUs; t < rangeEndUs; t += intervalUs) colStartUs.push(t);

  // Rows span only the hits drawn, so a bucket outside the columns cannot stretch the y axis.
  const kept: { col: number; bucket: number; count: number }[] = [];
  for (const h of hits) {
    const col = Math.round((parseBucketUs(h.x_axis) - firstUs) / intervalUs);
    if (col < 0 || col >= colStartUs.length) continue;
    kept.push({ col, bucket: Number(h.duration_bucket), count: Number(h.span_count) });
  }
  if (!kept.length) return null;

  const minBucket = Math.min(...kept.map((k) => k.bucket));
  const maxBucket = Math.max(...kept.map((k) => k.bucket));
  const rows: number[] = [];
  for (let k = minBucket; k <= maxBucket; k++) rows.push(k);

  const cells = kept.map(({ col, bucket, count }): [number, number, number, number] => [
    col,
    bucket - minBucket,
    Math.log1p(count),
    count,
  ]);
  const { colorMin, colorMax } = colorDomain(cells.map((c) => c[2]));

  return { colStartUs, intervalUs, rangeStartUs, rangeEndUs, rows, cells, colorMin, colorMax };
}

const percentile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
};

// Every cell has a count of at least 1, so a domain from 0 would light most cells; spread it over the observed values.
function colorDomain(values: number[]): { colorMin: number; colorMax: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === max) return { colorMin: 0, colorMax: max };
  const p5 = percentile(sorted, 0.05);
  const p99 = percentile(sorted, 0.99);
  if (new Set(sorted).size < 3 || p5 >= p99) return { colorMin: min, colorMax: max };
  return { colorMin: p5, colorMax: p99 };
}

const clampIndex = (i: number, length: number) => Math.min(Math.max(i, 0), length - 1);

export function selectionFromBox(
  grid: LatencyHeatmapGrid,
  box: HeatmapBox,
): LatencyHeatmapSelection {
  const cols = grid.colStartUs.length;
  const i0 = clampIndex(Math.round(Math.min(box.start, box.end)), cols);
  const i1 = clampIndex(Math.round(Math.max(box.start, box.end)), cols);
  const j0 = clampIndex(Math.round(Math.min(box.start1, box.end1)), grid.rows.length);
  const j1 = clampIndex(Math.round(Math.max(box.start1, box.end1)), grid.rows.length);
  return {
    timeStartUs: Math.max(grid.rangeStartUs, grid.colStartUs[i0]),
    timeEndUs: Math.min(grid.rangeEndUs, grid.colStartUs[i1] + grid.intervalUs),
    durationLoUs: bucketBounds(grid.rows[j0]).lo,
    durationHiUs: bucketBounds(grid.rows[j1]).hi,
  };
}

// The picker formats with browser-local getters and re-parses in the app zone, so pass it the app-zone wall clock.
export function instantToPickerMs(ms: number, timezone: string): number {
  return DateTime.fromMillis(ms, { zone: timezone })
    .setZone("system", { keepLocalTime: true })
    .toMillis();
}

export function durationBand(lo: number | null, hi: number | null): string {
  const parts: string[] = [];
  if (lo) parts.push(`duration >= '${formatDurationBound(lo)}'`);
  if (hi !== null) parts.push(`duration < '${formatDurationBound(hi)}'`);
  return parts.join(" and ");
}

export function composeFilter(baselineFilter: string, band: string): string {
  if (band === "") return baselineFilter;
  if (baselineFilter.trim() === "") return band;
  return `(${baselineFilter}) and ${band}`;
}

export interface RangeSelectionContext {
  startTime: number;
  endTime: number;
  stream: string;
  searchMode: TraceSearchMode;
  editorText: string;
}

// The selection holds only while the search still shows exactly what the box applied.
export function isRangeSelectionCurrent(
  entry: MetricsRangeFilter,
  current: RangeSelectionContext,
): boolean {
  const expected = composeFilter(entry.baselineFilter ?? "", durationBand(entry.start, entry.end));
  return (
    entry.appliedStart === current.startTime &&
    entry.appliedEnd === current.endTime &&
    entry.stream === current.stream &&
    entry.searchMode === current.searchMode &&
    // The editor writes the composed text verbatim and only trims it, so anything else is a real edit.
    (current.editorText ?? "").trim() === expected.trim()
  );
}
