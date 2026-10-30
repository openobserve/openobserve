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

// Validation schema for the New Queue drawer (QueuesPage.vue). Mirrors the
// useOForm + co-located Zod pattern used by ScoreConfigDialog / ScorerFormPage:
// the component owns <OForm> and reads it reactively via `form.useStore`. The
// scalar fields (name/description) are plain name-bound OForm* inputs; the
// bespoke controls (score-config bindings and target dataset) bridge into the
// one form via `form.setFieldValue` and are validated here.

import { z } from "zod";
import type { ScoreConfigDataType } from "@/services/llm-queues.service";

/** A bound Score Config in the form (id + display fields + pinned version). */
export interface QueueBoundConfig {
  scoreConfigId: string;
  name: string;
  dataType: ScoreConfigDataType;
  version: number;
}

/** The New Queue form shape (the useOForm state). A `type` alias (not an
 *  interface) so it satisfies TanStack useForm's `Record<string, unknown>`
 *  constraint via the implicit index signature type aliases get. */
export type QueueForm = {
  name: string;
  description: string;
  scoreConfigs: QueueBoundConfig[];
  targetDatasetId: string;
};

/** i18n-driven Zod schema. `t` keeps validation messages localized. */
export const makeQueueFormSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("aiObservability.queues.create.errors.name")),
    description: z.string(),
    // A queue must score on at least one dimension.
    scoreConfigs: z
      .array(
        z.object({
          scoreConfigId: z.string(),
          name: z.string(),
          dataType: z.enum(["numeric", "categorical", "boolean"]),
          version: z.number(),
        }),
      )
      .min(1, t("aiObservability.queues.create.errors.scoreConfigs")),
    targetDatasetId: z.string(),
  });
