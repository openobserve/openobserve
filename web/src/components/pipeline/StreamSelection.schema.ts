// Copyright 2026 OpenObserve Inc.
//
// Validation schema for StreamSelection.vue (the inline "Add Pipeline" step).
// Built via a factory so the name-required message stays i18n-driven (pass
// useI18n's `t`).
//
// Field ownership (R1-strict — every editable control is form-owned):
//   • name        — required + character regex. RESTORED conditional req+regex
//                   from the BEFORE baseline (truthy→Zod inversion): empty → the
//                   name-required message; non-empty → the alphanumeric regex.
//   • description — optional.
//   • stream_type — required ('Field is required!').
//   • stream_name — required ('Field is required!').

import { z } from "zod";

// Same character set the old `isValidName` computed enforced.
export const streamSelectionNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;

export const makeAddPipelineSchema = (t: (_key: string) => string) =>
  z.object({
    name: z
      .string()
      // NO .trim(): OForm/TanStack validates with the schema but SAVES the raw
      // value (emit('save', value) -> savePipeline spreads it into
      // createPipeline), so .trim() would let "mypipe " pass validation yet
      // persist the space. Validate the raw value — the regex below rejects
      // spaces, so a whitespace name is correctly blocked.
      .min(1, t("common.nameRequired"))
      .regex(streamSelectionNameRegex, t("pipeline.streamSelectionNameInvalid")),
    description: z.string().optional(),
    stream_type: z.string().min(1, t("pipeline.fieldRequired")),
    stream_name: z.string().min(1, t("pipeline.fieldRequired")),
  });

export type AddPipelineForm = z.infer<ReturnType<typeof makeAddPipelineSchema>>;

export const addPipelineDefaults = (): AddPipelineForm => ({
  name: "",
  description: "",
  stream_type: "",
  stream_name: "",
});
