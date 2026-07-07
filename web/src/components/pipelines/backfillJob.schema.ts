// Copyright 2026 OpenObserve Inc.
//
// SHARED validation schema for the backfill-job form, imported by BOTH
// CreateBackfillJobDialog.vue and EditBackfillJobDialog.vue (the two are
// duplicates — one source of truth).
//
// Field ownership (R1-strict): every editable control is form-owned —
//   • timerange — the absolute start/end range, bridged through the
//     OFormDateTimeRange wrapper as a single `{ type, from, to, period }` field
//     and cross-field validated below (start>0/end>0/start<end).
//   • chunkPeriodMinutes — optional numeric range 1..1440.
//   • delayBetweenChunks — optional numeric range 1..3600.
//   • deleteBeforeBackfill — optional checkbox.
//
// Numeric semantics mirror the Quasar BEFORE baseline `!v || (v>=min && v<=max)`:
// a falsy value (empty input / null / undefined / 0 / NaN) means "use the
// default" and PASSES; any other value must fall in [min, max]. (A number <input>
// emits a string, so the preprocess coerces.)

import { z } from "zod";

const optionalNumericRange = (min: number, max: number, message: string) =>
  z.preprocess(
    (v) => {
      if (v === "" || v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isNaN(n) || n === 0 ? null : n;
    },
    z.union([z.null(), z.number().int().min(min, message).max(max, message)]),
  );

export const backfillSchema = z
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
      "Must be between 1 and 1440",
    ),
    delayBetweenChunks: optionalNumericRange(1, 3600, "Must be between 1 and 3600"),
    deleteBeforeBackfill: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    // Cross-field time-range guard (replaces the old imperative toast/error
    // checks in each dialog's @submit handler). Surfaced via path ["timerange"].
    if (
      !val.timerange?.from ||
      val.timerange.from <= 0 ||
      !val.timerange?.to ||
      val.timerange.to <= 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timerange"],
        message: "Please select a valid time range",
      });
    } else if (val.timerange.from >= val.timerange.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timerange"],
        message: "Start time must be before end time",
      });
    }
  });

export type BackfillForm = z.infer<typeof backfillSchema>;
