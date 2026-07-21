// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddTemplate.vue (alert notification templates).
//
//   • `name`   — required + resource-name character check (isValidResourceName).
//     Kept untrimmed so the payload can send `template_name` raw and `data.name`
//     trimmed.
//   • `title`  — optional at the object level; required only when
//     `type === 'email'` (enforced in `superRefine`).
//   • `body`   — bare Monaco/`<query-editor>` bridged into the form via
//     `setFieldValue`. The http JSON-validity check stays a submit-time toast
//     side-effect in the component, not a schema rule.
//   • `type`   — the app-tabs UI toggle, bridged in as a schema enum
//     discriminator so `superRefine` can branch on it. Never an OForm* control.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";

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
      // Bridged from the bare Monaco body editor; required. Whitespace-only is
      // invalid, so check the trimmed value — but do NOT transform, the saved
      // body must be sent raw.
      body: z.string().refine((v) => v.trim().length > 0, {
        message: t("alerts.validation.fieldRequired"),
      }),
    })
    .superRefine((val, ctx) => {
      // Email templates require a subject title.
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
// `form.reset(record)` in AddTemplate.vue.
export const addTemplateDefaults = (): AddTemplateForm => ({
  name: "",
  type: "http",
  title: "",
  body: "",
});
