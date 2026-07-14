// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the General Settings "platform settings" form (the two
// number fields inside the <OForm>). The logo text / logo uploads / theme color
// chips are pure-UI controls with their own inline actions and are decoupled
// OUTSIDE the form, so they are NOT in this schema.
//
// Restores the original BEFORE rules (truthy→Zod inversion):
//   • scrapeInterval: `!!v || scrapeIntervalRequired` (+ HTML min=0)
//       → required AND ≥ 0 (0 is a valid value).
//   • maxSeriesPerQuery: empty→pass; else `v>=1000 && v<=1000000`
//       → OPTIONAL, only range-checked when present (NOT required).
//
// The <input type="number"> emits a string, so the rules read the raw value via
// Number(); the submit handler coerces at use.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

const isEmpty = (v: unknown) => v === "" || v === null || v === undefined;

// Factory (takes `t`) so the messages are localized like makeLicenseSchema /
// makeAddEmailSchema, rather than hardcoded English. The component owns the
// `t` instance and builds the schema once in setup().
export const makeGeneralSettingsSchema = (t: (_key: string) => string) =>
  z.object({
    // Required (non-empty) and ≥ 0. 0 passes; empty fails as "required".
    scrape_interval: z
      .any()
      .refine((v) => !isEmpty(v), {
        message:
          t("settings.scrapeIntervalRequired") || "Scrape interval is required",
      })
      .refine(
        (v) => isEmpty(v) || (!Number.isNaN(Number(v)) && Number(v) >= 0),
        {
          message:
            t("settings.scrapeIntervalPositive") ||
            "Scrape interval must be a positive number",
        },
      ),
    // Optional — only range-checked (1000..1000000) when a value is present.
    max_series_per_query: z.any().refine(
      (v) =>
        isEmpty(v) ||
        (!Number.isNaN(Number(v)) &&
          Number(v) >= 1000 &&
          Number(v) <= 1000000),
      {
        message:
          t("settings.maxSeriesPerQueryValidation") ||
          "Max series per query must be between 1000 and 1000000",
      },
    ),
  });

export type GeneralSettingsForm = z.infer<
  ReturnType<typeof makeGeneralSettingsSchema>
>;
