// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the Saved View dialog in SearchBar.vue.
// Built via a factory so all messages stay i18n-driven (pass `t`).
//
// Mode-aware (conditional on `isSavedViewAction`, which is form-owned so the
// superRefine can branch on it):
//   • create → savedViewName required + alphanumeric regex;
//   • update → savedViewSelectedName required.

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
