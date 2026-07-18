// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddTemplate.vue (alert notification templates).
//
// Migration notes (form-migration-playbook / START-HERE Rule ②/④):
//   • `name`   — genuinely user-typed → form-owned OFormInput. Rules mirror the
//     old hand-rolled `saveTemplate` gate: required (`common.nameRequired`) +
//     the resource-name character check (isValidResourceName). Kept UNtrimmed so
//     the payload can send `template_name` raw and `data.name` trimmed exactly
//     like the pre-migration form.
//   • `title`  — form-owned OFormInput, optional at the object level; required
//     ONLY when `type === 'email'` (enforced in `superRefine`, mirroring the old
//     `type === 'email' && !title.trim()` gate).
//   • `body`   — a bare Monaco/`<query-editor>` (the sanctioned non-form widget),
//     bridged into the form via `setFieldValue` from the editor's change handler
//     so this schema's `min(1)` required rule covers it. The http JSON-validity
//     check stays a submit-time toast side-effect in the component (NOT a schema
//     rule) to preserve the exact pre-migration behaviour.
//   • `type`   — NOT an <input>: it is the app-tabs UI toggle. It is a schema
//     enum discriminator bridged into the form via `setFieldValue` from the
//     tab's own handler (the sanctioned Rule-② bridge) so `superRefine` can
//     branch on it. Never rendered as an OForm* control.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";

// Mirrors the old `saveTemplate` name gate:
//   !name.trim() ? nameRequired : (!isValidResourceName(name) ? charsMsg : "")
// nameRequired → i18n `common.nameRequired`; charsMsg → `alerts.validation.nameInvalidChars`.

export const makeAddTemplateSchema = (t: (_key: string) => string) =>
  z
    .object({
      name: z
        .string()
        .min(1, t("common.nameRequired"))
        .refine((val) => isValidResourceName(String(val)), {
          message: t("alerts.validation.nameInvalidChars"),
        }),
      // Discriminator (bridged from the app-tabs toggle, never an <input>).
      type: z.enum(["http", "email"]),
      // Optional at the object level; required-when-email in superRefine below.
      title: z.string().optional(),
      // Bridged from the bare Monaco body editor; required.
      // PARITY (R7): pre-migration `isTemplateFilled()` gated on
      // `body.trim().trim().length`, so a WHITESPACE-ONLY body was INVALID —
      // `.min(1)` alone would pass "   " (length 3). Checked on the trimmed
      // value but NOT transformed: `.trim()` / `z.string().trim()` would MUTATE
      // the saved body, and pre-migration sent it RAW.
      body: z.string().refine((v) => v.trim().length > 0, {
        message: t("alerts.validation.fieldRequired"),
      }),
    })
    .superRefine((val, ctx) => {
      // Email templates require a subject title (old: `!title.trim()`).
      if (val.type === "email" && !String(val.title ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["title"],
          message: t("alerts.validation.fieldRequired"),
        });
      }
    });

export type AddTemplateForm = z.infer<ReturnType<typeof makeAddTemplateSchema>>;

// Static (create-only) defaults. Edit/clone prefill is applied at runtime via
// `form.reset(record)` (see AddTemplate.vue), not here.
export const addTemplateDefaults = (): AddTemplateForm => ({
  name: "",
  type: "http",
  title: "",
  body: "",
});
