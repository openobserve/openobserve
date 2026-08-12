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
 * The read layer for W6 — the database's OWN account of a statement, beside
 * the client-observed latency the rest of the query page is built from.
 *
 * **Two vantages, never merged.** The client sees only instrumented callers and
 * measures round-trip; the server sees every client and measures in-engine
 * work. They are reported in two separate blocks under two separate headings
 * for that reason, and this module deliberately derives NO figure that spans
 * them — see `serverMetricsTiles`.
 *
 * **The join is permanently partial and that is the NORMAL case.** Same-engine
 * fingerprint convergence measured 87% (Postgres) and 75% (MySQL) after the
 * whitespace-normalisation fix in `cd05beb1b7`; it was 43% and 56% before it,
 * because pg_stat_statements pads every paren and comma and the hash stream
 * kept that spacing.
 *
 * It will never reach 100%, for two reasons that are not defects. The server
 * legitimately sees statements no instrumented client issued — the collector's
 * own `pg_stat_activity` polls, `BEGIN`, `SHOW server_version`. And some
 * producers drop tokens the client sent: pg_stat_statements reports
 * `qty + ? updated_at` where the application wrote `qty + %s, updated_at`, and
 * no normalizer can recover a comma that never arrived.
 *
 * So "no server match" must read as an ordinary outcome, not as an error.
 *
 * Units are converted HERE and nowhere else, so no component does arithmetic on
 * a wire value and no two components disagree about a unit.
 */

import { formatCount, formatNs } from "./format";

export type DbmServerMetricsState = "matched" | "unmatched" | "ambiguous" | "off";

/** Seconds on the wire (`pg_stat_statements` accumulates seconds). */
const NS_PER_SECOND = 1e9;

export interface DbmServerMetrics {
  /**
   * Four distinct states, because each names a different fix:
   *  - `matched`    — the database's counters for this exact statement.
   *  - `unmatched`  — capture ran, no server counterpart. ORDINARY (see above).
   *  - `ambiguous`  — more than one candidate instance; numbers WITHHELD.
   *  - `off`        — nothing was ever captured; the collector hint applies.
   */
  state: DbmServerMetricsState;
  instance: string | null;
  /** Populated only for `ambiguous`, so the reader can disambiguate by hand. */
  candidateInstances: string[];
  /**
   * What the folded exec-time field actually MEASURED on this engine. Postgres
   * `total_exec_time` is EXECUTION time; MySQL `sum_timer_wait` is WAIT time.
   * The backend states which, so the header cannot mislabel it.
   */
  execTimeKind: "execution" | "wait";
  calls: number | null;
  rows: number | null;
  /** The MEAN, converted to ns. Never a percentile — this feed has none. */
  meanExecTimeNs: number | null;
  sharedBlksHit: number | null;
  sharedBlksRead: number | null;
  tempBlksRead: number | null;
  tempBlksWritten: number | null;
}

export interface DbmServerMetricTile {
  id: string;
  /** An i18n key suffix under `dbm.detail.serverMetrics.*`. */
  labelKey: string;
  value: string;
}

/**
 * A counter that is ABSENT stays absent rather than becoming a confident zero.
 *
 * MySQL's `top_query` ships no row or block counters at all, so `null` here is
 * the ordinary case for a whole engine — and "0 blocks read" is a claim the
 * collector never made.
 */
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const readServerMetrics = (
  envelope: Record<string, unknown> | null | undefined,
): DbmServerMetrics => {
  const execTimeKind = envelope?.exec_time_kind === "wait" ? "wait" : "execution";
  const empty: DbmServerMetrics = {
    state: "off",
    instance: null,
    candidateInstances: [],
    execTimeKind,
    calls: null,
    rows: null,
    meanExecTimeNs: null,
    sharedBlksHit: null,
    sharedBlksRead: null,
    tempBlksRead: null,
    tempBlksWritten: null,
  };

  // A missing or malformed envelope reads as "nothing captured" rather than
  // throwing: this is supplementary detail on a page whose point is the query.
  if (!envelope || typeof envelope !== "object") return empty;

  if (envelope.matched !== true) {
    // More than one candidate instance. The join omits `instance` so it
    // survives a pooler; the price is that two instances sharing a database
    // name are indistinguishable, and picking one would silently attribute
    // another instance's counters to this query.
    if (envelope.unmatched_reason === "pooler") {
      return {
        ...empty,
        state: "ambiguous",
        candidateInstances: Array.isArray(envelope.candidate_instances)
          ? envelope.candidate_instances.filter((c): c is string => typeof c === "string")
          : [],
      };
    }
    // Capture ran and found no counterpart — distinct from never having run.
    return {
      ...empty,
      state: envelope.server_metrics_capture === "on" ? "unmatched" : "off",
    };
  }

  const meanSeconds = num(envelope.mean_exec_time_s);
  return {
    ...empty,
    state: "matched",
    instance: typeof envelope.instance === "string" ? envelope.instance : null,
    calls: num(envelope.calls),
    rows: num(envelope.rows),
    meanExecTimeNs: meanSeconds === null ? null : meanSeconds * NS_PER_SECOND,
    sharedBlksHit: num(envelope.shared_blks_hit),
    sharedBlksRead: num(envelope.shared_blks_read),
    tempBlksRead: num(envelope.temp_blks_read),
    tempBlksWritten: num(envelope.temp_blks_written),
  };
};

/**
 * The server-side tiles, in the order they read.
 *
 * **`mean`, never `p95`.** `pg_stat_statements` accumulates a total and a
 * count, so a quotient is the only central tendency this feed can support.
 * Labelling it as a percentile would be a fabrication.
 *
 * **No client/server difference tile.** A "network + pool wait" figure would
 * subtract a server MEAN from a client PERCENTILE, over different populations,
 * over windows that do not even align — the client rollup is keyed on
 * window-END while these reads are on raw event time.
 *
 * Only `matched` produces tiles; every other state is a sentence, not a number.
 */
export const serverMetricsTiles = (m: DbmServerMetrics): DbmServerMetricTile[] => {
  if (m.state !== "matched") return [];

  const tile = (id: string, labelKey: string, value: string): DbmServerMetricTile => ({
    id,
    labelKey,
    value,
  });
  const count = (v: number | null): string => (v === null ? "—" : formatCount(v));

  return [
    tile("calls", "calls", count(m.calls)),
    tile("rows", "rows", count(m.rows)),
    // The label carries the per-engine meaning of the folded field: Postgres
    // measures execution, MySQL measures wait. One name for two measurements
    // would tell a MySQL reader the database measured something it did not.
    tile(
      "mean",
      m.execTimeKind === "wait" ? "meanWait" : "meanExecution",
      m.meanExecTimeNs === null ? "—" : formatNs(m.meanExecTimeNs),
    ),
    tile("shared_blks_hit", "sharedBlksHit", count(m.sharedBlksHit)),
    tile("shared_blks_read", "sharedBlksRead", count(m.sharedBlksRead)),
    tile("temp_blks_written", "tempBlksWritten", count(m.tempBlksWritten)),
  ];
};
