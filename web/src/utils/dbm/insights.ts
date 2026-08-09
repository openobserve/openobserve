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
 * DBM insight rules — the deterministic "what changed" layer.
 *
 * Every rule here is a PREDICATE OVER TWO WINDOWS, nothing more. There is no
 * model, no correlation search and no ranking heuristic: an insight fires when
 * arithmetic on fields we already hold crosses a stated threshold, and the card
 * shows that arithmetic. That is deliberate — the insight products users
 * distrust are the ones that guess, so a card we cannot explain is a card we
 * do not render.
 *
 * Two invariants the callers depend on:
 *
 *  • No rule asserts a CAUSE. I1 says "slower than its baseline", never
 *    "slower because the plan changed" — we cannot see the plan at P0.
 *  • Every rule returns the fingerprints that triggered it, so a card is
 *    always a filter into the table rather than a notification dead-end.
 *
 * Rule text is `dbm-user-insights.md` §3 (I1, I2, I5, I6, I8) and the
 * completion-bias banner from §4. Thresholds are transcribed from that doc and
 * exported so the UI can print the rule it applied.
 */

import type { DbTotalsRow, QueryStatsRow } from "@/services/db_monitoring";

/** Which insight fired. Ids match the rule numbering in the insights doc. */
export type DbmInsightId =
  "regression" | "new-expensive" | "n-plus-one" | "volume-shift" | "rank-churn" | "all-failing";

/** Severity drives the card's tone; it is a consequence of the rule, not a knob. */
export type DbmInsightTone = "error" | "warning" | "info";

/**
 * One fired insight. `fingerprints` is what makes the card actionable — the
 * caller filters the table to exactly these rows.
 */
export interface DbmInsight {
  id: DbmInsightId;
  tone: DbmInsightTone;
  /** The fingerprints that triggered the rule, ranked most-impactful first. */
  fingerprints: string[];
  /**
   * Numbers for the card's sentence and its visible rule line. Kept as raw
   * values so the view owns all formatting and translation.
   */
  evidence: DbmInsightEvidence;
}

export interface DbmInsightEvidence {
  /** The row the headline sentence is about (the highest-impact trigger). */
  row: QueryStatsRow;
  /** How many rows in total tripped the rule. */
  count: number;
  /** Current-window value the rule compared (unit depends on the rule). */
  current?: number;
  /** Baseline / previous-window value it was compared against. */
  baseline?: number;
  /** Ratio of current to baseline, when the rule is a ratio test. */
  ratio?: number;
  /** Share of the scope's total time, `0`–`1`, when the rule uses one. */
  share?: number;
  /** Calls-per-trace, for the N+1 rule. A LOWER bound — traces is an upper bound. */
  callsPerTrace?: number;
  /** Rank movement, for the churn rule. */
  fromRank?: number;
  toRank?: number;
}

/**
 * Thresholds, transcribed from `dbm-user-insights.md` §3. Exported because the
 * UI prints them: a card states the rule that fired it, so the numbers on
 * screen and the numbers in the predicate cannot drift apart.
 */
export const DBM_INSIGHT_RULES = {
  regression: {
    /** p95 must exceed this multiple of the previous window's p95. */
    latencyRatio: 3,
    /** Below this call count a percentile is too jumpy to trust. */
    minCalls: 20,
    /** Volume must not have collapsed, or the p95 rise is a sampling artifact. */
    minVolumeRatio: 0.5,
    /** Below this the query is too fast for a 3x rise to matter. 5ms in ns. */
    minBaselineNs: 5_000_000,
  },
  newExpensive: {
    /** Must be at least this share of the scope's total time to be worth a card. */
    minShare: 0.05,
    minCalls: 10,
  },
  nPlusOne: {
    /** Calls per trace at or above this looks like a loop. */
    minCallsPerTrace: 10,
    minTraces: 20,
    minShare: 0.02,
  },
  volumeShift: {
    /** Calls must exceed this multiple of the previous window. */
    callsRatio: 3,
    /** ...while p95 stayed at or below this multiple (i.e. it did NOT get slower). */
    maxLatencyRatio: 1.3,
    minShare: 0.1,
  },
  rankChurn: {
    /** Only movement into the top 5 counts. */
    intoRank: 5,
    /** ...from outside the top 20. */
    fromRank: 20,
    /** Total time must have grown, or nobody cares who is #4. */
    minTotalRatio: 1.2,
  },
  allFailing: {
    /**
     * EVERY call failed. Not "most" — the total-failure case is qualitatively
     * different from a raised error rate: it means the statement cannot
     * currently succeed at all, which is a different action (look at locks or
     * a schema change) from a partial failure (look at the inputs). A
     * threshold below 1 would blur the two.
     */
    minErrorShare: 1,
    /** Below this, "all of them failed" is a handful of calls, not a signal. */
    minCalls: 20,
  },
  /** §4 minute 5-8: the lock-storm pattern that reads as recovery. */
  completionBias: {
    /** Calls collapsed to below this multiple of the previous window... */
    maxCallsRatio: 0.5,
    /** ...while errors rose above this multiple. */
    minErrorRatio: 2,
  },
} as const;

