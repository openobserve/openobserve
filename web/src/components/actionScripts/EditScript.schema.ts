// Copyright 2026 OpenObserve Inc.
//
// Validation schema for EditScript.vue (Add/Edit Action Script — a multi-step
// OStepper form with create-vs-edit conditionals). Migrated from the old manual
// `nameError` / `typeError` / `cronFieldError` / `serviceAccountError` refs +
// the imperative `validateActionScriptData()` step gates to a single Zod schema
// on <OForm :schema>.
//
// Restores the BEFORE baseline (actionScripts/EditScript.vue, 6 rules), honoring the truthy→Zod
// inversion (a `!!v` guard becomes a positive constraint = required):
//   • name             required + isValidResourceName (custom char rule)
//   • type             required
//   • service_account  required
//   • timezone         defaulted to "UTC" (disabled field) — NOT enforced, to
//                      match pre-migration main, which had no timezone rule.
//   • codeZip (q-file) required ONLY on create  → superRefine
//   • frequency.cron   required + cron-format/interval, byte-exact to main's TWO
//                      validation paths → superRefine:
//                        · EDIT: execution_details === "repeat" (submit-path gate)
//                        · CREATE: only once the user has EDITED the cron field
//                          (main's inline @update handler) + repeat tab live. A
//                          never-touched blank cron on create still saves — main's
//                          latent gap, preserved.
//
// Built via a factory so the conditionals can branch on live create-vs-edit
// state and the cron parse/interval check (which needs the store config) without
// the schema importing the store. Validation TIMING is owned by OForm
// (submit-then-change via revalidateLogic); this file only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";

export interface EditScriptSchemaOptions {
  /** i18n translator (used for all validation messages). */
  t: (_key: string) => string;
  /** Whether the form is in EDIT mode — codeZip is required only on CREATE. */
  getIsEditing: () => boolean;
  /**
   * Validates a non-empty cron expression, returning an error message (parse
   * failure or below the minimum refresh interval) or "" when valid. Injected
   * from the component so the schema stays decoupled from the store / cron-parser.
   */
  getCronError: (_cron: string) => string;
  /**
   * Returns the component's `execution_details`. This is main's submit-path cron
   * gate: cron is validated when it equals "repeat" (the case on EDIT of a saved
   * repeat action). During CREATE it stays "" the whole time.
   */
  getExecutionDetails: () => string;
  /**
   * Returns whether the user has edited the cron field (its form dirty state).
   * On CREATE, main only validated cron once its inline @update handler had run —
   * i.e. after an edit — so an untouched blank cron still saves. This reproduces
   * that gate; it stays false until the user changes the field.
   */
  getCronEdited: () => boolean;
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
          message: opts.t("actions.nameInvalidChars"),
        }),
      description: z.string().optional().default(""),
      type: z.string().min(1, opts.t("actions.fieldRequired")),
      service_account: z.string().min(1, opts.t("actions.fieldRequired")),
      // Disabled field whose value is always "UTC". Pre-migration main had NO
      // timezone rule, so it's defaulted but NOT enforced (parity).
      timezone: z.string().default("UTC"),

      // ── Conditional fields (validated in superRefine) ────────────────────
      // codeZip is a File on create, null/absent on edit. Required-on-create is
      // enforced below.
      codeZip: z.any().nullable().optional(),
      // cron + frequencyType are bridged from the component (the frequency tabs
      // are an OButton toggle, not an <input>). frequencyType feeds the save
      // payload AND the create-side cron gate (repeat tab live); the cron
      // requirement/format is enforced below (see superRefine).
      cron: z.string().optional().default(""),
      frequencyType: z.string().optional().default("once"),
    })
    .superRefine((val, ctx) => {
      // codeZip — required ONLY on create (edit keeps the existing file).
      if (!opts.getIsEditing() && !val.codeZip) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeZip"],
          message: opts.t("actions.zipFileRequired"),
        });
      }

      // cron — byte-exact restoration of pre-migration main, which validated cron
      // through TWO paths:
      //   (a) the submit-path gate on execution_details === "repeat" (fires on
      //       EDIT, where the record's execution_details is "repeat"), and
      //   (b) the cron field's inline @update handler, which only ran once the
      //       user had actually edited the field. So on CREATE a repeat schedule
      //       whose cron field is never touched still saves with a blank cron —
      //       main's latent gap, deliberately preserved here.
      // (a) → getExecutionDetails(); (b) → getCronEdited() gated on the live tab.
      const editRepeat = opts.getExecutionDetails() === "repeat";
      const createEditedRepeat =
        opts.getCronEdited() && val.frequencyType === "repeat";
      if (editRepeat || createEditedRepeat) {
        const cron = String(val.cron ?? "").trim();
        if (!cron) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cron"],
            message: opts.t("actions.fieldRequired"),
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
