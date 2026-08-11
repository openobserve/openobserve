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

// Validation schema for the Add Item dialog (DatasetDetailPage.vue). Same
// useOForm + co-located Zod pattern as DatasetForm: every field is a name-bound
// OForm* input. A golden item requires both an input and an expected output
// (the answer is never empty).

import { z } from "zod";

/** The Add Item form shape (the useOForm state). A `type` alias (not an
 *  interface) so it satisfies TanStack useForm's `Record<string, unknown>`
 *  constraint. */
export type DatasetItemForm = {
  input: string;
  expectedOutput: string;
  tags: string[];
};

/** i18n-driven Zod schema. `t` keeps validation messages localized. */
export const makeDatasetItemFormSchema = (t: (_key: string) => string) =>
  z.object({
    input: z.string().trim().min(1, t("aiObservability.datasets.detail.addItem.errors.input")),
    expectedOutput: z
      .string()
      .trim()
      .min(1, t("aiObservability.datasets.detail.addItem.errors.expectedOutput")),
    tags: z.array(z.string()),
  });
