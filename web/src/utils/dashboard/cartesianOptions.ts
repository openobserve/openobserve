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

import { escapeHtml } from "@/utils/html";
import { chartColor } from "@/utils/chartTheme";
import { calculateWidthText } from "./chartDimensionUtils";
import { absValue, createSeriesOverrideLookup, type SeriesOverrideLookup } from "./seriesOverrides";
import { sortTooltipParams } from "./tooltipSort";
import { DEFAULT_HEATMAP_PALETTE, HEATMAP_PALETTES } from "./heatmapPalettes";

/** Cartesian chart types whose final ECharts options take the panel-level series/axis settings below. */
export const CARTESIAN_CHART_TYPES: ReadonlySet<string> = new Set([
  "line",
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
  "scatter",
]);

export const PERCENT_STACK_CHART_TYPES: ReadonlySet<string> = new Set([
  "area-stacked",
  "stacked",
  "h-stacked",
]);

export const SORTABLE_BAR_CHART_TYPES: ReadonlySet<string> = new Set(["bar", "h-bar"]);

export const BAR_CHART_TYPES: ReadonlySet<string> = new Set([
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
]);

export const LINE_CHART_TYPES: ReadonlySet<string> = new Set(["line", "area", "area-stacked"]);

export const CARTESIAN_TOOLTIP_MODES = ["single", "all", "hidden"] as const;
export const Y_AXIS_SCALES = ["linear", "log"] as const;
export const Y_AXIS_LOG_BASES = [2, 10] as const;
export const LINE_STYLES = ["solid", "dashed", "dotted"] as const;
export const STACK_MODES = ["normal", "percent"] as const;
export const SORT_ORDERS = ["none", "asc", "desc"] as const;
export const MARK_AREA_AXES = ["x", "y"] as const;

const DEFAULT_SCATTER_SIZE_MIN = 4;
const DEFAULT_SCATTER_SIZE_MAX = 24;
const MARK_AREA_OPACITY = 0.18;
const Y_AXIS_NAME_GAP_PAD = 12;
const Y_AXIS_NAME_ROOM = 24;
const CONTAINED_Y_AXIS_NAME_LEFT = 30;
const X_AXIS_NAME_GAP = 35;
const X_AXIS_NAME_ROOM = 25;
const VISUAL_MAP_ROOM = 70;
const RIGHT_AXIS_LABEL_PAD = 16;

const isHorizontal = (panelType: string) => panelType === "h-bar" || panelType === "h-stacked";

