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

// Validation schema for AnomalyDetectionConfig.vue (the "Detection Config" step
// of the anomaly-detection wizard inside AddAlert).
//
// Mode-conditional rules live in the `superRefine` keyed on `query_mode`:
// - custom_sql mode: `custom_sql` required + the timestamp-column alias ban.
// - filters mode: `detection_function` required, and `detection_function_field`
//   required when the function is not `count`.
//
// Base rules (both modes — these controls render in BOTH query modes):
// - histogram/schedule/detection-window interval values ≥ 1.
// - `training_window_days` ≥ 1.
// - `retrain_interval_days` / units / filter rows carry NO value rules.
//
// Number inputs come out of OFormInput as STRINGS → `z.coerce.number()`; the
// component's write-back to props.config re-coerces so the parent payload keeps
// number types.

import { z } from "zod";

/** One row of the filters[] field-array. No per-field rules — incomplete rows
 * are simply skipped when the SQL is built. */
export const anomalyFilterRowSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.string(),
});

export type AnomalyFilterRow = z.infer<typeof anomalyFilterRowSchema>;

/** Factory for a blank filter row. */
export const makeAnomalyFilterRow = (): AnomalyFilterRow => ({
  field: "",
  operator: "=",
  value: "",
});

/** i18n translator injected by the component: `(key, namedParams?) => string`.
 *  Validation messages resolve through this against the `alerts.validation.*`
 *  (and `alerts.anomaly.sqlRequired`) locale keys. */
type Translator = (key: string, named?: Record<string, unknown>) => string;

const makeAnomalyDetectionConfigBase = (t: Translator) =>
  z.object({
    query_mode: z.enum(["filters", "custom_sql"]),
    filters: z.array(anomalyFilterRowSchema),
    // Bare-Monaco value, bridged in via form.setFieldValue. Required-ness is
    // mode-conditional → superRefine below.
    custom_sql: z.string(),
    // Required-ness is mode-conditional (filters mode only) → superRefine below.
    detection_function: z.string(),
    detection_function_field: z.string(),
    histogram_interval_value: z.coerce.number().min(1, t("alerts.validation.fieldRequired")),
    histogram_interval_unit: z.string(),
    schedule_interval_value: z.coerce.number().min(1, t("alerts.validation.fieldRequired")),
    schedule_interval_unit: z.string(),
    detection_window_value: z.coerce.number().min(1, t("alerts.validation.fieldRequired")),
    detection_window_unit: z.string(),
    training_window_days: z.coerce.number().min(1, t("alerts.validation.minimumOneDay")),
    // Type-only (fixed OSelect options).
    retrain_interval_days: z.coerce.number(),
    // Sensitivity rules are mode-conditional (superRefine): each mode judges only its own fields.
    sensitivity_mode: z.enum(["percentile", "budget"]),
    threshold: z.coerce.number(),
    budget_count: z.coerce.number(),
    budget_period: z.enum(["day", "week"]),
  });

export type AnomalyDetectionConfigForm = z.infer<ReturnType<typeof makeAnomalyDetectionConfigBase>>;

/** True when the SQL aliases a column as the timestamp column (banned — the
 * anomaly query must alias its time column as `time_bucket`). */