// ─── Row helpers ─────────────────────────────────────────────────────────────

/**
 * Every metric on a row is optional: `merge_rows` only emits a key when a
 * constituent row carried it. A missing metric is 0 for arithmetic, but see
 * `deltaFor` for why a missing ROW is emphatically not 0.
 */
const num = (value: number | undefined): number => value ?? 0;

/** Identity of a `query_stats` row: one fingerprint on one (system, instance). */
export const rowKey = (row: Pick<QueryStatsRow, "fingerprint" | "db_system" | "db_instance">) =>
  `${row.fingerprint}\u0000${row.db_system}\u0000${row.db_instance}`;

/** Identity of a `db_totals` row: one (system, instance, namespace). */
export const totalsKey = (row: Pick<DbTotalsRow, "db_system" | "db_instance" | "db_namespace">) =>
  `${row.db_system}\u0000${row.db_instance}\u0000${row.db_namespace ?? ""}`;

export const sumTotalTime = (rows: Pick<QueryStatsRow, "total_time_ns">[]): number =>
  rows.reduce((acc, row) => acc + num(row.total_time_ns), 0);

/** Index rows by `rowKey` for previous-window lookup. */
export const indexByKey = (rows: QueryStatsRow[]): Map<string, QueryStatsRow> => {
  const map = new Map<string, QueryStatsRow>();
  for (const row of rows) map.set(rowKey(row), row);
  return map;
};

/**
 * Share of a scope's total time, `0`–`1`. Returns `0` rather than `NaN` on an
 * empty scope so a threshold test never silently passes.
 */
export const shareOfTotal = (value: number | undefined, total: number): number =>
  total > 0 ? num(value) / total : 0;

// ─── Δ vs previous window ────────────────────────────────────────────────────

/**
 * The three states a window-over-window delta can be in.
 *
 * `new` is the one that matters and the one that is routinely got wrong: a
 * fingerprint absent from the previous window has NO delta. Rendering it as
 * -100% (or +100%, or 0) invents a comparison against a number that does not
 * exist, and at 2am that reads as "this collapsed" when the truth is "this
 * appeared". It is a distinct state with its own label, never a percentage.
 */
export type DbmDeltaState = "changed" | "new" | "gone";

export interface DbmDelta {
  state: DbmDeltaState;
  /** Current-window value. `undefined` when the row is `gone`. */
  current?: number;
  /** Previous-window value. `undefined` when the row is `new`. */
  previous?: number;
  /**
   * Signed fractional change, e.g. `0.25` = +25%. ONLY present when
   * `state === "changed"` AND the previous value was non-zero — a ratio
   * against zero is undefined, not infinite.
   */
  ratio?: number;
}

/**
 * Compare one metric across two windows.
 *
 * Deliberately total: every (present/absent x present/absent) combination
 * returns a state rather than throwing or coercing, because the caller renders
 * one cell per row and cannot handle a gap.
 */
export const deltaFor = (current: number | undefined, previous: number | undefined): DbmDelta => {
  const hasCurrent = current !== undefined && current !== null;
  const hasPrevious = previous !== undefined && previous !== null;

  // Absent before, present now: an arrival, not a rise from zero.
  if (hasCurrent && !hasPrevious) return { state: "new", current };
  // Present before, absent now: a disappearance. Reported so a query that
  // stopped running is visible rather than silently dropping off the table.
  if (!hasCurrent && hasPrevious) return { state: "gone", previous };
  if (!hasCurrent && !hasPrevious) return { state: "new" };

  const cur = current as number;
  const prev = previous as number;
  // A previous value of zero has no meaningful ratio (any rise is infinite),
  // so the delta carries both numbers and no percentage.
  if (prev === 0) return { state: "changed", current: cur, previous: prev };
  return { state: "changed", current: cur, previous: prev, ratio: (cur - prev) / prev };
};

/** `deltaFor` over the two rows' `total_time_ns` — the table's Δ column. */
export const totalTimeDelta = (
  current: QueryStatsRow | undefined,
  previous: QueryStatsRow | undefined,
): DbmDelta => deltaFor(current?.total_time_ns, previous?.total_time_ns);

/**
 * `deltaFor` over call counts, and over the slow tail.
 *
 * These are the two halves of the 2am discriminator. "Slower" and "called more
 * often" both raise total database time, but they have opposite fixes — one is
 * the query, the other is whatever calls it — and a single Δ column on total
 * time cannot tell them apart. So the table carries the change in each metric
 * NEXT TO that metric, and the reader gets the discriminator by reading across
 * rather than by opening a detail page.
 */
