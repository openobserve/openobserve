// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityCaseCloseDialog.vue: a verdict and a reason, both required.

import { z } from "zod";
import { CASE_VERDICTS, type CaseVerdict } from "@/utils/security/cases";

type Translate = (key: string, named?: Record<string, unknown>) => string;

/** Mirrors the server's limit on a closing reason. */
export const MAX_REASON_CHARS = 2000;

/** Suppress-on-close lengths in minutes; 0 closes without suppressing, 7 days is the triage maximum. */
export const CLOSE_SUPPRESS_MINUTES = [0, 60, 240, 1440, 4320, 10080] as const;
export type CloseSuppressMinutes = (typeof CLOSE_SUPPRESS_MINUTES)[number];

/** What the one-click "close as benign and suppress" action starts with. */
export const BENIGN_SUPPRESS_DEFAULT_MINUTES: CloseSuppressMinutes = 1440;

export const makeCaseCloseSchema = (t: Translate) =>
  z.object({
    verdict: z.enum(CASE_VERDICTS, { message: t("siem.cases.close.verdictRequired") }),
    reason: z
      .string()
      .trim()
      .min(1, t("siem.cases.close.reasonRequired"))
      .max(MAX_REASON_CHARS, t("siem.cases.close.reasonTooLong", { max: MAX_REASON_CHARS })),
    suppressMinutes: z.coerce
      .number()
      .refine((m) => (CLOSE_SUPPRESS_MINUTES as readonly number[]).includes(m)),
    includeHigh: z.boolean(),
  });

export type CaseCloseForm = z.infer<ReturnType<typeof makeCaseCloseSchema>>;

/** The dialog's field values before validation; the verdict starts unpicked. */
export type CaseCloseValues = {
  verdict: CaseVerdict | undefined;
  reason: string;
  suppressMinutes: number;
  includeHigh: boolean;
};

/** Suppression applies only to a benign close; any other verdict drops it. */
export function suppressOf(form: Pick<CaseCloseForm, "verdict" | "suppressMinutes">): number {
  return form.verdict === "benign" ? form.suppressMinutes : 0;
}
