// Copyright 2026 OpenObserve Inc.
//
// Validation schema for PanelLayoutSettings.vue. The form collects a single
// editable value: the panel height `h`. The remaining layout members
// (w/x/y/i) are NOT editable here — they are carried over from the existing
// layout at submit, so they are not form fields.
//
// The `layout.h` rule:
//   empty → t("common.required"); else v > 0 ? pass : t("common.valueMustBeGreaterThanZero")
// i.e. required (falsy → required) AND must be > 0 (negative → greater-than-zero).
// Factory keeps both messages i18n-driven. Validation TIMING is owned by OForm.

import { z } from "zod";

export const makePanelLayoutSettingsSchema = (t: (_key: string) => string) =>
  z
    .object({
      // Loose at the field level so the two distinct messages are emitted from
      // superRefine (a strict z.number() would surface its own "invalid number"
      // text and clobber the required/greater-than-zero distinction).
      h: z.coerce.number().optional(),
    })
    .superRefine((val, ctx) => {
      const h = Number(val.h);
      // falsy (0 / "" / undefined / NaN) → required
      if (!h || Number.isNaN(h)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["h"],
          message: t("common.required"),
        });
      } else if (h <= 0) {
        // truthy but non-positive (negative) → greater-than-zero
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["h"],
          message: t("common.valueMustBeGreaterThanZero"),
        });
      }
    });

export type PanelLayoutSettingsForm = z.infer<ReturnType<typeof makePanelLayoutSettingsSchema>>;