export const hasTimestampAliasInSql = (sql: string, timestampColumn: string): boolean => {
  if (!sql) return false;
  const escaped = timestampColumn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bAS\\s+["'\`]?${escaped}["'\`]?\\s*(?:,|\\s|$)`, "i").test(sql);
};

export type AnomalyIntervalUnit = "s" | "m" | "h" | "d";

const INTERVAL_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Seconds for one interval value + unit pair; null when either part is not a positive s/m/h/d interval. */
export const anomalyIntervalSeconds = (value: number, unit: string): number | null => {
  const mult = INTERVAL_UNIT_SECONDS[unit];
  if (!mult || !Number.isFinite(value) || value <= 0) return null;
  return value * mult;
};

/** One governing interval as stored on the server: the raw wire value plus the form state it seeded. */
export interface AnomalyStoredInterval {
  raw: string | number | null;
  value: number;
  unit: string;
  parsed: boolean;
}

/** The stored governing triple, captured once from the edit-fetch response (D4). */
export interface AnomalyStoredIntervals {
  histogram: AnomalyStoredInterval;
  schedule: AnomalyStoredInterval;
  window: AnomalyStoredInterval;
}

/** A window narrower than one schedule gap plus one bucket deterministically skips buckets (spec §4.3). */
export const lookBackWindowFloorSeconds = (
  scheduleValue: number,
  scheduleUnit: string,
  histogramValue: number,
  histogramUnit: string,
): number | null => {
  const schedule = anomalyIntervalSeconds(scheduleValue, scheduleUnit);
  const histogram = anomalyIntervalSeconds(histogramValue, histogramUnit);
  if (schedule === null || histogram === null) return null;
  return schedule + histogram;
};

/** Compact human form for a seconds count, e.g. 3900 → "1h 5m". */
export const formatAnomalySeconds = (secs: number): string => {
  const units: Array<[number, AnomalyIntervalUnit]> = [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
    [1, "s"],
  ];
  const parts: string[] = [];
  let rest = Math.max(0, Math.floor(secs));
  for (const [size, label] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n}${label}`);
      rest -= n * size;
    }
  }
  return parts.length ? parts.join(" ") : "0s";
};

const sameInterval = (stored: AnomalyStoredInterval, value: unknown, unit: unknown): boolean =>
  Number(value) === stored.value && unit === stored.unit;

/**
 * Schema factory — takes a getter for the org's timestamp column
 * (store.state.zoConfig.timestamp_column) so the alias rule stays live without
 * the schema file importing the store, and one for the stored governing triple
 * so legacy rows are grandfathered by value, not by touched-flags (spec §4.5).
 */
export const createAnomalyDetectionConfigSchema = (
  t: Translator,
  getTimestampColumn: () => string = () => "_timestamp",
  getStoredIntervals: () => AnomalyStoredIntervals | null = () => null,
) =>
  makeAnomalyDetectionConfigBase(t).superRefine((value, ctx) => {
    if (value.query_mode === "custom_sql") {
      // SQL required in custom SQL mode.
      if (!value.custom_sql || !value.custom_sql.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["custom_sql"],
          message: t("alerts.anomaly.sqlRequired"),
        });
      } else if (hasTimestampAliasInSql(value.custom_sql, getTimestampColumn())) {
        // Timestamp column can't be an alias.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["custom_sql"],
          message: t("alerts.validation.timestampAliasBanned", {
            column: getTimestampColumn(),
          }),
        });
      }
    }

    if (value.query_mode === "filters") {
      // Required, only where the control renders (filters mode).
      if (!value.detection_function) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["detection_function"],
          message: t("alerts.validation.detectionFunctionRequired"),
        });
      } else if (value.detection_function !== "count" && !value.detection_function_field) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["detection_function_field"],
          message: t("alerts.validation.fieldRequiredPlain"),
        });
      }
    }

    if (value.sensitivity_mode === "percentile") {
      // The server clamps to 50–99.9 then truncates with `as i32`, so 99 is the real ceiling.
      const p = value.threshold;
      if (!Number.isInteger(p) || p < 50 || p > 99) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["threshold"],
          message: t("alerts.anomaly.sensitivityRange"),
        });
      }
    } else if (!Number.isFinite(value.budget_count) || value.budget_count <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budget_count"],
        message: t("alerts.anomaly.budgetRange"),
      });
    }

    const stored = getStoredIntervals();
    const histogramUntouched =
      stored !== null &&
      sameInterval(stored.histogram, value.histogram_interval_value, value.histogram_interval_unit);
    const scheduleUntouched =
      stored !== null &&
      sameInterval(stored.schedule, value.schedule_interval_value, value.schedule_interval_unit);
    const windowUntouched =
      stored !== null &&
      sameInterval(stored.window, value.detection_window_value, value.detection_window_unit);
    // D4 grandfathering: an untouched stored triple round-trips verbatim, so the floor judges only edits.
    const grandfathered =
      stored !== null && histogramUntouched && scheduleUntouched && windowUntouched;
    // D9 tolerance: an unparsable stored value the user has not replaced yields no floor computation.
    const scheduleReliable = stored === null || stored.schedule.parsed || !scheduleUntouched;
    const histogramReliable = stored === null || stored.histogram.parsed || !histogramUntouched;
    if (!grandfathered && scheduleReliable && histogramReliable) {
      const floor = lookBackWindowFloorSeconds(
        value.schedule_interval_value,
        value.schedule_interval_unit,
        value.histogram_interval_value,
        value.histogram_interval_unit,
      );
      const windowSecs = anomalyIntervalSeconds(
        value.detection_window_value,
        value.detection_window_unit,
      );
      if (floor !== null && windowSecs !== null && windowSecs < floor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["detection_window_value"],
          message: t("alerts.anomaly.lookBackWindowFloor", { min: formatAnomalySeconds(floor) }),
        });
      }
    }
  });

/** Badge copy keys for a config's `notice_class` (§4.8); the class is the ONLY key — never error-string prefixes. */
export const anomalyNoticeBadgeKeys = (
  noticeClass: unknown,
): { labelKey: string; tooltipKeys: string[] } | null => {
  switch (noticeClass) {
    case "window_floor":
      return {
        labelKey: "alerts.anomaly.noticeWindowFloor",
        tooltipKeys: ["alerts.anomaly.noticeWindowFloorTooltip"],
      };
    case "window_skip":
      // One class carries two server message constants (§4.8) — the tooltip names both causes.
      return {
        labelKey: "alerts.anomaly.noticeWindowSkip",
        tooltipKeys: ["alerts.anomaly.noticeSkipScored", "alerts.anomaly.noticeSkipAbsence"],
      };
    case "hybrid_fallback":
      return {
        labelKey: "alerts.anomaly.noticeHybridFallback",
        tooltipKeys: ["alerts.anomaly.noticeHybridFallbackTooltip"],
      };
    case "retrain":
      return {
        labelKey: "alerts.anomaly.noticeRetrain",
        tooltipKeys: ["alerts.anomaly.noticeRetrainTooltip"],
      };
    default:
      return null;
  }
};

/** The stored per-day budget, or null; absent/invalid = percentile mode — the only wire contract assumed. */
export const anomalyBudgetPerDay = (cfg: Record<string, any> | null | undefined): number | null => {
  const budget = Number(cfg?.alert_budget_per_day);
  return Number.isFinite(budget) && budget > 0 ? budget : null;
};

/** A stored per-day budget below 1 is surfaced as alerts/week. */
export const budgetFieldsFromPerDay = (
  perDay: number | null,
): { budget_count: number; budget_period: "day" | "week" } => {
  if (perDay === null) return { budget_count: 1, budget_period: "day" };
  // Rounds only the DISPLAY decimals float noise introduces (1/7*7 = 0.9999…), never the magnitude.
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return perDay < 1
    ? { budget_count: round(perDay * 7), budget_period: "week" }
    : { budget_count: round(perDay), budget_period: "day" };
};

/**
 * Typed defaults, projected from the parent-owned config object
 * (useAlertForm's `anomalyConfig` — passed in as props.config). The parent
 * replaces the whole config object on async edit-load; the component re-seeds
 * via form.reset(anomalyDetectionConfigDefaults(cfg)).
 */
export const anomalyDetectionConfigDefaults = (
  cfg: Record<string, any> | null | undefined,
): AnomalyDetectionConfigForm => ({
  query_mode: cfg?.query_mode === "custom_sql" ? "custom_sql" : "filters",
  filters: Array.isArray(cfg?.filters)
    ? cfg.filters.map((f: any) => ({
        field: f?.field ?? "",
        operator: f?.operator ?? "=",
        value: f?.value ?? "",
      }))
    : [],
  custom_sql: cfg?.custom_sql ?? "",
  detection_function: cfg?.detection_function ?? "count",
  detection_function_field: cfg?.detection_function_field ?? "",
  histogram_interval_value: cfg?.histogram_interval_value ?? 5,
  histogram_interval_unit: cfg?.histogram_interval_unit ?? "m",
  schedule_interval_value: cfg?.schedule_interval_value ?? 1,
  schedule_interval_unit: cfg?.schedule_interval_unit ?? "h",
  // 3h is the smallest round window meeting §4.3's recommendation (2×(1h+5m) + the absence allowance).
  detection_window_value: cfg?.detection_window_value ?? 3,
  detection_window_unit: cfg?.detection_window_unit ?? "h",
  training_window_days: cfg?.training_window_days ?? 14,
  retrain_interval_days: cfg?.retrain_interval_days ?? 7,
  sensitivity_mode: anomalyBudgetPerDay(cfg) !== null ? "budget" : "percentile",
  threshold: cfg?.threshold == null || cfg.threshold === "" ? 97 : Number(cfg.threshold),
  ...budgetFieldsFromPerDay(anomalyBudgetPerDay(cfg)),
});
