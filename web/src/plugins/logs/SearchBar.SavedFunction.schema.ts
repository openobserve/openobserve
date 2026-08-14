// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the Save-as-Function dialog in SearchBar.vue (row 59).
//
// Mode-aware (conditional on `isSavedFunctionAction`, a form-owned field bound
// to an OFormToggleGroup so the superRefine can branch on it):
//   • create → savedFunctionName required + identifier regex;
//   • update → savedFunctionSelectedName required.

import { z } from "zod";

export const SAVED_FUNCTION_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export const makeSavedFunctionSchema = (t: (_key: string) => string) =>
  z
    .object({
      isSavedFunctionAction: z.string(),
      savedFunctionName: z.string(),
      savedFunctionSelectedName: z.string(),
    })
    .superRefine((val, ctx) => {
      if (val.isSavedFunctionAction === "create") {
        if (!val.savedFunctionName.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["savedFunctionName"],
            message: t("validation.required"),
          });
        } else if (!SAVED_FUNCTION_NAME_REGEX.test(val.savedFunctionName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["savedFunctionName"],
            message: t("validation.alphanumeric"),
          });
        }
      } else if (!val.savedFunctionSelectedName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["savedFunctionSelectedName"],
          message: t("validation.fieldRequired"),
        });
      }
    });

export type SavedFunctionForm = z.infer<ReturnType<typeof makeSavedFunctionSchema>>;
