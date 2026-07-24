// Copyright 2026 OpenObserve Inc.
//
// Validation schema for schema.vue's "Add Field(s)" flow. The dynamic rows are
// rendered by StreamFieldInputs, so schema.vue owns a small TanStack form whose
// only field is the `newSchemaFields` array. schema.vue's `onSubmit` runs this
// validation and bails when a row is invalid.
//
// IMPORTANT — validate the NORMALIZED name, not the raw one. schema.vue
// normalizes each name at save time (trim + lowercase + space/hyphen → "_"), so
// "my field" and "my-field" legitimately become "my_field". Judging the raw
// value would wrongly block those. We therefore validate each name the way it
// will actually be persisted: only characters that survive normalization and
// remain invalid (like "!" or ".") fail — the space/hyphen auto-fix is kept.

import { z } from "zod";
import { streamFieldNameRegex } from "./StreamFieldInputs.schema";

// Mirrors the save-time normalization in schema.vue's onSubmit — keep in sync.
const normalizeFieldName = (v: string): string =>
  v.trim().toLowerCase().replace(/ /g, "_").replace(/-/g, "_");

/**
 * Build the "Add Field(s)" form schema.
 *
 * @param t useI18n's `t`, so required messages resolve from the shared
 *   `logStream.*` keys.
 */
export const makeSchemaFieldsSchema = (t: (_key: string) => string) =>
  z.object({
    newSchemaFields: z
      .array(
        z.object({
          uuid: z.string().optional(),
          // Required + valid-after-normalization. Two refinements keep the
          // messages distinct: an empty/whitespace name reads "required"; a
          // non-empty name whose normalized form still breaks the character rule
          // reads the help text.
          name: z
            .string()
            .refine((v) => v.trim().length > 0, {
              message: t("logStream.fieldRequired"),
            })
            .refine(
              (v) => v.trim().length === 0 || streamFieldNameRegex.test(normalizeFieldName(v)),
              { message: t("logStream.streamNameHelpText") },
            ),
          // data_type is visible + required in schema.vue's Add Field(s) card.
          type: z.string().min(1, t("logStream.dataTypeRequired")),
          index_type: z.array(z.any()).optional().default([]),
        }),
      )
      .default([]),
  });

export type SchemaFieldsForm = z.infer<ReturnType<typeof makeSchemaFieldsSchema>>;

export const schemaFieldsDefaults = (): SchemaFieldsForm => ({
  newSchemaFields: [],
});
