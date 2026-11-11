// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityCaseCloseDialog.vue: a verdict and a reason, both required.

import { z } from "zod";
import { CASE_VERDICTS, type CaseVerdict } from "@/utils/security/cases";

type Translate = (key: string, named?: Record<string, unknown>) => string;

/** Mirrors the server's limit on a closing reason. */
export const MAX_REASON_CHARS = 2000;

export const makeCaseCloseSchema = (t: Translate) =>
  z.object({
    verdict: z.enum(CASE_VERDICTS, { message: t("siem.cases.close.verdictRequired") }),
    reason: z
      .string()
      .trim()
      .min(1, t("siem.cases.close.reasonRequired"))
      .max(MAX_REASON_CHARS, t("siem.cases.close.reasonTooLong", { max: MAX_REASON_CHARS })),
  });

export type CaseCloseForm = z.infer<ReturnType<typeof makeCaseCloseSchema>>;

/** The dialog's field values before validation; the verdict starts unpicked. */
export type CaseCloseValues = { verdict: CaseVerdict | undefined; reason: string };