export const callsDelta = (
  current: QueryStatsRow | undefined,
  previous: QueryStatsRow | undefined,
): DbmDelta => deltaFor(current?.calls, previous?.calls);

export const latencyDelta = (
  current: QueryStatsRow | undefined,
  previous: QueryStatsRow | undefined,
): DbmDelta => deltaFor(current?.p95_ns, previous?.p95_ns);

// ─── The rules ───────────────────────────────────────────────────────────────

/** Rank fingerprints by current-window total time, most expensive first. */
const byTotalTimeDesc = (a: QueryStatsRow, b: QueryStatsRow) =>
  num(b.total_time_ns) - num(a.total_time_ns);

export interface DbmInsightInput {
  /** Current-window rows (the `hits` array, `_other` already excluded). */
  rows: QueryStatsRow[];
  /** Previous-window rows from the same endpoint over the shifted range. */
  previousRows: QueryStatsRow[];
  /**
   * Total time the shares are measured against — `hits` + `other`, so the
   * denominator is the whole scope rather than only what is on screen.
   */
  scopeTotalTimeNs: number;
  /** Previous-window equivalent, for the rank-churn total-growth gate. */
  previousScopeTotalTimeNs: number;
}

/**
 * I1 · Query regression — "it was fast yesterday".
 *
 * p95 tripled at flat volume. Four guards keep it honest, and each one exists
 * because of a specific false positive:
 *   • minCalls    — a percentile over 3 calls is noise.
 *   • volume ratio— a query whose volume collapsed will show a wild p95; that
 *                   is a sampling artifact, not a regression.
 *   • baseline floor — a 0.1ms query going to 0.3ms is not an incident.
 *   • fp_version  — a normalizer bump re-buckets traffic and MANUFACTURES
 *                   regressions. Comparing across versions is meaningless.
 */
export const detectRegression = (input: DbmInsightInput): DbmInsight | null => {
  const { latencyRatio, minCalls, minVolumeRatio, minBaselineNs } = DBM_INSIGHT_RULES.regression;
  const previous = indexByKey(input.previousRows);

  const triggered = input.rows.filter((row) => {
    const prev = previous.get(rowKey(row));
    if (!prev) return false;
    // A fingerprint version bump makes the two windows incomparable.
    if (row.fp_version !== prev.fp_version) return false;

    const basePct = num(prev.p95_ns);
    if (basePct < minBaselineNs) return false;
    if (num(row.calls) < minCalls) return false;
    if (num(row.calls) < minVolumeRatio * num(prev.calls)) return false;
    return num(row.p95_ns) > latencyRatio * basePct;
  });

  if (!triggered.length) return null;
  const ranked = [...triggered].sort(byTotalTimeDesc);
  const top = ranked[0];
  const prevTop = previous.get(rowKey(top));
  const baseline = num(prevTop?.p95_ns);

  return {
    id: "regression",
    tone: "error",
    fingerprints: ranked.map((r) => r.fingerprint),
    evidence: {
      row: top,
      count: ranked.length,
      current: num(top.p95_ns),
      baseline,
      ratio: baseline > 0 ? num(top.p95_ns) / baseline : undefined,
    },
  };
};

/**
 * I2 · New expensive query — the deploy-triage card.
 *
 * Absent from the previous window and already a meaningful share of database
 * time. The label MUST read "first seen in top queries", not "new query": this
 * is first RANK ENTRY, and a long-lived query pushed into the top-N by a
 * traffic shift is not new. Mislabeling it is the fastest way this feature
 * loses trust, so the copy carries the caveat.
 */
export const detectNewExpensive = (input: DbmInsightInput): DbmInsight | null => {
  const { minShare, minCalls } = DBM_INSIGHT_RULES.newExpensive;
  const previous = indexByKey(input.previousRows);
  // A version bump makes EVERY fingerprint look new, so the whole family is
  // suppressed rather than firing a screenful of false positives.
  const versions = new Set(input.rows.map((r) => r.fp_version));
  const previousVersions = new Set(input.previousRows.map((r) => r.fp_version));
  const versionChanged =
    input.previousRows.length > 0 && [...versions].some((v) => !previousVersions.has(v));
  if (versionChanged) return null;

  const triggered = input.rows.filter((row) => {
    if (previous.has(rowKey(row))) return false;
    if (num(row.calls) < minCalls) return false;
    return shareOfTotal(row.total_time_ns, input.scopeTotalTimeNs) >= minShare;
  });

  if (!triggered.length) return null;
  const ranked = [...triggered].sort(byTotalTimeDesc);
  const top = ranked[0];

  return {
    id: "new-expensive",
    tone: "warning",
    fingerprints: ranked.map((r) => r.fingerprint),
    evidence: {
      row: top,
      count: ranked.length,
      current: num(top.total_time_ns),
      share: shareOfTotal(top.total_time_ns, input.scopeTotalTimeNs),
    },
  };
};

