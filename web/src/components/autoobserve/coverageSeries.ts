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
import { DAY_DATE, DEMO_NOW, problemsIn, type Scenario } from "./data/facts";
import type { CoverageRow, Signal } from "./fixtures";

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
  points: [number, number][];
  band: [number, number, number][] | null;
  anomalies: [number, number][];
  current: number;
  previous: number;
  low: number | null;
  high: number | null;
}

const STEPS: Record<ChartRange, { count: number; stepMs: number }> = {
  "1h": { count: 60, stepMs: 60_000 },
  "24h": { count: 96, stepMs: 15 * 60_000 },
  "7d": { count: 168, stepMs: 60 * 60_000 },
};

export const CHART_SIGNALS: Signal[] = ["requests", "errors", "latency", "saturation"];

// One accent per metric, so the four charts and their tiles read apart at a glance.
export const ACCENT: Record<Signal, `--${string}`> = {
  requests: "--color-chart-series-1",
  errors: "--color-chart-series-8",
  latency: "--color-chart-series-3",
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

export const DEMO_END = new Date(`${DAY_DATE.today}T${DEMO_NOW}:00`).getTime();

export const seed = (text: string) =>
  [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// Deterministic -1..1 noise, mixed per index so neighbouring points are independent.
const noise = (key: string, i: number) => {
  let h = (seed(key) + Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
};

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

// Traffic follows a working day (low near 03:00, high mid-afternoon) and dips at weekends.
const daily = (ms: number) => {
  const at = new Date(ms);
  const hour = at.getHours() + at.getMinutes() / 60;
  const weekend = at.getDay() === 0 || at.getDay() === 6 ? 0.8 : 1;
  return weekend * (0.62 + 0.38 * Math.sin(((hour - 9) / 24) * 2 * Math.PI));
};

// An incident is drawn over its first 25 minutes (one point at coarse steps), rising to its recorded peak.
const INCIDENT_MS = 25 * 60_000;

const SIGNAL_OF_PROBLEM: [RegExp, Signal][] = [
  [/p95|slow|late|behind|throttl/i, "latency"],
  [/pool|memory|disk|full|backing up/i, "saturation"],
];

const incidentsFor = (scenario: Scenario, service: string, signal: Signal) =>
  problemsIn(scenario, "month")
    .filter((p) => p.service === service)
    .filter((p) => {
      const hits = SIGNAL_OF_PROBLEM.filter(([re]) => re.test(p.title)).map(([, s]) => s);
      return (hits.length ? hits : ["errors"]).includes(signal);
    })
    .map((p) => new Date(`${DAY_DATE[p.day]}T${p.time}:00`).getTime());

const expectedAt = (def: MetricDef, ms: number) => {
  if (def.unit === "percent" && def.signal !== "errors") return def.base * (0.8 + 0.3 * daily(ms));
  if (def.unit === "count" && def.max) return def.base * (0.7 + 0.45 * daily(ms));
  return def.base * daily(ms) * 1.25;
};

const width = (def: MetricDef, expected: number) =>
  def.spread >= 1 ? def.spread : Math.max(expected * def.spread * 1.8, def.base * 0.04);

const spike = (def: MetricDef, expected: number) => def.peak ?? Math.max(expected * 4, 1);

export const seriesFor = (
  scenario: Scenario,
  row: CoverageRow,
  def: MetricDef,
  range: ChartRange,
): MetricSeries => {
  const { count, stepMs } = STEPS[range];
  const key = `${row.service}:${def.signal}:${range}`;
  const start = DEMO_END - (count - 1) * stepMs;
  const incidents = incidentsFor(scenario, row.service, def.signal).filter(
    (ms) => ms >= start - stepMs && ms <= DEMO_END,
  );
  const points: [number, number][] = [];
  const band: [number, number, number][] = [];
  const anomalies: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const ms = start + i * stepMs;
    const expected = expectedAt(def, ms);
    const w = width(def, expected);
    const jitter = 0.65 * noise(key, i) + 0.35 * noise(key, i - 1);
    let value = Math.max(0, expected + jitter * w * 0.6);
    const since = incidents
      .map((at) => ms - at)
      .find((d) => d >= 0 && d <= Math.max(INCIDENT_MS, stepMs));
    const hit = since != null;
    if (hit) {
      value = spike(def, expected) * (0.9 + 0.1 * Math.min(1, (since ?? 0) / INCIDENT_MS));
      anomalies.push([ms, value]);
    }
    if (def.max) value = Math.min(def.max, value);
    points.push([ms, round(value)]);
    band.push([ms, round(Math.max(0, expected - w)), round(expected + w)]);
  }
  const last = band[band.length - 1];
  return {
    points,
    band,
    anomalies: anomalies.map(([ms, v]) => [ms, round(def.max ? Math.min(def.max, v) : v)]),
    current: points[points.length - 1][1],
    previous: points[0][1],
    low: last[1],
    high: last[2],
  };
};

const round = (v: number) => (v >= 100 ? Math.round(v) : Number(v.toPrecision(3)));

export const formatValue = ({ unit, max, rate }: MetricDef, value: number) => {
  const n = (digits: number) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (unit === "percent") return `${n(value < 1 ? 2 : 1)}%`;
  if (unit === "ms") return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${n(1)} ms`;
  if (unit === "seconds") return `${n(1)} s`;
  if (unit === "perSec") return `${n(value < 10 ? 1 : 0)} ${rate ?? "/s"}`;
  if (unit === "perMin") return `${n(1)}/min`;
  return max ? `${n(0)} / ${max}` : n(0);
};
