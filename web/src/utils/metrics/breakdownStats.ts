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

/** One label value's series, summarised for the breakdown table. */
export interface SeriesStats {
  avg: number;
  /** The last real point. */
  latest: number;
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
      stats.set(String(value), {
        avg: real.reduce((sum: number, p: number) => sum + p, 0) / real.length,
        latest: real[real.length - 1],
        points,
      });
    }
  }
  return stats;
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
  if (max === 0) return 2;
  if (max < 0.001) return 6;
  if (max < 0.01) return 5;
  if (max < 0.1) return 4;
  if (max < 1) return 3;
  return 2;
}
