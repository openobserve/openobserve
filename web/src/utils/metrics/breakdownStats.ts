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
  compareLe,
  deaccumulateHistogramSeries,
  parseLe,
} from "@/utils/dashboard/promql/shared/histogramBuckets";

/** One label value's series, summarised for the breakdown table. */
export interface SeriesStats {
  avg: number;
  /** The last real point. */
  latest: number;
  /** Over the window, a missing step counting as 0: what a share of the total is taken from. */
  sum: number;
  /** Decimal places for this series alone, so a small value keeps its digits beside a large one. */
  decimals: number;
  /** Oldest first; `null` where the point is missing or NaN. */
  points: (number | null)[];
}

const pointOf = (raw: unknown): number | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** Per value of `label`, the stats of its series in PromQL range responses; a series with no real point is left out. */
export function seriesStatsByValue(responses: any[], label: string): Map<string, SeriesStats> {
  const stats = new Map<string, SeriesStats>();
  for (const response of responses ?? []) {
    for (const series of response?.result ?? []) {
      const value = series?.metric?.[label];
      if (value === undefined) continue;
      const points = (series?.values ?? []).map(([, raw]: [unknown, unknown]) => pointOf(raw));
      const real = points.filter((p: number | null): p is number => p !== null);
      if (!real.length) continue;
      const sum = real.reduce((total: number, p: number) => total + p, 0);
      stats.set(String(value), {
        avg: sum / real.length,
        latest: real[real.length - 1],
        sum,
        decimals: decimalsForMax(Math.max(...real.map(Math.abs))),
        points,
      });
    }
  }
  return stats;
}

/** One label value's histogram over the window, summarised for the breakdown table. */
export interface HeatmapStats {
  /** Observations per second, averaged over the window: what values are ranked by. */
  rate: number;
  /** In the observation's unit; `null` when there were no observations or no `+Inf` bucket. */
  p50: number | null;
  p90: number | null;
  p99: number | null;
  rateDecimals: number;
}

/** A value's buckets, cumulative, `le` ascending. */
interface ValueBuckets {
  le: string;
  leValue: number;
  /** timestamp → cumulative rate */
  points: Map<number, number>;
}

/** A `sum by (le, label)` range response, per value, with the timestamps any value reported. */
function parseHeatmap(response: any, label: string) {
  const byValue = new Map<string, Map<number, ValueBuckets>>();
  const timestamps = new Set<number>();
  for (const series of response?.result ?? []) {
    const value = series?.metric?.[label];
    const le = String(series?.metric?.le ?? "");
    const leValue = parseLe(le);
    if (value === undefined || Number.isNaN(leValue)) continue;
    const buckets = byValue.get(String(value)) ?? new Map<number, ValueBuckets>();
    byValue.set(String(value), buckets);
    // "1" and "1.0", or "+Inf" and "inf", are one bucket: summed, as Prometheus does.
    const bucket = buckets.get(leValue) ?? { le, leValue, points: new Map() };
    buckets.set(leValue, bucket);
    for (const [ts, raw] of series?.values ?? []) {
      const point = pointOf(raw);
      if (point === null) continue;
      bucket.points.set(Number(ts), (bucket.points.get(Number(ts)) ?? 0) + point);
      timestamps.add(Number(ts));
    }
  }
  const sorted = new Map(
    [...byValue].map(([value, buckets]) => [
      value,
      [...buckets.values()].sort((a, b) => compareLe(a.leValue, b.leValue)),
    ]),
  );
  return { byValue: sorted, axis: [...timestamps].sort((a, b) => a - b) };
}

/** A quantile of cumulative counts sorted by `le`, as `histogram_quantile` estimates it; null without observations or a `+Inf` bucket. */
export function histogramQuantile(
  q: number,
  sorted: { leValue: number; count: number }[],
): number | null {
  if (sorted.length < 2 || sorted.at(-1)!.leValue !== Infinity) return null;
  // Rates of separately scraped buckets can dip below a lower bucket's; counts never decrease.
  let running = 0;
  const counts = sorted.map((b) => (running = Math.max(running, b.count)));
  const total = counts.at(-1)!;
  if (!(total > 0)) return null;

  const rank = q * total;
  const i = counts.findIndex((count) => count >= rank);
  if (i === sorted.length - 1) return sorted[i - 1].leValue;
  if (i === 0 && sorted[0].leValue <= 0) return sorted[0].leValue;
  const lower = i === 0 ? 0 : sorted[i - 1].leValue;
  const below = i === 0 ? 0 : counts[i - 1];
  // The first bucket reaching the rank holds observations above `below`, so this never divides by 0.
  return lower + ((sorted[i].leValue - lower) * (rank - below)) / (counts[i] - below);
}

