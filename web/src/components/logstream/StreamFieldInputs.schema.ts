// Copyright 2026 OpenObserve Inc.
//
// Row schema for the StreamFieldInputs field-array. The component OWNS the
// per-row contract (it is shared by AddStream + schema.vue), so the schema for
// a single row lives here and both parents compose it into their own form
// schema as `z.array(streamFieldRowSchema)`.
//
// Restored from the component's legacy `validate()` (prop-mode):
//   • name → required (trim) + `/^[a-zA-Z0-9_:]+$/`
//   • type → required (the data-type select; enforced when it is visible, which
//            both live parents do — visibleInputs.data_type = true).
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

// Allowed characters mirror the backend `format_stream_name` regex
// (src/config/src/utils/schema.rs): alphanumeric, underscore and colon only.
export const streamFieldNameRegex = /^[a-zA-Z0-9_:]+$/;
export const streamFieldNameHelpText =
  "Use alphanumeric characters, underscore and colon only.";

export const streamFieldRowSchema = z.object({
  // Optional row id kept for parent bookkeeping. NOT the v-for key (rows key by
  // INDEX so index-based `name` bindings stay correct on a mid-list delete).
  uuid: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Field name is required")
    .regex(streamFieldNameRegex, streamFieldNameHelpText),
  type: z.string().min(1, "Data type is required"),
  index_type: z.array(z.any()).optional().default([]),
});

export type StreamFieldRow = z.infer<typeof streamFieldRowSchema>;

// Factory for a fresh blank row (parents push this via form.pushFieldValue).
export const makeStreamFieldRow = (): StreamFieldRow => ({
  uuid: crypto.randomUUID(),
  name: "",
  type: "",
  index_type: [],
});
