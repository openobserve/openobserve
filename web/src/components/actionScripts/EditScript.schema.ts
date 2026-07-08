// Copyright 2026 OpenObserve Inc.
//
// Validation schema for EditScript.vue (Add/Edit Action Script — a multi-step
// OStepper form with create-vs-edit conditionals). Migrated from the old manual
// `nameError` / `typeError` / `cronFieldError` / `serviceAccountError` refs +
// the imperative `validateActionScriptData()` step gates to a single Zod schema
// on <OForm :schema>.
//
// Restores the Quasar BEFORE baseline (complete-quasar-validation-inventory-
// BEFORE.md → actionScripts/EditScript.vue, 6 rules), honoring the truthy→Zod
// inversion (a `!!v` guard becomes a positive constraint = required):
//   • name             required + isValidResourceName (custom char rule)
//   • type             required
//   • service_account  required
//   • timezone         required (disabled, value "UTC")
//   • codeZip (q-file) required ONLY on create  → superRefine
//   • frequency.cron   required + cron-format/interval ONLY when scheduled+repeat
//                      → superRefine (cross-field on type + frequencyType)
//
// Built via a factory so the conditionals can branch on live create-vs-edit
// state and the cron parse/interval check (which needs the store config) without
// the schema importing the store. Validation TIMING is owned by OForm
// (submit-then-change via revalidateLogic); this file only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";

const RESOURCE_NAME_MESSAGE =
  "Characters like :, ?, /, #, and spaces are not allowed.";

export interface EditScriptSchemaOptions {
  /** i18n translator (used for the name-required message). */
  t: (_key: string) => string;
  /** Whether the form is in EDIT mode — codeZip is required only on CREATE. */
  getIsEditing: () => boolean;
  /**
   * Validates a non-empty cron expression, returning an error message (parse
   * failure or below the minimum refresh interval) or "" when valid. Injected
   * from the component so the schema stays decoupled from the store / cron-parser.
   */
  getCronError: (_cron: string) => string;
}

export const makeEditScriptSchema = (opts: EditScriptSchemaOptions) =>
  z
    .object({
      // ── Genuinely user-typed / form-owned scalar fields ──────────────────
      name: z
        .string()
        // Pre-migration used `v-model.trim`, so surrounding whitespace was
        // stripped before the required + isValidResourceName checks ran. `.trim()`
        // restores that parity — " abc " validates (and saves) as "abc" instead of
        // failing isValidResourceName on the leading/trailing space.
        .trim()
        .min(1, opts.t("common.nameRequired"))
        .refine((v) => isValidResourceName(String(v)), {
          message: RESOURCE_NAME_MESSAGE,
        }),
      description: z.string().optional().default(""),
      type: z.string().min(1, "Field is required!"),
      service_account: z.string().min(1, "Field is required!"),
      // Disabled field whose value is always "UTC" — still required per baseline.
      timezone: z.string().min(1, "Field is required!").default("UTC"),

      // ── Conditional fields (validated in superRefine) ────────────────────
      // codeZip is a File on create, null/absent on edit. Required-on-create is
      // enforced below.
      codeZip: z.any().nullable().optional(),
      // cron + frequencyType are bridged from the component (the frequency tabs
      // are an OButton toggle, not an <input>). The cron requirement/format is
      // enforced below only when scheduled + repeat.
      cron: z.string().optional().default(""),
      frequencyType: z.string().optional().default("once"),
    })
    .superRefine((val, ctx) => {
      // codeZip — required ONLY on create (edit keeps the existing file).
      if (!opts.getIsEditing() && !val.codeZip) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeZip"],
          message: "ZIP File is required!",
        });
      }

      // cron — required + valid ONLY for a scheduled action on a repeat schedule.
      if (val.type === "scheduled" && val.frequencyType === "repeat") {
        const cron = String(val.cron ?? "").trim();
        if (!cron) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cron"],
            message: "Field is required!",
          });
        } else {
          const cronError = opts.getCronError(cron);
          if (cronError) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["cron"],
              message: cronError,
            });
          }
        }
      }
    });

export type EditScriptForm = z.infer<ReturnType<typeof makeEditScriptSchema>>;