/** Per value of `label`, its observation rate and percentiles over the whole window. */
export function heatmapStatsByValue(response: any, label: string): Map<string, HeatmapStats> {
  const { byValue, axis } = parseHeatmap(response, label);
  const stats = new Map<string, HeatmapStats>();
  for (const [value, buckets] of byValue) {
    // A bucket's points summed over the window are still cumulative, so they make one histogram.
    const overWindow = buckets.map((b) => ({
      leValue: b.leValue,
      count: [...b.points.values()].reduce((sum, p) => sum + p, 0),
    }));
    // The top bucket counts every observation at its instant.
    const totals = new Map<number, number>();
    for (const b of buckets)
      for (const [ts, p] of b.points) totals.set(ts, Math.max(totals.get(ts) ?? 0, p));
    if (!totals.size) continue;
    // Over the whole window, not just where this value reported: a brief burst is not volume.
    const rate = [...totals.values()].reduce((sum, p) => sum + p, 0) / axis.length;
    const [p50, p90, p99] = [0.5, 0.9, 0.99].map((q) => histogramQuantile(q, overWindow));
    stats.set(value, {
      rate,
      p50,
      p90,
      p99,
      rateDecimals: decimalsForMax(rate),
    });
  }
  return stats;
}

/** The `n` values with the most observations, most first. */
export function topValuesByRate(stats: Map<string, HeatmapStats>, n: number): string[] {
  return [...stats]
    .sort(([, a], [, b]) => b.rate - a.rate)
    .slice(0, n)
    .map(([value]) => value);
}

/** One response per value, all on the same `le` rows and time axis; a filled-in point is NaN, which the heatmap reads as no observations. */
export function heatmapResponsesByValue(
  response: any,
  label: string,
  values: string[],
): Map<string, any> {
  const { byValue, axis } = parseHeatmap(response, label);
  const les = new Map<number, string>();
  for (const buckets of byValue.values())
    for (const b of buckets) if (!les.has(b.leValue)) les.set(b.leValue, b.le);
  const rows = [...les].sort(([a], [b]) => compareLe(a, b));

  const responses = new Map<string, any>();
  for (const value of values) {
    const own = new Map((byValue.get(value) ?? []).map((b) => [b.leValue, b.points]));
    const result = rows.map(([leValue, le]) => ({
      metric: { [label]: value, le },
      values: axis.map((ts) => [ts, String(own.get(leValue)?.get(ts) ?? NaN)]),
    }));
    responses.set(value, { resultType: "matrix", result });
  }
  return responses;
}

/** The colour range covering every cell of the heatmaps, de-accumulated as the heatmap draws them. */
export function sharedHeatmapRange(responses: any[]): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const response of responses) {
    const cells = deaccumulateHistogramSeries(
      (response?.result ?? []).map((series: any) => ({
        le: String(series?.metric?.le ?? ""),
        data: Object.fromEntries(series?.values ?? []),
      })),
    );
    for (const bucket of cells)
      for (const cell of Object.values(bucket.data)) {
        if (cell < min) min = cell;
        if (cell > max) max = cell;
      }
  }
  return { min, max };
}

/**
 * Decimal places that keep a chart's axis readable at the data's magnitude.
 *
 * The shared formatter applies no magnitude scaling to `numbers`/`custom`
 * units, so a rate of 0.004 c/s renders as a column of identical "0.00"
 * ticks at the default 2 decimals. Scaling the precision to the series keeps
 * the axis readable.
 */
export function adaptiveDecimals(responses: any[]): number {
  let max = 0;
  for (const response of responses ?? []) {
    for (const series of response?.result ?? []) {
      for (const [, raw] of series?.values ?? []) {
        const v = Math.abs(parseFloat(raw));
        if (Number.isFinite(v) && v > max) max = v;
      }
    }
  }
  return decimalsForMax(max);
}

export function decimalsForMax(max: number): number {
  if (max === 0) return 2;
  if (max < 0.001) return 6;
  if (max < 0.01) return 5;
  if (max < 0.1) return 4;
  if (max < 1) return 3;
  return 2;
}
