// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ModelPricingEditor.vue — scalars (name +
// match_pattern) and the dynamic tiers/prices array.
//
// The API model stores prices as a `{ key: perTokenPrice }` MAP; TanStack
// field-arrays operate on ARRAYS, so the form models prices as an array of
// `{ key, value }` rows (value held as PER-MILLION for display). The component
// converts map↔rows at edit-prefill and submit.
//
// Two structural rules with no single field to attach to — "default tier needs
// ≥1 non-zero price" and "a draft price has a value but no key" — stay as
// submit-handler guards (toasts), since they don't map to one OForm* field.
//
// Validation timing is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes what is valid.

import { z } from "zod";

const PURE_INT = /^\d+$/;
const HAS_SPACE = /\s/;

/**
 * Strip Rust/PCRE inline flag groups that JavaScript RegExp doesn't understand
 * (e.g. `(?i)`, `(?ims)`). Flag-scoped groups like `(?i:...)` are left intact.
 */
export function stripInlineFlags(pattern: string): string {
  return pattern.replace(/\(\?[imsxu]+\)/g, "");
}

// One committed price row. `value` is held as PER-MILLION in the form.
export const priceRowSchema = z.object({
  key: z.string(),
  value: z.coerce.number(),
});

export const tierConditionSchema = z.object({
  usage_key: z.string(),
  operator: z.string(),
  value: z.coerce.number(),
});

export const tierSchema = z.object({
  name: z.string(),
  // null for the default (first) tier; an object for conditional tiers.
  condition: tierConditionSchema.nullable().optional(),
  prices: z.array(priceRowSchema).default([]),
  // Staging "add price" row — non-validated form state, auto-committed at submit.
  draftKey: z.string().optional().default(""),
  draftValue: z.coerce.number().optional().default(0),
});

export const makeModelPricingSchema = (
  t: (_key: string, _named?: Record<string, unknown>) => string,
) =>
  z
    .object({
      name: z.string(),
      match_pattern: z.string(),
      tiers: z.array(tierSchema).default([]),
    })
    .superRefine((val, ctx) => {
      // ── name ──────────────────────────────────────────────────────────────
      const name = String(val.name ?? "");
      if (!name.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: t("modelPricing.nameRequired"),
        });
      } else if (name.length > 256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: t("modelPricing.nameTooLong"),
        });
      }

      // ── match_pattern ─────────────────────────────────────────────────────
      const pattern = String(val.match_pattern ?? "");
      if (!pattern.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["match_pattern"],
          message: t("modelPricing.patternRequired"),
        });
      } else if (pattern.length > 512) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["match_pattern"],
          message: t("modelPricing.patternTooLong"),
        });
      } else {
        try {
          new RegExp(stripInlineFlags(pattern));
        } catch (e: any) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["match_pattern"],
            message: t("modelPricing.invalidRegex", { error: e.message }),
          });
        }
      }

      // ── tiers / prices ────────────────────────────────────────────────────
      (val.tiers ?? []).forEach((tier, i) => {
        // committed price-row keys: not pure-int, no spaces
        (tier.prices ?? []).forEach((row, j) => {
          const k = String(row.key ?? "").trim();
          if (k && PURE_INT.test(k)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "prices", j, "key"],
              message: t("modelPricing.usageKeyPureInteger"),
            });
          } else if (k && HAS_SPACE.test(k)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "prices", j, "key"],
              message: t("modelPricing.usageKeyContainsSpaces"),
            });
          }
        });

        // non-default tier condition.usage_key: not a pure integer
        if (i > 0 && tier.condition) {
          const ck = String(tier.condition.usage_key ?? "").trim();
          if (ck && PURE_INT.test(ck)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "condition", "usage_key"],
              message: t("modelPricing.tierUsageKeyPlainNumber", {
                name: tier.name || `#${i + 1}`,
              }),
            });
          }
        }
      });
    });

export type ModelPricingForm = z.infer<ReturnType<typeof makeModelPricingSchema>>;
export type ModelPricingTier = z.infer<typeof tierSchema>;
export type ModelPricingPriceRow = z.infer<typeof priceRowSchema>;
