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

import { getUnitValue } from "./convertDataIntoUnitValue";
import { applyAggregation } from "./promql/shared/dataProcessor";
import type { SeriesUnitArgs } from "./seriesOverrides";

const NO_VALUE_TEXT = "-";
const MIN_DETAIL_FONT = 12;
const MAX_DETAIL_FONT = 72;
const MIN_TITLE_FONT = 10;
const MAX_TITLE_FONT = 24;
// Average glyph width as a share of the font size, for fitting the value inside the ring.
const GLYPH_WIDTH_RATIO = 0.6;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// Both ends sit 25 degrees below the centre line (startAngle 205, endAngle -25).
const END_SIN = Math.sin((25 * Math.PI) / 180);
const END_COS = Math.cos((25 * Math.PI) / 180);

/** True when the min and max labels at `radius` clear each other and the value text above them. */
const endLabelsFit = (gauge: any, radius: number, labelFont: number, detailFont: number) => {
  const width = (value: unknown) =>
    String(gauge.axisLabel.formatter?.(value) ?? value).length * GLYPH_WIDTH_RATIO * labelFont;
  const clearsEachOther =
    (width(gauge.min) + width(gauge.max)) / 2 + labelFont / 2 <= 2 * radius * END_COS;
  // Digits fill about 0.7 of the font size, so the value's lower half reaches 0.35em below centre.
  const clearsValue = radius * END_SIN - labelFont / 2 >= detailFont * 0.35;
  return clearsEachOther && clearsValue;
};

/** True when the query asks for a dial range derived from the data. */
export const isGaugeAutoRange = (queryConfig: any): boolean => queryConfig?.range_mode === "auto";

/** Auto dial range: min(0, smallest) to largest; null when no dial has a value. */
export const gaugeAutoRange = (values: unknown[]): { min: number; max: number } | null => {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    low = Math.min(low, num);
    high = Math.max(high, num);
  }
  if (high === -Infinity) return null;
  const min = Math.min(0, low);
  // A zero span would draw an empty or full dial for every value, so widen it to 1.
  return high > min ? { min, max: high } : { min, max: min + 1 };
};

/** A PromQL series reduced to one dial value; null when the series has no usable point. */
export const promqlGaugeValue = (metric: any, aggregation: unknown): number | null => {
  // An instant query returns one `value` pair per series where a range query returns `values`.
  const points = metric?.values ?? (metric?.value ? [metric.value] : []);
  if (!points.length) return null;
  const sorted = points
    .filter((point: any) => Number.isFinite(parseFloat(point?.[1])))
    .sort((a: any, b: any) => a[0] - b[0]);
  if (!sorted.length) return null;
  const value = applyAggregation(sorted, (aggregation as string) || "last");
  return Number.isFinite(value) ? value : null;
};

/** Text shown in the dial: mapped text first, then the unit-formatted value, "-" when there is none. */
export const gaugeValueText = (value: unknown, mapping: any, unit: SeriesUnitArgs): string => {
  if (mapping?.text != null && mapping.text !== "") return String(mapping.text);
  if (value === null || value === undefined || Number.isNaN(value)) return NO_VALUE_TEXT;
  try {
    const unitValue = getUnitValue(value, unit.unit, unit.unitCustom, unit.decimals);
    return unitValue.value + unitValue.unit;
  } catch {
    return String(value);
  }
};

/** Min and max labels at the two ends of the arc; empty when the option is off. */
export const gaugeEndLabels = (show: unknown, unit: SeriesUnitArgs): Record<string, any> =>
  show === true
    ? {
        // One split puts ticks, and so labels, only at min and max.
        splitNumber: 1,
        axisLabel: { show: true, formatter: (value: number) => gaugeValueText(value, null, unit) },
      }
    : {};

/** Value and title font sizes that grow with the dial; the floors are the old fixed sizes. */
export const gaugeTextSizes = (minDim: number, text: string): { detail: number; title: number } => {
  // Inner diameter of the ring: radius is minDim / 2 - 5 and the arc is minDim / 6 wide.
  const inner = Math.max((minDim * 2) / 3 - 10, 0);
  const fitsWidth = inner / (Math.max(text.length, 1) * GLYPH_WIDTH_RATIO);
  return {
    detail: Math.round(clamp(Math.min(minDim / 5, fitsWidth), MIN_DETAIL_FONT, MAX_DETAIL_FONT)),
    title: Math.round(clamp(minDim / 12, MIN_TITLE_FONT, MAX_TITLE_FONT)),
  };
};

/** Sizes one dial (radius, arc, value, title and end labels) to its grid cell. */
export const sizeGaugeDial = (gauge: any, minDim: number, cellWidth: number): void => {
  const item = gauge?.data?.[0];
  const format = item?.detail?.formatter;
  const text = typeof format === "function" ? String(format(item.value)) : String(item?.value);
  const sizes = gaugeTextSizes(minDim, text);
  gauge.radius = `${minDim / 2 - 5}px`;
  gauge.progress = { ...gauge.progress, show: true, width: `${minDim / 6}` };
  gauge.axisLine = {
    ...gauge.axisLine,
    lineStyle: { ...gauge.axisLine?.lineStyle, width: `${minDim / 6}` },
  };
  gauge.title = {
    ...gauge.title,
    fontSize: sizes.title,
    offsetCenter: [0, "70%"],
    width: `${cellWidth}`,
    overflow: "truncate",
  };
  gauge.detail = { ...gauge.detail, fontSize: sizes.detail };
  // Only gaugeEndLabels sets a formatter; `show` itself is recomputed on every resize.
  if (typeof gauge.axisLabel?.formatter !== "function") return;
  // ECharts puts labels at radius - 20 - distance; this keeps them just inside the ring.
  const distance = Math.max(0, minDim / 6 - 16);
  const labelRadius = minDim / 2 - 5 - 20 - distance;
  gauge.axisLabel = {
    ...gauge.axisLabel,
    show: endLabelsFit(gauge, labelRadius, sizes.title, sizes.detail),
    fontSize: sizes.title,
    distance,
  };
};
