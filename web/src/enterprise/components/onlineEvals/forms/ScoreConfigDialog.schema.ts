// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ScoreConfigDialog.vue (online-evals score-config drawer).
// This native-`<form>` drawer shipped with `*` markers but NO client-side
// validation — the migration to OForm + Zod ADDS the missing validation
// (online-evals-migration.md row 68), discriminated by `dataType`.
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

const requiredText = (message: string) =>
  z.string().refine((val) => val.trim().length > 0, { message });

export const makeScoreConfigSchema = (t: (_key: string) => string) =>
  z
    .object({
      name: requiredText(t("onlineEvals.scoreConfig.validation.nameRequired")),
      description: z.string().optional().default(""),
      // Discriminator (bridged from the bespoke radio-cards).
      dataType: z
        .enum(["numeric", "categorical", "boolean"])
        .default("numeric"),
      // number <input>s emit strings → coerce.
      min: z.coerce.number().default(0),
      max: z.coerce.number().default(1),
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
      // Numeric range ordering (min must be below max).
      if (val.dataType === "numeric" && Number(val.min) >= Number(val.max)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max"],
          message: t("onlineEvals.scoreConfig.validation.minMaxOrder"),
        });
      }
      // Categorical's "≥1 category" rule is NOT validated here: the bespoke
      // tag-input has no inline error slot, so it is enforced as a toast guard
      // in the component's save() (see ScoreConfigDialog.vue).
    });

export type ScoreConfigForm = z.infer<ReturnType<typeof makeScoreConfigSchema>>;

// Re-exported so the component can keep its `ScoreDataType` typing.
export type { ScoreDataType };
