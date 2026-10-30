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
  baseNameOf,
  inferUnit,
  normalizeDeclaredUnit,
  toO2Unit,
  type O2Unit,
} from "@/utils/metrics/metricDefaults";

export type ExemplarPlacement = "value" | "line";

const NOT_METRIC = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
  "bool",
  "offset",
  "and",
  "or",
  "unless",
  "inf",
  "nan",
]);

// Aggregations may put their grouping clause before the parenthesis, so they are not always followed by `(`.
const AGGREGATIONS = new Set([
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "group",
  "stddev",
  "stdvar",
  "topk",
  "bottomk",
  "quantile",
  "count_values",
  "limitk",
  "limit_ratio",
]);

const stripQuotedAndLabelSets = (query: string): string =>
  query.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\{[^}]*\}/g, "");

/** Metric names a PromQL expression selects, from `{__name__="x"}` matchers and bare selectors. */
export function selectorMetricNames(query: string): string[] {
  const names = new Set<string>();
  for (const match of query.matchAll(/__name__\s*=\s*"([^"]+)"/g)) names.add(match[1]);
  const bare = stripQuotedAndLabelSets(query)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/gi, " ");
  // The lookbehind keeps the letter tail of a literal (`1e3`, `5m`) from reading as a metric name.
  for (const match of bare.matchAll(/(?<![\w.:])([A-Za-z_:][A-Za-z0-9_:]*)\s*(\()?/g)) {
    const [, name, call] = match;
    if (call || NOT_METRIC.has(name.toLowerCase()) || AGGREGATIONS.has(name.toLowerCase()))
      continue;
    names.add(name);
  }
  return [...names];
}

/** The unit an exemplar value is in: the observed quantity of the family, never a rate. */
export function exemplarBaseUnit(query: string, declaredUnit?: string): O2Unit {
  const declared = normalizeDeclaredUnit(declaredUnit);
  if (declared) return toO2Unit(declared);
  const name = selectorMetricNames(query)[0];
  return toO2Unit(name ? inferUnit(baseNameOf(name)) : "short");
}

/** True when the whole expression is one `histogram_quantile(...)` call. */
export function isWholeHistogramQuantile(query: string): boolean {
  const trimmed = query.trim();
  const head = /^histogram_quantile\s*\(/.exec(trimmed);
  if (!head) return false;
  let depth = 0;
  for (let i = head[0].length - 1; i < trimmed.length; i++) {
    if (trimmed[i] === "(") depth++;
    if (trimmed[i] === ")") depth--;
    if (depth === 0) return i === trimmed.length - 1;
  }
  return false;
}

const isUnsetUnit = (unit: string | undefined | null): boolean =>
  !unit || unit === "default" || unit === "numbers" || unit === "short";

/** Value placement only when the exemplar value is on the chart's own scale; everything else rides its line. */
export function exemplarPlacement(
  query: string,
  panelUnit: string | undefined | null,
  baseUnit: O2Unit,
): ExemplarPlacement {
  if (!isWholeHistogramQuantile(query)) return "line";
  if (!selectorMetricNames(query).some((n) => n.endsWith("_bucket"))) return "line";
  return isUnsetUnit(panelUnit) || panelUnit === baseUnit.unit ? "value" : "line";
}

/** A series' finite points, parsed once so every marker can binary-search them. */
export interface ParsedSeries {
  ts: Float64Array;
  values: Float64Array;
}

export function parseSeries(values: [unknown, unknown][] | undefined): ParsedSeries {
  const points = (values ?? [])
    .map(([t, v]) => [Number(t), Number(v)] as const)
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  return {
    ts: Float64Array.from(points, (p) => p[0]),
    values: Float64Array.from(points, (p) => p[1]),
  };
}

/** The series value at `tsSec`, linearly interpolated between the neighbouring finite points. */
export function interpolateParsed(series: ParsedSeries, tsSec: number): number | null {
  const { ts, values } = series;
  const n = ts.length;
  if (!n) return null;
  if (tsSec <= ts[0]) return values[0];
  if (tsSec >= ts[n - 1]) return values[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= tsSec) lo = mid;
    else hi = mid;
  }
  if (ts[lo] === tsSec) return values[lo];
  const ratio = (tsSec - ts[lo]) / (ts[hi] - ts[lo]);
  return values[lo] + ratio * (values[hi] - values[lo]);
}

/** One-off form of {@link interpolateParsed}; callers placing many markers should parse once. */
export function interpolateSeriesValue(
  values: [unknown, unknown][] | undefined,
  tsSec: number,
): number | null {
  return interpolateParsed(parseSeries(values), tsSec);
}
