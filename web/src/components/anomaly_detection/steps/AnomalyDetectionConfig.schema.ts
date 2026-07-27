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
    // ORange dual-handle value; written back to config.threshold_min/threshold.
    threshold_range: z.object({ min: z.coerce.number(), max: z.coerce.number() }),
  });

export type AnomalyDetectionConfigForm = z.infer<ReturnType<typeof makeAnomalyDetectionConfigBase>>;

/** True when the SQL aliases a column as the timestamp column (banned — the
 * anomaly query must alias its time column as `time_bucket`). */
export const hasTimestampAliasInSql = (sql: string, timestampColumn: string): boolean => {
  if (!sql) return false;
  const escaped = timestampColumn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bAS\\s+["'\`]?${escaped}["'\`]?\\s*(?:,|\\s|$)`, "i").test(sql);
};

/**
 * Schema factory — takes a getter for the org's timestamp column
 * (store.state.zoConfig.timestamp_column) so the alias rule stays live without
 * the schema file importing the store.
 */
export const createAnomalyDetectionConfigSchema = (
  t: Translator,
  getTimestampColumn: () => string = () => "_timestamp",
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
  });

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
  detection_window_value: cfg?.detection_window_value ?? 1,
  detection_window_unit: cfg?.detection_window_unit ?? "h",
  training_window_days: cfg?.training_window_days ?? 14,
  retrain_interval_days: cfg?.retrain_interval_days ?? 7,
  threshold_range: {
    min: cfg?.threshold_min ?? 0,
    max: cfg?.threshold ?? 100,
  },
});
