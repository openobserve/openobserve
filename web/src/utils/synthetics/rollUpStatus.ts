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

/** Per-execution status, as the runs table and the timeline both model it. */
export type ExecutionStatus = "pass" | "warning" | "fail" | "error";

/** The aggregate of every execution inside one logical run, or one location. */
export type AggregateStatus = "all-pass" | "all-warning" | "mixed" | "all-fail";

/**
 * Roll a set of execution statuses up to one aggregate — the timeline's segment
 * colour, and the per-location dot inside its tooltip.
 *
 * `warning` is NOT green. The previous rule tested
 * `every(s === "pass" || s === "warning")` for "all passed", so a run was only
 * ever orange when EVERY execution warned; one warning among passes rolled up
 * to `all-pass`. The runs table badges that same run "Warning"
 * (`MonitorRuns.visibleRuns`), so the timeline and the table contradicted each
 * other on the same run, and the timeline was the one hiding the problem.
 *
 * `monitor-results.md` §"Status Timeline Design" specifies three colours over
 * pass/fail; it predates the four-state model and is silent on `warning`. Every
 * other surface — the table badge, `SyntheticKpi.warningRuns`, the status
 * filter, this timeline's own orange legend entry — treats warning as its own
 * state, so the roll-up follows them.
 *
 * `error` ("we could not look") aggregates with `fail` rather than forming a
 * fifth colour: at run level both mean "this run produced no healthy result",
 * and `SyntheticKpi` already reports `errorRuns` separately for the distinction.
 */
export function rollUpStatus(statuses: readonly ExecutionStatus[]): AggregateStatus {
  if (statuses.length === 0) return "all-pass";
  let healthy = 0;
  let warning = 0;
  let down = 0;
  for (const s of statuses) {
    if (s === "warning") {
      warning++;
      healthy++;
    } else if (s === "pass") {
      healthy++;
    } else {
      down++;
    }
  }
  if (down === statuses.length) return "all-fail";
  if (healthy === statuses.length) return warning > 0 ? "all-warning" : "all-pass";
  return "mixed";
}

/**
 * How many executions fall in each bucket, for the segment title and the
 * tooltip header.
 *
 * One definition, because there were two and they disagreed: the timeline
 * computed `failed = total - passed` (counting `error` as failed) while the
 * tooltip filtered `status === "fail"` (dropping `error` from both buckets), so
 * a run of `[pass, fail, error]` was summarised as "1 passed · 1 failed" — one
 * execution silently unaccounted for. These four always sum to `total`.
 */
export interface StatusTally {
  passed: number;
  warning: number;
  failed: number;
  total: number;
}

export function tallyStatuses(statuses: readonly ExecutionStatus[]): StatusTally {
  let passed = 0;
  let warning = 0;
  let failed = 0;
  for (const s of statuses) {
    if (s === "pass") passed++;
    else if (s === "warning") warning++;
    else failed++;
  }
  return { passed, warning, failed, total: statuses.length };
}
