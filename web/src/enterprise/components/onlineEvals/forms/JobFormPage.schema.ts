// Copyright 2026 OpenObserve Inc.
//
// Validation schema for JobFormPage.vue (online-evals eval-job create/edit page).
// This native-`<form>` page shipped with `*` markers on name/stream but only a
// manual `scorerIds.length` guard — the migration to OForm + Zod ADDS the
// missing name/stream validation and folds the scorer guard into the schema
// (online-evals-migration.md row 66).
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

const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeJobFormSchema = (t: (_key: string) => string) =>
  z
    .object({
      name: requiredText(t("onlineEvals.job.validation.nameRequired")),
      stream: requiredText(t("onlineEvals.job.validation.streamRequired")),
      description: z.string().optional().default(""),
      // Internal metadata (not a rendered control) — kept in the form per
      // note 3 (non-validated → optional).
      streamType: z.string().optional().default("traces"),
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
      if (
        val.samplingMode !== "all" &&
        String(val.samplingValue ?? "").trim().length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["samplingValue"],
          message: t("onlineEvals.job.validation.samplingValueRequired"),
        });
      }
    });

export type JobForm = z.infer<ReturnType<typeof makeJobFormSchema>>;
