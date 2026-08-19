// Copyright 2026 OpenObserve Inc.
//
// Validation schema for GetStarted.vue (onboarding form). Both fields required.

import { z } from "zod";

import type { TranslateFn } from "@/types/i18n";

// Factory, not a const: the caller threads its own `t`, matching the
// makeXSchema(t) convention used by the other form schemas.
export const makeGetStartedSchema = (t: TranslateFn) =>
  z.object({
    hearAboutUs: z
      .string()
      .trim()
      .min(1, { error: () => t("validation.required") }),
    whereDoYouWork: z
      .string()
      .trim()
      .min(1, { error: () => t("validation.required") }),
    // Terms-agreement gate: must be checked (true) to allow submit. Using
    // `boolean().refine(...)` (not `literal(true)`) so the inferred type is
    // `boolean` and the default can start `false` without a cast.
    isAgree: z.boolean().refine((v) => v === true, {
      error: () => t("login.mustAcceptTerms"),
    }),
  });

export type GetStartedForm = z.infer<ReturnType<typeof makeGetStartedSchema>>;

export const getStartedDefaults = (): GetStartedForm => ({
  hearAboutUs: "",
  whereDoYouWork: "",
  // Start unchecked; `false` fails the `isAgree` gate until the user checks it.
  isAgree: false,
});
