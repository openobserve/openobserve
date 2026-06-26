// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ProviderFormPage.vue (online-evals LLM provider
// create/edit page). This native-`<form>` page predates the Quasar era and
// shipped with `*` markers but NO client-side validation — the migration to
// OForm + Zod ADDS the missing validation (see online-evals-migration.md row 67).
//
// Built via a factory so the create-vs-edit conditional (apiKey required only on
// create) can branch on `mode`, and so messages can stay i18n-driven (pass
// useI18n's `t`). Validation TIMING is owned by OForm (submit-then-change via
// revalidateLogic); this file only describes WHAT is valid.
//
// Note: the @submit payload carries the RAW field values (strings) — the schema
// validates them but does not transform them, so the component trims/splits at
// save time exactly as the old `v-model.trim` did.

import { z } from "zod";

// Required free-text field: non-blank after trimming. Uses `.refine` rather than
// `.trim().min(1)` so the schema never transforms the stored value (keeps typing
// trailing spaces intact; the component trims at save).
const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeProviderFormSchema = (
  t: (_key: string) => string,
  mode: "create" | "edit",
) =>
  z
    .object({
      name: requiredText(t("onlineEvals.provider.nameRequired")),
      providerType: requiredText(t("onlineEvals.provider.typeRequired")),
      endpoint: z.string().optional().default(""),
      defaultModel: requiredText(t("onlineEvals.provider.defaultModelRequired")),
      availableModels: z.string().optional().default(""),
      // apiKey is write-only: on edit a blank value keeps the stored secret, so
      // it is only required on create (enforced in superRefine below).
      apiKey: z.string().optional().default(""),
    })
    .superRefine((val, ctx) => {
      if (mode === "create" && val.apiKey.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["apiKey"],
          message: t("onlineEvals.provider.apiKeyRequired"),
        });
      }
    });

export type ProviderForm = z.infer<ReturnType<typeof makeProviderFormSchema>>;