/**
 * I5 · N+1 / chatty endpoint.
 *
 * `calls / traces` at or above 10. Because `traces` merges as an UPPER bound,
 * this ratio is a LOWER bound — we under-report, which is the safe direction.
 * The copy says "looks like" and renders the multiplier as `≈ ×N`: at P0 this
 * is a pattern, not a verdict, and legitimate fan-out (bulk jobs, pagination)
 * is a genuine false positive we cannot yet exclude.
 */
export const detectNPlusOne = (input: DbmInsightInput): DbmInsight | null => {
  const { minCallsPerTrace, minTraces, minShare } = DBM_INSIGHT_RULES.nPlusOne;

  const triggered = input.rows.filter((row) => {
    const traces = num(row.traces);
    if (traces < minTraces) return false;
    if (num(row.calls) / traces < minCallsPerTrace) return false;
    return shareOfTotal(row.total_time_ns, input.scopeTotalTimeNs) >= minShare;
  });

  if (!triggered.length) return null;
  const ranked = [...triggered].sort(byTotalTimeDesc);
  const top = ranked[0];

  return {
    id: "n-plus-one",
    tone: "info",
    fingerprints: ranked.map((r) => r.fingerprint),
    evidence: {
      row: top,
      count: ranked.length,
      callsPerTrace: num(top.calls) / num(top.traces),
      share: shareOfTotal(top.total_time_ns, input.scopeTotalTimeNs),
    },
  };
};

/**
 * I6 · Volume shift, not query slowness — the anti-misdiagnosis card.
 *
 * Called 3x more often while latency stayed flat. Its entire value is telling
 * the user where NOT to look: the most expensive wrong turn in database triage
 * is a DBA tuning a query that never got slower. Both inputs are counts and
 * ratios of the same series, so false positives are rare.
 */
export const detectVolumeShift = (input: DbmInsightInput): DbmInsight | null => {
  const { callsRatio, maxLatencyRatio, minShare } = DBM_INSIGHT_RULES.volumeShift;
  const previous = indexByKey(input.previousRows);

  const triggered = input.rows.filter((row) => {
    const prev = previous.get(rowKey(row));
    if (!prev) return false;
    if (row.fp_version !== prev.fp_version) return false;

    const prevCalls = num(prev.calls);
    const prevP95 = num(prev.p95_ns);
    if (prevCalls <= 0 || prevP95 <= 0) return false;
    if (num(row.calls) <= callsRatio * prevCalls) return false;
    // The discriminator: it did NOT get slower.
    if (num(row.p95_ns) > maxLatencyRatio * prevP95) return false;
    return shareOfTotal(row.total_time_ns, input.scopeTotalTimeNs) >= minShare;
  });

  if (!triggered.length) return null;
  const ranked = [...triggered].sort(byTotalTimeDesc);
  const top = ranked[0];
  const prevTop = previous.get(rowKey(top));
  const prevCalls = num(prevTop?.calls);

  return {
    id: "volume-shift",
    tone: "warning",
    fingerprints: ranked.map((r) => r.fingerprint),
    evidence: {
      row: top,
      count: ranked.length,
      current: num(top.calls),
      baseline: prevCalls,
      ratio: prevCalls > 0 ? num(top.calls) / prevCalls : undefined,
      share: shareOfTotal(top.total_time_ns, input.scopeTotalTimeNs),
    },
  };
};

/**
 * I8 · Rank churn in the top consumers — the "what moved" summary.
 *
 * A fingerprint entering the top 5 from outside the top 20. The total-growth
 * gate is what keeps this quiet: rank near the top-N boundary is jittery, and
 * if total database time is flat nobody cares who is #4.
 */
export const detectRankChurn = (input: DbmInsightInput): DbmInsight | null => {
  const { intoRank, fromRank, minTotalRatio } = DBM_INSIGHT_RULES.rankChurn;
  if (input.previousScopeTotalTimeNs <= 0) return null;
  if (input.scopeTotalTimeNs < minTotalRatio * input.previousScopeTotalTimeNs) return null;

  const rankOf = (rows: QueryStatsRow[]) => {
    const ranks = new Map<string, number>();
    [...rows].sort(byTotalTimeDesc).forEach((row, i) => ranks.set(rowKey(row), i + 1));
    return ranks;
  };
  const currentRanks = rankOf(input.rows);
  const previousRanks = rankOf(input.previousRows);

  const triggered = input.rows.filter((row) => {
    const key = rowKey(row);
    const now = currentRanks.get(key);
    if (now === undefined || now > intoRank) return false;
    // Absent previously counts as "from outside the top 20" — it was nowhere.
    const before = previousRanks.get(key);
    return before === undefined || before > fromRank;
  });

  if (!triggered.length) return null;
  const ranked = [...triggered].sort(
    (a, b) => (currentRanks.get(rowKey(a)) ?? 0) - (currentRanks.get(rowKey(b)) ?? 0),
  );
  const top = ranked[0];

  return {
    id: "rank-churn",
    tone: "info",
    fingerprints: ranked.map((r) => r.fingerprint),
    evidence: {
      row: top,
      count: ranked.length,
      toRank: currentRanks.get(rowKey(top)),
      fromRank: previousRanks.get(rowKey(top)),
    },
  };
};

