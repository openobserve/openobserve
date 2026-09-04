// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CreateReport.vue — a routed create/edit form with an
// OStepper, a custom frequency/scheduling section, and several composite
// controls. Built via a factory so the cron min-interval message stays driven by
// the live zoConfig and every user-facing validation message is i18n-driven
// (keys under the `reports.validation.*` namespace, resolved through the
// passed-in `t`; the cron min-interval one interpolates `{seconds}`).
//
// `dashboards` is a field-array; CreateReport renders a single, fixed dashboard
// row. The date/time format rules (reportDateRegex / reportTimeRegex) apply only
// on the non-cron "Schedule Later" tab and, because an empty value fails the
// regex, also make both fields required there.
//
// Validation timing is owned by OForm; this file only describes WHAT is valid.

import { z } from "zod";
import {
  isValidResourceName,
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
} from "@/utils/zincutils";

// Email-list regex (one or more emails separated by , or ;).
export const reportEmailRegex =
  /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\s*[;,]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))*$/;

// ODate / OFormDate value format (ISO YYYY-MM-DD; saveReport splits it as [y,m,d]).
export const reportDateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// OTime / OFormTime value format (HH:MM).
export const reportTimeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

// Per-row timerange shape (the OFormDateTimeRange value).
export const reportTimerangeSchema = z.object({
  type: z.string().optional().default("relative"),
  period: z.string().optional().default("30m"),
  from: z.number().optional().default(0),
  to: z.number().optional().default(0),
});

// One dashboard row, modelled as a field-array so the values map straight onto
// the saved `dashboards[]` payload. folder/dashboard/tabs are required; the rest
// are unvalidated. A factory: the required message is i18n-driven.
export const makeReportDashboardRowSchema = (requiredMessage: string) =>
  z.object({
    folder: z.string().min(1, requiredMessage),
    dashboard: z.string().min(1, requiredMessage),
    tabs: z.string().min(1, requiredMessage),
    report_type: z.string().optional(),
    email_attachment_type: z.string().optional(),
    // `<input type=number>` emits a string — coerce so a typed "1440" validates
    // as a number (an empty field is allowed via `.optional()`; blank coerces to
    // 0, which the save handler treats as "use server defaults").
    attachmentWidth: z.coerce.number().optional(),
    attachmentHeight: z.coerce.number().optional(),
    timerange: reportTimerangeSchema.optional(),
  });

