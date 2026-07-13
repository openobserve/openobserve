// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the Saved View dialog in SearchBar.vue (row 58).
// Built via a factory so all messages stay i18n-driven (pass `t`); the keys
// resolve to the exact strings the component used before migration.
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
            message: t("validation.required"),
          });
        } else if (!SAVED_VIEW_NAME_REGEX.test(val.savedViewName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["savedViewName"],
            message: t("validation.alphanumeric"),
          });
        }
      } else if (!val.savedViewSelectedName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["savedViewSelectedName"],
          message: t("validation.fieldRequired"),
        });
      }
    });

export type SavedViewForm = z.infer<ReturnType<typeof makeSavedViewSchema>>;