/**
 * Total failure — the one insight that needs no comparison window.
 *
 * Every other rule here is a CHANGE detector, which means all of them go quiet
 * on a query that has been failing steadily since before the window opened.
 * That is exactly the query a DBA arrives looking for during a lock storm, so
 * it gets a rule that reads only the current window: if a statement is failing
 * on every single call, say so, regardless of what it did earlier.
 *
 * It fires on the ERROR SHARE rather than the error count, so a busy query
 * failing 5% of the time never masquerades as a total outage.
 */
export const detectAllFailing = (input: DbmInsightInput): DbmInsight | null => {
  const { minErrorShare, minCalls } = DBM_INSIGHT_RULES.allFailing;

  const triggered = input.rows.filter((row) => {
    const calls = num(row.calls);
    if (calls < minCalls) return false;
    return num(row.errors) / calls >= minErrorShare;
  });

  if (!triggered.length) return null;
  const ranked = [...triggered].sort(byTotalTimeDesc);
  const top = ranked[0];

  return {
    id: "all-failing",
    tone: "error",
    fingerprints: ranked.map((r) => r.fingerprint),
    evidence: {
      row: top,
      count: ranked.length,
      // current = failures, baseline = calls: the strip prints "380 of 380",
      // which is the whole claim and its evidence in one phrase.
      current: num(top.errors),
      baseline: num(top.calls),
      share: shareOfTotal(top.total_time_ns, input.scopeTotalTimeNs),
    },
  };
};

/**
 * All six rules, ranked by the impact of what triggered them and capped.
 *
 * The cap is the point: the documented failure mode of insight engines is
 * volume — "anomalies are often the norm" — so three insights is the ceiling
 * regardless of how many rules fire.
 */
export const MAX_VISIBLE_INSIGHTS = 3;

export const detectInsights = (input: DbmInsightInput): DbmInsight[] => {
  const fired = [
    detectAllFailing(input),
    detectRegression(input),
    detectNewExpensive(input),
    detectVolumeShift(input),
    detectNPlusOne(input),
    detectRankChurn(input),
  ].filter((insight): insight is DbmInsight => insight !== null);

  return fired
    .sort((a, b) => num(b.evidence.row.total_time_ns) - num(a.evidence.row.total_time_ns))
    .slice(0, MAX_VISIBLE_INSIGHTS);
};

/**
 * The predicate that fired an insight, in words, built from the SAME constants
 * the predicate evaluates — so the threshold on screen cannot drift from the
 * threshold that fired. Shared by the strip (hover) and the row chip (tooltip),
 * because two copies of this text would be two copies to keep honest.
 */
export const insightRuleParams = (
  id: DbmInsightId,
): { key: string; params: Record<string, number> } => {
  const r = DBM_INSIGHT_RULES;
  switch (id) {
    case "regression":
      return {
        key: "dbm.insights.regression.rule",
        params: { ratio: r.regression.latencyRatio, calls: r.regression.minCalls },
      };
    case "new-expensive":
      return {
        key: "dbm.insights.new-expensive.rule",
        params: { share: r.newExpensive.minShare * 100, calls: r.newExpensive.minCalls },
      };
    case "n-plus-one":
      return {
        key: "dbm.insights.n-plus-one.rule",
        params: { ratio: r.nPlusOne.minCallsPerTrace, traces: r.nPlusOne.minTraces },
      };
    case "volume-shift":
      return {
        key: "dbm.insights.volume-shift.rule",
        params: { ratio: r.volumeShift.callsRatio, latency: r.volumeShift.maxLatencyRatio },
      };
    case "rank-churn":
      return {
        key: "dbm.insights.rank-churn.rule",
        params: { into: r.rankChurn.intoRank, from: r.rankChurn.fromRank },
      };
    case "all-failing":
      return {
        key: "dbm.insights.all-failing.rule",
        params: { calls: r.allFailing.minCalls },
      };
  }
};

// ─── §4 · Completion-bias banner ─────────────────────────────────────────────

