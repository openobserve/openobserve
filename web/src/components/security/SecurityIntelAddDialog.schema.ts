// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityIntelAddDialog.vue (paste indicators into a list).
//   • list        — required; stored as an `ioc_` enrichment table.
//   • indicators  — at least one recognised indicator, and no unrecognised
//                   tokens (they are named, so the analyst can fix them).
//   • confidence  — 0–100; a number input emits a string, coerced at submit.

import { z } from "zod";
import {
  INDICATOR_TYPES,
  INTEL_SEVERITIES,
  intelTableName,
  parseIndicatorList,
} from "@/utils/security/intel";

type Translate = (key: string, named?: Record<string, unknown>) => string;

export const EXPIRY_DAYS = ["0", "7", "30", "90", "365"] as const;

export const makeIntelAddSchema = (t: Translate) =>
  z
    .object({
      list: z.string().trim().min(1, t("siem.intel.form.listRequired")),
      indicators: z.string().trim().min(1, t("siem.intel.form.indicatorsRequired")),
      type: z.enum(["auto", ...INDICATOR_TYPES]),
      severity: z.enum(INTEL_SEVERITIES),
      confidence: z
        .any()
        .refine(
          (v) => String(v).trim() !== "" && Number(v) >= 0 && Number(v) <= 100,
          t("siem.intel.form.confidenceRange"),
        ),
      source: z.string().optional().default(""),
      description: z.string().optional().default(""),
      expiry: z.enum(EXPIRY_DAYS),
    })
    .superRefine((val, ctx) => {
      if (!intelTableName(val.list)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["list"],
          message: t("siem.intel.form.listRequired"),
        });
      }
      if (!val.indicators.trim()) return;
      const parsed = parseIndicatorList(val.indicators, val.type === "auto" ? null : val.type);
      if (parsed.invalid.length) {
        const sample = parsed.invalid
          .slice(0, 3)
          .map((i) => `${i.value} (${t("siem.intel.form.line", { n: i.line })})`)
          .join(", ");
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["indicators"],
          message: t("siem.intel.form.invalid", { n: parsed.invalid.length, sample }),
        });
      } else if (!parsed.valid.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["indicators"],
          message: t("siem.intel.form.indicatorsRequired"),
        });
      }
    });

export type IntelAddForm = z.infer<ReturnType<typeof makeIntelAddSchema>>;

export const intelAddDefaults = (list: string): IntelAddForm => ({
  list,
  indicators: "",
  type: "auto",
  severity: "high",
  confidence: "75",
  source: "",
  description: "",
  expiry: "90",
});
