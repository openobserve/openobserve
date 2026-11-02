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

import { gt } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { createSeriesOverrideLookup } from "./seriesOverrides";
import { echartsPaletteColor } from "./thresholds";
import { labelColorOn } from "./chartLabelContrast";
import { calculateWidthText } from "./chartDimensionUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { pieLegendPercentDecimals, piePercentPrecision } from "./legendConfiguration";

export const GAUGE_STYLES = ["semi", "arc", "circle"] as const;
export const DEFAULT_GAUGE_STYLE = "semi";
export const PIE_LABEL_CONTENTS = ["name", "value", "percent"] as const;
export const STATE_VALUE_ALIGNS: readonly string[] = ["left", "center", "right"];
export const DEFAULT_STATE_VALUE_ALIGN = "left";

const GAUGE_ANGLES: Record<string, { startAngle: number; endAngle: number }> = {
  arc: { startAngle: 225, endAngle: -45 },
  circle: { startAngle: 90, endAngle: -270 },
};

const SEGMENT_GAP_WIDTH = 3;
const OUTSIDE_LABEL_RADIUS_SHARE = 0.72;
const MAX_GAUGE_SEGMENTS = 100;
// ECharts' outside-label line segments (length + length2) and the bleed margin it keeps from the panel edge.
const PIE_LABEL_LINE = 12;
const PIE_LABEL_BLEED = 10;
const PIE_LABEL_FONT_SIZE = 12;
const PIE_LABEL_INSET = 4;

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const seriesOfType = (options: any, types: string[]): any[] =>
  (Array.isArray(options?.series) ? options.series : []).filter(
    (series: any) => series && types.includes(series.type),
  );

const gaugeFraction = (value: number, min: number, max: number) =>
  max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

const applyGaugeNeutral = (gauge: any, neutral: number, index: number) => {
  const item = gauge?.data?.[0];
  const value = toNumber(item?.value);
  if (value === null) return;
  const min = toNumber(gauge.min) ?? 0;
  const max = toNumber(gauge.max) ?? 100;
  const from = gaugeFraction(Math.min(neutral, value), min, max);
  const to = gaugeFraction(Math.max(neutral, value), min, max);
  const track = chartColor("--color-border-subtle");
  const fill = item?.itemStyle?.color ?? echartsPaletteColor(index);
  gauge.progress = { ...gauge.progress, show: false };
  gauge.axisLine = {
    ...gauge.axisLine,
    lineStyle: {
      ...gauge.axisLine?.lineStyle,
      color: [
        [from, track],
        [to, fill],
        [1, track],
      ],
    },
  };
};

// The gaps sit on a silent overlay gauge, because a gauge draws its progress bar over its own split lines.
const gaugeSegmentOverlay = (gauge: any, segments: number) => {
  const width = parseFloat(gauge?.axisLine?.lineStyle?.width) || 10;
  return {
    type: "gauge",
    silent: true,
    tooltip: { show: false },
    z: (toNumber(gauge.z) ?? 2) + 1,
    center: gauge.center,
    radius: gauge.radius,
    startAngle: gauge.startAngle,
    endAngle: gauge.endAngle,
    min: gauge.min,
    max: gauge.max,
    splitNumber: segments,
    progress: { show: false },
    pointer: { show: false },
    anchor: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false },
    title: { show: false },
    detail: { show: false },
    axisLine: { show: true, lineStyle: { width, color: [[1, "transparent"]] } },
    splitLine: {
      show: true,
      distance: -width,
      length: width,
      lineStyle: { width: SEGMENT_GAP_WIDTH, color: chartColor("--color-surface-base") },
    },
    data: [],
  };
};

const isMissingValue = (value: unknown) =>
  value === null || value === undefined || value === "" || String(value) === "NaN";

const applyGaugeNoValue = (gauge: any, text: string) => {
  const item = gauge?.data?.[0];
  if (!item || !isMissingValue(item.value)) return;
  const base = item.detail?.formatter;
  // A value mapping's text outranks the panel's no-value text; only the bare "-" is replaced.
  const shown = typeof base === "function" ? base(null) : "-";
  const formatter = () => (shown === "-" || shown === "" ? text : shown);
  item.detail = { ...item.detail, formatter };
};

