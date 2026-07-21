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

// AddAlert orchestrator schema.
//
// AddAlert owns the ONE <OForm> for the whole wizard. The step children
// (QueryConfig, AlertSettings, Advanced, Deduplication) render as descendants
// and bind their fields by nested `name=` into THIS form, so the schema below
// must cover every nested path they bind. This file composes their exported
// rules (single source of truth) and adds the topbar scalars:
//
//   • name         — required (min 1) + no ALERT_NAME_UNSUPPORTED_CHARS
//   • stream_type  — required
//   • stream_name  — required (min 1)
//   + QueryConfig  — queryConfigSchema, self-gated by its `_meta` discriminators.
//   + AlertSettings — createAlertSettingsSchema(isRealTime) (silence ≥ 0,
//                     destinations ≥ 1, period ≥ 1 scheduled-only).
//
// Discriminator `is_real_time`: "false" (scheduled) | "true" (realtime) |
// "anomaly". The anomaly branch enforces only `name`; AnomalyDetectionConfig
// owns its own <OForm>+schema+validate() and the anomaly save path
// (saveAnomalyDetection) bypasses this form and reads `anomalyConfig`.

import { z } from "zod";

import {
  makeQueryConfigSchema,
  type QueryConfigMeta,
  type Translator,
} from "./steps/QueryConfig.schema";
import { createAlertSettingsSchema } from "./steps/AlertSettings.schema";

// Topbar messages are i18n-driven, resolved via the injected `t`:
//   name required      → alerts.nameRequired
//   name special chars → alerts.nameNoSpecialChars
//   stream type        → alerts.validation.streamTypeRequired
//   stream name        → alerts.validation.streamNameRequired

