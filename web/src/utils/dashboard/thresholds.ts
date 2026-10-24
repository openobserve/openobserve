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

import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { colorToRgba } from "./colorPalette";
import { createSeriesOverrideLookup, resolveSeriesOverride } from "./seriesOverrides";
import { chartColor, chartNumber } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { gt } from "@/types/i18n";
import echartsTokens from "echarts/lib/visual/tokens.js";

export type ThresholdMode = "absolute" | "percentage";
export type ThresholdShowAs = "color_line" | "color" | "line" | "color_band";

export interface ThresholdStep {
  value: number;
  color: string;
}

export interface Thresholds {
  mode: ThresholdMode;
  showAs: ThresholdShowAs;
  baseColor: string | null;
  steps: ThresholdStep[];
}

export interface ValueRange {
  min: number;
  max: number;
}

export type GaugeColorStop = [number, string];

/** The axis that carries values: y for vertical charts, x for h-bar. */
export type ValueAxisKey = "xAxis" | "yAxis";

const SHOW_AS: readonly ThresholdShowAs[] = ["color_line", "color", "line", "color_band"];
const THRESHOLD_CHART_TYPES = new Set(["line", "area", "area-stacked", "bar", "h-bar", "scatter"]);
const GAUGE_BAND_ALPHA = 0.28;
const AREA_BAND_ALPHA = 0.12;
const LIMIT_LINE_WIDTH = 1.5;
const H_BAR_LABEL_ROOM = 16;
const LIMIT_DASHES: number[][] = [
  [12, 4],
  [8, 4],
  [5, 3],
  [2, 2],
];
// Override lines label on the left (alternating) so they never sit on the panel's right-hand labels.
const OVERRIDE_LABEL_POSITIONS = ["insideStartTop", "insideMiddleTop"];

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toColor = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** Sorted, valid steps of a stored `thresholds` object, or null when no step is usable. */
export const normalizeThresholds = (thresholds: unknown): Thresholds | null => {
  if (!thresholds || typeof thresholds !== "object") return null;
  const raw = thresholds as Record<string, any>;
  const colorByValue = new Map<number, string>();
  for (const step of Array.isArray(raw.steps) ? raw.steps : []) {
    const value = toNumber(step?.value);
    const color = toColor(step?.color);
    // Two steps on one value colour the same points, so the later one is the one shown.
    if (value !== null && color) colorByValue.set(value, color);
  }
  if (colorByValue.size === 0) return null;
  const steps = [...colorByValue.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, color]) => ({ value, color }));
  return {
    mode: raw.mode === "percentage" ? "percentage" : "absolute",
    showAs: SHOW_AS.includes(raw.showAs) ? raw.showAs : "color_line",
    baseColor: toColor(raw.baseColor),
    steps,
  };
};

/** The thresholds of the last matching series override that has steps, else the panel thresholds. */
export const getSeriesThresholds = (config: any, seriesName: string): Thresholds | null =>
  normalizeThresholds(resolveSeriesOverride(config, seriesName)?.thresholds) ??
  normalizeThresholds(config?.thresholds);

/** Steps in raw data values; null when percentage steps have no usable range. */
export const resolveStepValues = (
  thresholds: Thresholds,
  range?: ValueRange | null,
): Thresholds | null => {
  if (thresholds.mode !== "percentage") return thresholds;
  const min = range?.min;
  const max = range?.max;
  if (typeof min !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return {
    ...thresholds,
    mode: "absolute",
    steps: thresholds.steps.map((step) => ({
      value: min + (step.value / 100) * (max - min),
      color: step.color,
    })),
  };
};

/** Colour of the highest step at or below the value; below the first step the base colour, else `baseColor`. */
export const stepColorFor = (
  value: unknown,
  thresholds: Thresholds,
  baseColor: string | null,
): string | null => {
  let color = thresholds.baseColor ?? baseColor;
  const numeric = toNumber(value);
  if (numeric === null) return color;
  for (const step of thresholds.steps) {
    if (numeric < step.value) break;
    color = step.color;
  }
  return color;
};

/** Piecewise visualMap pieces; without a base colour the range below the first step is left uncovered. */
export const buildThresholdPieces = (thresholds: Thresholds) => {
  const { steps, baseColor } = thresholds;
  const pieces: Array<Record<string, number | string>> = [];
  if (baseColor) pieces.push({ lt: steps[0].value, color: baseColor });
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    pieces.push(
      next
        ? { gte: step.value, lt: next.value, color: step.color }
        : { gte: step.value, color: step.color },
    );
  });
  // ECharts builds a line gradient from the bounded pieces and throws when none is bounded.
  if (steps.length === 1) {
    const [{ value, color }] = steps;
    const split = value + Math.max(1, Math.abs(value));
    pieces.splice(-1, 1, { gte: value, lt: split, color }, { gte: split, color });
  }
  return pieces;
};

