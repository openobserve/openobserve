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

// Validation schema for ExperimentForm.vue (create an offline experiment).
//
// ExperimentForm OWNS the one <OForm> (owner pattern): it builds the form with
// `useOForm` and reads it back through `form.useStore`, so there is a single
// source of truth and no mirror ref. Every rendered control is an OForm* bound
// by `name=` into this schema.
//
// Inline prompt is the only task the backend will create: validate_task_config
// rejects `remote` and `sdk` outright, so there is no discriminator here and
// provider/prompt are plainly required.

import { z } from "zod";

/** Dataset item origins — the fixed set `datasetFilter.sources` accepts. */
export const EXPERIMENT_ROW_SOURCES = ["trace", "annotation", "manual"] as const;

const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeExperimentSchema = (t: (_key: string) => string) =>
  z.object({
    name: requiredText(t("aiObservability.experiments.form.validation.nameRequired")),
    description: z.string().optional().default(""),
    datasetId: requiredText(t("aiObservability.experiments.form.validation.datasetRequired")),
    // Empty = every row. Narrows `datasetFilter.sources` at submit.
    sources: z.array(z.enum(EXPERIMENT_ROW_SOURCES)).optional().default([]),
    providerId: requiredText(t("aiObservability.experiments.form.validation.providerRequired")),
    model: z.string().optional().default(""),
    systemPrompt: z.string().optional().default(""),
    userPrompt: requiredText(t("aiObservability.experiments.form.validation.userPromptRequired")),
    scorerIds: z
      .array(z.string())
      .min(1, t("aiObservability.experiments.form.validation.scorerRequired")),
    // The runner defaults params.temperature to 0.0, so leaving this out
    // silently makes every run deterministic — and Trials a no-op.
    temperature: z.coerce
      .number()
      .min(0, t("aiObservability.experiments.form.validation.temperatureRange"))
      .max(2, t("aiObservability.experiments.form.validation.temperatureRange"))
      .default(0),
    trialCount: z.coerce
      .number()
      .int()
      .min(1, t("aiObservability.experiments.form.validation.trialCountRange"))
      .max(100, t("aiObservability.experiments.form.validation.trialCountRange"))
      .default(1),
  });

export type ExperimentForm = z.infer<ReturnType<typeof makeExperimentSchema>>;

export const experimentFormDefaults = (datasetId = ""): ExperimentForm => ({
  name: "",
  description: "",
  datasetId,
  sources: [],
  providerId: "",
  model: "",
  systemPrompt: "",
  userPrompt: "{{ input }}",
  temperature: 0,
  scorerIds: [],
  trialCount: 1,
});
