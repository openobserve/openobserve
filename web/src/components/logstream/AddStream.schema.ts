// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddStream.vue — the SCALAR fields only (name,
// stream_type, dataRetentionDays). The per-row `StreamFieldInputs` array stays
// in legacy prop-mode with its own exposed validate() (a documented deferred
// exception until OForm gains first-class field-array support), so it is NOT
// modelled here.
//
// Restored from the Quasar BEFORE baseline (complete-quasar-validation-inventory):
//   • name              → `!!v.trim() || 'Field is required!'` (required) plus the
//                         live `/^[a-zA-Z0-9_:]+$/` character rule. Encoded WITHOUT
//                         a schema `.trim()` (see the field note below): the regex
//                         rejects any whitespace on the RAW value, matching `main`,
//                         which rejected — never silently stripped — dirty names.
//   • stream_type       → `!!v || 'Field is required!'` (required).
//   • dataRetentionDays → `v > 0 || 'Field is required!'` (numeric > 0), but
//                         ONLY when the retention field is actually shown
//                         (data_retention_days configured AND not an
//                         enrichment_tables stream) — encoded conditionally in
//                         superRefine, since `showDataRetention` also depends on
//                         org config the schema can't read.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { streamFieldRowSchema } from "./StreamFieldInputs.schema";

// Allowed characters mirror the backend `format_stream_name` regex
// (src/config/src/utils/schema.rs): alphanumeric, underscore and colon only.
export const streamNameRegex = /^[a-zA-Z0-9_:]+$/;
export const streamNameHelpText =
  "Use alphanumeric characters, underscore and colon only.";

/**
 * Build the AddStream scalar schema.
 *
 * @param retentionEnabled whether the org has `data_retention_days` configured
 *   (the org-config half of `showDataRetention`). The stream-type half
 *   (`!== 'enrichment_tables'`) is read from the form value in superRefine.
 */
export const makeAddStreamSchema = (retentionEnabled: boolean) =>
  z
    .object({
      // NO schema `.trim()`: OForm/TanStack uses the schema to VALIDATE but saves
      // the RAW form value (the transformed output is discarded). A `.trim()`
      // would let "mystream " pass (regex judges the trimmed copy) yet persist the
      // space — breaking stream lookups and diverging from the backend
      // `format_stream_name` rule. Validating the raw value means `streamNameRegex`
      // rejects ANY whitespace (leading/trailing/only), exactly as `main` did.
      name: z
        .string()
        .min(1, "Field is required!")
        .regex(streamNameRegex, streamNameHelpText),
      stream_type: z.string().min(1, "Field is required!"),
      // number <input> can emit a string — coerce. The "> 0" rule is
      // conditional (see superRefine) so a hidden retention field never blocks.
      dataRetentionDays: z.coerce.number().optional(),
      // Stream-level index_type is part of the seeded form state but has no
      // control; kept optional so it round-trips cleanly through the form.
      index_type: z.array(z.any()).optional().default([]),
      // Dynamic "Add Field" rows, now owned by the form (StreamFieldInputs is
      // form-mode). Each row is validated by streamFieldRowSchema; an empty draft
      // row therefore blocks submit with per-row errors.
      fields: z.array(streamFieldRowSchema).default([]),
    })
    .superRefine((val, ctx) => {
      if (retentionEnabled && val.stream_type !== "enrichment_tables") {
        if (!(Number(val.dataRetentionDays) > 0)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["dataRetentionDays"],
            message: "Field is required!",
          });
        }
      }
    });

export type AddStreamForm = z.infer<ReturnType<typeof makeAddStreamSchema>>;

// STATIC create defaults (returned/bound inline per the recipe).
export const addStreamDefaults = (): AddStreamForm => ({
  name: "",
  stream_type: "",
  dataRetentionDays: 14,
  index_type: [],
  fields: [],
});
