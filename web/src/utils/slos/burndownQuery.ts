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
 * Reading an SLO's measurement history out of the `slo_slices` stream, and
 * turning it into the two series the detail page draws.
 *
 * The slices are the record; `slo_status` is only a running aggregate cache of
 * the CURRENT window, so it can render a number but not a trend. Everything
 * here therefore goes to the stream.
 *
 * The arithmetic mirrors `config::meta::slo::math` exactly — same formulas,
 * same undefined-vs-zero rule — because these charts sit directly under the
 * stat tiles that the Rust side derives. Two implementations of "burn rate"
 * that disagree by a rounding convention is a support ticket.
 */

/** One bucketed row as the search API returns it. */
export interface SloSliceBucket {
  bucket: number;
  good: number;
  total: number;
}

/** One point on both charts. `null` means unmeasured — never zero (D34). */
export interface SloBurndownPoint {
  /** Bucket start, epoch SECONDS (`slice_start`'s unit). */
  ts: number;
  /** Signed percentage of the error budget still unspent, cumulative. */
  remaining: number | null;
  /** Burn rate for THIS bucket alone — multiples of budget-neutral. */
  burn: number | null;
}

/** The reserved stream slices are written to (`SLO_SLICES_STREAM`). */
export const SLO_SLICES_STREAM = "slo_slices";

/** Roughly how many points to draw. Enough to show shape, few enough that a
 *  90-day window at a 1-minute slice interval (129,600 slices) still returns a
 *  payload a browser can chart without thinning it again. */
const TARGET_POINTS = 180;

/**
 * Bucket width in seconds: the slice interval, widened to keep the point count
 * near {@link TARGET_POINTS}. Always a MULTIPLE of the slice interval, so a
 * bucket boundary never splits a slice.
 */
export function bucketSecsFor(windowSecs: number, sliceIntervalSecs: number): number {
  const slice = Math.max(1, Math.floor(sliceIntervalSecs));
  if (windowSecs <= 0) return slice;
  const multiple = Math.ceil(windowSecs / TARGET_POINTS / slice);
  return slice * Math.max(1, multiple);
}

/** Single-quote escaping for a SQL string literal. */
function quoteLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Bucketed good/total for one SLO's rollup series.
 *
 * Three things here are load-bearing and none are obvious:
 *
 * 1. **Buckets on `slice_start`, not `_timestamp`.** `_timestamp` is when the
 *    slice was WRITTEN; `slice_start` is what it measures. Backfill writes
 *    ninety days of history with today's `_timestamp`, so bucketing on the
 *    latter stacks the entire backfill onto one column at "now".
 * 2. **`rev` dedupe.** Late data and recomputes republish the same
 *    `(slo_id, generation, group_key, slice_start)` at a higher `rev`, and the
 *    stream keeps every copy — readers are expected to take the highest (D54).
 *    A plain `SUM(good)` counts a revised slice twice. Same ROW_NUMBER shape
 *    `latestScoresFromSql` uses for this problem elsewhere.
 * 3. **`definition_generation` is mandatory.** A generation bump is a clean
 *    break rather than a migration (D59); dropping the filter splices two
 *    different SLO definitions into one line. `group_key = ''` is the rollup
 *    series (S-9) — without it every group sums on top of the rollup.
 */
export function buildSloBurndownQuery(opts: {
  sloId: string;
  generation: number;
  /** Window start, epoch seconds — the left edge of the chart. */
  startSecs: number;
  bucketSecs: number;
}): string {
  const { sloId, generation, startSecs, bucketSecs } = opts;
  const bucket = Math.max(1, Math.floor(bucketSecs));
  // Repeated verbatim in SELECT and GROUP BY rather than grouping by the
  // alias: alias-in-GROUP-BY is an extension, and this query is not the place
  // to depend on one.
  const bucketExpr = `CAST(FLOOR(slice_start / ${bucket}) * ${bucket} AS BIGINT)`;
  return [
    `SELECT ${bucketExpr} AS bucket,`,
    `       SUM(good) AS good,`,
    `       SUM(total) AS total`,
    `FROM (`,
    `  SELECT slice_start, good, total,`,
    `         ROW_NUMBER() OVER (`,
    `           PARTITION BY slice_start ORDER BY rev DESC`,
    `         ) AS rn`,
    `  FROM "${SLO_SLICES_STREAM}"`,
    `  WHERE slo_id = '${quoteLiteral(sloId)}'`,
    `    AND definition_generation = ${Math.floor(generation)}`,
    `    AND group_key = ''`,
    `    AND slice_start >= ${Math.floor(startSecs)}`,
    `) AS deduped`,
    `WHERE rn = 1`,
    `GROUP BY ${bucketExpr}`,
    `ORDER BY bucket`,
  ].join("\n");
}

