// Copyright 2026 OpenObserve Inc.
//
// Validation schema for Condition.vue (the pipeline condition-node drawer).
//
// The drawer's only editable content is the composite FilterGroup child — it has
// no OForm* equivalent, so its model (`conditionGroup`) is BRIDGED into the form
// as the `conditions` field (watch → setFieldValue, the documented sanctioned
// bridge) and validated here via `superRefine`:
//   • at-least-one-condition — a non-empty condition (column + operator) OR a
//     nested group ('Please add at least one condition'). This replaces the old
//     imperative `saveCondition()` toast gate (pattern → schema).
//
// (The audit also listed a `stream_name` required rule, but the live drawer
// renders no stream input — there is nothing to validate — so it is omitted.)

import { z } from "zod";

const hasAtLeastOneCondition = (group: any): boolean => {
  const arr = group?.conditions || [];
  return arr.some(
    (item: any) =>
      (item.filterType === "group" && item.conditions) ||
      (item.column && item.operator),
  );
};

export const conditionSchema = z
  .object({
    conditions: z.any(),
  })
  .superRefine((val, ctx) => {
    if (!hasAtLeastOneCondition(val.conditions)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conditions"],
        message: "Please add at least one condition",
      });
    }
  });

export type ConditionForm = z.infer<typeof conditionSchema>;