/** Applies the gauge shape settings to converted gauge options; a no-op while every key is absent. */
export const applyGaugeOptions = (options: any, panelSchema: any): void => {
  if (panelSchema?.type !== "gauge") return;
  const config = panelSchema?.config ?? {};
  const angles = GAUGE_ANGLES[config.gauge_style];
  const segments = toNumber(config.gauge_segments);
  const neutral = toNumber(config.gauge_neutral);
  const noValue = String(config.no_value_replacement ?? "");
  const overlays: any[] = [];
  seriesOfType(options, ["gauge"]).forEach((gauge: any, index: number) => {
    if (!Array.isArray(gauge.data) || gauge.data.length === 0) return;
    if (noValue !== "") applyGaugeNoValue(gauge, noValue);
    if (angles) Object.assign(gauge, angles);
    // Rounding the track would round every threshold band end, so only the bar gets caps.
    if (config.gauge_round_cap === true) gauge.progress = { ...gauge.progress, roundCap: true };
    if (neutral !== null) applyGaugeNeutral(gauge, neutral, index);
    if (segments !== null && segments >= 2) {
      overlays.push(gaugeSegmentOverlay(gauge, Math.min(MAX_GAUGE_SEGMENTS, Math.round(segments))));
    }
  });
  if (overlays.length) options.series.push(...overlays);
};

const pieLabelFormatter = (contents: string[], panelSchema: any) => {
  const lookup = createSeriesOverrideLookup(panelSchema?.config);
  const panelDecimals = piePercentPrecision(panelSchema?.config);
  // ECharts' percent trims trailing zeros, which would disagree with the legend.
  const percentText = (params: any) => {
    const overrideDecimals = lookup.get(params?.name)?.decimals;
    const decimals =
      overrideDecimals === undefined ? panelDecimals : pieLegendPercentDecimals(overrideDecimals);
    return `${Number(params?.percent ?? 0).toFixed(decimals)}%`;
  };
  return (params: any) =>
    contents
      .map((content) => {
        if (content === "name") return String(lookup.displayName(params?.name ?? ""));
        if (content === "value") return lookup.formatValue(params?.value, params?.name);
        return percentText(params);
      })
      .join(" · ");
};

const bucketSmallSlices = (data: any[], thresholdPercent: number): any[] => {
  const valueOf = (item: any) => Number(item?.value) || 0;
  const total = data.reduce((sum, item) => sum + valueOf(item), 0);
  if (total <= 0) return data;
  const isSmall = (item: any) => (valueOf(item) / total) * 100 < thresholdPercent;
  const small = data.filter(isSmall);
  if (small.length < 2) return data;
  return [
    ...data.filter((item) => !isSmall(item)),
    {
      name: gt("dashboard.utils.pieOtherSlice"),
      value: small.reduce((sum, item) => sum + valueOf(item), 0),
      _isOtherSlice: true,
    },
  ];
};

const sortSlices = (data: any[], order: string): any[] => {
  const direction = order === "asc" ? 1 : -1;
  const other = data.filter((item) => item?._isOtherSlice);
  const rest = data
    .filter((item) => !item?._isOtherSlice)
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        direction * ((Number(a.item?.value) || 0) - (Number(b.item?.value) || 0)) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
  return [...rest, ...other];
};

const applyDonutInnerRadius = (series: any, innerPercent: number) => {
  if (!Array.isArray(series.radius) || series.radius.length < 2) return;
  const outer = parseFloat(series.radius[1]);
  if (!Number.isFinite(outer)) return;
  const share = Math.min(95, Math.max(0, innerPercent)) / 100;
  series.radius = [`${Number((outer * share).toFixed(2))}%`, series.radius[1]];
};

const sliceColor = (series: any, item: any, index: number): unknown => {
  if (typeof item?.itemStyle?.color === "string") return item.itemStyle.color;
  const color = series?.itemStyle?.color;
  if (typeof color === "function") {
    return (
      color({ name: item?.name, value: item?.value, data: item, dataIndex: index }) ??
      echartsPaletteColor(index)
    );
  }
  return typeof color === "string" ? color : echartsPaletteColor(index);
};

const shrinkRadius = (radius: unknown, share: number): unknown => {
  const scale = (value: unknown) => {
    const percent = parseFloat(String(value));
    return String(value).trim().endsWith("%") && Number.isFinite(percent)
      ? `${Number((percent * share).toFixed(2))}%`
      : value;
  };
  return Array.isArray(radius) ? radius.map(scale) : scale(radius);
};

interface PanelSize {
  width: number;
  height: number;
}

const toPixels = (value: unknown, base: number, fallback: number) => {
  const text = String(value ?? "").trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return fallback;
  return text.endsWith("%") ? (number / 100) * base : number;
};

