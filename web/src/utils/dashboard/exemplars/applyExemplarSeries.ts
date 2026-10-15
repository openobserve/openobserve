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
import type { ExemplarMarker } from "@/ts/interfaces/exemplars";

export const EXEMPLAR_SERIES_ID = "__exemplars__";
export const EXEMPLAR_SYMBOL_SIZE = 10;
export const EXEMPLAR_HALO_WIDTH = 1.5;
export const EXEMPLAR_EDGE_BLUR = 2;
const EXEMPLAR_Z = 20;
const EMPHASIS_SCALE = 1.4;

export type ExemplarClamp = "top" | "bottom" | false;

export interface ExemplarSeriesContext {
  yExtent: [number, number];
  xExtent: [number, number];
  /** Colour per original query index. */
  queryColors: string[];
  haloColor: string;
  /** Ring outside the halo; the palette colours alone do not reach 3:1 against the surface. */
  edgeColor?: string;
  /** Maps an epoch-ms timestamp onto the x scale the series use; identity by default. */
  toChartX?: (tsMs: number) => number;
  /** Line-mode y for a marker; null keeps value placement. */
  placeY?: ExemplarPlaceY;
}

/** Returns the y on the marker's query line, or null when the marker is placed by its value. */
export type ExemplarPlaceY = (marker: ExemplarMarker) => number | null;

export interface ExemplarDatum {
  value: [number, number];
  symbol: "diamond" | "triangle";
  symbolRotate?: number;
  itemStyle: { color?: string };
  exemplar: {
    id: string;
    queryIndexes: number[];
    value: number;
    tsMs: number;
    clamped: ExemplarClamp;
    placement: "value" | "line";
    traceId?: string;
    spanId?: string;
    labels: Record<string, string>;
  };
}

type AnyOptions = Record<string, any>;

export function clampToExtent(
  value: number,
  extent: [number, number],
): { y: number; clamped: ExemplarClamp } {
  const [min, max] = extent;
  if (Number.isFinite(max) && value > max) return { y: max, clamped: "top" };
  if (Number.isFinite(min) && value < min) return { y: min, clamped: "bottom" };
  return { y: value, clamped: false };
}

