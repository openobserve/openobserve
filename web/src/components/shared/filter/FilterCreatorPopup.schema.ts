// Copyright 2026 OpenObserve Inc.
//
// Validation schema for FilterCreatorPopup.vue — the shared field-filter popup.
//
// Restored from the Quasar BEFORE baseline:
//   selectedOperator — `!!v || 'Field is required!'`
//                    → z.string().min(1, "Field is required!").
//
// `selectedValues` is the checkbox-list value collected into the emit payload.
// It has no validation rule, but under R1-strict it is still a form-owned field
// (an OFormCheckboxGroup) → kept in the schema as an array with a `[]` default
// (effectively optional on input).

import { z } from "zod";

export const filterCreatorPopupSchema = z.object({
  selectedOperator: z.string().min(1, "Field is required!"),
  selectedValues: z.array(z.any()).default([]),
});

export type FilterCreatorPopupForm = z.infer<typeof filterCreatorPopupSchema>;
