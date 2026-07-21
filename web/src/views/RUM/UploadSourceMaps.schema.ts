// Copyright 2026 OpenObserve Inc.
//
// Validation schema for UploadSourceMaps.vue (RUM source-map upload page).
// Built via a factory so messages stay i18n-driven (pass useI18n's `t`).
//
// Field rules:
//   service — required (non-empty).
//   version — required (non-empty).
//   file    — required, and must be a `.zip`. Errors surface inline.
//
// `environment` is unvalidated but is part of the submitted payload, so it is
// an optional form field.

import { z } from "zod";

export const makeUploadSourceMapsSchema = (t: (_key: string) => string) =>
  z.object({
    service: z
      .string()
      .trim()
      .min(1, t("rum.uploadSourceMapsForm.serviceRequired")),
    version: z
      .string()
      .trim()
      .min(1, t("rum.uploadSourceMapsForm.versionRequired")),
    environment: z.string().optional().default(""),
    file: z
      .instanceof(File)
      .nullable()
      // Required: a missing file (null) fails here with the "select a file" msg.
      .refine((f) => f instanceof File, {
        message: t("rum.uploadSourceMapsForm.fileRequired"),
      })
      // Type: only .zip is allowed (skipped when null — the required refine
      // above already reports that case).
      .refine((f) => f == null || f.name.toLowerCase().endsWith(".zip"), {
        message: t("rum.uploadSourceMapsForm.fileTypeZip"),
      }),
  });

export type UploadSourceMapsForm = z.infer<
  ReturnType<typeof makeUploadSourceMapsSchema>
>;
