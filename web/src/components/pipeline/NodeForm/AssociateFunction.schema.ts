// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AssociateFunction.vue (the function-node drawer,
// select-existing branch).
//
// Field ownership: `selectedFunction` (required) and `afterFlattening` (optional
// switch) are form-owned. The `createNewFunction` mode-toggle stays a bare UI
// control OUTSIDE the form (its true branch delegates to the AddFunction child).
//
// The schema is built via a factory taking `t` (vue-i18n) plus GETTERS for the
// cross-field context (`associatedFunctions` prop + `isUpdating`) so `superRefine`
// reads their CURRENT values at validation time (the schema instance is created
// once at mount):
//   • required → `min(1, t('pipeline.fieldRequired'))`.
//   • uniqueness → `superRefine`: a function must not already be associated unless
//     editing (t('pipeline.functionAlreadyAssociated')).

import { z } from "zod";

export const makeAssociateFunctionSchema = (
  t: (_key: string) => string,
  getAssociated: () => string[],
  getIsUpdating: () => boolean,
) =>
  z
    .object({
      selectedFunction: z.string().min(1, t("pipeline.fieldRequired")),
      afterFlattening: z.boolean().optional(),
    })
    .superRefine((val, ctx) => {
      if (
        !getIsUpdating() &&
        val.selectedFunction &&
        getAssociated().includes(val.selectedFunction)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selectedFunction"],
          message: t("pipeline.functionAlreadyAssociated"),
        });
      }
    });

export type AssociateFunctionForm = z.infer<
  ReturnType<typeof makeAssociateFunctionSchema>
>;