/**
 * The lock-storm pattern, at the scope level.
 *
 * Blocked queries produce no span until they finish, so during a lock storm
 * QPS visibly FALLS — and a falling line reads as recovery at exactly the
 * moment things are worst. This is the most dangerous misread the product can
 * produce, so when the data pattern that implies a stall appears (volume
 * collapsing while errors climb) the standing disclosure escalates from a
 * footnote to a banner.
 *
 * It claims a pattern, never a diagnosis: the copy says these numbers may be
 * hiding blocked queries, not "you have a lock storm".
 */
export const detectCompletionBias = (
  current: Pick<QueryStatsRow, "calls" | "errors">[],
  previous: Pick<QueryStatsRow, "calls" | "errors">[],
): boolean => {
  const { maxCallsRatio, minErrorRatio } = DBM_INSIGHT_RULES.completionBias;
  const sum = (rows: Pick<QueryStatsRow, "calls" | "errors">[], key: "calls" | "errors") =>
    rows.reduce((acc, row) => acc + num(row[key]), 0);

  const prevCalls = sum(previous, "calls");
  const prevErrors = sum(previous, "errors");
  // With no previous window there is no collapse to detect.
  if (prevCalls <= 0) return false;

  const callsCollapsed = sum(current, "calls") < maxCallsRatio * prevCalls;
  // Errors rising from zero counts: any errors at all against a clean previous
  // window is a rise, and `0 * ratio` would never trip a multiplicative test.
  const errorsRose =
    prevErrors > 0
      ? sum(current, "errors") > minErrorRatio * prevErrors
      : sum(current, "errors") > 0;

  return callsCollapsed && errorsRose;
};

/**
 * How far calls fell, as a whole percentage — the number the banner headline
 * quotes. It lives here rather than at the call site so the figure on screen is
 * derived from the same sums `detectCompletionBias` tested, and cannot drift
 * from the condition that fired.
 */
export const callsDropPercent = (
  current: Pick<QueryStatsRow, "calls">[],
  previous: Pick<QueryStatsRow, "calls">[],
): number => {
  const sum = (rows: Pick<QueryStatsRow, "calls">[]) =>
    rows.reduce((acc, row) => acc + num(row.calls), 0);
  const prev = sum(previous);
  if (prev <= 0) return 0;
  return Math.max(0, Math.round((1 - sum(current) / prev) * 100));
};

// ─── The long tail ───────────────────────────────────────────────────────────

/**
 * Where the ranked list stops being worth one row per query.
 *
 * Real fleets are Pareto-shaped: three or four statements carry most of the
 * database, then a long flat tail of near-identical ORM lookups each costing
 * well under a percent. Rendering row 14 (0.4%) exactly like row 1 (37%) hands
 * them equal visual weight, and the reader has to re-derive the ranking from
 * the numbers on every scan — the table stops answering "what is heavy?" and
 * starts answering "what exists?".
 *
 * So the tail collapses into ONE row. Two guards decide where:
 *
 *  • `keepShare` — rows are kept while the running total is under 95% of what
 *    the LISTED rows add up to. This is the load-bearing test, and it is
 *    cumulative rather than per-row because that is what makes the fold
 *    self-sizing: on a flat fleet where everything is 2%, nothing folds (no row
 *    is negligible); on a Pareto fleet the cut lands right where the curve goes
 *    flat.
 *
 *    The denominator is the rows' own total, NOT the scope total, and that
 *    distinction is load-bearing rather than cosmetic. Shares on this page are
 *    measured against the whole scope — which includes the remainder bucket of
 *    traffic we have no per-query numbers for. On real data that bucket is 7.7%,
 *    so the ranked rows sum to ~92% and a 95%-of-scope gate can never be
 *    reached: the fold silently never fires, on exactly the Pareto-shaped data
 *    it was built for. Normalising to the listed rows asks the question the cut
 *    actually means — "how far down THIS list has the ranking stopped
 *    mattering?" — and is independent of how much the remainder happens to hold.
 *  • `maxRowShare` — a row at or above 1% of scope is never folded even once
 *    the 95% line is crossed. Cumulative share alone would fold the 4th row of
 *    a four-way even split, and "1% of your database" is not noise. This one
 *    stays measured against the SCOPE, because it is a claim about the row's
 *    real weight rather than about its position in the list.
 *
 * Both must agree before a row folds, so the fold is conservative by
 * construction: it hides a row only when it is BOTH past the point where the
 * ranking has stopped mattering AND individually small.
 *
 * `minRows` is the honesty guard. The fold row itself costs a row, so folding
 * two queries saves one line and costs the reader an expand click — a bad
 * trade. Below three rows the tail simply renders.
 *
 * What this rule deliberately does NOT do is fill the screen.
 *
 * An earlier cut carried a `minVisibleRows: 14` floor — "never fold a row that
 * would have rendered in empty space" — on the reasoning that the layout budget
 * exists to be spent on data. On real data that floor was the bug: it guaranteed
 * five genuinely distinct queries followed by EIGHT identical
 * `SELECT cNN FROM table_? WHERE k = ?` rows at 0% each, which is precisely the
 * noise the fold exists to remove, occupying the prime rows above the fold. The
 * budget was never a mandate to PAD the table; it was a cap on chrome. Empty
 * space below a short, meaningful table is a better screen than fourteen rows of
 * which eight say nothing. So the floor is now a hard minimum head (`minHeadRows`)
 * rather than a target, and what earns a row is INFORMATION, not position.
 */
