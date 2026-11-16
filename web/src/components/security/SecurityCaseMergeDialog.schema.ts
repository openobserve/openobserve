// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityCaseMergeDialog.vue: the case to keep is required, the reason optional.

import { z } from "zod";

type Translate = (key: string, named?: Record<string, unknown>) => string;

/** Mirrors the server's limit on a merge reason. */
export const MAX_MERGE_REASON_CHARS = 1000;

export const makeCaseMergeSchema = (t: Translate) =>
  z.object({
    target: z.string().min(1, t("siem.cases.merge.targetRequired")),
    reason: z
      .string()
      .trim()
      .max(
        MAX_MERGE_REASON_CHARS,
        t("siem.cases.merge.reasonTooLong", { max: MAX_MERGE_REASON_CHARS }),
      ),
  });

export type CaseMergeValues = { target: string; reason: string };
