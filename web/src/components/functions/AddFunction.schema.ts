// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the Add/Update Function form. AddFunction.vue OWNS the
// <OForm> + this schema; FunctionsToolbar.vue renders the validated `name` field
// (and the `transType` radios) into the shared OForm context (provide/inject).
//
// Migration notes (per the form-migration-playbook):
//   • name      — required + method-name regex → form-owned OFormInput in the
//                 toolbar. Restores the Quasar BEFORE rule
//                 `[!!v || 'Field is required!', isValidMethodName]`.
//   • transType — VRL ("0") / JavaScript ("1") → form-owned OFormRadioGroup in
//                 the toolbar. No strict rule (never carried `:rules`); optional.
//
// `function` (the Monaco VRL/JS body) and `params` are NOT form fields: the
// editor is a bare Monaco instance (documented no-OForm*-equivalent exception)
// rendered OUTSIDE the <OForm>, and `params` is a hidden constant. Both stay in
// the component's `formData` and are read from there at submit time.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

// Method-name pattern: must start with a letter or underscore, then letters /
// numbers / underscores (case-insensitive). Mirrors the old `isValidMethodName`.
export const functionNameRegex = /^[A-Z_][A-Z0-9_]*$/i;

export const addFunctionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Field is required!")
    .regex(
      functionNameRegex,
      "Invalid method name. Must start with a letter or underscore. Use only letters, numbers, and underscores.",
    ),
  transType: z.string().optional().default("0"),
});

export type AddFunctionForm = z.infer<typeof addFunctionSchema>;
