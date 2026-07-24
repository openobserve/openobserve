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

export const orgSettingsFieldNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;

const FIELD_FORMAT_MESSAGE = "Use alphanumeric and '+=,.@-_' characters only, without spaces.";

export const makeOrganizationSettingsSchema = (t: (_key: string) => string) =>
  z.object({
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
    // CrossLinkManager is a composite custom control — kept bare and merged at
    // submit; optional so it never blocks.
    crossLinks: z.array(z.any()).optional(),
  });

export type OrganizationSettingsForm = z.infer<ReturnType<typeof makeOrganizationSettingsSchema>>;
