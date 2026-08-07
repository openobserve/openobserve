// Copyright 2026 OpenObserve Inc.
//
// Validation for OnCallTeamForm.vue. Mirrors the server's `validate_team_name`
// and `validate_timezone` so a bad value is caught before the round trip;
// the server still enforces both, since the UI is not the only caller.

import { z } from "zod";

/** Matches the server bound, which counts CHARACTERS not bytes. */
export const TEAM_NAME_MAX = 200;

export const makeOnCallTeamSchema = (t: (_key: string) => string) =>
  z.object({
    // No `.trim()` in the schema: OForm validates with the schema but saves the
    // RAW value, so a trimming transform would let "  " pass while persisting
    // the spaces. Validating the raw value means the min/regex judge what is
    // actually stored.
    name: z
      .string()
      .min(1, t("oncall.teamNameRequired"))
      .refine((v) => v.trim().length > 0, t("oncall.teamNameRequired"))
      .refine(
        (v) => [...v].length <= TEAM_NAME_MAX,
        t("oncall.teamNameTooLong"),
      ),
    timezone: z.string().min(1, t("oncall.timezoneRequired")),
    description: z.string().optional(),
  });

export type OnCallTeamFormValues = z.infer<ReturnType<typeof makeOnCallTeamSchema>>;
