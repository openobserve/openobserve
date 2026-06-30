// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CreateReport.vue — the reports module's single (HIGH
// complexity) form: a routed create/edit page with an OStepper, a custom
// frequency/scheduling section, and several composite controls. Built via a
// factory so the cron min-interval message stays driven by the live zoConfig and
// the name-required message stays i18n-driven (pass useI18n's `t`).
//
// Migration status (per the form-migration-playbook): the whole form is now
// FORM-OWNED — there is no bridge left.
//   • Scalars (OForm* fields): name, description, isCachedReport, imagePreview,
//     cron, customInterval, customPeriod, timezone, date, time, title, emails,
//     message.
//   • frequencyType + selectedTimeTab → OFormToggleGroup; timerange (per row) →
//     OFormDateTimeRange.
//   • `dashboards` is a field-array (`dashboards[0].folder`, etc.). CreateReport
//     renders a single, fixed dashboard row (no add/remove UI), so it uses the
//     field-array NAMES + an array schema without the dynamic push/remove
//     machinery. Each row's controls are real OForm* fields: folder/dashboard/
//     tabs (OFormSelect, required), report_type/email_attachment_type
//     (OFormSelect), attachmentWidth/attachmentHeight (OFormInput; the saved
//     `attachment_dimensions` object is derived from them at save), timerange
//     (OFormDateTimeRange). The dashboard's `variables` stay component-owned
//     (the VariablesInput composite has no OForm* equivalent + carries no
//     validation) and are merged into the payload at save.
//
// Restores the full Quasar BEFORE validation baseline for CreateReport (the 13
// :rules from complete-quasar-validation-inventory-BEFORE.md §5) as Zod
// constraints (truthy -> Zod inversion); the conditional rules (custom-interval
// mode, !cached mode, cron vs custom, scheduleLater) are expressed in superRefine.
//
// NOTE on the date/time format rules: the BEFORE baseline validated
// `scheduling.date` as DD-MM-YYYY (the old Quasar q-input format). The field is
// now an ODate/OFormDate whose value is ISO YYYY-MM-DD (verified in saveReport,
// which splits scheduling.date as [y,m,d]), so a literal DD-MM-YYYY regex would
// reject every valid date. The rule is restored against the live ISO format
// (reportDateRegex) — same validation INTENT, corrected for the migrated control.
// Likewise the built-in `time` rule becomes an HH:MM regex (OTime's value).
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import {
  isValidResourceName,
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
} from "@/utils/zincutils";

// Mirrors the old name :rules — required + the resource-name character check
// ("Characters like :, ?, /, #, and spaces are not allowed.").
const RESOURCE_NAME_MESSAGE =
  "Characters like :, ?, /, #, and spaces are not allowed.";

// Email-list regex (one or more emails separated by , or ;). Verbatim from the
// old `validateReportData` recipients rule.
export const reportEmailRegex =
  /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\s*[;,]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))*$/;

// Live ODate / OFormDate value format (ISO YYYY-MM-DD). See the header note: the
// BEFORE baseline regex was DD-MM-YYYY; this is the same rule for the migrated
// control's actual format.
export const reportDateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Live OTime / OFormTime value format (HH:MM). Restores the built-in `time` rule.
export const reportTimeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const REQUIRED_MESSAGE = "Field is required!";

// Per-row timerange shape (the OFormDateTimeRange value).
export const reportTimerangeSchema = z.object({
  type: z.string().optional().default("relative"),
  period: z.string().optional().default("30m"),
  from: z.number().optional().default(0),
  to: z.number().optional().default(0),
});

// One dashboard row. CreateReport renders exactly one (no add/remove), but it is
// modelled as a field-array so the form owns the row and the values map straight
// onto the saved `dashboards[]` payload. folder/dashboard/tabs are required; the
// rest are unvalidated (no rule existed for them in the BEFORE baseline).
export const reportDashboardRowSchema = z.object({
  folder: z.string().min(1, REQUIRED_MESSAGE),
  dashboard: z.string().min(1, REQUIRED_MESSAGE),
  tabs: z.string().min(1, REQUIRED_MESSAGE),
  report_type: z.string().optional(),
  email_attachment_type: z.string().optional(),
  // `<input type=number>` emits a string — coerce so a typed "1440" validates as
  // a number (an empty field is allowed via `.optional()`; blank coerces to 0,
  // which the save handler treats as "use server defaults").
  attachmentWidth: z.coerce.number().optional(),
  attachmentHeight: z.coerce.number().optional(),
  timerange: reportTimerangeSchema.optional(),
});

