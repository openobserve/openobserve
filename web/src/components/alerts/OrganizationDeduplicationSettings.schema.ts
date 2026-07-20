// Copyright 2026 OpenObserve Inc.
//
// Validation schema for OrganizationDeduplicationSettings.vue — the inline
// org-level alert deduplication settings form.
//
// Fields:
//   • enabled / alert_dedup_enabled — booleans (OFormCheckbox).
//   • alert_fingerprint_groups — the selected semantic-group ids, modelled as a
//     string[] driven by an OFormCheckboxGroup (each per-group OCheckbox is a
//     group member keyed by its id).
//   • time_window_minutes — the correlation window. The pre-migration form had
//     NO validation rule on it (only an HTML `min="1"` hint) and sanitised
//     empty/NaN → null at save. Kept permissive + nullable so a blank / cleared
//     field still saves (as null); z.coerce.number() only validates that a typed
//     value is numeric (the number <input> can emit a numeric string or "").
//     The @submit handler does the empty/NaN → null conversion for payload
//     parity, so the schema itself never blocks this field.
//
// Restores the pre-migration cross-alert guard (the imperative saveSettings
// toast + the inline `fingerprintGroupsRequired` error) as a superRefine rule:
// when org-level dedup AND cross-alert dedup are both on, at least one
// fingerprint group must be selected.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

/** The persisted org deduplication config shape (edit-prefill source). */
export interface OrganizationDeduplicationConfig {
  enabled: boolean;
  alert_dedup_enabled?: boolean;
  alert_fingerprint_groups?: string[];
  time_window_minutes?: number | null;
}

export const makeOrgDedupSettingsSchema = (t: (_key: string) => string) =>
  z
    .object({
      enabled: z.boolean(),
      alert_dedup_enabled: z.boolean(),
      alert_fingerprint_groups: z.array(z.string()).default([]),
      // No pre-migration rule (see file header) — permissive + nullable.
      time_window_minutes: z.coerce.number().nullish(),
    })
    .superRefine((val, ctx) => {
      if (
        val.enabled &&
        val.alert_dedup_enabled &&
        (!val.alert_fingerprint_groups ||
          val.alert_fingerprint_groups.length === 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["alert_fingerprint_groups"],
          message: t("alerts.correlation.fingerprintGroupsRequired"),
        });
      }
    });

export type OrgDedupSettingsForm = z.infer<
  ReturnType<typeof makeOrgDedupSettingsSchema>
>;

/**
 * Typed defaults, mapped from an optional persisted config. Mirrors the
 * pre-migration localConfig mapping used by init / loadConfig / the props.config
 * watch — one place, so all three code paths stay in sync. A null config yields
 * the create-time defaults (enabled on, everything else empty).
 */
export const orgDedupSettingsDefaults = (
  config?: OrganizationDeduplicationConfig | null,
): OrgDedupSettingsForm => ({
  enabled: config?.enabled ?? true,
  alert_dedup_enabled: config?.alert_dedup_enabled ?? false,
  alert_fingerprint_groups: config?.alert_fingerprint_groups ?? [],
  time_window_minutes: config?.time_window_minutes ?? undefined,
});