/** Unsupported characters in an alert name. Requiredness = min 1 AND this regex. */
export const ALERT_NAME_UNSUPPORTED_CHARS = /[:#?\s'"%&]+/;

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

// Step-B field schemas (Advanced / Deduplication / CompareWithPast wizard step
// children). All optional/permissive. The step components bind these exact paths
// by nested `name=` into THIS orchestrator form.

/** One context-variable row. key/value are optional (a blank row is allowed;
 *  getAlertPayload only copies non-blank key/value pairs into the payload). `id`
 *  is for row identity in the help drawer / preview — it is NEVER used as the
 *  v-for `:key` (that must be the array index so an index-based `name=` binding
 *  survives a mid-list delete). */
export const contextAttributeRowSchema = z.object({
  id: z.string().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
});

/** `context_attributes` as the array of key/value rows the form holds. The
 *  payload transform (getAlertPayload) folds this array → an object, dropping
 *  blank rows. */
export const contextAttributesSchema = z.array(contextAttributeRowSchema);

/** Advanced-tab composite (Advanced.vue own-mode <OForm> schema). `looseObject`
 *  so the rest of the shared alert object passes through untouched. */
export const advancedShape = {
  template: z.string().optional(),
  context_attributes: contextAttributesSchema.optional(),
  description: z.string().optional(),
  row_template: z.string().optional(),
  row_template_type: z.string().optional(),
} as const;

export const createAdvancedSchema = () => z.looseObject({ ...advancedShape });
export type AdvancedForm = z.infer<ReturnType<typeof createAdvancedSchema>>;

/** Deduplication (scheduled-only). All fields optional. `enabled` is derived
 *  from `fingerprint_fields.length > 0` by the component; `time_window_minutes`
 *  is sanitized to number|undefined by the component — the raw form state may
 *  transiently hold a string, so the union keeps validation permissive (never
 *  rejects while typing). */
export const deduplicationSchema = z.object({
  enabled: z.boolean().optional(),
  fingerprint_fields: z.array(z.string()).optional(),
  time_window_minutes: z
    .union([z.number(), z.string(), z.undefined()])
    .optional(),
});
export type DeduplicationForm = z.infer<typeof deduplicationSchema>;

/** Compare-with-past reference-window row. `offSet` is a relative-time string
 *  (e.g. "15m") edited by the bare CustomDateTimePicker. `uuid` is the row
 *  identity used as the v-for `:key` — correct here because the row is bound by
 *  object reference, not by an index-based OForm* `name=` (so the mid-list-delete
 *  index bug that forces `:key="index"` on OForm* arrays does not apply). */
export const multiTimeRangeRowSchema = z.object({
  offSet: z.string(),
  uuid: z.string().optional(),
});
export const multiTimeRangeSchema = z.array(multiTimeRangeRowSchema);

/**
 * Full alert form schema. `looseObject` so all the non-form alert fields
 * (template, context_attributes, enabled, description, row_template*, folder_id,
 * multi_time_range, vrl_function, …) that the payload reads pass through
 * untouched — requiredness lives entirely in the superRefine.
 *
 * `is_real_time` discriminates; the QueryConfig `_meta` discriminators (bridged
 * into this form by QueryConfig's syncMeta watcher) gate the QueryConfig rules.
 */
export const makeAddAlertSchema = (
  t: Translator,
  // ENTERPRISE/CLOUD only — see createAlertSettingsSchema. Defaults to false so
  // OSS (and existing callers/specs passing only `t`) keep main's exact rules.
  allowWorkflows = false,
) =>
  z
    .looseObject({
    name: z.string().optional(),
    stream_type: z.string().optional(),
    stream_name: z.string().optional(),
    is_real_time: z.string().optional(),
    destinations: z.array(z.string()).optional(),
    creates_incident: z.boolean().optional(),
    trigger_condition: z.looseObject({}).optional(),
    query_condition: z.looseObject({}).optional(),
    logGroupBy: z.array(z.string()).optional(),
    // Step-B fields (Advanced / Deduplication tabs). Permissive pass-throughs,
    // not validated — the superRefine below adds no issues for them.
    context_attributes: contextAttributesSchema.optional(),
    deduplication: deduplicationSchema.optional(),
    template: z.string().optional(),
    description: z.string().optional(),
    row_template: z.string().optional(),
    row_template_type: z.string().optional(),
    // Required by the composed queryConfigSchema; QueryConfig keeps it fresh.
    _meta: z.looseObject({}).optional(),
  })
  .superRefine((val: any, ctx) => {
    const mode = val.is_real_time;

    // ANOMALY branch: the detection-config fields are validated by
    // AnomalyDetectionConfig's own OForm; only `name` lives on THIS form. No
    // special-chars refine here — that rule is alert-only.
    if (mode === "anomaly") {
      if (isBlank(val.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: t("alerts.anomalyNameRequired"),
        });
      }
      return;
    }

    // Topbar: name required + no special chars, stream type/name required.
    if (isBlank(val.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: t("alerts.nameRequired"),
      });
    } else if (ALERT_NAME_UNSUPPORTED_CHARS.test(String(val.name))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: t("alerts.nameNoSpecialChars"),
      });
    }
    if (isBlank(val.stream_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stream_type"],
        message: t("alerts.validation.streamTypeRequired"),
      });
    }
    if (isBlank(val.stream_name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stream_name"],
        message: t("alerts.validation.streamNameRequired"),
      });
    }

    // QueryConfig rules. Delegate to the exported schema and re-home every issue
    // at its exact nested path so the descendant OForm* fields surface them. Its
    // superRefine self-gates realtime vs scheduled via `_meta.isRealTime`.
    const qc = makeQueryConfigSchema(t).safeParse(val);
    if (!qc.success) {
      for (const issue of qc.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path as (string | number)[],
          message: issue.message,
        });
      }
    }

    // AlertSettings rules. Period is enforced ≥ 1 for scheduled only; realtime
    // keeps period rule-free (createAlertSettingsSchema toggles it). silence ≥ 0
    // + destinations ≥ 1 apply in both non-anomaly modes.
    const isRealTime = mode === "true";
    const as = createAlertSettingsSchema(
      t,
      isRealTime,
      allowWorkflows,
    ).safeParse(val);
    if (!as.success) {
      for (const issue of as.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path as (string | number)[],
          message: issue.message,
        });
      }
    }
  });

export type AddAlertForm = z.infer<ReturnType<typeof makeAddAlertSchema>>;

/** A complete, valid `_meta` block for the form defaults (before QueryConfig
 *  mounts and takes over via its syncMeta watcher). Mirrors QueryConfig's
 *  initialMeta for a fresh custom/logs/scheduled alert. */
export const defaultAddAlertMeta = (
  overrides: Partial<QueryConfigMeta> = {},
): QueryConfigMeta => ({
  tab: "custom",
  isRealTime: "false",
  isEventBased: true,
  selectedFunction: "total_events",
  frequencyMode: "minutes",
  hasConditions: false,
  hasGroupBy: false,
  aggregationEnabled: false,
  // No org floor by default — the rule is skipped until QueryConfig/useAlertForm
  // bridge the real zoConfig value in.
  minAutoRefreshInterval: 0,
  ...overrides,
});
