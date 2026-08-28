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
// `taskType` is the discriminator: an inline prompt needs a provider and a
// prompt, a remote task needs a pinned `name@version` and neither. The rules
// live in one superRefine rather than in the field types, because a required
// field that is only required half the time cannot be expressed as `.min(1)`.

import { z } from "zod";

/** Dataset item origins — the fixed set `datasetFilter.sources` accepts. */
export const EXPERIMENT_ROW_SOURCES = ["trace", "annotation", "manual"] as const;

/** The two task kinds the create form offers. `sdk` is reported to the API by
 *  customer code, never authored here. */
export const EXPERIMENT_TASK_TYPES = ["inline_prompt", "remote"] as const;
export type ExperimentTaskType = (typeof EXPERIMENT_TASK_TYPES)[number];

const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeExperimentSchema = (t: (_key: string) => string) =>
  z
    .object({
      name: requiredText(t("aiObservability.experiments.form.validation.nameRequired")),
      description: z.string().optional().default(""),
      datasetId: requiredText(t("aiObservability.experiments.form.validation.datasetRequired")),
      // Empty = every row. Narrows `datasetFilter.sources` at submit.
      sources: z.array(z.enum(EXPERIMENT_ROW_SOURCES)).optional().default([]),
      taskType: z.enum(EXPERIMENT_TASK_TYPES).default("inline_prompt"),
      providerId: z.string().optional().default(""),
      model: z.string().optional().default(""),
      systemPrompt: z.string().optional().default(""),
      userPrompt: z.string().optional().default(""),
      /** Pinned `name@version` of a published Remote Task. Never a bare name. */
      taskRef: z.string().optional().default(""),
      taskTimeoutSeconds: z.string().optional().default(""),
      taskMaxConcurrency: z.string().optional().default(""),
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
    })
    .superRefine((values, ctx) => {
      if (values.taskType === "inline_prompt") {
        if (!values.providerId.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["providerId"],
            message: t("aiObservability.experiments.form.validation.providerRequired"),
          });
        }
        if (!values.userPrompt.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["userPrompt"],
            message: t("aiObservability.experiments.form.validation.userPromptRequired"),
          });
        }
        return;
      }

      // A remote task must name a PUBLISHED version. The server resolves the
      // ref against the registry and refuses a bare name, so a value without
      // an "@" could only ever fail there.
      if (!values.taskRef.includes("@")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["taskRef"],
          message: t("aiObservability.experiments.form.validation.taskRefRequired"),
        });
      }
    });

export type ExperimentForm = z.infer<ReturnType<typeof makeExperimentSchema>>;

/** Task config handed over from the Playground. Every field is optional, so a
 *  plain "New experiment" is unaffected — an absent key keeps today's default. */
export interface ExperimentFormPrefill {
  providerId?: string;
  model?: string;
  temperature?: string;
  systemPrompt?: string;
  userPrompt?: string;
}

export const experimentFormDefaults = (
  datasetId = "",
  prefill: ExperimentFormPrefill = {},
): ExperimentForm => ({
  name: "",
  description: "",
  datasetId,
  sources: [],
  taskType: "inline_prompt",
  providerId: prefill.providerId ?? "",
  model: prefill.model ?? "",
  systemPrompt: prefill.systemPrompt ?? "",
  // A Playground variant may legitimately carry an empty user prompt, so only
  // an ABSENT key falls back to the placeholder.
  userPrompt: prefill.userPrompt ?? "{{ input }}",
  temperature: Number(prefill.temperature) || 0,
  taskRef: "",
  taskTimeoutSeconds: "",
  taskMaxConcurrency: "",
  scorerIds: [],
  trialCount: 1,
});