export const makeCreateReportSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
  zoConfig?: { min_auto_refresh_interval?: string | number } | null,
) => {
  // Required-field message — i18n `validation.required`.
  const REQUIRED_MESSAGE = t("validation.required");

  // Resource-name character check message — i18n
  // `reports.validation.resourceNameInvalid`.
  const RESOURCE_NAME_MESSAGE = t("reports.validation.resourceNameInvalid");

  return z
    .object({
      // ── Form-owned, genuinely user-typed scalars ─────────────────────────
      // No .trim(): validate the raw value so a padded / whitespace-only name
      // falls through to the resource-name rule (spaces are disallowed
      // characters) instead of being silently trimmed.
      name: z
        .string()
        .min(1, t("common.nameRequired"))
        .refine((val) => isValidResourceName(String(val)), {
          message: RESOURCE_NAME_MESSAGE,
        }),
      description: z.string().optional().default(""),
      isCachedReport: z.boolean().optional().default(false),
      imagePreview: z.boolean().optional().default(false),

      // ── Dashboard field-array (one fixed, form-owned row) ────────────────
      dashboards: z.array(makeReportDashboardRowSchema(REQUIRED_MESSAGE)).min(1, REQUIRED_MESSAGE),

      // ── Frequency (OFormToggleGroup type + form-owned cron/custom inputs) ──
      frequencyType: z.string().optional().default("once"),
      cron: z.string().optional().default(""),
      // `<input type=number>` emits a string — coerce so a typed "2" validates.
      customInterval: z.coerce.number().optional(),
      customPeriod: z.string().optional().default("days"),

      // ── Scheduling (OFormToggleGroup tab + form-owned timezone/date/time) ──
      selectedTimeTab: z.string().optional().default("scheduleNow"),
      timezone: z.string().optional().default(""),
      date: z.string().optional().default(""),
      time: z.string().optional().default(""),

      // ── Share (required only when NOT a cached report) ────────────────────
      title: z.string().optional().default(""),
      emails: z.string().optional().default(""),
      message: z.string().optional().default(""),

      // ── Dashboard variables (form-owned key/value rows) ──────────────────
      // Merged into dashboards[0].variables at save. The BEFORE baseline had NO
      // validation here (VariablesInput was component-owned + unvalidated), so
      // these rows stay unconstrained — the field exists only so the form owns
      // the value (VariablesInput now renders in form mode, name-prefix="variables").
      variables: z
        .array(z.object({ key: z.string(), value: z.string() }))
        .optional()
        .default([]),
    })
    .superRefine((val, ctx) => {
      const addIssue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

      // ── Timerange: relative needs a period; absolute needs from + to. ─────
      const timerange = val.dashboards?.[0]?.timerange;
      if (timerange) {
        if (timerange.type === "relative" && !timerange.period) {
          addIssue(["dashboards", 0, "timerange"], REQUIRED_MESSAGE);
        }
        if (timerange.type === "absolute" && !(timerange.to && timerange.from)) {
          addIssue(["dashboards", 0, "timerange"], REQUIRED_MESSAGE);
        }
      }

      // ── Cron: valid + 6 fields + min-interval (only in cron mode). ────────
      // An EMPTY cron gets the invalid-cron message (not the required message).
      if (val.frequencyType === "cron") {
        const cronStr = String(val.cron ?? "").trim();
        if (!cronStr) {
          addIssue(["cron"], t("reports.validation.invalidCron"));
        } else {
          let intervalInSecs: number | undefined;
          try {
            intervalInSecs = getCronIntervalDifferenceInSeconds(cronStr);
          } catch {
            addIssue(["cron"], t("reports.validation.invalidCron"));
          }
          if (intervalInSecs !== undefined) {
            // Single-space split (not /\s+/), so doubled spaces fail the
            // 6-field check.
            if (cronStr.split(" ").length !== 6) {
              addIssue(["cron"], t("reports.validation.cronSixFields"));
            } else if (!isAboveMinRefreshInterval(intervalInSecs, zoConfig ?? {})) {
              const minInterval = Number(zoConfig?.min_auto_refresh_interval) || 1;
              addIssue(
                ["cron"],
                t("reports.validation.cronMinInterval", {
                  seconds: minInterval - 1,
                }),
              );
            }
          }
        }
      }

      // ── Custom frequency: interval + period required when "custom". ───────
      if (val.frequencyType === "custom") {
        if (!val.customInterval) {
          addIssue(["customInterval"], REQUIRED_MESSAGE);
        }
        if (!String(val.customPeriod ?? "").trim()) {
          addIssue(["customPeriod"], REQUIRED_MESSAGE);
        }
      }

      // ── Timezone: required on the Schedule Later tab AND in cron mode. ────
      // Both modes surface a required timezone select (cron runs the schedule in
      // that timezone). "Schedule Now" hides the field and auto-fills the browser
      // timezone at save, so it is not enforced here.
      if (val.selectedTimeTab === "scheduleLater" || val.frequencyType === "cron") {
        if (!String(val.timezone ?? "").trim()) {
          addIssue(["timezone"], REQUIRED_MESSAGE);
        }
      }

      // ── Date + time: required + well-formed when scheduling for later. ────
      // Only the non-cron "Schedule Later" tab surfaces these inputs; cron /
      // "Schedule Now" set them programmatically at save. An empty value fails
      // the regex, so this ALSO makes both fields required on that tab.
      if (val.selectedTimeTab === "scheduleLater" && val.frequencyType !== "cron") {
        if (!reportDateRegex.test(String(val.date ?? ""))) {
          addIssue(["date"], t("reports.validation.dateFormat"));
        }
        if (!reportTimeRegex.test(String(val.time ?? ""))) {
          addIssue(["time"], t("reports.validation.timeFormat"));
        }
      }

      // ── Share: title + emails required (when NOT a cached report). ────────
      if (!val.isCachedReport) {
        if (!String(val.title ?? "").trim()) {
          addIssue(["title"], REQUIRED_MESSAGE);
        }
        if (!reportEmailRegex.test(String(val.emails ?? ""))) {
          addIssue(["emails"], t("reports.validation.invalidEmails"));
        }
      }
    });
};

export type CreateReportForm = z.infer<ReturnType<typeof makeCreateReportSchema>>;

// Typed defaults factory (the create-mode blank seed bound to OForm's
// `:default-values`). Edit-mode prefill arrives async and is applied with
// `form.reset(values)` once the report record loads.
export const createReportDefaults = (): CreateReportForm => ({
  name: "",
  description: "",
  isCachedReport: false,
  imagePreview: false,
  dashboards: [
    {
      folder: "",
      dashboard: "",
      tabs: "",
      report_type: "pdf",
      email_attachment_type: "standard",
      attachmentWidth: undefined,
      attachmentHeight: undefined,
      timerange: { type: "relative", period: "30m", from: 0, to: 0 },
    },
  ],
  frequencyType: "once",
  cron: "",
  customInterval: 1,
  customPeriod: "days",
  selectedTimeTab: "scheduleNow",
  timezone: "",
  date: "",
  time: "",
  title: "",
  emails: "",
  message: "",
  variables: [],
});
