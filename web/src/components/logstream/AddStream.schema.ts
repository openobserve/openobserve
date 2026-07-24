// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddStream.vue — the scalar fields only (name,
// stream_type, dataRetentionDays). The per-row `StreamFieldInputs` array is
// validated separately and is not modelled here.
//
// Validation timing is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes what is valid.

import { z } from "zod";
import { makeStreamFieldRowSchema } from "./StreamFieldInputs.schema";

// Allowed characters mirror the backend `format_stream_name` regex
// (src/config/src/utils/schema.rs): alphanumeric, underscore and colon only.
export const streamNameRegex = /^[a-zA-Z0-9_:]+$/;

/**
 * Build the AddStream scalar schema.
 *
 * @param retentionEnabled whether the org has `data_retention_days` configured
 *   (the org-config half of `showDataRetention`). The stream-type half
 *   (`!== 'enrichment_tables'`) is read from the form value in superRefine.
 * @param t useI18n's `t`, so required messages resolve from the shared
 *   `logStream.*` keys.
 */
export const makeAddStreamSchema = (retentionEnabled: boolean, t: (_key: string) => string) =>
  z
    .object({
      // NO schema `.trim()`: OForm/TanStack uses the schema to VALIDATE but saves
      // the RAW form value (the transformed output is discarded). A `.trim()`
      // would let "mystream " pass (regex judges the trimmed copy) yet persist the
      // space — breaking stream lookups and diverging from the backend
      // `format_stream_name` rule. Validating the raw value means `streamNameRegex`
      // rejects ANY whitespace (leading/trailing/only).
      name: z
        .string()
        .min(1, t("logStream.streamNameRequired"))
        .regex(streamNameRegex, t("logStream.streamNameHelpText")),
      stream_type: z.string().min(1, t("logStream.streamTypeRequired")),
      // number <input> can emit a string — coerce. The "> 0" rule is
      // conditional (see superRefine) so a hidden retention field never blocks.
      dataRetentionDays: z.coerce.number().optional(),
      // Stream-level index_type is part of the seeded form state but has no
      // control; kept optional so it round-trips cleanly through the form.
      index_type: z.array(z.any()).optional().default([]),
      // Dynamic "Add Field" rows. Each row is validated by the row schema
      // (built with the same `t`); an empty draft row blocks submit with per-row
      // errors.
      fields: z.array(makeStreamFieldRowSchema(t)).default([]),
    })
    .superRefine((val, ctx) => {
      if (retentionEnabled && val.stream_type !== "enrichment_tables") {
        if (!(Number(val.dataRetentionDays) > 0)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["dataRetentionDays"],
            message: t("logStream.dataRetentionMin"),
          });
        }
      }
    });

export type AddStreamForm = z.infer<ReturnType<typeof makeAddStreamSchema>>;

// Static create defaults.
export const addStreamDefaults = (): AddStreamForm => ({
  name: "",
  stream_type: "",
  dataRetentionDays: 14,
  index_type: [],
  fields: [],
});
