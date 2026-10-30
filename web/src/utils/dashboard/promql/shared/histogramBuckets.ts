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

/**
 * Prometheus classic-histogram bucket helpers.
 *
 * A query such as `sum by(le) (rate(x_bucket[5m]))` returns one series per
 * `le` label, and those series are CUMULATIVE ("count of observations <= le").
 * To render a histogram heatmap we need the per-bucket (non-cumulative) value
 * at each timestamp, i.e. the difference between adjacent `le` bounds.
 *
 * This module is pure and dependency-free.
 */

/**
 * A single cumulative bucket series, keyed by timestamp.
 */
export interface HistogramSeriesInput {
  /** Raw `le` label value, e.g. "0.5", "+Inf", "inf" */
  le: string;
  /** timestamp -> cumulative value (may be missing / null / non-numeric) */
  data: Record<string | number, number | string | null | undefined>;
}

/**
 * A de-accumulated bucket series.
 */
export interface HistogramSeriesOutput {
  /** Raw `le` label value, preserved verbatim from the input */
  le: string;
  /** Numeric value of `le` (`Infinity` for the +Inf bucket) */
  leValue: number;
  /** timestamp (string key) -> non-cumulative, non-negative value; absent where the bucket is empty */
  data: Record<string, number>;
}

/**
 * The spellings of infinity we accept, once the sign has been peeled off and
 * the rest lowercased. `Number()` already understands "Infinity" on its own,
 * but not the bare "inf" that both Prometheus and our own writer emit, so the
 * magnitude is matched here rather than handed straight to `Number()`.
 */
const INFINITY_SPELLINGS = new Set(["inf", "infinity"]);

/** The `heatmap_mode` that reads a PromQL heatmap's series as the cumulative buckets of classic histograms. */
export const PROMETHEUS_HISTOGRAM_MODE = "prometheus_histogram";

/** Labels that vary within one histogram rather than between histograms. */
const BUCKET_LABELS = new Set(["le", "__name__"]);

export interface HistogramGroup<T> {
  label: string;
  labels: Record<string, string>;
  series: T[];
}

/**
 * Parse a Prometheus `le` label value into a number.
 *
 * Handles every infinity spelling we may encounter:
 * - "+Inf" — the Prometheus text/exposition spelling
 * - "inf"  — OpenObserve's OTLP ingestion spelling; see
 *   `src/service/metrics/otlp.rs`, which writes `f64::INFINITY.to_string()`
 *   (Rust renders that lowercase as "inf")
 * - "Inf", "+inf", "Infinity", ... — accepted for good measure
 *
 * Anything non-numeric, empty, or missing yields `NaN` so callers can drop it.
 */
