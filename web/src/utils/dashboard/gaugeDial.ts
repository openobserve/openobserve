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
import type { DisplayedValueMapping } from "./tableConfigUtils";

const NO_VALUE_TEXT = "-";
const MIN_DETAIL_FONT = 12;
const MAX_DETAIL_FONT = 72;
const MIN_TITLE_FONT = 10;
const MAX_TITLE_FONT = 24;
// End labels are secondary, so they shrink to this floor before being hidden.
const MIN_LABEL_FONT = 9;
const MAX_LABEL_FONT = 14;
// Average glyph width as a share of the font size, for fitting the value inside the ring.
const GLYPH_WIDTH_RATIO = 0.7;
// Typical digit width for the end labels; the bold value above needs the wider estimate.
const LABEL_GLYPH_RATIO = 0.55;

// Both ends sit 25 degrees below the centre line (startAngle 205, endAngle -25).
const END_SIN = Math.sin((25 * Math.PI) / 180);
const END_COS = Math.cos((25 * Math.PI) / 180);

export interface GaugeQueryConfig {
  range_mode?: string | null;
  min?: unknown;
  max?: unknown;
}

export interface PromQLGaugeSeries {
  values?: [number, string][];
  value?: [number, string];
}

export interface GaugeDialSeries {
  min?: unknown;
  max?: unknown;
  radius?: string;
  progress?: Record<string, unknown>;
  axisLine?: { lineStyle?: Record<string, unknown> };
  axisLabel?: {
    formatter?: (value: unknown) => string;
    show?: boolean;
    fontSize?: number;
    distance?: number;
  };
  title?: Record<string, unknown>;
  detail?: { fontSize?: number };
  data?: { value?: unknown; detail?: { formatter?: (value: unknown) => string } }[];
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const isBlank = (value: unknown) => value === null || value === undefined || value === "";

/** Smallest 1, 2 or 5 times a power of ten strictly above `value` (> 0). */
const niceCeilAbove = (value: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * magnitude > value) ?? 10;
  return step * magnitude;
};

/** True when the min and max labels at `radius` clear each other and the value text above them. */
const endLabelsFit = (
  gauge: GaugeDialSeries,
  radius: number,
  labelFont: number,
  detailFont: number,
) => {
  const width = (value: unknown) =>
    String(gauge.axisLabel?.formatter?.(value) ?? value).length * LABEL_GLYPH_RATIO * labelFont;
  // Each label runs inward from its end of the arc, so their full widths share the chord.
  const clearsEachOther =
    width(gauge.min) + width(gauge.max) + labelFont / 2 <= 2 * radius * END_COS;
  // Digits fill about 0.7 of the font size, so the value's lower half reaches 0.35em below centre.
  const clearsValue = radius * END_SIN - labelFont / 2 >= detailFont * 0.35;
  return clearsEachOther && clearsValue;
};

/** Places the end labels just inside the ring at the largest font that fits, hiding them when none does. */
const sizeGaugeEndLabels = (gauge: GaugeDialSeries, minDim: number): void => {
  // Only gaugeEndLabels sets a formatter; `show` itself is recomputed on every resize.
  if (typeof gauge.axisLabel?.formatter !== "function") return;
  // ECharts puts labels at radius - 20 - distance; this keeps them just inside the ring.
  const distance = Math.max(0, minDim / 6 - 16);
  const labelRadius = minDim / 2 - 5 - 20 - distance;
  const detailFont = gauge.detail?.fontSize ?? MIN_DETAIL_FONT;
  let font = Math.round(clamp(minDim / 18, MIN_LABEL_FONT, MAX_LABEL_FONT));
  while (font > MIN_LABEL_FONT && !endLabelsFit(gauge, labelRadius, font, detailFont)) font--;
  gauge.axisLabel = {
    ...gauge.axisLabel,
    show: endLabelsFit(gauge, labelRadius, font, detailFont),
    fontSize: font,
    distance,
  };
};

/** True when the query asks for a dial range derived from the data. */
export const isGaugeAutoRange = (queryConfig: GaugeQueryConfig | null | undefined): boolean =>
  queryConfig?.range_mode === "auto";

/** False for a Fixed range that cannot be drawn: blank min is 0, blank max is 100, and min must stay below max. */
export const isGaugeFixedRangeValid = (queryConfig: GaugeQueryConfig | null | undefined) => {
  if (isGaugeAutoRange(queryConfig)) return true;
  const low = isBlank(queryConfig?.min) ? 0 : Number(queryConfig?.min);
  const high = isBlank(queryConfig?.max) ? 100 : Number(queryConfig?.max);
  return Number.isFinite(low) && Number.isFinite(high) && low < high;
};

