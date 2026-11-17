// Copyright 2026 OpenObserve Inc.

// Minutes arrive as strings from the number inputs; anything unparsable counts as 0, as before.

import { z } from "zod";

type Translate = (key: string, named?: Record<string, unknown>) => string;

export const toMinutes = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Hours of history a new detection may opt to evaluate; the server caps it at its backfill limit. */
export const BACKFILL_HOURS = [1, 6, 24] as const;

export const makeNewDetectionSchema = (
  t: Translate,
  takenNames: () => readonly string[],
  timespanMinutes: () => number | null | undefined = () => null,
) =>
  z
    .object({
      name: z.string(),
      period: z.any().refine((v) => toMinutes(v) > 0, t("siem.detections.validation.positive")),
      frequency: z.any().refine((v) => toMinutes(v) > 0, t("siem.detections.validation.positive")),
      silence: z
        .any()
        .refine((v) => toMinutes(v) >= 0, t("siem.detections.validation.nonNegative")),
      backfill: z.boolean(),
      backfillHours: z.any(),
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
      // A correlation counts within its timespan, so a shorter look-back could never see it whole.
      const timespan = timespanMinutes() ?? 0;
      if (timespan > 0 && period > 0 && period < timespan) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["period"],
          message: t("siem.detections.validation.belowTimespan", { minutes: timespan }),
        });
      }
      // History joins firings to rules by name, so a reused name would merge two histories.
      if (val.name && takenNames().includes(val.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: t("siem.detections.nameTaken", { name: val.name }),
        });
      }
    });

export type NewDetectionForm = z.infer<ReturnType<typeof makeNewDetectionSchema>>;

export const newDetectionDefaults = (): NewDetectionForm => ({
  name: "",
  period: 15,
  frequency: 15,
  silence: 30,
  backfill: false,
  backfillHours: 24,
});
