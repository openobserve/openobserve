// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

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
