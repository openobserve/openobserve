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

// ── Alert LEVEL (alerts_2.md Feature 1) ─────────────────────────────────────
// A separate axis from RunOutcome above: outcome answers "did the evaluation
// fire?", level answers "how bad?". An alert can be `firing` at `warning`, or
// `notify_failed` at `critical`. Never merge the two.

/** Levels the backend can send. */
export type AlertLevel = "ok" | "warning" | "critical" | "no_data";

/**
 * Severity ordering, mirroring `AlertLevel::severity_rank` in Rust.
 *
 * Deliberately NOT the storage id: `no_data` persists as 3 but ranks below
 * `warning` — "we don't know" is not worse than "we know it's bad". Used for
 * the most-severe rollup across groups.
 */
const LEVEL_RANK: Record<AlertLevel, number> = {
  ok: 0,
  no_data: 1,
  warning: 2,
  critical: 3,
};

export function levelRank(level: unknown): number {
  const v = String(level ?? "").trim().toLowerCase();
  return LEVEL_RANK[v as AlertLevel] ?? -1;
}

/** Levels that mean the alert is currently triggered. */
export function isFiringLevel(level: unknown): boolean {
  const v = String(level ?? "").trim().toLowerCase();
  return v === "warning" || v === "critical";
}

/** Most severe of a set of levels; null when empty or all unrecognised. */
export function mostSevereLevel(levels: unknown[]): AlertLevel | null {
  let best: AlertLevel | null = null;
  for (const l of levels) {
    const v = String(l ?? "").trim().toLowerCase() as AlertLevel;
    if (!(v in LEVEL_RANK)) continue;
    if (best === null || LEVEL_RANK[v] > LEVEL_RANK[best]) best = v;
  }
  return best;
}

/**
 * Whether to render a level badge at all.
 *
 * Same rule as the run-outcome badge: a disabled alert freezes whatever level
 * it last had, so showing it would advertise "Critical" forever on something
 * that is not running (alerts_2.md §7.6).
 */
export function shouldShowLevel(
  enabled: boolean | undefined,
  level: string | null | undefined,
): boolean {
  return Boolean(enabled) && Boolean(level) && levelRank(level) >= 0;
}

/**
 * T-10 condition summary for a history row: `"112 >= 100"`.
 *
 * Normal rows carry no matched threshold (only the observed value), so they
 * render `"112"` alone; rows written before the value-context fields existed
 * render `"—"`. Zero-safe: an actual value of 0 is a real observation.
 */
export function conditionSummary(row: {
  actual_value?: unknown;
  threshold_value?: unknown;
  threshold_operator?: unknown;
  value_is_lower_bound?: unknown;
}): string {
  const fmt = (v: unknown): string => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : String(v);
  };
  if (row.actual_value === undefined || row.actual_value === null) return "—";
  // §7.5: a legacy capped count fetch records min(true_count, fetch_size) —
  // the backend flags it and the value renders as a lower bound, not exact.
  const prefix = row.value_is_lower_bound === true ? "≥" : "";
  const parts = [prefix + fmt(row.actual_value)];
  if (
    row.threshold_value !== undefined &&
    row.threshold_value !== null &&
    row.threshold_operator
  ) {
    parts.push(String(row.threshold_operator), fmt(row.threshold_value));
  }
  return parts.join(" ");
}

/** Human label for a level. */
export function levelLabel(level: unknown): string {
  switch (String(level ?? "").trim().toLowerCase()) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "ok":
      return "Ok";
    case "no_data":
      return "No Data";
    default:
      return "Unknown";
  }
}