/** Hidden visualMap that colours one series by its value; dimension 0 is the value of an h-bar. */
export const buildThresholdVisualMap = (
  thresholds: Thresholds,
  seriesIndex: number,
  dimension = 1,
) => ({
  type: "piecewise",
  show: false,
  seriesIndex,
  dimension,
  pieces: buildThresholdPieces(thresholds),
  // ECharts paints uncovered values transparent unless a state names a colour and outOfRange stays empty.
  inRange: { color: [thresholds.steps[0].color] },
  outOfRange: {},
});

/** Dashed markLine items at each step, labelled with the unit-formatted value. */
export const buildLimitLineData = (
  thresholds: Thresholds,
  format: (value: number) => string,
  owner?: { name: string; position: string },
  axis: ValueAxisKey = "yAxis",
) =>
  thresholds.steps.map((step, index) => {
    const text = owner ? `${owner.name} ${format(step.value)}` : format(step.value);
    return {
      [axis]: step.value,
      lineStyle: {
        color: step.color,
        type: limitDash(index, thresholds.steps.length),
        width: LIMIT_LINE_WIDTH,
      },
      label: {
        show: true,
        // Vertical (h-bar) lines label above the plot, where rotated text would sit on the bars.
        position:
          axis === "xAxis" ? (owner ? "insideEndTop" : "end") : (owner?.position ?? "insideEndTop"),
        color: step.color,
        // A same-coloured bar or fill behind the label would swallow it without a backdrop.
        backgroundColor: chartColor("--color-surface-base"),
        padding: [1, 3],
        borderRadius: 2,
        // A function keeps braces in a custom unit from being read as a label template.
        formatter: () => text,
      },
    };
  });

/** Dash pattern per step, widest for the lowest and densest for the highest, so limits differ without colour. */
export const limitDash = (index: number, count: number): number[] => {
  const at = count > 1 ? Math.round((index * (LIMIT_DASHES.length - 1)) / (count - 1)) : 0;
  return LIMIT_DASHES[at];
};

/** markArea bands between steps; the infinite edges stretch to the plot edges. */
export const buildBandAreaData = (thresholds: Thresholds, axis: ValueAxisKey = "yAxis") => {
  const { steps, baseColor } = thresholds;
  const band = (from: number, to: number, color: string) => [
    { [axis]: from, itemStyle: { color: colorToRgba(color, AREA_BAND_ALPHA) } },
    { [axis]: to },
  ];
  const bands = baseColor ? [band(-Infinity, steps[0].value, baseColor)] : [];
  steps.forEach((step, index) => {
    bands.push(band(step.value, steps[index + 1]?.value ?? Infinity, step.color));
  });
  return bands;
};

/** Gauge axisLine colour stops (fractions of min..max), translucent so the progress arc stays readable. */
export const buildGaugeAxisLineColors = (
  thresholds: Thresholds,
  min: number,
  max: number,
  baseColor: string,
): GaugeColorStop[] => {
  const span = max - min;
  const fraction = (value: number) =>
    span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
  const colors = [thresholds.baseColor ?? baseColor, ...thresholds.steps.map((s) => s.color)];
  const edges = [...thresholds.steps.map((s) => fraction(s.value)), 1];
  // Dark mode raises the token, as faint bands vanish on a dark canvas.
  const alpha = chartNumber("--chart-threshold-band-opacity", GAUGE_BAND_ALPHA);
  return colors.map((color, index) => [edges[index], colorToRgba(color, alpha)]);
};

