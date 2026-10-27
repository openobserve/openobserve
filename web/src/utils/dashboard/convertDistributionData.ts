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
import { gt } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { addCommasToNumber } from "@/utils/formatters";
import { formatAxisTickValue } from "./axisTickFormat";
import { getDataValue } from "./aliasUtils";
import { getGridLineStyle, getSeriesColor } from "./colorPalette";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { getFieldLabel } from "./fieldLabel";
import { echartsPaletteColor } from "./thresholds";

export const DISTRIBUTION_DEFAULT_BUCKETS = 30;
export const DISTRIBUTION_MAX_BUCKETS = 1000;

/** Bucket layout: bucket k covers [start + k·size, start + (k+1)·size). */
export interface DistributionBuckets {
  start: number;
  size: number;
  count: number;
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positive = (value: unknown): number | null => {
  const numeric = toNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
};

/** The smallest 1, 2, 2.5 or 5 times a power of ten at or above `raw`, so bucket edges read as round numbers. */
export const niceBucketSize = (raw: number): number => {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const factor = [1, 2, 2.5, 5, 10].find((step) => step * power >= raw * (1 - 1e-9)) ?? 10;
  return factor * power;
};

/** Bucket layout for the values: a set bucket size wins over the bucket count, and the offset shifts every edge. */
export const distributionBuckets = (values: number[], config: any): DistributionBuckets | null => {
  if (!values.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const offset = toNumber(config?.distribution_bucket_offset) ?? 0;
  const requested = Math.round(positive(config?.distribution_bucket_count) ?? 0);
  const wanted = Math.min(DISTRIBUTION_MAX_BUCKETS, requested || DISTRIBUTION_DEFAULT_BUCKETS);
  const size =
    positive(config?.distribution_bucket_size) ??
    niceBucketSize(max > min ? (max - min) / wanted : Math.abs(max) || 1);
  const start = Math.floor((min - offset) / size) * size + offset;
  const count = Math.min(DISTRIBUTION_MAX_BUCKETS, Math.floor((max - start) / size) + 1);
  return { start, size, count };
};

/** Counts per bucket; a value past the last bucket (only when the cap cut the range) lands in the last one. */
export const bucketCounts = (values: number[], buckets: DistributionBuckets): number[] => {
  const counts = new Array(buckets.count).fill(0);
  for (const value of values) {
    const index = Math.floor((value - buckets.start) / buckets.size);
    counts[Math.max(0, Math.min(buckets.count - 1, index))] += 1;
  }
  return counts;
};

interface ValueGroup {
  name: string;
  values: number[];
}

/** Numeric y values per series: one per breakdown value, else per y field; several y fields with a breakdown name both. */
const valueGroups = (panelSchema: any, data: any[]): ValueGroup[] => {
  const groups = new Map<string, ValueGroup>();
  (panelSchema?.queries ?? []).forEach((query: any, index: number) => {
    const rows = data?.[index];
    if (!Array.isArray(rows) || query?.config?.hide) return;
    const yFields: any[] = query?.fields?.y ?? [];
    const breakdown = query?.fields?.breakdown?.[0];
    yFields.forEach((field) => {
      const label =
        getFieldLabel(field, panelSchema?.config, query?.customQuery) || field?.alias || "";
      rows.forEach((row: any) => {
        const value = toNumber(getDataValue(row, field?.alias));
        if (value === null) return;
        const group = breakdown ? String(getDataValue(row, breakdown.alias) ?? "") : null;
        const name = group === null ? label : yFields.length > 1 ? `${group} · ${label}` : group;
        if (!groups.has(name)) groups.set(name, { name, values: [] });
        groups.get(name)!.values.push(value);
      });
    });
  });
  return [...groups.values()];
};

/** Converts SQL rows into a histogram of the y values: stacked bars per bucket, one series per group. */
// A plain number's decimals are a ceiling on bucket edges, which are mostly round, so zero fractions are dropped.
const trimZeroFraction = (text: string) =>
  text.replace(/^(-?\d+)\.0+$/, "$1").replace(/^(-?\d+\.\d*?)0+$/, "$1");

export const convertDistributionData = (panelSchema: any, data: any, store: any) => {
  const config = panelSchema?.config ?? {};
  const groups = valueGroups(panelSchema, Array.isArray(data) ? data : []);
  const buckets = distributionBuckets(
    groups.flatMap((group) => group.values),
    config,
  );
  if (!buckets) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  const theme = store?.state?.theme;
  const format = (value: number) =>
    formatUnitValue(getUnitValue(value, config.unit, config.unit_custom, config.decimals));
  const range = (index: number) => {
    const lower = buckets.start + index * buckets.size;
    return `${format(lower)} – ${format(lower + buckets.size)}`;
  };
  const series = groups.map((group, index) => {
    const counts = bucketCounts(group.values, buckets);
    const color =
      getSeriesColor(
        config.color ?? null,
        group.name,
        [],
        0,
        0,
        theme,
        config.color?.colorBySeries,
        config,
      ) ?? echartsPaletteColor(index);
    return {
      type: "bar",
      name: group.name,
      stack: "distribution",
      barCategoryGap: "4%",
      itemStyle: { color },
      emphasis: { focus: "series" },
      data: counts.map((count, bucket) => [buckets.start + (bucket + 0.5) * buckets.size, count]),
    };
  });

  const showLegend = config.show_legends !== false && series.length > 1;
  const options = {
    backgroundColor: "transparent",
    grid: { containLabel: true, left: 8, right: 16, top: 16, bottom: showLegend ? 32 : 8 },
    tooltip: {
      show: true,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      formatter: (params: any) => {
        const list = (Array.isArray(params) ? params : [params]).filter(
          (item: any) => Number(item?.value?.[1]) > 0,
        );
        const bucket = Array.isArray(params) ? params[0]?.dataIndex : params?.dataIndex;
        if (bucket === undefined) return "";
        const lines = list.map(
          (item: any) =>
            `${echartsFormat.getTooltipMarker(item.color)}${escapeHtml(item.seriesName)}: ${escapeHtml(addCommasToNumber(item.value[1]))}`,
        );
        return [`<strong>${escapeHtml(range(bucket))}</strong>`, ...lines].join("<br/>");
      },
    },
    legend: {
      show: showLegend,
      type: "scroll",
      bottom: 0,
      left: "center",
      textStyle: { color: chartColor("--color-text-secondary") },
    },
    xAxis: {
      type: "value",
      min: buckets.start,
      max: buckets.start + buckets.count * buckets.size,
      axisLabel: {
        hideOverlap: true,
        color: chartColor("--color-text-secondary"),
        formatter: (value: number) => {
          const text = formatAxisTickValue(value, config.unit, config.unit_custom, config.decimals);
          return !config.unit || config.unit === "default" ? trimZeroFraction(text) : text;
        },
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: gt("dashboard.utils.distributionCount"),
      nameTextStyle: { color: chartColor("--color-text-secondary") },
      minInterval: 1,
      axisLabel: { color: chartColor("--color-text-secondary") },
      splitLine: {
        show: config.show_gridlines !== false,
        lineStyle: getGridLineStyle(theme),
      },
    },
    series,
  };
  return { options, extras: { panelId: panelSchema?.id } };
};
