// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddEnrichmentTable.vue (Add/Update Enrichment Table).
//
// Migration notes (per the form-migration-playbook):
//   • name   — required (trim) → form-owned OFormInput.
//   • source — "file" | "url" discriminator → form-owned OFormOptionGroup.
//   • file   — required ONLY when source === "file" (the CSV upload) → enforced
//              in `superRefine`. Backed by an OFormFile (a single field collapses
//              the old new-mode + update-mode <q-file> blocks).
//   • url    — required + http(s):// prefix ONLY when source === "url" AND it is
//              not a reload-only update (in reload mode the URL field is hidden,
//              so no URL is needed). The conditional mirrors the old onSubmit
//              guard `source === 'url' && (!isUpdating || updateMode !== 'reload')`.
//   • append / updateMode — form-owned (OFormSwitch / OFormOptionGroup), no
//              strict rule.
//
// `isUpdating` is a prop (not a form field), so the schema takes a getter and
// reads it lazily inside `superRefine` (it runs at validation time).
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid. The truthy→Zod inversions restore the
// Quasar BEFORE rules (name required, CSV file required, URL required +
// http(s):// prefix) verbatim.

import { z } from "zod";

export const makeAddEnrichmentTableSchema = (
  t: (_key: string) => string,
  isUpdating: () => boolean,
) =>
  z
    .object({
      // Restores the Quasar `!!v || 'Field is required!'` rule (+ trim).
      name: z.string().trim().min(1, t("function.nameRequired")),
      source: z.enum(["file", "url"]).default("file"),
      // A File object (or "" when empty). Required-ness is conditional → checked
      // in superRefine, so the base type stays permissive.
      file: z.any().optional(),
      append: z.boolean().optional().default(false),
      updateMode: z.string().optional().default("reload"),
      url: z.string().optional().default(""),
    })
    .superRefine((val, ctx) => {
      // CSV file required when uploading from file. Restores the two
      // `!!v || 'CSV File is required!'` <q-file> rules.
      if (val.source === "file" && !val.file) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["file"],
          message: t("function.csvFileRequired"),
        });
      }

      // URL required + http(s):// prefix when sourcing from a URL — but NOT for a
      // reload-only update (that mode reprocesses the existing URLs, so the URL
      // input is hidden). Mirrors the old onSubmit guard.
      if (val.source === "url" && (!isUpdating() || val.updateMode !== "reload")) {
        const url = String(val.url ?? "");
        if (!url) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["url"],
            message: t("function.urlRequired"),
          });
        } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["url"],
            message: t("function.urlMustStartWithHttp"),
          });
        }
      }
    });

export type AddEnrichmentTableForm = z.infer<
  ReturnType<typeof makeAddEnrichmentTableSchema>
>;
