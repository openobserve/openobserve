// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ScoreConfigDialog.vue (online-evals score-config drawer).
// Client-side validation: (1) name — required + a create-only lowercase-slug
// pattern; (2) min/max — each must be a non-empty number, but ONLY when the data
// type is numeric (the inputs are hidden and the values are dropped from the
// payload for categorical/boolean, so a blank must not block Save there — the
// check is gated on dataType in superRefine). There is NO min<max ordering rule
// and NO "≥1 category" rule.
//
// The component owns <OForm>: it creates the form with `useOForm` and reads it
// reactively through `form.useStore` (single source of truth, no mirror ref, no
// `v-model`). That read view (`formValues`) drives the `dataType`/
// `healthyDirection`/`categories` `v-if` branches. The real text/number inputs
// (name/description/min/max/healthy values) are plain form-owned `name=` fields.
// The bespoke choice grids (dataType radio-cards, healthy-threshold
// radios/checkboxes — several embed inline number inputs, so they have no OForm*
// representation) plus the categories tag-entry write directly into the form via
// `form.setFieldValue` from each control's own `@change`/`@click` handler.

import { z } from "zod";
import type { ScoreDataType } from "@/services/online-evals.service";

// Stable-identifier rule (lowercase letters, digits, underscores). Only enforced
// on create — in edit the name is immutable (the input is disabled).
const NAME_PATTERN = /^[a-z0-9_]+$/;

// True when a number <input>'s raw store value is not a usable number — "" (the
// cleared state), null / undefined, or non-numeric. Used to require min/max, but
// ONLY for the numeric data type (see superRefine). `z.coerce.number()` can't do
// this: it would silently turn "" into 0.
const isBlankNumber = (v: unknown) =>
  v === "" || v === null || v === undefined || Number.isNaN(Number(v));

export const makeScoreConfigSchema = (
  t: (_key: string) => string,
  mode: "create" | "edit" = "create",
) =>
  z
    .object({
      name: z
        .string()
        .refine((val) => val.trim().length > 0, {
          message: t("onlineEvals.scoreConfig.validation.nameRequired"),
        })
        // Empty is owned by the required check above → skip here so only ONE
        // message shows. Edit skips the pattern entirely (immutable name).
        .refine(
          (val) => mode === "edit" || val.trim().length === 0 || NAME_PATTERN.test(val.trim()),
          { message: t("onlineEvals.scoreConfig.validation.nameFormat") },
        ),
      description: z.string().optional().default(""),
      // Discriminator (bridged from the bespoke radio-cards).
      dataType: z.enum(["numeric", "categorical", "boolean"]).default("numeric"),
      // Numeric range endpoints. Kept permissive at the field level — the
      // "required number" rule applies ONLY to the numeric data type and lives in
      // superRefine below, so a blank min/max can't trap the user on a type whose
      // inputs are hidden. The store holds the raw string; the payload builder
      // coerces on submit.
      min: z.any(),
      max: z.any(),
      // Categorical values (bridged from the tag-entry).
      categories: z.array(z.string()).default([]),
      // ── Healthy threshold (all optional — bridged where bespoke) ─────────
      healthyDirection: z.enum(["gte", "lte"]).default("gte"),
      healthyGteValue: z.coerce.number().optional(),
      healthyLteValue: z.coerce.number().optional(),
      healthyCategories: z.array(z.string()).default([]),
      healthyBool: z.boolean().nullable().default(null),
    })
    .superRefine((val, ctx) => {
      // Min/Max are required numbers ONLY when the data type is numeric. For
      // categorical/boolean the inputs are not rendered and buildNumericRange
      // drops the values, so validating a blank min/max off-numeric would block
      // Save behind an invisible field (clear min on numeric → switch to
      // categorical → Save silently no-ops). Gate the check on dataType.
      if (val.dataType !== "numeric") return;
      if (isBlankNumber(val.min)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["min"],
          message: t("onlineEvals.scoreConfig.validation.minRequired"),
        });
      }
      if (isBlankNumber(val.max)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max"],
          message: t("onlineEvals.scoreConfig.validation.maxRequired"),
        });
      }
    });
// Intentionally NO numeric `min < max` ordering rule and NO categorical
// "≥1 category" rule — both min≥max ranges and empty categorical are allowed.

export type ScoreConfigForm = z.infer<ReturnType<typeof makeScoreConfigSchema>>;

// Re-exported so the component can keep its `ScoreDataType` typing.
export type { ScoreDataType };