/** Gauge dial range; a 0.0-1.0 percent unit with the untouched 0..100 defaults reads on 0..1, as its values never exceed 1. */
export const gaugeDialRange = (min: any, max: any, unit: unknown): { min: any; max: any } => {
  const unset = (value: any, fallback: number) =>
    value === null || value === undefined || value === "" || Number(value) === fallback;
  if (unit === "percent-1" && unset(min, 0) && unset(max, 100)) return { min: 0, max: 1 };
  return { min: min || 0, max: max || 100 };
};

/** Recolours one gauge series: arc bands from the steps, progress and pointer in the value's step colour. */
export const applyGaugeThresholds = (
  gauge: any,
  thresholds: Thresholds,
  fallbackColor: string,
): void => {
  const item = gauge?.data?.[0];
  if (!item) return;
  const min = toNumber(gauge.min) ?? 0;
  const max = toNumber(gauge.max) ?? 100;
  const resolved = resolveStepValues(thresholds, { min, max });
  if (!resolved) return;
  const current: string = item.itemStyle?.color ?? fallbackColor;
  item.itemStyle = { ...item.itemStyle, color: stepColorFor(item.value, resolved, current) };
  gauge.axisLine = {
    ...gauge.axisLine,
    lineStyle: {
      ...gauge.axisLine?.lineStyle,
      color: buildGaugeAxisLineColors(resolved, min, max, current),
    },
  };
};

/** Applies each SQL gauge dial's steps; call it on the merged dial list, as a dial's palette fallback is its place in the whole panel. */
export const applyGaugeSeriesThresholds = (series: any[], config: any): void => {
  series.forEach((gauge, index) => {
    const thresholds = getSeriesThresholds(config, String(gauge?.data?.[0]?.name ?? ""));
    if (thresholds) applyGaugeThresholds(gauge, thresholds, echartsPaletteColor(index));
  });
};

/** The colour ECharts gives the nth series that sets none (palette-classic). */
export const echartsPaletteColor = (index: number): string => {
  const palette: string[] = echartsTokens.color.theme;
  return palette[Math.abs(index) % palette.length];
};

/** Background colour a metric takes from its steps; null leaves the panel Background colour. */
export const metricThresholdColor = (value: unknown, thresholds: Thresholds | null) =>
  thresholds ? stepColorFor(value, thresholds, null) : null;

const isDataSeries = (series: any) =>
  !!series && series.name != null && series.name !== "" && Array.isArray(series.data);

/** A single unnamed bar series whose bars are the series (PromQL h-bar), coloured item by item. */
const isItemSeries = (series: any) =>
  !!series &&
  !series.name &&
  series.type === "bar" &&
  Array.isArray(series.data) &&
  series.data.some((item: any) => item && typeof item === "object" && !Array.isArray(item));

const pointValue = (point: unknown, dimension = 1): number | null => {
  if (Array.isArray(point)) return toNumber(point[dimension]);
  if (point && typeof point === "object") return pointValue((point as any).value, dimension);
  return toNumber(point);
};

/** Percentage range: the configured value-axis range when both ends are set, else the data shown. */
export const getLineAreaPercentRange = (
  config: any,
  series: any[],
  dimension = 1,
): ValueRange | null => {
  const yMin = toNumber(config?.y_axis_min);
  const yMax = toNumber(config?.y_axis_max);
  if (yMin !== null && yMax !== null) return { min: yMin, max: yMax };
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const point of s.data) {
      const value = pointValue(point, dimension);
      if (value === null) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
};

