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
 * The stored class of a check's newest finalized run (`last_run_class` on the
 * check list API), as the badge status key. 0 means no class yet: a check that
 * never finalized a run, or a row from before the class existed.
 */
const STATUS_BY_RUN_CLASS: Record<number, string> = {
  1: "passed",
  2: "partial",
  3: "failed",
  4: "not_measured",
  5: "misconfigured",
};

/** Badge status for a check: its run class, or `fallback` (from `last_check_status`) without one. */
export function statusFromRunClass(runClass: number | null | undefined, fallback: string): string {
  return (runClass && STATUS_BY_RUN_CLASS[runClass]) || fallback;
}

/** "10:36 UTC" for a microsecond epoch, the clock the Not measured badge shows. */
export function utcClock(micros: number): string {
  return `${new Date(Math.floor(micros / 1000)).toISOString().slice(11, 16)} UTC`;
}
