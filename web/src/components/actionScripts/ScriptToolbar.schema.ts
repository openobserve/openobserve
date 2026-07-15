// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ScriptToolbar.vue (the action-script editor header bar).
// Migrated from the old hand-rolled `isValidMethodName` + `scriptNameError`
// computed to a single Zod schema on <OForm :schema>.
//
// Restores the BEFORE baseline for the `actionName` field:
// `!!v || 'Field is required!'`
// (required) AND `isValidMethodName` (the method-name regex). The truthy guard
// inverts to a positive Zod constraint, so it is required + regex — not
// regex-only.
//
// Built via a factory so the messages stay i18n-driven (pass useI18n's `t`),
// consistent with the other migrated schemas. Validation TIMING is owned by
// OForm (submit-then-change via revalidateLogic); this file only describes WHAT
// is valid.

import { z } from "zod";

// Method-name pattern: must start with a letter or underscore, then only
// letters / numbers / underscores. (Same pattern FunctionsToolbar / AddFunction
// use elsewhere.)
export const scriptMethodNameRegex = /^[A-Z_][A-Z0-9_]*$/i;

export const makeScriptToolbarSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z.object({
    name: z
      .string()
      // Pre-migration used `v-model.trim`, so surrounding whitespace was stripped
      // before the required + method-name checks ran. `.trim()` restores that
      // parity — " abc " validates as "abc" instead of being rejected by the regex.
      .trim()
      .min(1, t("actions.fieldRequired"))
      .regex(scriptMethodNameRegex, t("actions.invalidMethodName")),
  });

export type ScriptToolbarForm = z.infer<ReturnType<typeof makeScriptToolbarSchema>>;
