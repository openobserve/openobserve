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
 * ONE answer to "does the trace vantage have anything for THIS scope, in THIS
 * window" — the predicate every DBM surface hides its trace-only sections on.
 *
 * Why it is shared rather than a `v-if` per section: the sections that can only
 * be filled from traces are spread over eight pages, and each had its own
 * near-miss test for emptiness (`!hits.length`, `series.length === 0`, a
 * `noStream` error string). They disagreed at the edges, so the same fleet
 * showed a hidden section on one page and an empty table with a "no callers"
 * message on the next — and "no callers" is a FINDING, not an absence.
 *
 * Scope, deliberately narrow: this answers about the fingerprint/row/window in
 * front of the reader, never about the org. An org with a traced billing
 * service and an untraced reporting job has traces; the reporting job's
 * statements still have no caller list, no percentile and no sample, and
 * rendering those as empty tables tells the reader their instrumentation broke.
 *
 * The signal is READ from the response, never guessed:
 *  - `hits`/`series` being empty is the primary evidence, because every
 *    trace-vantage endpoint answers a scope-narrowed question and an empty
 *    answer to a narrow question is an observation.
 *  - a FAILED read is explicitly not evidence. A 500 says nothing about whether
 *    traces exist, and hiding on it would silently drop sections that were
 *    there a minute ago. Failures keep rendering their own error state.
 */

/**
 * What a caller knows about the trace vantage for one scope.
 *
 * Every field is optional so a page passes only the signals it actually has —
 * a page with no history series omits `series` rather than inventing one.
 */
export interface DbmTraceVantageSignals {
  /**
   * The trace-vantage rows for this scope: the client `hits` array from
   * `/queries`, `/databases`, `/samples`, or the single resolved row on the
   * detail page. Present and empty is the zero-trace observation.
   */
  rows?: readonly unknown[] | null;
  /** The per-window rollup series, when the surface reads one. */
  series?: readonly unknown[] | null;
  /**
   * The read broke. Overrides everything: a failure is not an observation of
   * absence, so the vantage stays PRESENT and the surface renders its own
   * error state rather than vanishing.
   */
  readFailed?: boolean;
  /**
   * The read has not answered yet. Also keeps the vantage present, so sections
   * do not flash out and back in on every window change.
   */
  loading?: boolean;
}

/**
 * `true` when this scope has trace-derived data (or we cannot yet say it has
 * none). `false` ONLY on an answered, successful, empty read — the one state
 * in which hiding a trace-only section states something true.
 */
export const hasDbmTraceVantage = (signals: DbmTraceVantageSignals): boolean => {
  // Not an observation of absence — see `readFailed`/`loading` above.
  if (signals.readFailed === true) return true;
  if (signals.loading === true) return true;

  const answered: boolean[] = [];
  if (signals.rows !== undefined && signals.rows !== null) answered.push(signals.rows.length > 0);
  if (signals.series !== undefined && signals.series !== null) {
    answered.push(signals.series.length > 0);
  }

  // Nothing was passed at all: the caller has no signal to hide on, so it must
  // not hide. Silence is not evidence.
  if (!answered.length) return true;

  // ANY populated trace signal keeps the vantage. A fingerprint with samples
  // but no ranked rollup row still has a caller list worth showing.
  return answered.some(Boolean);
};
