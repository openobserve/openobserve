// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ColorBySeriesPopUp.vue. The whole form is the dynamic
// `series[]` array — each row needs a non-empty `value` (series name) and a
// non-null `color`.
//
// An EMPTY array is intentionally VALID: removing every row and saving clears
// all per-series colors. So NO `.min(1)` here; only the per-row rules apply to
// rows that exist.
//
// Each row's `value` is an OFormCombobox and `color` an OFormColor, both bound by
// indexed name (`series[i].value/color`). `color` is null until the user clicks
// "Set color" (enforced non-null below), so the required-color rule applies even
// before the picker is shown.

import { z } from "zod";

export const makeSeriesRowSchema = (t: (_key: string) => string) =>
  z
    .object({
      type: z.string().optional().default("value"),
      value: z.string().trim().min(1, t("dashboard.seriesValueRequired")),
      // null until the user clicks "Set color"; enforced non-empty below.
      color: z.union([z.string(), z.null()]).optional(),
    })
    .superRefine((row, ctx) => {
      if (typeof row.color !== "string" || row.color.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["color"],
          message: t("dashboard.colorRequired"),
        });
      }
    });

export const makeColorBySeriesPopUpSchema = (t: (_key: string) => string) =>
  z.object({
    // No `.min(1)`: an empty array is valid (saving with no rows clears all
    // per-series colors).
    series: z.array(makeSeriesRowSchema(t)),
  });

export type ColorBySeriesPopUpForm = z.infer<ReturnType<typeof makeColorBySeriesPopUpSchema>>;
