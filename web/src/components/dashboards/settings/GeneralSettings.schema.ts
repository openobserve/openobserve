// Copyright 2026 OpenObserve Inc.
//
// Validation schema for GeneralSettings.vue (dashboard general settings).
// The form owns `name` (validated, required title), `description`, and
// `showDynamicFilters`. Factory keeps the required message i18n-driven.

import { z } from "zod";

export const makeGeneralSettingsSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("dashboard.nameRequired")),
    description: z.string().optional(),
    showDynamicFilters: z.boolean(),
  });

export type GeneralSettingsForm = z.infer<ReturnType<typeof makeGeneralSettingsSchema>>;

// Static pre-load blank defaults for the form. The async edit-data load
// re-seeds via `form.reset(...)`; this only covers the initial blank state.
// `showDynamicFilters: true` matches the historical reactive default.
export const generalSettingsDefaults = (): GeneralSettingsForm => ({
  name: "",
  description: "",
  showDynamicFilters: true,
});
