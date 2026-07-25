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
 * Alert run-outcome classification — the single source of truth for the
 * frontend.
 *
 * The backend writes `RunOutcome` (see Part III of alerts.md):
 *   firing | normal | succeeded | error | notify_failed | skipped
 *
 * History rows written before that rename carry the legacy vocabulary
 * (`completed`, `condition_not_satisfied`, `failed`) and are still in the
 * triggers stream until they age out of its retention window, so both are
 * handled here. The legacy entries can be deleted once that window has passed.
 *
 * This previously lived duplicated across AlertHistoryTimeline, AlertHistoryDrawer
 * and OverviewTab, which is how the three ended up disagreeing about `completed`.
 */

/** Canonical outcomes the backend can send. */
export type RunOutcome =
  | "firing"
  | "normal"
  | "succeeded"
  | "error"
  | "notify_failed"
  | "skipped";

/**
 * Coarse bucket used for colouring and counting.
 *
 * `error` is its own bucket, not a flavour of "other", because it is a
 * first-class backend outcome (`RunOutcome::Error`): the evaluation ran and
 * failed. It is neither a firing (the alert did not trigger) nor healthy.
 */
export type OutcomeBucket = "firing" | "ok" | "error" | "other";

const normalize = (s: unknown): string =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");

/**
 * Outcomes meaning "the alert triggered".
 *
 * `notify_failed` counts: the condition matched and only delivery failed.
 * Excluding it would undercount firings every time a destination is down.
 * `completed` is the legacy spelling of `firing` for condition-bearing modules.
 */
const FIRING = new Set(["firing", "anomaly", "notifyfailed", "completed"]);

/** Outcomes meaning "evaluated, nothing to alert on". */
const OK = new Set(["normal", "succeeded", "ok", "success", "conditionnotsatisfied"]);

/**
 * Outcomes meaning "the evaluation itself failed" — `RunOutcome::Error`.
 * `failed` is the legacy spelling.
 *
 * Note this is NOT `notify_failed`, which is a firing state: there the
 * condition matched and only delivery failed.
 */
const ERROR = new Set(["error", "failed"]);

export function isFiringOutcome(status: unknown): boolean {
  return FIRING.has(normalize(status));
}

export function isOkOutcome(status: unknown): boolean {
  return OK.has(normalize(status));
}

export function isErrorOutcome(status: unknown): boolean {
  return ERROR.has(normalize(status));
}

export function outcomeBucket(status: unknown): OutcomeBucket {
  if (isFiringOutcome(status)) return "firing";
  if (isOkOutcome(status)) return "ok";
  if (isErrorOutcome(status)) return "error";
  return "other";
}

/**
 * Human label for a raw outcome value. `firingLabel`/`okLabel` let callers
 * localise or use domain-specific wording.
 */
export function outcomeLabel(
  status: unknown,
  firingLabel = "Firing",
  okLabel = "Ok",
  errorLabel = "Error",
): string {
  const v = normalize(status);
  if (FIRING.has(v)) return firingLabel;
  if (OK.has(v)) return okLabel;
  if (ERROR.has(v)) return errorLabel;
  if (v === "skipped") return "Skipped";
  return String(status ?? "").replace(/_/g, " ") || "Unknown";
}

/**
 * Whether a run-outcome badge should be shown for an alert at all.
 *
 * A disabled alert keeps whatever outcome it last recorded, so rendering it
 * would show "Firing" forever on an alert that is not even running. See the
 * semantics table in Part IV of alerts.md.
 */
export function shouldShowRunOutcome(
  enabled: boolean | undefined,
  lastOutcome: string | null | undefined,
): boolean {
  return Boolean(enabled) && Boolean(lastOutcome);
}
