// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ScriptToolbar.vue (the action-script editor header bar).
// Migrated from the old hand-rolled `isValidMethodName` + `scriptNameError`
// computed to a single Zod schema on <OForm :schema>.
//
// Restores the Quasar BEFORE baseline for the `actionName` field
// (complete-quasar-validation-inventory-BEFORE.md): `!!v || 'Field is required!'`
// (required) AND `isValidMethodName` (the method-name regex). The truthy guard
// inverts to a positive Zod constraint, so it is required + regex — not
// regex-only.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

// Method-name pattern: must start with a letter or underscore, then only
// letters / numbers / underscores. (Same pattern FunctionsToolbar / AddFunction
// use elsewhere.)
export const scriptMethodNameRegex = /^[A-Z_][A-Z0-9_]*$/i;

export const scriptToolbarSchema = z.object({
  name: z
    .string()
    // Pre-migration used `v-model.trim`, so surrounding whitespace was stripped
    // before the required + method-name checks ran. `.trim()` restores that
    // parity — " abc " validates as "abc" instead of being rejected by the regex.
    .trim()
    .min(1, "Field is required!")
    .regex(
      scriptMethodNameRegex,
      "Invalid method name. Must start with a letter or underscore. Use only letters, numbers, and underscores.",
    ),
});

export type ScriptToolbarForm = z.infer<typeof scriptToolbarSchema>;
