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
 * Client-side mirror of the server's job-lease budget check.
 *
 * The server rejects a browser check whose worst-case run cannot finish inside
 * one job lease (`validate_browser_config` in
 * `src/config/src/meta/synthetics.rs`). That rejection arrived as a wall of
 * prose in a dismissible toast, attached to no field, and its leading remedy
 * named `journey_budget_ms` — which this form neither renders nor sends. So the
 * most common way to hit it (two browser/device combos at the form's own
 * default `retries: 1`) read as an unexplained save failure.
 *
 * Computing it here turns that into an inline error on the two fields the form
 * DOES own, before the request is made. The server check stays authoritative —
 * this is a nicer path to the same answer, not a replacement.
 *
 * THESE CONSTANTS MIRROR THE SERVER. Changing one without the other makes the
 * form either block a save the server would accept, or promise one it rejects.
 */

/** `JOB_LEASE_SECS` — the lease a job holds while it runs. */
export const JOB_LEASE_MS = 900_000;

/** `DEFAULT_JOURNEY_BUDGET_MS` — wall-clock ceiling for ONE browser attempt. */
export const DEFAULT_JOURNEY_BUDGET_MS = 300_000;

export interface RunBudgetInput {
  /** Number of browser x device combos. The probe runs them SEQUENTIALLY inside
   * one leased job, so the lease covers all of them, not one. */
  combos: number;
  retries: number;
  waitBeforeRetrySecs: number;
  /** Per-attempt ceiling. Absent means the server default. */
  journeyBudgetMs?: number;
}

export interface RunBudget {
  /** Worst-case wall clock for one leased job, in ms. */
  worstCaseMs: number;
  /** True when that exceeds the lease and the server will reject the save. */
  exceedsLease: boolean;
  attempts: number;
  combos: number;
  perAttemptMs: number;
}

/**
 * `worst_case_run_ms` — retries happen INSIDE the leased job, so the lease has
 * to cover the whole sequence (`attempts x per_attempt + gaps`), multiplied by
 * the combos the probe repeats sequentially within that same job.
 */
export function computeRunBudget(input: RunBudgetInput): RunBudget {
  const combos = Math.max(1, input.combos);
  const perAttemptMs = input.journeyBudgetMs ?? DEFAULT_JOURNEY_BUDGET_MS;
  const retries = Math.max(0, input.retries);
  const attempts = retries + 1;
  const worstCaseMs =
    combos * (attempts * perAttemptMs + retries * Math.max(0, input.waitBeforeRetrySecs) * 1000);
  return {
    worstCaseMs,
    exceedsLease: worstCaseMs > JOB_LEASE_MS,
    attempts,
    combos,
    perAttemptMs,
  };
}

/** `human_ms` — "20m10s", not "1210000". Same rendering as the server message. */
export function formatBudgetDuration(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m${secs}s`;
}
