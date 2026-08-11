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

// Validation schema for the Add To Dataset drawer (AddToDatasetDrawer.vue).
// Same useOForm + co-located Zod pattern as DatasetForm / DatasetItemForm.
// There is no `input` field: the server re-reads and purifies the input from
// the trace reference, so the human only supplies the golden answer — and a
// golden with no answer is not a golden, hence both fields are required.

import { z } from "zod";

/** The Add To Dataset form shape (the useOForm state). A `type` alias (not an
 *  interface) so it satisfies TanStack useForm's `Record<string, unknown>`
 *  constraint. */
export type AddToDatasetForm = {
  datasetId: string;
  expectedOutput: string;
  tags: string[];
};

export const addToDatasetDefaults = (): AddToDatasetForm => ({
  datasetId: "",
  expectedOutput: "",
  tags: [],
});

/** i18n-driven Zod schema. `t` keeps validation messages localized. */
export const makeAddToDatasetSchema = (t: (_key: string) => string) =>
  z.object({
    datasetId: z.string().min(1, t("aiObservability.traceActions.dataset.errors.dataset")),
    expectedOutput: z
      .string()
      .trim()
      .min(1, t("aiObservability.traceActions.dataset.errors.expectedOutput")),
    tags: z.array(z.string()),
  });
