// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityDetectionExceptions.vue, with the server's limits.

import { z } from "zod";

import type { ExceptionOperator, NewDetectionException } from "@/services/securitySigma";

type Translate = (key: string, named?: Record<string, unknown>) => string;

/** Operators offered; `in_list` takes allowlist ids instead of typed values. */
export const EXCEPTION_OPERATORS = [
  "equals",
  "contains",
  "starts_with",
  "ends_with",
  "in_cidr",
  "in_list",
] as const satisfies readonly ExceptionOperator[];

/** Days an exception may last; 0 never expires. */
export const EXCEPTION_EXPIRY_DAYS = [0, 1, 7, 30, 90] as const;

export const MAX_EXCEPTION_VALUES = 50;
export const MAX_EXCEPTION_COMMENT = 1000;

/** One value per line or comma, trimmed, blanks and repeats dropped. */
export function splitValues(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

export const makeExceptionSchema = (t: Translate) =>
  z
    .object({
      field: z.string().trim().min(1, t("siem.detections.exceptions.fieldRequired")),
      operator: z.enum(EXCEPTION_OPERATORS),
      values: z.string(),
      lists: z.array(z.string()),
      comment: z
        .string()
        .trim()
        .min(1, t("siem.detections.exceptions.commentRequired"))
        .max(
          MAX_EXCEPTION_COMMENT,
          t("siem.detections.exceptions.commentTooLong", { max: MAX_EXCEPTION_COMMENT }),
        ),
      expiryDays: z.coerce.number(),
    })
    .superRefine((val, ctx) => {
      if (val.operator === "in_list") {
        if (!val.lists.length || val.lists.length > MAX_EXCEPTION_VALUES) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["lists"],
            message: t("siem.detections.exceptions.listsRange", { max: MAX_EXCEPTION_VALUES }),
          });
        }
        return;
      }
      const values = splitValues(val.values);
      if (!values.length || values.length > MAX_EXCEPTION_VALUES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["values"],
          message: t("siem.detections.exceptions.valuesRange", { max: MAX_EXCEPTION_VALUES }),
        });
      }
    });

export type ExceptionFormValues = {
  field: string;
  operator: (typeof EXCEPTION_OPERATORS)[number];
  values: string;
  /** Allowlist ids, used only by `in_list`. */
  lists: string[];
  comment: string;
  expiryDays: number;
};

export const exceptionDefaults = (field = "", value = ""): ExceptionFormValues => ({
  field,
  operator: "equals",
  values: value,
  lists: [],
  comment: "",
  expiryDays: 30,
});

/** The request body, with explicit keys; `nowMs` anchors the expiry. */
export function exceptionPayload(
  value: ExceptionFormValues,
  nowMs = Date.now(),
): NewDetectionException {
  const days = Number(value.expiryDays) || 0;
  return {
    field: value.field.trim(),
    operator: value.operator,
    values: value.operator === "in_list" ? [...new Set(value.lists)] : splitValues(value.values),
    comment: value.comment.trim(),
    expires_at: days > 0 ? (nowMs + days * 86_400_000) * 1000 : null,
  };
}
