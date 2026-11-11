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
import { chartAxisTextColor, chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { addCommasToNumber } from "@/utils/formatters";
import { formatAxisTickValue } from "./axisTickFormat";
import { hitRawRowCap, rawSampleNote } from "./rawRowCap";
import { getDataValue } from "./aliasUtils";
import type { SeriesLimitInfo } from "./panelDiagnostics";
import { getGridLineStyle, getSeriesColor } from "./colorPalette";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { getFieldLabel } from "./fieldLabel";
import { echartsPaletteColor } from "./thresholds";

export const DISTRIBUTION_DEFAULT_BUCKETS = 30;
export const DISTRIBUTION_MAX_BUCKETS = 1000;
export const DISTRIBUTION_DEFAULT_OFFSET = 0;

/** Bucket layout: bucket k covers [start + k·size, start + (k+1)·size). */
export interface DistributionBuckets {
  start: number;
  size: number;
  count: number;
  /** The set bucket size, when it needed more than the bucket cap and a wider size replaced it. */
  widenedFrom?: number;
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

const EDGE_MAX_DECIMALS = 15;
// Edges carry float error relative to the layout's largest number, which this covers with room to spare.
const DISPLAY_EPSILON = 1e-14;
// A millionth of a bucket keeps set offsets exact while cutting repeating decimals such as 1.00333…m short.
const EDGE_PRECISION = 1e-6;

// Float division can land a value on an edge a hair below it, which would count it one bucket early.
const bucketIndex = (value: number, start: number, size: number) => {
  const position = (value - start) / size;
  const nearest = Math.round(position);
  const noise = (8 * Number.EPSILON * (Math.abs(value) + Math.abs(start))) / size;
  return Math.abs(position - nearest) <= noise ? nearest : Math.floor(position);
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
  if (!Number.isFinite(max - min)) return null;
  const offset = toNumber(config?.distribution_bucket_offset) ?? DISTRIBUTION_DEFAULT_OFFSET;
  const requested = Math.round(positive(config?.distribution_bucket_count) ?? 0);
  const wanted = Math.min(DISTRIBUTION_MAX_BUCKETS, requested || DISTRIBUTION_DEFAULT_BUCKETS);
  const setSize = positive(config?.distribution_bucket_size);
  const layout = (size: number) => {
    // A large offset would swamp the edges' precision, and only its remainder modulo the size matters.
    const shift = offset - bucketIndex(offset, 0, size) * size;
    const start = bucketIndex(min, shift, size) * size + shift;
    return { start, size, count: bucketIndex(max, start, size) + 1 };
  };
  const buckets = layout(
    setSize ?? niceBucketSize(max > min ? (max - min) / wanted : Math.abs(max) || 1),
  );
  // Offset alignment adds at most one bucket to the count, which is not worth halving the resolution for.
  if (setSize === null || buckets.count <= DISTRIBUTION_MAX_BUCKETS) return buckets;
  // Offset alignment can add a bucket at each end, so the range is spread over two fewer than the cap.
  const widened = layout(niceBucketSize((max - min) / (DISTRIBUTION_MAX_BUCKETS - 2)));
  return {
    ...widened,
    count: Math.min(DISTRIBUTION_MAX_BUCKETS, widened.count),
    widenedFrom: setSize,
  };
};

/** Counts per bucket; a value outside the layout lands in the nearest end bucket. */
export const bucketCounts = (values: number[], buckets: DistributionBuckets): number[] => {
  const counts = new Array(buckets.count).fill(0);
  for (const value of values) {
    const index = bucketIndex(value, buckets.start, buckets.size);
    counts[Math.max(0, Math.min(buckets.count - 1, index))] += 1;
  }
  return counts;
};

interface ValueGroup {
  name: string;
  field: number;
  /** The breakdown value, "" when empty or absent. */
  text: string;
  values: number[];
}

interface DistributionExtras {
  panelId: unknown;
  seriesLimit?: SeriesLimitInfo;
}

// An empty breakdown value still needs a legend entry, so it gets a visible name.
const breakdownName = (text: string): string =>
  text === "" ? gt("dashboard.utils.distributionEmptyBreakdown") : text;

/** Numeric y values per series: one per breakdown value, else per y field; several y fields with a breakdown name both. */
const valueGroups = (panelSchema: any, data: any[]): ValueGroup[] => {
  const groups = new Map<string, ValueGroup>();
  let fieldBase = 0;
  (panelSchema?.queries ?? []).forEach((query: any, index: number) => {
    const rows = data?.[index];
    if (!Array.isArray(rows) || query?.config?.hide) return;
    const yFields: any[] = query?.fields?.y ?? [];
    const breakdown = query?.fields?.breakdown?.[0];
    const base = fieldBase;
    fieldBase += yFields.length;
    yFields.forEach((field, fieldIndex) => {
      const label =
        getFieldLabel(field, panelSchema?.config, query?.customQuery) || field?.alias || "";
      rows.forEach((row: any) => {
        const value = toNumber(getDataValue(row, field?.alias));
        if (value === null) return;
        const text = breakdown ? String(getDataValue(row, breakdown.alias) ?? "") : null;
        const group = text === null ? null : breakdownName(text);
        const name = group === null ? label : yFields.length > 1 ? `${group} · ${label}` : group;
        if (!groups.has(name)) {
          groups.set(name, { name, field: base + fieldIndex, text: text ?? "", values: [] });
        }
        const series = groups.get(name)!;
        // A literal "(empty)" value joins the empty series, which must sort last whatever row came first.
        if (text === "") series.text = "";
        series.values.push(value);
      });
    });
  });
  // Rows arrive unordered and colors go by position, so series are sorted to keep each one's color.
  return [...groups.values()].sort(
    (a, b) =>
      a.field - b.field ||
      Number(a.text === "") - Number(b.text === "") ||
      a.text.localeCompare(b.text, undefined, { numeric: true }) ||
      (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
};

// A plain number's decimals are a ceiling on bucket edges, which are mostly round, so zero fractions are dropped.
const trimZeroFraction = (text: string) =>
  text.replace(/^(-?\d+)\.0+$/, "$1").replace(/^(-?\d+\.\d*?)0+$/, "$1");

/** Converts SQL rows into a histogram of the y values: stacked bars per bucket, one series per group. */
export const convertDistributionData = (panelSchema: any, data: any, store: any) => {
  const config = panelSchema?.config ?? {};
  const rows = Array.isArray(data) ? data : [];
  const groups = valueGroups(panelSchema, rows);
  const buckets = distributionBuckets(
    groups.flatMap((group) => group.values),
    config,
  );
  if (!buckets) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  const theme = store?.state?.theme;
  const plainUnit = !config.unit || config.unit === "default";
  // Units rescale (ms to s, B to KB), so decimals grow until the shown number is the exact edge.
  const exact = (value: number, tolerance: number, decimals: number = config.decimals ?? 2) => {
    const show = (digits: number) => getUnitValue(value, config.unit, config.unit_custom, digits);
    // Grouped text (currency, locale) does not parse, and those units never rescale the value.
    const shown = (digits: number) => {
      const parsed = Number(show(digits).value);
      return Number.isNaN(parsed) ? Number(value.toFixed(digits)) : parsed;
    };
    const target = shown(EDGE_MAX_DECIMALS + 4);
    let digits = Math.max(0, decimals);
    // The tolerance is in raw units, and the shown number is in the unit's scale (percent-1 is ×100).
    const scaled = tolerance * (value === 0 ? 1 : Math.abs(target / value));
    while (digits < EDGE_MAX_DECIMALS && Math.abs(shown(digits) - target) > scaled) {
      digits += 1;
    }
    const text = formatUnitValue(show(digits));
    return plainUnit ? trimZeroFraction(text) : text;
  };
  const edgeNoise =
    Math.max(
      Math.abs(buckets.start),
      Math.abs(buckets.start + buckets.count * buckets.size),
      Math.abs(toNumber(config.distribution_bucket_offset) ?? DISTRIBUTION_DEFAULT_OFFSET),
    ) * DISPLAY_EPSILON;
  const edge = (index: number) => {
    const value = buckets.start + index * buckets.size;
    return Math.abs(value) <= edgeNoise ? 0 : value;
  };
  const edgeTolerance = Math.max(edgeNoise, buckets.size * EDGE_PRECISION);
  const range = (index: number) =>
    `${exact(edge(index), edgeTolerance)} – ${exact(edge(index + 1), edgeTolerance)}`;
  // Name hashing can give two stacked series one color, so the default palette goes by series order.
  const byOrder = !config.color?.mode || config.color.mode === "palette-classic-by-series";
  const colorConfig = byOrder ? { mode: "palette-classic" } : config.color;
  const series = groups.map((group, index) => {
    const counts = bucketCounts(group.values, buckets);
    const color =
      getSeriesColor(
        colorConfig,
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
  const sampled = hitRawRowCap(panelSchema, rows);
  const options = {
    backgroundColor: "transparent",
    grid: {
      containLabel: true,
      left: 8,
      right: 16,
      top: 28,
      bottom: showLegend ? 32 : 8,
    },
    graphic: sampled ? [rawSampleNote()] : [],
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
        color: chartAxisTextColor(),
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
      nameTextStyle: { color: chartAxisTextColor() },
      minInterval: 1,
      axisLabel: { color: chartAxisTextColor() },
      splitLine: {
        show: config.show_gridlines !== false,
        lineStyle: getGridLineStyle(theme),
      },
    },
    series,
  };
  const extras: DistributionExtras = { panelId: panelSchema?.id };
  if (buckets.widenedFrom !== undefined) {
    extras.seriesLimit = {
      shown: buckets.count,
      total: Math.ceil(buckets.count * (buckets.size / buckets.widenedFrom)),
      cap: DISTRIBUTION_MAX_BUCKETS,
      displayCapMessage: gt("dashboard.utils.distributionBucketSizeWidened", {
        requested: exact(buckets.widenedFrom, buckets.widenedFrom * DISPLAY_EPSILON, 0),
        size: exact(buckets.size, buckets.size * DISPLAY_EPSILON, 0),
      }),
    };
  }
  return { options, extras };
};
