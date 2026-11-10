// Copyright 2026 OpenObserve Inc.

// Shared schedule for every detection in a bulk install; the same bounds as the new-detection dialog.

import { z } from "zod";

import { toMinutes } from "./SecurityNewDetectionDialog.schema";

type Translate = (key: string, named?: Record<string, unknown>) => string;

export const makeBulkInstallSchema = (t: Translate) =>
  z
    .object({
      period: z.any().refine((v) => toMinutes(v) > 0, t("siem.detections.validation.positive")),
      frequency: z.any().refine((v) => toMinutes(v) > 0, t("siem.detections.validation.positive")),
      silence: z
        .any()
        .refine((v) => toMinutes(v) >= 0, t("siem.detections.validation.nonNegative")),
    })
    .superRefine((val, ctx) => {
      const period = toMinutes(val.period);
      // A period shorter than the frequency leaves minutes no run ever looks at.
      if (period > 0 && period < toMinutes(val.frequency)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["period"],
          message: t("siem.detections.validation.periodGap"),
        });
      }
    });

export type BulkInstallForm = z.infer<ReturnType<typeof makeBulkInstallSchema>>;

export const bulkInstallDefaults = (): BulkInstallForm => ({
  period: 15,
  frequency: 15,
  silence: 30,
});
