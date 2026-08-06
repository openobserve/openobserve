// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ProviderFormPage.vue (online-evals LLM provider
// create/edit page).
//
// Built via a factory so messages can stay i18n-driven (pass useI18n's `t`).
// Validation TIMING is owned by OForm; this file only describes WHAT is valid.
//
// apiKey is intentionally NOT validated client-side. Whether a key is required
// depends on the provider type: self-hosted providers (Ollama, vLLM) run without
// one, while cloud providers need it. That per-type rule is owned by the
// enterprise backend (e.g. it rejects an empty key for `openai` with "No API key
// found in auth_config"), so we keep the client permissive rather than duplicate
// — and risk drifting from — that list.
//
// The @submit payload carries the RAW field values (strings) — the schema
// validates them but does not transform them; the component trims/splits at
// save time.

import { z } from "zod";

// Required free-text field: non-blank after trimming. Uses `.refine` rather than
// `.trim().min(1)` so the schema never transforms the stored value (keeps typing
// trailing spaces intact; the component trims at save).
const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeProviderFormSchema = (t: (_key: string) => string) =>
  z.object({
    name: requiredText(t("onlineEvals.provider.nameRequired")),
    providerType: requiredText(t("onlineEvals.provider.typeRequired")),
    endpoint: z.string().optional().default(""),
    defaultModel: requiredText(t("onlineEvals.provider.defaultModelRequired")),
    availableModels: z.string().optional().default(""),
    // apiKey is write-only and not enforced client-side in EITHER mode: on edit
    // a blank value keeps the stored secret; on create the backend applies the
    // per-provider-type requirement (see the header note).
    apiKey: z.string().optional().default(""),
  });

export type ProviderForm = z.infer<ReturnType<typeof makeProviderFormSchema>>;
