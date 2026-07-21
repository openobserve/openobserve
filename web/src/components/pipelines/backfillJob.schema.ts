// Copyright 2026 OpenObserve Inc.
//
// SHARED validation schema for the backfill-job form, imported by BOTH
// CreateBackfillJobDialog.vue and EditBackfillJobDialog.vue.
//
// Field ownership: every editable control is form-owned —
//   • timerange — the absolute start/end range, bridged through the
//     OFormDateTimeRange wrapper as a single `{ type, from, to, period }` field
//     and cross-field validated below (start>0/end>0/start<end).
//   • chunkPeriodMinutes — optional numeric range 1..1440.
//   • delayBetweenChunks — optional numeric range 1..3600.
//   • deleteBeforeBackfill — optional checkbox.
//
// Numeric semantics: only null/undefined are treated as "absent" (field left
// blank → use the server default) and PASS. Everything else is range-checked — in
// particular an empty string and 0 coerce to 0 and FAIL, so submit is blocked with
// the range message. A non-numeric string (NaN, unreachable via a number <input>)
// passes. (A number <input> emits a string, so the preprocess coerces.)

import { z } from "zod";

const optionalNumericRange = (min: number, max: number, message: string) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    },
    z.union([z.null(), z.number().int().min(min, message).max(max, message)]),
  );

export const makeBackfillSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z
    .object({
      timerange: z
        .object({
          type: z.string().optional(),
          from: z.number().optional(), // microseconds
          to: z.number().optional(),
          period: z.string().optional(),
        })
        .optional(),
      chunkPeriodMinutes: optionalNumericRange(
        1,
        1440,
        t("pipeline.backfillNumericRange", { min: 1, max: 1440 }),
      ),
      delayBetweenChunks: optionalNumericRange(
        1,
        3600,
        t("pipeline.backfillNumericRange", { min: 1, max: 3600 }),
      ),
      deleteBeforeBackfill: z.boolean().optional(),
    })
    .superRefine((val, ctx) => {
      // Cross-field time-range guard. Surfaced via path ["timerange"].
      if (
        !val.timerange?.from ||
        val.timerange.from <= 0 ||
        !val.timerange?.to ||
        val.timerange.to <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timerange"],
          message: t("pipeline.selectValidTimeRange"),
        });
      } else if (val.timerange.from >= val.timerange.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timerange"],
          message: t("pipeline.startBeforeEndTime"),
        });
      }
    });

export type BackfillForm = z.infer<ReturnType<typeof makeBackfillSchema>>;
