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
 * Pure helpers for the traces SearchBar. Extracted so the change-
 * detection logic (mount-replay filter) can be unit-tested without
 * mounting the full SFC, which pulls in monaco / quasar / vuex.
 */

/** Subset of `searchObj.data.datetime` that the comparison cares about. */
export interface DatetimeSnapshot {
  startTime: number | string;
  endTime: number | string;
  relativeTimePeriod?: string | null;
  type?: "relative" | "absolute" | string;
}

/** Subset of the value emitted by `<DateTime>` `on:date-change`. */
export interface DatetimeEmit {
  startTime: number | string;
  endTime: number | string;
  relativeTimePeriod?: string | null;
}

/**
 * Decide whether a `<DateTime>` `on:date-change` emit represents a real
 * user-driven change (worth firing a search for) vs the mount-replay
 * the component fires once on its own onMounted.
 *
 * Why this matters:
 *   - The DateTime component emits `on:date-change` once on mount with
 *     its current value (no actual change). Without filtering, a tab
 *     switch that remounts the picker triggers a redundant search.
 *   - For RELATIVE ranges, comparing raw startTime/endTime is unreliable:
 *     the picker recomputes them from `Date.now()` every mount, so the
 *     timestamps drift even when the user's intent ("Past 12 Hours") is
 *     unchanged. We compare `relativeTimePeriod` instead.
 *   - For ABSOLUTE ranges, the user-set boundaries are stable across
 *     remounts, so direct startTime/endTime comparison is correct.
 *
 * @example isDatetimeChanged({startTime:1,endTime:2,relativeTimePeriod:"15m"},
 *                           {startTime:99,endTime:100,relativeTimePeriod:"15m"})
 *   // false — relative period unchanged, mount-replay
 *
 * @example isDatetimeChanged({startTime:1,endTime:2,relativeTimePeriod:"15m"},
 *                           {startTime:99,endTime:100,relativeTimePeriod:"12h"})
 *   // true — user picked a different period
 *
 * @example isDatetimeChanged({startTime:1,endTime:2},      // absolute range
 *                           {startTime:1,endTime:2})
 *   // false — same absolute window
 */
export function isDatetimeChanged(
  prev: DatetimeSnapshot | null | undefined,
  value: DatetimeEmit,
): boolean {
  if (!prev) return true;
  const isRelative = !!value.relativeTimePeriod;
  if (isRelative) {
    return prev.relativeTimePeriod !== value.relativeTimePeriod;
  }
  return prev.startTime !== value.startTime || prev.endTime !== value.endTime;
}
