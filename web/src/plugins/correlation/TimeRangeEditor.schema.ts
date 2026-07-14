// Copyright 2026 OpenObserve Inc.
//
// Validation schema for TimeRangeEditor.vue — the module's cross-field refine
// exemplar. Built via a factory so messages stay i18n-driven (pass `t`).
//
// The hand-rolled validateStartTime / validateEndTime are combined into a
// single superRefine:
//   • When selectedWindow === "custom", BOTH custom times are required
//     (`!v` → t("validation.required")), AND start < end
//     (start: t("correlation.logs.timeRange.startBeforeEnd");
//      end:   t("correlation.logs.timeRange.endAfterStart")).
//   • For preset windows the custom times are irrelevant → no rule.
//
// `selectedWindow` is form-owned too (it gates the conditional) — a plain string
// (one of the preset keys or "custom"); it has no per-field rule.

import { z } from "zod";

export const makeTimeRangeEditorSchema = (t: (_key: string) => string) =>
  z
    .object({
      selectedWindow: z.string(),
      customStartTime: z.string(),
      customEndTime: z.string(),
    })
    .superRefine((val, ctx) => {
      if (val.selectedWindow !== "custom") return;

      const hasStart = !!val.customStartTime;
      const hasEnd = !!val.customEndTime;

      if (!hasStart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customStartTime"],
          message: t("validation.required"),
        });
      }
      if (!hasEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customEndTime"],
          message: t("validation.required"),
        });
      }

      // Cross-field: start must be strictly before end. Emit on BOTH paths so
      // both inline messages light up.
      if (hasStart && hasEnd) {
        const start = new Date(val.customStartTime).getTime();
        const end = new Date(val.customEndTime).getTime();
        if (!(start < end)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["customStartTime"],
            message: t("correlation.logs.timeRange.startBeforeEnd"),
          });
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["customEndTime"],
            message: t("correlation.logs.timeRange.endAfterStart"),
          });
        }
      }
    });

export type TimeRangeEditorForm = z.infer<
  ReturnType<typeof makeTimeRangeEditorSchema>
>;
