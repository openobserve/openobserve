// Copyright 2026 OpenObserve Inc.
//
// Validation schema for LlmEvaluation.vue (the `llm_evaluation` pipeline-node
// drawer). Built via a factory so the required message stays i18n-driven
// (pass useI18n's `t`).
//
// This is an Options-API SFC (`<script lang="ts">` + `setup()`), so BOTH the
// schema and the defaults MUST be returned from `setup()` — a module-level
// import is out of the template's scope, so `:schema` would silently resolve to
// `undefined` and OForm would never validate (foundation checklist §5.6).
//
// Field ownership (every editable control inside <OForm> is form-owned, R1-strict):
//   • nodeName       — required (trim + min 1); restores the BEFORE-baseline
//                      `!!v || nameRequired` rule.
//   • spanIdentifier — optional OFormSelect (LLM span identifier).
//   • template       — optional/nullable OFormSelect (evaluation template id).
//   • enableSampling — optional OFormSwitch.
//   • samplingRate   — optional OFormSlider (0..1).
//
// Validation TIMING is owned by OForm (submit-then-change); this file only
// describes WHAT is valid.

import { z } from "zod";

export const makeLlmEvaluationSchema = (t: (_key: string) => string) =>
  z.object({
    nodeName: z.string().trim().min(1, t("common.nameRequired")),
    spanIdentifier: z.string().optional(),
    template: z.string().nullable().optional(),
    enableSampling: z.boolean().optional(),
    samplingRate: z.number().min(0).max(1).optional(),
  });

export type LlmEvaluationForm = z.infer<
  ReturnType<typeof makeLlmEvaluationSchema>
>;
