// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ScoreConfigDialog.vue (online-evals score-config drawer).
// Client-side validation: (1) name — required + a create-only lowercase-slug
// pattern (matching origin/main); (2) numeric min/max — each must be a non-empty
// number (a blank field is rejected rather than coerced to 0). There is NO min<max
// ordering rule and NO "≥1 category" rule — main allowed both, so those stay
// deliberately absent (online-evals-migration.md row 68).
//
// The component OWNS <OForm> via the Rule-③ owner pattern: it creates the form
// with `useOForm` and reads it reactively through `form.useStore` — a SINGLE
// source of truth, NO mirror ref, NO `v-model`, NO `watch → setFieldValue` sync.
// That read view (`formValues`) drives the `dataType`/`healthyDirection`/
// `categories` `v-if` branches; the @submit payload builders read the validated
// `value`; `isDirty` comes from the form store (a save-affordance, not a
// validation gate). The real text/number inputs (name/description/min/max/healthy
// values) are plain form-owned `name=` fields. The bespoke choice grids (the
// dataType radio-cards, the healthy-threshold radios/checkboxes — several of which
// embed inline number inputs, so they have NO OForm* representation) plus the
// categories tag-entry write DIRECTLY into the one form via `form.setFieldValue`
// from each control's own `@change`/`@click` handler (the sanctioned custom-grid
// bridge — NOT a watch on a local mirror). Every field thus lives in the schema —
// validated or `.optional()`. Validation TIMING is owned by OForm.

import { z } from "zod";
import type { ScoreDataType } from "@/services/online-evals.service";

// Stable-identifier rule (letters, digits, underscores), restored from the
// pre-migration `validateName()`: the name is a lowercase slug. Only enforced on
// create — in edit the name is immutable (the input is disabled), so a legacy
// config whose name predates this rule must still be editable (description-only).
const NAME_PATTERN = /^[a-z0-9_]+$/;

// A numeric-range endpoint (min / max). The number <input> stores a RAW STRING —
// "" when cleared — which `z.coerce.number()` would silently turn into 0, so a
// blank field must be rejected explicitly: empty / null / non-numeric all fail.
// Any actual number is accepted (there is no min<max ordering rule — matches
// main). `.transform` keeps the inferred type `number`; the payload builder in the
// component re-coerces the raw store value on submit.
const rangeNumber = (message: string) =>
  z
    .any()
    .refine(
      (v) => v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v)),
      { message },
    )
    .transform((v) => Number(v));

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
          (val) =>
            mode === "edit" ||
            val.trim().length === 0 ||
            NAME_PATTERN.test(val.trim()),
          { message: t("onlineEvals.scoreConfig.validation.nameFormat") },
        ),
      description: z.string().optional().default(""),
      // Discriminator (bridged from the bespoke radio-cards).
      dataType: z
        .enum(["numeric", "categorical", "boolean"])
        .default("numeric"),
      // Required numbers — a blank min/max is rejected (see rangeNumber).
      min: rangeNumber(t("onlineEvals.scoreConfig.validation.minRequired")),
      max: rangeNumber(t("onlineEvals.scoreConfig.validation.maxRequired")),
      // Categorical values (bridged from the tag-entry).
      categories: z.array(z.string()).default([]),
      // ── Healthy threshold (all optional — bridged where bespoke) ─────────
      healthyDirection: z.enum(["gte", "lte"]).default("gte"),
      healthyGteValue: z.coerce.number().optional(),
      healthyLteValue: z.coerce.number().optional(),
      healthyCategories: z.array(z.string()).default([]),
      healthyBool: z.boolean().nullable().default(null),
    });
    // NOTE: matching pre-migration (origin/main) behavior, there is intentionally
    // NO numeric `min < max` ordering rule and NO categorical "≥1 category" rule —
    // main allowed both (min≥max ranges, and empty categorical → `categories:
    // null`). The only validation the migration restores is name required + the
    // create-only slug pattern above. See ScoreConfigDialog.vue save().

export type ScoreConfigForm = z.infer<ReturnType<typeof makeScoreConfigSchema>>;

// Re-exported so the component can keep its `ScoreDataType` typing.
export type { ScoreDataType };