/** Min and max of every sample, widened by configured axis bounds the same way convertPromQLData widens the axis. */
export function seriesValueExtent(
  queries: { result?: { values?: [unknown, unknown][] }[] }[],
  yAxisMin?: number | string | null,
  yAxisMax?: number | string | null,
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const query of queries) {
    for (const series of Array.isArray(query?.result) ? query.result : []) {
      for (const point of Array.isArray(series?.values) ? series.values : []) {
        const v = Number(point?.[1]);
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (yAxisMin != null && Number.isFinite(Number(yAxisMin))) min = Math.min(min, Number(yAxisMin));
  if (yAxisMax != null && Number.isFinite(Number(yAxisMax))) max = Math.max(max, Number(yAxisMax));
  return [min, max];
}

/** Converts epoch ms to the zoned wall-clock ms that convertPromQLData plots series at. */
export function toChartTimeMs(tsMs: number, timezone: string | undefined): number {
  if (!timezone || timezone === "UTC") {
    return new Date(new Date(tsMs).toISOString().slice(0, -1)).getTime();
  }
  return toZonedTime(tsMs, timezone).getTime();
}

const asArray = (axis: unknown): AnyOptions[] => {
  if (Array.isArray(axis)) return [...axis];
  return axis ? [axis as AnyOptions] : [];
};

const finiteOr = (value: number): number | undefined =>
  Number.isFinite(value) ? value : undefined;

/** Where a marker is drawn: on its query's line, or at its value clamped to the axis. */
export function exemplarY(
  marker: ExemplarMarker,
  yExtent: [number, number],
  placeY?: ExemplarPlaceY,
): { y: number; clamped: ExemplarClamp; placement: "value" | "line" } {
  const lineY = placeY?.(marker);
  if (lineY !== null && lineY !== undefined && Number.isFinite(lineY)) {
    return { y: lineY, clamped: false, placement: "line" };
  }
  return { ...clampToExtent(marker.value, yExtent), placement: "value" };
}

export function buildExemplarData(
  markers: ExemplarMarker[],
  ctx: ExemplarSeriesContext,
): ExemplarDatum[] {
  const toX = ctx.toChartX ?? ((tsMs: number) => tsMs);
  return markers.map((marker) => {
    const { y, clamped, placement } = exemplarY(marker, ctx.yExtent, ctx.placeY);
    const datum: ExemplarDatum = {
      value: [toX(marker.tsMs), y],
      symbol: clamped ? "triangle" : "diamond",
      itemStyle: { color: ctx.queryColors[marker.queryIndexes[0]] },
      exemplar: {
        id: marker.id,
        queryIndexes: marker.queryIndexes,
        value: marker.value,
        tsMs: marker.tsMs,
        clamped,
        placement,
        traceId: marker.traceId,
        spanId: marker.spanId,
        labels: marker.labels,
      },
    };
    if (clamped === "bottom") datum.symbolRotate = 180;
    return datum;
  });
}

const wrapTooltipFormatter = (tooltip: AnyOptions | undefined): AnyOptions | undefined => {
  if (!tooltip || typeof tooltip.formatter !== "function") return tooltip;
  const original = tooltip.formatter;
  return {
    ...tooltip,
    formatter: (params: unknown, ...rest: unknown[]) => {
      const kept = Array.isArray(params)
        ? params.filter((p: { seriesId?: string }) => p?.seriesId !== EXEMPLAR_SERIES_ID)
        : params;
      return original(kept, ...rest);
    },
  };
};

/** Returns a copy of `options` with markers on hidden secondary axes, so the primary axes never rescale. */
export function applyExemplarSeries(
  options: AnyOptions | null | undefined,
  markers: ExemplarMarker[],
  ctx: ExemplarSeriesContext,
): AnyOptions | null | undefined {
  if (!options || !markers.length) return options;
  const xAxes = asArray(options.xAxis);
  const yAxes = asArray(options.yAxis);
  if (!xAxes.length || !yAxes.length) return options;

  const hiddenX = {
    type: "time",
    show: false,
    min: finiteOr(ctx.xExtent[0]),
    max: finiteOr(ctx.xExtent[1]),
    axisPointer: { show: false, triggerTooltip: false },
  };
  const hiddenY = {
    type: "value",
    show: false,
    scale: true,
    min: finiteOr(ctx.yExtent[0]),
    max: finiteOr(ctx.yExtent[1]),
    axisPointer: { show: false, triggerTooltip: false },
    splitLine: { show: false },
  };

  const series = {
    id: EXEMPLAR_SERIES_ID,
    type: "scatter",
    xAxisIndex: xAxes.length,
    yAxisIndex: yAxes.length,
    z: EXEMPLAR_Z,
    symbolSize: EXEMPLAR_SYMBOL_SIZE,
    emphasis: { scale: EMPHASIS_SCALE },
    itemStyle: {
      borderColor: ctx.haloColor,
      borderWidth: EXEMPLAR_HALO_WIDTH,
      opacity: 1,
      ...(ctx.edgeColor ? { shadowColor: ctx.edgeColor, shadowBlur: EXEMPLAR_EDGE_BLUR } : {}),
    },
    tooltip: { show: false },
    clip: false,
    animation: false,
    data: buildExemplarData(markers, ctx),
  };

  const legend = options.legend;
  const nextLegend =
    legend && Array.isArray(legend.data)
      ? {
          ...legend,
          data: legend.data.filter(
            (entry: unknown) =>
              entry !== EXEMPLAR_SERIES_ID &&
              (entry as { name?: string })?.name !== EXEMPLAR_SERIES_ID,
          ),
        }
      : legend;

  return {
    ...options,
    legend: nextLegend,
    tooltip: wrapTooltipFormatter(options.tooltip),
    xAxis: [...xAxes, hiddenX],
    yAxis: [...yAxes, hiddenY],
    series: [...(options.series ?? []), series],
  };
}
