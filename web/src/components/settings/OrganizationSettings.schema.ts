// Copyright 2026 OpenObserve Inc.
//
// Validation schema for OrganizationSettings.vue (Settings > Organization > Log
// Details). The trace-id / span-id field names are required and must match the
// allowed character set; the two switches are non-validated form state; the
// crossLinks composite (CrossLinkManager) has no OForm* equivalent so it stays
// bare and is merged at submit (declared optional here for documentation).
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { makeDataRetentionDefaultsSchema } from "./DataRetentionDefaults.schema";

import { MAX_RANGE_GUARD_DAYS } from "@/utils/orgTimeRangeSettings";

export const orgSettingsFieldNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;

export const makeOrganizationSettingsSchema = (t: (_key: string) => string) => {
  const FIELD_FORMAT_MESSAGE = t("settings.organizationSettings.fieldNameHelp");

  return z.object({
    // NO .trim(): OForm/TanStack validates with the schema but SAVES the raw value,
    // so .trim() would let "trace_id " pass yet persist the space (breaks field lookup).
    // Validate the raw value; the regex already rejects spaces.
    traceIdFieldName: z
      .string()
      .min(1, t("common.nameRequired"))
      .regex(orgSettingsFieldNameRegex, FIELD_FORMAT_MESSAGE),
    spanIdFieldName: z
      .string()
      .min(1, t("common.nameRequired"))
      .regex(orgSettingsFieldNameRegex, FIELD_FORMAT_MESSAGE),
    // Non-validated form state (still form-owned via OFormSwitch).
    toggleIngestionLogs: z.boolean().optional().default(false),
    usageStreamEnabled: z.boolean().optional().default(false),
    redInsightsEnabled: z.boolean().optional().default(false),
    aiRcaThreadToolOutput: z.boolean().optional().default(false),
    fiscalYearStartMonth: z.number().int().min(0).max(12).optional().default(0),
    // <input type="number"> emits a string; empty means the guard is off.
    rangeGuardDays: z.any().refine((v) => isGuardOff(v) || isGuardDays(v), {
      message: t("settings.rangeGuardDaysValidation"),
    }),
    // CrossLinkManager is a composite custom control — kept bare and merged at
    // submit; optional so it never blocks.
    crossLinks: z.array(z.any()).optional(),
    // Data retention defaults: `default` and `types[]`, saved in the same request.
    ...makeDataRetentionDefaultsSchema(t).shape,
  });
};

/** Days for the server: 0 (off) when the field is empty. */
export const rangeGuardDaysPayload = (value: unknown): number =>
  isGuardOff(value) ? 0 : Number(value);

// Only an empty field turns the guard off, as the help text says; a typed 0 is out of range.
const isGuardOff = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

const isGuardDays = (v: unknown) =>
  Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= MAX_RANGE_GUARD_DAYS;

export type OrganizationSettingsForm = z.infer<ReturnType<typeof makeOrganizationSettingsSchema>>;
