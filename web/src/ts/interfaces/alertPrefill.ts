// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * The contract between ANY surface in the app ("create an alert from what I'm
 * looking at") and the alert form. A surface contributes one pure adapter that
 * returns an AlertPrefill; nothing else in the alerts module changes.
 *
 * Adapters must satisfy the invariants enforced by `normalizePrefill`
 * (utils/alerts/alertPrefill.ts):
 *
 *  1. Resolved query, not source syntax — `sql` is what the backend would run:
 *     no `[WHERE_CLAUSE]` templates, no unsubstituted dashboard variables.
 *  2. Exactly one stream. Surfaces with several supply `streamCandidates` and
 *     let the confirm dialog resolve it — never silently take `[0]`.
 *  3. `periodMinutes` is minutes, already clamped. Never raw timestamps.
 *  4. Warn, don't mutate silently: every lossy transform emits a warning.
 *  5. Pure and synchronous — a plain snapshot in, a plain object out. No store,
 *     no router, no await. This is what makes adapters trivially testable.
 *  6. Never throw: an adapter that cannot build a usable prefill returns one
 *     carrying a `blocking` warning.
 */

/**
 * Open by design: a new surface registers an id in ALERT_SOURCES
 * (utils/alerts/alertSourceRegistry.ts), it does not edit a union here. An
 * unregistered id still works, on defaults.
 */
export type AlertPrefillSource = string;

/**
 * `blocking` prevents the user continuing to the form — reserved for prefills
 * that could not be built into anything usable.
 */
export type AlertPrefillWarningLevel = "info" | "warning" | "blocking";

export interface AlertPrefillWarning {
  /** i18n key, relative to `alerts.prefill.warnings`. */
  key: string;
  params?: Record<string, string | number>;
  level: AlertPrefillWarningLevel;
}

export interface AlertPrefillStreamCandidate {
  name: string;
  type: string;
}

/** The alert conditions-builder group shape (mirrors defaultAlertValue()). */
export interface AlertPrefillConditionGroup {
  filterType: "group";
  logicalOperator: string;
  groupId: string;
  conditions: any[];
}

export interface AlertPrefillAggregation {
  group_by: string[];
  function: string;
  having: {
    column: string;
    operator: string;
    value: number;
  };
}

export interface AlertPrefillThresholdCondition {
  column: string;
  operator: string;
  value: number;
}

/**
 * How the alert counts what the query returns. Sourced from the registry's
 * `defaultThreshold`, overridable by the user in the confirm dialog.
 */
export type AlertPrefillThresholdShape = "matching-rows" | "count";

/**
 * How the surface's pattern set folds into the alert's filter. "none" leaves
 * patterns out entirely; "include" matches any of them; "exclude" ignores them.
 */
export type AlertPatternMode = "none" | "include" | "exclude";

/**
 * Declared by a surface that can fold patterns into the query, so the confirm
 * dialog can offer the choice WITHOUT knowing what a pattern is. The dialog
 * re-invokes the surface's builder with the chosen mode rather than editing SQL
 * itself — that is what keeps the dialog source-agnostic.
 */
export interface AlertPrefillPatternFilter {
  /** Mode reflected in the current `sql`. */
  mode: AlertPatternMode;
  /** Patterns that will be used — the ones the user can actually see. */
  visibleCount: number;
  /** Every extracted pattern, for the "6 of 15" line. */
  totalCount: number;
  /** True when a severity filter is narrowing the list, which the dialog states. */
  filtered: boolean;
}

/** Options a surface's builder accepts when the dialog re-parameterises it. */
export interface AlertBuildOptions {
  patternMode?: AlertPatternMode;
}

/** Bumped whenever the persisted shape changes; a stale blob is ignored. */
export const ALERT_PREFILL_VERSION = 1;

export interface AlertPrefill {
  version: typeof ALERT_PREFILL_VERSION;
  source: AlertPrefillSource;
  /** Human label for where this came from — used in the toast and the name. */
  sourceLabel: string;

  name?: string;
  streamType: string;
  streamName: string;

  queryType: "sql" | "promql" | "custom";
  sql?: string;
  promql?: string;
  conditions?: AlertPrefillConditionGroup;
  vrlFunction?: string | null;

  aggregation?: AlertPrefillAggregation | null;
  promqlCondition?: AlertPrefillThresholdCondition | null;
  thresholdShape?: AlertPrefillThresholdShape;

  /**
   * The trigger's OWN count gate — "fire when N rows/groups match" — as
   * distinct from `promqlCondition` / `aggregation.having`, which are
   * thresholds on a VALUE.
   *
   * Optional, and most surfaces leave it unset: a prefill derived from a logs
   * search or a dashboard panel has no opinion about how many rows should
   * count as an alert, so the form's own default is the honest answer. Set it
   * only where the source carries a real, curated trigger — a library alert
   * being the case it exists for. When set it WINS over the "threshold lives
   * inside the query, so count ≥ 1" inference the form would otherwise make.
   */
  triggerThreshold?: number;
  /** Comparison for `triggerThreshold`; only meaningful alongside it. */
  triggerOperator?: string;

  /** Rolling evaluation window in minutes, already clamped. */
  periodMinutes?: number;
  frequencyMinutes?: number;
  /** Repeat-notification suppression, minutes. `0` is a real value (no silence). */
  silenceMinutes?: number;
  timezone?: string;

  /** Populated when the surface had more than one stream to choose from. */
  streamCandidates?: AlertPrefillStreamCandidate[];

  /** Present when the surface can fold its patterns into the query. */
  patternFilter?: AlertPrefillPatternFilter;

  warnings: AlertPrefillWarning[];

  /** Source-specific; never read by the form. Summary / telemetry only. */
  meta?: Record<string, unknown>;
}
