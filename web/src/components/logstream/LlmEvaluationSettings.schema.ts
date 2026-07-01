// Copyright 2026 OpenObserve Inc.
//
// Validation schema for LlmEvaluationSettings.vue.
//
// This form previously had NO field-level validation (it only showed a soft
// toast when the user tried to save while disabled). The migration to
// OForm + Zod ADDS the missing validation, all conditional on the `enabled`
// toggle: when LLM evaluation is turned OFF every dependent field relaxes
// (nothing to validate); when it is ON the config fields become required.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

export const llmEvaluationSettingsSchema = z
  .object({
    // Master toggle — gates whether the rest of the form is required.
    enabled: z.boolean().default(false),
    // Conditional fields: optional at the object level, made required when
    // `enabled` is true via the superRefine below.
    spanIdentifier: z.string().optional().default(""),
    // The template select emits the option's `id` (a string) once a value is
    // chosen, but a prefilled pipeline may carry the whole template object.
    // Kept loose; the "required when enabled" check lives in superRefine.
    selectedTemplate: z.any().optional(),
    enableSampling: z.boolean().optional().default(true),
    // number <input>/<slider> can emit a string — coerce. Bounded 0–1.
    samplingRate: z.coerce.number().min(0).max(1).optional().default(0.01),
    outputStream: z.string().optional().default(""),
  })
  .superRefine((val, ctx) => {
    // When evaluation is disabled, nothing else is required.
    if (!val.enabled) return;

    if (!String(val.spanIdentifier ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spanIdentifier"],
        message: "Field is required!",
      });
    }

    // selectedTemplate may be a string id or a { id, name } object — both are
    // truthy when chosen; null / undefined / "" mean "not selected".
    if (
      val.selectedTemplate === null ||
      val.selectedTemplate === undefined ||
      val.selectedTemplate === ""
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedTemplate"],
        message: "Field is required!",
      });
    }

    if (!String(val.outputStream ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputStream"],
        message: "Field is required!",
      });
    }
  });

export type LlmEvaluationSettingsForm = z.infer<
  typeof llmEvaluationSettingsSchema
>;

// STATIC create defaults factory (per the recipe). The async-loaded prefill
// (existing pipeline / streamName-derived output stream) is applied after the
// data arrives via `form.reset(...)` — see the component's onMounted.
export const llmEvaluationSettingsDefaults =
  (): LlmEvaluationSettingsForm => ({
    enabled: false,
    spanIdentifier: "gen_ai_system",
    selectedTemplate: null,
    enableSampling: true,
    samplingRate: 0.01,
    outputStream: "",
  });
