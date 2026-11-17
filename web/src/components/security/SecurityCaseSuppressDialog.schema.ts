// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityCaseSuppressDialog.vue: a duration from the offered set and a reason.

import { z } from "zod";

type Translate = (key: string, named?: Record<string, unknown>) => string;

/** Offered suppression lengths in minutes: 1 hour, 24 hours, 7 days, 30 days (the server's maximum). */
export const SUPPRESS_DURATIONS = [60, 1440, 10080, 43200] as const;
export type SuppressDuration = (typeof SUPPRESS_DURATIONS)[number];

/** Longest suppression the triage grant may create; longer ones need Security write. */
export const TRIAGE_MAX_SUPPRESS_MINUTES = 10080;

/** Mirrors the server's limit on a suppression reason. */
export const MAX_SUPPRESS_REASON_CHARS = 1000;

export const makeCaseSuppressSchema = (t: Translate) =>
  z.object({
    duration: z.coerce
      .number()
      .refine((m) => (SUPPRESS_DURATIONS as readonly number[]).includes(m), {
        message: t("siem.cases.suppress.durationRequired"),
      }),
    reason: z
      .string()
      .trim()
      .min(1, t("siem.cases.suppress.reasonRequired"))
      .max(
        MAX_SUPPRESS_REASON_CHARS,
        t("siem.cases.suppress.reasonTooLong", { max: MAX_SUPPRESS_REASON_CHARS }),
      ),
    closeCase: z.boolean(),
  });

export type CaseSuppressForm = z.infer<ReturnType<typeof makeCaseSuppressSchema>>;

export type CaseSuppressValues = { duration: number; reason: string; closeCase: boolean };
