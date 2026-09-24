// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityIntelImportDialog.vue. `mode` is a prop, not a field:
// a file import needs a file, a feed import needs an http(s) URL.

import { z } from "zod";
import { INTEL_SEVERITIES, intelTableName } from "@/utils/security/intel";

type Translate = (key: string) => string;

export const makeIntelImportSchema = (t: Translate, mode: () => "file" | "url") =>
  z
    .object({
      list: z.string().trim().min(1, t("siem.intel.form.listRequired")),
      file: z.any().optional(),
      url: z.string().optional().default(""),
      append: z.boolean().default(true),
      severity: z.enum(INTEL_SEVERITIES),
      source: z.string().optional().default(""),
    })
    .superRefine((val, ctx) => {
      if (!intelTableName(val.list)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["list"],
          message: t("siem.intel.form.listRequired"),
        });
      }
      if (mode() === "file" && !val.file) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["file"],
          message: t("siem.intel.form.fileRequired"),
        });
      }
      if (mode() === "url" && !/^https?:\/\/\S+$/i.test(String(val.url ?? "").trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: t("siem.intel.form.urlInvalid"),
        });
      }
    });

export type IntelImportForm = z.infer<ReturnType<typeof makeIntelImportSchema>>;

export const intelImportDefaults = (list: string): IntelImportForm => ({
  list,
  file: undefined,
  url: "",
  append: true,
  severity: "medium",
  source: "",
});
