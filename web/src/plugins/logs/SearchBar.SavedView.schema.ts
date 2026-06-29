// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the Saved View dialog in SearchBar.vue (row 58).
// Built via a factory so messages stay i18n-driven (pass `t`); a few messages
// are literals to preserve the exact strings the component used.
//
// Mode-aware (conditional on `isSavedViewAction`, which is form-owned so the
// superRefine can branch on it):
//   • create → savedViewName required + alphanumeric regex;
//   • update → savedViewSelectedName required.
//
// Restored from the current SearchBar code (preserve the regex in use TODAY,
// per the brief's BEFORE-vs-current reconciliation note):
//   savedViewName — `!!v.trim() || 'This field is required'`
//                ;  `/^[A-Za-z0-9 _-]+$/.test(v) || 'Input must be alphanumeric'`
//   savedViewSelectedName — `!!v || 'Field is required!'` (update mode).

import { z } from "zod";

export const SAVED_VIEW_NAME_REGEX = /^[A-Za-z0-9 _-]+$/;

export const makeSavedViewSchema = (t: (_key: string) => string) =>
  z
    .object({
      isSavedViewAction: z.string(),
      savedViewName: z.string(),
      savedViewSelectedName: z.string(),
    })
    .superRefine((val, ctx) => {
      if (val.isSavedViewAction === "create") {
        if (!val.savedViewName.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["savedViewName"],
            message: "This field is required",
          });
        } else if (!SAVED_VIEW_NAME_REGEX.test(val.savedViewName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["savedViewName"],
            message: "Input must be alphanumeric",
          });
        }
      } else if (!val.savedViewSelectedName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["savedViewSelectedName"],
          message: "Field is required!",
        });
      }
    });

export type SavedViewForm = z.infer<ReturnType<typeof makeSavedViewSchema>>;
