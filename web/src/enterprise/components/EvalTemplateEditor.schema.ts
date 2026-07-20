// Copyright 2026 OpenObserve Inc.
//
// Validation schema for EvalTemplateEditor.vue (the eval-template create/edit
// page). Replaces the hand-rolled `errors` ref + the `saveTemplate()` manual
// checks with a schema-driven OForm (online-evals-migration.md re-audit row).
//
// `dimensions` is a creatable multi-select → a form-owned `z.array(...)` field
// (TanStack owns arrays). Edit-prefill arrives async (fetched in onBeforeMount),
// so the component seeds blank defaults and `form.reset(record)` once it loads.

import { z } from "zod";

const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeEvalTemplateSchema = (t: (_key: string) => string) =>
  z.object({
    name: requiredText(t("evalTemplate.nameRequired")),
    description: z.string().optional().default(""),
    response_type: requiredText(t("evalTemplate.responseTypeRequired")),
    dimensions: z.array(z.string()).min(1, t("evalTemplate.dimensionRequired")),
    content: requiredText(t("evalTemplate.contentRequired")),
  });

export type EvalTemplateForm = z.infer<ReturnType<typeof makeEvalTemplateSchema>>;

export const evalTemplateDefaults = (): EvalTemplateForm => ({
  name: "",
  description: "",
  response_type: "",
  dimensions: [],
  content: "",
});
