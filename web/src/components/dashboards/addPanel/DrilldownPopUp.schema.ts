// Copyright 2026 OpenObserve Inc.
//
// Validation schema for DrilldownPopUp.vue. The drilldown record is a nested
// object; the form owns its scalar fields and the schema reproduces the old
// `isFormValid`/`nameError`/inline-URL gate as a Zod `superRefine` keyed off the
// drilldown `type`:
//   • name              → always required (was nameError + isFormValid guard)
//   • type === byUrl     → data.url required + protocol regex (was inline URL div)
//   • type === logs      → data.logsQuery required when logsMode === "custom"
//   • type === byDashboard → data.folder + data.dashboard + data.tab required
//
// Field wiring (all name=-owned; the form is the sole source):
//   • type / logsMode are OFormToggleGroup (name=-owned); superRefine branches on
//     them. Only logsQuery (Monaco) is a non-OForm* widget whose value is bridged
//     into the schema via setFieldValue.
//   • data.variables[] is a FORM-OWNED field-array (indexed OFormCombobox rows,
//     name `data.variables[i].name/value`); kept loose here (no per-row rule).
//
// Validation TIMING is owned by OForm (submit-then-change). Factory keeps the
// messages i18n-driven.

import { z } from "zod";

// Protocol-only URL check (mirrors the old isFormURLValid regex).
const URL_PROTOCOL_REGEX = /^(http|https|ftp|file|mailto|telnet|data|ws|wss):\/\//;

// DEFERRED array row — kept loose; not enforced in this pass.
export const drilldownVariableRowSchema = z.object({
  name: z.string().optional().default(""),
  value: z.string().optional().default(""),
});

export const makeDrilldownPopUpSchema = (t: (_key: string) => string) =>
  z
    .object({
      name: z.string().trim().min(1, t("dashboard.nameRequired")),
      type: z.string().optional().default("byDashboard"),
      targetBlank: z.boolean().optional().default(false),
      findBy: z.string().optional().default("name"),
      data: z
        .object({
          logsMode: z.string().optional().default("auto"),
          logsQuery: z.string().optional().default(""),
          url: z.string().optional().default(""),
          folder: z.string().optional().default(""),
          dashboard: z.string().optional().default(""),
          tab: z.string().optional().default(""),
          passAllVariables: z.boolean().optional().default(true),
          // DEFERRED dynamic array — not enforced (see header note).
          variables: z
            .array(drilldownVariableRowSchema)
            .optional()
            .default([]),
        })
        .default({}),
    })
    .superRefine((val, ctx) => {
      const trimmed = (s: unknown) => String(s ?? "").trim();
      const data = val.data ?? {};

      if (val.type === "byUrl") {
        const url = trimmed(data.url);
        if (!url) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["data", "url"],
            message: t("dashboard.urlRequired"),
          });
        } else if (!URL_PROTOCOL_REGEX.test(url)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["data", "url"],
            message: t("dashboard.invalidUrl"),
          });
        }
      } else if (val.type === "logs") {
        if (data.logsMode === "custom" && !trimmed(data.logsQuery)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["data", "logsQuery"],
            message: t("dashboard.sqlQueryRequired"),
          });
        }
      } else if (val.type === "byDashboard") {
        if (!trimmed(data.folder)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["data", "folder"],
            message: t("dashboard.folderRequired"),
          });
        }
        if (!trimmed(data.dashboard)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["data", "dashboard"],
            message: t("dashboard.dashboardRequired"),
          });
        }
        if (!trimmed(data.tab)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["data", "tab"],
            message: t("dashboard.tabRequired"),
          });
        }
      }
    });

export type DrilldownPopUpForm = z.infer<
  ReturnType<typeof makeDrilldownPopUpSchema>
>;
