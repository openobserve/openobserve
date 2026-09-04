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
 * The row hand-off between the queries list and the query detail page.
 *
 * Opening a detail page starts with the reader LOOKING AT the row: the list
 * just fetched this fingerprint's stats for the very window the detail page is
 * about to describe. Throwing that away and refetching before painting anything
 * is the waterfall this seam removes — the detail page paints its identity and
 * headline tiles from the clicked row immediately, and its own fetch refines
 * rather than gates.
 *
 * A MODULE-SCOPED one-shot slot rather than router `history.state`,
 * deliberately. `history.state` SURVIVES a reload, and a relative window
 * ("last 15m") re-resolves its bounds on reload — the persisted row would then
 * be an answer to a slightly older question presented as current. A module
 * binding dies with the JS, so a reload, a deep link and a restored tab all
 * take the cold-fetch path by construction rather than by a staleness check.
 *
 * The slot is one-shot (`take` consumes it) and guarded three ways: the org,
 * the fingerprint and the RANGE must all match what the detail page is about
 * to render. The range guard is what keeps a stale hand-off honest — a seed
 * fetched under the list's window must not paint under a different one.
 */

import type { QueryStatsRow } from "@/services/db_monitoring";
import type { DbmRange } from "@/composables/dbm/useDbmScope";

export interface DbmQueryDetailSeed {
  /** The clicked row, exactly as the list's fetch returned it. */
  row: QueryStatsRow;
  /** The org the row was fetched for. */
  org: string;
  /** The RANGE the list fetched under — the seed is only valid for it. */
  range: DbmRange;
}

/**
 * Same question, window-wise — the comparison `dbmTabCountsKey` already makes:
 * a relative range is the PERIOD (its microsecond bounds re-anchor on every
 * load by design, so comparing them could never match), an absolute range is
 * its exact bounds.
 */
export const sameDbmRange = (a: DbmRange, b: DbmRange): boolean => {
  if (a.type !== b.type) return false;
  return a.type === "absolute"
    ? a.startTime === b.startTime && a.endTime === b.endTime
    : a.relativeTimePeriod === b.relativeTimePeriod;
};

let held: DbmQueryDetailSeed | null = null;

/** Stash the clicked row for the navigation that is about to happen. */
export const setDbmQueryDetailSeed = (seed: DbmQueryDetailSeed): void => {
  held = seed;
};

/**
 * Claim the seed, if it answers THIS page's question.
 *
 * Consumes the slot either way: a seed that failed its guards is not going to
 * become valid later, and leaving it behind would let some future navigation
 * inherit a row it never asked for.
 */
export const takeDbmQueryDetailSeed = (
  org: string,
  fingerprint: string,
  range: DbmRange,
): QueryStatsRow | null => {
  const seed = held;
  held = null;
  if (!seed) return null;
  if (seed.org !== org || seed.row.fingerprint !== fingerprint) return null;
  if (!sameDbmRange(seed.range, range)) return null;
  return seed.row;
};

/** Drop the slot. For tests, so one cannot seed the next. */
export const clearDbmQueryDetailSeed = (): void => {
  held = null;
};
