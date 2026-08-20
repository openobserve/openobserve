// Copyright 2026 OpenObserve Inc.

// Validation schema for the "compare against a baseline" picker
// (ExperimentComparePickerDialog.vue). Same useOForm + co-located Zod pattern as
// AddToDatasetForm / ExperimentForm.

import { z } from "zod";

/** A `type` alias (not an interface) so it satisfies useForm's
 *  `Record<string, unknown>` constraint. */
export type ExperimentCompareForm = {
  baselineId: string;
};

export const experimentCompareDefaults = (): ExperimentCompareForm => ({
  baselineId: "",
});

export const makeExperimentCompareSchema = (t: (_key: string) => string) =>
  z.object({
    baselineId: z
      .string()
      .min(1, t("aiObservability.experiments.detail.comparePicker.errors.baseline")),
  });
