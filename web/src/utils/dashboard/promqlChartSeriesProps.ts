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

import {
  getScatterBaseOpacity,
  getScatterSymbolOpacity,
  getScatterSymbolSize,
  type SeriesStyleConfig,
} from "./scatterPointStyle";

export const DEFAULT_LINE_THICKNESS = 1.5;
export const MAX_LINE_THICKNESS = 10;

/** The line width a panel draws with; a missing, zero or negative thickness would hide the line, so it takes the default. */
export const lineThicknessOf = (config?: { line_thickness?: unknown } | null): number => {
  const value = config?.line_thickness;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_LINE_THICKNESS;
};

/** True for an unset thickness or one the editor accepts: above 0 and at most MAX_LINE_THICKNESS. */
export const isValidLineThickness = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_LINE_THICKNESS);

/**
 * Returns the ECharts series props object based on the given PromQL chart type.
 *
 * @param {string} type - The chart type (e.g. "bar", "line", "area", "gauge", etc.)
 * @param {SeriesStyleConfig} config - The panel config: line_thickness for line, area and area-stacked, and the scatter point size.
 * @return {object} The series props object for the given chart type.
 */
export const getPropsByChartTypeForSeries = (type: string, config?: SeriesStyleConfig | null) => {
  const lineThickness = lineThicknessOf(config);
  switch (type) {
    case "bar":
      return {
        type: "bar",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      };
    case "line":
      return {
        type: "line",
        emphasis: { focus: "series" },
        lineStyle: { width: lineThickness },
      };
    case "scatter":
      return {
        type: "scatter",
        emphasis: { focus: "series" },
        symbolSize: getScatterSymbolSize(config),
      };
    case "pie":
      return {
        type: "pie",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      };
    case "donut":
      return {
        type: "pie",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      };
    case "h-bar":
      return {
        type: "bar",
        orientation: "h",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      };
    case "area":
      return {
        type: "line",
        emphasis: { focus: "series" },
        areaStyle: {},
        lineStyle: { width: lineThickness },
      };
    case "stacked":
      return {
        type: "bar",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      };
    case "area-stacked":
      return {
        type: "line",
        stack: "Total",
        areaStyle: {},
        emphasis: {
          focus: "series",
        },
        lineStyle: { width: lineThickness },
      };
    case "gauge":
      return {
        type: "gauge",
        startAngle: 205,
        endAngle: -25,
        pointer: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          show: false,
        },
      };
    case "metric":
      return {
        type: "custom",
        coordinateSystem: "polar",
      };
    case "h-stacked":
      return {
        type: "bar",
        emphasis: { focus: "series" },
        orientation: "h",
        lineStyle: { width: 1.5 },
      };
    default:
      return {
        type: "bar",
      };
  }
};

/** Item opacity for a PromQL series; a time-shifted bar or scatter twin is drawn at half its base opacity. */
export const getSeriesItemOpacity = (
  type: string,
  config: SeriesStyleConfig | null | undefined,
  isShifted: boolean,
): { opacity?: number } => {
  if (isShifted && type === "scatter") return { opacity: getScatterBaseOpacity(config) * 0.5 };
  if (isShifted && type === "bar") return { opacity: 0.5 };
  const base = type === "scatter" ? getScatterSymbolOpacity(config) : undefined;
  return base === undefined ? {} : { opacity: base };
};
