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

import type { ExemplarMarker } from "@/ts/interfaces/exemplars";
import { heatmapColumnAt, type HeatmapTimeAxis } from "../heatmapTimeAxis";
import {
  EXEMPLAR_EDGE_BLUR,
  EXEMPLAR_EMPHASIS_SCALE,
  EXEMPLAR_HALO_WIDTH,
  EXEMPLAR_SYMBOL_SIZE,
  EXEMPLAR_Z,
  heatmapExemplarSeriesId,
  type ExemplarDatum,
} from "./applyExemplarSeries";

/** A drawn heatmap row's source: its panel query index and its labels without `__name__`. */
export interface HeatmapExemplarRow {
  queryIndex: number;
  labels: Record<string, string>;
}

/** A drawn histogram grid's source, with its buckets' `le` bounds ascending, one per row. */
export interface HeatmapExemplarGroup extends HeatmapExemplarRow {
  bounds: number[];
}

/** What each drawn row or grid of a PromQL heatmap was built from; null entries take no exemplars. */
export type HeatmapExemplarLayout =
  | { mode: "series"; rows: (HeatmapExemplarRow | null)[] }
  | { mode: "histogram"; groups: (HeatmapExemplarGroup | null)[] };

export interface HeatmapExemplarPlace {
  grid: number;
  seriesId: string;
  value: [number, number];
}

export type HeatmapExemplarPlacer = (marker: ExemplarMarker) => HeatmapExemplarPlace | null;

export interface HeatmapExemplarStyle {
  /** Colour per panel query index. */
  queryColors: string[];
  haloColor: string;
  edgeColor?: string;
}

export function heatmapExemplarPlacer(
  layout: HeatmapExemplarLayout,
  axis: HeatmapTimeAxis,
  toChartX: (tsMs: number) => number,
): HeatmapExemplarPlacer {
  return (marker) => {
    const column = heatmapColumnAt(axis, toChartX(marker.tsMs));
    if (column < 0) return null;
    const cell =
      layout.mode === "series"
        ? seriesCell(marker, layout.rows)
        : histogramCell(marker, layout.groups);
    if (!cell) return null;
    return {
      grid: cell.grid,
      seriesId: heatmapExemplarSeriesId(cell.grid),
      value: [column, cell.row],
    };
  };
}

/** `place` resolved once per marker, keeping only the last-drawn marker of each cell, the only one there that can be seen or hovered. */
export function placeHeatmapExemplars(
  markers: ExemplarMarker[],
  place: HeatmapExemplarPlacer,
): HeatmapExemplarPlacer {
  const byCell = new Map<string, [ExemplarMarker, HeatmapExemplarPlace]>();
  for (const marker of markers) {
    const at = place(marker);
    if (at) byCell.set(`${at.grid}:${at.value[0]}:${at.value[1]}`, [marker, at]);
  }
  const placed = new Map(byCell.values());
  return (marker) => placed.get(marker) ?? null;
}

/** `placeHeatmapExemplars` that reuses its last placement while the layout, axis and markers are the same objects. */
export function cachedHeatmapExemplarPlacement(
  toChartX: (tsMs: number) => number,
): (
  layout: HeatmapExemplarLayout,
  axis: HeatmapTimeAxis,
  markers: ExemplarMarker[],
) => HeatmapExemplarPlacer {
  let last: {
    layout: HeatmapExemplarLayout;
    axis: HeatmapTimeAxis;
    markers: ExemplarMarker[];
    place: HeatmapExemplarPlacer;
  } | null = null;
  return (layout, axis, markers) => {
    if (last?.layout !== layout || last.axis !== axis || last.markers !== markers) {
      const place = placeHeatmapExemplars(markers, heatmapExemplarPlacer(layout, axis, toChartX));
      last = { layout, axis, markers, place };
    }
    return last.place;
  };
}

