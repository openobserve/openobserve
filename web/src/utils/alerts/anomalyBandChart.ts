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
  ANOMALY_EVENT_ALIAS,
  ANOMALY_EXPECTED_ALIAS,
  ANOMALY_FLAGGED_ALIAS,
  ANOMALY_LOWER_ALIAS,
  ANOMALY_UPPER_ALIAS,
  ANOMALY_VALUE_ALIAS,
  ANOMALY_X_ALIAS,
} from "@/utils/alerts/anomalyChartQuery";
import { histogramKeyToMicros } from "@/utils/rum/errorIssueUtils";

/** One metric-query bucket; every reading is `null` where the bucket has none. */
export interface AnomalyBandRow {
  tsMs: number;
  value: number | null;
  flagged: number | null;
  expected: number | null;
  lower: number | null;
  upper: number | null;
  event: number | null;
}

export interface AnomalyBandLabels {
  value: string;
  range: string;
  expected: string;
  anomaly: string;
  anomalyAbove: string;
  anomalyBelow: string;
  event: string;
}

/** Resolved colour strings; ECharts cannot read a CSS variable. */
export interface AnomalyBandColors {
  value: string;
  band: string;
  anomaly: string;
  event: string;
  axis: string;
  grid: string;
}

export interface AnomalyBandWindow {
  startMs: number;
  endMs: number;
}

const BAND_STACK = "band";

const ISOLATED_SYMBOL_SIZE = 6;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Precision by magnitude, so a value and the bounds beside it read alike. */
export function formatReading(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (magnitude >= 1) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
}

function anomalyLine(row: AnomalyBandRow, labels: AnomalyBandLabels): string {
  if (row.value !== null && row.upper !== null && row.value > row.upper) return labels.anomalyAbove;
  if (row.value !== null && row.lower !== null && row.value < row.lower) return labels.anomalyBelow;
  return labels.anomaly;
}

/** A point with no non-null neighbour has no segment to belong to, so only it gets a symbol. */
function isolatedPoints(values: Array<number | null>): boolean[] {
  return values.map((value, i) => value !== null && values[i - 1] == null && values[i + 1] == null);
}

/** Search hits from `buildAnomalyMetricQuery`, keyed by bucket in milliseconds. */
export function toAnomalyBandRows(hits: Array<Record<string, unknown>>): AnomalyBandRow[] {
  return hits
    .map((hit) => ({
      tsMs: histogramKeyToMicros(hit[ANOMALY_X_ALIAS] as string | number) / 1000,
      value: toNumber(hit[ANOMALY_VALUE_ALIAS]),
      flagged: toNumber(hit[ANOMALY_FLAGGED_ALIAS]),
      expected: toNumber(hit[ANOMALY_EXPECTED_ALIAS]),
      lower: toNumber(hit[ANOMALY_LOWER_ALIAS]),
      upper: toNumber(hit[ANOMALY_UPPER_ALIAS]),
      event: toNumber(hit[ANOMALY_EVENT_ALIAS]),
    }))
    .filter((row) => row.tsMs > 0)
    .sort((a, b) => a.tsMs - b.tsMs);
}

/** The band is drawn as a stacked pair (lower, then upper − lower), so it needs both bounds or neither. */
export function bandHeight(row: AnomalyBandRow): number | null {
  return row.lower === null || row.upper === null ? null : row.upper - row.lower;
}

function tooltipFormatter(rows: AnomalyBandRow[], labels: AnomalyBandLabels) {
  const byTs = new Map(rows.map((row) => [row.tsMs, row]));
  return (params: any) => {
    const first = Array.isArray(params) ? params[0] : params;
    const row = first ? byTs.get(Number(first.axisValue)) : undefined;
    if (!row) return "";
    const lines = [String(first.axisValueLabel ?? "")];
    if (row.flagged !== null) {
      // ECharts' own marker carries the anomaly series colour, so no inline style is written here.
      const marker = Array.isArray(params)
        ? (params.find((p: any) => p.seriesName === labels.anomaly)?.marker ?? "")
        : "";
      lines.push(`${marker}<b>${anomalyLine(row, labels)}</b>`);
    }
    if (row.value !== null) lines.push(`${labels.value}: ${formatReading(row.value)}`);
    if (row.lower !== null && row.upper !== null) {
      lines.push(`${labels.range}: [${formatReading(row.lower)}, ${formatReading(row.upper)}]`);
    }
    if (row.expected !== null) lines.push(`${labels.expected}: ${formatReading(row.expected)}`);
    if (row.event !== null) lines.push(`${labels.event}: ${formatReading(row.event)}`);
    return lines.join("<br/>");
  };
}

export function buildAnomalyBandOptions(
  rows: AnomalyBandRow[],
  labels: AnomalyBandLabels,
  colors: AnomalyBandColors,
  span: AnomalyBandWindow,
) {
  // Stacking is by data index, so every series keeps one entry per row, nulls included.
  const series = (pick: (row: AnomalyBandRow) => number | null) =>
    rows.map((row) => [row.tsMs, pick(row)]);
  const isolatedValues = isolatedPoints(rows.map((row) => row.value));
  return {
    grid: { left: 8, right: 12, top: 32, bottom: 8, containLabel: true },
    legend: {
      top: 0,
      textStyle: { color: colors.axis },
      data: [
        labels.value,
        { name: labels.range, icon: "rect", itemStyle: { color: colors.band, opacity: 1 } },
        labels.anomaly,
        ...(rows.some((row) => row.event !== null) ? [labels.event] : []),
      ],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      formatter: tooltipFormatter(rows, labels),
    },
    xAxis: {
      type: "time",
      min: span.startMs,
      max: span.endMs,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: colors.grid } },
      axisLabel: { hideOverlap: true, color: colors.axis },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: colors.axis },
      splitLine: { lineStyle: { color: colors.grid, type: "dashed" } },
    },
    series: [
      {
        name: labels.range,
        type: "line",
        stack: BAND_STACK,
        stackStrategy: "all",
        symbol: "none",
        silent: true,
        tooltip: { show: false },
        lineStyle: { opacity: 0 },
        itemStyle: { color: colors.band },
        data: series((row) => (bandHeight(row) === null ? null : row.lower)),
      },
      {
        name: labels.range,
        type: "line",
        stack: BAND_STACK,
        stackStrategy: "all",
        symbol: "none",
        silent: true,
        tooltip: { show: false },
        lineStyle: { opacity: 0 },
        itemStyle: { color: colors.band },
        // The band token carries its own alpha per theme, so the legend swatch and the fill match.
        areaStyle: { color: colors.band, opacity: 1 },
        data: series(bandHeight),
      },
      {
        name: labels.value,
        type: "line",
        smooth: false,
        showSymbol: true,
        symbolSize: (_value: unknown, params: { dataIndex: number }) =>
          isolatedValues[params.dataIndex] ? ISOLATED_SYMBOL_SIZE : 0,
        connectNulls: false,
        lineStyle: { width: 2, color: colors.value },
        itemStyle: { color: colors.value },
        data: series((row) => row.value),
      },
      {
        name: labels.anomaly,
        type: "line",
        smooth: false,
        // A lone flagged bucket has no neighbour to draw a segment to.
        showSymbol: true,
        symbolSize: 6,
        connectNulls: false,
        lineStyle: { width: 2, color: colors.anomaly },
        itemStyle: { color: colors.anomaly },
        data: series((row) => row.flagged),
      },
      {
        name: labels.event,
        type: "scatter",
        symbol: "diamond",
        symbolSize: 9,
        itemStyle: { color: colors.event },
        data: series((row) => row.event),
      },
    ],
  };
}