/** Percentage range of a stacked chart: the axis shows per-x totals of each stack group, starting at 0. */
export const getStackedPercentRange = (
  config: any,
  series: any[],
  dimension = 1,
): ValueRange | null => {
  const yMin = toNumber(config?.y_axis_min);
  const yMax = toNumber(config?.y_axis_max);
  if (yMin !== null && yMax !== null) return { min: yMin, max: yMax };
  const totals = new Map<string, number>();
  for (const s of series) {
    s.data.forEach((point: unknown, index: number) => {
      const value = pointValue(point, dimension);
      if (value === null) return;
      const x = Array.isArray(point) ? String(point[dimension === 1 ? 0 : 1]) : String(index);
      const key = `${s.stack ?? ""}\u0000${x}`;
      totals.set(key, (totals.get(key) ?? 0) + value);
    });
  }
  if (totals.size === 0) return null;
  const sums = [...totals.values()];
  return { min: Math.min(0, ...sums), max: Math.max(...sums) };
};

/** Empty series that carries the limit lines and bands of one grid, so they show once and survive legend toggles. */
const buildMarkerSeries = (xAxisIndex: number, yAxisIndex: number): any => ({
  type: "line",
  data: [],
  silent: true,
  xAxisIndex,
  yAxisIndex,
  // Item-level symbols are ignored on the far end of a single-value markLine, so they are set here.
  markLine: { silent: true, animation: false, symbol: ["none", "none"], data: [] },
});

/** Rounds outward to a 1/2/5 x 10^n multiple so a stretched axis still ends on a readable value. */
const niceBound = (value: number, up: boolean): number => {
  if (value === 0) return 0;
  const unit = Math.pow(10, Math.floor(Math.log10(Math.abs(value)))) / 2;
  return (up ? Math.ceil(value / unit) : Math.floor(value / unit)) * unit;
};

/** Stretches an auto-scaled value axis so limit lines outside the data stay visible, with label headroom. */
const extendAxisToLimits = (
  options: any,
  axisKey: ValueAxisKey,
  axisIndex: number,
  limits: number[],
  config: any,
) => {
  const axes = options[axisKey];
  const axis = Array.isArray(axes) ? axes[axisIndex] : axes;
  if (!axis || limits.length === 0) return;
  const high = Math.max(...limits);
  const low = Math.min(...limits);
  const userMax = toNumber(config?.y_axis_max) !== null || typeof axis.max === "number";
  const userMin = toNumber(config?.y_axis_min) !== null || typeof axis.min === "number";
  // Returning null keeps ECharts' own nice extent whenever the data already clears the limits.
  if (!userMax) {
    axis.max = (extent: { min: number; max: number }) => {
      const target = high + (high - Math.min(extent.min, low, 0)) * 0.1;
      return extent.max >= target ? null : niceBound(target, true);
    };
  }
  if (!userMin && low < 0) {
    axis.min = (extent: { min: number; max: number }) => {
      const target = low - (Math.max(extent.max, high, 0) - low) * 0.1;
      return extent.min <= target ? null : niceBound(target, false);
    };
  }
};

/** Appends "· over <step>" to axis-tooltip rows whose value is at or above a step; other rows stay as they were. */
const addTooltipCues = (
  tooltip: any,
  stepsBySeries: Map<string, Thresholds>,
  formatValue: (value: unknown, seriesName: unknown) => string,
  dimension: number,
) => {
  const original = tooltip?.formatter;
  if (typeof original !== "function") return;
  tooltip.formatter = function (this: unknown, params: any, ...rest: any[]) {
    const html = original.call(this, params, ...rest);
    if (typeof html !== "string" || !Array.isArray(params)) return html;
    let out = html;
    let cursor = 0;
    // The original formatter sorts params in place, so they are in row order here.
    for (const it of params) {
      // Item-coloured bars are keyed by their category name, other series by series name.
      const key =
        stepsBySeries.has(String(it?.name)) && !stepsBySeries.has(String(it?.seriesName))
          ? it?.name
          : it?.seriesName;
      const value = pointValue(it?.value ?? it?.data, dimension);
      // Null rows are left out of the tooltip, so they have no text to step past.
      if (value === null) continue;
      const markerAt = it.marker ? out.indexOf(it.marker, cursor) : cursor;
      if (markerAt < 0) continue;
      // Rows read "name : value" (SQL) or "name: value" (PromQL h-bar).
      const shown = `: ${escapeHtml(formatValue(value, key))}`;
      const valueAt = out.indexOf(shown, markerAt);
      if (valueAt < 0) continue;
      // Rows without steps still move the cursor, or a same-coloured later row's cue lands on them.
      cursor = valueAt + shown.length;
      const thresholds = stepsBySeries.get(String(key));
      if (!thresholds) continue;
      const reached = thresholds.steps.filter((step) => value >= step.value).pop();
      if (!reached) continue;
      const limit = formatValue(reached.value, key);
      const cue = escapeHtml(` · ${gt("dashboard.thresholdTooltipOver", { limit })}`);
      out = out.slice(0, cursor) + cue + out.slice(cursor);
      cursor += cue.length;
    }
    return out;
  };
};

