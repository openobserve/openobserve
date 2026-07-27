// Copyright 2026 OpenObserve Inc.
//
// Validation schema for JobFormPage.vue (online-evals eval-job create/edit page).
// The OForm migration adds schema validation for the required target fields and
// completion-window controls while retaining the scorer toast guard used by the
// composite picker (online-evals-migration.md row 66).
//
// The component OWNS <OForm> via the Rule-③ owner pattern: it creates the form
// with `useOForm` and reads it reactively through `form.useStore` — a SINGLE
// source of truth, NO mirror ref, NO `v-model`. That read view (`formValues`)
// drives the parent-side reads: name/streamType feed the live JobPreviewPanel,
// stream feeds the stream-option list, scorerIds feeds the mapping sync, and
// samplingMode drives the sampling `v-if`/disabled. Rendered scalars are plain
// form-owned `name=` fields; `scorerIds` (driven by the composite JobScorerPicker)
// is bridged into the form via `form.setFieldValue` from the picker's own
// `@update:model-value` handler — NOT a watch on a mirror — so the `.min(1)` rule
// validates it. The filter-builder tree is now FORM-OWNED (`filterGroup`, rendered
// in form mode); the input-mapping composite stays local non-form state (both are
// built into the payload at submit). Validation TIMING is owned by OForm.

import { z } from "zod";
import {
  MIN_COMPLETION_IDLE_WINDOW_SECS,
  TRACE_COMPLETION_WINDOW_DEFAULTS,
} from "../utils/completionWindow";

const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeJobFormSchema = (t: (_key: string) => string) =>
  z
    .object({
      name: requiredText(t("onlineEvals.job.validation.nameRequired")),
      stream: requiredText(t("onlineEvals.job.validation.streamRequired")),
      description: z.string().optional().default(""),
      // Internal metadata (not a rendered control), non-validated.
      streamType: z.string().optional().default("traces"),
      targetScope: z.enum(["span", "trace", "session"]).default("span"),
      idleWindowSecs: z.coerce
        .number()
        .int()
        .min(MIN_COMPLETION_IDLE_WINDOW_SECS, t("onlineEvals.job.validation.idleWindowMinimum"))
        .default(TRACE_COMPLETION_WINDOW_DEFAULTS.idleWindowSecs),
      maxAgeSecs: z.coerce
        .number()
        .int()
        .positive()
        .default(30 * 60),
      // Scorer selection is NOT validated here: the composite JobScorerPicker
      // has no inline error slot, so the "≥1 scorer" rule is enforced as a toast
      // guard in the component's onSubmit (see JobFormPage.vue). Bridged from the
      // picker via setFieldValue.
      scorerIds: z.array(z.string()),
      samplingMode: z.string().default("rate"),
      samplingValue: z.string().optional().default(""),
      // The filter-builder tree (V2 group) is now FORM-OWNED: FilterGroup renders
      // in form mode (name-prefix="filterGroup"), so its leaf column/operator/value
      // name-bind straight into the form. No validation — an empty filter is valid
      // (a job may match all spans); it's transformed into the `filterCondition`
      // payload at submit.
      filterGroup: z.any(),
    })
    .superRefine((val, ctx) => {
      // Sampling value is required unless the mode is "all" (which ignores it).
      if (val.samplingMode !== "all" && String(val.samplingValue ?? "").trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["samplingValue"],
          message: t("onlineEvals.job.validation.samplingValueRequired"),
        });
      }
    });

export type JobForm = z.infer<ReturnType<typeof makeJobFormSchema>>;
