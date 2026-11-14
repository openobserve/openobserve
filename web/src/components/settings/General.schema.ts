// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the General Settings "platform settings" form (the two
// number fields and the branding text inside the <OForm>). The logo uploads and
// theme color chips are pure-UI controls with their own actions and are NOT in
// this schema.
//
// Rules:
//   • scrape_interval: required AND ≥ 0 (0 is a valid value).
//   • max_series_per_query: OPTIONAL, only range-checked (1000..1000000) when
//     present.
//
// The <input type="number"> emits a string, so the rules read the raw value via
// Number(); the submit handler coerces at use.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

const isEmpty = (v: unknown) => v === "" || v === null || v === undefined;

// Factory (takes `t`) so the messages are localized. The component owns the
// `t` instance and builds the schema once in setup().
export const makeGeneralSettingsSchema = (t: (_key: string) => string) =>
  z.object({
    // Required (non-empty) and ≥ 0. 0 passes; empty fails as "required".
    scrape_interval: z
      .any()
      .refine((v) => !isEmpty(v), {
        message: t("settings.scrapeIntervalRequired"),
      })
      .refine((v) => isEmpty(v) || (!Number.isNaN(Number(v)) && Number(v) >= 0), {
        message: t("settings.scrapeIntervalPositive"),
      }),
    // Optional — only range-checked (1000..1000000) when a value is present.
    max_series_per_query: z
      .any()
      .refine(
        (v) =>
          isEmpty(v) || (!Number.isNaN(Number(v)) && Number(v) >= 1000 && Number(v) <= 1000000),
        {
          message: t("settings.general.maxSeriesError"),
        },
      ),
    // Instance branding text, saved by its own request; empty restores the default name.
    custom_logo_text: z.string().max(100, t("settings.general.logoTextTooLong")),
  });

export type GeneralSettingsForm = z.infer<ReturnType<typeof makeGeneralSettingsSchema>>;