/**
 * The window's error budget in ABSOLUTE bad events — how many failures the
 * target affords over everything the window actually saw.
 *
 * Exported because it is the unit of the burndown chart's second y-axis:
 * `remaining %` is a share of THIS number, so `budget × remaining ÷ 100` is
 * "errors we can still afford". Same denominator `toBurndownSeries` divides
 * by, from the same function, so the two axes cannot drift apart.
 *
 * Returns 0 when the target leaves no budget (100%) or nothing was measured —
 * both mean "there is no second scale to draw".
 */
export function budgetedBadFor(buckets: SloSliceBucket[], target: number): number {
  const budgetWidth = 100 - target;
  if (!(budgetWidth > 0)) return 0;
  const totalAll = buckets.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
  return (totalAll * budgetWidth) / 100;
}

/**
 * The window's budget in the unit its SLI type actually counts.
 *
 * `budgetedBadFor` returns whatever `good`/`total` were recorded in, and that
 * differs by SLI type: a count SLI records EVENTS, while a type that scores a
 * whole slice records SECONDS — `classify_time_slice` reports a good slice as
 * `(interval, interval)`. Dividing by the slice interval turns those seconds
 * back into slices.
 *
 * Getting this wrong is not a rounding error: at a 5-minute interval it labels
 * 30,240 seconds as "30,240 slices" when the honest answer is 101, so the
 * reader is off by the whole interval in the direction that sounds reassuring.
 */
export function budgetUnitsFor(
  budgetedBad: number,
  sliType: string | undefined,
  sliceIntervalSecs: number,
): number {
  const scoresWholeSlices = sliType === "time_slice" || sliType === "alert";
  if (!scoresWholeSlices) return budgetedBad;
  return budgetedBad / Math.max(1, Math.floor(sliceIntervalSecs) || 1);
}

/**
 * Fold bucketed counts into the burndown and burn-rate series.
 *
 * The two differ in the window they read over, which is the whole distinction
 * `math.rs` draws: **burndown is CUMULATIVE SPEND against a fixed budget**,
 * while **burn rate is a per-bucket rate** (how fast the budget is going right
 * now). Using one window for both is the classic burndown bug: a cumulative
 * burn rate flattens into a straight line and stops showing incidents.
 *
 * A bucket with no events yields `null` on both series, never `0`. `sli()` is
 * undefined when there is nothing to divide by — a covered window with zero
 * events is not 100% and not 0% — and echarts renders `null` as a gap, which
 * is what "we did not measure this" should look like. Zeroes would draw a
 * total outage.
 */
export function toBurndownSeries(buckets: SloSliceBucket[], target: number): SloBurndownPoint[] {
  // A 100% target leaves a zero-width budget: every formula below divides by
  // (100 - target). Nothing is drawable, and NaN/Infinity down the series is
  // worse than an empty chart.
  const budgetWidth = 100 - target;
  if (!(budgetWidth > 0)) return [];

  const sorted = [...buckets].sort((a, b) => a.bucket - b.bucket);

  // THE DENOMINATOR IS THE WHOLE WINDOW, not the events seen so far.
  //
  // `math.rs` qualifies its identity precisely — `consumed% = 100 × burn_rate(W)`
  // holds "over the full window W". Feeding it a running SLI over
  // [windowStart, T] instead answers a different question ("if this rate held
  // for the whole window, how much budget would that cost?"), and the answer
  // is degenerate early on: a service running exactly at target reads 0%
  // remaining from its very first bucket, and one bad bucket at the start
  // plunges the line to -49900% and then CLIMBS as later traffic dilutes it.
  // A burndown that rises is not a burndown.
  //
  // This is knowable here precisely because the chart's window is entirely in
  // the past: the budget is a fixed share of the events the window actually
  // saw, so it can be computed once up front and spent down against.
  const budgetedBad = budgetedBadFor(sorted, target);

  let cumBad = 0;
  let measured = false;

  return sorted.map((b) => {
    const good = Number(b.good) || 0;
    const total = Number(b.total) || 0;
    if (total > 0) measured = true;
    cumBad += total - good;

    // Budget spent so far, as a share of the window's whole budget. Monotonic
    // by construction — `cumBad` only grows — which is the property that makes
    // this readable as a burndown. At the last bucket it is identically
    // `error_budget_remaining(sli_window, target)`, so the line lands exactly
    // on the stat tile above it.
    //
    // `measured` withholds the line until something has actually been
    // observed: drawing a flat 100% across a leading gap would render
    // unmeasured time as a full budget (D34).
    const remaining = measured && budgetedBad > 0 ? 100 * (1 - cumBad / budgetedBad) : null;

    // Per bucket, NOT cumulative: `burn_rate(sli_bucket, target)`. This one is
    // a rate, so the partial-window objection above does not apply — a rate
    // read over one bucket is exactly what "how fast is it burning now" means.
    const burn = total > 0 ? (100 - (100 * good) / total) / budgetWidth : null;

    return { ts: Number(b.bucket) || 0, remaining, burn };
  });
}
