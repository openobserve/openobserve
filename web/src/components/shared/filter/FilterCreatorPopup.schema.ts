// Copyright 2026 OpenObserve Inc.
//
// Validation schema for FilterCreatorPopup.vue — the shared field-filter popup.
// Built via a factory so the required message stays i18n-driven (pass `t`).
//
// Restored from the BEFORE baseline:
//   selectedOperator — `!!v || 'Field is required!'`
//                    → z.string().min(1, t("validation.fieldRequired")).
//
// `selectedValues` is the checkbox-list value collected into the emit payload.
// It has no validation rule, but under R1-strict it is still a form-owned field
// (an OFormCheckboxGroup) → kept in the schema as an array with a `[]` default
// (effectively optional on input).

import { z } from "zod";

export const makeFilterCreatorPopupSchema = (t: (_key: string) => string) =>
  z.object({
    selectedOperator: z.string().min(1, t("validation.fieldRequired")),
    selectedValues: z.array(z.any()).default([]),
  });

export type FilterCreatorPopupForm = z.infer<
  ReturnType<typeof makeFilterCreatorPopupSchema>
>;
