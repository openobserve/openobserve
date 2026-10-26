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

import { calculateWidthText } from "./chartDimensionUtils";
import { createSeriesOverrideLookup, type SeriesStyle } from "./seriesOverrides";

/** Chart types whose series take style overrides. */
export const SERIES_STYLE_CHART_TYPES: ReadonlySet<string> = new Set([
  "line",
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
]);

/** Chart types with a numeric value axis that takes a minimum interval. */
export const MIN_INTERVAL_CHART_TYPES: ReadonlySet<string> = new Set([
  ...SERIES_STYLE_CHART_TYPES,
  "scatter",
]);

const HORIZONTAL_CHART_TYPES: ReadonlySet<string> = new Set(["h-bar", "h-stacked"]);

const DEFAULT_POINT_SIZE = 6;
const DEFAULT_LINE_WIDTH = 1.5;
// ECharts lines sit at z 3 and annotation bands at 4, so 3.5 lifts a line over its twin but not over the bands.
const RAISED_LINE_Z = 3.5;
const RIGHT_AXIS_LABEL_GAP = 12;

const DRAW_TYPES = { line: "line", bars: "bar", points: "scatter" } as const;

const toPositive = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isPlainObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isStyledSeries = (series: any): boolean =>
  !!series &&
  series.name !== null &&
  series.name !== undefined &&
  series.name !== "" &&
  Array.isArray(series.data);

const legendsOf = (options: any): any[] =>
  (Array.isArray(options.legend) ? options.legend : [options.legend]).filter(isPlainObject);

const applyDrawStyle = (series: any, style: SeriesStyle, showSymbolDefault: boolean) => {
  if (!style.drawStyle) return;
  const type = DRAW_TYPES[style.drawStyle];
  if (series.type === type) return;
  const wasLine = series.type === "line";
  series.type = type;
  if (type === "scatter") series.symbolSize ??= DEFAULT_POINT_SIZE;
  if (type === "line" && !wasLine) series.showSymbol = showSymbolDefault;
};

const applyLineSettings = (series: any, style: SeriesStyle) => {
  if (series.type !== "line") return;
  if (style.lineStyle || style.lineWidth !== undefined) {
    series.lineStyle = {
      ...series.lineStyle,
      ...(style.lineStyle ? { type: style.lineStyle } : {}),
      ...(style.lineWidth !== undefined ? { width: style.lineWidth } : {}),
    };
  }
  if (style.showPoints !== undefined) {
    series.showSymbol = style.showPoints;
    if (style.showPoints && (!series.symbol || series.symbol === "none")) series.symbol = "circle";
  }
};

// A dashed, dotted or thin line drawn under a solid twin on the same data is hidden, so it goes on top.
const raiseOverlayLine = (series: any, style: SeriesStyle, panelLineWidth: number) => {
  if (series.type !== "line") return;
  const patterned = !!style.lineStyle && style.lineStyle !== "solid";
  const thinner = style.lineWidth !== undefined && style.lineWidth < panelLineWidth;
  if (patterned || thinner) series.z = Math.max(series.z ?? 0, RAISED_LINE_Z);
};

const applyFillOpacity = (series: any, fillOpacity: number | undefined) => {
  if (fillOpacity === undefined) return;
  const opacity = fillOpacity / 100;
  if (series.type === "line") {
    if (series.areaStyle || opacity > 0) series.areaStyle = { ...series.areaStyle, opacity };
    return;
  }
  series.itemStyle = { ...series.itemStyle, opacity };
};

const hideFromChart = (options: any, names: Set<string>) => {
  if (!names.size) return;
  if (!isPlainObject(options.legend) && !Array.isArray(options.legend)) {
    options.legend = { show: false };
  }
  for (const legend of legendsOf(options)) {
    legend.selected = { ...legend.selected };
    for (const name of names) legend.selected[name] = false;
  }
};

const hideFromLegend = (options: any, names: Set<string>) => {
  if (!names.size) return;
  const all = [
    ...new Set(options.series.filter(isStyledSeries).map((series: any) => String(series.name))),
  ] as string[];
  for (const legend of legendsOf(options)) {
    const data: any[] = Array.isArray(legend.data) ? legend.data : all;
    legend.data = data.filter((item) => !names.has(String(isPlainObject(item) ? item.name : item)));
  }
};

