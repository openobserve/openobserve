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
 * Build the preview query for ONE side of a count SLI — good or bad.
 *
 * Same CASE-SUM shape the ingest pass uses (`single_count_sql`), so what the
 * preview draws is what the SLO will measure: `good` counts rows matching the
 * predicate, `bad` counts the complement within the same scope. Both project
 * `zo_sql_num`, so the two charts differ only in label and colour.
 *
 * A filtered COUNT would drop empty buckets entirely, making "everything was
 * bad" indistinguishable from "no traffic" — for a count SLI those mean
 * opposite things.
 *
 * Returns `null` when there is nothing drawable yet (no stream or no
 * good-when expression) — better no chart than a chart of the wrong thing.
 */
export function buildSloPreviewQuery(
  stream: string | undefined,
  scope: string | undefined,
  goodExpr: string | undefined,
  series: "good" | "bad",
): string | null {
  const s = stream?.trim();
  const good = goodExpr?.trim();
  if (!s || !good) return null;

  // Parenthesised for the same reason the ingest builder parenthesises: a
  // user fragment like `a OR b` must not re-associate against anything
  // appended around it.
  const branches = series === "good" ? "THEN 1 ELSE 0" : "THEN 0 ELSE 1";
  let sql =
    `SELECT histogram(_timestamp) AS zo_sql_key, ` +
    `SUM(CASE WHEN (${good}) ${branches} END) AS zo_sql_num ` +
    `FROM ${quoteIdent(s)}`;
  const sc = scope?.trim();
  if (sc) sql += ` WHERE (${sc})`;
  return sql + " GROUP BY zo_sql_key";
}

/** Same quoting rule as the ingest pass's query builder. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The aliases `time_slice_sql` projects (`query.rs`). Mirrored so a preview
 *  result and an ingest result are the same shape, and a question about one
 *  can be answered by reading the other. */
export const SLICE_ALIAS = "slice_start";
export const VALUE_ALIAS = "zo_slo_value";

/** Bucket width in the form `histogram()` accepts — the TS twin of
 *  `config::meta::slo::interval_literal`. */
export function intervalLiteral(sliceIntervalSecs: number): string {
  switch (sliceIntervalSecs) {
    case 60:
      return "1 minute";
    case 300:
      return "5 minute";
    default:
      return `${Math.max(1, Math.floor(sliceIntervalSecs))} second`;
  }
}

/**
 * Preview query for a TIME-SLICE SLI: one aggregate per slice, no
 * classification.
 *
 * The shape is `time_slice_sql`'s exactly, and the omission is the point —
 * the ingest pass does not put the threshold in SQL either. A time-slice SLI
 * aggregates first and classifies afterwards, so that a threshold edit
 * re-reads the stored aggregates instead of making old slices and the new
 * definition disagree. The preview classifies the same way, in
 * {@link classifyPreviewSlices}, from the same numbers.
 *
 * Returns `null` when there is nothing drawable yet.
 */
export function buildSloTimeSlicePreviewQuery(opts: {
  stream: string | undefined;
  scope?: string;
  /** The aggregate expression, e.g. `approx_percentile_cont(latency, 0.95)`. */
  aggregate: string | undefined;
  sliceIntervalSecs: number;
}): string | null {
  const stream = opts.stream?.trim();
  const aggregate = opts.aggregate?.trim();
  if (!stream || !aggregate) return null;

  let sql =
    `SELECT histogram(_timestamp, '${intervalLiteral(opts.sliceIntervalSecs)}') AS ${SLICE_ALIAS}, ` +
    `${aggregate} AS ${VALUE_ALIAS} ` +
    `FROM ${quoteIdent(stream)}`;
  const scope = opts.scope?.trim();
  // Parenthesised: the user fragment must not re-associate against anything
  // appended around it.
  if (scope) sql += ` WHERE (${scope})`;
  return sql + ` GROUP BY ${SLICE_ALIAS} ORDER BY ${SLICE_ALIAS}`;
}

