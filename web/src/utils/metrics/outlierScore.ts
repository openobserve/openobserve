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

/** Scales a MAD to a standard deviation under a normal distribution. */
const MAD_SCALE = 1.4826;
/** Scales a mean absolute deviation the same way. */
const MEAN_AD_SCALE = 1.2533;
const EPSILON = 1e-9;
/** The spread never counts as less than this share of the level, so a negligible relative wobble cannot score high. */
const RELATIVE_FLOOR = 0.01;

/** A score at or above this is a robust z-score of 3: a series well apart from the rest. */
export const OUTLIER_SCORE = 3;

const median = (sorted: number[]): number => {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Per value of `label`, its points in PromQL range responses as timestamp → value; NaN and missing points are left out. */
export function seriesPointsByValue(
  responses: any[],
  label: string,
): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const response of responses ?? []) {
    for (const series of response?.result ?? []) {
      const value = series?.metric?.[label];
      if (value === undefined) continue;
      const points = new Map<number, number>();
      for (const [ts, raw] of series?.values ?? []) {
        if (raw === null || raw === undefined || raw === "") continue;
        const v = Number(raw);
        if (Number.isFinite(v)) points.set(Number(ts), v);
      }
      out.set(String(value), points);
    }
  }
  return out;
}

/** Per series, the mean over its points of |value − median| / (max(1.4826·MAD, or 1.2533·mean |deviation| when the MAD is 0, 1% of |median|) + ε) at timestamps two or more series share; 0 with none. */
export function outlierScores(series: Map<string, Map<number, number>>): Map<string, number> {
  const atTime = new Map<number, number[]>();
  for (const points of series.values()) {
    for (const [ts, v] of points) {
      const values = atTime.get(ts);
      if (values) values.push(v);
      else atTime.set(ts, [v]);
    }
  }

  const spread = new Map<number, { median: number; scale: number }>();
  for (const [ts, values] of atTime) {
    if (values.length < 2) continue;
    const sorted = values.sort((a, b) => a - b);
    const m = median(sorted);
    const deviations = sorted.map((v) => Math.abs(v - m)).sort((a, b) => a - b);
    const mad = median(deviations);
    // A majority of equal values zeroes the MAD, which would turn any small wobble into a huge score.
    const spreadOf = mad
      ? mad * MAD_SCALE
      : (deviations.reduce((sum, d) => sum + d, 0) / deviations.length) * MEAN_AD_SCALE;
    spread.set(ts, {
      median: m,
      scale: Math.max(spreadOf, RELATIVE_FLOOR * Math.abs(m)) + EPSILON,
    });
  }

  const scores = new Map<string, number>();
  for (const [name, points] of series) {
    let sum = 0;
    let count = 0;
    for (const [ts, v] of points) {
      const s = spread.get(ts);
      if (!s) continue;
      sum += Math.abs(v - s.median) / s.scale;
      count++;
    }
    scores.set(name, count ? sum / count : 0);
  }
  return scores;
}
