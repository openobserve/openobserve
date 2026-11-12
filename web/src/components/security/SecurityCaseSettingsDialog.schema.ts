// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityCaseSettingsDialog.vue, with the same bounds the server enforces.

import { z } from "zod";

type Translate = (key: string, named?: Record<string, unknown>) => string;

export const MAX_AUTO_CLOSE_DAYS = 365;
export const MAX_GROUP_WINDOW_MINUTES = 30 * 24 * 60;

// An emptied field must fail rather than coerce to 0, which would silently switch the setting off.
const wholeNumber = (t: Translate, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce
      .number({ message: t("siem.cases.settings.wholeNumber") })
      .int(t("siem.cases.settings.wholeNumber"))
      .min(0, t("siem.cases.settings.range", { max }))
      .max(max, t("siem.cases.settings.range", { max })),
  );

export const makeCaseSettingsSchema = (t: Translate) =>
  z.object({
    auto_close_days: wholeNumber(t, MAX_AUTO_CLOSE_DAYS),
    group_window_minutes: wholeNumber(t, MAX_GROUP_WINDOW_MINUTES),
  });

/** Field values as typed; a cleared number input holds an empty string. */
export type CaseSettingsValues = {
  auto_close_days: number | string;
  group_window_minutes: number | string;
};