export const makeCreateReportSchema = (
  t: (_key: string) => string,
  zoConfig?: { min_auto_refresh_interval?: string | number } | null,
) =>
  z
    .object({
      // ── Form-owned, genuinely user-typed scalars ─────────────────────────
      name: z
        .string()
        .trim()
        .min(1, t("common.nameRequired"))
        .refine((val) => isValidResourceName(String(val)), {
          message: RESOURCE_NAME_MESSAGE,
        }),
      description: z.string().optional().default(""),
      isCachedReport: z.boolean().optional().default(false),
      imagePreview: z.boolean().optional().default(false),

      // ── Dashboard field-array (one fixed, form-owned row) ────────────────
      dashboards: z.array(reportDashboardRowSchema).min(1, REQUIRED_MESSAGE),

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
    })
    .superRefine((val, ctx) => {
      const addIssue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

      // ── Timerange: relative needs a period; absolute needs from + to. ─────
      // (Preserves the old validateReportData timerange guard — jumps to step 1.)
      const timerange = val.dashboards?.[0]?.timerange;
      if (timerange) {
        if (timerange.type === "relative" && !timerange.period) {
          addIssue(["dashboards", 0, "timerange"], REQUIRED_MESSAGE);
        }
        if (
          timerange.type === "absolute" &&
          !(timerange.to && timerange.from)
        ) {
          addIssue(["dashboards", 0, "timerange"], REQUIRED_MESSAGE);
        }
      }

      // ── Cron: required + valid + min-interval (only in cron mode). ────────
      if (val.frequencyType === "cron") {
        const cronStr = String(val.cron ?? "").trim();
        if (!cronStr) {
          addIssue(["cron"], REQUIRED_MESSAGE);
        } else {
          let intervalInSecs: number | undefined;
          try {
            intervalInSecs = getCronIntervalDifferenceInSeconds(cronStr);
          } catch {
            addIssue(["cron"], "Invalid cron expression!");
          }
          if (intervalInSecs !== undefined) {
            if (cronStr.split(/\s+/).length !== 6) {
              addIssue(
                ["cron"],
                "Cron expression must have exactly 6 fields: [Second] [Minute] [Hour] [Day of Month] [Month] [Day of Week]",
              );
            } else if (
              !isAboveMinRefreshInterval(intervalInSecs, zoConfig ?? {})
            ) {
              const minInterval =
                Number(zoConfig?.min_auto_refresh_interval) || 1;
              addIssue(
                ["cron"],
                `Frequency should be greater than ${minInterval - 1} seconds.`,
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

      // ── Timezone: required in cron mode or when scheduling for later. ─────
      if (
        val.frequencyType === "cron" ||
        val.selectedTimeTab === "scheduleLater"
      ) {
        if (!String(val.timezone ?? "").trim()) {
          addIssue(["timezone"], REQUIRED_MESSAGE);
        }
      }

      // ── Date + time: required + well-formed when scheduling for later. ────
      // (Only the non-cron "Schedule Later" tab surfaces these inputs; cron /
      // "Schedule Now" set them programmatically at save.)
      if (
        val.selectedTimeTab === "scheduleLater" &&
        val.frequencyType !== "cron"
      ) {
        if (!reportDateRegex.test(String(val.date ?? ""))) {
          addIssue(["date"], "Date format is incorrect!");
        }
        if (!reportTimeRegex.test(String(val.time ?? ""))) {
          addIssue(["time"], "Time format is incorrect!");
        }
      }

      // ── Share: title + emails required (when NOT a cached report). ────────
      if (!val.isCachedReport) {
        if (!String(val.title ?? "").trim()) {
          addIssue(["title"], REQUIRED_MESSAGE);
        }
        if (!reportEmailRegex.test(String(val.emails ?? ""))) {
          addIssue(["emails"], "Add valid emails!");
        }
      }
    });

export type CreateReportForm = z.infer<ReturnType<typeof makeCreateReportSchema>>;

// Typed defaults factory (the create-mode blank seed bound to OForm's
// `:default-values`). Edit-mode prefill arrives async and is applied with
// `form.reset(values)` once the report record loads (foundation constraint #3),
// so this stays a pure blank factory rather than an inline literal.
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
});
