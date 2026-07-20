// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CreateDestinationForm.vue, a multi-step OStepper with a
// custom card-grid type picker and many conditionally-shown fields. Built via a
// factory so messages stay i18n-driven (pass useI18n's `t`).
//
// `destination_type` is not an <input> — it is a custom card grid whose @click
// writes it via form.setFieldValue; superRefine branches on it to enforce the
// conditional requirements of the entangled prefilled fields.
//
// Validation TIMING is owned by OForm; this file only describes WHAT is valid.

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
      // ── User-typed fields ────────────────────────────────────────────────
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

      skip_tls_verify: z.boolean().optional().default(false),

      // ── Dynamic Headers rows ─────────────────────────────────────────────
      headers: z.array(headerRowSchema).default([]),

      // ── Splunk + Datadog metadata inputs. Optional at the object level; the
      //    Datadog conditional requireds are enforced in `superRefine` below. ─
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

      // ── Discriminator + the auto-prefilled entangled fields. Kept loose at
      //    the object level; the conditional requirements are enforced in
      //    `superRefine` below, per destination_type / output_format. ─────────
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
      // (do NOT trim).
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
