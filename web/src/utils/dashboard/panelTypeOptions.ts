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

export const GAUGE_STYLES = ["semi", "arc", "circle"] as const;
export const PIE_LABEL_CONTENTS = ["name", "value", "percent"] as const;
export const STATE_VALUE_ALIGNS: readonly string[] = ["left", "center", "right"];

const GAUGE_ANGLES: Record<string, { startAngle: number; endAngle: number }> = {
  arc: { startAngle: 225, endAngle: -45 },
  circle: { startAngle: 90, endAngle: -270 },
};

const SEGMENT_GAP_WIDTH = 3;
const MAX_GAUGE_SEGMENTS = 100;

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
  item.detail = { ...item.detail, formatter: () => text };
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
  return (params: any) =>
    contents
      .map((content) => {
        if (content === "name") return String(lookup.displayName(params?.name ?? ""));
        if (content === "value") return lookup.formatValue(params?.value, params?.name);
        return `${params?.percent ?? 0}%`;
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

/** Applies the pie and donut slice settings to converted options; a no-op while every key is absent. */
export const applyPieOptions = (options: any, panelSchema: any): void => {
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
  });
};

const cellValue = (point: any): number | null => {
  const tuple = Array.isArray(point) ? point : point?.value;
  return Array.isArray(tuple) ? toNumber(tuple[2]) : null;
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
};

/** Applies the metric-family panel settings that live on the final options of one chart type. */
export const applyPanelTypeOptions = (options: any, panelSchema: any): void => {
  if (!options) return;
  applyGaugeOptions(options, panelSchema);
  applyPieOptions(options, panelSchema);
  applyHeatmapOptions(options, panelSchema);
};