export const DBM_TAIL_RULES = {
  /** Keep rows until the running share of listed time reaches this. */
  keepShare: 0.95,
  /** ...but never fold a row that is individually at or above this share. */
  maxRowShare: 0.01,
  /** Below this many foldable rows, showing them costs less than hiding them. */
  minRows: 3,
  /**
   * The head never shrinks below this, whatever the shares say.
   *
   * Not a target — a floor. It exists so a pathological window (one query at
   * 99%, everything else a rounding error) still renders a list rather than a
   * single row plus a fold, because a reader who cannot see the shape of the
   * ranking cannot tell "one query is hot" from "we only found one query".
   * Five is the Pareto head: past it, rank order stops being the reading.
   */
  minHeadRows: 5,
  /**
   * A run of this many consecutive uninformative rows folds on its own.
   *
   * The cumulative-share cut asks "has the ranking stopped mattering?", which is
   * a question about the whole list. This asks the local question the reader
   * actually experiences: am I now scanning rows I cannot tell apart? Four
   * identical 0%-with-no-signal rows in a row is that experience, and it is
   * worth folding even on a flatter fleet where the 95% line has not been
   * reached yet.
   */
  minDeadRun: 4,
  /** At or above this multiplier, a row's per-request count is a signal in itself. */
  notablePerRequest: 10,
  /** A window-over-window time change at or above this is worth its own line. */
  notableDeltaRatio: 0.5,
} as const;

/**
 * The minimum a row needs to carry to be counted for the fold decision.
 *
 * `share` alone decides SIZE; the optional fields decide whether the row says
 * anything a reader could act on. A tiny row that is failing calls, running ten
 * times per request, or that just doubled is not tail — it is the finding
 * somebody opened this page for, and it keeps its line at any size.
 */
export interface DbmTailCandidate {
  fingerprint: string;
  share: number;
  /** Failed calls in this window. Any at all is a distinguishing signal. */
  errors?: number;
  /** Calls per request, when we have a trace count to divide by. */
  callsPerTrace?: number | null;
  /** Signed fractional change in the time this query costs, when comparable. */
  deltaRatio?: number;
}

export interface DbmTailSplit<T> {
  /** Rows that render individually. */
  head: T[];
  /** Rows collapsed behind the fold — empty when the fold does not apply. */
  tail: T[];
  /** Summed share of everything in `tail`, `0`–`1`. */
  tailShare: number;
}

/**
 * Split a ranked row list into what renders and what folds.
 *
 * `protectedFingerprints` are rows an insight named. A query can be 0.2% of
 * database time and still be the reason someone opened this page — every call
 * failing, or running 15× per request — and hiding it behind a fold would bury
 * the one finding the page exists to surface. Those rows stay in the head
 * wherever they rank.
 *
 * Rows are assumed already sorted by descending cost, which is the table's
 * default and the only order in which a cumulative-share cut means anything.
 * The function does not re-sort: sorting by calls and then folding "the tail"
 * would fold by the wrong axis, so the caller applies the fold only when the
 * list is ranked by time.
 */
