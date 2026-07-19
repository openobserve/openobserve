// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddRegexPattern.vue. `name` and `pattern` are the
// validated fields — both required. Built via a factory so the required messages
// stay i18n-driven (pass useI18n's `t`).
//
// Every control inside the OForm is form-owned (no bare base components): the
// non-validated `description` (saved), and the test-feature `testString`/
// `outputString` (NOT saved — excluded from the payload) are all `.optional()`
// here. The component seeds them via a typed `defaults` computed (edit → the
// loaded pattern's values, create → blank).

import { z } from "zod";

export const makeAddRegexPatternSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("regex_patterns.name_required")),
    pattern: z.string().trim().min(1, t("regex_patterns.pattern_required")),
    // Saved with the pattern but not validated (optional). Form-owned so it's not
    // a parallel ref — comes through the @submit payload.
    description: z.string().optional(),
    // Regex-test feature fields (NOT saved — excluded from the payload). Form-owned
    // only for consistency (no bare base components inside the OForm).
    testString: z.string().optional(),
    outputString: z.string().optional(),
  });

export type AddRegexPatternForm = z.infer<
  ReturnType<typeof makeAddRegexPatternSchema>
>;
