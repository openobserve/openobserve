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
export interface FirstEventBudget {
  /** Poll interval while the watch is young. */
  fastMs: number;
  /** Elapsed time after which polling slows to `slowMs`. */
  fastUntilMs: number;
  slowMs: number;
  /** Elapsed time after which the watcher stops and sends nothing more. */
  stopAtMs: number;
  /** Elapsed time without data after which recent rejections are read automatically. */
  diagnosisAtMs: number;
  /** Interval between recent-rejections reads once the first one has run. */
  rejectionsEveryMs: number;
}

/** The single source of the first-event polling budget. */
export const FIRST_EVENT_BUDGET: Readonly<FirstEventBudget> = Object.freeze({
  fastMs: 5_000,
  fastUntilMs: 600_000,
  slowMs: 30_000,
  stopAtMs: 3_600_000,
  diagnosisAtMs: 120_000,
  rejectionsEveryMs: 30_000,
});

/** The poll interval for a watch this old, or null once it has to stop. */
export function cadenceAt(
  elapsedMs: number,
  budget: Readonly<FirstEventBudget> = FIRST_EVENT_BUDGET,
): number | null {
  if (elapsedMs >= budget.stopAtMs) return null;
  return elapsedMs < budget.fastUntilMs ? budget.fastMs : budget.slowMs;
}
