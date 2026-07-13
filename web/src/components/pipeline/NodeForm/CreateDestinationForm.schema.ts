// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CreateDestinationForm.vue (the most complex form in the
// codebase: a multi-step OStepper with a custom card-grid type picker and many
// conditionally-shown fields). Built via a factory so messages stay i18n-driven
// (pass useI18n's `t`).
//
// Migration status (per the form-migration-playbook): every editable value the
// form collects is now form-owned and validated by this schema —
//   • `name`, `url`: genuinely user-typed → form-owned OForm fields whose rules
//     live here as plain object-level Zod rules.
//   • `skip_tls_verify`: form-owned OFormSwitch (boolean).
//   • `metadata.*` (Splunk source/sourcetype/hostname, Datadog
//     service/hostname/ddsource/ddtags): all nested under a single `metadata`
//     object so every metadata input is form-owned. The Datadog `ddsource` /
//     `ddtags` requireds are enforced in `superRefine`, keyed off the bridged
//     `destination_type` discriminator.
//   • `headers`: a dynamic array-field (`headers[i].key` / `headers[i].value`),
//     each row form-owned (see the §2 array-field pattern in the playbook).
//   • The auto-prefilled / conditionally-editable fields (url_endpoint/method/
//     output_format/esbulk_index/separator/org/stream) are also form-owned OForm
//     fields; the component keeps them in sync when destination_type changes via
//     direct `form.setFieldValue(...)` calls — there is NO `formData` mirror.
//     Their conditional rules live here in `superRefine`.
//   • `destination_type` is NOT an <input> — it is a custom card grid. The card
//     @click writes it with a DIRECT `form.setFieldValue("destination_type", …)`
//     and the template reads it back via `form.useStore`, so `superRefine` can
//     branch on it (no watch, no mirror — the Rule-③ headless owner pattern).
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";

// One row in the dynamic Headers array-field. Both fields are free-form text
// (a blank starter row is valid — only non-empty rows are persisted on save).
export const headerRowSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const makeDestinationSchema = (t: (_key: string) => string) =>
  z
    .object({
      // ── Form-owned, genuinely user-typed fields ──────────────────────────
      name: z
        .string()
        .min(1, t("common.nameRequired"))
        .refine((val) => isValidResourceName(String(val)), {
          message: t("pipeline.destResourceNameInvalid"),
        }),
      url: z
        .string()
        .refine((val) => String(val ?? "").trim().length > 0, {
          message: t("pipeline.fieldRequired"),
        })
        .refine((val) => !String(val ?? "").trim().endsWith("/"), {
          message: t("pipeline.urlTrailingSlash"),
        }),

      // ── Form-owned toggle ────────────────────────────────────────────────
      skip_tls_verify: z.boolean().optional().default(false),

      // ── Form-owned dynamic Headers rows ──────────────────────────────────
      headers: z.array(headerRowSchema).default([]),

      // ── Form-owned metadata (all Splunk + Datadog metadata inputs nest
      //    here). Optional at the object level; the Datadog conditional
      //    requireds are enforced in `superRefine` below. ───────────────────
      metadata: z
        .object({
          source: z.string().optional(),
          sourcetype: z.string().optional(),
          hostname: z.string().optional(),
          service: z.string().optional(),
          ddsource: z.string().optional(),
          ddtags: z.string().optional(),
        })
        .optional(),

      // ── Discriminator (written from the card grid via form.setFieldValue) +
      //    the auto-prefilled entangled fields. Kept loose at the object level;
      //    the real conditional requirements are enforced in `superRefine` below
      //    so they only apply for the relevant destination_type / output_format. ─
      destination_type: z.string().default("openobserve"),
      url_endpoint: z.string().optional().default(""),
      method: z.string().optional().default("post"),
      output_format: z.string().optional().default("json"),
      esbulk_index: z.string().optional().default(""),
      separator: z.string().optional().default(""),
      org: z.string().optional().default("default"),
      stream: z.string().optional().default("default"),
    })
    .superRefine((val, ctx) => {
      const dt = val.destination_type;
      const trimmed = (s: unknown) => String(s ?? "").trim();

      // OpenObserve: org + stream required.
      if (dt === "openobserve") {
        if (!trimmed(val.org)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["org"],
            message: t("pipeline.orgRequiredOpenobserve"),
          });
        }
        if (!trimmed(val.stream)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["stream"],
            message: t("pipeline.streamRequiredOpenobserve"),
          });
        }
      }

      // url_endpoint: required for every non-custom type; when present it must
      // start with "/" (applies to all types).
      if (dt !== "custom" && !trimmed(val.url_endpoint)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url_endpoint"],
          message: t("pipeline.fieldRequired"),
        });
      }
      if (trimmed(val.url_endpoint) && !trimmed(val.url_endpoint).startsWith("/")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url_endpoint"],
          message: t("pipeline.endpointMustStartSlash"),
        });
      }

      // method + output_format are always required (the select is only editable
      // for custom, but a value must always be present).
      if (!val.method) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["method"],
          message: t("pipeline.fieldRequired"),
        });
      }
      if (!val.output_format) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["output_format"],
          message: t("pipeline.fieldRequired"),
        });
      }

      // esbulk_index required when the ESBulk output format is chosen.
      if (val.output_format === "esbulk" && !trimmed(val.esbulk_index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["esbulk_index"],
          message: t("pipeline.indexRequiredEsbulk"),
        });
      }

      // separator required when the StringSeparated output format is chosen.
      // Note: a single space IS a valid separator, so check for "" specifically
      // (do NOT trim) — mirrors the old separator :validators rule.
      if (
        val.output_format === "stringseparated" &&
        (val.separator === null ||
          val.separator === undefined ||
          val.separator === "")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["separator"],
          message: t("pipeline.separatorRequiredStringseparated"),
        });
      }

      // Datadog: metadata.ddsource + metadata.ddtags required (nested).
      if (dt === "datadog") {
        if (!trimmed(val.metadata?.ddsource)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["metadata", "ddsource"],
            message: t("pipeline.ddSourceRequiredDatadog"),
          });
        }
        if (!trimmed(val.metadata?.ddtags)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["metadata", "ddtags"],
            message: t("pipeline.ddTagsRequiredDatadog"),
          });
        }
      }
    });

export type DestinationForm = z.infer<ReturnType<typeof makeDestinationSchema>>;
