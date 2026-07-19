// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ScorerFormPage.vue (online-evals scorer create/edit
// page, llm_judge + remote variants).
//
// Validation timing is owned by OForm (submit-then-change); this file only
// describes WHAT is valid. The @submit payload carries RAW values, so the
// component trims/coerces at save.

import { z } from "zod";

// Required free-text field: non-blank after trimming, without transforming the
// stored value (keeps typing intact; the component trims at save).
const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

// One repeatable "extra metadata field" row. All cells optional at the row level
// (a blank starter row is valid — only non-empty rows persist); name uniqueness
// is enforced across rows in `superRefine`.
export const extraMetadataFieldSchema = z.object({
  name: z.string().default(""),
  type: z.enum(["string", "number", "boolean"]).default("string"),
  // Optional (no default) so the row type matches the service's
  // `ExtraMetadataField` (description?: string) exactly.
  description: z.string().optional(),
});

// One repeatable custom-header row (remote scorers).
export const customHeaderRowSchema = z.object({
  key: z.string().default(""),
  value: z.string().default(""),
});

export const makeScorerFormSchema = (t: (_key: string) => string) =>
  z
    .object({
      // ── Identity ────────────────────────────────────────────────────────
      name: requiredText(t("onlineEvals.scorer.validation.nameRequired")),
      // Discriminator — seeded once, drives the conditional requireds below.
      scorerType: z.enum(["llm_judge", "remote"]).default("llm_judge"),
      description: z.string().optional().default(""),
      // Optional — a scorer with no score config is a valid server-side entity
      // (`produces_score_config_id: Option<String>` with #[serde(default)]). The
      // @submit handler maps an empty selection to `null`. Do NOT make this
      // `requiredText`: that would make scorers without a score config uncreatable
      // and block editing legacy scorers that already have none (the field is
      // locked in edit).
      producesScoreConfigId: z.string().optional().default(""),
      // Internal version-pinning state — not a rendered control; optional.
      producesScoreConfigVersion: z.string().optional().default(""),
      pinScoreConfigVersion: z.boolean().optional().default(false),

      // ── LLM judge ───────────────────────────────────────────────────────
      providerId: z.string().optional().default(""),
      model: z.string().optional().default(""),
      // Intentionally NOT required: legacy scorers may exist with an empty
      // template, and requiring it here would block re-saving those on edit
      // (create seeds a default template; edit preserves whatever was stored).
      template: z.string().optional().default(""),
      includeReasoning: z.boolean().optional().default(true),
      extraMetadataFields: z.array(extraMetadataFieldSchema).default([]),

      // ── Remote endpoint ─────────────────────────────────────────────────
      remoteEndpoint: z.string().optional().default(""),
      httpMethod: z.string().optional().default("POST"),
      // number <input>s emit strings → coerce (Number("") === 0 passes min(0)).
      timeoutMs: z.coerce
        .number(t("onlineEvals.scorer.validation.timeoutInvalid"))
        .min(0, t("onlineEvals.scorer.validation.timeoutInvalid")),
      maxRetries: z.coerce
        .number(t("onlineEvals.scorer.validation.retriesInvalid"))
        .min(0, t("onlineEvals.scorer.validation.retriesInvalid")),
      backoffStrategy: z
        .enum(["exponential", "linear", "fixed"])
        .default("exponential"),

      // ── Remote auth ─────────────────────────────────────────────────────
      authType: z.enum(["", "bearer", "basic", "api_key"]).default(""),
      authBearerToken: z.string().optional().default(""),
      authBasicUsername: z.string().optional().default(""),
      authBasicPassword: z.string().optional().default(""),
      authApiKeyToken: z.string().optional().default(""),
      authApiKeyHeaderName: z.string().optional().default(""),
      customHeaders: z.array(customHeaderRowSchema).default([]),
    })
    .superRefine((val, ctx) => {
      const blank = (s: unknown) => String(s ?? "").trim().length === 0;

      if (val.scorerType === "llm_judge") {
        if (blank(val.providerId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["providerId"],
            message: t("onlineEvals.scorer.validation.providerRequired"),
          });
        }
      } else if (val.scorerType === "remote") {
        if (blank(val.remoteEndpoint)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["remoteEndpoint"],
            message: t("onlineEvals.scorer.validation.endpointRequired"),
          });
        }
        if (val.authType === "bearer" && blank(val.authBearerToken)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["authBearerToken"],
            message: t("onlineEvals.scorer.validation.bearerTokenRequired"),
          });
        }
        if (val.authType === "basic") {
          if (blank(val.authBasicUsername)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["authBasicUsername"],
              message: t("onlineEvals.scorer.validation.basicUsernameRequired"),
            });
          }
          if (blank(val.authBasicPassword)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["authBasicPassword"],
              message: t("onlineEvals.scorer.validation.basicPasswordRequired"),
            });
          }
        }
        if (val.authType === "api_key") {
          if (blank(val.authApiKeyHeaderName)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["authApiKeyHeaderName"],
              message: t("onlineEvals.scorer.validation.apiKeyHeaderRequired"),
            });
          }
          if (blank(val.authApiKeyToken)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["authApiKeyToken"],
              message: t("onlineEvals.scorer.validation.apiKeyTokenRequired"),
            });
          }
        }
      }

      // Extra-metadata field names must be unique. Flag every duplicate row.
      const counts = new Map<string, number>();
      val.extraMetadataFields.forEach((field) => {
        const key = field.name.trim();
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      val.extraMetadataFields.forEach((field, idx) => {
        const key = field.name.trim();
        if (key && (counts.get(key) ?? 0) > 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["extraMetadataFields", idx, "name"],
            message: t("onlineEvals.scorer.validation.duplicateFieldName"),
          });
        }
      });
    });

export type ScorerForm = z.infer<ReturnType<typeof makeScorerFormSchema>>;