export const splitLongTail = <T extends DbmTailCandidate>(
  rows: T[],
  protectedFingerprints: ReadonlySet<string> = new Set(),
): DbmTailSplit<T> => {
  const {
    keepShare,
    maxRowShare,
    minRows,
    minHeadRows,
    minDeadRun,
    notablePerRequest,
    notableDeltaRatio,
  } = DBM_TAIL_RULES;

  const shareOf = (row: T) => (Number.isFinite(row.share) ? row.share : 0);

  /**
   * Does this row say anything? Any ONE of these keeps its line at any size —
   * these are the four ways a small row can still be the reason the page is
   * open, and they are the same signals the table already renders in its own
   * columns, so a protected row always has visible ink justifying its place.
   */
  const informative = (row: T) =>
    protectedFingerprints.has(row.fingerprint) ||
    shareOf(row) >= maxRowShare ||
    (row.errors ?? 0) > 0 ||
    (row.callsPerTrace ?? 0) >= notablePerRequest ||
    Math.abs(row.deltaRatio ?? 0) >= notableDeltaRatio;

  // The listed rows' own total — the denominator the cumulative cut is measured
  // against, so the remainder bucket's size cannot move where the fold lands.
  const listedTotal = rows.reduce((acc, row) => acc + shareOf(row), 0);
  if (listedTotal <= 0) return { head: rows, tail: [], tailShare: 0 };

  /**
   * Where a run of indistinguishable rows begins.
   *
   * Scanned backwards so the run is measured from where it ENDS: a dead run that
   * is interrupted by one informative row is two shorter runs, and only a run
   * that reaches the bottom of the list is tail. A run in the middle of the list
   * is a shape the reader can still navigate by.
   */
  let deadRunStart = rows.length;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (informative(rows[i])) break;
    deadRunStart = i;
  }
  const deadRunFolds = rows.length - deadRunStart >= minDeadRun;

  const head: T[] = [];
  const tail: T[] = [];
  let cumulative = 0;

  rows.forEach((row, index) => {
    const share = shareOf(row);
    const foldable =
      // The head never drops below the Pareto floor, whatever else is true.
      head.length >= minHeadRows &&
      !informative(row) &&
      // Either the ranking has stopped mattering across the whole list, or this
      // row sits in a long run of rows the reader cannot tell apart.
      (cumulative / listedTotal >= keepShare || (deadRunFolds && index >= deadRunStart));
    if (foldable) tail.push(row);
    else head.push(row);
    cumulative += share;
  });

  // Not enough to be worth a fold: put it back rather than trade a row for a click.
  if (tail.length < minRows) {
    return { head: rows, tail: [], tailShare: 0 };
  }

  return {
    head,
    tail,
    tailShare: tail.reduce((acc, row) => acc + (Number.isFinite(row.share) ? row.share : 0), 0),
  };
};

// ─── I3 / I7 · Databases-page rules ──────────────────────────────────────────

/**
 * I3 · This database is drowning — the landing-page insight.
 *
 * p95 doubled at real volume, from EXACT `db_totals` percentiles rather than
 * fingerprint fusion, which is why the false-positive risk is low. The
 * remaining caveat is pooler identity: behind PgBouncer or an RDS Proxy
 * several databases share one address, so a "database" here may be an
 * aggregate. That caveat rides on the row, not in this predicate.
 */
export const DBM_DATABASE_RULES = {
  drowning: {
    latencyRatio: 2,
    minCalls: 100,
    /** 100ms in ns — below this a doubling is not felt. */
    minP95Ns: 100_000_000,
    /** At most two, ranked by total time. */
    maxCards: 2,
  },
} as const;

/**
 * When a failure rate is worth a red rail rather than a number in a column.
 *
 * Any errors at all used to redden the row, which on real data meant one failed
 * call in 26,000 painted a database as critical — so the colour stopped meaning
 * "look here" and started meaning "this database exists". A rate floor asks the
 * question the operator is actually asking (is a meaningful share of traffic
 * failing?), and the call floor stops a 1-in-3 sample being called 33%.
 */
export const DBM_CRITICAL_ERROR_RULES = {
  /** Failures must be at least this share of calls, `0`–`1`. */
  minErrorRate: 0.01,
  /** ...over at least this many calls, or the rate is too jumpy to trust. */
  minCalls: 20,
} as const;

/**
 * Is this row failing enough to earn the red rail? Both guards must agree, so a
 * single failure never reddens a busy database and a 1-of-2 blip never reddens a
 * quiet one.
 */
export const isCriticalErrorRate = (
  errors: number | null | undefined,
  calls: number | null | undefined,
): boolean => {
  const { minErrorRate, minCalls } = DBM_CRITICAL_ERROR_RULES;
  const total = calls ?? 0;
  if (total < minCalls) return false;
  return (errors ?? 0) / total >= minErrorRate;
};

export interface DbmDrowningDatabase {
  row: DbTotalsRow;
  current: number;
  baseline: number;
  ratio: number;
}

export const detectDrowningDatabases = (
  rows: DbTotalsRow[],
  previousRows: DbTotalsRow[],
): DbmDrowningDatabase[] => {
  const { latencyRatio, minCalls, minP95Ns, maxCards } = DBM_DATABASE_RULES.drowning;
  const previous = new Map(previousRows.map((row) => [totalsKey(row), row]));

  return rows
    .flatMap((row) => {
      const prev = previous.get(totalsKey(row));
      if (!prev) return [];
      const baseline = num(prev.p95_ns);
      const current = num(row.p95_ns);
      if (baseline <= 0) return [];
      if (num(row.calls) < minCalls) return [];
      if (current < minP95Ns) return [];
      if (current <= latencyRatio * baseline) return [];
      return [{ row, current, baseline, ratio: current / baseline }];
    })
    .sort((a, b) => num(b.row.total_time_ns) - num(a.row.total_time_ns))
    .slice(0, maxCards);
};
