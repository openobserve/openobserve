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

import { format as echartsFormat } from "echarts/core";
import { gt, raw } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { addCommasToNumber } from "@/utils/formatters";
import { formatAxisTickValue } from "./axisTickFormat";
import { getDataValue } from "./aliasUtils";
import { getGridLineStyle, getSeriesColor } from "./colorPalette";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { getFieldLabel } from "./fieldLabel";
import { BOXPLOT_STATS, boxplotStatAlias, type BoxplotStatKey } from "./boxplotStats";
import { parseTimestampValue } from "./tableConfigUtils";
import { echartsPaletteColor } from "./thresholds";

export const BOXPLOT_WHISKERS = ["minmax", "iqr"] as const;
export const DEFAULT_BOXPLOT_WHISKER = "minmax";
// Tukey fences: a value further than this many interquartile ranges past a quartile is an outlier.
const IQR_FENCE = 1.5;
const LABEL_CHAR_WIDTH = 7;
// Room the y-axis labels and grid padding take from the plot width.
const Y_AXIS_ALLOWANCE = 80;
const CROWDED_ROTATION = 45;
const CROWDED_WIDTH = 120;
const FALLBACK_PANEL_WIDTH = 800;
const TIME_BUCKET_FUNCTIONS = new Set(["histogram", "date_bin"]);

/** Five-number summary of one category; outliers are only split off in iqr mode. */
export interface BoxStats {
  low: number;
  q1: number;
  median: number;
  q3: number;
  high: number;
  count: number;
  outliers: number[];
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** Linear-interpolated quantile of sorted values, the same method as numpy's default. */
export const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

/** Quartiles and whiskers of the values; iqr whiskers stop at the last value inside the fences. */
export const boxStats = (values: number[], whisker: string): BoxStats | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  if (whisker !== "iqr") {
    return {
      low: sorted[0],
      q1,
      median,
      q3,
      high: sorted[sorted.length - 1],
      count: sorted.length,
      outliers: [],
    };
  }
  const spread = (q3 - q1) * IQR_FENCE;
  const inside = sorted.filter((value) => value >= q1 - spread && value <= q3 + spread);
  return {
    low: inside[0] ?? q1,
    q1,
    median,
    q3,
    high: inside[inside.length - 1] ?? q3,
    count: sorted.length,
    outliers: sorted.filter((value) => value < q1 - spread || value > q3 + spread),
  };
};

interface BoxGroup {
  name: string;
  values: number[];
  summary?: Record<BoxplotStatKey, number>;
}

const byName = (a: BoxGroup, b: BoxGroup) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

/** The SQL-computed summary of a builder row, or null when the row carries raw values instead. */
const rowSummary = (row: any, alias: string): Record<BoxplotStatKey, number> | null => {
  const entries = BOXPLOT_STATS.map(
    (stat) =>
      [stat.key, toNumber(getDataValue(row, boxplotStatAlias(alias, stat.column)))] as const,
  );
  if (entries.some(([, value]) => value === null)) return null;
  return Object.fromEntries(entries) as Record<BoxplotStatKey, number>;
};

/** Raw y values (or a builder query's per-category summary) per x value of query 1; without an x field everything lands in one box named after the y field. */
export const boxplotGroups = (panelSchema: any, data: any[], timezone = "UTC"): BoxGroup[] => {
  const groups = new Map<string, BoxGroup>();
  // One query per box plot: boxes from several queries would collide on shared category names.
  const query = panelSchema?.queries?.[0];
  const rows = data?.[0];
  const field = query?.fields?.y?.[0];
  const category = query?.fields?.x?.[0];
  if (!Array.isArray(rows) || !field || query?.config?.hide) return [];
  const label = getFieldLabel(field, panelSchema?.config, query?.customQuery) || field?.alias || "";
  const isTimeBucket = TIME_BUCKET_FUNCTIONS.has(category?.functionName);
  const categoryName = (value: unknown) => {
    if (isTimeBucket) return parseTimestampValue(value, timezone) ?? String(value ?? "");
    return String(value ?? "");
  };
  rows.forEach((row: any) => {
    const name = category ? categoryName(getDataValue(row, category.alias)) : label;
    const summary = query?.customQuery ? null : rowSummary(row, field.alias);
    const value = summary ? null : toNumber(getDataValue(row, field.alias));
    if (!summary && value === null) return;
    if (!groups.has(name)) groups.set(name, { name, values: [] });
    const group = groups.get(name)!;
    if (summary) group.summary ??= summary;
    else group.values.push(value!);
  });
  return [...groups.values()].sort(byName);
};

/** Box from a builder query's SQL summary; the raw values never reach the browser, so iqr whiskers stop at the fences and no outliers are drawn. */
export const summaryBoxStats = (
  summary: Record<BoxplotStatKey, number>,
  whisker: string,
): BoxStats => {
  const { low, q1, median, q3, high, count } = summary;
  if (whisker !== "iqr") return { low, q1, median, q3, high, count, outliers: [] };
  const spread = (q3 - q1) * IQR_FENCE;
  return {
    low: Math.max(low, q1 - spread),
    q1,
    median,
    q3,
    high: Math.min(high, q3 + spread),
    count,
    outliers: [],
  };
};

const seriesName = (panelSchema: any): string => {
  const query = panelSchema?.queries?.[0];
  const field = query?.fields?.y?.[0];
  return getFieldLabel(field, panelSchema?.config, query?.customQuery) || field?.alias || "";
};

