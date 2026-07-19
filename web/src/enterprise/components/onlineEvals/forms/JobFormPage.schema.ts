// Copyright 2026 OpenObserve Inc.
//
// Validation schema for JobFormPage.vue (online-evals eval-job create/edit page).

import { z } from "zod";

const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeJobFormSchema = (t: (_key: string) => string) =>
  z
    .object({
      name: requiredText(t("onlineEvals.job.validation.nameRequired")),
      stream: requiredText(t("onlineEvals.job.validation.streamRequired")),
      description: z.string().optional().default(""),
      // Internal metadata (not a rendered control), non-validated.
      streamType: z.string().optional().default("traces"),
      // Not validated here: JobScorerPicker has no inline error slot, so the
      // "≥1 scorer" rule is enforced as a toast guard in the component's onSubmit.
      scorerIds: z.array(z.string()),
      samplingMode: z.string().default("rate"),
      samplingValue: z.string().optional().default(""),
    })
    .superRefine((val, ctx) => {
      // Sampling value is required unless the mode is "all" (which ignores it).
      if (
        val.samplingMode !== "all" &&
        String(val.samplingValue ?? "").trim().length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["samplingValue"],
          message: t("onlineEvals.job.validation.samplingValueRequired"),
        });
      }
    });

export type JobForm = z.infer<ReturnType<typeof makeJobFormSchema>>;