/** Returns a copy of `options` with one marker series per heatmap grid that has markers; markers on no drawn cell are left out. */
export function applyHeatmapExemplarSeries(
  options: Record<string, any> | null | undefined,
  markers: ExemplarMarker[],
  place: HeatmapExemplarPlacer,
  style: HeatmapExemplarStyle,
): Record<string, any> | null | undefined {
  if (!options || !markers.length) return options;
  const byGrid = new Map<number, ExemplarDatum[]>();
  for (const marker of markers) {
    const at = place(marker);
    if (!at) continue;
    const data = byGrid.get(at.grid) ?? [];
    data.push(heatmapExemplarDatum(marker, at.value, style));
    byGrid.set(at.grid, data);
  }
  if (!byGrid.size) return options;
  const series = [...byGrid.entries()].map(([grid, data]) => ({
    id: heatmapExemplarSeriesId(grid),
    type: "scatter",
    xAxisIndex: grid,
    yAxisIndex: grid,
    z: EXEMPLAR_Z,
    symbolSize: EXEMPLAR_SYMBOL_SIZE,
    emphasis: { scale: EXEMPLAR_EMPHASIS_SCALE },
    itemStyle: {
      borderColor: style.haloColor,
      borderWidth: EXEMPLAR_HALO_WIDTH,
      opacity: 1,
      ...(style.edgeColor ? { shadowColor: style.edgeColor, shadowBlur: EXEMPLAR_EDGE_BLUR } : {}),
    },
    tooltip: { show: false },
    animation: false,
    data,
  }));
  return {
    ...options,
    ...(options.visualMap
      ? { visualMap: pinVisualMapToHeatmaps(options.visualMap, options.series ?? []) }
      : {}),
    series: [...(options.series ?? []), ...series],
  };
}

function heatmapExemplarDatum(
  marker: ExemplarMarker,
  value: [number, number],
  style: HeatmapExemplarStyle,
): ExemplarDatum {
  return {
    value,
    symbol: "diamond",
    itemStyle: { color: style.queryColors[marker.queryIndexes[0]] },
    exemplar: {
      id: marker.id,
      queryIndexes: marker.queryIndexes,
      value: marker.value,
      tsMs: marker.tsMs,
      clamped: false,
      placement: "value",
      traceId: marker.traceId,
      spanId: marker.spanId,
      labels: marker.labels,
    },
  };
}

/** `visualMap` limited to the heatmap series; unpinned, it also maps each marker by its last value, the row index. */
function pinVisualMapToHeatmaps(visualMap: any, series: any[]): any {
  const seriesIndex = series.flatMap((entry, index) => (entry?.type === "heatmap" ? [index] : []));
  const pin = (map: any) => (map && map.seriesIndex === undefined ? { ...map, seriesIndex } : map);
  return Array.isArray(visualMap) ? visualMap.map(pin) : pin(visualMap);
}

/** The index of the most specific source whose query fetched the marker and whose labels its series carries, or -1. */
function matchSource(marker: ExemplarMarker, sources: (HeatmapExemplarRow | null)[]): number {
  let best = -1;
  let bestSize = -1;
  sources.forEach((source, index) => {
    if (!source || !marker.queryIndexes.includes(source.queryIndex)) return;
    const entries = Object.entries(source.labels);
    if (entries.some(([name, value]) => marker.seriesLabels?.[name] !== value)) return;
    if (entries.length > bestSize) {
      best = index;
      bestSize = entries.length;
    }
  });
  return best;
}

function seriesCell(
  marker: ExemplarMarker,
  rows: (HeatmapExemplarRow | null)[],
): { grid: number; row: number } | null {
  const row = matchSource(marker, rows);
  return row < 0 ? null : { grid: 0, row };
}

/** The bucket whose (previous `le`, `le`] holds the marker's value, in the histogram its series belongs to. */
function histogramCell(
  marker: ExemplarMarker,
  groups: (HeatmapExemplarGroup | null)[],
): { grid: number; row: number } | null {
  if (!Number.isFinite(marker.value)) return null;
  const grid = matchSource(marker, groups);
  if (grid < 0) return null;
  // Bounds ascend, so the first one at or above the value closes the bucket that holds it.
  const row = groups[grid]!.bounds.findIndex((le) => marker.value <= le);
  return row < 0 ? null : { grid, row };
}