/** Shows every category; crowded labels tilt and truncate, unless the panel sets its own rotation or width. */
export const categoryLabelLayout = (names: string[], panelWidth: number, config: any) => {
  const slot = Math.max(panelWidth - Y_AXIS_ALLOWANCE, 40) / Math.max(names.length, 1);
  const longest = Math.max(0, ...names.map((name) => String(name).length)) * LABEL_CHAR_WIDTH;
  const crowded = longest + 8 > slot;
  const rotate = Number(config?.axis_label_rotate) || (crowded ? CROWDED_ROTATION : 0);
  const width = Number(config?.axis_label_truncate_width) || (crowded ? CROWDED_WIDTH : undefined);
  return { interval: 0, rotate, width, overflow: "truncate" as const };
};

/** Converts SQL rows into a box plot: one box per x value, from the builder's per-category summary or a custom query's raw values. */
export const convertBoxplotData = (
  panelSchema: any,
  data: any,
  store: any,
  chartPanelRef?: any,
) => {
  const config = panelSchema?.config ?? {};
  const whisker = config.boxplot_whisker === "iqr" ? "iqr" : DEFAULT_BOXPLOT_WHISKER;
  const groups = boxplotGroups(
    panelSchema,
    Array.isArray(data) ? data : [],
    store?.state?.timezone,
  );
  const stats = groups.map((group) =>
    group.summary ? summaryBoxStats(group.summary, whisker) : boxStats(group.values, whisker)!,
  );
  if (!stats.length) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  const theme = store?.state?.theme;
  const name = seriesName(panelSchema);
  const color =
    getSeriesColor(
      config.color ?? null,
      name,
      [],
      0,
      0,
      theme,
      config.color?.colorBySeries,
      config,
    ) ?? echartsPaletteColor(0);
  const format = (value: unknown) =>
    formatUnitValue(getUnitValue(value, config.unit, config.unit_custom, config.decimals));
  const lowLabel =
    whisker === "iqr"
      ? gt("dashboard.utils.boxplotLowerWhisker")
      : gt("dashboard.utils.boxplotMin");
  const highLabel =
    whisker === "iqr"
      ? gt("dashboard.utils.boxplotUpperWhisker")
      : gt("dashboard.utils.boxplotMax");
  const boxTooltip = (index: number) => {
    const box = stats[index];
    const rows: [string, string][] = [
      [highLabel, format(box.high)],
      [raw("Q3"), format(box.q3)],
      [gt("dashboard.utils.boxplotMedian"), format(box.median)],
      [raw("Q1"), format(box.q1)],
      [lowLabel, format(box.low)],
      [gt("dashboard.utils.boxplotSamples"), addCommasToNumber(box.count)],
    ];
    return [
      `<strong>${escapeHtml(groups[index].name)}</strong>`,
      ...rows.map(([label, value]) => `${escapeHtml(label)}: ${escapeHtml(value)}`),
    ].join("<br/>");
  };

  const series: any[] = [
    {
      type: "boxplot",
      name,
      itemStyle: {
        color: chartColor("--color-surface-base"),
        borderColor: color,
        borderWidth: 1.5,
      },
      emphasis: { itemStyle: { borderWidth: 2 } },
      data: stats.map((box) => [box.low, box.q1, box.median, box.q3, box.high]),
    },
  ];
  const outliers = stats.flatMap((box, index) => box.outliers.map((value) => [index, value]));
  if (outliers.length) {
    series.push({
      type: "scatter",
      name: gt("dashboard.utils.boxplotOutlier"),
      symbolSize: 6,
      itemStyle: { color, opacity: 0.7 },
      data: outliers,
    });
  }

  const options = {
    backgroundColor: "transparent",
    grid: { containLabel: true, left: 8, right: 16, top: 16, bottom: 8 },
    tooltip: {
      show: true,
      trigger: "item",
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      formatter: (params: any) => {
        if (params?.seriesType === "boxplot") return boxTooltip(params.dataIndex);
        const [index, value] = params?.value ?? [];
        return `${echartsFormat.getTooltipMarker(params?.color)}${escapeHtml(groups[index]?.name ?? "")} · ${escapeHtml(params?.seriesName ?? "")}: <strong>${escapeHtml(format(value))}</strong>`;
      },
    },
    xAxis: {
      type: "category",
      data: groups.map((group) => group.name),
      boundaryGap: true,
      axisLabel: {
        ...categoryLabelLayout(
          groups.map((group) => group.name),
          chartPanelRef?.value?.offsetWidth || FALLBACK_PANEL_WIDTH,
          config,
        ),
        color: chartColor("--color-text-secondary"),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: {
        color: chartColor("--color-text-secondary"),
        formatter: (value: number) =>
          formatAxisTickValue(value, config.unit, config.unit_custom, config.decimals),
      },
      splitLine: {
        show: config.show_gridlines !== false,
        lineStyle: getGridLineStyle(theme),
      },
    },
    series,
  };
  return { options, extras: { panelId: panelSchema?.id } };
};

/** Drilldown series variables of a box (its category and median) or an outlier point (its category and value). */
export const boxplotDrilldownSeries = (options: any, params: any) => {
  const categories: unknown[] = options?.xAxis?.data ?? [];
  if (params?.seriesType === "boxplot") {
    const category = categories[params?.dataIndex];
    const box = options?.series?.[0]?.data?.[params?.dataIndex] ?? [];
    return { __name: category, __value: box[2], __axisValue: category };
  }
  const category = categories[params?.data?.[0]];
  return { __name: category, __value: params?.data?.[1], __axisValue: category };
};
