// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddDestination.vue — a destination form discriminated by
// the (bridged, non-<input>) `destination_type` card-selector + the `type` tabs.
// Built via a factory so messages stay i18n-driven (`t`) and the per-instance
// `isAlerts` prop can gate the alerts-only vs pipeline-only rules.
//
// `destination_type` / `type` are NOT <input>s: a custom card grid + app-tabs,
// bridged into the form via `setFieldValue` from their own handlers so
// `superRefine` can branch on them. `apiHeaders` is a dynamic array-field
// (`apiHeaders[i].key/.value`), rebuilt into the `headers` map at submit; a
// blank starter row is valid.
//
// Prebuilt + custom share ONE <OForm id="add-destination-form">: the per-type
// credential fields render (via PrebuiltDestinationForm) as OForm* controls
// named `credentials.<key>` inside THIS form, so Enter/Save submit the one form
// and the schema validates everything together. The prebuilt credential rules
// are composed in `superRefine` from the same `getPrebuiltConfig().
// credentialFields` source (via `makePrebuiltDestinationSchema`), under the
// `credentials.*` path. The custom-only rules (url/method/email/action/
// output_format/template) are scoped to NON-prebuilt paths so they do not fire
// on fields the prebuilt UI never renders.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";
import { makePrebuiltDestinationSchema } from "./PrebuiltDestinationForm.schema";

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

      // name: required + resource-name check. Scoped to NON-prebuilt paths.
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
      // prebuilt email type — it collects recipients via `credentials.recipients`.
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
