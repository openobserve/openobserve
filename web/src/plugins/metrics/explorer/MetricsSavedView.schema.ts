// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the Metrics Saved View dialog. Mirrors the Logs saved
// view schema (plugins/logs/SearchBar.SavedView.schema.ts) — same name rules and
// i18n keys — so the two pages validate identically. Kept local to Metrics rather
// than importing across plugins to avoid coupling the two features.
//
// Mode-aware (conditional on `isSavedViewAction`, form-owned so the superRefine
// can branch on it):
//   • create → savedViewName required + alphanumeric regex;
//   • update → savedViewSelectedName required.

import { z } from "zod";

export const SAVED_VIEW_NAME_REGEX = /^[A-Za-z0-9 _-]+$/;

export const makeMetricsSavedViewSchema = (t: (_key: string) => string) =>
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

export type MetricsSavedViewForm = z.infer<
  ReturnType<typeof makeMetricsSavedViewSchema>
>;
