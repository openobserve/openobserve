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
 * Classification of `query/history` points into the render forms §4.4 requires.
 *
 * This module exists because the chart's single worst available bug is a
 * one-line mistake: plotting a below-top-N window as `0`. That window means
 * "this query ranked below the top-N cut here", and a line dipping to zero says
 * "the query stopped running" — which, mid-incident, reads as recovered. So the
 * classification is a pure function with its own tests, rather than an inline
 * ternary inside a chart option builder where nobody would ever see it again.
 *
 * The API emits four shapes (verified against `get_dbm_query_history` in
 * api.rs, not the docs), and they are NOT distinguished by any single field:
 *
 *   1. measured   — a rollup window. No `below_top_n`/`live` key at all.
 *   2. backfilled — `below_top_n: true` + `backfilled: true` + metrics recovered
 *                   from raw spans. Real numbers, lower confidence.
 *   3. unmeasured — `below_top_n: true` with NO metrics. Either the backfill
 *                   budget (6 windows) ran out, the backfill SQL failed, or no
 *                   single trace stream could be resolved. Indistinguishable
 *                   from each other in the payload, so they share one form.
 *   4. live       — `live: true`, the not-yet-aggregated tail.
 *
 * Two traps encoded here rather than at the call site:
 *   • A backfilled point with `calls: 0` is a MEASURED zero ("we looked at the
 *     raw spans and it genuinely did not run"), which is the one case where
 *     plotting zero is correct and honest.
 *   • Windows with no ingest at all are absent from `series` entirely. The
 *     array is therefore sparse and unevenly spaced — never index-addressed.
 */

import type { HistoryPoint } from "@/services/db_monitoring";

/**
 * How one point must render. The band forms carry no value, so a renderer that
 * asks for `value` on them gets `null` rather than a plausible-looking zero.
 */
export type DbmPointKind = "measured" | "backfilled" | "unmeasured" | "live";

export interface DbmHistoryPoint {
  /** Window END, microseconds — never a start. */
  timestamp: number;
  kind: DbmPointKind;
  /**
   * Whether this point may be drawn on the value axis at all. False for
   * `unmeasured`, which has no number and must render as a band instead.
   */
  plottable: boolean;
  point: HistoryPoint;
}

/** A contiguous run of below-top-N windows, rendered as one hatched band. */
export interface DbmHistoryBand {
  /** First window END in the run, microseconds. */
  from: number;
  /** Last window END in the run, microseconds. */
  to: number;
  /** Windows in the run — a one-window band still gets a visible width. */
  count: number;
}

export interface DbmHistorySeries {
  points: DbmHistoryPoint[];
  /**
   * Runs of `unmeasured` windows, for the chart's markArea. Adjacent windows
   * are merged so a 40-window gap is one band, not 40 stripes.
   */
  bands: DbmHistoryBand[];
  /** Where the live segment starts, microseconds, or `null` when absent. */
  liveFrom: number | null;
  /** More below-top-N windows than the backfill budget — fidelity varies. */
  backfillCapped: boolean;
  /** Any below-top-N window at all, whether backfilled or not. */
  hasBelowTopN: boolean;
}

/** A point is live when the tail produced it. Checked first — it also has metrics. */
const isLive = (point: HistoryPoint): boolean => point.live === true;

/**
 * Whether a below-top-N point carries usable metrics.
 *
 * `calls` is the discriminator rather than a latency field: the backfill's
 * genuine-zero arm emits `calls: 0` and nothing else, and that zero IS the
 * measurement. Testing a percentile instead would misclassify it as unmeasured
 * and hide a real "it did not run" finding behind a band.
 */
const hasMetrics = (point: HistoryPoint): boolean =>
  point.calls !== undefined && point.calls !== null;

export const classifyPoint = (point: HistoryPoint): DbmPointKind => {
  if (isLive(point)) return "live";
  if (point.below_top_n) return hasMetrics(point) ? "backfilled" : "unmeasured";
  return "measured";
};

/**
 * Merge sorted timestamps into runs. `interval` is the rollup window length in
 * microseconds; two windows join one band when they are within one interval of
 * each other, so an unrelated gap elsewhere in the range does not get swallowed.
 */
const mergeRuns = (timestamps: number[], interval: number): DbmHistoryBand[] => {
  const bands: DbmHistoryBand[] = [];
  // A non-positive interval would make every window its own band; treat any
  // adjacency as contiguous instead of emitting a stripe per window.
  const tolerance = interval > 0 ? interval * 1.5 : Number.POSITIVE_INFINITY;

  for (const timestamp of timestamps) {
    const last = bands[bands.length - 1];
    if (last && timestamp - last.to <= tolerance) {
      last.to = timestamp;
      last.count += 1;
    } else {
      bands.push({ from: timestamp, to: timestamp, count: 1 });
    }
  }
  return bands;
};

/**
 * Build the render model for a history response.
 *
 * Sorts defensively: the handler appends the live point AFTER its own sort, so
 * the array is "ascending, then one appended point". That happens to be correct
 * today only because the tail is the newest window — relying on it would make
 * the chart depend on an ordering the server never promised.
 */
export const buildHistorySeries = (
  series: HistoryPoint[],
  options: { intervalMicros: number; backfillCapped?: boolean },
): DbmHistorySeries => {
  const sorted = [...series].sort((a, b) => a.timestamp - b.timestamp);

  const points = sorted.map<DbmHistoryPoint>((point) => {
    const kind = classifyPoint(point);
    return { timestamp: point.timestamp, kind, plottable: kind !== "unmeasured", point };
  });

  const bands = mergeRuns(
    points.filter((p) => p.kind === "unmeasured").map((p) => p.timestamp),
    options.intervalMicros,
  );

  const live = points.find((p) => p.kind === "live");
  // The live segment is drawn from the LAST aggregated point to the tail, so
  // the dashed run connects to the solid line instead of floating detached.
  const lastAggregated = [...points].reverse().find((p) => p.kind !== "live" && p.plottable);

  return {
    points,
    bands,
    liveFrom: live ? (lastAggregated?.timestamp ?? live.timestamp) : null,
    backfillCapped: options.backfillCapped === true,
    hasBelowTopN: points.some((p) => p.kind === "backfilled" || p.kind === "unmeasured"),
  };
};

/**
 * Values for one metric across the series, aligned 1:1 with `points`.
 *
 * `null` for any window that has no measurement — ECharts renders a null as a
 * break in the line, which is the honest rendering. A `0` here would be the bug
 * this whole module exists to prevent, so the extractor never coerces.
 */
export const seriesValues = (
  points: DbmHistoryPoint[],
  metric: keyof HistoryPoint,
): (number | null)[] =>
  points.map((entry) => {
    if (!entry.plottable) return null;
    const value = entry.point[metric];
    return typeof value === "number" ? value : null;
  });

/**
 * Calls per second for each window. The rate is per-window, so the divisor is
 * the rollup interval rather than the page's time range — dividing by the range
 * would under-report by the number of windows shown.
 */
export const qpsValues = (points: DbmHistoryPoint[], intervalMicros: number): (number | null)[] => {
  const seconds = intervalMicros / 1_000_000;
  if (!(seconds > 0)) return points.map(() => null);
  return points.map((entry) => {
    if (!entry.plottable) return null;
    const calls = entry.point.calls;
    return typeof calls === "number" ? calls / seconds : null;
  });
};

/**
 * Error rate per window, `0`–`1`. Returns `null` when a window had no calls:
 * "no errors out of nothing" is not a 0% error rate, and plotting it as one
 * draws a reassuring flat line through a window we know nothing about.
 */
export const errorRateValues = (points: DbmHistoryPoint[]): (number | null)[] =>
  points.map((entry) => {
    if (!entry.plottable) return null;
    const calls = entry.point.calls ?? 0;
    if (calls <= 0) return null;
    return (entry.point.errors ?? 0) / calls;
  });