/** A PromQL preview evaluation, in the shape the range API takes. */
export interface SloPromqlPreviewRange {
  query: string;
  /** MICROSECONDS — the unit `start`/`end` parse to. */
  start_time: number;
  end_time: number;
  /** A duration, where a bare number means SECONDS. */
  step: string;
}

/**
 * Preview range for ANY PromQL SLI — the TS twin of `prom_query` (`query.rs`),
 * so the preview measures slices the way the ingest pass does.
 *
 * Shared across the SLI shapes because `prom_query` is: a count source's `good`
 * and `total` and a time slice's aggregate are all evaluated on the same
 * instants, and two copies of that rule could drift.
 *
 * PromQL evaluates AT instants, and a sample at T with a slice-wide range
 * selector covers (T-interval, T]. So the instants are the slice ENDS: first =
 * start + interval, last = end. {@link promqlSliceStart} is the inverse. The
 * two are one rule: a drift between them is a whole-slice time shift that is
 * invisible in the values and wrong in every one of them. (The preview's range
 * is not snapped to the slice grid, so its slices are phase-shifted against the
 * stored ones — the shape is the same, the boundaries are not.)
 *
 * The expression is passed through untouched, as the plan passes it — never
 * wrapped in `sum by (…)`: grouping comes from the labels the returned series
 * already carry, and summing four pods' p95 is not a p95 of anything.
 *
 * Returns `null` when there is nothing to run.
 */
export function buildSloPromqlPreviewRange(opts: {
  expr: string | undefined;
  startSecs: number;
  endSecs: number;
  sliceIntervalSecs: number;
}): SloPromqlPreviewRange | null {
  const expr = opts.expr?.trim();
  if (!expr) return null;
  return {
    query: expr,
    start_time: (opts.startSecs + opts.sliceIntervalSecs) * 1_000_000,
    end_time: opts.endSecs * 1_000_000,
    step: String(opts.sliceIntervalSecs),
  };
}

/** Which slice a PromQL sample taken at `tSecs` covers. Subtraction, not a
 *  snap to the grid — `promql_value_rows` subtracts too. */
export function promqlSliceStart(tSecs: number, sliceIntervalSecs: number): number {
  return tSecs - sliceIntervalSecs;
}

/** One matrix series as `/api/v1/query_range` returns it. Deliberately loose:
 *  this is untyped wire data, and the timestamp is only usually a number. */
export interface PromqlMatrixSeries {
  metric?: Record<string, string>;
  values?: Array<[unknown, unknown]>;
}

/** One drawable point: epoch MILLISECONDS (what the chart wants), and the
 *  slice's value, or `null` for a slice nothing could be read from. */
export interface SloPreviewPoint {
  ts: number;
  value: number | null;
}

/**
 * Fold a PromQL range evaluation into the per-slice counts a count preview
 * draws, following `promql_rows`' accumulator (`job.rs`).
 *
 * Two rules taken from there. A sample at instant T measures the slice it
 * CLOSES, so `slice_start = T - interval`. Series landing on the same slice are
 * SUMMED — two pods' `increase()` genuinely add up, which is the one place this
 * differs from the time-slice reader, where two p95s do not.
 *
 * A slice with ANY unreadable sample is a gap rather than the sum of the rest:
 * `promql_rows` accumulates with a bare `+=`, so one NaN makes the whole slice
 * NaN and the row is rejected downstream. Drawing the readable remainder would
 * promise a measurement the SLO is not going to record.
 *
 * ONE deliberate departure: `promql_rows` keys on `(slice_start, group_key)`,
 * this keys on the slice alone. A grouped SLO scores each group separately, and
 * what the preview shows is the rollup across all of them. That is the right
 * summary for a count — unlike the time-slice reader, nothing here is
 * mathematically invalid to add — but it is not the per-group series the SLO
 * will record.
 */