const hideFromTooltip = (options: any, names: Set<string>) => {
  if (!names.size || !isPlainObject(options.tooltip)) return;
  const formatter = options.tooltip.formatter;
  if (typeof formatter !== "function") return;
  options.tooltip.formatter = (params: any, ...rest: any[]) => {
    if (!Array.isArray(params))
      return names.has(params?.seriesName) ? "" : formatter(params, ...rest);
    const kept = params.filter((param: any) => !names.has(param?.seriesName));
    return kept.length ? formatter(kept, ...rest) : "";
  };
};

const widestLabel = (series: any[], formatter: unknown): number => {
  if (typeof formatter !== "function") return 0;
  let widest = 0;
  for (const s of series) {
    for (const point of s.data) {
      const value = Array.isArray(point) ? point[1] : isPlainObject(point) ? point.value : point;
      if (value === null || value === undefined) continue;
      widest = Math.max(widest, calculateWidthText(String(formatter(value))));
    }
  }
  return widest;
};

// A trellis or multi-grid chart keeps one value axis per grid, so a second axis has no place there.
const moveToRightAxis = (options: any, series: any[]) => {
  if (!series.length || !isPlainObject(options.yAxis) || options.yAxis.type !== "value") return;
  const left = options.yAxis;
  const right = {
    ...left,
    position: "right",
    name: "",
    splitLine: { ...left.splitLine, show: false },
  };
  options.yAxis = [left, right];
  for (const s of series) s.yAxisIndex = 1;
  const grid = options.grid;
  if (!isPlainObject(grid) || grid.containLabel === true) return;
  const width = widestLabel(series, right.axisLabel?.formatter);
  if (width > 0) {
    grid.right = Math.max(Number(grid.right) || 0, width + RIGHT_AXIS_LABEL_GAP);
  }
};

/** Applies line style, width, fill, points, draw style, stack group, y-axis side and hide flags from series overrides to the final options. */
export const applySeriesStyleOverrides = (options: any, panelSchema: any): void => {
  const panelType = panelSchema?.type;
  if (!SERIES_STYLE_CHART_TYPES.has(panelType) || !Array.isArray(options?.series)) return;
  const lookup = createSeriesOverrideLookup(panelSchema?.config);
  if (!lookup.active) return;
  const showSymbolDefault = panelSchema?.config?.show_symbol ?? false;
  const panelLineWidth = Number(panelSchema?.config?.line_thickness) || DEFAULT_LINE_WIDTH;
  const hidden = {
    chart: new Set<string>(),
    legend: new Set<string>(),
    tooltip: new Set<string>(),
  };
  const rightSeries: any[] = [];
  for (const series of options.series) {
    if (!isStyledSeries(series)) continue;
    const style = lookup.get(series.name)?.style;
    if (!style) continue;
    applyDrawStyle(series, style, showSymbolDefault);
    applyLineSettings(series, style);
    raiseOverlayLine(series, style, panelLineWidth);
    applyFillOpacity(series, style.fillOpacity);
    if (style.stackGroup) series.stack = style.stackGroup;
    if (style.yAxis === "right" && !HORIZONTAL_CHART_TYPES.has(panelType)) rightSeries.push(series);
    const name = String(series.name);
    if (style.hideFrom?.chart) {
      hidden.chart.add(name);
      series._hiddenFromChart = true;
    }
    if (style.hideFrom?.legend) {
      hidden.legend.add(name);
      series._hiddenFromLegend = true;
    }
    if (style.hideFrom?.tooltip) {
      hidden.tooltip.add(name);
      series.tooltip = { ...series.tooltip, show: false };
    }
  }
  moveToRightAxis(options, rightSeries);
  hideFromChart(options, hidden.chart);
  hideFromLegend(options, hidden.legend);
  hideFromTooltip(options, hidden.tooltip);
};

/** Sets the panel's minimum step on the value axes, so count series get whole-number ticks. */
export const applyYAxisMinInterval = (options: any, panelSchema: any): void => {
  const panelType = panelSchema?.type;
  if (!MIN_INTERVAL_CHART_TYPES.has(panelType) || !options) return;
  const interval = toPositive(panelSchema?.config?.y_axis_min_interval);
  if (interval === null) return;
  const key = HORIZONTAL_CHART_TYPES.has(panelType) ? "xAxis" : "yAxis";
  for (const axis of [options[key]].flat()) {
    if (isPlainObject(axis) && axis.type === "value") axis.minInterval = interval;
  }
};

/** The panel's style settings for line, area and bar charts, applied after conversion for SQL and PromQL alike. */
export const applyChartStyleOptions = (options: any, panelSchema: any): void => {
  applySeriesStyleOverrides(options, panelSchema);
  applyYAxisMinInterval(options, panelSchema);
};