const asArray = (value: any): any[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

// Annotation and mark-area helpers are nameless and plot nothing; a plain PromQL h-bar is nameless but plots.
const isDataSeries = (series: any): boolean => {
  if (!series || !Array.isArray(series.data) || !series.data.length) return false;
  const named = series.name !== null && series.name !== undefined && series.name !== "";
  return named || series.data.some((point: any) => pointY(point) !== null);
};

const dataSeriesOf = (options: any): any[] => asArray(options?.series).filter(isDataSeries);

/** The y of a series point: `[x, y, ...]` tuples and `{ value }` items unwrap; other points are the value itself. */
export const tooltipPointValue = (value: any): any => {
  if (Array.isArray(value)) return value[1];
  if (value && typeof value === "object" && "value" in value) return tooltipPointValue(value.value);
  return value;
};

const pointY = (point: any): number | null => toNumber(tooltipPointValue(point));

const withPointY = (point: any, y: number | null): any => {
  if (Array.isArray(point)) return [point[0], y, ...point.slice(2)];
  if (point && typeof point === "object" && "value" in point) {
    return { ...point, value: withPointY(point.value, y) };
  }
  return y;
};

const pointTime = (point: any): number => {
  const x = Array.isArray(point) ? point[0] : Array.isArray(point?.value) ? point.value[0] : null;
  if (x === null || x === undefined) return NaN;
  return x instanceof Date ? x.getTime() : new Date(x).getTime();
};

// Time-series points carry their x, so they bucket by time; category points bucket by position.
const bucketKey = (point: any, index: number): string => {
  const time = pointTime(point);
  return Number.isFinite(time) ? `t${time}` : `i${index}`;
};

/** The value axes of the options: x for horizontal bars, y otherwise. */
const valueAxesOf = (options: any, panelType: string): any[] =>
  asArray(isHorizontal(panelType) ? options?.xAxis : options?.yAxis).filter(
    (axis: any) => axis && (axis.type === "value" || axis.type === "log"),
  );

const isSet = (value: unknown) => value !== null && value !== undefined && value !== "";

const isPercentStack = (panelSchema: any) =>
  PERCENT_STACK_CHART_TYPES.has(panelSchema?.type) && panelSchema?.config?.stack_mode === "percent";

const applyScatterEncoding = (options: any, panelSchema: any) => {
  const config = panelSchema?.config ?? {};
  if (panelSchema?.type !== "scatter" || panelSchema?.queryType === "promql") return;
  if ((panelSchema?.queries?.length ?? 0) !== 1) return;
  const aliases: string[] = (panelSchema.queries[0]?.fields?.y ?? []).map((y: any) => y?.alias);
  const sizeGroup = config.scatter_size_field ? aliases.indexOf(config.scatter_size_field) : -1;
  const colorGroup = config.scatter_color_field ? aliases.indexOf(config.scatter_color_field) : -1;
  if (sizeGroup < 0 && colorGroup < 0) return;
  const all = dataSeriesOf(options);
  const partner = (series: any, group: number) =>
    group < 0
      ? undefined
      : all.find(
          (other) =>
            other.yAxisGroup === group &&
            (other.originalSeriesName ?? "") === (series.originalSeriesName ?? ""),
        );
  const plotted = all.filter((s) => s.yAxisGroup !== sizeGroup && s.yAxisGroup !== colorGroup);
  if (!plotted.length) return;
  const sizes: number[] = [];
  const colors: number[] = [];
  plotted.forEach((series) => {
    const sizeSeries = partner(series, sizeGroup);
    const colorSeries = partner(series, colorGroup);
    series.data = series.data.map((point: any, index: number) => {
      const x = Array.isArray(point) ? point[0] : index;
      const size = sizeSeries ? pointY(sizeSeries.data?.[index]) : null;
      const color = colorSeries ? pointY(colorSeries.data?.[index]) : null;
      if (size !== null) sizes.push(size);
      if (color !== null) colors.push(color);
      return [x, pointY(point), size, color];
    });
  });
  const removed = new Set(all.filter((s) => !plotted.includes(s)));
  options.series = asArray(options.series).filter((s) => !removed.has(s));
  if (sizeGroup >= 0) applyScatterSize(plotted, sizes, config);
  if (colorGroup >= 0) applyScatterColor(options, plotted, colors);
};

const applyScatterSize = (series: any[], sizes: number[], config: any) => {
  const minPx = toNumber(config.scatter_size_min) ?? DEFAULT_SCATTER_SIZE_MIN;
  const maxPx = Math.max(minPx, toNumber(config.scatter_size_max) ?? DEFAULT_SCATTER_SIZE_MAX);
  const low = sizes.length ? Math.min(...sizes) : 0;
  const high = sizes.length ? Math.max(...sizes) : 0;
  const symbolSize = (value: any) => {
    const size = toNumber(Array.isArray(value) ? value[2] : null);
    if (size === null) return minPx;
    if (high === low) return (minPx + maxPx) / 2;
    return minPx + ((size - low) / (high - low)) * (maxPx - minPx);
  };
  series.forEach((s) => (s.symbolSize = symbolSize));
};

const applyScatterColor = (options: any, series: any[], colors: number[]) => {
  const seriesIndex = series.map((s) => options.series.indexOf(s)).filter((i) => i >= 0);
  options.visualMap = {
    type: "continuous",
    dimension: 3,
    seriesIndex,
    min: colors.length ? Math.min(...colors) : 0,
    max: colors.length ? Math.max(...colors) : 0,
    calculable: true,
    orient: "vertical",
    right: 0,
    top: "middle",
    itemWidth: 10,
    itemHeight: 80,
    textStyle: { fontSize: 10, color: chartColor("--color-text-secondary") },
    inRange: { color: [...HEATMAP_PALETTES[DEFAULT_HEATMAP_PALETTE]] },
  };
  const grid = options.grid;
  if (grid && !Array.isArray(grid) && typeof grid.right === "number") {
    grid.right = Math.max(grid.right, VISUAL_MAP_ROOM);
  }
};

const applySortOrder = (options: any, panelSchema: any) => {
  const order = panelSchema?.config?.sort_order;
  if (!SORTABLE_BAR_CHART_TYPES.has(panelSchema?.type) || (order !== "asc" && order !== "desc")) {
    return;
  }
  const categoryAxes = asArray(
    isHorizontal(panelSchema.type) ? options?.yAxis : options?.xAxis,
  ).filter((axis: any) => axis?.type === "category");
  if (categoryAxes.length !== 1 || !Array.isArray(categoryAxes[0].data)) return;
  const axis = categoryAxes[0];
  const series = dataSeriesOf(options);
  if (series.some((s) => s.data.some((point: any) => Array.isArray(point)))) return;
  const totals = axis.data.map((_: unknown, index: number) =>
    series.reduce((sum: number, s: any) => sum + (pointY(s.data[index]) ?? 0), 0),
  );
  const direction = order === "asc" ? 1 : -1;
  const indices = axis.data
    .map((_: unknown, index: number) => index)
    .sort((a: number, b: number) => direction * (totals[a] - totals[b]) || a - b);
  axis.data = indices.map((index: number) => axis.data[index]);
  series.forEach((s) => (s.data = indices.map((index: number) => s.data[index])));
};

const breakLongGaps = (data: any[], thresholdMs: number): any[] | null => {
  const out: any[] = [];
  let previousTime: number | null = null;
  for (const point of data) {
    const time = pointTime(point);
    if (!Number.isFinite(time)) return null;
    if (pointY(point) === null) continue;
    if (previousTime !== null && time - previousTime > thresholdMs) {
      out.push(withPointY(point, null));
    }
    out.push(point);
    previousTime = time;
  }
  return out;
};

const applyConnectNullsThreshold = (options: any, panelSchema: any) => {
  const config = panelSchema?.config ?? {};
  const seconds = toNumber(config.connect_nulls_threshold);
  if (!config.connect_nulls || seconds === null || seconds <= 0) return;
  for (const series of dataSeriesOf(options)) {
    if (series.connectNulls !== true) continue;
    const data = breakLongGaps(series.data, seconds * 1000);
    if (!data) continue;
    series.data = data;
    // The short gaps were dropped above, so ECharts must break at the null points left in.
    series.connectNulls = false;
  }
};

const normalisePercentStacks = (options: any) => {
  const raw = new Map<any, any[]>();
  const groups = new Map<string, any[]>();
  for (const series of dataSeriesOf(options)) {
    if (!series.stack) continue;
    const key = String(series.stack);
    groups.set(key, [...(groups.get(key) ?? []), series]);
  }
  for (const members of groups.values()) {
    const totals = new Map<string, number>();
    for (const series of members) {
      series.data.forEach((point: any, index: number) => {
        const key = bucketKey(point, index);
        totals.set(key, (totals.get(key) ?? 0) + Math.abs(pointY(point) ?? 0));
      });
    }
    for (const series of members) {
      raw.set(series, series.data);
      series.data = series.data.map((point: any, index: number) => {
        const y = pointY(point);
        const total = totals.get(bucketKey(point, index)) ?? 0;
        return y === null ? point : withPointY(point, total > 0 ? (y / total) * 100 : 0);
      });
    }
  }
  return raw;
};

const percentTooltip = (
  options: any,
  panelSchema: any,
  raw: Map<any, any[]>,
  lookup: SeriesOverrideLookup,
) => {
  const original = options.tooltip?.formatter;
  const decimals = toNumber(panelSchema?.config?.decimals) ?? 2;
  const seriesOf = (param: any) => {
    const byIndex = options.series?.[param?.seriesIndex];
    if (byIndex?.name === param?.seriesName) return byIndex;
    return asArray(options.series).find((s: any) => s?.name === param?.seriesName);
  };
  return (params: any, ...rest: any[]) => {
    const list = asArray(params);
    const base = typeof original === "function" ? original(params, ...rest) : "";
    if (typeof original === "function" && !base) return base;
    const header = typeof base === "string" ? base.split("<br/>")[0].trim() : "";
    const rows = sortTooltipParams(
      [...list],
      panelSchema?.config,
      (it: any) => pointY(it?.value) ?? 0,
    )
      .filter((it: any) => pointY(it?.value) !== null)
      .map((it: any) => {
        const series = seriesOf(it);
        const rawPoint = raw.get(series)?.[it.dataIndex];
        const share = `${(pointY(it.value) ?? 0).toFixed(decimals)}%`;
        const value = lookup.formatValue(pointY(rawPoint), it.seriesName);
        const name = escapeHtml(String(lookup.displayName(it.seriesName)));
        return `${it.marker ?? ""} ${name} : ${escapeHtml(share)} (${escapeHtml(value)})`;
      });
    return [header, ...rows].filter(Boolean).join("<br/>");
  };
};

const applyPercentStack = (options: any, panelSchema: any, lookup: SeriesOverrideLookup) => {
  if (!isPercentStack(panelSchema)) return;
  const raw = normalisePercentStacks(options);
  if (!raw.size) return;
  for (const axis of valueAxesOf(options, panelSchema.type)) {
    axis.min = 0;
    axis.max = 100;
    axis.axisLabel = { ...axis.axisLabel, formatter: (value: number) => `${value}%` };
  }
  if (options.tooltip)
    options.tooltip.formatter = percentTooltip(options, panelSchema, raw, lookup);
};

const applyLogScale = (options: any, panelSchema: any) => {
  const config = panelSchema?.config ?? {};
  if (config.y_axis_scale !== "log") return;
  const base = Number(config.y_axis_log_base) === 2 ? 2 : 10;
  for (const axis of valueAxesOf(options, panelSchema.type)) {
    axis.type = "log";
    axis.logBase = base;
    if (typeof axis.min === "number" && axis.min <= 0) delete axis.min;
    if (typeof axis.max === "number" && axis.max <= 0) delete axis.max;
  }
  for (const series of dataSeriesOf(options)) {
    series.data = series.data.map((point: any) => {
      const y = pointY(point);
      return y !== null && y <= 0 ? withPointY(point, null) : point;
    });
  }
};

const applySoftRange = (options: any, panelSchema: any) => {
  const config = panelSchema?.config ?? {};
  if (isPercentStack(panelSchema)) return;
  const isLog = config.y_axis_scale === "log";
  const softMin = toNumber(config.y_axis_soft_min);
  const softMax = toNumber(config.y_axis_soft_max);
  const useMin = softMin !== null && !isSet(config.y_axis_min) && !(isLog && softMin <= 0);
  const useMax = softMax !== null && !isSet(config.y_axis_max) && !(isLog && softMax <= 0);
  for (const axis of valueAxesOf(options, panelSchema.type)) {
    if (useMin) axis.min = (extent: { min: number }) => Math.min(extent.min, softMin as number);
    if (useMax) axis.max = (extent: { max: number }) => Math.max(extent.max, softMax as number);
  }
};

const widestLabel = (series: any[], formatter: unknown): number => {
  if (typeof formatter !== "function") return 0;
  let widest = 0;
  for (const s of series) {
    for (const point of s.data ?? []) {
      const y = pointY(point);
      if (y === null) continue;
      widest = Math.max(widest, calculateWidthText(String(formatter(y))));
    }
  }
  return widest;
};

const placementOf = (series: any, lookup: SeriesOverrideLookup) =>
  lookup.get(series?.name)?.axisPlacement;

const applyAxisPlacement = (options: any, panelSchema: any, lookup: SeriesOverrideLookup) => {
  if (!lookup.active) return;
  const key = isHorizontal(panelSchema.type) ? "xAxis" : "yAxis";
  const base = options?.[key];
  if (!base || Array.isArray(base) || (base.type !== "value" && base.type !== "log")) return;
  const series = dataSeriesOf(options);
  const right = series.filter((s) => placementOf(s, lookup) === "right");
  const hidden = series.filter((s) => placementOf(s, lookup) === "hidden");
  if (!right.length && !hidden.length) return;
  const axes = [base];
  const extra = (show: boolean, members: any[]) => {
    const axis: any = { ...base, axisLabel: { ...base.axisLabel }, name: "", show };
    delete axis.min;
    delete axis.max;
    axis.splitLine = { ...base.splitLine, show: false };
    axis.position = key === "yAxis" ? "right" : "top";
    if (show && typeof base.axisLabel?.formatter === "function") {
      axis.axisLabel.formatter = (value: unknown) => lookup.formatValue(value, members[0].name);
    }
    axes.push(axis);
    members.forEach((s) => (s[`${key}Index`] = axes.length - 1));
    return axis;
  };
  if (right.length) {
    const axis = extra(true, right);
    const grid = options.grid;
    if (key === "yAxis" && grid && !Array.isArray(grid) && typeof grid.right === "number") {
      grid.right = Math.max(
        grid.right,
        widestLabel(right, axis.axisLabel.formatter) + RIGHT_AXIS_LABEL_PAD,
      );
    }
  }
  if (hidden.length) extra(false, hidden);
  options[key] = axes;
};

const applyNegativeAxisLabels = (options: any, panelSchema: any, lookup: SeriesOverrideLookup) => {
  if (!lookup.active) return;
  const negated = dataSeriesOf(options).some((s) => lookup.get(s.name)?.transform === "negative_y");
  if (!negated) return;
  for (const axis of valueAxesOf(options, panelSchema.type)) {
    const formatter = axis.axisLabel?.formatter;
    if (typeof formatter !== "function") continue;
    axis.axisLabel = { ...axis.axisLabel, formatter: (v: any) => formatter(absValue(v)) };
  }
};

const applyValueAxisLabel = (options: any, panelSchema: any) => {
  const config = panelSchema?.config ?? {};
  const label = typeof config.y_axis_label === "string" ? config.y_axis_label.trim() : "";
  if (!label) return;
  const horizontal = isHorizontal(panelSchema.type);
  const axis = horizontal ? options?.xAxis : options?.yAxis;
  if (!axis || Array.isArray(axis)) return;
  const hadName = !!axis.name;
  axis.name = label;
  axis.nameLocation = "middle";
  axis.nameTextStyle = { fontWeight: "bold", fontSize: 14, ...axis.nameTextStyle };
  const grid = options.grid;
  const canMoveGrid = grid && !Array.isArray(grid) && !isSet(config.axis_width);
  if (horizontal) {
    axis.nameGap = axis.nameGap || X_AXIS_NAME_GAP;
    if (!hadName && canMoveGrid && typeof grid.bottom === "number") {
      grid.bottom += X_AXIS_NAME_ROOM;
    }
    return;
  }
  const widest = widestLabel(dataSeriesOf(options), axis.axisLabel?.formatter);
  axis.nameGap = widest + Y_AXIS_NAME_GAP_PAD;
  if (!canMoveGrid) return;
  if (grid.containLabel) {
    grid.left = Math.max(toNumber(grid.left) ?? 0, CONTAINED_Y_AXIS_NAME_LEFT);
  } else {
    grid.left = axis.nameGap + Y_AXIS_NAME_ROOM;
  }
};

const applyLineStyle = (options: any, panelSchema: any) => {
  const style = panelSchema?.config?.line_style;
  if (style !== "dashed" && style !== "dotted" && style !== "solid") return;
  for (const series of dataSeriesOf(options)) {
    if (series.type !== "line") continue;
    // A per-series override set its own type first and outranks the panel setting.
    series.lineStyle = { ...series.lineStyle, type: series.lineStyle?.type ?? style };
  }
};

const applyBarRadius = (options: any, panelSchema: any) => {
  const radius = toNumber(panelSchema?.config?.bar_radius);
  if (radius === null || radius <= 0) return;
  const corners = isHorizontal(panelSchema.type) ? [0, radius, radius, 0] : [radius, radius, 0, 0];
  const bars = dataSeriesOf(options).filter((s) => s.type === "bar");
  const topOfStack = new Map<string, any>();
  for (const series of bars) if (series.stack) topOfStack.set(String(series.stack), series);
  for (const series of bars) {
    if (series.stack && topOfStack.get(String(series.stack)) !== series) continue;
    series.itemStyle = { ...series.itemStyle, borderRadius: corners };
  }
};

const markAreaValue = (value: unknown, axis: any): unknown => {
  const type = asArray(axis)[0]?.type;
  const numeric = toNumber(value);
  if (type === "value" || type === "log") return numeric;
  if (type === "time") return numeric ?? value;
  return value;
};

const applyMarkAreas = (options: any, panelSchema: any) => {
  const areas = asArray(panelSchema?.config?.mark_area).filter(
    (area: any) =>
      area && (area.axis === "x" || area.axis === "y") && isSet(area.from) && isSet(area.to),
  );
  if (!areas.length || !Array.isArray(options?.series)) return;
  const data = areas.map((area: any) => {
    const key = area.axis === "y" ? "yAxis" : "xAxis";
    const from = markAreaValue(area.from, options[key]);
    const to = markAreaValue(area.to, options[key]);
    return [
      {
        name: area.name ?? "",
        [key]: from,
        ...(area.color ? { itemStyle: { color: area.color, opacity: MARK_AREA_OPACITY } } : {}),
      },
      { [key]: to },
    ];
  });
  // A nameless helper series keeps the bands out of the legend and visible when a series is toggled off.
  options.series.push({
    type: "line",
    data: [],
    silent: true,
    tooltip: { show: false },
    markArea: {
      silent: true,
      itemStyle: { color: chartColor("--color-chart-series-6"), opacity: MARK_AREA_OPACITY },
      label: { show: true, position: "insideTop", color: chartColor("--color-text-secondary") },
      data,
    },
  });
};

const TOOLTIP_ORDER: Record<string, string> = {
  asc: "valueAsc",
  desc: "valueDesc",
  none: "seriesAsc",
};

const applyTooltipMode = (options: any, panelSchema: any) => {
  const tooltip = options?.tooltip;
  if (!tooltip || Array.isArray(tooltip)) return;
  const config = panelSchema?.config ?? {};
  if (TOOLTIP_ORDER[config.tooltip_sort]) tooltip.order = TOOLTIP_ORDER[config.tooltip_sort];
  if (config.tooltip_mode === "hidden") {
    tooltip.show = false;
    return;
  }
  if (config.tooltip_mode === "all") tooltip.trigger = "axis";
  if (config.tooltip_mode !== "single") return;
  tooltip.trigger = "item";
  const formatter = tooltip.formatter;
  // Every axis formatter reads a row list; an item tooltip hands it a single row.
  if (typeof formatter === "function") {
    tooltip.formatter = (params: any, ...rest: any[]) =>
      formatter(Array.isArray(params) ? params : [params], ...rest);
  }
};

/** Applies the panel-level cartesian settings to converted ECharts options; every setting is a no-op while its key is absent. */
export const applyCartesianOptions = (options: any, panelSchema: any): void => {
  if (!options || !CARTESIAN_CHART_TYPES.has(panelSchema?.type)) return;
  if (!Array.isArray(options.series)) return;
  const lookup = createSeriesOverrideLookup(panelSchema?.config);
  applyScatterEncoding(options, panelSchema);
  applySortOrder(options, panelSchema);
  applyConnectNullsThreshold(options, panelSchema);
  applyPercentStack(options, panelSchema, lookup);
  applyLogScale(options, panelSchema);
  applySoftRange(options, panelSchema);
  applyAxisPlacement(options, panelSchema, lookup);
  applyNegativeAxisLabels(options, panelSchema, lookup);
  applyValueAxisLabel(options, panelSchema);
  applyLineStyle(options, panelSchema);
  applyBarRadius(options, panelSchema);
  applyMarkAreas(options, panelSchema);
  applyTooltipMode(options, panelSchema);
};