/** Auto dial range from min(0, smallest) to largest; null when no dial has a value. */
export const gaugeAutoRange = (
  values: unknown[],
  samples: unknown[] = [],
): { min: number; max: number } | null => {
  const finite = values
    .filter((value) => !isBlank(value))
    .map(Number)
    .filter(Number.isFinite);
  if (!finite.length) return null;
  // One dial would always fill its own range, so it spans its samples and rounds the top up.
  const single = finite.length === 1;
  const spread = single
    ? [
        ...finite,
        ...samples
          .filter((v) => !isBlank(v))
          .map(Number)
          .filter(Number.isFinite),
      ]
    : finite;
  const low = Math.min(...spread);
  const high = Math.max(...spread);
  const min = Math.min(0, low);
  if (single && high > 0) return { min, max: niceCeilAbove(high) };
  // A zero span would draw an empty or full dial for every value, so widen it to 1.
  return high > min ? { min, max: high } : { min, max: min + 1 };
};

/** Colour-scale domain over the dial values, so shade and continuous modes work for instant queries too. */
export const gaugeColorDomain = (values: (number | null)[]): [number, number] => {
  const finite = values.filter((value): value is number => Number.isFinite(value));
  return finite.length ? [Math.min(...finite), Math.max(...finite)] : [Infinity, -Infinity];
};

/** A PromQL series reduced to one dial value; null when the series has no usable point. */
export const promqlGaugeValue = (
  metric: PromQLGaugeSeries | null | undefined,
  aggregation: string | null | undefined,
): number | null => {
  // An instant query returns one `value` pair per series where a range query returns `values`.
  const points = metric?.values ?? (metric?.value ? [metric.value] : []);
  const sorted = points
    .filter((point) => Number.isFinite(parseFloat(point?.[1])))
    .sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return null;
  // An instant sample has nothing to reduce; count, range and diff would read it as 1 or 0.
  const reducer = metric?.values ? aggregation || "last" : "last";
  const value = applyAggregation(sorted, reducer);
  return Number.isFinite(value) ? value : null;
};

/** Text shown in the dial: mapped text first, then the unit-formatted value, "-" when there is none. */
export const gaugeValueText = (
  value: unknown,
  mapping: DisplayedValueMapping | null | undefined,
  unit: SeriesUnitArgs,
): string => {
  if (mapping?.text !== null && mapping?.text !== undefined && mapping.text !== "") {
    return String(mapping.text);
  }
  if (value === null || value === undefined || Number.isNaN(value)) return NO_VALUE_TEXT;
  try {
    const unitValue = getUnitValue(value, unit.unit, unit.unitCustom, unit.decimals);
    return unitValue.value + unitValue.unit;
  } catch {
    return String(value);
  }
};

/** Min and max labels at the two ends of the arc; empty when the option is off. */
export const gaugeEndLabels = (
  show: unknown,
  unit: SeriesUnitArgs,
): Pick<GaugeDialSeries, "axisLabel"> & { splitNumber?: number } =>
  show === true
    ? {
        // One split puts ticks, and so labels, only at min and max.
        splitNumber: 1,
        axisLabel: { show: true, formatter: (value: unknown) => gaugeValueText(value, null, unit) },
      }
    : {};

/** Value and title font sizes that grow with the dial; the floors are the old fixed sizes. */
export const gaugeTextSizes = (minDim: number, text: string): { detail: number; title: number } => {
  // Inner diameter of the ring: radius is minDim / 2 - 5 and the arc is minDim / 6 wide.
  const inner = Math.max((minDim * 2) / 3 - 10, 0);
  const fitsWidth = inner / (Math.max(text.length, 1) * GLYPH_WIDTH_RATIO);
  return {
    detail: Math.floor(clamp(Math.min(minDim / 5, fitsWidth), MIN_DETAIL_FONT, MAX_DETAIL_FONT)),
    title: Math.round(clamp(minDim / 12, MIN_TITLE_FONT, MAX_TITLE_FONT)),
  };
};

/** Sizes one dial (radius, arc, value, title and end labels) to its grid cell. */
export const sizeGaugeDial = (gauge: GaugeDialSeries, minDim: number, cellWidth: number): void => {
  const item = gauge?.data?.[0];
  const format = item?.detail?.formatter;
  const text = typeof format === "function" ? String(format(item?.value)) : String(item?.value);
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
  sizeGaugeEndLabels(gauge, minDim);
};

/** Gives every dial the smallest value font among them, so equal values never read as unequal. */
export const alignGaugeValueFonts = (dials: GaugeDialSeries[], minDim: number): void => {
  const sizes = dials.map((dial) => dial.detail?.fontSize).filter(Number.isFinite) as number[];
  if (sizes.length < 2) return;
  const shared = Math.min(...sizes);
  for (const dial of dials) {
    dial.detail = { ...dial.detail, fontSize: shared };
    sizeGaugeEndLabels(dial, minDim);
  }
};
