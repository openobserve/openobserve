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

import type { I18nKey } from "@/types/i18n";
import type { CoverageRow, Signal } from "./aoTypes";

export type ChartRange = "1h" | "24h" | "7d";
export type ServiceKind = "http" | "datastore" | "cache" | "queue";
export type MetricUnit = "perSec" | "percent" | "ms" | "perMin" | "seconds" | "count";

export interface MetricDef {
  signal: Signal;
  titleKey: I18nKey;
  unit: MetricUnit;
  base: number;
  spread: number;
  threshold?: number;
  max?: number;
  peak?: number;
  rate?: string;
}

export interface MetricSeries {
  // A null value is a bucket with nothing to measure, drawn as a gap rather than a zero.
  points: [number, number | null][];
  band: [number, number, number][] | null;
  anomalies: [number, number][];
  current: number | null;
  previous: number | null;
  low: number | null;
  high: number | null;
}

export const STEPS: Record<ChartRange, { count: number; stepMs: number }> = {
  "1h": { count: 60, stepMs: 60_000 },
  "24h": { count: 96, stepMs: 15 * 60_000 },
  "7d": { count: 168, stepMs: 60 * 60_000 },
};

export const CHART_SIGNALS: Signal[] = ["requests", "errors", "latency", "saturation"];

// One accent per metric, so the four charts and their tiles read apart at a glance.
export const ACCENT: Record<Signal, `--${string}`> = {
  requests: "--color-chart-series-1",
  errors: "--color-chart-series-5",
  latency: "--color-chart-series-9",
  saturation: "--color-chart-series-5",
  logPatterns: "--color-chart-series-7",
  dependencies: "--color-chart-series-9",
};

// Where a rise is bad; requests are reported without a verdict.
export const RISE_IS_BAD: Record<Signal, boolean | null> = {
  requests: null,
  errors: true,
  latency: true,
  saturation: true,
  logPatterns: true,
  dependencies: true,
};

export const seed = (text: string) =>
  [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const pick = (key: string, lo: number, hi: number) => lo + ((seed(key) % 1000) / 1000) * (hi - lo);

export const kindOf = (row: CoverageRow): ServiceKind => {
  const library = row.cells.requests.library ?? "";
  if (library.startsWith("postgres")) return "datastore";
  if (library.startsWith("redis")) return "cache";
  if (library.startsWith("queue")) return "queue";
  return "http";
};

export const libraryOf = (row: CoverageRow) =>
  (row.cells.requests.library ?? row.cells.errors.library ?? "").split("/")[0];

const httpSaturation = (name: string): MetricDef => {
  if (name === "checkout")
    return {
      signal: "saturation",
      titleKey: "autoobserve.coverage.metric.pool",
      unit: "count",
      base: 22,
      spread: 6,
      threshold: 45,
      max: 50,
      peak: 50,
    };
  if (name === "search")
    return {
      signal: "saturation",
      titleKey: "autoobserve.coverage.metric.memory",
      unit: "percent",
      base: 58,
      spread: 6,
      threshold: 90,
      max: 100,
      peak: 97,
    };
  return {
    signal: "saturation",
    titleKey: "autoobserve.coverage.metric.cpu",
    unit: "percent",
    base: pick(`${name}:cpu`, 24, 52),
    spread: 6,
    threshold: 80,
  };
};

export const metricsFor = (row: CoverageRow): MetricDef[] => {
  const name = row.service;
  const kind = kindOf(row);
  if (kind === "datastore")
    return [
      {
        signal: "requests",
        titleKey: "autoobserve.coverage.metric.queries",
        unit: "perSec",
        rate: "q/s",
        base: pick(`${name}:q`, 300, 1400),
        spread: 0.12,
      },
      {
        signal: "errors",
        titleKey: "autoobserve.coverage.metric.errors",
        unit: "percent",
        base: 0.08,
        spread: 0.5,
      },
      {
        signal: "latency",
        titleKey: "autoobserve.coverage.metric.queryLatency",
        unit: "ms",
        base: pick(`${name}:l`, 4, 14),
        spread: 0.18,
      },
      {
        signal: "saturation",
        titleKey: "autoobserve.coverage.metric.connections",
        unit: "count",
        base: pick(`${name}:c`, 60, 120),
        spread: 12,
        threshold: 180,
        max: 200,
      },
    ];
  if (kind === "cache")
    return [
      {
        signal: "requests",
        titleKey: "autoobserve.coverage.metric.ops",
        unit: "perSec",
        rate: "ops/s",
        base: pick(`${name}:o`, 2000, 9000),
        spread: 0.12,
      },
      {
        signal: "errors",
        titleKey: "autoobserve.coverage.metric.rejections",
        unit: "perMin",
        base: 0,
        spread: 0,
        threshold: 1,
      },
      {
        signal: "latency",
        titleKey: "autoobserve.coverage.metric.latency",
        unit: "ms",
        base: pick(`${name}:l`, 0.4, 1.2),
        spread: 0.2,
      },
      {
        signal: "saturation",
        titleKey: "autoobserve.coverage.metric.memory",
        unit: "percent",
        base: pick(`${name}:m`, 42, 68),
        spread: 4,
        threshold: 85,
      },
    ];
  if (kind === "queue")
    return [
      {
        signal: "requests",
        titleKey: "autoobserve.coverage.metric.messages",
        unit: "perSec",
        rate: "msg/s",
        base: pick(`${name}:m`, 60, 280),
        spread: 0.15,
      },
      {
        signal: "errors",
        titleKey: "autoobserve.coverage.metric.failed",
        unit: "perMin",
        base: 0.2,
        spread: 0.3,
        threshold: 5,
      },
      {
        signal: "latency",
        titleKey: "autoobserve.coverage.metric.lag",
        unit: "seconds",
        base: pick(`${name}:lag`, 0.6, 2.4),
        spread: 0.25,
      },
      {
        signal: "saturation",
        titleKey: "autoobserve.coverage.metric.depth",
        unit: "count",
        base: pick(`${name}:d`, 120, 700),
        spread: 0.2,
      },
    ];
  return [
    {
      signal: "requests",
      titleKey: "autoobserve.coverage.metric.requests",
      unit: "perSec",
      rate: "req/s",
      base: pick(`${name}:r`, 40, 600),
      spread: 0.1,
    },
    {
      signal: "errors",
      titleKey: "autoobserve.coverage.metric.errors",
      unit: "percent",
      base: pick(`${name}:e`, 0.1, 0.6),
      spread: 0.15,
    },
    {
      signal: "latency",
      titleKey: "autoobserve.coverage.metric.latencyP95",
      unit: "ms",
      base: name === "search" ? 380 : pick(`${name}:l`, 80, 320),
      spread: 0.14,
      peak: name === "search" ? 3400 : undefined,
    },
    httpSaturation(name),
  ];
};

export const formatValue = ({ unit, max, rate }: MetricDef, value: number) => {
  const n = (digits: number) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (unit === "percent") return `${n(value < 1 ? 2 : 1)}%`;
  if (unit === "ms") return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${n(1)} ms`;
  if (unit === "seconds") return `${n(1)} s`;
  if (unit === "perSec") return `${n(value < 10 ? 1 : 0)} ${rate ?? "/s"}`;
  // A quiet service's errors or an alert's threshold sit well under 1/min, which one decimal would show as 0.
  if (unit === "perMin") return `${n(value > 0 && value < 0.1 ? 3 : value < 1 ? 2 : 1)}/min`;
  return max ? `${n(0)} / ${max}` : n(0);
};