/** The pie's centre and radii in pixels, resolved the way ECharts does against the whole panel. */
const pieGeometry = (series: any, panel: PanelSize) => {
  const [radiusInner, radiusOuter] = Array.isArray(series.radius)
    ? series.radius
    : [0, series.radius ?? "75%"];
  const half = Math.min(panel.width, panel.height) / 2;
  const center = Array.isArray(series.center) ? series.center : ["50%", "50%"];
  return {
    cx: toPixels(center[0], panel.width, panel.width / 2),
    inner: toPixels(radiusInner, half, 0),
    outer: toPixels(radiusOuter, half, half),
  };
};

const sliceShares = (data: any[]) => {
  const values = data.map((item) => Math.max(0, Number(item?.value) || 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  return values.map((value) => value / total);
};

const labelWidth = (text: string, fontSize: number) => calculateWidthText(text, `${fontSize}px`);

/** True when every outside label fits whole between its label line and the panel edge on its side, so ECharts never cuts one. */
const outsideLabelsFit = (
  series: any,
  contents: readonly string[],
  panel: PanelSize,
  panelSchema: any,
) => {
  const { cx, outer } = pieGeometry(
    { ...series, radius: shrinkRadius(series.radius, OUTSIDE_LABEL_RADIUS_SHARE) },
    panel,
  );
  const fontSize = Number(series.label?.fontSize) || PIE_LABEL_FONT_SIZE;
  const format = pieLabelFormatter([...contents], panelSchema);
  const precision = Number(series.percentPrecision ?? 2);
  const roomRight = panel.width - (cx + outer + PIE_LABEL_LINE) - PIE_LABEL_BLEED;
  const roomLeft = cx - outer - PIE_LABEL_LINE - PIE_LABEL_BLEED;
  let start = 0;
  return sliceShares(series.data).every((share, index) => {
    const middle = Math.PI / 2 - 2 * Math.PI * (start + share / 2);
    start += share;
    const item = series.data[index];
    const text = format({
      name: item?.name,
      value: item?.value,
      percent: (share * 100).toFixed(precision),
    });
    return labelWidth(String(text), fontSize) <= (Math.cos(middle) >= 0 ? roomRight : roomLeft);
  });
};

const percentLabel = (series: any, item: any, index: number) => ({
  ...item?.label,
  color: labelColorOn(sliceColor(series, item, index)),
});

/** Percent labels inside each slice, hidden on slices too thin to hold the text. */
const placePercentInside = (series: any, panel: PanelSize | null, panelSchema: any) => {
  const formatter = pieLabelFormatter(["percent"], panelSchema);
  series.label = { ...series.label, position: "inside", formatter };
  const shares = sliceShares(series.data);
  const geometry = panel ? pieGeometry(series, panel) : null;
  const fontSize = Number(series.label?.fontSize) || PIE_LABEL_FONT_SIZE;
  const precision = Number(series.percentPrecision ?? 2);
  series.data = series.data.map((item: any, index: number) => {
    const label = percentLabel(series, item, index);
    if (!geometry) return { ...item, label };
    const middle = (geometry.inner + geometry.outer) / 2;
    const arc = shares[index] * 2 * Math.PI * middle;
    const text = `${(shares[index] * 100).toFixed(precision)}%`;
    const ring = geometry.outer - geometry.inner;
    const fits =
      arc >= labelWidth(text, fontSize) + PIE_LABEL_INSET && ring >= fontSize + PIE_LABEL_INSET;
    return { ...item, label: fits ? label : { ...label, show: false } };
  });
};

// A name or value outgrows the ring, so those labels go outside, where only the panel background is behind them.
const placePieLabels = (
  series: any,
  contents: readonly string[],
  panel: PanelSize | null,
  panelSchema: any,
) => {
  const inside = series.label?.position === "inside";
  if (inside && contents.every((content) => content === "percent")) {
    series.data = series.data.map((item: any, index: number) => ({
      ...item,
      label: percentLabel(series, item, index),
    }));
    return;
  }
  // Labels too long for the room beside the pie fall back to percents inside, leaving names to the legend and tooltip.
  if (panel && !outsideLabelsFit(series, contents, panel, panelSchema)) {
    placePercentInside(series, panel, panelSchema);
    return;
  }
  series.label = {
    ...series.label,
    position: "outside",
    color: chartColor("--color-text-body"),
    textBorderColor: "transparent",
    overflow: "truncate",
  };
  series.labelLine = { ...series.labelLine, show: true, length: 6, length2: 6 };
  series.labelLayout = { ...series.labelLayout, hideOverlap: true };
  // ECharts truncates outside labels at the panel edge only while it lays them out to avoid overlap.
  series.avoidLabelOverlap = true;
  if (inside) series.radius = shrinkRadius(series.radius, OUTSIDE_LABEL_RADIUS_SHARE);
};

/** Applies the pie and donut slice settings to converted options; a no-op while every key is absent. */
export const applyPieOptions = (
  options: any,
  panelSchema: any,
  panel: PanelSize | null = null,
): void => {
  if (panelSchema?.type !== "pie" && panelSchema?.type !== "donut") return;
  const config = panelSchema?.config ?? {};
  const contents = Array.isArray(config.pie_label_content)
    ? PIE_LABEL_CONTENTS.filter((content) => config.pie_label_content.includes(content))
    : null;
  const threshold = toNumber(config.pie_other_threshold);
  const innerRadius = toNumber(config.donut_inner_radius);
  const order = config.sort_order;
  seriesOfType(options, ["pie"]).forEach((series: any) => {
    if (contents) {
      series.label =
        contents.length === 0
          ? { ...series.label, show: false }
          : { ...series.label, show: true, formatter: pieLabelFormatter(contents, panelSchema) };
    }
    if (!Array.isArray(series.data)) return;
    if (threshold !== null && threshold > 0)
      series.data = bucketSmallSlices(series.data, threshold);
    if (order === "asc" || order === "desc") series.data = sortSlices(series.data, order);
    if (panelSchema.type === "donut" && innerRadius !== null) {
      applyDonutInnerRadius(series, innerRadius);
    }
    if (contents?.length) placePieLabels(series, contents, panel, panelSchema);
  });
};

const cellValue = (point: any): number | null => {
  const tuple = Array.isArray(point) ? point : point?.value;
  return Array.isArray(tuple) ? toNumber(tuple[2]) : null;
};

const NOTE_FONT_SIZE = 11;
const NOTE_ROOM = 16;

/** Adds a small caption in the chart's top-right corner and moves the plot down so the two never overlap. */
const addCornerNote = (options: any, text: string) => {
  const note = {
    type: "text",
    right: 8,
    top: 4,
    silent: true,
    z: 100,
    style: { text, fontSize: NOTE_FONT_SIZE, fill: chartColor("--color-text-secondary") },
  };
  const graphic = options.graphic;
  options.graphic = Array.isArray(graphic)
    ? [...graphic, note]
    : graphic
      ? [graphic, note]
      : [note];
  const grids = Array.isArray(options.grid) ? options.grid : options.grid ? [options.grid] : [];
  for (const grid of grids) {
    if (typeof grid?.top === "number") grid.top += NOTE_ROOM;
  }
};

/** Applies the heatmap cell settings to converted options; a no-op while every key is absent. */
export const applyHeatmapOptions = (options: any, panelSchema: any): void => {
  if (panelSchema?.type !== "heatmap") return;
  const config = panelSchema?.config ?? {};
  const gap = toNumber(config.heatmap_cell_gap);
  const hideBelow = toNumber(config.heatmap_hide_below);
  if (gap === null && hideBelow === null) return;
  seriesOfType(options, ["heatmap"]).forEach((series: any) => {
    if (gap !== null && gap >= 0) {
      series.itemStyle = {
        ...series.itemStyle,
        borderWidth: gap,
        borderColor: series.itemStyle?.borderColor ?? chartColor("--color-surface-base"),
      };
    }
    if (hideBelow !== null && Array.isArray(series.data)) {
      series.data = series.data.filter((point: any) => {
        const value = cellValue(point);
        return value === null || value >= hideBelow;
      });
    }
  });
  // Hidden cells look like missing data, so the panel says which values it left out.
  if (hideBelow !== null && seriesOfType(options, ["heatmap"]).length > 0) {
    const value = formatUnitValue(
      getUnitValue(hideBelow, config.unit, config.unit_custom, config.decimals),
    );
    addCornerNote(options, gt("dashboard.heatmapHideBelowNote", { value }));
  }
};

/** Applies the metric-family panel settings that live on the final options of one chart type. */
export const applyPanelTypeOptions = (
  options: any,
  panelSchema: any,
  chartPanelRef?: any,
): void => {
  if (!options) return;
  const width = chartPanelRef?.value?.offsetWidth;
  const height = chartPanelRef?.value?.offsetHeight;
  applyGaugeOptions(options, panelSchema);
  applyPieOptions(options, panelSchema, width && height ? { width, height } : null);
  applyHeatmapOptions(options, panelSchema);
};
