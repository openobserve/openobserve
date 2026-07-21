// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the License key entry (License.vue). The same
// `licenseKey` field is entered in two mutually-exclusive cards (the "no
// license" card and the "update license" card); both share this schema.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

export const makeLicenseSchema = (t: (_key: string) => string) =>
  z.object({
    licenseKey: z
      .string()
      .trim()
      .min(1, t("about.license_key_required") || "License key is required"),
  });

export type LicenseForm = z.infer<ReturnType<typeof makeLicenseSchema>>;
