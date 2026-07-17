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

// A FACTORY (not a module-level schema): the messages are resolved by calling
// the injected `t` (vue-i18n) when the schema is built. The owner builds it per
// mount from its `useI18n()` context, so `t` resolves in the active locale. A
// module-level schema would instead evaluate `t` at import time — before i18n is
// ready and frozen to whatever locale loaded first. The `(t: (_key: string) =>
// string)` signature mirrors makeAddDashboardSchema and the other form schemas.
export const makeAddFunctionSchema = (t: (_key: string) => string) =>
  z.object({
    // NO .trim(): OForm/TanStack validates with the schema but SAVES the raw form
    // value, so a .trim() would let "myfunc " PASS validation (the regex judges the
    // trimmed copy) yet persist the space — breaking pipeline/query references to
    // the function. Validate the RAW value; the anchored regex already rejects any
    // leading/trailing whitespace (a leading space fails the first-char class, a
    // trailing space fails the `$`).
    name: z
      .string()
      .min(1, t("function.nameRequired"))
      .regex(functionNameRegex, t("function.invalidMethodName")),
    transType: z.string().optional().default("0"),
  });

export type AddFunctionForm = z.infer<ReturnType<typeof makeAddFunctionSchema>>;