const categoryInverse = (options: any): boolean => {
  const axis = Array.isArray(options.yAxis) ? options.yAxis[0] : options.yAxis;
  return axis?.inverse === true;
};

const categoryNames = (options: any, horizontal: boolean): unknown[] => {
  const axes = horizontal ? options.yAxis : options.xAxis;
  const axis = Array.isArray(axes) ? axes[0] : axes;
  return Array.isArray(axis?.data) ? axis.data : [];
};

/** Adds threshold colouring, limit lines and bands to line, area, bar, h-bar and scatter; call it on the final series list, as visualMaps address series by index. */
export const applyLineAreaThresholds = (options: any, panelSchema: any): void => {
  if (!THRESHOLD_CHART_TYPES.has(panelSchema?.type) || !Array.isArray(options?.series)) return;
  const config = panelSchema.config;
  const horizontal = panelSchema.type === "h-bar";
  const dimension = horizontal ? 0 : 1;
  const valueAxis: ValueAxisKey = horizontal ? "xAxis" : "yAxis";
  const targets: Array<{ series: any; name: string; index: number; item?: any }> = [];
  options.series.forEach((series: any, index: number) => {
    if (isDataSeries(series)) {
      targets.push({ series, name: String(series.name), index });
    } else if (isItemSeries(series)) {
      const names = categoryNames(options, horizontal);
      series.data.forEach((item: any, i: number) => {
        if (item && typeof item === "object" && names[i] != null) {
          targets.push({ series, name: String(names[i]), index, item });
        }
      });
    }
  });
  const withSteps = targets
    .map((target) => ({ ...target, thresholds: getSeriesThresholds(config, target.name) }))
    .filter((target): target is typeof target & { thresholds: Thresholds } => !!target.thresholds);
  if (withSteps.length === 0) return;

  const stacked = panelSchema.type === "area-stacked";
  let percentRange: ValueRange | null | undefined;
  const rangeFor = (thresholds: Thresholds) => {
    if (thresholds.mode !== "percentage") return null;
    if (percentRange === undefined) {
      const shown = options.series.filter((s: any) => isDataSeries(s) || isItemSeries(s));
      percentRange = stacked
        ? getStackedPercentRange(config, shown, dimension)
        : getLineAreaPercentRange(config, shown, dimension);
    }
    return percentRange;
  };
  const overrides = createSeriesOverrideLookup(config);
  const areaFillOpacity = chartNumber("--chart-area-fill-bottom-opacity", 0.4);

  const visualMaps: any[] = [];
  const markerSeries = new Map<string, any>();
  const drawnSets = new Set<string>();
  const limitsByAxis = new Map<number, number[]>();
  const overrideLinesByGrid = new Map<string, number>();
  const ownerLines = new Map<
    string,
    { names: Set<string>; lines: any[]; format: (value: number) => string }
  >();
  const stepsBySeries = new Map<string, Thresholds>();
  for (const { series, name, index, item, thresholds } of withSteps) {
    const resolved = resolveStepValues(thresholds, rangeFor(thresholds));
    if (!resolved) continue;
    stepsBySeries.set(name, resolved);
    const colours = !stacked && resolved.showAs !== "line";
    if (colours && item) {
      // A bar's own itemStyle outranks a visualMap, so item-coloured bars are recoloured directly.
      const color = stepColorFor(pointValue(item, dimension), resolved, null);
      if (color) item.itemStyle = { ...item.itemStyle, color };
    } else if (colours) {
      visualMaps.push(buildThresholdVisualMap(resolved, index, dimension));
      // An explicit area fill colour outranks the visualMap, so the fill would keep the series colour.
      if (series.areaStyle?.color !== undefined) {
        const { color: _fill, ...areaStyle } = series.areaStyle;
        series.areaStyle = { ...areaStyle, opacity: areaFillOpacity };
      }
    }
    if (colours && resolved.showAs === "color") continue;
    const gridKey = `${series.xAxisIndex ?? 0}|${series.yAxisIndex ?? 0}`;
    // A series override's unit labels its own lines; the axis keeps the panel unit.
    const unit = overrides.unitArgs(name);
    const format = (value: number) =>
      formatUnitValue(getUnitValue(value, unit.unit, unit.unitCustom, unit.decimals));
    // Series sharing the same steps and unit on one grid get one set of lines, not one each.
    const setKey = `${gridKey}|${JSON.stringify(resolved)}|${JSON.stringify(unit)}`;
    const ownLimits = !!normalizeThresholds(resolveSeriesOverride(config, name)?.thresholds);
    if (drawnSets.has(setKey)) {
      ownerLines.get(setKey)?.names.add(String(overrides.displayName(name)));
      continue;
    }
    drawnSets.add(setKey);
    let marker = markerSeries.get(gridKey);
    if (!marker) {
      marker = buildMarkerSeries(series.xAxisIndex ?? 0, series.yAxisIndex ?? 0);
      markerSeries.set(gridKey, marker);
    }
    let owner: { name: string; position: string } | undefined;
    if (ownLimits) {
      const placed = overrideLinesByGrid.get(gridKey) ?? 0;
      overrideLinesByGrid.set(gridKey, placed + 1);
      const position = OVERRIDE_LABEL_POSITIONS[placed % OVERRIDE_LABEL_POSITIONS.length];
      owner = { name: String(overrides.displayName(name)), position };
    }
    const lines = buildLimitLineData(resolved, format, owner, valueAxis);
    // An inverse category axis draws vertical lines top-down, so their top end is the "start".
    if (horizontal && !owner && categoryInverse(options)) {
      lines.forEach((line) => (line.label.position = "start"));
    }
    if (owner) ownerLines.set(setKey, { names: new Set([owner.name]), lines, format });
    marker.markLine.data.push(...lines);
    const axisIndex = (horizontal ? series.xAxisIndex : series.yAxisIndex) ?? 0;
    limitsByAxis.set(axisIndex, [
      ...(limitsByAxis.get(axisIndex) ?? []),
      ...resolved.steps.map((step) => step.value),
    ]);
    if (resolved.showAs === "color_band") {
      marker.markArea ??= { silent: true, data: [] };
      marker.markArea.data.push(...buildBandAreaData(resolved, valueAxis));
    }
  }
  // A line shared by several matched series names none of them, so it reads as the value only.
  ownerLines.forEach(({ names, lines, format }) => {
    if (names.size < 2) return;
    lines.forEach((line) => {
      const text = format(line[valueAxis]);
      line.label.formatter = () => text;
    });
  });
  options.series.push(...markerSeries.values());
  // Vertical limit labels sit above the plot, so the grid gives them a row.
  if (horizontal && markerSeries.size && options.grid && !Array.isArray(options.grid)) {
    const top = toNumber(options.grid.top);
    if (top !== null) options.grid.top = top + H_BAR_LABEL_ROOM;
  }
  limitsByAxis.forEach((limits, axisIndex) =>
    extendAxisToLimits(options, valueAxis, axisIndex, limits, config),
  );
  addTooltipCues(options.tooltip, stepsBySeries, overrides.formatValue, dimension);

  if (visualMaps.length) {
    const existing = options.visualMap;
    options.visualMap = [
      ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
      ...visualMaps,
    ];
  }
};
