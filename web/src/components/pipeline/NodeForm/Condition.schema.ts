// Copyright 2026 OpenObserve Inc.
//
// Validation schema for Condition.vue (the pipeline condition-node drawer).
//
// The drawer's only editable content is the composite FilterGroup child — it has
// no OForm* equivalent, so its model (`conditionGroup`) is bridged into the form
// as the `conditions` field (watch → setFieldValue) and validated here via
// `superRefine`. Built via a factory taking `t` (vue-i18n) so every message stays
// i18n-driven:
//   • at-least-one-condition — a non-empty condition (column + operator + value)
//     OR a nested group (t('pipeline.atLeastOneCondition')).
//   • complete-fields — once a condition is started, every leaf condition must be
//     fully filled (column, operator AND value). FilterCondition's inline
//     "Field is required!" hint is display-only and does NOT gate submit, so the
//     value/column/operator requirement is enforced here at the form layer.

import { z } from "zod";

const isFilled = (v: any): boolean => v !== undefined && v !== null && String(v).trim() !== "";

// A V2 group node — its children live in `conditions` (or legacy V1 `items`).
const isGroupNode = (item: any): boolean =>
  !!item &&
  ((item.filterType === "group" && (item.conditions || item.items)) ||
    (item.items && item.groupId));

// Flatten the group tree into its leaf conditions (filterType === "condition").
const collectLeafConditions = (group: any): any[] => {
  const arr = group?.conditions || group?.items || [];
  const leaves: any[] = [];
  for (const item of arr) {
    if (isGroupNode(item)) {
      leaves.push(...collectLeafConditions(item));
    } else if (item) {
      leaves.push(item);
    }
  }
  return leaves;
};

// A leaf is "blank" when the user hasn't started it (no column, no value). The
// operator carries a default ("="), so it's ignored for the blank check.
const isBlankCondition = (c: any): boolean => !isFilled(c?.column) && !isFilled(c?.value);

// A leaf is usable only when all three fields are present.
const isCompleteCondition = (c: any): boolean =>
  isFilled(c?.column) && isFilled(c?.operator) && isFilled(c?.value);

export const makeConditionSchema = (t: (_key: string) => string) =>
  z
    .object({
      conditions: z.any(),
    })
    .superRefine((val, ctx) => {
      const leaves = collectLeafConditions(val.conditions);

      // Nothing added yet — no leaves at all, or every leaf is untouched.
      if (leaves.length === 0 || leaves.every(isBlankCondition)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conditions"],
          message: t("pipeline.atLeastOneCondition"),
        });
        return;
      }

      // At least one condition is started — every leaf must be fully filled so a
      // condition with a column/operator but an empty value can't slip through.
      if (!leaves.every(isCompleteCondition)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conditions"],
          message: t("pipeline.fillAllConditionFields"),
        });
      }
    });

export type ConditionForm = z.infer<ReturnType<typeof makeConditionSchema>>;