export function parseLe(raw: string): number {
  if (typeof raw !== "string") return NaN;

  const trimmed = raw.trim();
  if (trimmed === "") return NaN;

  const negative = trimmed.startsWith("-");
  const magnitude = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;

  if (INFINITY_SPELLINGS.has(magnitude.toLowerCase())) {
    return negative ? -Infinity : Infinity;
  }

  // Number() rejects trailing garbage ("1.5abc" -> NaN), which is what we want.
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/** Orders parsed `le` bounds ascending; not `a - b`, as `Infinity - Infinity` is NaN. */
export function compareLe(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Coerce a raw cumulative cell value to a number.
 * Missing / null / undefined / empty / non-numeric all become `NaN`.
 */
function toNumericValue(raw: number | string | null | undefined): number {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === "number") return raw;

  const trimmed = String(raw).trim();
  if (trimmed === "") return NaN;

  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/** Splits bucket series into histograms by every label except `le` and `__name__`, in first-seen order. */
export function groupHistogramSeries<T extends { metric?: Record<string, string> }>(
  series: T[],
): HistogramGroup<T>[] {
  const groups = new Map<string, HistogramGroup<T>>();
  for (const entry of series ?? []) {
    const labels = Object.entries(entry?.metric ?? {})
      .filter(([name]) => !BUCKET_LABELS.has(name))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    // Keyed on the pairs, not the rendered text, which a value containing `", ` could forge.
    const key = JSON.stringify(labels);
    const group = groups.get(key);
    if (group) group.series.push(entry);
    else {
      const label = labels.map(([name, value]) => `${name}="${value}"`).join(", ");
      groups.set(key, { label, labels: Object.fromEntries(labels), series: [entry] });
    }
  }
  return [...groups.values()];
}

/** The first whole histograms of `series` that fit in `limit` series, at least one, in input order; a histogram missing a bucket would fold its counts into the next. */
export function limitWholeHistograms<T extends { metric?: Record<string, string> }>(
  series: T[],
  limit: number,
): { kept: T[]; shown: number; total: number } {
  const groups = groupHistogramSeries(series);
  const keep = new Set<T>();
  let shown = 0;
  for (const group of groups) {
    if (shown > 0 && keep.size + group.series.length > limit) break;
    for (const entry of group.series) keep.add(entry);
    shown++;
  }
  return { kept: series.filter((entry) => keep.has(entry)), shown, total: groups.length };
}

/**
 * Convert cumulative Prometheus histogram bucket series into per-bucket
 * (non-cumulative) series.
 *
 * Steps:
 * 1. Series whose `le` does not parse are dropped.
 * 2. Remaining series are sorted ascending by numeric `le`; `+Inf` sorts last.
 * 3. Duplicate `le` values are de-duplicated, keeping the FIRST occurrence
 *    after the (stable) sort.
 * 4. For every timestamp present anywhere in the set, the value for bucket `i`
 *    is `cumulative[i] - cumulative[i - 1]` (for `i = 0` it is `cumulative[0]`,
 *    i.e. the implicit lower bound of 0).
 *
 *    A missing cumulative value leaves that bucket and the one above it empty, never 0.
 * 5. Negative differences (float artifacts or malformed, non-monotonic data)
 *    are clamped to 0.
 */
export function deaccumulateHistogramSeries(
  series: HistogramSeriesInput[],
): HistogramSeriesOutput[] {
  if (!Array.isArray(series) || series.length === 0) return [];

  // 1. Attach numeric le, drop unparseable ones.
  const parsed = series
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      le: entry.le,
      leValue: parseLe(entry.le),
      data: entry.data ?? {},
    }))
    .filter((entry) => !Number.isNaN(entry.leValue));

  if (parsed.length === 0) return [];

  // 2. Stable, so step 3 keeps the first of equal `le` in input order.
  parsed.sort((a, b) => compareLe(a.leValue, b.leValue));

  // 3. De-duplicate identical le values, keeping the first after sort.
  const buckets: typeof parsed = [];
  const seen = new Set<number>();
  for (const entry of parsed) {
    if (seen.has(entry.leValue)) continue;
    seen.add(entry.leValue);
    buckets.push(entry);
  }

  // Union of all timestamps, numerically ascending.
  const timestampSet = new Set<string>();
  for (const bucket of buckets) {
    for (const ts of Object.keys(bucket.data)) {
      timestampSet.add(ts);
    }
  }
  const timestamps = Array.from(timestampSet).sort((a, b) => Number(a) - Number(b));

  const output: HistogramSeriesOutput[] = buckets.map((bucket) => ({
    le: bucket.le,
    leValue: bucket.leValue,
    data: {} as Record<string, number>,
  }));

  // 4 + 5. De-accumulate per timestamp, walking buckets in ascending le order.
  for (const ts of timestamps) {
    let previousCumulative = 0;

    for (let i = 0; i < buckets.length; i++) {
      const cumulative = toNumericValue(buckets[i].data[ts]);
      if (!Number.isNaN(cumulative) && !Number.isNaN(previousCumulative)) {
        const diff = cumulative - previousCumulative;
        output[i].data[ts] = diff > 0 ? diff : 0;
      }
      previousCumulative = cumulative;
    }
  }

  return output;
}
