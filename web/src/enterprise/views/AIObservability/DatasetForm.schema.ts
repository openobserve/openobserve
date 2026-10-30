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

// Validation schema for the New Dataset dialog (DatasetsPage.vue). Same
// useOForm + co-located Zod pattern as ScoreConfigDialog / QueuesPage: every
// field is a name-bound OForm* input, so no setFieldValue bridge is needed.

import { z } from "zod";

/** The New Dataset form shape (the useOForm state). A `type` alias (not an
 *  interface) so it satisfies TanStack useForm's `Record<string, unknown>`
 *  constraint. */
export type DatasetForm = {
  name: string;
  description: string;
  tags: string[];
};

/** A blank form. Always pass these to `form.reset(...)` when opening in CREATE
 *  mode: TanStack's `reset(values)` REPLACES the form's stored defaultValues, so
 *  after an edit an argument-less `reset()` would restore the edited row. */
export const datasetFormDefaults = (): DatasetForm => ({
  name: "",
  description: "",
  tags: [],
});

/** i18n-driven Zod schema. `t` keeps validation messages localized. */
export const makeDatasetFormSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("aiObservability.datasets.create.errors.name")),
    description: z.string(),
    tags: z.array(z.string()),
  });