export function promqlCountSeriesPoints(
  series: PromqlMatrixSeries[],
  sliceIntervalSecs: number,
): SloPreviewPoint[] {
  const slices = new Map<number, number>();
  for (const one of series) {
    for (const sample of one.values ?? []) {
      // Before anything else: `Number(null)` is 0, so a null instant would fall
      // through and plot itself at 1970 rather than being dropped.
      const rawTs = sample?.[0];
      if (rawTs === null || rawTs === undefined || rawTs === "") continue;
      const tSecs = Number(rawTs);
      if (!Number.isFinite(tSecs)) continue;
      const ts = promqlSliceStart(tSecs, sliceIntervalSecs) * 1000;
      // Guarded like the instant above, and for the same reason: `Number(null)`
      // and `Number("")` are both 0, which would add a confident zero for a
      // sample nothing could be read from.
      const rawValue = sample[1];
      const unreadable = rawValue === null || rawValue === undefined || rawValue === "";
      slices.set(ts, (slices.get(ts) ?? 0) + (unreadable ? Number.NaN : Number(rawValue)));
    }
  }
  return [...slices.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, sum]) => ({ ts, value: Number.isFinite(sum) ? sum : null }));
}

/** What a run of preview slices came to, in the terms the target is set in. */
export interface PreviewSliceTally {
  good: number;
  bad: number;
  /** Buckets whose aggregate was not a finite number. NOT bad — see below. */
  unmeasured: number;
  /** Good + bad. Excludes unmeasured, which no SLI can be computed from. */
  measured: number;
  /** Percentage of measured slices that were good, or `null` if none were. */
  sli: number | null;
}

/**
 * Score preview slices the way `classify_time_slice` scores real ones.
 *
 * The non-finite check comes BEFORE the comparison, and that ordering is the
 * whole subtlety: a null or NaN aggregate compares false against every
 * operator, so falling through to the comparison would record a bucket nobody
 * could measure as real downtime. It is withheld instead, exactly as the
 * ingest pass rejects it and lets coverage fall.
 *
 * An unknown comparator is unmeasurable for the same reason rather than bad —
 * inventing downtime from a definition we cannot read is the worse failure.
 */
export function classifyPreviewSlices(
  values: Array<number | null | undefined>,
  comparator: string,
  threshold: number,
): PreviewSliceTally {
  let good = 0;
  let bad = 0;
  let unmeasured = 0;

  for (const raw of values) {
    const value = Number(raw);
    if (
      raw === null ||
      raw === undefined ||
      !Number.isFinite(value) ||
      !Number.isFinite(threshold)
    ) {
      unmeasured++;
      continue;
    }
    let isGood: boolean;
    switch (comparator) {
      case "<":
        isGood = value < threshold;
        break;
      case "<=":
        isGood = value <= threshold;
        break;
      case ">":
        isGood = value > threshold;
        break;
      case ">=":
        isGood = value >= threshold;
        break;
      default:
        unmeasured++;
        continue;
    }
    if (isGood) good++;
    else bad++;
  }

  const measured = good + bad;
  return { good, bad, unmeasured, measured, sli: measured > 0 ? (100 * good) / measured : null };
}

/**
 * Replace the identifier being typed at the end of `text` with a picked field
 * name — the splice behind the scope/good-when typeahead. OCombobox replaces
 * the WHOLE input on select, so the caller closes this over the live text.
 */
export function replaceTrailingFieldToken(text: string | undefined, field: string): string {
  const t = text ?? "";
  if (/[\w.]+$/.test(t)) {
    return t.replace(/[\w.]+$/, field);
  }
  return t + field;
}

/**
 * The needle regex the typeahead filters on: the identifier at the END of the
 * expression. `status_code < 5` ends in "5" — no field starts with it, so the
 * suggestion list simply stays closed mid-value.
 */
export const FIELD_TOKEN_REGEX = "([\\w.]+)$";
