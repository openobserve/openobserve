// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddDestination.vue — a destination form discriminated by
// the (bridged, non-<input>) `destination_type` card-selector + the `type` tabs.
// Built via a factory so messages stay i18n-driven (`t`) and the per-instance
// `isAlerts` prop can gate the alerts-only vs pipeline-only rules.
//
// Migration notes (form-migration-playbook / START-HERE Rule ①/②/④):
//   • `name`/`url`/`emails` — genuinely user-typed → form-owned OFormInput; rules
//     mirror the old hand-rolled `save()` error refs exactly.
//   • `method`/`output_format`/`action_id`/`template` — form-owned OFormSelect.
//   • `skip_tls_verify` — form-owned OFormSwitch (boolean).
//   • `apiHeaders` — a Rule-① dynamic array-field (`apiHeaders[i].key/.value`),
//     each row form-owned (playbook §2 array-field pattern); rebuilt into the
//     `headers` map at submit. No per-row rule (blank starter row is valid).
//   • `destination_type` / `type` — NOT <input>s: a custom card grid + app-tabs.
//     Both are bridged into the form via `setFieldValue` from their own handlers
//     (the sanctioned Rule-② bridge) so `superRefine` can branch on them.
//
// OPEN DECISION 3 (prebuilt parent-side name/template/skip_tls_verify): the
// prebuilt path's name/template/skip_tls_verify/apiHeaders live INSIDE the
// parent's <OForm> tree and are form-owned OForm* here (option A). To preserve
// BEFORE parity (the pre-migration form applied NO validation to prebuilt-side
// name/template — the prebuilt save was gated ONLY by the child credential
// form), the `name` required rule is scoped to NON-prebuilt paths in
// `superRefine`. In prebuilt mode the parent form is never the submit target
// (Save/Enter submit the child credential form by id), so these object-level
// `.optional()` fields carry no new validation.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";

// Mirrors the old `save()` name gate:
//   !name ? nameRequired : (!isValidResourceName(name) ? charsMsg : "")
// nameRequired → i18n `common.nameRequired`; charsMsg → `alerts.validation.nameInvalidChars`.

// Byte-identical to the old inline email-list regex in save().
const EMAIL_LIST_REGEX =
  /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\s*[;,]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))*$/;

// One row in the dynamic api-headers array-field. Both fields are free-form
// text (a blank starter row is valid — only non-empty rows persist on save).
export const headerRowSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const makeAddDestinationSchema = (
  t: (_key: string) => string,
  isAlerts: boolean,
) =>
  z
    .object({
      // ── Discriminators (bridged from the card grid + tabs) ───────────────
      destination_type: z.string().optional().default(""),
      type: z.string().optional().default("http"),

      // ── Form-owned fields (rules enforced in superRefine below) ──────────
      name: z.string().optional().default(""),
      template: z.string().optional().default(""),
      url: z.string().optional().default(""),
      method: z.string().optional().default("post"),
      output_format: z.string().optional().default("json"),
      emails: z.string().optional().default(""),
      action_id: z.string().optional().default(""),
      skip_tls_verify: z.boolean().optional().default(false),

      // ── Form-owned dynamic api-headers rows ──────────────────────────────
      apiHeaders: z.array(headerRowSchema).default([]),
    })
    .superRefine((val, ctx) => {
      const trimmed = (s: unknown) => String(s ?? "").trim();
      const isPrebuilt =
        isAlerts && !!val.destination_type && val.destination_type !== "custom";

      // name: required + resource-name check. Scoped to NON-prebuilt paths —
      // the pre-migration form never validated the prebuilt-side name.
      if (!isPrebuilt) {
        if (!trimmed(val.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["name"],
            message: t("common.nameRequired"),
          });
        } else if (!isValidResourceName(String(val.name))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["name"],
            message: t("alerts.validation.nameInvalidChars"),
          });
        }
      }

      // template: required only for custom alert destinations.
      if (isAlerts && val.destination_type === "custom" && !val.template) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["template"],
          message: t("alerts.validation.templateRequired"),
        });
      }

      // url + method: required for HTTP destinations (custom + pipeline).
      if (val.type === "http") {
        if (!trimmed(val.url)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["url"],
            message: t("alerts.validation.fieldRequired"),
          });
        }
        if (!val.method) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["method"],
            message: t("alerts.validation.fieldRequired"),
          });
        }
      }

      // output_format: required only for pipeline (non-alert) destinations.
      if (!isAlerts && !val.output_format) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["output_format"],
          message: t("alerts.validation.fieldRequired"),
        });
      }

      // emails: required + valid list for email destinations.
      if (val.type === "email") {
        if (!val.emails || !EMAIL_LIST_REGEX.test(String(val.emails))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["emails"],
            message: t("alerts.validation.validEmails"),
          });
        }
      }

      // action_id: required for action destinations.
      if (val.type === "action" && !val.action_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["action_id"],
          message: t("alerts.validation.fieldRequired"),
        });
      }
    });

export type AddDestinationForm = z.infer<
  ReturnType<typeof makeAddDestinationSchema>
>;

// Static (create-only) defaults. Edit prefill is applied at runtime via
// setFieldValue in setupDestinationData (see AddDestination.vue), not here.
export const addDestinationDefaults = (): AddDestinationForm => ({
  destination_type: "",
  type: "http",
  name: "",
  template: "",
  url: "",
  method: "post",
  output_format: "json",
  emails: "",
  action_id: "",
  skip_tls_verify: false,
  apiHeaders: [{ key: "", value: "" }],
});
