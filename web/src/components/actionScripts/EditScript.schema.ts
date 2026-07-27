// Copyright 2026 OpenObserve Inc.
//
// Validation schema for EditScript.vue (Add/Edit Action Script — a multi-step
// OStepper form with create-vs-edit conditionals).
//
// Built via a factory so the conditionals can branch on live create-vs-edit
// state and the cron parse/interval check (which needs the store config) without
// the schema importing the store. Validation TIMING is owned by OForm; this file
// only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";

export interface EditScriptSchemaOptions {
  /** i18n translator (used for all validation messages). */
  t: (_key: string) => string;
  /** Whether the form is in EDIT mode — codeZip is required only on CREATE. */
  getIsEditing: () => boolean;
  /**
   * Validates a non-empty cron expression, returning an error message (parse
   * failure or below the minimum refresh interval) or "" when valid.
   */
  getCronError: (_cron: string) => string;
  /**
   * Returns the component's `execution_details`. Cron is validated when this
   * equals "repeat" (the case on EDIT of a saved repeat action); on CREATE it
   * stays "" throughout.
   */
  getExecutionDetails: () => string;
  /**
   * Returns whether the user has edited the cron field (its form dirty state).
   * On CREATE cron is validated only once the field has been edited, so an
   * untouched blank cron still saves.
   */
  getCronEdited: () => boolean;
}

export const makeEditScriptSchema = (opts: EditScriptSchemaOptions) =>
  z
    .object({
      // ── User-typed / form-owned scalar fields ──────────────────
      name: z
        .string()
        .trim()
        .min(1, opts.t("common.nameRequired"))
        .refine((v) => isValidResourceName(String(v)), {
          message: opts.t("actions.nameInvalidChars"),
        }),
      description: z.string().optional().default(""),
      type: z.string().min(1, opts.t("actions.fieldRequired")),
      service_account: z.string().min(1, opts.t("actions.fieldRequired")),
      // Disabled field whose value is always "UTC"; defaulted but not enforced.
      timezone: z.string().default("UTC"),

      // ── Conditional fields (validated in superRefine) ────────────────────
      // codeZip is a File on create, null/absent on edit. Required-on-create is
      // enforced below.
      codeZip: z.any().nullable().optional(),
      // cron + frequencyType are bridged from the component (the frequency tabs
      // are an OButton toggle, not an <input>). frequencyType feeds the save
      // payload AND the create-side cron gate; the cron requirement/format is
      // enforced below (see superRefine).
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

      // cron is validated through two paths:
      //   (a) EDIT: execution_details === "repeat".
      //   (b) CREATE: the cron field has been edited AND the repeat tab is live.
      //       An untouched blank cron on create still saves.
      const editRepeat = opts.getExecutionDetails() === "repeat";
      const createEditedRepeat = opts.getCronEdited() && val.frequencyType === "repeat";
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
