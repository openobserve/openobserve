// Copyright 2026 OpenObserve Inc.
//
// Validation schema for schema.vue's "Add Field(s)" flow. The dynamic rows are
// rendered by the (now form-only) StreamFieldInputs, so schema.vue owns a small
// TanStack form whose only field is the `newSchemaFields` array.
//
// ⚠️ INTENTIONALLY PERMISSIVE. Before the form-only migration, schema.vue never
// validated these rows — it rendered the child without ever calling validate()
// and just normalized field names at save time. To preserve that exact behavior
// (the save is NOT blocked; loose/empty names are accepted and normalized), this
// row schema carries NO required/regex rules. (AddStream, which DID enforce its
// rows before, keeps the strict `streamFieldRowSchema` instead.)

import { z } from "zod";

// Permissive row: every field optional, no character rule. The form is always
// valid, so the save is never gated on it (matches pre-migration behavior).
const schemaFieldRowSchema = z.object({
  uuid: z.string().optional(),
  name: z.string().optional().default(""),
  type: z.string().optional().default(""),
  index_type: z.array(z.any()).optional().default([]),
});

export const schemaFieldsSchema = z.object({
  newSchemaFields: z.array(schemaFieldRowSchema).default([]),
});

export type SchemaFieldsForm = z.infer<typeof schemaFieldsSchema>;

export const schemaFieldsDefaults = (): SchemaFieldsForm => ({
  newSchemaFields: [],
});
