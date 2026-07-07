// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AssociateFunction.vue (the function-node drawer,
// select-existing branch).
//
// Field ownership (R1-strict): `selectedFunction` (required) and
// `afterFlattening` (optional switch) are form-owned. The `createNewFunction`
// mode-toggle stays a bare UI control OUTSIDE the form (its true branch
// delegates to the AddFunction child).
//
// The schema is built via a factory taking GETTERS for the cross-field context
// (`associatedFunctions` prop + `isUpdating`) so `superRefine` reads their CURRENT
// values at validation time (the schema instance is created once at mount):
//   • required → `min(1, 'Field is required!')` (restored BEFORE-baseline rule).
//   • uniqueness → `superRefine`: a not-yet-associated function unless editing
//     ('Function is already associated'), preserving the old `functionExists`
//     behavior.

import { z } from "zod";

export const makeAssociateFunctionSchema = (
  getAssociated: () => string[],
  getIsUpdating: () => boolean,
) =>
  z
    .object({
      selectedFunction: z.string().min(1, "Field is required!"),
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
          message: "Function is already associated",
        });
      }
    });

export type AssociateFunctionForm = z.infer<
  ReturnType<typeof makeAssociateFunctionSchema>
>;
