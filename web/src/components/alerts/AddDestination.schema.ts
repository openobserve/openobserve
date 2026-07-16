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
// SINGLE-FORM design (prebuilt + custom share ONE <OForm id="add-destination-form">):
// there is NO nested child credential form any more. The per-type credential
// fields render (via PrebuiltDestinationForm, now a presentational descendant)
// as OForm* controls named `credentials.<key>` inside THIS form, so Enter/Save
// submit the one form from anywhere and the schema validates everything together.
// The prebuilt credential rules are composed in `superRefine` from the SAME
// `getPrebuiltConfig().credentialFields` single source of truth (via
// `makePrebuiltDestinationSchema`), re-homed under the `credentials.*` path.
//
// Rule-④ parity: the custom-only rules (url/method/email/action/output_format/
// template) are scoped to NON-prebuilt paths — a prebuilt destination keeps the
// default `type:"http"` (or `"email"` for the prebuilt email type), so without
// that scoping the `type==="http"` url/method rule (and the `type==="email"`
// emails rule) would fire on fields the prebuilt UI never renders and wrongly
// block the save. The prebuilt-side `name` stays UN-required (the pre-migration
// prebuilt save applied no name/template validation) — unchanged from before.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";
import { makePrebuiltDestinationSchema } from "./PrebuiltDestinationForm.schema";

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
  t: (_key: string, _named?: Record<string, unknown>) => string,
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

      // ── Prebuilt credentials (per-type record; validated in superRefine from
      //    the active type's credentialFields). Empty for custom/pipeline. ────
      credentials: z.record(z.string(), z.unknown()).default({}),
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

      // url + method: required for HTTP destinations (custom + pipeline). NOT
      // for prebuilt — those keep the default type:"http" but render no url/
      // method inputs (their endpoint comes from the credential template).
      if (!isPrebuilt && val.type === "http") {
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

      // emails: required + valid list for the CUSTOM email type. NOT for the
      // prebuilt email type — it collects recipients via `credentials.recipients`
      // (selectDestinationType sets type:"email" for it, so scope this out).
      if (!isPrebuilt && val.type === "email") {
        if (!val.emails || !EMAIL_LIST_REGEX.test(String(val.emails))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["emails"],
            message: t("alerts.validation.validEmails"),
          });
        }
      }

      // action_id: required for action destinations.
      if (!isPrebuilt && val.type === "action" && !val.action_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["action_id"],
          message: t("alerts.validation.fieldRequired"),
        });
      }

      // Prebuilt credentials: validate the active type's credential fields from
      // the SAME config-driven schema, re-homed under `credentials.*` so each
      // issue lands on its OFormInput (name=`credentials.<key>`). This is what
      // makes the single-form Save/Enter gate on the credential rules.
      if (isPrebuilt) {
        const credResult = makePrebuiltDestinationSchema(
          t,
          String(val.destination_type),
        ).safeParse((val.credentials ?? {}) as Record<string, unknown>);
        if (!credResult.success) {
          for (const issue of credResult.error.issues) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["credentials", ...issue.path],
              message: issue.message,
            });
          }
        }
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
  credentials: {},
});
