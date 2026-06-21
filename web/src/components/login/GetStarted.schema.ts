// Copyright 2026 OpenObserve Inc.
//
// Validation schema for GetStarted.vue (onboarding form). Both fields required.

import { z } from "zod";

export const getStartedSchema = z.object({
  hearAboutUs: z.string().trim().min(1, "This field is required"),
  whereDoYouWork: z.string().trim().min(1, "This field is required"),
  // Terms-agreement gate: must be checked (true) to allow submit. Using
  // `boolean().refine(...)` (not `literal(true)`) so the inferred type is
  // `boolean` and the default can start `false` without a cast.
  isAgree: z.boolean().refine((v) => v === true, {
    message: "You must accept the terms to continue",
  }),
});

export type GetStartedForm = z.infer<typeof getStartedSchema>;

export const getStartedDefaults = (): GetStartedForm => ({
  hearAboutUs: "",
  whereDoYouWork: "",
  // Start unchecked; `false` fails the `isAgree` gate until the user checks it.
  isAgree: false,
});
